/* Import data files (CSV or Excel):
 *  1) stock plan workbook          — monthly usage (+ optional Stock column)
 *  2) "ยอดยาคงคลัง - รายตำแหน่งเก็บ"  — on-hand stock per lot × location, summed per SKU
 *  3) "รายงานสต็อกเคลื่อนไหว"        — usage transactions; summed per SKU per day IN THE BROWSER.
 *     Patient names and other row details never leave the browser — only daily totals are saved. */
'use strict';
const IMP = { file: null, parsed: null, err: null, busy: false, done: null };

const isoOf = v => {
  if (v instanceof Date && !isNaN(v)) return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
  const m = String(v ?? '').match(/(\d{4})-(\d{2})-(\d{2})/); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const t = String(v ?? '').match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/); if (t) { let y = +t[3]; if (y > 2400) y -= 543; return `${y}-${t[2].padStart(2, '0')}-${t[1].padStart(2, '0')}`; }
  return null;
};
const cellNum = (v, where, code, bad) => {
  if (v == null || v === '' || v === '-') return null; if (typeof v === 'number') return v;
  const n = Number(String(v).replace(/,/g, '').trim()); if (isFinite(n)) return n;
  bad.push(`${code} · ${where}: "${v}"`); return null;
};
const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const monthEnd = m => addDays(addDays(m, 32).slice(0, 8) + '01', -1);
const cleanCell = v => typeof v === 'string' ? v.replace(/﻿/g, '').trim() : v;

/** Minimal RFC 4180 CSV reader (keeps every value as text, so codes like "H1-5-UTF" are never turned into dates). */
function parseCSV(text) {
  text = text.replace(/﻿/g, '');
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n') { row.push(f); rows.push(row); row = []; f = ''; }
    else if (c !== '\r') f += c;
  }
  if (f !== '' || row.length) { row.push(f); rows.push(row); }
  return rows;
}

/** Format 1 — stock plan: header has "รหัสยา" and month columns (ม.ค. … ธ.ค.). */
function parsePlan(rows, name, fileName) {
  let hr = -1, codeCol = -1;
  for (let r = 0; r < Math.min(rows.length, 20) && hr < 0; r++) (rows[r] || []).forEach((c, i) => { if (hr < 0 && String(c ?? '').trim() === 'รหัสยา') { hr = r; codeCol = i; } });
  if (hr < 0) return null;
  const head = rows[hr], yrow = rows[hr - 1] || [];
  const cols = []; let year = null, stockCol = -1, nameCol = -1;
  for (let c = 0; c < head.length; c++) {
    const ym = String(yrow[c] ?? '').match(/(20\d\d)/); if (ym) year = Number(ym[1]);
    const h = String(head[c] ?? '').replace(/\s+/g, ' ').trim();
    if (!h || c === codeCol) continue;
    if (h === 'ชื่อยา') { nameCol = c; continue; }
    if (/^stock$/i.test(h) || h === 'คงเหลือ' || h === 'สต็อก') { stockCol = c; continue; }
    if (/^รวม/.test(h)) continue;
    const mi = TH_M.findIndex(t => h.startsWith(t));
    if (mi < 0) continue;
    const suf = h.slice(TH_M[mi].length).trim();
    let y = year;
    if (/^\d{2}$/.test(suf)) { const yy = Number(suf); y = yy >= 60 ? 2500 + yy - 543 : 2000 + yy; }
    else if (suf) continue;
    if (!y) continue;
    cols.push({ c, month: `${y}-${String(mi + 1).padStart(2, '0')}-01` });
  }
  if (!cols.length) return null;
  const items = [], bad = [];
  for (let r = hr + 1; r < rows.length; r++) {
    const row = rows[r] || []; const code = String(row[codeCol] ?? '').trim();
    if (!code) continue;
    const usage = cols.map(m => ({ month: m.month, qty: cellNum(row[m.c], mLabel(m.month), code, bad) }));
    const stock = stockCol >= 0 ? cellNum(row[stockCol], 'Stock', code, bad) : null;
    items.push({ code, name: nameCol >= 0 ? String(row[nameCol] ?? '').trim() : '', usage, stock });
  }
  return { kind: 'plan', fileName, sheet: name, months: cols.map(c => c.month), hasStock: stockCol >= 0, items, bad };
}

