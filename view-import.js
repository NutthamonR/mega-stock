/* Import monthly usage + on-hand stock from the stock plan workbook */
'use strict';
const IMP = { file: null, parsed: null, err: null, busy: false, done: null };

function parseWorkbook(buf, fileName) {
  const wb = XLSX.read(buf, { type: 'array' });
  const order = [...wb.SheetNames].sort((a, b) => (/AllBranch|รวม/.test(b) ? 1 : 0) - (/AllBranch|รวม/.test(a) ? 1 : 0));
  for (const name of order) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: null });
    let hr = -1, codeCol = -1;
    for (let r = 0; r < Math.min(rows.length, 20) && hr < 0; r++) (rows[r] || []).forEach((c, i) => { if (hr < 0 && String(c ?? '').trim() === 'รหัสยา') { hr = r; codeCol = i; } });
    if (hr < 0) continue;
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
    if (!cols.length) continue;
    const items = [], bad = [];
    for (let r = hr + 1; r < rows.length; r++) {
      const row = rows[r] || []; const code = String(row[codeCol] ?? '').trim();
      if (!code) continue;
      const cell = (v, where) => { if (v == null || v === '') return null; if (typeof v === 'number') return v; const n = Number(String(v).replace(/,/g, '').trim()); if (isFinite(n)) return n; bad.push(`${code} · ${where}: "${v}"`); return null; };
      const usage = cols.map(m => ({ month: m.month, qty: cell(row[m.c], mLabel(m.month)) }));
      const stock = stockCol >= 0 ? cell(row[stockCol], 'Stock') : null;
      items.push({ code, name: nameCol >= 0 ? String(row[nameCol] ?? '').trim() : '', usage, stock });
    }
    return { fileName, sheet: name, months: cols.map(c => c.month), hasStock: stockCol >= 0, items, bad };
  }
  throw new Error('ไม่พบตารางที่มีหัวคอลัมน์ "รหัสยา" และคอลัมน์เดือน (ม.ค. … ธ.ค.) ในไฟล์นี้');
}

VIEWS.import = {
  html() {
    const p = IMP.parsed;
    let preview = '';
    if (p) {
      const known = new Set(S.skus.map(s => s.code));
      const matched = p.items.filter(i => known.has(i.code)), unmatched = p.items.filter(i => !known.has(i.code));
      const withStock = matched.filter(i => i.stock != null).length;
      const partial = p.months[p.months.length - 1] >= thisMonthISO();
      preview = `<div class="card pad" style="margin-top:16px">
        <div class="title" style="margin-bottom:12px">ตรวจสอบก่อนนำเข้า</div>
        <div class="small muted" style="margin-bottom:14px">ไฟล์ <b>${esc(p.fileName)}</b> · ชีต "${esc(p.sheet)}" · ยอดใช้ ${p.months.length} เดือน (${mLabel(p.months[0])} – ${mLabel(p.months[p.months.length - 1])})${partial ? ' · เดือนล่าสุดยังไม่ครบเดือน ระบบจะไม่นำไปคิดค่าเฉลี่ย' : ''}</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:14px">
          <div class="kpi" style="padding:12px 14px"><div class="v" style="font-size:22px;color:#1f7a55">${matched.length}</div><div class="h2">SKU ที่จับคู่ได้</div></div>
          <div class="kpi" style="padding:12px 14px"><div class="v" style="font-size:22px;color:${unmatched.length ? '#8a5410' : '#142433'}">${unmatched.length}</div><div class="h2">ไม่อยู่ในรายการหลัก (ข้าม)</div></div>
          <div class="kpi" style="padding:12px 14px"><div class="v" style="font-size:22px">${withStock}</div><div class="h2">มียอดสต็อก</div></div>
          <div class="kpi" style="padding:12px 14px"><div class="v" style="font-size:22px">${matched.length * p.months.length}</div><div class="h2">แถวยอดใช้ที่จะบันทึก</div></div>
        </div>
        ${unmatched.length ? `<div class="warnbox">รหัสที่ไม่อยู่ในรายการหลัก จะไม่ถูกนำเข้า: <b>${unmatched.map(i => esc(i.code) + (i.name ? ` (${esc(i.name)})` : '')).join(', ')}</b> — ถ้าต้องการติดตาม ให้เพิ่มในหน้า <a href="#sku">รายการหลัก (SKU)</a> ก่อน แล้วเลือกไฟล์ใหม่อีกครั้ง</div>` : ''}
        ${p.bad.length ? `<div class="warnbox">ช่องที่ไม่ใช่ตัวเลข ${p.bad.length} ช่อง จะถูกข้าม: ${p.bad.slice(0, 8).map(esc).join(' · ')}${p.bad.length > 8 ? ' …' : ''}</div>` : ''}
        <div class="grid2">
          <div class="field"><label class="lbl"><input type="checkbox" id="impU" checked style="accent-color:#003049"> นำเข้ายอดใช้รายเดือน</label><div class="hint">ช่องว่างในเดือนที่มีในไฟล์ = ใช้ 0 · เดือนเดิมที่มีข้อมูลอยู่แล้วจะถูกแทนที่ด้วยค่าจากไฟล์นี้</div></div>
          <div class="field"><label class="lbl"><input type="checkbox" id="impS" ${p.hasStock ? 'checked' : 'disabled'} style="accent-color:#003049"> นำเข้ายอดสต็อกคงเหลือ</label>
            <label for="impDate" class="hint" style="display:block">สต็อก ณ วันที่</label><input type="date" id="impDate" class="input" style="max-width:200px" value="${todayISO()}"></div>
        </div>
        ${IMP.err ? `<div class="err">${esc(IMP.err)}</div>` : ''}
        <div class="actions"><button class="btn ghost" id="impReset">เลือกไฟล์ใหม่</button><button class="btn" id="impGo" ${IMP.busy || !matched.length ? 'disabled' : ''}>${IMP.busy ? 'กำลังนำเข้า…' : `ยืนยันนำเข้า ${matched.length} รายการ`}</button></div>
      </div>`;
    }
    return `<div class="pagehead"><div><h1>นำเข้าข้อมูลคลัง</h1><div class="sub">อัปโหลดไฟล์ stock plan (ชีตสรุปยอดใช้รวมทุกสาขา) ระบบจะจับคู่ตามรหัส SKU และอัปเดตเฉพาะรายการในรายการหลัก</div></div></div>
      ${IMP.done ? `<div class="ok">${esc(IMP.done)}</div>` : ''}
      <div class="info">ข้อมูลปัจจุบัน: สต็อก ณ <b>${dLabel(S.stockDate)}</b> · ยอดใช้ถึง <b>${S.months.length ? mLabel(S.months[S.months.length - 1]) : '—'}</b>
        <br>รูปแบบไฟล์ที่รองรับ: หัวตารางมีคอลัมน์ <b>รหัสยา</b>, คอลัมน์เดือน <b>ม.ค. … ธ.ค.</b> (แถวบนระบุปี เช่น 2025, 2026 หรือหัวคอลัมน์แบบ ต.ค.26) และคอลัมน์ <b>Stock</b></div>
      <label class="drop" for="impFile"><div style="font-size:28px">⭳</div><div style="font-weight:600;margin:4px 0">เลือกไฟล์ Excel (.xlsx)</div><div class="small muted">${IMP.file ? esc(IMP.file) : 'คลิกเพื่อเลือกไฟล์'}</div></label>
      <input type="file" id="impFile" accept=".xlsx,.xls" style="position:absolute;width:1px;height:1px;opacity:0">
      ${IMP.err && !p ? `<div class="err" style="margin-top:14px">${esc(IMP.err)}</div>` : ''}
      ${preview}`;
  },
  bind() {
    $('#impFile').onchange = async e => {
      const f = e.target.files[0]; if (!f) return;
      IMP.file = f.name; IMP.err = null; IMP.done = null; IMP.parsed = null;
      try {
        if (!window.XLSX) throw new Error('ตัวอ่านไฟล์ Excel ยังโหลดไม่เสร็จ — ลองใหม่อีกครั้ง');
        IMP.parsed = parseWorkbook(await f.arrayBuffer(), f.name);
      } catch (er) { IMP.err = er.message || String(er); }
      render();
    };
    const rs = $('#impReset'); if (rs) rs.onclick = () => { Object.assign(IMP, { file: null, parsed: null, err: null, done: null }); render(); };
    const go = $('#impGo'); if (go) go.onclick = () => runImport();
  },
};

