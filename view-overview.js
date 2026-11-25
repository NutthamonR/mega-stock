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
  const avg3raw = avg(3), avg6 = avg(6);
  const last = comp.length ? comp[comp.length - 1] : 0;
  const lastMonth = W.complete[W.complete.length - 1] || null;
  const partialV = W.partial ? (u[W.partial] || 0) : null;
  const sk = S.stock[sku.code];
  const stock = sk ? sk.qty : null;
  const nw = newItemRate(sku, u, W);
  const avg3 = nw ? nw.value : avg3raw;
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
    series, avg3, avg3raw, avg6, last, lastMonth, partialV, partialMonth: W.partial, stock, stockAsOf: sk && sk.as_of, months, status, trend: nw ? '' : trend, trendColor, need, needPacks,
    isNew: !!nw, nw, firstUse: firstUseOf(u) };
}
/** First month with usage. Months before it did not have the product yet. */
function firstUseOf(u) { return Object.keys(u).filter(m => u[m] > 0).sort()[0] || null; }
const NEW_MODES = { latest: 'อัตราเดือนล่าสุด', since: 'เฉลี่ยตั้งแต่เริ่มใช้', lastfull: 'เดือนเต็มล่าสุด', manual: 'กรอกเอง' };
/** A product used for fewer than 3 complete months is "new": the 3-month average would count months before it existed as 0,
 *  so a usage rate is used instead (default: the latest month, with the current month projected to a full month). */
