/* Promotion order calculator + saved calculations (history) + PNG export */
'use strict';
(function () {   // styles for the decision cards (kept here so styles.css stays unchanged)
  const st = document.createElement('style');
  st.textContent = '.dcards{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}'
    + '.dcard{border:2px solid #e2e8e1;border-radius:12px;padding:12px 14px;cursor:pointer;background:#fff;text-align:left;font:inherit;color:inherit}'
    + '.dcard:hover{border-color:#669BBC}.dcard.on{border-color:#003049;background:#eaf1f6}'
    + '.dcard .t1{font-weight:700;font-family:Anuphan,"IBM Plex Sans Thai",sans-serif;font-size:15px}.dcard .t2{font-size:12.5px;color:#46524c;margin-top:2px}.dcard .t3{font-size:12px;margin-top:6px}';
  document.head.appendChild(st);
})();
const newOpt = () => ({ label: '', packs: '', total: '' });
const newDec = () => ({ choice: '', packs: '', total: '', po_no: '', date: todayISO(), note: '' });
const P = { code: '', stock: '', avg: '', perBox: '1', po: '', opts: [newOpt(), newOpt()], dec: newDec(), view: 'calc', err: null, busy: false };
window.promoPick = function (code) {
  const sku = S.skus.find(s => s.code === code);
  if (!sku) { P.code = ''; return; }
  const it = computeItem(sku);
  P.code = code; P.stock = it.stock == null ? '' : String(it.stock); P.avg = String(Math.round(it.avg3 * 100) / 100);
  P.perBox = sku.units_per_purchase ? String(Number(sku.units_per_purchase)) : '1';
  P.dec = newDec(); P.err = null; P.view = 'calc';
};

/* ---------- saved calculations ---------- */
const PH = { list: null, loading: false, err: null, f: 'all', q: '' };
const PH_ST = { ordered: ['สั่งแล้ว', '#e9f6ef', '#1f7a55'], pending: ['รอตัดสินใจ', '#fdf4e3', '#8a5410'], cancelled: ['ยกเลิก', '#edf1ec', '#46524c'] };
const decLabel = d => d === 'other' ? 'อื่นๆ' : d === 'none' ? 'ยังไม่สั่ง' : 'ตัวเลือก ' + d;
const stPill = s => { const [l, bg, fg] = PH_ST[s] || PH_ST.pending; return `<span class="status" style="background:${bg};color:${fg};padding:2px 9px;font-size:11.5px">${l}</span>`; };
const shortD = iso => { if (!iso) return '—'; const [y, m, d] = iso.slice(0, 10).split('-').map(Number); return `${d} ${TH_M[m - 1]} ${String((y + 543) % 100).padStart(2, '0')}`; };
const r4 = n => n == null || !isFinite(n) ? null : Math.round(n * 10000) / 10000;
async function loadPromoHist() {
  if (PH.loading) return; PH.loading = true;
  const { data, error } = await sb.from('stock_promo_calcs').select('*').order('decided_on', { ascending: false }).order('id', { ascending: false }).limit(2000);
  PH.list = error ? [] : data; PH.err = error ? errMsg(error) : null; PH.loading = false; render();
}
/** Latest ORDERED calculation for a SKU = the reference for the next order. */
function promoRef(code) {
  if (!PH.list || !code) return { last: null, n: 0 };
  const rows = PH.list.filter(r => r.sku_code === code);
  return { last: rows.find(r => r.status === 'ordered' && r.chosen_cpu != null) || null, n: rows.length };
}
const pctVs = (cpu, po) => cpu != null && po > 0 ? (cpu - po) / po * 100 : null;
const pctText = p => p == null ? '' : `${p > 0 ? '+' : p < 0 ? '−' : ''}${fmt(Math.abs(p), 2)}%`;
const pctColor = p => p == null ? '#5f6b64' : p > 0 ? '#a4161a' : p < 0 ? '#1f7a55' : '#142433';

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
    return { i, letter: 'ABCD'[i], label: (o.label || '').trim(), packs, total, units, cpu, after, mAfter, diff, pct: diff != null ? diff / po * 100 : null, save: diff != null ? -diff * units : null };
  });
  // what the user decided to order
  const d = P.dec; let chosen = null;
  if (/^[ABCD]$/.test(d.choice)) { const c = calc.find(x => x.letter === d.choice); if (c) chosen = { label: c.label, packs: c.packs, total: c.total, units: c.units, cpu: c.cpu, mAfter: c.mAfter }; }
  else if (d.choice === 'other') { const packs = num(d.packs), total = num(d.total), units = packs * perBox; chosen = { label: '', packs, total, units, cpu: units > 0 && total > 0 ? total / units : null, mAfter: avg > 0 ? (stock + units) / avg : null }; }
  const valid = calc.filter(c => c.cpu != null);
  let best = null, worst = null;
  if (valid.length > 1) { best = valid.reduce((a, b) => b.cpu < a.cpu ? b : a); worst = valid.reduce((a, b) => b.cpu > a.cpu ? b : a); if (best.cpu === worst.cpu) best = null; }
  const mColor = m => m == null ? '#5f6b64' : m < st.warn ? '#a4161a' : m < st.warn + 1.5 ? '#8a5410' : '#1f7a55';
  const mText = m => m == null ? '—' : m.toFixed(1) + ' เดือน';
  const sign = (n, dd) => (n > 0 ? '+' : n < 0 ? '−' : '') + fmt(Math.abs(n), dd);
  const upDown = n => n > 0 ? '#a4161a' : n < 0 ? '#1f7a55' : '#142433';
  const optName = c => `${q2(c.packs)} ${pack} (${q2(c.units)} ${unit})`;
  const dash = { text: '—', color: '#5f6b64' };
  const isBest = c => !!best && c.i === best.i;
  const head = calc.map(c => ({ title: 'ตัวเลือก ' + c.letter, sub: optName(c), label: c.label, best: isBest(c), chosen: d.choice === c.letter }));
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
  return { sku, it, unit, pack, stock, avg, perBox, po, calc, chosen, head, rows, best, sumTitle, sumBody, overText, basis,
    title: sku ? sku.name : 'สินค้า (กรอกเอง)', sub: sku ? [sku.code, sku.supplier].filter(Boolean).join(' · ') : 'กรอกข้อมูลเอง' };
}

