/* SKU master management */
'use strict';
const SKU_F = ['code', 'jera_code', 'name', 'jera_name', 'supplier', 'purchase_unit', 'stock_unit', 'category', 'item_type', 'note'];
const skuMissing = s => !s.units_per_purchase || !s.purchase_unit || !s.stock_unit;

VIEWS.sku = {
  html() {
    const ui = S.ui.sku = S.ui.sku || { q: '', f: 'all' };
    const cnt = { all: S.skus.length, on: S.skus.filter(s => s.is_tracked).length, off: S.skus.filter(s => !s.is_tracked).length, miss: S.skus.filter(skuMissing).length };
    const qq = ui.q.trim().toLowerCase();
    const rows = S.skus.filter(s => (ui.f === 'all' || (ui.f === 'on' && s.is_tracked) || (ui.f === 'off' && !s.is_tracked) || (ui.f === 'miss' && skuMissing(s))) &&
      (!qq || [s.code, s.jera_code, s.name, s.jera_name, s.supplier].some(v => (v || '').toLowerCase().includes(qq))))
      .sort((a, b) => (a.category || 'ฮ').localeCompare(b.category || 'ฮ') || a.name.localeCompare(b.name));
    return `<div class="pagehead"><div><h1>จัดการรายการหลัก (SKU)</h1><div class="sub">รหัส SKU ใช้จับคู่ตอนนำเข้าไฟล์ · หน่วยและการแปลงหน่วยใช้ในหน้าคำนวณโปรโมชั่น</div></div>
        <button class="btn" id="skuAdd">+ เพิ่ม SKU</button></div>
      <div class="toolbar"><div class="search"><input id="skuQ" type="search" placeholder="ค้นหารหัส / ชื่อ / ผู้ขาย…" value="${esc(ui.q)}" aria-label="ค้นหา SKU"></div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">${[['all', 'ทั้งหมด'], ['on', 'กำลังติดตาม'], ['off', 'ปิดติดตาม'], ['miss', 'ข้อมูลไม่ครบ']].map(([k, l]) => `<button class="chip ${ui.f === k ? 'on' : ''}" data-sf="${k}">${l} (${cnt[k]})</button>`).join('')}</div></div>
      <div class="card" style="overflow:hidden"><div class="scroll"><table class="t" style="min-width:1000px">
        <thead><tr><th>รหัส SKU</th><th>ชื่อสินค้า</th><th>ผู้ขาย</th><th>การแปลงหน่วย</th><th>หมวด</th><th>สถานะ</th><th class="r">จัดการ</th></tr></thead>
        <tbody>${rows.map(s => `<tr style="${s.is_tracked ? '' : 'color:#5f6b64'}">
          <td><div style="font-weight:600;color:#003049">${esc(s.code)}</div>${s.jera_code && s.jera_code !== s.code ? `<div class="small muted">Jera: ${esc(s.jera_code)}</div>` : !s.jera_code ? '<div class="small muted">ไม่มีรหัส Jera</div>' : ''}</td>
          <td><div style="font-weight:600">${esc(s.name)}</div>${s.jera_name ? `<div class="small muted">${esc(s.jera_name)}</div>` : ''}</td>
          <td style="font-size:13px">${esc(s.supplier) || '—'}</td>
          <td style="white-space:nowrap">${skuMissing(s) ? '<span class="status" style="background:#fdf4e3;color:#8a5410">ยังไม่มีการแปลงหน่วย</span>' : `1 ${esc(s.purchase_unit)} = <b>${q2(s.units_per_purchase)}</b> ${esc(s.stock_unit)}`}${s.note ? `<div class="small muted" style="white-space:normal;max-width:220px">${esc(s.note)}</div>` : ''}</td>
          <td>${s.category ? `<span class="tag">${esc(s.category)}</span>` : ''} <span class="small muted">${esc(s.item_type || '')}</span></td>
          <td><button class="status" data-tg="${esc(s.code)}" style="border:none;cursor:pointer;${s.is_tracked ? 'background:#e9f6ef;color:#1f7a55' : 'background:#edf1ec;color:#46524c'}" title="กดเพื่อ${s.is_tracked ? 'ปิด' : 'เปิด'}ติดตาม">${s.is_tracked ? 'กำลังติดตาม' : 'ปิดติดตาม'}</button></td>
          <td class="r"><button class="btn ghost small" data-ed="${esc(s.code)}" aria-label="แก้ไข ${esc(s.code)}">แก้ไข</button></td></tr>`).join('') || '<tr><td colspan="7" class="empty">ไม่พบรายการ</td></tr>'}</tbody></table></div></div>
      <div class="foot">แสดง ${rows.length} จาก ${S.skus.length} รายการ</div>`;
  },
  bind() {
    const ui = S.ui.sku;
    const q = $('#skuQ'); q.oninput = () => { ui.q = q.value; const p = q.selectionStart; render(); const n = $('#skuQ'); n.focus(); n.setSelectionRange(p, p); };
    $$('[data-sf]').forEach(b => b.onclick = () => { ui.f = b.dataset.sf; render(); });
    $('#skuAdd').onclick = () => skuForm(null);
    $$('[data-ed]').forEach(b => b.onclick = () => skuForm(b.dataset.ed));
    $$('[data-tg]').forEach(b => b.onclick = async () => {
      const s = S.skus.find(x => x.code === b.dataset.tg); b.disabled = true;
      const { error } = await sb.from('stock_skus').update({ is_tracked: !s.is_tracked }).eq('code', s.code);
      if (error) { toast(errMsg(error)); b.disabled = false; return; }
      s.is_tracked = !s.is_tracked; toast(s.is_tracked ? `✓ เปิดติดตาม ${s.code}` : `✓ ปิดติดตาม ${s.code}`); render();
    });
  },
};