/** Format 2 — on-hand report: header has "รหัสยา" and "ยอดคงคลัง …" columns; rows are lots × locations. */
function parseOnhand(rows, name, fileName) {
  let hr = -1;
  for (let r = 0; r < Math.min(rows.length, 30) && hr < 0; r++) {
    const cells = (rows[r] || []).map(c => String(c ?? '').trim());
    if (cells.includes('รหัสยา') && cells.some(c => /^ยอดคงคลัง/.test(c))) hr = r;
  }
  if (hr < 0) return null;
  const head = rows[hr].map(c => String(c ?? '').replace(/\s+/g, ' ').trim());
  const col = re => head.findIndex(h => re.test(h));
  const cCode = head.indexOf('รหัสยา'), cName = col(/^ชื่อยา/), cUnit = col(/^หน่วย$/), cBranch = col(/^สาขา$/), cExp = col(/^หมดอายุ/);
  const cDated = col(/^ยอดคงคลัง \d{4}-\d{2}-\d{2}/), cNow = col(/^ยอดคงคลัง ?\(ปัจจุบัน\)/);
  let datedDate = cDated >= 0 ? isoOf(head[cDated]) : null, reportDate = null;
  for (let r = 0; r < hr; r++) {
    const row = rows[r] || [], k = String(row[0] ?? '').trim();
    if (/^วันที่แสดงข้อมูล/.test(k) && !datedDate) datedDate = isoOf(row[1]);
    if (/^ออกรายงานเมื่อ/.test(k)) reportDate = isoOf(row[1]);
  }
  const map = new Map(), branches = new Set(), bad = [];
  for (let r = hr + 1; r < rows.length; r++) {
    const row = rows[r] || []; const code = String(row[cCode] ?? '').trim();
    if (!code) continue;
    const it = map.get(code) || { code, name: cName >= 0 ? String(row[cName] ?? '').trim() : '', unit: cUnit >= 0 ? String(row[cUnit] ?? '').trim() : '', dated: 0, now: 0, expDated: 0, expNow: 0, lots: 0 };
    const expired = cExp >= 0 && (row[cExp] === true || /^(true|ใช่|yes|y|1)$/i.test(String(row[cExp] ?? '').trim()));
    const d = cDated >= 0 ? cellNum(row[cDated], 'ยอด ณ วันที่', code, bad) || 0 : 0;
    const n = cNow >= 0 ? cellNum(row[cNow], 'ยอดปัจจุบัน', code, bad) || 0 : 0;
    it.dated += d; it.now += n; if (expired) { it.expDated += d; it.expNow += n; }
    it.lots++; if (cBranch >= 0 && row[cBranch]) branches.add(String(row[cBranch]).trim());
    map.set(code, it);
  }
  return { kind: 'onhand', fileName, sheet: name, items: [...map.values()], hasDated: cDated >= 0, hasNow: cNow >= 0, datedDate, reportDate, branches: [...branches], bad };
}

/** Format 3 — movement report: rows are usage transactions (negative จำนวน = used). Summed per SKU × day × type. */
function parseMovement(rows, name, fileName) {
  let hr = -1;
  for (let r = 0; r < Math.min(rows.length, 40) && hr < 0; r++) {
    const cells = (rows[r] || []).map(c => String(c ?? '').trim());
    if (cells.includes('รหัสยา') && cells.includes('จำนวน') && cells.includes('วันที่')) hr = r;
  }
  if (hr < 0) return null;
  const head = rows[hr].map(c => String(c ?? '').trim());
  const ix = h => head.indexOf(h);
  const cCode = ix('รหัสยา'), cName = ix('ชื่อยา'), cUnit = ix('หน่วย'), cQty = ix('จำนวน'), cType = ix('ประเภท'), cDate = ix('วันที่'), cBranch = ix('สาขา');
  let from = null, to = null;
  for (let r = 0; r < hr; r++) { const row = rows[r] || []; if (/^ตั้งแต่/.test(String(row[0] ?? '').trim())) { from = isoOf(row[1]); to = isoOf(row[3]); } }
  const map = new Map(), types = new Map(), branches = new Set(), bad = []; let tx = 0, minD = null, maxD = null;
  for (let r = hr + 1; r < rows.length; r++) {
    const row = rows[r] || [];
    if (String(row[0] ?? '').trim() === 'หมวดหมู่') break;            // next section starts
    const code = String(row[cCode] ?? '').trim(); if (!code) continue;
    const day = isoOf(row[cDate]); const q = cellNum(row[cQty], 'จำนวน', code, bad);
    if (!day || q == null) continue;
    const type = cType >= 0 ? String(row[cType] ?? '').trim() || 'อื่นๆ' : 'ทั้งหมด';
    const it = map.get(code) || { code, name: cName >= 0 ? String(row[cName] ?? '').trim() : '', unit: cUnit >= 0 ? String(row[cUnit] ?? '').trim() : '', cells: {} };
    const k = day + '|' + type; it.cells[k] = (it.cells[k] || 0) - q;   // usage is the negative of the movement
    map.set(code, it);
    const t = types.get(type) || { type, n: 0 }; t.n++; types.set(type, t);
    if (cBranch >= 0 && row[cBranch]) branches.add(String(row[cBranch]).trim());
    tx++; if (!minD || day < minD) minD = day; if (!maxD || day > maxD) maxD = day;
  }
  if (!tx) return null;
  return { kind: 'movement', fileName, sheet: name, from: from || minD, to: to || maxD, items: [...map.values()], types: [...types.values()], branches: [...branches], tx, bad };
}