VIEWS.promo = {
  html() {
    if (PH.list === null && !PH.loading) loadPromoHist();
    if (P.view === 'hist') return promoHistHtml();
    if (!P.code && !P.stock && S.skus.length) { const j = S.skus.find(s => s.code === 'JVM-FL'); if (j) window.promoPick(j.code); }
    const r = promoCalc();
    const opts = S.skus.filter(s => s.is_tracked).sort((a, b) => a.name.localeCompare(b.name));
    const unitL = esc(r.unit), packL = esc(r.pack);
    const avgChips = r.it ? [['avg3', 'เฉลี่ย 3 ด.', r.it.avg3], ['avg6', 'เฉลี่ย 6 ด.', r.it.avg6]].map(([k, l, v]) =>
      `<button type="button" class="chip ${Math.abs(num(P.avg) - Math.round(v * 100) / 100) < 1e-9 ? 'on' : ''}" data-avg="${Math.round(v * 100) / 100}" style="padding:5px 11px;font-size:12px">${l} = ${q2(v)}</button>`).join('') : '';
    const nHist = PH.list ? PH.list.length : 0;
    return `<div class="pagehead"><div><h1>คำนวณสั่งซื้อตามโปรโมชั่น</h1><div class="sub">เทียบหลายตัวเลือก — ต้นทุนต่อหน่วย, สต็อกพอใช้กี่เดือน และราคาเทียบ PO ล่าสุด · เลือกตัวที่จะสั่งแล้วบันทึกไว้อ้างอิงรอบถัดไป</div></div>
        <div class="flex"><button class="btn ghost" id="pHist">🕘 ประวัติการคำนวณ${PH.list ? ` (${nHist})` : ''}</button><button class="btn" id="pExport">🖼 บันทึกเป็นรูปภาพ</button></div></div>
      <div class="flex" style="gap:18px">
        <div style="flex:1 1 320px;max-width:420px;min-width:0;display:flex;flex-direction:column;gap:14px">
          <div class="card pad"><div class="title" style="margin-bottom:14px">ข้อมูลสินค้า</div>
            <div class="field"><label for="pSku">เลือกสินค้า</label><select id="pSku"><option value="">— กรอกเอง (ไม่เลือกจากคลัง) —</option>${opts.map(s => `<option value="${esc(s.code)}" ${s.code === P.code ? 'selected' : ''}>${esc(s.name)} · ${esc(s.code)}</option>`).join('')}</select></div>
            ${promoRefHtml(r)}
            <div class="grid2"><div class="field"><label for="pStock">สต็อกคงเหลือ (${unitL})</label><input id="pStock" inputmode="decimal" value="${esc(P.stock)}"></div>
              <div class="field"><label for="pBox">${unitL} ต่อ 1 ${packL}</label><input id="pBox" inputmode="decimal" value="${esc(P.perBox)}"></div></div>
            <div class="field" style="margin-bottom:6px"><label for="pAvg">ยอดใช้เฉลี่ยต่อเดือน (${unitL})</label><input id="pAvg" inputmode="decimal" value="${esc(P.avg)}"></div>
            <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px">${avgChips}</div>
            <div class="field" style="margin:0"><label for="pPo">ราคา PO ล่าสุด (บาท/${unitL})</label><input id="pPo" inputmode="decimal" placeholder="เช่น 5322.50" value="${esc(P.po)}"></div>
          </div>
          <div class="card pad"><div class="title">ตัวเลือกโปรโมชั่น</div><div class="small muted" style="margin:4px 0 14px">ใส่จำนวน${packL}และราคารวมของแต่ละโปร (สูงสุด 4 ตัวเลือก)</div>
            ${r.calc.map((c, i) => `<div style="border:1px solid #e2e8e1;border-radius:12px;padding:12px 14px;margin-bottom:10px;background:#fbf8f1">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px"><b style="font-size:13.5px">ตัวเลือก ${c.letter}</b>${P.opts.length > 1 ? `<button type="button" class="linkbtn" data-rm="${i}" aria-label="ลบตัวเลือก ${c.letter}">ลบ</button>` : ''}</div>
              <div class="field" style="margin:0 0 8px"><label for="pl${i}">ชื่อโปร / เงื่อนไข <span class="muted" style="font-weight:400">(ไม่บังคับ)</span></label><input id="pl${i}" data-opt="${i}" data-k="label" placeholder="เช่น ซื้อ 100 แถม 3" value="${esc(P.opts[i].label)}"></div>
              <div class="grid2"><div class="field" style="margin:0"><label for="pk${i}">จำนวน${packL}</label><input id="pk${i}" data-opt="${i}" data-k="packs" inputmode="decimal" value="${esc(P.opts[i].packs)}"></div>
                <div class="field" style="margin:0"><label for="pt${i}">ราคารวม (บาท)</label><input id="pt${i}" data-opt="${i}" data-k="total" inputmode="decimal" value="${esc(P.opts[i].total)}"></div></div>
              <div class="small" style="margin-top:8px;color:#46524c" id="note${i}">${c.units > 0 ? `= ${q2(c.units)} ${unitL}${c.cpu != null ? ` · ${fmt(c.cpu, 2)} บาท/${unitL}` : ''}` : 'กรอกจำนวนและราคารวม'}</div></div>`).join('')}
            ${P.opts.length < 4 ? `<button type="button" class="btn soft" id="pAdd" style="width:100%">+ เพิ่มตัวเลือก</button>` : ''}
          </div>
        </div>
        <div style="flex:999 1 560px;min-width:0;display:flex;flex-direction:column;gap:14px">
          <div style="display:flex;flex-direction:column;gap:14px" id="pResult">${VIEWS.promo.resultHtml(r)}</div>
          ${promoDecideHtml(r)}
        </div>
      </div>`;
  },
  resultHtml(r) {
    const thStyle = h => h.chosen ? 'background:#003049;color:#fff' : h.best ? 'background:#e1f1e8' : '';
    const tdBg = h => h.chosen ? 'background:#eaf1f6;' : h.best ? 'background:#f3faf6;' : '';
    return `${r.best ? `<div class="ok" style="margin:0;font-size:13.5px;line-height:1.6;padding:14px 18px"><b>✓ ${esc(r.sumTitle)}</b><div>${esc(r.sumBody)}</div></div>` : ''}
      ${r.overText ? `<div class="warnbox" style="margin:0">⚠ ${esc(r.overText)}</div>` : ''}
      <div class="card" style="overflow:hidden"><div style="padding:15px 20px;border-bottom:1px solid #edf1ec" class="title">${esc(r.title)}</div>
        <div class="scroll"><table class="t" style="min-width:520px"><thead><tr><th>รายการ</th>${r.head.map(h => `<th class="r" style="vertical-align:top;${thStyle(h)}"><div style="font-size:13px;color:${h.chosen ? '#fff' : '#142433'}">${esc(h.title)}</div><div style="font-weight:500">${esc(h.sub)}</div>${h.label ? `<div style="font-weight:400">${esc(h.label)}</div>` : ''}${h.best ? '<span class="status" style="background:#1f7a55;color:#fff;margin-top:5px;padding:2px 8px;font-size:11px">ต้นทุนต่ำสุด</span>' : ''}${h.chosen ? '<div style="margin-top:5px"><span class="status" style="background:#fff;color:#003049;padding:2px 8px;font-size:11px">✓ เลือกสั่ง</span></div>' : ''}</th>`).join('')}</tr></thead>
        <tbody>${r.rows.map(x => x.section
          ? `<tr><td colspan="${r.head.length + 1}" style="background:#f2f6f9;color:#003049;font-weight:700;font-size:12px">${esc(x.label)}</td></tr>`
          : `<tr><td style="color:#46524c;${x.strong ? 'font-weight:600' : ''}">${esc(x.label)}</td>${x.cells.map((c, i) => `<td class="r" style="white-space:nowrap;color:${c.color};${x.strong ? 'font-weight:600;' : ''}${tdBg(r.head[i])}">${esc(c.text)}</td>`).join('')}</tr>`).join('')}</tbody></table></div></div>
      <div class="small muted">ใช้ได้อีก = สต็อก ÷ ยอดใช้เฉลี่ยต่อเดือน · ประหยัด/(จ่ายเพิ่ม) = (ราคา PO ล่าสุด − ราคาใหม่) × จำนวนที่สั่ง</div>`;
  },
  refresh() {
    const r = promoCalc();
    $('#pResult').innerHTML = VIEWS.promo.resultHtml(r);
    r.calc.forEach((c, i) => { const n = $('#note' + i); if (n) n.textContent = c.units > 0 ? `= ${q2(c.units)} ${r.unit}${c.cpu != null ? ` · ${fmt(c.cpu, 2)} บาท/${r.unit}` : ''}` : 'กรอกจำนวนและราคารวม'; });
    const dc = $('#pDecCards'); if (dc) { dc.innerHTML = promoDecCards(r); bindDecCards(); }
    const on = $('#decOtherNote'); if (on) on.textContent = promoOtherNote(r);
    const ob = $('#decOther'); if (ob) ob.style.display = P.dec.choice === 'other' ? 'block' : 'none';
  },
  bind() {
    if (P.view === 'hist') return promoHistBind();
    $('#pSku').onchange = e => { if (e.target.value) window.promoPick(e.target.value); else { P.code = ''; P.dec = newDec(); } render(); };
    [['#pStock', 'stock'], ['#pBox', 'perBox'], ['#pAvg', 'avg'], ['#pPo', 'po']].forEach(([id, k]) => $(id).oninput = e => { P[k] = e.target.value; VIEWS.promo.refresh(); });
    $$('[data-opt]').forEach(el => el.oninput = () => { P.opts[+el.dataset.opt][el.dataset.k] = el.value; VIEWS.promo.refresh(); });
    $$('[data-avg]').forEach(b => b.onclick = () => { P.avg = b.dataset.avg; render(); });
    $$('[data-rm]').forEach(b => b.onclick = () => { P.opts.splice(+b.dataset.rm, 1); if (/^[ABCD]$/.test(P.dec.choice)) P.dec.choice = ''; render(); });
    const add = $('#pAdd'); if (add) add.onclick = () => { P.opts.push(newOpt()); render(); };
    $('#pExport').onclick = () => promoExport();
    $('#pHist').onclick = () => { P.view = 'hist'; render(); window.scrollTo(0, 0); };
    const ru = $('#refUse'); if (ru) ru.onclick = () => { P.po = ru.dataset.v; render(); toast('✓ ใส่ราคา PO ล่าสุดจากรอบก่อนแล้ว'); };
    $$('[data-refopen]').forEach(b => b.onclick = e => { e.preventDefault(); phOpen(+b.dataset.refopen); });
    const rh = $('#refAll'); if (rh) rh.onclick = e => { e.preventDefault(); PH.q = P.code; PH.f = 'all'; P.view = 'hist'; render(); window.scrollTo(0, 0); };
    bindDecCards();
    [['#decPo', 'po_no'], ['#decDate', 'date'], ['#decNote', 'note']].forEach(([id, k]) => $(id).oninput = e => { P.dec[k] = e.target.value; });
    [['#decPk', 'packs'], ['#decTot', 'total']].forEach(([id, k]) => $(id).oninput = e => { P.dec[k] = e.target.value; VIEWS.promo.refresh(); });
    $('#decClear').onclick = () => { P.dec = newDec(); P.err = null; render(); };
    $('#decSave').onclick = () => promoSave();
  },
};

