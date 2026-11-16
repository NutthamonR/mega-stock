/* Promotion order calculator + PNG export */
'use strict';
const P = { code: '', stock: '', avg: '', perBox: '1', po: '', opts: [{ packs: '', total: '' }, { packs: '', total: '' }] };
window.promoPick = function (code) {
  const sku = S.skus.find(s => s.code === code);
  if (!sku) { P.code = ''; return; }
  const it = computeItem(sku);
  P.code = code; P.stock = it.stock == null ? '' : String(it.stock); P.avg = String(Math.round(it.avg3 * 100) / 100);
  P.perBox = sku.units_per_purchase ? String(Number(sku.units_per_purchase)) : '1';
};

function promoCalc() {
  const sku = S.skus.find(s => s.code === P.code), it = sku ? computeItem(sku) : null, st = settings();
  const unit = (sku && sku.stock_unit) || 'หน่วย', pack = (sku && sku.purchase_unit) || 'กล่อง';
  const stock = num(P.stock), avg = num(P.avg), perBox = num(P.perBox) || 1, po = num(P.po);
  const monthsNow = avg > 0 ? stock / avg : null;
  const calc = P.opts.map((o, i) => {
    const packs = num(o.packs), total = num(o.total), units = packs * perBox;
    const cpu = units > 0 && total > 0 ? total / units : null;
    const after = stock + units, mAfter = avg > 0 ? after / avg : null;
    const diff = cpu != null && po > 0 ? cpu - po : null;
    return { i, letter: 'ABCD'[i], packs, total, units, cpu, after, mAfter, diff, pct: diff != null ? diff / po * 100 : null, save: diff != null ? -diff * units : null };
  });
  const valid = calc.filter(c => c.cpu != null);
  let best = null, worst = null;
  if (valid.length > 1) { best = valid.reduce((a, b) => b.cpu < a.cpu ? b : a); worst = valid.reduce((a, b) => b.cpu > a.cpu ? b : a); if (best.cpu === worst.cpu) best = null; }
  const mColor = m => m == null ? '#5f6b64' : m < st.warn ? '#a4161a' : m < st.warn + 1.5 ? '#8a5410' : '#1f7a55';
  const mText = m => m == null ? '—' : m.toFixed(1) + ' เดือน';
  const sign = (n, d) => (n > 0 ? '+' : n < 0 ? '−' : '') + fmt(Math.abs(n), d);
  const upDown = n => n > 0 ? '#a4161a' : n < 0 ? '#1f7a55' : '#142433';
  const optName = c => `${q2(c.packs)} ${pack} (${q2(c.units)} ${unit})`;
  const dash = { text: '—', color: '#5f6b64' };
  const isBest = c => !!best && c.i === best.i;
  const head = calc.map(c => ({ title: 'ตัวเลือก ' + c.letter, sub: optName(c), best: isBest(c) }));
  const sec = label => ({ label, section: true });
  const row = (label, fn, strong) => ({ label, strong, cells: calc.map(c => Object.assign({ color: '#142433' }, fn(c))) });
  const rows = [
    sec('การสั่งซื้อ'),
    row('ราคาสั่งซื้อรวม (บาท)', c => c.total ? { text: fmt(c.total, c.total % 1 ? 2 : 0) } : dash),
    row(`จำนวนสั่งซื้อ (${unit})`, c => c.units ? { text: q2(c.units) + ' ' + unit } : dash),
    row(`ต้นทุนต่อ ${unit} (บาท)`, c => c.cpu != null ? { text: fmt(c.cpu, 2) } : dash, true),
    sec('ความครอบคลุมสต็อก'),
    row(`สต็อกคงเหลือ (${unit})`, () => ({ text: q2(stock) + ' ' + unit })),
    row(`ยอดใช้เฉลี่ยต่อเดือน (${unit})`, () => avg > 0 ? { text: q2(avg) + ' ' + unit } : dash),
    row('สต็อกปัจจุบันใช้ได้อีก', () => ({ text: mText(monthsNow), color: mColor(monthsNow) })),
    row(`สต็อกรวมหลังสั่งซื้อ (${unit})`, c => ({ text: q2(c.after) + ' ' + unit })),
    row('ใช้ได้อีกหลังสั่งซื้อ', c => ({ text: mText(c.mAfter), color: mColor(c.mAfter) }), true),
    sec('เทียบราคา PO ล่าสุด'),
    row(`ราคา PO ล่าสุด (บาท/${unit})`, () => po > 0 ? { text: fmt(po, 2) } : dash),
    row(`ราคาใหม่ต่อ ${unit} (บาท)`, c => c.cpu != null ? { text: fmt(c.cpu, 2) } : dash),
    row('ราคาปรับขึ้น / (ลง)', c => c.diff != null ? { text: sign(c.diff, 2) + ' บาท/' + unit, color: upDown(c.diff) } : dash),
    row('% ราคาปรับขึ้น / (ลง)', c => c.pct != null ? { text: sign(c.pct, 2) + '%', color: upDown(c.pct) } : dash),
    row('ประหยัด / (จ่ายเพิ่ม) รวม (บาท)', c => c.save != null ? { text: c.save >= 0 ? fmt(c.save, 2) : '(' + fmt(-c.save, 2) + ')', color: upDown(-c.save) } : dash, true),
  ];
  let sumTitle = '', sumBody = '';
  if (best) {
    sumTitle = `ตัวเลือก ${best.letter} · ${optName(best)} ต้นทุนต่อ ${unit} ต่ำสุด ${fmt(best.cpu, 2)} บาท`;
    const parts = [`ถูกกว่าตัวเลือก ${worst.letter} ${fmt(worst.cpu - best.cpu, 2)} บาท/${unit}`];
    if (best.total - worst.total > 0) parts.push(`แต่ใช้เงินมากกว่า ${fmt(best.total - worst.total, 0)} บาท`);
    if (best.mAfter != null) parts.push(`สต็อกพอใช้ ${best.mAfter.toFixed(1)} เดือนหลังสั่ง`);
    sumBody = parts.join(' · ');
  }
  const over = calc.filter(c => c.units > 0 && c.mAfter != null && c.mAfter > st.target);
  const overText = over.length ? `ตัวเลือก ${over.map(c => c.letter).join(', ')} ทำให้สต็อกเกินเป้า ${st.target} เดือน — ควรเช็กวันหมดอายุและเงินทุนที่จมในสต็อกก่อนตัดสินใจ` : '';
  const basis = `ข้อมูลที่ใช้คำนวณ: สต็อกคงเหลือ ${q2(stock)} ${unit} · ยอดใช้เฉลี่ย ${q2(avg)} ${unit}/เดือน · ${q2(perBox)} ${unit}/${pack} · ราคา PO ล่าสุด ${po > 0 ? fmt(po, 2) + ' บาท/' + unit : 'ไม่ได้ระบุ'}`;
  return { sku, it, unit, pack, calc, head, rows, best, sumTitle, sumBody, overText, basis,
    title: sku ? sku.name : 'สินค้า (กรอกเอง)', sub: sku ? [sku.code, sku.supplier].filter(Boolean).join(' · ') : 'กรอกข้อมูลเอง' };
}