async function parseFile(f) {
  const buf = await f.arrayBuffer();
  const isZip = new Uint8Array(buf.slice(0, 2)).join() === '80,75';     // xlsx files start with "PK"
  const sheets = [];
  if (!isZip) sheets.push({ name: 'CSV', rows: parseCSV(new TextDecoder('utf-8').decode(buf)) });
  else {
    if (!window.XLSX) throw new Error('ตัวอ่านไฟล์ Excel ยังโหลดไม่เสร็จ — ลองใหม่อีกครั้ง');
    const wb = XLSX.read(buf, { type: 'array', cellDates: true });
    [...wb.SheetNames].sort((a, b) => (/AllBranch|รวม/.test(b) ? 1 : 0) - (/AllBranch|รวม/.test(a) ? 1 : 0))
      .forEach(n => sheets.push({ name: n, rows: XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: null }).map(r => r.map(cleanCell)) }));
  }
  for (const s of sheets) {
    const res = parseMovement(s.rows, s.name, f.name) || parsePlan(s.rows, s.name, f.name) || parseOnhand(s.rows, s.name, f.name);
    if (res) return res;
  }
  throw new Error('อ่านไฟล์นี้ไม่ได้ — รองรับ: รายงานสต็อกเคลื่อนไหว, รายงานยอดยาคงคลัง - รายตำแหน่งเก็บ (CSV หรือ Excel) และไฟล์ stock plan');
}

/* ---------- daily-usage coverage: a month's total comes from daily data only when daily data covers it from the 1st ---------- */
async function loadImports() {
  const { data, error } = await sb.from('stock_usage_imports').select('date_from,date_to,source_file,imported_at').order('date_from');
  if (error) throw error; S.imports = data || []; return S.imports;
}
function coveredThrough(month, ranges) {
  const end = monthEnd(month); let d = month, last = null;
  while (d <= end && ranges.some(r => r.date_from <= d && d <= r.date_to)) { last = d; d = addDays(d, 1); }
  return last;   // last day covered continuously from the 1st, or null
}
function monthsBetween(a, b) { const out = []; let m = a.slice(0, 8) + '01'; while (m <= b) { out.push(m); m = addDays(monthEnd(m), 1); } return out; }

function previewPlan(p, matched, unmatched) {
  const withStock = matched.filter(i => i.stock != null).length;
  const partial = p.months[p.months.length - 1] >= thisMonthISO();
  return `<div class="small muted" style="margin-bottom:14px">ไฟล์ยอดใช้รายเดือน <b>${esc(p.fileName)}</b> · ชีต "${esc(p.sheet)}" · ${p.months.length} เดือน (${mLabel(p.months[0])} – ${mLabel(p.months[p.months.length - 1])})${partial ? ' · เดือนล่าสุดยังไม่ครบเดือน ระบบจะไม่นำไปคิดค่าเฉลี่ย' : ''}</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:14px">
      <div class="kpi" style="padding:12px 14px"><div class="v" style="font-size:22px;color:#1f7a55">${matched.length}</div><div class="h2">SKU ที่จับคู่ได้</div></div>
      <div class="kpi" style="padding:12px 14px"><div class="v" style="font-size:22px">${unmatched.length}</div><div class="h2">ไม่อยู่ในรายการหลัก (ข้าม)</div></div>
      <div class="kpi" style="padding:12px 14px"><div class="v" style="font-size:22px">${withStock}</div><div class="h2">มียอดสต็อก</div></div>
      <div class="kpi" style="padding:12px 14px"><div class="v" style="font-size:22px">${matched.length * p.months.length}</div><div class="h2">แถวยอดใช้ที่จะบันทึก</div></div>
    </div>
    ${unmatched.length ? `<div class="warnbox">รหัสที่ไม่อยู่ในรายการหลัก จะไม่ถูกนำเข้า: <b>${unmatched.map(i => esc(i.code) + (i.name ? ` (${esc(i.name)})` : '')).join(', ')}</b></div>` : ''}
    ${p.bad.length ? `<div class="warnbox">ช่องที่ไม่ใช่ตัวเลข ${p.bad.length} ช่อง จะถูกข้าม: ${p.bad.slice(0, 8).map(esc).join(' · ')}${p.bad.length > 8 ? ' …' : ''}</div>` : ''}
    <div class="grid2">
      <div class="field"><label class="lbl"><input type="checkbox" id="impU" checked> นำเข้ายอดใช้รายเดือน</label><div class="hint">ช่องว่างในเดือนที่มีในไฟล์ = ใช้ 0 · เดือนเดิมที่มีข้อมูลอยู่แล้วจะถูกแทนที่ด้วยค่าจากไฟล์นี้</div></div>
      <div class="field"><label class="lbl"><input type="checkbox" id="impS" ${p.hasStock ? 'checked' : 'disabled'}> นำเข้ายอดสต็อกคงเหลือ</label>
        <label for="impDate" class="hint" style="display:block">สต็อก ณ วันที่</label><input type="date" id="impDate" class="input" style="max-width:200px" value="${todayISO()}"></div>
    </div>`;
}