function promoRefHtml(r) {
  if (!r.sku) return '';
  if (!PH.list) return `<div class="small muted" style="margin:-4px 0 14px">กำลังโหลดประวัติการสั่ง…</div>`;
  const { last, n } = promoRef(r.sku.code);
  if (!last) return `<div class="small muted" style="margin:-4px 0 14px">ยังไม่มีประวัติการสั่งที่บันทึกไว้ของสินค้านี้${n ? ` (มีบันทึกที่ยังไม่สั่ง ${n} รายการ — <a href="#" class="linkbtn" id="refAll">ดู</a>)` : ''}</div>`;
  const u = esc(last.unit || r.unit), cpu = Math.round(Number(last.chosen_cpu) * 100) / 100;
  const avgNow = r.it ? r.it.avg3 : null, avgThen = last.avg_usage != null ? Number(last.avg_usage) : null;
  const trend = avgNow != null && avgThen != null && Math.abs(avgNow - avgThen) > 0.005 ? ` <span class="muted">(ตอนนี้ ${q2(Math.round(avgNow * 100) / 100)} ${avgNow > avgThen ? '↑' : '↓'})</span>` : '';
  const line = (k, v) => `<div style="display:flex;justify-content:space-between;gap:10px;padding:3px 0"><span class="muted" style="flex:none">${k}</span><span style="text-align:right">${v}</span></div>`;
  return `<div style="background:#f2f6f9;border:1px solid #cdddea;border-radius:12px;padding:12px 14px;font-size:13px;margin:-2px 0 14px">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px"><b style="color:#003049">อ้างอิงรอบก่อน</b><a href="#" class="linkbtn" id="refAll" style="font-size:12.5px">ดูทั้งหมด (${n}) →</a></div>
    ${line('วันที่', `<a href="#" class="linkbtn" data-refopen="${last.id}" style="font-size:13px">${dLabel(last.decided_on)}</a> · ${esc(last.created_by_name || '')}`)}
    ${line('สั่ง', `<b>${esc(decLabel(last.decision))}</b> · ${q2(Number(last.chosen_packs))} ${esc(last.pack || '')} (${q2(Number(last.chosen_units))} ${u}) · ${fmt(Number(last.chosen_total), 0)} บาท`)}
    ${line('ต้นทุนต่อ ' + u, `<b>${fmt(cpu, 2)} บาท</b>`)}
    ${avgThen != null ? line('ตอนนั้นใช้เฉลี่ย', `${q2(avgThen)} ${u}/เดือน${trend}`) : ''}
    ${last.chosen_label || last.note ? line('หมายเหตุ', esc([last.chosen_label, last.note].filter(Boolean).join(' · '))) : ''}
    ${Math.abs(num(P.po) - cpu) > 0.004 ? `<button type="button" class="btn soft small" id="refUse" data-v="${cpu}" style="margin-top:8px;width:100%">ใช้ ${fmt(cpu, 2)} เป็นราคา PO ล่าสุด</button>` : '<div class="small" style="margin-top:6px;color:#1f7a55">✓ ใช้ราคานี้เป็นราคา PO ล่าสุดอยู่แล้ว</div>'}
  </div>`;
}