VIEWS.promo = {
  html() {
    if (!P.code && !P.stock && S.skus.length) { const j = S.skus.find(s => s.code === 'JVM-FL'); if (j) window.promoPick(j.code); }
    const r = promoCalc();
    const opts = S.skus.filter(s => s.is_tracked).sort((a, b) => a.name.localeCompare(b.name));
    const unitL = esc(r.unit), packL = esc(r.pack);
    const avgChips = r.it ? [['avg3', 'เฉลี่ย 3 ด.', r.it.avg3], ['avg6', 'เฉลี่ย 6 ด.', r.it.avg6]].map(([k, l, v]) =>
      `<button type="button" class="chip ${Math.abs(num(P.avg) - Math.round(v * 100) / 100) < 1e-9 ? 'on' : ''}" data-avg="${Math.round(v * 100) / 100}" style="padding:5px 11px;font-size:12px">${l} = ${q2(v)}</button>`).join('') : '';
    return `<div class="pagehead"><div><h1>คำนวณสั่งซื้อตามโปรโมชั่น</h1><div class="sub">เทียบหลายตัวเลือก — ต้นทุนต่อหน่วย, สต็อกพอใช้กี่เดือน และราคาเทียบ PO ล่าสุด</div></div>
        <button class="btn" id="pExport">🖼 บันทึกเป็นรูปภาพ</button></div>
      <div class="flex" style="gap:18px">
        <div style="flex:1 1 320px;max-width:420px;min-width:0;display:flex;flex-direction:column;gap:14px">
          <div class="card pad"><div class="title" style="margin-bottom:14px">ข้อมูลสินค้า</div>
            <div class="field"><label for="pSku">เลือกสินค้า</label><select id="pSku"><option value="">— กรอกเอง (ไม่เลือกจากคลัง) —</option>${opts.map(s => `<option value="${esc(s.code)}" ${s.code === P.code ? 'selected' : ''}>${esc(s.name)} · ${esc(s.code)}</option>`).join('')}</select></div>
            <div class="grid2"><div class="field"><label for="pStock">สต็อกคงเหลือ (${unitL})</label><input id="pStock" inputmode="decimal" value="${esc(P.stock)}"></div>
              <div class="field"><label for="pBox">${unitL} ต่อ 1 ${packL}</label><input id="pBox" inputmode="decimal" value="${esc(P.perBox)}"></div></div>
            <div class="field" style="margin-bottom:6px"><label for="pAvg">ยอดใช้เฉลี่ยต่อเดือน (${unitL})</label><input id="pAvg" inputmode="decimal" value="${esc(P.avg)}"></div>
            <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px">${avgChips}</div>
            <div class="field" style="margin:0"><label for="pPo">ราคา PO ล่าสุด (บาท/${unitL})</label><input id="pPo" inputmode="decimal" placeholder="เช่น 5322.50" value="${esc(P.po)}"></div>
          </div>
          <div class="card pad"><div class="title">ตัวเลือกโปรโมชั่น</div><div class="small muted" style="margin:4px 0 14px">ใส่จำนวน${packL}และราคารวมของแต่ละโปร (สูงสุด 4 ตัวเลือก)</div>
            ${r.calc.map((c, i) => `<div style="border:1px solid #e2e8e1;border-radius:12px;padding:12px 14px;margin-bottom:10px;background:#fbf8f1">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px"><b style="font-size:13.5px">ตัวเลือก ${c.letter}</b>${P.opts.length > 1 ? `<button type="button" class="linkbtn" data-rm="${i}" aria-label="ลบตัวเลือก ${c.letter}">ลบ</button>` : ''}</div>
              <div class="grid2"><div class="field" style="margin:0"><label for="pk${i}">จำนวน${packL}</label><input id="pk${i}" data-opt="${i}" data-k="packs" inputmode="decimal" value="${esc(P.opts[i].packs)}"></div>
                <div class="field" style="margin:0"><label for="pt${i}">ราคารวม (บาท)</label><input id="pt${i}" data-opt="${i}" data-k="total" inputmode="decimal" value="${esc(P.opts[i].total)}"></div></div>
              <div class="small" style="margin-top:8px;color:#46524c" id="note${i}">${c.units > 0 ? `= ${q2(c.units)} ${unitL}${c.cpu != null ? ` · ${fmt(c.cpu, 2)} บาท/${unitL}` : ''}` : 'กรอกจำนวนและราคารวม'}</div></div>`).join('')}
            ${P.opts.length < 4 ? `<button type="button" class="btn soft" id="pAdd" style="width:100%">+ เพิ่มตัวเลือก</button>` : ''}
          </div>
        </div>
        <div style="flex:999 1 560px;min-width:0;display:flex;flex-direction:column;gap:14px" id="pResult">${VIEWS.promo.resultHtml(r)}</div>
      </div>`;
  },
  resultHtml(r) {
    return `${r.best ? `<div class="ok" style="margin:0;font-size:13.5px;line-height:1.6;padding:14px 18px"><b>✓ ${esc(r.sumTitle)}</b><div>${esc(r.sumBody)}</div></div>` : ''}
      ${r.overText ? `<div class="warnbox" style="margin:0">⚠ ${esc(r.overText)}</div>` : ''}
      <div class="card" style="overflow:hidden"><div style="padding:15px 20px;border-bottom:1px solid #edf1ec" class="title">${esc(r.title)}</div>
        <div class="scroll"><table class="t" style="min-width:520px"><thead><tr><th>รายการ</th>${r.head.map(h => `<th class="r" style="vertical-align:top;${h.best ? 'background:#e1f1e8' : ''}"><div style="font-size:13px;color:#142433">${esc(h.title)}</div><div style="font-weight:500">${esc(h.sub)}</div>${h.best ? '<span class="status" style="background:#1f7a55;color:#fff;margin-top:5px;padding:2px 8px;font-size:11px">ต้นทุนต่ำสุด</span>' : ''}</th>`).join('')}</tr></thead>
        <tbody>${r.rows.map(x => x.section
          ? `<tr><td colspan="${r.head.length + 1}" style="background:#f2f6f9;color:#003049;font-weight:700;font-size:12px">${esc(x.label)}</td></tr>`
          : `<tr><td style="color:#46524c;${x.strong ? 'font-weight:600' : ''}">${esc(x.label)}</td>${x.cells.map((c, i) => `<td class="r" style="white-space:nowrap;color:${c.color};${x.strong ? 'font-weight:600;' : ''}${r.head[i].best ? 'background:#f3faf6' : ''}">${esc(c.text)}</td>`).join('')}</tr>`).join('')}</tbody></table></div></div>
      <div class="small muted">ใช้ได้อีก = สต็อก ÷ ยอดใช้เฉลี่ยต่อเดือน · ประหยัด/(จ่ายเพิ่ม) = (ราคา PO ล่าสุด − ราคาใหม่) × จำนวนที่สั่ง</div>`;
  },
  refresh() {
    const r = promoCalc();
    $('#pResult').innerHTML = VIEWS.promo.resultHtml(r);
    r.calc.forEach((c, i) => { const n = $('#note' + i); if (n) n.textContent = c.units > 0 ? `= ${q2(c.units)} ${r.unit}${c.cpu != null ? ` · ${fmt(c.cpu, 2)} บาท/${r.unit}` : ''}` : 'กรอกจำนวนและราคารวม'; });
  },
  bind() {
    $('#pSku').onchange = e => { if (e.target.value) window.promoPick(e.target.value); else P.code = ''; render(); };
    [['#pStock', 'stock'], ['#pBox', 'perBox'], ['#pAvg', 'avg'], ['#pPo', 'po']].forEach(([id, k]) => $(id).oninput = e => { P[k] = e.target.value; VIEWS.promo.refresh(); });
    $$('[data-opt]').forEach(el => el.oninput = () => { P.opts[+el.dataset.opt][el.dataset.k] = el.value; VIEWS.promo.refresh(); });
    $$('[data-avg]').forEach(b => b.onclick = () => { P.avg = b.dataset.avg; render(); });
    $$('[data-rm]').forEach(b => b.onclick = () => { P.opts.splice(+b.dataset.rm, 1); render(); });
    const add = $('#pAdd'); if (add) add.onclick = () => { P.opts.push({ packs: '', total: '' }); render(); };
    $('#pExport').onclick = () => promoExport();
  },
};