function previewOnhand(p, matched, unmatched) {
  const ui = IMP.oh = IMP.oh || { col: p.hasDated ? 'dated' : 'now', noExp: true, zero: true };
  const known = new Map(S.skus.map(s => [s.code, s]));
  const missing = S.skus.filter(s => s.is_tracked && !p.items.some(i => i.code === s.code));
  const unitDiff = matched.filter(i => i.unit && known.get(i.code).stock_unit && i.unit !== known.get(i.code).stock_unit);
  const exp = matched.filter(i => (ui.col === 'dated' ? i.expDated : i.expNow) > 0);
  const dateDefault = ui.col === 'dated' ? (p.datedDate || todayISO()) : (p.reportDate || todayISO());
  return `<div class="small muted" style="margin-bottom:14px">รายงานยอดยาคงคลัง <b>${esc(p.fileName)}</b> · ${p.branches.length} สาขา/คลัง (${p.branches.map(esc).join(', ')}) · รวมยอดทุกล็อตทุกสาขาเป็นยอดเดียวต่อ SKU</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:14px">
      <div class="kpi" style="padding:12px 14px"><div class="v" style="font-size:22px;color:#1f7a55">${matched.length}</div><div class="h2">SKU ที่จับคู่ได้</div></div>
      <div class="kpi" style="padding:12px 14px"><div class="v" style="font-size:22px">${unmatched.length}</div><div class="h2">รายการอื่นที่ไม่ได้ติดตาม (ข้าม)</div></div>
      <div class="kpi" style="padding:12px 14px"><div class="v" style="font-size:22px">${missing.length}</div><div class="h2">SKU ที่ติดตามแต่ไม่มีในรายงาน</div></div>
    </div>
    <div class="field"><span class="lbl" style="display:block">ใช้ยอดคงคลังคอลัมน์ไหน</span>
      ${p.hasDated ? `<label class="lbl" style="font-weight:400"><input type="radio" name="ohCol" value="dated" ${ui.col === 'dated' ? 'checked' : ''}> ยอด ณ วันที่ ${dLabel(p.datedDate)} (วันที่เลือกในรายงาน)</label>` : ''}
      ${p.hasNow ? `<label class="lbl" style="font-weight:400"><input type="radio" name="ohCol" value="now" ${ui.col === 'now' ? 'checked' : ''}> ยอดปัจจุบัน ณ เวลาออกรายงาน${p.reportDate ? ` (${dLabel(p.reportDate)})` : ''}</label>` : ''}</div>
    <div class="grid2">
      <div class="field"><label for="impDate" class="lbl">บันทึกเป็นสต็อก ณ วันที่</label><input type="date" id="impDate" class="input" style="max-width:200px" value="${dateDefault}"></div>
      <div class="field"><label class="lbl" style="font-weight:400"><input type="checkbox" id="ohNoExp" ${ui.noExp ? 'checked' : ''}> ไม่นับล็อตที่หมดอายุแล้ว${exp.length ? ` (มี ${exp.length} SKU)` : ' (ไม่มีล็อตหมดอายุ)'}</label>
        <label class="lbl" style="font-weight:400"><input type="checkbox" id="ohZero" ${ui.zero ? 'checked' : ''}> SKU ที่ติดตามแต่ไม่มีในรายงาน บันทึกเป็น 0</label>
        ${missing.length ? `<div class="hint">${missing.map(s => esc(s.code)).join(', ')}</div>` : ''}</div>
    </div>
    ${unitDiff.length ? `<div class="warnbox">หน่วยในรายงานไม่ตรงกับหน่วยในรายการหลัก ${unitDiff.length} รายการ — ตรวจก่อนนำเข้า: ${unitDiff.map(i => `${esc(i.code)} (รายงาน: ${esc(i.unit)} / ระบบ: ${esc(known.get(i.code).stock_unit)})`).join(', ')}</div>` : ''}
    ${p.bad.length ? `<div class="warnbox">ช่องที่ไม่ใช่ตัวเลข ${p.bad.length} ช่อง จะถูกข้าม: ${p.bad.slice(0, 8).map(esc).join(' · ')}${p.bad.length > 8 ? ' …' : ''}</div>` : ''}
    <details style="margin-bottom:12px"><summary class="small" style="cursor:pointer">ดูยอดที่จะบันทึก (${matched.length} รายการ)</summary>
      <div style="max-height:320px;overflow:auto;margin-top:8px"><table class="t"><thead><tr><th>รหัส</th><th>ชื่อ</th><th class="r">ยอดรวม</th><th>หน่วย</th><th class="r">ล็อต</th></tr></thead><tbody>
      ${matched.map(i => { const q = (ui.col === 'dated' ? i.dated : i.now) - (ui.noExp ? (ui.col === 'dated' ? i.expDated : i.expNow) : 0); return `<tr><td>${esc(i.code)}</td><td>${esc(i.name)}</td><td class="r">${q2(q)}</td><td>${esc(i.unit)}</td><td class="r">${i.lots}</td></tr>`; }).join('')}
      </tbody></table></div></details>
    ${unmatched.length ? `<details style="margin-bottom:12px"><summary class="small muted" style="cursor:pointer">รายการที่ไม่ได้ติดตาม ${unmatched.length} รายการ (จะไม่ถูกนำเข้า — ถ้าต้องการติดตาม ให้เพิ่มในหน้ารายการหลักก่อน)</summary>
      <div class="small muted" style="margin-top:6px;line-height:1.7">${unmatched.map(i => `${esc(i.code)} ${esc(i.name)}`).join(' · ')}</div></details>` : ''}`;
}

