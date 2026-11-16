/* Team & access (owner approves) + my profile */
'use strict';
const ST_LABEL = { pending: ['รออนุมัติ', '#fdf4e3', '#8a5410'], approved: ['ใช้งานได้', '#e9f6ef', '#1f7a55'], rejected: ['ไม่อนุมัติ', '#f9e3e4', '#780000'], disabled: ['ปิดการใช้งาน', '#edf1ec', '#46524c'] };
const TEAM = { list: null, err: null, f: 'all' };

async function loadTeam() {
  const { data, error } = await sb.from('stock_members').select('*').order('requested_at', { ascending: false });
  TEAM.list = error ? [] : data; TEAM.err = error ? errMsg(error) : null;
  S.pendingCount = (data || []).filter(m => m.status === 'pending').length;
  render();
}
function profileFields(m, prefix) {
  return `<div class="grid2">
    <div class="field full"><label for="${prefix}name">ชื่อ-นามสกุล *</label><input id="${prefix}name" value="${esc(m.full_name)}"></div>
    <div class="field"><label for="${prefix}nick">ชื่อเล่น</label><input id="${prefix}nick" value="${esc(m.nickname || '')}"></div>
    <div class="field"><label for="${prefix}dept">แผนก</label><input id="${prefix}dept" value="${esc(m.department || '')}"></div>
    <div class="field full"><label for="${prefix}pos">ตำแหน่ง</label><input id="${prefix}pos" value="${esc(m.position || '')}"></div></div>`;
}
const readProfile = p => ({ full_name: $('#' + p + 'name').value.trim(), nickname: $('#' + p + 'nick').value.trim() || null, department: $('#' + p + 'dept').value.trim() || null, position: $('#' + p + 'pos').value.trim() || null });

VIEWS.team = {
  html() {
    const me = S.member;
    if (!me.is_owner) return `<div class="pagehead"><div><h1>ทีม &amp; สิทธิ์</h1><div class="sub">การอนุมัติผู้ใช้ทำได้เฉพาะเจ้าของระบบ</div></div></div>
      <div class="info">ผู้ใช้ที่ได้รับอนุมัติทำได้ทุกอย่างในระบบ (ดู แก้ไข SKU นำเข้าข้อมูล) — ถ้าต้องการให้เพื่อนร่วมงานเข้าใช้ ให้สมัครด้วยอีเมลบริษัท แล้วแจ้งเจ้าของระบบให้อนุมัติ</div>
      <a class="btn ghost" href="#profile">แก้ไขโปรไฟล์ของฉัน</a>`;
    if (TEAM.list === null) { loadTeam(); return '<div class="empty">กำลังโหลดรายชื่อ…</div>'; }
    const list = TEAM.list.filter(m => TEAM.f === 'all' || m.status === TEAM.f);
    const cnt = k => TEAM.list.filter(m => k === 'all' || m.status === k).length;
    return `<div class="pagehead"><div><h1>ทีม &amp; สิทธิ์การเข้าถึง</h1><div class="sub">ผู้ที่สมัครด้วยอีเมลบริษัทจะเข้าใช้ได้หลังคุณอนุมัติ · อนุมัติแล้วทำได้ทุกอย่าง</div></div>
      <button class="btn ghost" id="tReload">↻ โหลดใหม่</button></div>
      ${TEAM.err ? `<div class="err">${esc(TEAM.err)}</div>` : ''}
      <div class="info">ลิงก์สำหรับให้ทีมสมัคร: <b>${esc(location.origin + location.pathname)}</b> → กด "สมัครเข้าใช้งาน" (คนที่มีบัญชีระบบรับของอยู่แล้วให้เข้าสู่ระบบด้วยรหัสเดิม แล้วส่งคำขอ)</div>
      <div class="toolbar">${[['all', 'ทั้งหมด'], ['pending', 'รออนุมัติ'], ['approved', 'ใช้งานได้'], ['rejected', 'ไม่อนุมัติ'], ['disabled', 'ปิดการใช้งาน']].map(([k, l]) => `<button class="chip ${TEAM.f === k ? 'on' : ''}" data-tf="${k}">${l} (${cnt(k)})</button>`).join('')}</div>
      <div class="card" style="overflow:hidden"><div class="scroll"><table class="t" style="min-width:860px">
        <thead><tr><th>ชื่อ</th><th>แผนก / ตำแหน่ง</th><th>สถานะ</th><th>ขอเมื่อ</th><th class="r">จัดการ</th></tr></thead>
        <tbody>${list.map(m => { const [l, bg, fg] = ST_LABEL[m.status]; const self = m.user_id === me.user_id; return `<tr>
          <td><div style="display:flex;align-items:center;gap:12px"><div class="avatar">${esc(initials(m.nickname || m.full_name))}</div><div><div style="font-weight:600">${esc(m.full_name)}${m.nickname ? ` <span class="muted" style="font-weight:400">(${esc(m.nickname)})</span>` : ''}</div><div class="small muted">${esc(m.email)}</div></div></div></td>
          <td>${esc(m.department || '—')}<div class="small muted">${esc(m.position || '')}</div></td>
          <td><span class="status" style="background:${bg};color:${fg}">${l}</span>${m.is_owner ? ' <span class="tag">เจ้าของระบบ</span>' : ''}</td>
          <td class="small">${dLabel(m.requested_at)}</td>
          <td class="r" style="white-space:nowrap">${self ? '<span class="small muted">บัญชีของคุณ</span>' : `
            ${m.status !== 'approved' ? `<button class="btn small" data-act="approved" data-id="${m.user_id}">อนุมัติ</button>` : ''}
            ${m.status === 'pending' ? `<button class="btn danger small" data-act="rejected" data-id="${m.user_id}">ไม่อนุมัติ</button>` : ''}
            ${m.status === 'approved' ? `<button class="btn danger small" data-act="disabled" data-id="${m.user_id}">ปิดการใช้งาน</button>` : ''}
            <button class="btn ghost small" data-medit="${m.user_id}">แก้ไข</button>`}</td></tr>`; }).join('') || '<tr><td colspan="5" class="empty">ไม่มีรายการ</td></tr>'}</tbody></table></div></div>`;
  },
  bind() {
    const r = $('#tReload'); if (r) r.onclick = () => { TEAM.list = null; render(); };
    $$('[data-tf]').forEach(b => b.onclick = () => { TEAM.f = b.dataset.tf; render(); });
    $$('[data-act]').forEach(b => b.onclick = async () => {
      b.disabled = true;
      const { error } = await sb.from('stock_members').update({ status: b.dataset.act }).eq('user_id', b.dataset.id);
      if (error) { toast(errMsg(error)); b.disabled = false; return; }
      toast({ approved: '✓ อนุมัติแล้ว', rejected: 'ไม่อนุมัติคำขอแล้ว', disabled: 'ปิดการใช้งานแล้ว' }[b.dataset.act]); loadTeam();
    });
    $$('[data-medit]').forEach(b => b.onclick = () => {
      const m = TEAM.list.find(x => x.user_id === b.dataset.medit);
      openModal(`<h2>แก้ไขข้อมูลสมาชิก</h2><div class="small muted" style="margin-bottom:16px">${esc(m.email)}</div><form id="fMem" novalidate>${profileFields(m, 'm_')}<div id="memErr"></div>
        <div class="actions"><button type="button" class="btn ghost" id="memCancel">ยกเลิก</button><button class="btn" type="submit">บันทึก</button></div></form>`);
      $('#memCancel').onclick = closeModal;
      $('#fMem').onsubmit = async e => { e.preventDefault(); const v = readProfile('m_');
        if (!v.full_name) { $('#memErr').innerHTML = '<div class="err">กรุณากรอกชื่อ-นามสกุล</div>'; return; }
        const { error } = await sb.from('stock_members').update(v).eq('user_id', m.user_id);
        if (error) { $('#memErr').innerHTML = `<div class="err">${esc(errMsg(error))}</div>`; return; }
        closeModal(); toast('✓ บันทึกแล้ว'); loadTeam(); };
    });
  },
};