function skuForm(code) {
  const s = code ? S.skus.find(x => x.code === code) : null;
  const uniq = k => [...new Set(S.skus.map(x => x[k]).filter(Boolean))].sort();
  const dl = (id, list) => `<datalist id="${id}">${list.map(v => `<option value="${esc(v)}">`).join('')}</datalist>`;
  const v = k => esc(s ? (s[k] ?? '') : '');
  openModal(`<h2>${s ? 'แก้ไข SKU' : 'เพิ่ม SKU ใหม่'}</h2><div class="small muted" style="margin-bottom:16px">${s ? esc(s.code + ' · ' + s.name) : 'เพิ่มเข้าบัญชีรายการที่ติดตาม'}</div>
    <form id="fSku" novalidate>
      <div class="section-h">ข้อมูลหลัก</div>
      <div class="grid2">
        <div class="field"><label for="f_code">รหัส SKU *</label><input id="f_code" maxlength="60" value="${v('code')}"><div class="hint">${s ? 'เปลี่ยนได้ — ยอดใช้และสต็อกของรหัสเดิมจะย้ายตามอัตโนมัติ' : 'ต้องตรงกับรหัสในไฟล์ที่นำเข้า'}</div></div>
        <div class="field"><label for="f_jera_code">รหัสใน Jera</label><input id="f_jera_code" maxlength="60" value="${v('jera_code')}"></div>
        <div class="field"><label for="f_name">ชื่อสินค้า *</label><input id="f_name" maxlength="200" value="${v('name')}"></div>
        <div class="field"><label for="f_jera_name">ชื่อใน Jera</label><input id="f_jera_name" maxlength="200" value="${v('jera_name')}"></div>
        <div class="field full"><label for="f_supplier">บริษัทผู้ขาย</label><input id="f_supplier" list="dlSup" maxlength="200" value="${v('supplier')}"></div>
      </div>
      <div class="section-h">หน่วยนับและการแปลงหน่วย</div>
      <div class="grid2">
        <div class="field"><label for="f_purchase_unit">หน่วยรับเข้า (หน่วยซื้อ)</label><input id="f_purchase_unit" list="dlUnit" maxlength="40" placeholder="เช่น กล่อง" value="${v('purchase_unit')}"></div>
        <div class="field"><label for="f_stock_unit">หน่วยในสต็อก / Jera</label><input id="f_stock_unit" list="dlUnit" maxlength="40" placeholder="เช่น cc" value="${v('stock_unit')}"></div>
        <div class="field"><label for="f_units">จำนวนต่อ 1 หน่วยรับเข้า</label><input id="f_units" inputmode="decimal" placeholder="เช่น 2" value="${s && s.units_per_purchase != null ? esc(Number(s.units_per_purchase)) : ''}"></div>
      </div>
      <div class="convert" id="conv"></div>
      <div class="section-h">การจัดกลุ่ม</div>
      <div class="grid2">
        <div class="field"><label for="f_category">หมวด</label><input id="f_category" list="dlCat" maxlength="60" value="${v('category')}"></div>
        <div class="field"><label for="f_item_type">ประเภท</label><select id="f_item_type">${[['', '— ไม่ระบุ —'], ['FG', 'FG · สินค้าสำเร็จรูป'], ['RM', 'RM · วัตถุดิบ'], ['SP', 'SP · วัสดุสิ้นเปลือง']].map(([k, l]) => `<option value="${k}" ${(s ? s.item_type || '' : '') === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        <div class="field full" style="display:flex;align-items:center;gap:10px"><input type="checkbox" id="f_tracked" style="width:18px;height:18px;accent-color:#003049" ${!s || s.is_tracked ? 'checked' : ''}><label for="f_tracked" style="margin:0">กำลังติดตามในระบบสต็อก</label></div>
        <div class="field full"><label for="f_note">หมายเหตุ</label><textarea id="f_note" maxlength="500">${v('note')}</textarea></div>
      </div>
      <div id="skuErr"></div>
      <div class="actions"><button type="button" class="btn ghost" id="skuCancel">ยกเลิก</button><button type="submit" class="btn" id="skuSave">บันทึก</button></div>
    </form>${dl('dlSup', uniq('supplier'))}${dl('dlUnit', [...new Set([...uniq('purchase_unit'), ...uniq('stock_unit')])])}${dl('dlCat', [...new Set(['โบทูลินัม', 'ฟิลเลอร์', 'สกินบูสเตอร์', 'เครื่อง/หัวยิง', 'ยาลดน้ำหนัก', 'อาหารเสริม', 'อื่นๆ', ...uniq('category')])])}`, true);
  const conv = () => { const pu = $('#f_purchase_unit').value.trim(), su = $('#f_stock_unit').value.trim(), n = num($('#f_units').value);
    $('#conv').innerHTML = pu && su && n > 0 ? `ตัวอย่าง: สั่ง 1 ${esc(pu)} = <b>${q2(n)}</b> ${esc(su)} · สั่ง 10 ${esc(pu)} = <b>${q2(n * 10)}</b> ${esc(su)}` : '<span style="color:#8a5410">กรอกหน่วยรับเข้า หน่วยในสต็อก และจำนวนต่อหน่วย เพื่อให้แปลงหน่วยได้ถูกต้อง</span>'; };
  ['#f_purchase_unit', '#f_stock_unit', '#f_units'].forEach(id => $(id).oninput = conv); conv();
  $('#skuCancel').onclick = closeModal;
  $('#fSku').onsubmit = async e => {
    e.preventDefault();
    const err = t => { $('#skuErr').innerHTML = `<div class="err" role="alert">${esc(t)}</div>`; };
    const val = {}; SKU_F.forEach(k => { const x = $('#f_' + k).value.trim(); val[k] = x || null; });
    if (!val.code) return err('กรุณากรอกรหัส SKU');
    if (!val.name) return err('กรุณากรอกชื่อสินค้า');
    const raw = $('#f_units').value.trim().replace(/,/g, '');
    val.units_per_purchase = raw ? Number(raw) : null;
    if (raw && (!isFinite(val.units_per_purchase) || val.units_per_purchase <= 0)) return err('จำนวนต่อหน่วยรับเข้าต้องเป็นตัวเลขมากกว่า 0');
    if (S.skus.some(x => x.code.toLowerCase() === val.code.toLowerCase() && x.code !== (s && s.code))) return err('รหัส SKU นี้มีอยู่แล้วในระบบ');
    val.is_tracked = $('#f_tracked').checked;
    $('#skuSave').disabled = true;
    const { error } = s ? await sb.from('stock_skus').update(val).eq('code', s.code) : await sb.from('stock_skus').insert(val);
    $('#skuSave').disabled = false;
    if (error) return err(errMsg(error));
    closeModal(); toast(s ? `✓ บันทึก ${val.code} แล้ว` : `✓ เพิ่ม ${val.code} แล้ว`); loadData(true);
  };
}
