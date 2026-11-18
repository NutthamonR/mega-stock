/* Overview + item detail */
'use strict';
const STATUS = {
  critical: { label: 'ต่ำกว่าจุดสั่งซื้อ', dot: '#C1121F', bg: '#f9e3e4', fg: '#780000', rank: 0 },
  warning: { label: 'ใกล้หมด', dot: '#e0982b', bg: '#fdf4e3', fg: '#8a5410', rank: 1 },
  ok: { label: 'ปกติ', dot: '#2f9e73', bg: '#e9f6ef', fg: '#1f7a55', rank: 2 },
  nostock: { label: 'ไม่มีข้อมูลสต็อก', dot: '#8a958e', bg: '#edf1ec', fg: '#46524c', rank: 3 },
  inactive: { label: 'ไม่มีการใช้', dot: '#8a958e', bg: '#edf1ec', fg: '#46524c', rank: 4 },
};
function settings() { return Object.assign({ warn: 2, target: 6, view: 'table' }, lsGet('settings', {})); }

/** Averages always use the full calendar months BEFORE the current month (e.g. in Nov: Aug–Oct for 3 months).
 *  The current month is shown as partial and never averaged; months without data count as 0. */
function prevMonthISO() { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`; }
function monthWindow() {
  const ms = S.months; if (!ms.length) return { all: [], complete: [], partial: null, stale: false, prev: prevMonthISO() };
  const cur = thisMonthISO(), prev = prevMonthISO(), lastData = ms[ms.length - 1];
  const end = lastData >= cur ? cur : prev;
  const list = []; let [y, m] = ms[0].split('-').map(Number);
  const [ly, lm] = end.split('-').map(Number);
  while (y < ly || (y === ly && m <= lm)) { list.push(`${y}-${String(m).padStart(2, '0')}-01`); m++; if (m > 12) { m = 1; y++; } }
  const pc = S.coverage && S.coverage[prev], prevThrough = pc && pc.through;
  return { all: list, complete: list.filter(x => x < cur), partial: list.includes(cur) ? cur : null, stale: lastData < prev, prevShort: !!(prevThrough && prevThrough < mEnd(prev)), prevThrough, prev, lastData };
}
function computeItem(sku) {
  const st = settings(), W = monthWindow();
  const u = S.usage[sku.code] || {};
  const series = W.all.map(mo => ({ month: mo, v: u[mo] || 0 }));
  const comp = W.complete.map(mo => u[mo] || 0);
  const avg = n => comp.length ? comp.slice(-n).reduce((a, b) => a + b, 0) / Math.min(n, comp.length) : 0;
  const avg3 = avg(3), avg6 = avg(6);
  const last = comp.length ? comp[comp.length - 1] : 0;
  const lastMonth = W.complete[W.complete.length - 1] || null;
  const partialV = W.partial ? (u[W.partial] || 0) : null;
  const sk = S.stock[sku.code];
  const stock = sk ? sk.qty : null;
  const months = avg3 > 0 && stock != null ? stock / avg3 : null;
  let status;
  if (avg3 <= 0 && (stock == null || stock <= 0)) status = 'inactive';
  else if (stock == null) status = 'nostock';
  else if (stock <= 0 || (months != null && months < st.warn)) status = 'critical';
  else if (months != null && months < st.warn + 1.5) status = 'warning';
  else status = 'ok';
  let trend = '→', trendColor = '#5f6b64';
  if (avg6 > 0 && last > avg6 * 1.05) { trend = '↑'; trendColor = '#b0532f'; } else if (avg6 > 0 && last < avg6 * 0.95) { trend = '↓'; trendColor = '#1f7a55'; }
  const need = avg3 > 0 ? Math.max(0, avg3 * st.target - (stock || 0)) : 0;
  const per = Number(sku.units_per_purchase) || 0;
  const needPacks = need > 0 && per > 0 && !(per === 1 && (sku.purchase_unit || '') === (sku.stock_unit || '')) ? Math.ceil(need / per) : null;
  return { sku, code: sku.code, name: sku.name, unit: sku.stock_unit || '', category: sku.category || 'อื่นๆ', supplier: sku.supplier || '',
    series, avg3, avg6, last, lastMonth, partialV, partialMonth: W.partial, stock, stockAsOf: sk && sk.as_of, months, status, trend, trendColor, need, needPacks };
}
function statusPill(s) { const m = STATUS[s]; return `<span class="status" style="background:${m.bg};color:${m.fg}"><span class="dot" style="background:${m.dot};width:7px;height:7px"></span>${m.label}</span>`; }
/** Which days a month's total covers, from stock_month_coverage. '' when the whole month is covered. */
function mEnd(m) { const d = new Date(m + 'T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() + 1); d.setUTCDate(0); return d.toISOString().slice(0, 10); }
function covThrough(m) { const c = S.coverage && S.coverage[m]; return c && c.through ? c.through : null; }
function covShort(m) { const t = covThrough(m); return t && t < mEnd(m) ? `1–${Number(t.slice(8))}` : ''; }
function covLong(m) { const t = covThrough(m); return t && t < mEnd(m) ? `ข้อมูล 1–${Number(t.slice(8))} ${TH_M[+m.slice(5, 7) - 1]}` : ''; }
function mLabelCov(m) { const c = covShort(m); return mLabel(m) + (c ? ` (${c})` : ''); }
function monthsText(it) { return it.months == null ? '—' : it.months >= 99 ? '99+ เดือน' : it.months.toFixed(1) + ' เดือน'; }

VIEWS.overview = {
  html() {
    if (S.detail) return VIEWS.overview.detailHtml();
    const st = settings(), ui = S.ui.ov = S.ui.ov || { q: '', cat: 'all', stat: 'all', sort: 'urgent' };
    const all = S.skus.filter(s => s.is_tracked).map(computeItem);
    const crit = all.filter(x => x.status === 'critical').length, warn = all.filter(x => x.status === 'warning').length;
    const fin = all.filter(x => x.months != null && ['ok', 'warning', 'critical'].includes(x.status));
    const cov = fin.length ? (fin.reduce((a, b) => a + Math.min(b.months, 24), 0) / fin.length).toFixed(1) : '—';
    const W = monthWindow();
    const lastLbl = W.complete.length ? mLabelCov(W.complete[W.complete.length - 1]) : '—';
    const qq = ui.q.trim().toLowerCase();
    let rows = all.filter(x => (!qq || [x.code, x.name, x.supplier, x.sku.jera_name].some(v => (v || '').toLowerCase().includes(qq))) &&
      (ui.cat === 'all' || x.category === ui.cat) && (ui.stat === 'all' || x.status === ui.stat));
    const sorters = { urgent: (a, b) => STATUS[a.status].rank - STATUS[b.status].rank || (a.months ?? 999) - (b.months ?? 999),
      months: (a, b) => (a.months ?? 999) - (b.months ?? 999), usage: (a, b) => b.avg3 - a.avg3, name: (a, b) => a.name.localeCompare(b.name) };
    rows.sort(sorters[ui.sort] || sorters.urgent);
    const cats = ['all', ...new Set(all.map(x => x.category))];
    const statChips = [['all', 'ทุกสถานะ'], ['critical', 'ต่ำกว่าจุดสั่งซื้อ'], ['warning', 'ใกล้หมด'], ['ok', 'ปกติ'], ['nostock', 'ไม่มีข้อมูลสต็อก']];
    const kpi = (l, v, h, dot, color) => `<div class="kpi"><div class="l"><span class="dot" style="background:${dot}"></span>${l}</div><div class="v" style="color:${color || '#142433'}">${v}</div><div class="h2">${h}</div></div>`;
    const tbl = `<div class="card" style="overflow:hidden"><div class="scroll"><table class="t" style="min-width:980px">
      <thead><tr><th>สินค้า</th><th>หมวด</th><th class="r">คงเหลือ</th><th class="r">ใช้ ${lastLbl}</th><th class="r">เฉลี่ย 3 ด.</th><th class="r">เฉลี่ย 6 ด.</th><th>พอใช้อีก</th><th class="r">ควรสั่ง (ถึง ${st.target} ด.)</th><th>สถานะ</th></tr></thead>
      <tbody>${rows.map(x => `<tr class="click" data-open="${esc(x.code)}" tabindex="0">
        <td><div style="font-weight:600;font-size:14.5px">${esc(x.name)}</div><div class="small muted">${esc(x.code)}${x.unit ? ' · ' + esc(x.unit) : ''}</div></td>
        <td><span class="tag">${esc(x.category)}</span></td>
        <td class="r" style="font-weight:600">${x.stock == null ? '—' : q2(x.stock)}</td>
        <td class="r">${q2(x.last)} <span style="color:${x.trendColor}">${x.trend}</span></td>
        <td class="r">${q2(x.avg3)}</td><td class="r muted">${q2(x.avg6)}</td>
        <td><div style="font-weight:600;font-size:13.5px;color:${STATUS[x.status].fg}">${monthsText(x)}</div><div class="mbar"><div style="width:${x.months == null ? 0 : Math.min(x.months / st.target, 1) * 100}%;background:${STATUS[x.status].dot}"></div></div></td>
        <td class="r">${x.need > 0 ? `${q2(Math.ceil(x.need))} ${esc(x.unit)}${x.needPacks ? `<div class="small muted">≈ ${x.needPacks} ${esc(x.sku.purchase_unit || '')}</div>` : ''}` : '<span class="muted">—</span>'}</td>
        <td>${statusPill(x.status)}</td></tr>`).join('') || '<tr><td colspan="9" class="empty">ไม่พบรายการ</td></tr>'}</tbody></table></div></div>`;
    const cards = `<div class="cards">${rows.map(x => `<button class="scard" data-open="${esc(x.code)}" style="border-left:4px solid ${STATUS[x.status].dot}">
        <div style="display:flex;justify-content:space-between;gap:10px;margin-bottom:12px"><div><div style="font-weight:600;font-size:16px">${esc(x.name)}</div><div class="small muted">${esc(x.category)} · ${esc(x.code)}</div></div>${statusPill(x.status)}</div>
        <div style="display:flex;align-items:baseline;gap:8px"><span class="h" style="font-weight:700;font-size:26px">${x.stock == null ? '—' : q2(x.stock)}</span><span class="muted" style="font-size:13px">${esc(x.unit)} คงเหลือ</span></div>
        <div style="font-size:12.5px;color:${STATUS[x.status].fg};font-weight:500;margin:4px 0 12px">พอใช้อีก ${monthsText(x)}</div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;text-align:center;border-top:1px solid #edf1ec;padding-top:11px">
          <div><div class="small muted">${lastLbl}</div><b>${q2(x.last)}</b></div><div><div class="small muted">เฉลี่ย 3ด.</div><b>${q2(x.avg3)}</b></div><div><div class="small muted">ควรสั่ง</div><b>${x.need > 0 ? q2(Math.ceil(x.need)) : '—'}</b></div></div>
      </button>`).join('') || '<div class="empty">ไม่พบรายการ</div>'}</div>`;
    return `<div class="pagehead"><div><h1>ภาพรวมสต็อก</h1>
        <div class="sub">สต็อก ณ ${dLabel(S.stockDate)} · ยอดใช้ถึง ${S.usageThrough ? dLabel(S.usageThrough) : (W.lastData ? mLabel(W.lastData < W.prev ? W.lastData : W.prev) : '—')}${W.partial ? ` (เดือน ${mLabelCov(W.partial)} ยังไม่ครบเดือน ไม่นำมาคิดค่าเฉลี่ย)` : ''}</div>${W.complete.length ? `<div class="sub">ค่าเฉลี่ย 3 เดือน = ${mLabel(W.complete[Math.max(0, W.complete.length - 3)])} – ${mLabel(W.complete[W.complete.length - 1])} · 6 เดือน = ${mLabel(W.complete[Math.max(0, W.complete.length - 6)])} – ${mLabel(W.complete[W.complete.length - 1])}</div>` : ''}</div>
        <div class="flex" style="align-items:center">
          <label class="small muted" for="setWarn">แจ้งเตือนเมื่อพอใช้ต่ำกว่า</label>
          <select id="setWarn" class="input" style="width:auto;padding:7px 10px">${[1, 1.5, 2, 2.5, 3, 4].map(v => `<option value="${v}" ${st.warn == v ? 'selected' : ''}>${v} เดือน</option>`).join('')}</select>
          <label class="small muted" for="setTarget">เป้าสต็อก</label>
          <select id="setTarget" class="input" style="width:auto;padding:7px 10px">${[3, 4, 5, 6, 8, 10, 12].map(v => `<option value="${v}" ${st.target == v ? 'selected' : ''}>${v} เดือน</option>`).join('')}</select>
          <div class="seg"><button data-view="table" class="${st.view === 'table' ? 'on' : ''}">☰ ตาราง</button><button data-view="cards" class="${st.view === 'cards' ? 'on' : ''}">▦ การ์ด</button></div>
        </div></div>
      ${!W.stale && W.prevShort ? `<div class="warnbox">⚠ ยอดใช้เดือน ${mLabel(W.prev)} มีข้อมูลถึงวันที่ ${dLabel(W.prevThrough)} เท่านั้น — ค่าเฉลี่ยที่รวมเดือนนี้จะต่ำกว่าความจริง ควรนำเข้ารายงานเคลื่อนไหวให้ครบเดือน</div>` : ''}${W.stale ? `<div class="warnbox">⚠ ยังไม่มียอดใช้เดือน ${mLabel(W.prev)} ในระบบ (ข้อมูลล่าสุดถึง ${mLabel(W.lastData)}) — เดือนที่ไม่มีข้อมูลจะถูกนับเป็น 0 ทำให้ค่าเฉลี่ยต่ำกว่าความจริง ควรนำเข้าไฟล์ล่าสุดในเมนูนำเข้าข้อมูล</div>` : ''}<div class="kpis">${kpi('SKU ที่ติดตาม', all.length, 'รายการที่เปิดติดตามอยู่', '#003049')}${kpi('ต่ำกว่าจุดสั่งซื้อ', crit, `พอใช้ไม่ถึง ${st.warn} เดือน`, '#C1121F', crit ? '#780000' : '')}${kpi('ใกล้หมด', warn, 'ควรวางแผนสั่ง', '#e0982b', warn ? '#8a5410' : '')}${kpi('ครอบคลุมเฉลี่ย', cov + ' ด.', 'จากเฉลี่ยใช้ 3 เดือน', '#669BBC')}</div>
      <div class="toolbar">
        <div class="search"><input id="ovQ" type="search" placeholder="ค้นหาชื่อยา / รหัส / บริษัท…" value="${esc(ui.q)}" aria-label="ค้นหา"></div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">${statChips.map(([k, l]) => `<button class="chip ${ui.stat === k ? 'on' : ''}" data-stat="${k}">${l}</button>`).join('')}</div>
        <select id="ovSort" class="input" style="width:auto" aria-label="เรียงลำดับ">${[['urgent', 'เรียง: ด่วนก่อน'], ['months', 'เรียง: พอใช้น้อยสุด'], ['usage', 'เรียง: ใช้เยอะสุด'], ['name', 'เรียง: ชื่อ A–Z']].map(([v, l]) => `<option value="${v}" ${ui.sort === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:16px">${cats.map(c => `<button class="pillchip ${ui.cat === c ? 'on' : ''}" data-cat="${esc(c)}">${c === 'all' ? 'ทั้งหมด' : esc(c)}</button>`).join('')}</div>
      ${st.view === 'cards' ? cards : tbl}
      <div class="foot">แสดง ${rows.length} จาก ${all.length} รายการ · คลิกที่สินค้าเพื่อดูยอดใช้รายเดือน</div>`;
  },
  bind() {
    if (S.detail) return VIEWS.overview.detailBind();
    const ui = S.ui.ov;
    const q = $('#ovQ'); q.oninput = () => { ui.q = q.value; const pos = q.selectionStart; render(); const n = $('#ovQ'); n.focus(); n.setSelectionRange(pos, pos); };
    $$('[data-stat]').forEach(b => b.onclick = () => { ui.stat = b.dataset.stat; render(); });
    $$('[data-cat]').forEach(b => b.onclick = () => { ui.cat = b.dataset.cat; render(); });
    $('#ovSort').onchange = e => { ui.sort = e.target.value; render(); };
    $$('[data-view]').forEach(b => b.onclick = () => { lsSet('settings', Object.assign(settings(), { view: b.dataset.view })); render(); });
    $('#setWarn').onchange = e => { lsSet('settings', Object.assign(settings(), { warn: Number(e.target.value) })); render(); };
    $('#setTarget').onchange = e => { lsSet('settings', Object.assign(settings(), { target: Number(e.target.value) })); render(); };
    $$('[data-open]').forEach(el => { el.onclick = () => { S.detail = el.dataset.open; render(); window.scrollTo(0, 0); }; el.onkeydown = e => { if (e.key === 'Enter') el.click(); }; });
  },
  detailHtml() {
    const sku = S.skus.find(s => s.code === S.detail); if (!sku) { S.detail = null; return VIEWS.overview.html(); }
    const it = computeItem(sku), st = settings();
    const series = it.series.slice(-24), max = Math.max(1, ...series.map(x => x.v));
    const years = [...new Set(series.map(x => x.month.slice(0, 4)))];
    const yColor = y => y === years[years.length - 1] ? '#003049' : '#669BBC';
    const stat = (l, v, h, c) => `<div class="card pad" style="padding:14px 16px"><div class="small muted" style="margin-bottom:6px">${l}</div><div class="h" style="font-weight:700;font-size:22px;color:${c || '#142433'}">${v}</div><div class="small muted" style="margin-top:3px">${h}</div></div>`;
    return `<button class="btn ghost small" id="back" style="margin:6px 0 16px">← กลับภาพรวม</button>
      <div class="pagehead"><div>
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap"><h1 style="margin:0">${esc(it.name)}</h1>${statusPill(it.status)}</div>
        <div class="sub" style="margin-top:6px">${esc(it.code)} · ${esc(it.category)} · หน่วย: ${esc(it.unit || '—')}${sku.units_per_purchase ? ` · 1 ${esc(sku.purchase_unit)} = ${q2(sku.units_per_purchase)} ${esc(it.unit)}` : ''}</div>
        <div class="sub">${esc(it.supplier)}</div></div>
        <a class="btn" href="#promo" id="toPromo">🏷 คำนวณโปรโมชั่น</a></div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:22px">
        ${stat('คงเหลือ', it.stock == null ? '—' : q2(it.stock), it.stockAsOf ? 'ณ ' + dLabel(it.stockAsOf) : 'ไม่มีข้อมูลสต็อก', STATUS[it.status].fg)}
        ${stat('ใช้ ' + (it.lastMonth ? mLabel(it.lastMonth) : ''), q2(it.last), it.lastMonth && covLong(it.lastMonth) ? covLong(it.lastMonth) : 'เดือนล่าสุดที่ครบเดือน')}
        ${stat('เฉลี่ย 3 เดือน', q2(it.avg3), (it.unit || 'หน่วย') + '/เดือน')}
        ${stat('เฉลี่ย 6 เดือน', q2(it.avg6), (it.unit || 'หน่วย') + '/เดือน')}
        ${stat('พอใช้อีก', monthsText(it), 'จากเฉลี่ย 3 เดือน', STATUS[it.status].fg)}
        ${stat(`ควรสั่ง (ถึง ${st.target} ด.)`, it.need > 0 ? q2(Math.ceil(it.need)) : '—', it.needPacks ? `≈ ${it.needPacks} ${esc(sku.purchase_unit || '')}` : (it.unit || ''))}
      </div>
      ${it.partialMonth ? `<div class="info">เดือน ${mLabel(it.partialMonth)} ยังไม่ครบเดือน${covThrough(it.partialMonth) ? ` (ข้อมูลถึง ${dLabel(covThrough(it.partialMonth))})` : ''} — ใช้ไปแล้ว ${q2(it.partialV)} ${esc(it.unit)} (ไม่นำมาคิดค่าเฉลี่ย)</div>` : ''}
      <div class="card pad" style="margin-bottom:18px">
        <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:10px;margin-bottom:12px"><div class="title">ยอดใช้รายเดือน</div>
          <div style="display:flex;gap:16px" class="small muted">${years.map(y => `<span style="display:inline-flex;align-items:center;gap:6px"><span style="width:11px;height:11px;border-radius:3px;background:${yColor(y)}"></span>ปี ${Number(y) + 543}</span>`).join('')}</div></div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:10px">
          <span class="small muted" style="margin-right:4px">เลือกช่วง:</span>
          ${VIEWS.overview.presets(series, it).map((pr, k) => `<button type="button" class="pillchip" data-pre="${k}">${pr.label}</button>`).join('')}
          <button type="button" class="pillchip" data-pre="clear">ล้าง</button>
        </div>
        <div id="selBox"></div>
        <div class="small muted" style="margin:4px 0 10px">กดค้างที่แท่งเดือนแรกแล้วลากไปเดือนสุดท้าย (หรือคลิกเดือนแรก แล้ว Shift+คลิกเดือนสุดท้าย) — เลือกในตารางด้านล่างได้เหมือนกัน</div>
        <div class="scroll" style="padding-bottom:6px"><div class="bars" id="bars" style="user-select:none;touch-action:pan-x">${series.map((x, i) => `<div class="b" data-i="${i}" title="${mLabelCov(x.month)}: ${q2(x.v)}"><div class="v">${q2(x.v)}</div><div class="col" style="height:${(x.v / max * 100).toFixed(1)}%;background:${yColor(x.month.slice(0, 4))};${x.month === it.partialMonth ? 'opacity:.45' : ''}"></div></div>`).join('')}</div>
        <div class="blabels">${series.map(x => `<div>${mLabel(x.month)}${covShort(x.month) ? `<div style="font-size:9.5px;color:#8a5410;margin-top:2px">${covShort(x.month)}</div>` : ''}</div>`).join('')}</div></div>
      </div>
      <div class="card" style="overflow:hidden"><div style="padding:15px 20px" class="title">ตารางยอดใช้รายเดือน</div><div class="scroll"><table class="t" id="mtable"><thead><tr><th>เดือน</th><th class="r">ยอดใช้ (${esc(it.unit || 'หน่วย')})</th><th>สัดส่วน</th></tr></thead>
        <tbody>${series.map((x, i) => ({ x, i })).reverse().map(({ x, i }) => `<tr class="click" data-ri="${i}"><td>${mLabel(x.month)}${covLong(x.month) ? ` <span class="small" style="color:#8a5410">(${covLong(x.month)})</span>` : x.month === it.partialMonth ? ' <span class="small muted">(ยังไม่ครบเดือน)</span>' : ''}</td><td class="r" style="font-weight:600">${q2(x.v)}</td><td><div style="max-width:200px;height:7px;background:#edf1ec;border-radius:4px;overflow:hidden"><div style="height:100%;width:${(x.v / max * 100).toFixed(1)}%;background:${yColor(x.month.slice(0, 4))}"></div></div></td></tr>`).join('')}</tbody></table></div></div>`;
  },
  /** Quick ranges — "latest" means the newest COMPLETE months (the partial current month is left out). */
  presets(series, it) {
    const lastC = series.length - 1 - (it.partialMonth && series[series.length - 1].month === it.partialMonth ? 1 : 0);
    const out = [3, 6, 12].filter(n => lastC + 1 >= n).map(n => ({ label: `${n} เดือนล่าสุด`, a: lastC - n + 1, b: lastC }));
    [...new Set(series.map(x => x.month.slice(0, 4)))].reverse().forEach(y => {
      const idx = series.map((x, i) => x.month.startsWith(y) && i <= lastC ? i : -1).filter(i => i >= 0);
      if (idx.length) out.push({ label: `ปี ${Number(y) + 543}${idx.length < 12 ? ` (${idx.length} ด.)` : ''}`, a: idx[0], b: idx[idx.length - 1] });
    });
    return out;
  },
  detailBind() {
    $('#back').onclick = () => { S.detail = null; render(); };
    $('#toPromo').onclick = () => { if (window.promoPick) window.promoPick(S.detail); };
    const sku = S.skus.find(s => s.code === S.detail), it = computeItem(sku), series = it.series.slice(-24);
    const presets = VIEWS.overview.presets(series, it);
    const sel = S.ui.sel && S.ui.sel.code === S.detail ? S.ui.sel : (S.ui.sel = Object.assign({ code: S.detail }, presets[0] ? { a: presets[0].a, b: presets[0].b } : { a: null, b: null }));
    const update = () => {
      const has = sel.a != null && sel.b != null, lo = has ? Math.min(sel.a, sel.b) : -1, hi = has ? Math.max(sel.a, sel.b) : -1;
      $$('#bars .b').forEach(el => { const i = +el.dataset.i, on = i >= lo && i <= hi; el.classList.toggle('sel', on); el.classList.toggle('dim', has && !on); });
      $$('#mtable tr[data-ri]').forEach(el => { const i = +el.dataset.ri; el.classList.toggle('sel', i >= lo && i <= hi); });
      $$('[data-pre]').forEach(b => { const pr = presets[+b.dataset.pre]; b.classList.toggle('on', !!pr && has && pr.a === lo && pr.b === hi); });
      if (!has) { $('#selBox').innerHTML = ''; return; }
      const pick = series.slice(lo, hi + 1), n = pick.length, sum = pick.reduce((a, x) => a + x.v, 0), avg = sum / n;
      const vals = pick.map(x => x.v), hasPartial = pick.some(x => x.month === it.partialMonth), shortM = pick.filter(x => covShort(x.month));
      const cover = avg > 0 && it.stock != null ? it.stock / avg : null, u = esc(it.unit || '');
      const box = (l, v, h) => `<div><div class="small muted">${l}</div><div class="h num" style="font-weight:700;font-size:21px">${v}</div>${h ? `<div class="small muted">${h}</div>` : ''}</div>`;
      $('#selBox').innerHTML = `<div style="background:#eaf1f6;border:1px solid #cdddea;border-radius:12px;padding:12px 16px;margin-bottom:6px">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:10px">
          <div style="font-weight:600;color:#003049">ช่วงที่เลือก: ${mLabel(pick[0].month)}${n > 1 ? ' – ' + mLabelCov(pick[n - 1].month) : covShort(pick[0].month) ? ` (${covShort(pick[0].month)})` : ''} · ${n} เดือน</div>
          <div style="display:flex;gap:6px"><button type="button" class="btn small ghost" id="selCopy">⧉ คัดลอกตัวเลข</button><button type="button" class="btn small" id="selPromo">ใช้ค่าเฉลี่ยนี้คำนวณโปรโมชั่น</button></div></div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:12px">
          ${box('ยอดใช้รวม', q2(sum), u)}${box('เฉลี่ยต่อเดือน', q2(Math.round(avg * 100) / 100), u + '/เดือน')}
          ${box('สูงสุด / ต่ำสุด', `${q2(Math.max(...vals))} / ${q2(Math.min(...vals))}`, u)}
          ${box('สต็อกพอใช้ (อัตรานี้)', cover == null ? '—' : cover.toFixed(1) + ' เดือน', it.stock == null ? 'ไม่มีข้อมูลสต็อก' : `คงเหลือ ${q2(it.stock)} ${u}`)}
        </div>${shortM.length ? `<div class="small" style="color:#8a5410;margin-top:8px">⚠ ข้อมูลไม่ครบเดือน: ${shortM.map(x => mLabelCov(x.month)).join(', ')} — ยอดรวมและค่าเฉลี่ยของช่วงนี้จะต่ำกว่าความจริง</div>` : hasPartial ? `<div class="small" style="color:#8a5410;margin-top:8px">⚠ ช่วงนี้มีเดือน ${mLabel(it.partialMonth)} ซึ่งยังไม่ครบเดือน ค่าเฉลี่ยจะต่ำกว่าความจริง</div>` : ''}</div>`;
      $('#selPromo').onclick = () => { window.promoPick(S.detail); P.avg = String(Math.round(avg * 100) / 100); location.hash = '#promo'; };
      $('#selCopy').onclick = async () => {
        const t = `${sku.name} ${mLabel(pick[0].month)}–${mLabelCov(pick[n - 1].month)} (${n} เดือน)\tรวม ${q2(sum)} ${it.unit || ''}\tเฉลี่ย ${q2(Math.round(avg * 100) / 100)} ${it.unit || ''}/เดือน`;
        try { await navigator.clipboard.writeText(t); toast('✓ คัดลอกแล้ว'); } catch (e) { toast('คัดลอกไม่ได้ในเบราว์เซอร์นี้'); }
      };
    };
    let drag = false;
    const bars = $('#bars');
    bars.addEventListener('pointerdown', e => {
      const b = e.target.closest('.b'); if (!b) return; const i = +b.dataset.i;
      if (e.shiftKey && sel.a != null) sel.b = i; else { sel.a = i; sel.b = i; drag = true; }
      update(); e.preventDefault();
      try { bars.setPointerCapture(e.pointerId); } catch (er) {}
    });
    bars.addEventListener('pointermove', e => {
      if (!drag) return; const el = document.elementFromPoint(e.clientX, e.clientY); const b = el && el.closest && el.closest('#bars .b');
      if (b && +b.dataset.i !== sel.b) { sel.b = +b.dataset.i; update(); }
    });
    ['pointerup', 'pointercancel'].forEach(ev => bars.addEventListener(ev, () => { drag = false; }));
    $$('#mtable tr[data-ri]').forEach(tr => tr.onclick = e => { const i = +tr.dataset.ri; if (e.shiftKey && sel.a != null) sel.b = i; else { sel.a = i; sel.b = i; } update(); });
    $$('[data-pre]').forEach(b => b.onclick = () => { if (b.dataset.pre === 'clear') { sel.a = sel.b = null; } else { const pr = presets[+b.dataset.pre]; sel.a = pr.a; sel.b = pr.b; } update(); });
    update();
  },
};