function movementTotals(p) {
  const on = IMP.mv.types;
  return p.items.map(i => { let t = 0; Object.entries(i.cells).forEach(([k, v]) => { if (on[k.split('|')[1]]) t += v; }); return Object.assign({}, i, { total: t }); });
}
function previewMovement(p, matched, unmatched) {
  const ui = IMP.mv = IMP.mv || { types: Object.fromEntries(p.types.map(t => [t.type, true])) };
  const known = new Set(matched.map(i => i.code));
  const tot = movementTotals(p).filter(i => known.has(i.code)).sort((a, b) => a.code.localeCompare(b.code));
  const ranges = (S.imports || []).concat([{ date_from: p.from, date_to: p.to }]);
  const notes = monthsBetween(p.from, p.to).map(m => {
    const thr = coveredThrough(m, ranges);
    return thr ? `<li>${mLabel(m)}: มีข้อมูลรายวันต่อเนื่อง 1 – ${Number(thr.slice(8))} ${TH_M[+m.slice(5, 7) - 1]} → ยอดเดือนนี้จะคำนวณจากข้อมูลรายวัน</li>`
      : `<li style="color:#8a5410">${mLabel(m)}: ยังไม่มีข้อมูลรายวันตั้งแต่วันที่ 1 → ระบบจะเก็บยอดรายวันไว้ แต่ยอดรวมของเดือนยังใช้ค่าเดิม จนกว่าจะนำเข้าไฟล์เคลื่อนไหวที่เริ่มตั้งแต่วันที่ 1 ${TH_M[+m.slice(5, 7) - 1]}</li>`;
  }).join('');
  return `<div class="small muted" style="margin-bottom:14px">รายงานสต็อกเคลื่อนไหว <b>${esc(p.fileName)}</b> · ช่วง <b>${dLabel(p.from)} – ${dLabel(p.to)}</b> · ${fmt(p.tx)} รายการ · ${p.branches.length} สาขา/คลัง</div>
    <div class="info" style="font-size:12.5px">🔒 ไฟล์นี้มีชื่อผู้ป่วย — เว็บอ่านไฟล์ในเครื่องของคุณ และบันทึกเฉพาะ <b>ยอดใช้รวมต่อ SKU ต่อวัน</b> ไม่ได้ส่งชื่อผู้ป่วยหรือรายละเอียดรายการขึ้นระบบ</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:14px">
      <div class="kpi" style="padding:12px 14px"><div class="v" style="font-size:22px;color:#1f7a55">${matched.length}</div><div class="h2">SKU ที่จับคู่ได้</div></div>
      <div class="kpi" style="padding:12px 14px"><div class="v" style="font-size:22px">${unmatched.length}</div><div class="h2">รายการอื่นที่ไม่ได้ติดตาม (ข้าม)</div></div>
    </div>
    <div class="field"><span class="lbl" style="display:block">นับเป็นยอดใช้</span>
      ${p.types.map(t => `<label class="lbl" style="font-weight:400"><input type="checkbox" data-mvt="${esc(t.type)}" ${ui.types[t.type] ? 'checked' : ''}> ${esc(t.type)} <span class="muted">(${fmt(t.n)} รายการ)</span></label>`).join('')}</div>
    <div class="warnbox" style="background:#f7fafc;border-color:#cdddea;color:#003049"><b>ผลต่อยอดรายเดือน</b><ul style="margin:6px 0 0;padding-left:18px">${notes}</ul>
      <div class="small" style="margin-top:6px">นำเข้าช่วงเดิมซ้ำได้ — ระบบจะแทนที่ข้อมูลของวันที่อยู่ในช่วงนั้นทั้งหมด ไม่นับซ้ำ</div></div>
    ${p.bad.length ? `<div class="warnbox">ช่องที่ไม่ใช่ตัวเลข ${p.bad.length} ช่อง จะถูกข้าม: ${p.bad.slice(0, 8).map(esc).join(' · ')}${p.bad.length > 8 ? ' …' : ''}</div>` : ''}
    <details style="margin-bottom:12px"><summary class="small" style="cursor:pointer">ดูยอดใช้รวมในช่วงนี้ (${tot.length} รายการ)</summary>
      <div style="max-height:320px;overflow:auto;margin-top:8px"><table class="t"><thead><tr><th>รหัส</th><th>ชื่อ</th><th class="r">ยอดใช้รวม</th><th>หน่วย</th></tr></thead><tbody>
      ${tot.map(i => `<tr><td>${esc(i.code)}</td><td>${esc(i.name)}</td><td class="r">${q2(i.total)}</td><td>${esc(i.unit)}</td></tr>`).join('')}</tbody></table></div></details>
    ${unmatched.length ? `<details style="margin-bottom:12px"><summary class="small muted" style="cursor:pointer">รายการที่ไม่ได้ติดตาม ${unmatched.length} รายการ (จะไม่ถูกนำเข้า)</summary>
      <div class="small muted" style="margin-top:6px;line-height:1.7">${unmatched.map(i => `${esc(i.code)} ${esc(i.name)}`).join(' · ')}</div></details>` : ''}`;
}