/* ---------- decision & save ---------- */
function promoDecCards(r) {
  const u = r.unit, card = (key, t1, t2, t3, col) => `<button type="button" class="dcard ${P.dec.choice === key ? 'on' : ''}" data-dec="${key}"><div class="t1">${t1}</div><div class="t2">${t2}</div><div class="t3" style="color:${col || '#5f6b64'}">${t3}</div></button>`;
  return r.calc.map(c => card(c.letter, 'สั่งตัวเลือก ' + c.letter,
      c.units > 0 ? `${q2(c.packs)} ${esc(r.pack)} · ${c.total ? fmt(c.total, 0) + ' บาท' : 'ยังไม่ใส่ราคา'}` : 'ยังไม่กรอก',
      c.cpu != null ? `${fmt(c.cpu, 2)} บาท/${esc(u)}${c.pct != null ? ` (${pctText(c.pct)})` : ''}` : '—', pctColor(c.pct))).join('')
    + card('other', 'อื่นๆ', 'ต่อรองได้ราคา / จำนวนอื่น', 'กรอกเอง')
    + card('none', 'ยังไม่สั่ง', 'เก็บไว้เทียบก่อน', 'สถานะ “รอตัดสินใจ”');
}
function promoOtherNote(r) {
  const c = r.chosen; if (P.dec.choice !== 'other' || !c) return '';
  return c.units > 0 ? `= ${q2(c.units)} ${r.unit}${c.cpu != null ? ` · ${fmt(c.cpu, 2)} บาท/${r.unit}${r.po > 0 ? ` (${pctText(pctVs(c.cpu, r.po))} เทียบ PO)` : ''}` : ''}${c.mAfter != null ? ` · สต็อกพอใช้ ${c.mAfter.toFixed(1)} เดือนหลังสั่ง` : ''}` : 'กรอกจำนวนและราคารวมที่สั่งจริง';
}
function promoDecideHtml(r) {
  const d = P.dec;
  return `<div class="card pad" id="pDecide">
    <div class="title" style="margin-bottom:4px">ตัดสินใจ &amp; บันทึกการคำนวณ</div>
    <div class="small muted" style="margin-bottom:12px">เลือกว่าจะสั่งตัวไหน แล้วกดบันทึก — ระบบเก็บตัวเลขทั้งหมด ณ วันนี้ไว้อ้างอิงรอบถัดไป (บันทึกได้แม้ยังไม่ตัดสินใจ)</div>
    <div class="dcards" id="pDecCards" style="margin-bottom:12px">${promoDecCards(r)}</div>
    <div id="decOther" style="display:${d.choice === 'other' ? 'block' : 'none'};border:1px solid #e2e8e1;border-radius:12px;padding:12px 14px;margin-bottom:12px;background:#fbf8f1">
      <div class="small" style="font-weight:600;margin-bottom:8px">รายละเอียดที่สั่งจริง</div>
      <div class="grid2"><div class="field" style="margin:0"><label for="decPk">จำนวน${esc(r.pack)}</label><input id="decPk" inputmode="decimal" value="${esc(d.packs)}"></div>
        <div class="field" style="margin:0"><label for="decTot">ราคารวม (บาท)</label><input id="decTot" inputmode="decimal" value="${esc(d.total)}"></div></div>
      <div class="small" style="margin-top:8px;color:#46524c" id="decOtherNote">${esc(promoOtherNote(r))}</div></div>
    <div class="grid2">
      <div class="field"><label for="decPo">เลขที่ PO / ใบเสนอราคา <span class="muted" style="font-weight:400">(ถ้ามี)</span></label><input id="decPo" placeholder="เช่น PO-2611-0042" value="${esc(d.po_no)}"></div>
      <div class="field"><label for="decDate">วันที่</label><input id="decDate" type="date" value="${esc(d.date)}"></div>
      <div class="field full"><label for="decNote">หมายเหตุ / เหตุผล</label><input id="decNote" placeholder="เช่น เลือกเพราะราคาต่อหน่วยต่ำสุด เช็กวันหมดอายุแล้ว" value="${esc(d.note)}"></div>
    </div>
    ${P.err ? `<div class="err">${esc(P.err)}</div>` : ''}
    <div class="actions"><button type="button" class="btn ghost" id="decClear">ล้าง</button><button type="button" class="btn" id="decSave" ${P.busy ? 'disabled' : ''}>${P.busy ? 'กำลังบันทึก…' : '💾 บันทึกการคำนวณ'}</button></div>
  </div>`;
}
function bindDecCards() {
  $$('[data-dec]').forEach(b => b.onclick = () => { P.dec.choice = b.dataset.dec; P.err = null; const er = $('#pDecide .err'); if (er) er.remove(); VIEWS.promo.refresh(); const ob = $('#decOther'); if (ob && P.dec.choice === 'other') { const f = $('#decPk'); if (f && !f.value) f.focus(); } });
}
async function promoSave() {
  const r = promoCalc(), d = P.dec;
  const fail = t => { P.err = t; render(); const el = $('#pDecide'); if (el) el.scrollIntoView({ block: 'center' }); };
  if (!d.choice) return fail('เลือกก่อนว่าจะสั่งตัวเลือกไหน — หรือเลือก “ยังไม่สั่ง” เพื่อเก็บไว้เทียบ');
  if (!r.calc.some(c => c.cpu != null)) return fail('กรอกจำนวนและราคารวมของตัวเลือกอย่างน้อย 1 ตัว');
  if (d.choice !== 'none' && (!r.chosen || !(r.chosen.units > 0) || r.chosen.cpu == null)) return fail(d.choice === 'other' ? 'กรอกจำนวนและราคารวมที่สั่งจริง' : `ตัวเลือก ${d.choice} ยังกรอกจำนวนหรือราคาไม่ครบ`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date)) return fail('กรุณาระบุวันที่');
  const ch = d.choice === 'none' ? null : r.chosen;
  const row = {
    sku_code: r.sku ? r.sku.code : null, item_name: r.title, unit: r.unit, pack: r.pack,
    stock: r.stock, avg_usage: r.avg, per_box: r.perBox, po_price: r.po > 0 ? r.po : null,
    options: r.calc.map(c => ({ letter: c.letter, label: c.label || null, packs: c.packs, total: c.total, units: c.units, cpu: r4(c.cpu), months_after: r4(c.mAfter), diff_pct: r4(c.pct), save: r4(c.save) })),
    decision: d.choice, chosen_label: ch ? (ch.label || null) : null, chosen_packs: ch ? ch.packs : null, chosen_total: ch ? ch.total : null,
    chosen_units: ch ? ch.units : null, chosen_cpu: ch ? r4(ch.cpu) : null, chosen_months_after: ch ? r4(ch.mAfter) : null,
    status: d.choice === 'none' ? 'pending' : 'ordered', po_no: d.po_no.trim() || null, decided_on: d.date, note: d.note.trim() || null,
    created_by: S.session.user.id,
  };
  P.busy = true; P.err = null; render();
  const { data, error } = await sb.from('stock_promo_calcs').insert(row).select().single();
  P.busy = false;
  if (error) return fail('บันทึกไม่สำเร็จ: ' + errMsg(error));
  if (PH.list) PH.list.unshift(data);
  P.dec = newDec(); render();
  toast(`✓ บันทึกแล้ว — ${decLabel(data.decision)}${data.chosen_cpu != null ? ` · ${fmt(Number(data.chosen_cpu), 2)} บาท/${data.unit}` : ''}`);
}