async function promoImage() {
  const p = promoCalc();
  const FF = '"IBM Plex Sans Thai", "Anuphan", system-ui, sans-serif';
  try { await Promise.all(['400', '600', '700'].map(w => document.fonts.load(`${w} 20px "IBM Plex Sans Thai"`, 'กขค'))); } catch (e) {}
  const W = 1200, SC = 2, PAD = 48, n = Math.max(p.head.length, 1), labelW = n > 2 ? 340 : 420, colW = (W - PAD * 2 - labelW) / n;
  const font = (w, s) => `${w} ${s}px ${FF}`;
  const segs = t => { try { return Array.from(new Intl.Segmenter('th', { granularity: 'word' }).segment(t), x => x.segment); } catch (e) { return t.split(/(\s+)/); } };
  const wrap = (ctx, text, maxW) => { const L = []; let cur = ''; for (const s of segs(text)) { const t = cur + s; if (ctx.measureText(t).width > maxW && cur.trim()) { L.push(cur.trim()); cur = s.trimStart(); } else cur = t; } if (cur.trim()) L.push(cur.trim()); return L; };
  const m = document.createElement('canvas').getContext('2d'), boxW = W - PAD * 2 - 48;
  m.font = font(700, 22); const sumT = p.sumTitle ? wrap(m, '✓ ' + p.sumTitle, boxW) : [];
  m.font = font(400, 18); const sumB = p.sumBody ? wrap(m, p.sumBody, boxW) : [];
  m.font = font(400, 17); const overL = p.overText ? wrap(m, '⚠ ' + p.overText, boxW) : [];
  m.font = font(400, 15); const basisL = wrap(m, p.basis, W - PAD * 2);
  const headerH = 168, sumH = sumT.length ? 24 + sumT.length * 32 + sumB.length * 28 + 18 : 0, overH = overL.length ? 18 + overL.length * 26 + 16 : 0;
  const thH = 96, rowsH = p.rows.reduce((a, r) => a + (r.section ? 42 : 48), 0), footH = 30 + basisL.length * 24 + 44;
  const H = headerH + 32 + (sumH ? sumH + 16 : 0) + (overH ? overH + 16 : 0) + thH + rowsH + 16 + footH;
  const cv = document.createElement('canvas'); cv.width = W * SC; cv.height = H * SC;
  const c = cv.getContext('2d'); c.scale(SC, SC);
  const rr = (x, y, w, h, r, fill, stroke) => { c.beginPath(); if (c.roundRect) c.roundRect(x, y, w, h, r); else c.rect(x, y, w, h); if (fill) { c.fillStyle = fill; c.fill(); } if (stroke) { c.strokeStyle = stroke; c.lineWidth = 1; c.stroke(); } };
  const txt = (t, x, y, f, col, al) => { c.font = f; c.fillStyle = col; c.textAlign = al || 'left'; c.textBaseline = 'alphabetic'; c.fillText(t, x, y); };
  c.fillStyle = '#f7f3ea'; c.fillRect(0, 0, W, H); c.fillStyle = '#003049'; c.fillRect(0, 0, W, headerH);
  rr(PAD, 34, 34, 34, 9, '#FDF0D5'); txt('M', PAD + 17, 58, font(700, 19), '#003049', 'center');
  txt('MEGA Clinic · เปรียบเทียบโปรโมชั่นสั่งซื้อ', PAD + 48, 58, font(600, 18), '#d5e4ee');
  txt('จัดทำ ' + dLabel(todayISO()), W - PAD, 58, font(400, 15), '#d5e4ee', 'right');
  txt(p.title, PAD, 114, font(700, 34), '#ffffff'); txt(p.sub, PAD, 146, font(400, 16), '#d5e4ee');
  let y = headerH + 32;
  if (sumH) { rr(PAD, y, W - PAD * 2, sumH, 14, '#e9f6ef', '#c4e6d3'); let ty = y + 44; sumT.forEach(l => { txt(l, PAD + 24, ty, font(700, 22), '#14523a'); ty += 32; }); sumB.forEach(l => { txt(l, PAD + 24, ty, font(400, 18), '#14523a'); ty += 28; }); y += sumH + 16; }
  if (overH) { rr(PAD, y, W - PAD * 2, overH, 14, '#fdf4e3', '#f1dcb3'); let ty = y + 37; overL.forEach(l => { txt(l, PAD + 24, ty, font(400, 17), '#6b4209'); ty += 26; }); y += overH + 16; }
  const tY = y, tH = thH + rowsH;
  c.save(); rr(PAD, tY, W - PAD * 2, tH, 16, '#ffffff'); c.clip();
  c.fillStyle = '#f6efe1'; c.fillRect(PAD, tY, W - PAD * 2, thH);
  p.head.forEach((h, i) => { if (!h.best) return; const x = PAD + labelW + i * colW; c.fillStyle = '#eef8f2'; c.fillRect(x, tY, colW, tH); c.fillStyle = '#ddf0e5'; c.fillRect(x, tY, colW, thH); });
  txt('รายการ', PAD + 22, tY + 38, font(600, 15), '#5f6b64');
  p.head.forEach((h, i) => { const xr = PAD + labelW + (i + 1) * colW - 22; txt(h.title, xr, tY + 38, font(700, 18), '#142433', 'right'); txt(h.sub, xr, tY + 62, font(400, 15), '#46524c', 'right');
    if (h.best) { c.font = font(600, 13); const bw = c.measureText('ต้นทุนต่ำสุด').width + 20; rr(xr - bw, tY + 70, bw, 22, 11, '#1f7a55'); txt('ต้นทุนต่ำสุด', xr - bw / 2, tY + 86, font(600, 13), '#fff', 'center'); } });
  let ry = tY + thH;
  p.rows.forEach(r => { const h = r.section ? 42 : 48; c.fillStyle = '#e5eae4'; c.fillRect(PAD, ry, W - PAD * 2, 1);
    if (r.section) { c.fillStyle = '#eef3f7'; c.fillRect(PAD, ry + 1, W - PAD * 2, h - 1); txt(r.label, PAD + 22, ry + 27, font(700, 15), '#003049'); }
    else { txt(r.label, PAD + 22, ry + 30, font(r.strong ? 600 : 400, 16), '#46524c'); r.cells.forEach((cl, i) => txt(cl.text, PAD + labelW + (i + 1) * colW - 22, ry + 30, font(r.strong ? 600 : 400, 17), cl.color, 'right')); }
    ry += h; });
  c.restore(); rr(PAD, tY, W - PAD * 2, tH, 16, null, '#dfe5de');
  y = tY + tH + 46; basisL.forEach(l => { txt(l, PAD, y, font(400, 15), '#46524c'); y += 24; });
  txt('ใช้ได้อีก = สต็อก ÷ ยอดใช้เฉลี่ยต่อเดือน · ประหยัด/(จ่ายเพิ่ม) = (ราคา PO ล่าสุด − ราคาใหม่) × จำนวนที่สั่ง', PAD, y + 8, font(400, 13), '#5f6b64');
  return { cv, name: `promo_${(p.sku ? p.sku.code : 'manual').replace(/[^A-Za-z0-9_-]/g, '')}_${todayISO().replace(/-/g, '')}.png` };
}
async function promoExport() {
  openModal(`<h2>รูปสรุปโปรโมชั่น</h2><div class="small muted" style="margin-bottom:14px">ดาวน์โหลดเป็นไฟล์ PNG หรือคัดลอกไปวางใน LINE / อีเมล / แชทได้ทันที</div>
    <div id="imgBox" style="border:1px solid #e2e8e1;border-radius:12px;background:#f7f3ea;padding:10px;margin-bottom:14px;min-height:160px;display:grid;place-items:center">กำลังสร้างรูป…</div>
    <div id="imgMsg"></div>
    <div class="actions"><button class="btn" id="imgDl">⭳ ดาวน์โหลด PNG</button><button class="btn soft" id="imgCp">⧉ คัดลอกรูป</button><button class="btn ghost" id="imgClose">ปิด</button></div>`, true);
  $('#imgClose').onclick = closeModal;
  let res;
  try { res = await promoImage(); } catch (e) { $('#imgBox').textContent = 'สร้างรูปไม่สำเร็จ'; return; }
  const url = res.cv.toDataURL('image/png');
  $('#imgBox').innerHTML = `<img src="${url}" alt="รูปสรุปการเปรียบเทียบโปรโมชั่น" style="display:block;width:100%;height:auto;max-height:60vh;object-fit:contain;border-radius:8px">`;
  const msg = (t, ok) => { $('#imgMsg').innerHTML = `<div class="${ok ? 'ok' : 'warnbox'}">${esc(t)}</div>`; };
  $('#imgDl').onclick = () => { const a = document.createElement('a'); a.href = url; a.download = res.name; document.body.appendChild(a); a.click(); a.remove(); msg('✓ ดาวน์โหลดแล้ว: ' + res.name, true); };
  $('#imgCp').onclick = async () => {
    try {
      if (!navigator.clipboard || !window.ClipboardItem) throw new Error('x');
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': new Promise(r => res.cv.toBlob(r, 'image/png')) })]);
      msg('✓ คัดลอกรูปแล้ว — วางใน LINE / อีเมล / แชทได้เลย (Ctrl+V)', true);
    } catch (e) { msg('เบราว์เซอร์นี้คัดลอกรูปไม่ได้ — คลิกขวาที่รูป → คัดลอกรูปภาพ (มือถือ: กดค้างที่รูป)'); }
  };
}