VIEWS.import = {
  html() {
    const p = IMP.parsed;
    let preview = '';
    if (p) {
      const known = new Set(S.skus.map(s => s.code));
      const matched = p.items.filter(i => known.has(i.code)), unmatched = p.items.filter(i => !known.has(i.code));
      const body = p.kind === 'plan' ? previewPlan(p, matched, unmatched) : p.kind === 'onhand' ? previewOnhand(p, matched, unmatched) : previewMovement(p, matched, unmatched);
      preview = `<div class="card pad" style="margin-top:16px"><div class="title" style="margin-bottom:12px">ตรวจสอบก่อนนำเข้า</div>${body}
        ${IMP.err ? `<div class="err">${esc(IMP.err)}</div>` : ''}
        <div class="actions"><button class="btn ghost" id="impReset">เลือกไฟล์ใหม่</button><button class="btn" id="impGo" ${IMP.busy || !matched.length ? 'disabled' : ''}>${IMP.busy ? 'กำลังนำเข้า…' : `ยืนยันนำเข้า ${matched.length} รายการ`}</button></div>
      </div>`;
    }
    const lastImp = (S.imports || []).reduce((a, r) => !a || r.date_to > a ? r.date_to : a, null);
    return `<div class="pagehead"><div><h1>นำเข้าข้อมูลคลัง</h1><div class="sub">อัปโหลดไฟล์ที่ export จากระบบ (CSV หรือ Excel) — ระบบจับคู่ตามรหัส SKU และอัปเดตเฉพาะรายการในรายการหลัก</div></div></div>
      ${IMP.done ? `<div class="ok">${esc(IMP.done)}</div>` : ''}
      <div class="info">ข้อมูลปัจจุบัน: สต็อก ณ <b>${dLabel(S.stockDate)}</b> · ยอดใช้รายวันถึง <b>${lastImp ? dLabel(lastImp) : 'ยังไม่มี'}</b>
        <br>รองรับ:
        <br>① <b>รายงานสต็อกเคลื่อนไหว</b> (stock_movement_report) → ยอดใช้
        <br>② <b>ยอดยาคงคลัง - รายตำแหน่งเก็บ</b> (stock_location_report) → ยอดสต็อกคงเหลือ
        <br>③ ไฟล์ stock plan (Excel) → ยอดใช้รายเดือนย้อนหลัง</div>
      <label class="drop" for="impFile"><div style="font-size:28px">⭳</div><div style="font-weight:600;margin:4px 0">เลือกไฟล์ (.csv หรือ .xlsx)</div><div class="small muted">${IMP.file ? esc(IMP.file) : 'คลิกเพื่อเลือกไฟล์ — นำเข้าทีละไฟล์'}</div></label>
      <input type="file" id="impFile" accept=".csv,.xlsx,.xls" style="position:absolute;width:1px;height:1px;opacity:0">
      ${IMP.err && !p ? `<div class="err" style="margin-top:14px">${esc(IMP.err)}</div>` : ''}
      ${preview}`;
  },
  bind() {
    if (!S.imports && !IMP.loadingImports) { IMP.loadingImports = true; loadImports().then(render).catch(() => {}).finally(() => { IMP.loadingImports = false; }); }
    $('#impFile').onchange = async e => {
      const f = e.target.files[0]; if (!f) return;
      Object.assign(IMP, { file: f.name, err: null, done: null, parsed: null, oh: null, mv: null });
      try { IMP.parsed = await parseFile(f); } catch (er) { IMP.err = er.message || String(er); }
      e.target.value = '';
      render();
    };
    $$('input[name=ohCol]').forEach(r => r.onchange = () => { IMP.oh.col = r.value; render(); });
    const ne = $('#ohNoExp'); if (ne) ne.onchange = () => { IMP.oh.noExp = ne.checked; render(); };
    const z = $('#ohZero'); if (z) z.onchange = () => { IMP.oh.zero = z.checked; };
    $$('[data-mvt]').forEach(c => c.onchange = () => { IMP.mv.types[c.dataset.mvt] = c.checked; render(); });
    const rs = $('#impReset'); if (rs) rs.onclick = () => { Object.assign(IMP, { file: null, parsed: null, err: null, done: null, oh: null, mv: null }); render(); };
    const go = $('#impGo'); if (go) go.onclick = () => runImport();
  },
};