/* ---------- history ---------- */
const optSummary = r => (r.options || []).filter(o => o.units > 0).map(o => `${o.letter} ${q2(o.packs)}`).join(' · ') + ((r.options || []).some(o => o.units > 0) ? ' ' + (r.pack || '') : '');
function promoHistHtml() {
  const head = `<div class="pagehead"><div><h1>ประวัติการคำนวณโปรโมชั่น</h1><div class="sub">ทุกครั้งที่กดบันทึก · ทุกคนในทีมเห็นร่วมกัน · คลิกแถวเพื่อดูตัวเลขของวันนั้น</div></div>
    <div class="flex"><button class="btn ghost" id="phReload">↻ โหลดใหม่</button><button class="btn" id="phBack">← กลับไปคำนวณ</button></div></div>`;
  if (!PH.list) return head + '<div class="empty">กำลังโหลด…</div>';
  const q = PH.q.trim().toLowerCase();
  const rows = PH.list.filter(r => (PH.f === 'all' || r.status === PH.f) && (!q || [r.item_name, r.sku_code, r.po_no, r.note, r.chosen_label, r.created_by_name].some(v => (v || '').toLowerCase().includes(q))));
  const cnt = k => PH.list.filter(r => k === 'all' || r.status === k).length;
  return head + `${PH.err ? `<div class="err">${esc(PH.err)}</div>` : ''}
    <div class="toolbar"><div class="search"><input id="phQ" type="search" placeholder="ค้นหาชื่อยา / รหัส / เลข PO / หมายเหตุ…" value="${esc(PH.q)}" aria-label="ค้นหา"></div>
      ${[['all', 'ทั้งหมด'], ['ordered', 'สั่งแล้ว'], ['pending', 'รอตัดสินใจ'], ['cancelled', 'ยกเลิก']].map(([k, l]) => `<button class="chip ${PH.f === k ? 'on' : ''}" data-phf="${k}">${l} (${cnt(k)})</button>`).join('')}</div>
    <div class="card" style="overflow:hidden"><div class="scroll"><table class="t" style="min-width:1040px">
      <thead><tr><th>วันที่</th><th>สินค้า</th><th>ตัวเลือกที่เทียบ</th><th>ตัดสินใจ</th><th class="r">จำนวน</th><th class="r">ราคารวม</th><th class="r">บาท/หน่วย</th><th class="r">เทียบ PO</th><th>สถานะ</th><th>โดย</th></tr></thead>
      <tbody>${rows.map(r => { const p = pctVs(r.chosen_cpu != null ? Number(r.chosen_cpu) : null, Number(r.po_price)); const has = r.chosen_cpu != null; return `<tr class="click" data-ph="${r.id}" tabindex="0">
        <td style="white-space:nowrap">${shortD(r.decided_on)}</td>
        <td><b>${esc(r.item_name)}</b><div class="small muted">${esc(r.sku_code || 'กรอกเอง')}</div></td>
        <td class="small">${esc(optSummary(r)) || '—'}</td>
        <td>${r.decision === 'none' ? '<span class="muted">—</span>' : `<b>${esc(decLabel(r.decision).replace('ตัวเลือก ', ''))}</b>`}${r.chosen_label ? ` <span class="small muted">${esc(r.chosen_label)}</span>` : ''}</td>
        <td class="r" style="white-space:nowrap">${has ? `${q2(Number(r.chosen_units))} ${esc(r.unit || '')}` : '<span class="muted">—</span>'}</td>
        <td class="r">${has ? fmt(Number(r.chosen_total), 0) : '<span class="muted">—</span>'}</td>
        <td class="r"><b>${has ? fmt(Number(r.chosen_cpu), 2) : '—'}</b></td>
        <td class="r" style="color:${pctColor(p)}">${pctText(p) || '<span class="muted">—</span>'}</td>
        <td>${stPill(r.status)}${r.po_no ? `<div class="small muted">${esc(r.po_no)}</div>` : ''}</td>
        <td class="small">${esc(r.created_by_name || '')}</td></tr>`; }).join('') || '<tr><td colspan="10" class="empty">ยังไม่มีการคำนวณที่บันทึกไว้</td></tr>'}</tbody></table></div></div>
    <div class="foot">แสดง ${rows.length} จาก ${PH.list.length} รายการ · ตัวเลขในแต่ละรายการเป็นข้อมูล ณ วันที่บันทึก ไม่เปลี่ยนตามสต็อกปัจจุบัน</div>`;
}
function promoHistBind() {
  $('#phBack').onclick = () => { P.view = 'calc'; render(); window.scrollTo(0, 0); };
  $('#phReload').onclick = () => { PH.list = null; loadPromoHist(); render(); };
  const q = $('#phQ'); if (q) q.oninput = () => { PH.q = q.value; const pos = q.selectionStart; render(); const n = $('#phQ'); n.focus(); n.setSelectionRange(pos, pos); };
  $$('[data-phf]').forEach(b => b.onclick = () => { PH.f = b.dataset.phf; render(); });
  $$('[data-ph]').forEach(tr => { tr.onclick = () => phOpen(+tr.dataset.ph); tr.onkeydown = e => { if (e.key === 'Enter') tr.click(); }; });
}