VIEWS.profile = {
  html() {
    const m = S.member;
    return `<div class="pagehead"><div><h1>โปรไฟล์ของฉัน</h1><div class="sub">${esc(m.email)} · ${m.is_owner ? 'เจ้าของระบบ' : 'สมาชิก'}</div></div></div>
      <div class="card pad" style="max-width:640px"><form id="fMe" novalidate>${profileFields(m, 'p_')}<div id="meErr"></div>
        <div class="actions"><button class="btn" type="submit">บันทึก</button></div></form></div>
      <div class="card pad" style="max-width:640px;margin-top:14px"><div class="title" style="margin-bottom:10px">เปลี่ยนรหัสผ่าน</div>
        <div class="small muted" style="margin-bottom:12px">รหัสผ่านนี้ใช้ร่วมกับระบบรับของ</div>
        <form id="fPw" novalidate><div class="field"><label for="p_pw">รหัสผ่านใหม่ (อย่างน้อย 8 ตัว)</label><input id="p_pw" type="password" autocomplete="new-password"></div><div id="pwErr"></div>
        <div class="actions"><button class="btn ghost" type="submit">เปลี่ยนรหัสผ่าน</button></div></form></div>`;
  },
  bind() {
    $('#fMe').onsubmit = async e => { e.preventDefault(); const v = readProfile('p_');
      if (!v.full_name) { $('#meErr').innerHTML = '<div class="err">กรุณากรอกชื่อ-นามสกุล</div>'; return; }
      const { data, error } = await sb.from('stock_members').update(v).eq('user_id', S.member.user_id).select().single();
      if (error) { $('#meErr').innerHTML = `<div class="err">${esc(errMsg(error))}</div>`; return; }
      S.member = data; toast('✓ บันทึกโปรไฟล์แล้ว'); render(); };
    $('#fPw').onsubmit = async e => { e.preventDefault(); const pw = $('#p_pw').value;
      if (pw.length < 8) { $('#pwErr').innerHTML = '<div class="err">รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร</div>'; return; }
      const { error } = await sb.auth.updateUser({ password: pw });
      if (error) { $('#pwErr').innerHTML = `<div class="err">${esc(errMsg(error))}</div>`; return; }
      $('#p_pw').value = ''; toast('✓ เปลี่ยนรหัสผ่านแล้ว'); };
  },
};