function newItemRate(sku, u, W) {
  const first = firstUseOf(u); if (!first) return null;
  const since = W.complete.filter(m => m >= first);
  if (since.length >= 3) return null;
  const cur = W.partial, thr = cur ? covThrough(cur) : null, days = thr ? Number(thr.slice(8)) : 0, dim = cur ? Number(mEnd(cur).slice(8)) : 0;
  const proj = cur && days >= 7 && (u[cur] || 0) > 0 ? u[cur] / days * dim : null;
  const lastFull = since.length ? since[since.length - 1] : null;
  const projTxt = proj != null ? `อัตรา ${mLabel(cur)} (${q2(u[cur])} ใน ${days} วัน)` : '';
  const opts = {
    latest: proj != null ? { value: proj, text: projTxt } : lastFull ? { value: u[lastFull] || 0, text: `เดือน ${mLabel(lastFull)}` } : { value: 0, text: 'ยังไม่มีข้อมูลพอ' },
    since: (() => { const v = since.map(m => u[m] || 0).concat(proj != null ? [proj] : []); return v.length ? { value: v.reduce((a, b) => a + b, 0) / v.length, text: `เฉลี่ย ${v.length} เดือนตั้งแต่ ${mLabel(first)}` } : { value: 0, text: 'ยังไม่มีข้อมูลพอ' }; })(),
    lastfull: lastFull ? { value: u[lastFull] || 0, text: `เดือน ${mLabel(lastFull)}` } : null,
    manual: sku.manual_rate != null ? { value: Number(sku.manual_rate), text: 'กรอกเอง' } : null,
  };
  let mode = sku.new_rate_mode || 'latest';
  if (!opts[mode]) mode = 'latest';
  const span = since.length + (cur && (u[cur] || 0) > 0 ? 1 : 0);
  const fd = new Date(first + 'T00:00:00Z'); fd.setUTCMonth(fd.getUTCMonth() + 3);
  return { mode, value: opts[mode].value, text: opts[mode].text, opts, first, histMonths: since.length, days, proj,
    tag: since.length ? `ข้อมูล ${span} เดือน` : days ? `ข้อมูล ${days} วัน` : 'เพิ่งเริ่มใช้', fullFrom: fd.toISOString().slice(0, 10) };
}
const newTag = (txt, ml) => `<span class="status" style="background:#e8e1f7;color:#4b2f8a;padding:1px 8px;font-size:11px;margin-left:${ml == null ? 6 : ml}px;vertical-align:1px">สินค้าใหม่${txt ? ' · ' + esc(txt) : ''}</span>`;
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
      <thead><tr><th style="width:46px"><span class="sr-only">ขยาย</span></th><th>สินค้า</th><th>หมวด</th><th class="r">คงเหลือ</th><th class="r">ใช้ ${lastLbl}</th><th class="r">เฉลี่ย 3 ด.</th><th class="r">เฉลี่ย 6 ด.</th><th>พอใช้อีก</th><th class="r">ควรสั่ง (ถึง ${st.target} ด.)</th><th>สถานะ</th></tr></thead>
      <tbody>${rows.map(x => { const o = OPEN.has(x.code); return `<tr class="click ${o ? 'xopen' : ''}" data-exp="${esc(x.code)}" tabindex="0" aria-expanded="${o}">
        <td><span class="xbtn" aria-hidden="true">▶</span></td>
        <td><div style="font-weight:600;font-size:14.5px">${esc(x.name)}${x.isNew ? newTag(x.nw.tag) : ''}</div><div class="small muted">${esc(x.code)}${x.unit ? ' · ' + esc(x.unit) : ''}</div></td>
        <td><span class="tag">${esc(x.category)}</span></td>
        <td class="r" style="font-weight:600">${x.stock == null ? '—' : q2(x.stock)}</td>
        <td class="r">${q2(x.last)} <span style="color:${x.trendColor}">${x.trend}</span></td>
        <td class="r">${x.isNew ? `<b>${q2(Math.round(x.avg3 * 100) / 100)}</b><div class="small muted" style="white-space:nowrap">${esc(x.nw.text)}</div>` : q2(x.avg3)}</td><td class="r muted">${x.isNew ? '—' : q2(x.avg6)}</td>
        <td><div style="font-weight:600;font-size:13.5px;color:${STATUS[x.status].fg}">${monthsText(x)}</div><div class="mbar"><div style="width:${x.months == null ? 0 : Math.min(x.months / st.target, 1) * 100}%;background:${STATUS[x.status].dot}"></div></div></td>
        <td class="r">${x.need > 0 ? `${q2(Math.ceil(x.need))} ${esc(x.unit)}${x.needPacks ? `<div class="small muted">≈ ${x.needPacks} ${esc(x.sku.purchase_unit || '')}</div>` : ''}` : '<span class="muted">—</span>'}</td>
        <td>${statusPill(x.status)}</td></tr>${o ? `<tr class="xdetail" data-xd="${esc(x.code)}"><td colspan="10">${expandHtml(x)}</td></tr>` : ''}`; }).join('') || '<tr><td colspan="10" class="empty">ไม่พบรายการ</td></tr>'}</tbody></table></div></div>`;
    const cards = `<div class="cards">${rows.map(x => `<button class="scard" data-open="${esc(x.code)}" style="border-left:4px solid ${STATUS[x.status].dot}">
        <div style="display:flex;justify-content:space-between;gap:10px;margin-bottom:12px"><div><div style="font-weight:600;font-size:16px">${esc(x.name)}</div><div class="small muted">${esc(x.category)} · ${esc(x.code)}</div>${x.isNew ? newTag(x.nw.tag, 0) : ''}</div>${statusPill(x.status)}</div>
        <div style="display:flex;align-items:baseline;gap:8px"><span class="h" style="font-weight:700;font-size:26px">${x.stock == null ? '—' : q2(x.stock)}</span><span class="muted" style="font-size:13px">${esc(x.unit)} คงเหลือ</span></div>
        <div style="font-size:12.5px;color:${STATUS[x.status].fg};font-weight:500;margin:4px 0 12px">พอใช้อีก ${monthsText(x)}</div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;text-align:center;border-top:1px solid #edf1ec;padding-top:11px">
          <div><div class="small muted">${lastLbl}</div><b>${q2(x.last)}</b></div><div><div class="small muted">${x.isNew ? 'อัตรา/เดือน' : 'เฉลี่ย 3ด.'}</div><b>${q2(Math.round(x.avg3 * 100) / 100)}</b></div><div><div class="small muted">ควรสั่ง</div><b>${x.need > 0 ? q2(Math.ceil(x.need)) : '—'}</b></div></div>
      </button>`).join('') || '<div class="empty">ไม่พบรายการ</div>'}</div>`;
    return `<div class="pagehead"><div><h1>ภาพรวมสต็อก</h1>
        <div class="sub">สต็อก ณ ${dLabel(S.stockDate)} · ยอดใช้ถึง ${S.usageThrough ? dLabel(S.usageThrough) : (W.lastData ? mLabel(W.lastData < W.prev ? W.lastData : W.prev) : '—')}${W.partial ? ` (เดือน ${mLabelCov(W.partial)} ยังไม่ครบเดือน ไม่นำมาคิดค่าเฉลี่ย)` : ''}</div>${W.complete.length ? `<div class="sub">ค่าเฉลี่ย 3 เดือน = ${mLabel(W.complete[Math.max(0, W.complete.length - 3)])} – ${mLabel(W.complete[W.complete.length - 1])} · 6 เดือน = ${mLabel(W.complete[Math.max(0, W.complete.length - 6)])} – ${mLabel(W.complete[W.complete.length - 1])}${all.some(x => x.isNew) ? ' · สินค้าใหม่ (ใช้ไม่ถึง 3 เดือน) ใช้อัตราการใช้เดือนล่าสุดแทน' : ''}</div>` : ''}</div>
        <div class="flex" style="align-items:center">
          <label class="small muted" for="setWarn">แจ้งเตือนเมื่อพอใช้ต่ำกว่า</label>
          <select id="setWarn" class="input" style="width:auto;padding:7px 10px">${[1, 1.5, 2, 2.5, 3, 4].map(v => `<option value="${v}" ${st.warn == v ? 'selected' : ''}>${v} เดือน</option>`).join('')}</select>
          <label class="small muted" for="setTarget">เป้าสต็อก</label>
          <select id="setTarget" class="input" style="width:auto;padding:7px 10px">${[3, 4, 5, 6, 8, 10, 12].map(v => `<option value="${v}" ${st.target == v ? 'selected' : ''}>${v} เดือน</option>`).join('')}</select>
          <div class="seg"><button data-view="table" class="${st.view === 'table' ? 'on' : ''}">☰ ตาราง</button><button data-view="cards" class="${st.view === 'cards' ? 'on' : ''}">▦ การ์ด</button></div>
        </div></div>
      ${!W.stale && W.prevShort ? `<div class="warnbox">⚠ ยอดใช้เดือน ${mLabel(W.prev)} มีข้อมูลถึงวันที่ ${dLabel(W.prevThrough)} เท่านั้น — ค่าเฉลี่ยที่รวมเดือนนี้จะต่ำกว่าความจริง ควรนำเข้ารายงานเคลื่อนไหวให้ครบเดือน</div>` : ''}${W.stale ? `<div class="warnbox">⚠ ยังไม่มียอดใช้เดือน ${mLabel(W.prev)} ในระบบ (ข้อมูลล่าสุดถึง ${mLabel(W.lastData)}) — เดือนที่ไม่มีข้อมูลจะถูกนับเป็น 0 ทำให้ค่าเฉลี่ยต่ำกว่าความจริง ควรนำเข้าไฟล์ล่าสุดในเมนูนำเข้าข้อมูล</div>` : ''}${healthHtml(all)}<div class="kpis">${kpi('SKU ที่ติดตาม', all.length, 'รายการที่เปิดติดตามอยู่', '#003049')}${kpi('ต่ำกว่าจุดสั่งซื้อ', crit, `พอใช้ไม่ถึง ${st.warn} เดือน`, '#C1121F', crit ? '#780000' : '')}${kpi('ใกล้หมด', warn, 'ควรวางแผนสั่ง', '#e0982b', warn ? '#8a5410' : '')}${kpi('ครอบคลุมเฉลี่ย', cov + ' ด.', 'จากเฉลี่ยใช้ 3 เดือน', '#669BBC')}</div>
      <div class="toolbar">
        <div class="search"><input id="ovQ" type="search" placeholder="ค้นหาชื่อยา / รหัส / บริษัท…" value="${esc(ui.q)}" aria-label="ค้นหา"></div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">${statChips.map(([k, l]) => `<button class="chip ${ui.stat === k ? 'on' : ''}" data-stat="${k}">${l}</button>`).join('')}</div>
        <select id="ovSort" class="input" style="width:auto" aria-label="เรียงลำดับ">${[['urgent', 'เรียง: ด่วนก่อน'], ['months', 'เรียง: พอใช้น้อยสุด'], ['usage', 'เรียง: ใช้เยอะสุด'], ['name', 'เรียง: ชื่อ A–Z']].map(([v, l]) => `<option value="${v}" ${ui.sort === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:16px">${cats.map(c => `<button class="pillchip ${ui.cat === c ? 'on' : ''}" data-cat="${esc(c)}">${c === 'all' ? 'ทั้งหมด' : esc(c)}</button>`).join('')}</div>
      ${st.view === 'cards' ? cards : `<div style="display:flex;justify-content:flex-end;gap:8px;margin-bottom:10px"><button type="button" class="btn ghost small" id="xAll">⊞ ขยายทั้งหมด</button><button type="button" class="btn ghost small" id="xNone" ${OPEN.size ? '' : 'disabled'}>⊟ ย่อทั้งหมด${OPEN.size ? ` (${OPEN.size})` : ''}</button></div>${tbl}`}
      <div class="foot">แสดง ${rows.length} จาก ${all.length} รายการ · ${st.view === 'cards' ? 'คลิกที่สินค้าเพื่อดูยอดใช้รายเดือน' : 'คลิกแถวเพื่อดูยอดใช้รายเดือนและเลือกช่วงเดือนดูยอดรวม'}</div>`;
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
    healthBind();
    $$('[data-exp]').forEach(tr => { tr.onclick = () => { const c = tr.dataset.exp; OPEN.has(c) ? OPEN.delete(c) : OPEN.add(c); render(); }; tr.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); tr.click(); } }; });
    const xa = $('#xAll'); if (xa) xa.onclick = () => { $$('[data-exp]').forEach(tr => OPEN.add(tr.dataset.exp)); render(); };
    const xn = $('#xNone'); if (xn) xn.onclick = () => { OPEN.clear(); render(); };
    $$('[data-xd]').forEach(row => {
      const sku = S.skus.find(s => s.code === row.dataset.xd); if (!sku) return;
      const it = computeItem(sku); usageSelBind(row, sku, it, it.series.slice(-13));
      const fp = row.querySelector('[data-xpromo]'); if (fp) fp.onclick = () => { window.promoPick(sku.code); location.hash = '#promo'; };
      const ff = row.querySelector('[data-xfull]'); if (ff) ff.onclick = () => { S.detail = sku.code; render(); window.scrollTo(0, 0); };
    });
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
        ${it.isNew ? stat('อัตราที่ใช้คำนวณ', q2(Math.round(it.avg3 * 100) / 100), `${esc(it.unit || 'หน่วย')}/เดือน · ${esc(NEW_MODES[it.nw.mode])}`) : stat('เฉลี่ย 3 เดือน', q2(it.avg3), (it.unit || 'หน่วย') + '/เดือน')}
        ${it.isNew ? stat('เฉลี่ย 3 เดือน (ปกติ)', q2(it.avg3raw), 'นับเดือนก่อนเริ่มใช้เป็น 0') : stat('เฉลี่ย 6 เดือน', q2(it.avg6), (it.unit || 'หน่วย') + '/เดือน')}
        ${stat('พอใช้อีก', monthsText(it), it.isNew ? 'จากอัตราที่ใช้คำนวณ' : 'จากเฉลี่ย 3 เดือน', STATUS[it.status].fg)}
        ${stat(`ควรสั่ง (ถึง ${st.target} ด.)`, it.need > 0 ? q2(Math.ceil(it.need)) : '—', it.needPacks ? `≈ ${it.needPacks} ${esc(sku.purchase_unit || '')}` : (it.unit || ''))}
        ${(() => { const ref = typeof promoRef === 'function' ? promoRef(sku.code).last : null; return ref ? stat('ราคาที่ได้ล่าสุด', fmt(Number(ref.chosen_cpu), 2), `บาท/${esc(it.unit)} · ${shortD(ref.decided_on)} (${esc(decLabel(ref.decision).replace('ตัวเลือก ', ''))})`) : ''; })()}
      </div>
      ${it.partialMonth ? `<div class="info">เดือน ${mLabel(it.partialMonth)} ยังไม่ครบเดือน${covThrough(it.partialMonth) ? ` (ข้อมูลถึง ${dLabel(covThrough(it.partialMonth))})` : ''} — ใช้ไปแล้ว ${q2(it.partialV)} ${esc(it.unit)} (ไม่นำมาคิดค่าเฉลี่ย)</div>` : ''}
      ${it.isNew ? newItemBox(it) : ''}
      ${typeof promoSkuCard === 'function' ? promoSkuCard(sku.code, it.unit) : ''}
      <div class="card pad" style="margin-bottom:18px">${usageChartHtml(it, series)}</div>
      <div class="card" style="overflow:hidden"><div style="padding:15px 20px" class="title">ตารางยอดใช้รายเดือน</div><div class="scroll"><table class="t" id="mtable"><thead><tr><th>เดือน</th><th class="r">ยอดใช้ (${esc(it.unit || 'หน่วย')})</th><th>สัดส่วน</th></tr></thead>
        <tbody>${series.map((x, i) => ({ x, i })).reverse().map(({ x, i }) => `<tr class="click" data-ri="${i}"><td>${mLabel(x.month)}${it.firstUse && x.month < it.firstUse ? ' <span class="small muted">(ยังไม่มีสินค้า)</span>' : ''}${covLong(x.month) ? ` <span class="small" style="color:#8a5410">(${covLong(x.month)})</span>` : x.month === it.partialMonth ? ' <span class="small muted">(ยังไม่ครบเดือน)</span>' : ''}</td><td class="r" style="font-weight:600">${q2(x.v)}</td><td><div style="max-width:200px;height:7px;background:#edf1ec;border-radius:4px;overflow:hidden"><div style="height:100%;width:${(x.v / max * 100).toFixed(1)}%;background:${yColor(x.month.slice(0, 4))}"></div></div></td></tr>`).join('')}</tbody></table></div></div>`;
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
    if (typeof promoSkuBind === 'function') promoSkuBind(S.detail);
    newItemBind();
    const sku = S.skus.find(s => s.code === S.detail), it = computeItem(sku);
    usageSelBind($('#main'), sku, it, it.series.slice(-24));
  },
};

/** Monthly usage chart with range selection (drag / Shift+click / quick ranges → total & average). Used on the item page and in expanded overview rows. */
function usageChartHtml(it, series, compact) {
  const max = Math.max(1, ...series.map(x => x.v));
  const years = [...new Set(series.map(x => x.month.slice(0, 4)))];
  const yColor = y => y === years[years.length - 1] ? '#003049' : '#669BBC';
  return `<div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:10px;margin-bottom:12px"><div class="title">ยอดใช้รายเดือน${compact ? ` <span class="small muted" style="font-weight:400">(${series.length} เดือนล่าสุด)</span>` : ''}</div>
          <div style="display:flex;gap:16px" class="small muted">${years.map(y => `<span style="display:inline-flex;align-items:center;gap:6px"><span style="width:11px;height:11px;border-radius:3px;background:${yColor(y)}"></span>ปี ${Number(y) + 543}</span>`).join('')}</div></div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:10px">
          <span class="small muted" style="margin-right:4px">เลือกช่วง:</span>
          ${VIEWS.overview.presets(series, it).map((pr, k) => `<button type="button" class="pillchip" data-pre="${k}">${pr.label}</button>`).join('')}
          <button type="button" class="pillchip" data-pre="clear">ล้าง</button>
        </div>
        <div class="selBox"></div>
        <div class="small muted" style="margin:4px 0 10px">กดค้างที่แท่งเดือนแรกแล้วลากไปเดือนสุดท้าย (หรือคลิกเดือนแรก แล้ว Shift+คลิกเดือนสุดท้าย)${compact ? '' : ' — เลือกในตารางด้านล่างได้เหมือนกัน'}</div>
        <div class="scroll" style="padding-bottom:6px"><div class="bars" style="user-select:none;touch-action:pan-x;${compact ? 'height:150px;min-width:560px' : ''}">${series.map((x, i) => `<div class="b" data-i="${i}" title="${mLabelCov(x.month)}: ${it.firstUse && x.month < it.firstUse ? 'ยังไม่มีสินค้า' : q2(x.v)}"><div class="v">${it.firstUse && x.month < it.firstUse ? '' : q2(x.v)}</div><div class="col" style="height:${(x.v / max * 100).toFixed(1)}%;background:${yColor(x.month.slice(0, 4))};${x.month === it.partialMonth ? 'opacity:.45' : ''}"></div></div>`).join('')}</div>
        <div class="blabels" style="${compact ? 'min-width:560px' : ''}">${series.map(x => `<div>${mLabel(x.month)}${it.firstUse && x.month < it.firstUse ? '<div style="font-size:9.5px;color:#8a958e;margin-top:2px">ยังไม่มี</div>' : ''}${covShort(x.month) ? `<div style="font-size:9.5px;color:#8a5410;margin-top:2px">${covShort(x.month)}</div>` : ''}</div>`).join('')}</div></div>`;
}
function usageSelBind(root, sku, it, series) {
  if (!root) return;
  const q = s => root.querySelector(s), qa = s => Array.from(root.querySelectorAll(s));
  const presets = VIEWS.overview.presets(series, it);
  const key = sku.code + '|' + series.length, sels = S.ui.sels = S.ui.sels || {};
  const fi = it.isNew && it.firstUse ? series.findIndex(x => x.month >= it.firstUse) : -1;   // new item: start from its first month
  const sel = sels[key] || (sels[key] = fi >= 0 ? { a: fi, b: series.length - 1 } : presets[0] ? { a: presets[0].a, b: presets[0].b } : { a: null, b: null });
  const update = () => {
    const has = sel.a != null && sel.b != null, lo = has ? Math.min(sel.a, sel.b) : -1, hi = has ? Math.max(sel.a, sel.b) : -1;
    qa('.bars .b').forEach(el => { const i = +el.dataset.i, on = i >= lo && i <= hi; el.classList.toggle('sel', on); el.classList.toggle('dim', has && !on); });
    qa('tr[data-ri]').forEach(el => { const i = +el.dataset.ri; el.classList.toggle('sel', i >= lo && i <= hi); });
    qa('[data-pre]').forEach(b => { const pr = presets[+b.dataset.pre]; b.classList.toggle('on', !!pr && has && pr.a === lo && pr.b === hi); });
    if (!has) { q('.selBox').innerHTML = ''; return; }
    const pick = series.slice(lo, hi + 1), n = pick.length, sum = pick.reduce((a, x) => a + x.v, 0), avg = sum / n;
    const vals = pick.map(x => x.v), hasPartial = pick.some(x => x.month === it.partialMonth), shortM = pick.filter(x => covShort(x.month));
    const cover = avg > 0 && it.stock != null ? it.stock / avg : null, u = esc(it.unit || '');
    const box = (l, v, h) => `<div><div class="small muted">${l}</div><div class="h num" style="font-weight:700;font-size:21px">${v}</div>${h ? `<div class="small muted">${h}</div>` : ''}</div>`;
    q('.selBox').innerHTML = `<div style="background:#eaf1f6;border:1px solid #cdddea;border-radius:12px;padding:12px 16px;margin-bottom:6px">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:10px">
        <div style="font-weight:600;color:#003049">ช่วงที่เลือก: ${mLabel(pick[0].month)}${n > 1 ? ' – ' + mLabelCov(pick[n - 1].month) : covShort(pick[0].month) ? ` (${covShort(pick[0].month)})` : ''} · ${n} เดือน</div>
        <div style="display:flex;gap:6px"><button type="button" class="btn small ghost selCopy">⧉ คัดลอกตัวเลข</button><button type="button" class="btn small selPromo">ใช้ค่าเฉลี่ยนี้คำนวณโปรโมชั่น</button></div></div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:12px">
        ${box('ยอดใช้รวม', q2(sum), u)}${box('เฉลี่ยต่อเดือน', q2(Math.round(avg * 100) / 100), u + '/เดือน')}
        ${box('สูงสุด / ต่ำสุด', `${q2(Math.max(...vals))} / ${q2(Math.min(...vals))}`, u)}
        ${box('สต็อกพอใช้ (อัตรานี้)', cover == null ? '—' : cover.toFixed(1) + ' เดือน', it.stock == null ? 'ไม่มีข้อมูลสต็อก' : `คงเหลือ ${q2(it.stock)} ${u}`)}
      </div>${shortM.length ? `<div class="small" style="color:#8a5410;margin-top:8px">⚠ ข้อมูลไม่ครบเดือน: ${shortM.map(x => mLabelCov(x.month)).join(', ')} — ยอดรวมและค่าเฉลี่ยของช่วงนี้จะต่ำกว่าความจริง</div>` : hasPartial ? `<div class="small" style="color:#8a5410;margin-top:8px">⚠ ช่วงนี้มีเดือน ${mLabel(it.partialMonth)} ซึ่งยังไม่ครบเดือน ค่าเฉลี่ยจะต่ำกว่าความจริง</div>` : ''}</div>`;
    q('.selPromo').onclick = () => { window.promoPick(sku.code); P.avg = String(Math.round(avg * 100) / 100); location.hash = '#promo'; };
    q('.selCopy').onclick = async () => {
      const t = `${sku.name} ${mLabel(pick[0].month)}–${mLabelCov(pick[n - 1].month)} (${n} เดือน)\tรวม ${q2(sum)} ${it.unit || ''}\tเฉลี่ย ${q2(Math.round(avg * 100) / 100)} ${it.unit || ''}/เดือน`;
      try { await navigator.clipboard.writeText(t); toast('✓ คัดลอกแล้ว'); } catch (e) { toast('คัดลอกไม่ได้ในเบราว์เซอร์นี้'); }
    };
  };
  let drag = false;
  const bars = q('.bars');
  bars.addEventListener('pointerdown', e => {
    const b = e.target.closest('.b'); if (!b) return; const i = +b.dataset.i;
    if (e.shiftKey && sel.a != null) sel.b = i; else { sel.a = i; sel.b = i; drag = true; }
    update(); e.preventDefault();
    try { bars.setPointerCapture(e.pointerId); } catch (er) {}
  });
  bars.addEventListener('pointermove', e => {
    if (!drag) return; const el = document.elementFromPoint(e.clientX, e.clientY); const b = el && el.closest && el.closest('.b');
    if (b && bars.contains(b) && +b.dataset.i !== sel.b) { sel.b = +b.dataset.i; update(); }
  });
  ['pointerup', 'pointercancel'].forEach(ev => bars.addEventListener(ev, () => { drag = false; }));
  qa('tr[data-ri]').forEach(tr => tr.onclick = e => { const i = +tr.dataset.ri; if (e.shiftKey && sel.a != null) sel.b = i; else { sel.a = i; sel.b = i; } update(); });
  qa('[data-pre]').forEach(b => b.onclick = () => { if (b.dataset.pre === 'clear') { sel.a = sel.b = null; } else { const pr = presets[+b.dataset.pre]; sel.a = pr.a; sel.b = pr.b; } update(); });
  update();
}

/* ---------- new item: choose which usage rate to use ---------- */
function newItemBox(it) {
  const nw = it.nw, u = esc(it.unit || 'หน่วย');
  const cov = v => v > 0 && it.stock != null ? (it.stock / v).toFixed(1) + ' เดือน' : '—';
  const card = (mode, title, o) => `<button type="button" class="dcard ${nw.mode === mode ? 'on' : ''}" data-rate="${mode}"><div class="t1">${title}${mode === 'latest' ? ' <span style="font-weight:500;font-size:12px">(ค่าเริ่มต้น)</span>' : ''}</div>
    <div class="t2"><b>${q2(Math.round(o.value * 100) / 100)}</b> ${u}/เดือน · ${esc(o.text)}</div><div class="t3" style="color:#46524c">พอใช้ ${cov(o.value)}</div></button>`;
  return `<div class="card pad" style="background:#f7f4fc;border-color:#ddd3f0;margin-bottom:18px">
    <div class="title" style="margin-bottom:6px;color:#4b2f8a">★ สินค้าใหม่ — เริ่มมีการใช้ ${mLabel(nw.first)} (${esc(nw.tag)})</div>
    <div class="small" style="color:#46524c;margin-bottom:12px">ค่าเฉลี่ย 3 เดือนปกตินับเดือนที่ยังไม่มีสินค้าเป็น 0 จึงได้ ${q2(it.avg3raw)} ${u}/เดือน ซึ่งต่ำเกินจริง — เลือกอัตราที่จะใช้คำนวณ (ใช้ทั้งในภาพรวมและหน้าคำนวณโปร · ทุกคนเห็นค่าเดียวกัน):</div>
    <div class="dcards">
      ${card('latest', NEW_MODES.latest, nw.opts.latest)}
      ${card('since', NEW_MODES.since, nw.opts.since)}
      ${nw.opts.lastfull ? card('lastfull', NEW_MODES.lastfull, nw.opts.lastfull) : ''}
      <div class="dcard ${nw.mode === 'manual' ? 'on' : ''}" style="cursor:default"><div class="t1">${NEW_MODES.manual}</div>
        <div style="display:flex;gap:6px;margin-top:6px"><input id="rateManual" inputmode="decimal" aria-label="อัตราการใช้ต่อเดือน" placeholder="${u}/เดือน" value="${it.sku.manual_rate != null ? esc(String(Number(it.sku.manual_rate))) : ''}" style="padding:7px 9px;font-size:13px;min-width:0"><button type="button" class="btn small" id="rateManualSave">ใช้</button></div>
        <div class="t3" style="color:#46524c">${nw.opts.manual ? 'พอใช้ ' + cov(nw.opts.manual.value) : 'เช่น จากแผนการตลาด'}</div></div>
    </div>
    <div class="small muted" style="margin-top:10px">เมื่อมีประวัติครบ 3 เดือนเต็ม (ตั้งแต่ ${mLabel(nw.fullFrom)}) ระบบจะกลับไปใช้ค่าเฉลี่ย 3 เดือนปกติเอง</div>
  </div>`;
}
function newItemBind() {
  const code = S.detail, sku = S.skus.find(s => s.code === code); if (!sku) return;
  const save = async (patch, msg) => {
    const { error } = await sb.from('stock_skus').update(patch).eq('code', code);
    if (error) return toast(errMsg(error));
    Object.assign(sku, patch); toast(msg); render();
  };
  $$('[data-rate]').forEach(b => b.onclick = () => save({ new_rate_mode: b.dataset.rate }, '✓ ใช้' + NEW_MODES[b.dataset.rate] + 'แล้ว'));
  const ms = $('#rateManualSave'); if (ms) ms.onclick = () => { const v = num($('#rateManual').value); if (!(v > 0)) return toast('กรอกอัตราการใช้ต่อเดือน'); save({ new_rate_mode: 'manual', manual_rate: v }, '✓ ใช้อัตรา ' + q2(v) + ' ต่อเดือนแล้ว'); };
}

/* ---------- data health check ---------- */
const HEALTH = { key: null, recon: null, loading: false, open: lsGet('healthOpen', true) };
/** Compare the two latest stock snapshots with the daily usage recorded between them: a bigger drop means usage was missed. */
async function loadRecon(key) {
  HEALTH.loading = true;
  try {
    if (!S.imports && typeof loadImports === 'function') await loadImports();
    const { data: ds, error: e1 } = await sb.from('stock_onhand').select('as_of').lt('as_of', S.stockDate).order('as_of', { ascending: false }).limit(1);
    if (e1) throw e1;
    const prev = ds && ds[0] ? ds[0].as_of : null, latest = S.stockDate;
    const res = { prev, latest, covered: false, flags: [] };
    if (prev) {
      const { data: on, error: e2 } = await sb.from('stock_onhand').select('sku_code,qty').eq('as_of', prev);
      if (e2) throw e2;
      const daily = [];
      for (let f = 0; ; f += 1000) { const { data, error } = await sb.from('stock_usage_daily').select('sku_code,qty').gt('day', prev).lte('day', latest).range(f, f + 999); if (error) throw error; daily.push(...data); if (data.length < 1000) break; }
      res.covered = typeof coveredFrom === 'function' && coveredFrom(addDays(prev, 1), latest, S.imports || []) === latest;
      const used = {}; daily.forEach(r => { used[r.sku_code] = (used[r.sku_code] || 0) + Number(r.qty); });
      const before = {}; on.forEach(r => { before[r.sku_code] = Number(r.qty); });
      S.skus.filter(s => s.is_tracked).forEach(s => {
        const b = before[s.code], a = S.stock[s.code] && S.stock[s.code].as_of === latest ? S.stock[s.code].qty : null;
        if (b == null || a == null) return;
        const drop = b - a, u = used[s.code] || 0;
        if (drop - u > Math.max(0.5, drop * 0.05)) res.flags.push({ code: s.code, name: s.name, unit: s.stock_unit || '', drop, used: u });
      });
    }
    HEALTH.recon = res;
  } catch (e) { HEALTH.recon = { error: errMsg(e) }; }
  HEALTH.key = key; HEALTH.loading = false; render();
}
function healthHtml(all) {
  const key = (S.stockDate || '') + '|' + (S.imports ? S.imports.length + ':' + S.imports.map(r => r.date_to).sort().pop() : '-');
  if (HEALTH.key !== key && !HEALTH.loading && S.stockDate) { HEALTH.loading = true; setTimeout(() => loadRecon(key), 0); }
  const W = monthWindow(), last6 = W.complete.slice(-6);
  const used6 = x => last6.some(m => (S.usage[x.code] || {})[m] > 0) || (x.partialV || 0) > 0;
  const fresh = all.filter(x => x.isNew);
  const idle = all.filter(x => !x.isNew && !used6(x) && x.stock > 0);
  const dead = all.filter(x => !x.isNew && !used6(x) && !(x.stock > 0));
  const nostock = all.filter(x => x.stock == null && (x.isNew || used6(x)));
  const rc = HEALTH.recon;
  const row = (ico, bg, fg, title, desc, extra) => `<div style="display:flex;gap:12px;align-items:flex-start;padding:11px 0;border-top:1px solid #edf1ec">
    <div style="width:26px;height:26px;border-radius:8px;display:grid;place-items:center;font-size:13px;font-weight:700;flex:none;background:${bg};color:${fg}">${ico}</div>
    <div style="flex:1;min-width:0"><div style="font-weight:600;font-size:14px">${title}</div>${desc ? `<div class="small" style="color:#46524c;margin-top:2px">${desc}</div>` : ''}${extra || ''}</div></div>`;
  const chip = x => `<button type="button" class="pillchip" data-open="${esc(x.code)}" style="margin:6px 6px 0 0;background:#f6efe1;color:#142433">${esc(x.name)}${x.isNew ? ` · ≈${q2(Math.round(x.avg3 * 10) / 10)} ${esc(x.unit)}/ด.` : ''}</button>`;
  const rows = []; let issues = 0;
  if (fresh.length) { issues++; rows.push(row('★', '#e8e1f7', '#4b2f8a', `สินค้าใหม่ ใช้ไม่ถึง 3 เดือน · ${fresh.length} รายการ`, 'ค่าเฉลี่ย 3 เดือนจะต่ำเกินจริง ระบบจึงใช้อัตราการใช้เดือนล่าสุดแทน — ตรวจตัวเลขก่อนสั่งซื้อ (คลิกเพื่อดูหรือเปลี่ยนวิธีคิด)', `<div>${fresh.map(chip).join('')}</div>`)); }
  if (!rc || HEALTH.loading) rows.push(row('…', '#edf1ec', '#46524c', 'กำลังตรวจสต็อกเทียบยอดใช้…', ''));
  else if (rc.error) rows.push(row('!', '#f9e3e4', '#780000', 'ตรวจสต็อกเทียบยอดใช้ไม่สำเร็จ', esc(rc.error)));
  else if (!rc.prev) rows.push(row('○', '#edf1ec', '#46524c', 'ยังตรวจสต็อกเทียบยอดใช้ไม่ได้', 'ต้องมียอดสต็อกอย่างน้อย 2 วันที่'));
  else if (!rc.covered) rows.push(row('○', '#edf1ec', '#46524c', `ยังตรวจสต็อกเทียบยอดใช้ไม่ได้ (${dLabel(rc.prev)} → ${dLabel(rc.latest)})`, `ยอดใช้รายวันยังไม่ครบช่วง ${dLabel(addDays(rc.prev, 1))} – ${dLabel(rc.latest)} — นำเข้ารายงานเคลื่อนไหวให้ครบช่วงนี้ก่อน`));
  else if (rc.flags.length) { issues++; rows.push(row('!', '#fdf4e3', '#8a5410', `สต็อกลดลงมากกว่ายอดใช้ที่บันทึก · ${rc.flags.length} รายการ`, `${dLabel(rc.prev)} → ${dLabel(rc.latest)} — อาจมียอดใช้ตกหล่น (เช่น รหัสในรายงานไม่ตรง หรือไม่ได้เลือกประเภทรายการ) หรือมีการโอน/ตัดเสีย`,
    `<div class="small" style="margin-top:6px">${rc.flags.map(f => `<b>${esc(f.name)}</b> ลดลง ${q2(f.drop)} แต่บันทึกใช้ ${q2(f.used)} ${esc(f.unit)}`).join(' · ')}</div>`)); }
  else rows.push(row('✓', '#e9f6ef', '#1f7a55', 'สต็อกลดลงตรงกับยอดใช้ที่บันทึก', `${dLabel(rc.prev)} → ${dLabel(rc.latest)} — ไม่พบยอดใช้ตกหล่น`));
  if (idle.length) { issues++; rows.push(row('!', '#fdf4e3', '#8a5410', `มีสต็อกแต่ไม่มีการใช้ 6 เดือน · ${idle.length} รายการ`, 'อาจเป็นของค้างสต็อก หรือยอดใช้ไม่ได้ถูกนำเข้า (รหัสไม่ตรง)', `<div>${idle.map(chip).join('')}</div>`)); }
  else rows.push(row('✓', '#e9f6ef', '#1f7a55', 'ทุกรายการที่มีสต็อกมีการใช้ใน 6 เดือน', ''));
  if (nostock.length) { issues++; rows.push(row('!', '#fdf4e3', '#8a5410', `ไม่มียอดสต็อกในระบบ · ${nostock.length} รายการ`, 'ตรวจว่ารหัสในรายงานยอดคงคลังตรงกับรายการหลัก', `<div>${nostock.map(chip).join('')}</div>`)); }
  if (dead.length) rows.push(row('○', '#edf1ec', '#46524c', `ไม่มีการใช้ 6 เดือนและสต็อกเป็น 0 · ${dead.length} รายการ <span class="small muted" style="font-weight:400">(อาจเลิกใช้แล้ว)</span>`, esc(dead.map(x => x.name).join(' · ')), `<button type="button" class="btn ghost small" id="hUntrack" style="margin-top:8px">เลือกปิดการติดตาม…</button>`));
  return `<div class="card pad" style="margin-bottom:18px;${issues ? 'border-color:#f1dcb3' : ''}">
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;cursor:pointer" id="hToggle" role="button" tabindex="0" aria-expanded="${HEALTH.open}"><div class="title">ตรวจสุขภาพข้อมูล ${issues ? `<span class="status" style="background:#fdf4e3;color:#8a5410;padding:2px 9px;font-size:11.5px;margin-left:4px">ควรตรวจ ${issues} เรื่อง</span>` : '<span class="status" style="background:#e9f6ef;color:#1f7a55;padding:2px 9px;font-size:11.5px;margin-left:4px">ปกติ</span>'}</div>
      <span class="small muted">${all.length} รายการที่ติดตาม · ${HEALTH.open ? 'ซ่อน ▲' : 'แสดง ▼'}</span></div>
    ${HEALTH.open ? `<div style="margin-top:6px">${rows.join('')}</div>` : ''}</div>`;
}
function healthBind() {
  const t = $('#hToggle'); if (t) { t.onclick = () => { HEALTH.open = !HEALTH.open; lsSet('healthOpen', HEALTH.open); render(); }; t.onkeydown = e => { if (e.key === 'Enter') t.click(); }; }
  const u = $('#hUntrack'); if (u) u.onclick = () => {
    const W = monthWindow(), last6 = W.complete.slice(-6);
    const dead = S.skus.filter(s => s.is_tracked).map(computeItem).filter(x => !x.isNew && !(x.stock > 0) && !last6.some(m => (S.usage[x.code] || {})[m] > 0) && !(x.partialV > 0));
    openModal(`<h2>ปิดการติดตาม</h2><div class="small muted" style="margin-bottom:14px">รายการที่ไม่มีการใช้ 6 เดือนและสต็อกเป็น 0 — ปิดแล้วจะไม่แสดงในภาพรวม (เปิดกลับได้ที่หน้ารายการหลัก)</div>
      ${dead.map(x => `<label class="lbl" style="font-weight:400;display:flex;gap:8px;align-items:center;margin-bottom:6px"><input type="checkbox" data-ut="${esc(x.code)}" checked style="width:auto"> ${esc(x.name)} <span class="small muted">${esc(x.code)}</span></label>`).join('')}
      <div id="utMsg"></div><div class="actions"><button type="button" class="btn ghost" id="utCancel">ยกเลิก</button><button type="button" class="btn" id="utGo">ปิดการติดตาม</button></div>`);
    $('#utCancel').onclick = closeModal;
    $('#utGo').onclick = async () => {
      const codes = $$('[data-ut]').filter(c => c.checked).map(c => c.dataset.ut); if (!codes.length) return closeModal();
      $('#utGo').disabled = true;
      const { error } = await sb.from('stock_skus').update({ is_tracked: false }).in('code', codes);
      if (error) { $('#utGo').disabled = false; $('#utMsg').innerHTML = `<div class="err">${esc(errMsg(error))}</div>`; return; }
      S.skus.forEach(s => { if (codes.includes(s.code)) s.is_tracked = false; }); closeModal(); toast(`✓ ปิดการติดตาม ${codes.length} รายการแล้ว`); render();
    };
  };
}

/* ---------- expandable overview rows ---------- */
const OPEN = new Set();
(function () {
  const st = document.createElement('style');
  st.textContent = '.xbtn{display:inline-grid;place-items:center;width:26px;height:26px;border-radius:7px;background:#edf1ec;color:#46524c;font-size:11px;transition:transform .15s}'
    + 'tr.xopen .xbtn{transform:rotate(90deg);background:#003049;color:#fff}tr.xopen>td{background:#f4f8fb}'
    + 'tr.xdetail>td{background:#f4f8fb;padding:4px 20px 18px!important;border-top:none;cursor:default}'
    + '.xgrid{display:grid;grid-template-columns:minmax(0,1.7fr) minmax(240px,1fr);gap:16px;align-items:start}@media(max-width:900px){.xgrid{grid-template-columns:1fr}}'
    + '.xkv{display:grid;grid-template-columns:1fr 1fr;gap:8px}.xkv>div{background:#fff;border:1px solid #e2e8e1;border-radius:10px;padding:8px 11px}'
    + '.xkv .k{font-size:11.5px;color:#5f6b64}.xkv .v{font-family:Anuphan,"IBM Plex Sans Thai",sans-serif;font-weight:700;font-size:17px}'
    + '.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}';
  document.head.appendChild(st);
})();
function expandHtml(x) {
  const series = x.series.slice(-13), u = esc(x.unit || 'หน่วย');
  const done = series.filter(m => m.month !== x.partialMonth && !(x.firstUse && m.month < x.firstUse)).map(m => m.v);
  const ref = typeof promoRef === 'function' ? promoRef(x.code).last : null;
  const kv = (k, v, h) => `<div><div class="k">${k}</div><div class="v">${v}</div>${h ? `<div class="small muted">${h}</div>` : ''}</div>`;
  return `<div class="xgrid">
    <div class="card pad" style="padding:14px 16px;min-width:0">${usageChartHtml(x, series, true)}</div>
    <div><div class="xkv">
      ${x.isNew ? kv('อัตราที่ใช้คำนวณ', q2(Math.round(x.avg3 * 100) / 100), `${u}/เดือน · ${esc(x.nw.text)}`) : kv('เฉลี่ย 3 เดือน', q2(Math.round(x.avg3 * 100) / 100), u + '/เดือน')}
      ${x.isNew ? kv('เฉลี่ย 3 เดือน (ปกติ)', q2(Math.round(x.avg3raw * 100) / 100), 'นับเดือนก่อนเริ่มใช้เป็น 0') : kv('เฉลี่ย 6 เดือน', q2(Math.round(x.avg6 * 100) / 100), u + '/เดือน')}
      ${kv('สูงสุด / ต่ำสุด', done.length ? `${q2(Math.max(...done))} / ${q2(Math.min(...done))}` : '—', `${done.length} เดือนเต็มล่าสุด`)}
      ${kv('ราคาที่ได้ล่าสุด', ref ? fmt(Number(ref.chosen_cpu), 2) : '—', ref ? `บาท/${u} · ${shortD(ref.decided_on)}` : 'ยังไม่มีบันทึกโปร')}
      ${kv('คงเหลือ', x.stock == null ? '—' : q2(x.stock), x.stockAsOf ? 'ณ ' + dLabel(x.stockAsOf) : '')}
      ${kv('บริษัท', `<span style="font-size:13px;font-weight:500;font-family:inherit">${esc(x.supplier || '—')}</span>`, '')}
    </div>
    <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap"><button type="button" class="btn small" data-xpromo>🏷 คำนวณโปร</button><button type="button" class="btn ghost small" data-xfull>เปิดหน้าเต็ม →</button></div></div>
  </div>`;
}