async function runImport() {
  const p = IMP.parsed, known = new Set(S.skus.map(s => s.code));
  const doU = $('#impU').checked, doS = $('#impS') && $('#impS').checked && p.hasStock, asOf = $('#impDate').value;
  if (doS && !/^\d{4}-\d{2}-\d{2}$/.test(asOf)) { IMP.err = 'กรุณาระบุวันที่ของยอดสต็อก'; return render(); }
  if (!doU && !doS) { IMP.err = 'เลือกอย่างน้อย 1 อย่างที่จะนำเข้า'; return render(); }
  IMP.busy = true; IMP.err = null; render();
  const items = p.items.filter(i => known.has(i.code));
  try {
    let nU = 0, nS = 0;
    if (doU) {
      const rows = []; items.forEach(i => i.usage.forEach(u => rows.push({ sku_code: i.code, month: u.month, qty: u.qty == null ? 0 : u.qty, source_file: p.fileName, imported_at: new Date().toISOString() })));
      for (let k = 0; k < rows.length; k += 500) { const { error } = await sb.from('stock_monthly_usage').upsert(rows.slice(k, k + 500), { onConflict: 'sku_code,month' }); if (error) throw error; }
      nU = rows.length;
    }
    if (doS) {
      const rows = items.filter(i => i.stock != null).map(i => ({ sku_code: i.code, as_of: asOf, qty: i.stock, source_file: p.fileName, imported_at: new Date().toISOString() }));
      if (rows.length) { const { error } = await sb.from('stock_onhand').upsert(rows, { onConflict: 'sku_code,as_of' }); if (error) throw error; }
      nS = rows.length;
    }
    IMP.done = `✓ นำเข้าเรียบร้อย — ยอดใช้ ${nU} แถว${doS ? ` · สต็อก ${nS} รายการ ณ ${dLabel(asOf)}` : ''} จากไฟล์ ${p.fileName}`;
    IMP.parsed = null; IMP.file = null;
    IMP.busy = false; await loadData(true);
  } catch (e) { IMP.busy = false; IMP.err = 'นำเข้าไม่สำเร็จ: ' + errMsg(e) + ' (ข้อมูลบางส่วนอาจถูกบันทึกแล้ว — นำเข้าไฟล์เดิมซ้ำได้อย่างปลอดภัย)'; render(); }
}