/** Read-only view of one saved calculation, with status / PO / note editing and a late decision for "not ordered yet". */
function phOpen(id) {
  const r = (PH.list || []).find(x => x.id === id); if (!r) return;
  const u = esc(r.unit || 'หน่วย'), opts = (r.options || []).filter(o => o.units > 0 || o.total > 0), po = Number(r.po_price) || 0;
  const mine = r.created_by === S.session.user.id || S.member.is_owner;
  const chosenL = r.decision;
  const tdS = o => o.letter === chosenL ? 'background:#eaf1f6;' : '';
  const cell = (o, v, col) => `<td class="r" style="white-space:nowrap;${tdS(o)}${col ? 'color:' + col : ''}">${v}</td>`;
  const ref = (k, v) => `<div style="display:flex;justify-content:space-between;gap:10px;padding:3px 0"><span class="muted">${k}</span><span style="text-align:right">${v}</span></div>`;
  const isLate = r.decision === 'none';
  openModal(`<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap"><div><h2>การคำนวณ ${dLabel(r.decided_on)} · ${esc(r.item_name)}</h2>
      <div class="small muted">${esc(r.sku_code || 'กรอกเอง')} · บันทึกโดย ${esc(r.created_by_name || '—')} · ${new Date(r.created_at).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' })}</div></div>${stPill(r.status)}</div>
    <div class="info" style="margin:14px 0">ตัวเลขด้านล่างเป็นข้อมูล ณ วันที่บันทึก (ไม่เปลี่ยนตามสต็อกปัจจุบัน)</div>
    <div class="grid2" style="margin-bottom:12px;font-size:13.5px">
      <div style="background:#f2f6f9;border:1px solid #cdddea;border-radius:12px;padding:10px 14px">${ref('สต็อกตอนนั้น', `<b>${q2(Number(r.stock))} ${u}</b>`)}${ref('ใช้เฉลี่ย', `<b>${q2(Number(r.avg_usage))} ${u}/เดือน</b>`)}${ref('ราคา PO อ้างอิง', po ? `<b>${fmt(po, 2)} บาท/${u}</b>` : 'ไม่ได้ระบุ')}</div>
      <div style="background:#f2f6f9;border:1px solid #cdddea;border-radius:12px;padding:10px 14px">${ref('ตัดสินใจ', `<b>${esc(decLabel(r.decision))}</b>${r.chosen_label ? ' · ' + esc(r.chosen_label) : ''}`)}${r.chosen_cpu != null ? ref('สั่งจริง', `${q2(Number(r.chosen_packs))} ${esc(r.pack || '')} (${q2(Number(r.chosen_units))} ${u}) · ${fmt(Number(r.chosen_total), 0)} บาท`) + ref('ต้นทุนต่อ ' + u, `<b>${fmt(Number(r.chosen_cpu), 2)} บาท</b>${po ? ` <span style="color:${pctColor(pctVs(Number(r.chosen_cpu), po))}">(${pctText(pctVs(Number(r.chosen_cpu), po))})</span>` : ''}`) : ref('สั่งจริง', '—')}</div>
    </div>
    ${opts.length ? `<div class="scroll" style="margin-bottom:14px"><table class="t"><thead><tr><th>รายการ</th>${opts.map(o => `<th class="r" style="${o.letter === chosenL ? 'background:#003049;color:#fff' : ''}">ตัวเลือก ${o.letter}${o.letter === chosenL ? ' ✓' : ''}<div style="font-weight:500">${q2(o.packs)} ${esc(r.pack || '')}</div>${o.label ? `<div style="font-weight:400">${esc(o.label)}</div>` : ''}</th>`).join('')}</tr></thead><tbody>
      <tr><td>ราคารวม (บาท)</td>${opts.map(o => cell(o, o.total ? fmt(o.total, 0) : '—')).join('')}</tr>
      <tr><td>จำนวน (${u})</td>${opts.map(o => cell(o, q2(o.units))).join('')}</tr>
      <tr><td style="font-weight:600">ต้นทุนต่อ ${u}</td>${opts.map(o => cell(o, o.cpu != null ? `<b>${fmt(o.cpu, 2)}</b>` : '—')).join('')}</tr>
      <tr><td>ใช้ได้อีกหลังสั่ง</td>${opts.map(o => cell(o, o.months_after != null ? o.months_after.toFixed(1) + ' เดือน' : '—')).join('')}</tr>
      <tr><td>เทียบ PO</td>${opts.map(o => cell(o, o.diff_pct != null ? pctText(o.diff_pct) : '—', pctColor(o.diff_pct))).join('')}</tr>
      <tr><td>ประหยัด / (จ่ายเพิ่ม)</td>${opts.map(o => cell(o, o.save != null ? (o.save >= 0 ? fmt(o.save, 2) : '(' + fmt(-o.save, 2) + ')') : '—', o.save != null ? (o.save >= 0 ? '#1f7a55' : '#a4161a') : '')).join('')}</tr>
    </tbody></table></div>` : ''}
    ${isLate ? `<div class="card pad" style="margin-bottom:14px;background:#fbf8f1"><div class="title" style="margin-bottom:8px">ตัดสินใจสั่งแล้ว?</div>
      <div class="small muted" style="margin-bottom:10px">เลือกตัวที่สั่ง (บันทึกได้ครั้งเดียว — ตัวเลขการเปรียบเทียบเดิมไม่เปลี่ยน)</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px">${opts.filter(o => o.cpu != null).map(o => `<button type="button" class="chip" data-late="${o.letter}">สั่ง ${o.letter} · ${fmt(o.cpu, 2)}</button>`).join('')}<button type="button" class="chip" data-late="other">อื่นๆ</button></div>
      <div id="lateOther" style="display:none" class="grid2"><div class="field" style="margin:0"><label for="lPk">จำนวน${esc(r.pack || '')}</label><input id="lPk" inputmode="decimal"></div><div class="field" style="margin:0"><label for="lTot">ราคารวม (บาท)</label><input id="lTot" inputmode="decimal"></div></div></div>` : ''}
    <div class="grid2">
      <div class="field"><label for="phSt">สถานะ</label><select id="phSt">${Object.entries(PH_ST).map(([k, [l]]) => `<option value="${k}" ${r.status === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div class="field"><label for="phDate">วันที่</label><input id="phDate" type="date" value="${esc(r.decided_on)}"></div>
      <div class="field"><label for="phPo">เลขที่ PO / ใบเสนอราคา</label><input id="phPo" value="${esc(r.po_no || '')}"></div>
      <div class="field"><label for="phNote">หมายเหตุ</label><input id="phNote" value="${esc(r.note || '')}"></div>
    </div>
    <div id="phMsg"></div>
    <div class="actions">${mine ? '<button type="button" class="btn danger" id="phDel" style="margin-right:auto">ลบ</button>' : ''}<button type="button" class="btn soft" id="phCopy">⧉ คัดลอกไปคำนวณใหม่</button><button type="button" class="btn ghost" id="phClose">ปิด</button><button type="button" class="btn" id="phSave">บันทึกการแก้ไข</button></div>`, true);
  let late = null;
  const msg = t => { $('#phMsg').innerHTML = `<div class="err">${esc(t)}</div>`; };
  $('#phClose').onclick = closeModal;
  $$('[data-late]').forEach(b => b.onclick = () => { late = b.dataset.late; $$('[data-late]').forEach(x => x.classList.toggle('on', x === b)); $('#lateOther').style.display = late === 'other' ? 'grid' : 'none'; if (late !== 'none') $('#phSt').value = 'ordered'; });
  $('#phCopy').onclick = () => {
    Object.assign(P, { code: r.sku_code && S.skus.some(s => s.code === r.sku_code) ? r.sku_code : '', stock: String(r.stock ?? ''), avg: String(r.avg_usage ?? ''), perBox: String(r.per_box ?? '1'), po: r.po_price != null ? String(r.po_price) : '',
      opts: (r.options && r.options.length ? r.options : [{}]).map(o => ({ label: o.label || '', packs: o.packs ? String(o.packs) : '', total: o.total ? String(o.total) : '' })), dec: newDec(), view: 'calc', err: null });
    closeModal(); if (location.hash !== '#promo') location.hash = '#promo'; else render(); window.scrollTo(0, 0);
    toast('คัดลอกตัวเลขเดิมมาแล้ว — ตรวจสต็อกและยอดใช้ปัจจุบันก่อนคำนวณ (ระบบใช้ค่าตามที่บันทึกไว้)');
  };
  const del = $('#phDel'); if (del) del.onclick = async () => {
    if (!del.dataset.sure) { del.dataset.sure = '1'; del.textContent = 'ยืนยันลบ — ลบแล้วกู้คืนไม่ได้'; return; }
    del.disabled = true;
    const { error } = await sb.from('stock_promo_calcs').delete().eq('id', r.id);
    if (error) { del.disabled = false; return msg(errMsg(error)); }
    PH.list = PH.list.filter(x => x.id !== r.id); closeModal(); toast('ลบรายการแล้ว'); render();
  };
  $('#phSave').onclick = async () => {
    const upd = { status: $('#phSt').value, decided_on: $('#phDate').value || r.decided_on, po_no: $('#phPo').value.trim() || null, note: $('#phNote').value.trim() || null };
    if (late) {
      const perBox = Number(r.per_box) || 1, avg = Number(r.avg_usage) || 0, stock = Number(r.stock) || 0;
      let c;
      if (late === 'other') { const packs = num($('#lPk').value), total = num($('#lTot').value), units = packs * perBox; if (!(units > 0 && total > 0)) return msg('กรอกจำนวนและราคารวมที่สั่งจริง'); c = { label: null, packs, total, units, cpu: total / units }; }
      else { const o = opts.find(x => x.letter === late); c = { label: o.label || null, packs: o.packs, total: o.total, units: o.units, cpu: o.cpu }; }
      Object.assign(upd, { decision: late, chosen_label: c.label, chosen_packs: c.packs, chosen_total: c.total, chosen_units: c.units, chosen_cpu: r4(c.cpu), chosen_months_after: avg > 0 ? r4((stock + c.units) / avg) : null });
    } else if (r.decision === 'none' && upd.status === 'ordered') return msg('ถ้าสั่งแล้ว เลือกก่อนว่าสั่งตัวเลือกไหน');
    $('#phSave').disabled = true;
    const { data, error } = await sb.from('stock_promo_calcs').update(upd).eq('id', r.id).select().single();
    if (error) { $('#phSave').disabled = false; return msg(errMsg(error)); }
    PH.list = PH.list.map(x => x.id === r.id ? data : x); closeModal(); toast('✓ บันทึกการแก้ไขแล้ว'); render();
  };
}

/** Card for the item detail page: past orders from saved calculations + unit-price trend. */
function promoSkuCard(code, unitDefault) {
  if (!PH.list) { if (!PH.loading) loadPromoHist(); return ''; }
  const rows = PH.list.filter(r => r.sku_code === code);
  if (!rows.length) return `<div class="card pad" style="margin-bottom:18px"><div class="title" style="margin-bottom:6px">ประวัติการสั่ง (จากการคำนวณโปร)</div><div class="small muted">ยังไม่มี — เมื่อคำนวณโปรโมชั่นแล้วกดบันทึก รายการจะขึ้นที่นี่</div></div>`;
  const u = esc(rows[0].unit || unitDefault || '');
  const pts = rows.filter(r => r.status === 'ordered' && r.chosen_cpu != null).slice(0, 8).reverse();
  let chart = '';
  if (pts.length >= 2) {
    const W = 320, H = 150, L = 34, R = 300, T = 28, B = 112, vs = pts.map(p => Number(p.chosen_cpu)), lo = Math.min(...vs), hi = Math.max(...vs), span = hi - lo || 1;
    const X = i => L + (R - L) * (pts.length === 1 ? 0.5 : i / (pts.length - 1)), Y = v => B - (B - T) * (v - lo) / span;
    chart = `<div style="flex:1 1 280px"><div class="small muted" style="margin-bottom:6px">ราคาต่อ ${u} ที่ได้แต่ละรอบ (เฉพาะที่สั่งแล้ว)</div>
      <svg viewBox="0 0 ${W} ${H}" width="100%" style="max-width:380px" role="img" aria-label="ราคาต่อหน่วยแต่ละรอบ">
        <line x1="${L - 10}" y1="${B + 8}" x2="${R + 10}" y2="${B + 8}" stroke="#dfe5de"/>
        <polyline points="${pts.map((p, i) => `${X(i)},${Y(vs[i])}`).join(' ')}" fill="none" stroke="#003049" stroke-width="2.5"/>
        ${pts.map((p, i) => { const last = i === pts.length - 1; return `<circle cx="${X(i)}" cy="${Y(vs[i])}" r="${last ? 5 : 4}" fill="${last ? '#1f7a55' : '#003049'}"/><text x="${X(i)}" y="${Y(vs[i]) - 9}" font-size="10.5" text-anchor="middle" fill="${last ? '#1f7a55' : '#46524c'}" ${last ? 'font-weight="600"' : ''}>${fmt(vs[i], vs[i] >= 1000 ? 0 : 2)}</text><text x="${X(i)}" y="${H - 8}" font-size="10" text-anchor="middle" fill="#5f6b64">${esc(shortD(p.decided_on).replace(/^\d+ /, ''))}</text>`; }).join('')}
      </svg></div>`;
  }
  return `<div class="card pad" style="margin-bottom:18px">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px"><div class="title">ประวัติการสั่ง (จากการคำนวณโปร)</div><a href="#promo" class="linkbtn" id="skuPh">ดูทั้งหมด →</a></div>
    <div class="flex" style="gap:24px">
      <div style="flex:1 1 340px;position:relative;padding-left:22px">
        <div style="position:absolute;left:6px;top:6px;bottom:14px;width:2px;background:#dfe5de"></div>
        ${rows.slice(0, 5).map(r => { const dot = r.status === 'ordered' ? '#003049' : r.status === 'pending' ? '#e0982b' : '#8a958e'; return `<div style="position:relative;padding-bottom:14px">
          <span style="position:absolute;left:-20px;top:5px;width:10px;height:10px;border-radius:50%;background:${dot};box-shadow:0 0 0 2px #fff,0 0 0 3px ${dot}"></span>
          <a href="#" class="linkbtn" data-skuph="${r.id}" style="font-size:14px;font-weight:600;text-decoration:none;color:#142433">${shortD(r.decided_on)} · ${esc(r.decision === 'none' ? 'ยังไม่สั่ง' : 'สั่ง ' + decLabel(r.decision).replace('ตัวเลือก ', ''))}</a> ${stPill(r.status)}
          <div class="small">${r.chosen_cpu != null ? `${q2(Number(r.chosen_packs))} ${esc(r.pack || '')} (${q2(Number(r.chosen_units))} ${u}) · ${fmt(Number(r.chosen_total), 0)} บาท · <b>${fmt(Number(r.chosen_cpu), 2)} บาท/${u}</b>` : `เทียบ ${esc(optSummary(r))}`}</div>
          <div class="small muted">${esc([r.chosen_label, r.note].filter(Boolean).join(' · '))}${r.avg_usage != null ? `${r.chosen_label || r.note ? ' · ' : ''}ใช้เฉลี่ยตอนนั้น ${q2(Number(r.avg_usage))} ${u}/ด.` : ''} · ${esc(r.created_by_name || '')}</div></div>`; }).join('')}
      </div>${chart}
    </div></div>`;
}
function promoSkuBind(code) {
  $$('[data-skuph]').forEach(a => a.onclick = e => { e.preventDefault(); phOpen(+a.dataset.skuph); });
  const all = $('#skuPh'); if (all) all.onclick = () => { PH.q = code; PH.f = 'all'; P.view = 'hist'; };
}

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