async function upsertChunks(table, rows, onConflict) {
  for (let k = 0; k < rows.length; k += 500) { const { error } = await sb.from(table).upsert(rows.slice(k, k + 500), { onConflict }); if (error) throw error; }
}

async function importMovement(p, now) {
  const known = new Set(S.skus.map(s => s.code));
  const on = IMP.mv.types, daily = new Map();
  p.items.filter(i => known.has(i.code)).forEach(i => Object.entries(i.cells).forEach(([k, v]) => {
    const [day, type] = k.split('|'); if (!on[type]) return;
    const key = i.code + '|' + day; daily.set(key, (daily.get(key) || 0) + v);
  }));
  // replace the whole date range, so re-importing the same period never double-counts
  { const { error } = await sb.from('stock_usage_daily').delete().gte('day', p.from).lte('day', p.to); if (error) throw error; }
  const rows = [...daily.entries()].filter(([, v]) => Math.abs(v) > 1e-9).map(([k, v]) => { const [sku_code, day] = k.split('|'); return { sku_code, day, qty: Math.round(v * 10000) / 10000, source_file: p.fileName, imported_at: now }; });
  await upsertChunks('stock_usage_daily', rows, 'sku_code,day');
  { const { error } = await sb.from('stock_usage_imports').insert({ date_from: p.from, date_to: p.to, source_file: p.fileName, types: Object.keys(on).filter(t => on[t]) }); if (error) throw error; }
  // recompute monthly totals for every touched month that daily data covers from the 1st
  const ranges = await loadImports(); const updated = [], kept = [];
  for (const m of monthsBetween(p.from, p.to)) {
    const thr = coveredThrough(m, ranges);
    if (!thr) { kept.push(m); continue; }
    const { data, error } = await sb.from('stock_usage_daily').select('sku_code,qty').gte('day', m).lte('day', monthEnd(m));
    if (error) throw error;
    const sum = {}; (data || []).forEach(r => { sum[r.sku_code] = (sum[r.sku_code] || 0) + Number(r.qty); });
    const mrows = S.skus.filter(s => s.is_tracked || sum[s.code]).map(s => ({ sku_code: s.code, month: m, qty: Math.round((sum[s.code] || 0) * 10000) / 10000, source_file: `รายวัน 1–${Number(thr.slice(8))} ${TH_M[+m.slice(5, 7) - 1]}`, imported_at: now }));
    await upsertChunks('stock_monthly_usage', mrows, 'sku_code,month');
    updated.push(`${mLabel(m)} (ข้อมูลถึง ${Number(thr.slice(8))} ${TH_M[+m.slice(5, 7) - 1]})`);
  }
  return `✓ บันทึกยอดใช้รายวัน ${rows.length} แถว ช่วง ${dLabel(p.from)} – ${dLabel(p.to)}`
    + (updated.length ? ` · อัปเดตยอดรายเดือน: ${updated.join(', ')}` : '')
    + (kept.length ? ` · ${kept.map(mLabel).join(', ')} ยังใช้ยอดเดือนเดิม เพราะยังไม่มีข้อมูลรายวันตั้งแต่วันที่ 1 — นำเข้าไฟล์เคลื่อนไหวตั้งแต่วันที่ 1 ของเดือนเพื่อให้ยอดเดือนนี้อัปเดต` : '');
}

async function runImport() {
  const p = IMP.parsed, known = new Set(S.skus.map(s => s.code));
  const asOf = $('#impDate') ? $('#impDate').value : '';
  const now = new Date().toISOString();
  const items = p.items.filter(i => known.has(i.code));
  let doU = false, doS = false;
  if (p.kind === 'plan') { doU = $('#impU').checked; doS = $('#impS') && $('#impS').checked && p.hasStock; }
  if (p.kind === 'onhand') doS = true;
  if (p.kind === 'movement' && !Object.values(IMP.mv.types).some(Boolean)) { IMP.err = 'เลือกประเภทรายการที่จะนับเป็นยอดใช้อย่างน้อย 1 ประเภท'; return render(); }
  if (doS && !/^\d{4}-\d{2}-\d{2}$/.test(asOf)) { IMP.err = 'กรุณาระบุวันที่ของยอดสต็อก'; return render(); }
  if (p.kind === 'plan' && !doU && !doS) { IMP.err = 'เลือกอย่างน้อย 1 อย่างที่จะนำเข้า'; return render(); }
  IMP.busy = true; IMP.err = null; render();
  try {
    if (p.kind === 'movement') IMP.done = await importMovement(p, now);
    else {
      let nU = 0, sRows = [];
      if (doU) {
        const rows = []; items.forEach(i => i.usage.forEach(u => rows.push({ sku_code: i.code, month: u.month, qty: u.qty == null ? 0 : u.qty, source_file: p.fileName, imported_at: now })));
        await upsertChunks('stock_monthly_usage', rows, 'sku_code,month'); nU = rows.length;
      }
      if (doS && p.kind === 'plan') sRows = items.filter(i => i.stock != null).map(i => ({ sku_code: i.code, as_of: asOf, qty: i.stock, source_file: p.fileName, imported_at: now }));
      if (doS && p.kind === 'onhand') {
        const ui = IMP.oh;
        sRows = items.map(i => ({ sku_code: i.code, as_of: asOf, qty: Math.round(((ui.col === 'dated' ? i.dated : i.now) - (ui.noExp ? (ui.col === 'dated' ? i.expDated : i.expNow) : 0)) * 10000) / 10000, source_file: p.fileName, imported_at: now }));
        if (ui.zero) S.skus.filter(s => s.is_tracked && !p.items.some(i => i.code === s.code)).forEach(s => sRows.push({ sku_code: s.code, as_of: asOf, qty: 0, source_file: p.fileName, imported_at: now }));
      }
      if (sRows.length) await upsertChunks('stock_onhand', sRows, 'sku_code,as_of');
      IMP.done = `✓ นำเข้าเรียบร้อย — ${doU ? `ยอดใช้ ${nU} แถว · ` : ''}${doS ? `สต็อก ${sRows.length} รายการ ณ ${dLabel(asOf)} ` : ''}จากไฟล์ ${p.fileName}`;
    }
    Object.assign(IMP, { parsed: null, file: null, oh: null, mv: null, busy: false });
    await loadData(true);
  } catch (e) { IMP.busy = false; IMP.err = 'นำเข้าไม่สำเร็จ: ' + errMsg(e) + ' (ข้อมูลบางส่วนอาจถูกบันทึกแล้ว — นำเข้าไฟล์เดิมซ้ำได้อย่างปลอดภัย)'; render(); }
}
