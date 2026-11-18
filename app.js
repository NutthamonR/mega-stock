/* MEGA Clinic stock system — core: helpers, auth, membership gate, shell, data loading */
'use strict';
const C = window.STOCK_CONFIG;
const sb = window.supabase.createClient(C.supabaseUrl, C.supabaseKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });

const S = {
  session: null, member: null, recovery: false, authMode: 'login', authMsg: null,
  route: 'overview', detail: null,
  loaded: false, loading: false, loadErr: null,
  skus: [], usage: {}, months: [], stock: {}, stockDate: null, pendingCount: 0, coverage: {}, usageThrough: null,
  ui: {},
};
const VIEWS = {};

/* ---------- helpers ---------- */
const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n, d = 0) => (n == null || !isFinite(n)) ? '—' : Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const q2 = n => (n == null || !isFinite(n)) ? '—' : Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });
const num = v => { const n = parseFloat(String(v ?? '').replace(/,/g, '')); return isFinite(n) ? n : 0; };
const TH_M = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const mLabel = iso => { const [y, m] = iso.split('-').map(Number); return TH_M[m - 1] + ' ' + String((y + 543) % 100).padStart(2, '0'); };
const dLabel = iso => { if (!iso) return '—'; const [y, m, d] = iso.slice(0, 10).split('-').map(Number); return `${d} ${TH_M[m - 1]} ${y + 543}`; };
const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const thisMonthISO = () => todayISO().slice(0, 8) + '01';
const initials = s => (s || '?').replace(/^(คุณ|นาย|นาง|นางสาว)\s*/, '').trim().slice(0, 2);
const lsGet = (k, d) => { try { const v = localStorage.getItem('mstock.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem('mstock.' + k, JSON.stringify(v)); } catch (e) {} };

function toast(t) { const el = $('#toast'); el.textContent = t; el.classList.add('show'); clearTimeout(toast._t); toast._t = setTimeout(() => el.classList.remove('show'), 2800); }
function openModal(html, wide) { const m = $('#modal'); m.className = 'modal' + (wide ? ' wide' : ''); m.innerHTML = html; $('#overlay').classList.add('show'); const f = m.querySelector('input,select,textarea,button'); if (f) setTimeout(() => f.focus(), 30); }
function closeModal() { $('#overlay').classList.remove('show'); $('#modal').innerHTML = ''; }
$('#overlay').addEventListener('click', e => { if (e.target.id === 'overlay') closeModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && $('#overlay').classList.contains('show')) closeModal(); });

function errMsg(e) {
  const m = String((e && (e.message || e.error_description)) || e || '');
  if (/Invalid login credentials/i.test(m)) return 'อีเมลหรือรหัสผ่านไม่ถูกต้อง';
  if (/Email not confirmed/i.test(m)) return 'ยังไม่ได้ยืนยันอีเมล — เปิดลิงก์ยืนยันในอีเมลก่อน';
  if (/already registered|already been registered/i.test(m)) return 'อีเมลนี้มีบัญชีอยู่แล้ว — เข้าสู่ระบบด้วยรหัสผ่านเดิม (บัญชีเดียวกับระบบรับของ) หรือกดลืมรหัสผ่าน';
  if (/Password should be at least/i.test(m)) return 'รหัสผ่านต้องยาวอย่างน้อย 6 ตัวอักษร';
  if (/Signups not allowed/i.test(m)) return 'ระบบยังปิดการสมัครด้วยตัวเอง — ติดต่อเจ้าของระบบ';
  if (/อนุญาตเฉพาะอีเมล/.test(m)) return 'อนุญาตเฉพาะอีเมล @' + C.allowedDomain;
  if (/duplicate key|23505/i.test(m)) return 'ข้อมูลนี้มีอยู่แล้ว (รหัสซ้ำ)';
  if (/row-level security|permission denied|42501/i.test(m)) return 'ไม่มีสิทธิ์ทำรายการนี้';
  if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return 'เชื่อมต่อฐานข้อมูลไม่ได้ — ตรวจอินเทอร์เน็ต หรือโปรเจกต์ Supabase อาจถูกหยุดชั่วคราว';
  return m || 'เกิดข้อผิดพลาด ลองใหม่อีกครั้ง';
}
async function fetchAll(table, cols, orderCol) {
  const out = []; const size = 1000;
  for (let from = 0; ; from += size) {
    let qy = sb.from(table).select(cols).range(from, from + size - 1);
    if (orderCol) qy = qy.order(orderCol);
    const { data, error } = await qy;
    if (error) throw error;
    out.push(...data);
    if (data.length < size) break;
  }
  return out;
}

/* ---------- data ---------- */
async function loadData(silent) {
  if (S.loading) return;
  S.loading = true; S.loadErr = null; if (!silent) render();
  try {
    const [skus, usage, stock, cov] = await Promise.all([
      fetchAll('stock_skus', '*', 'code'),
      fetchAll('stock_monthly_usage', 'sku_code,month,qty', 'month'),
      fetchAll('stock_latest_onhand', 'sku_code,as_of,qty', 'sku_code'),
      fetchAll('stock_month_coverage', 'month,base_to,base_source,through,mode', 'month'),
    ]);
    S.coverage = {}; S.usageThrough = null;
    cov.forEach(c => { S.coverage[c.month] = c; if (c.through && (!S.usageThrough || c.through > S.usageThrough)) S.usageThrough = c.through; });
    S.skus = skus;
    S.usage = {}; const ms = new Set();
    usage.forEach(r => { (S.usage[r.sku_code] = S.usage[r.sku_code] || {})[r.month] = Number(r.qty); ms.add(r.month); });
    S.months = [...ms].sort();
    S.stock = {}; S.stockDate = null;
    stock.forEach(r => { S.stock[r.sku_code] = { qty: Number(r.qty), as_of: r.as_of }; if (!S.stockDate || r.as_of > S.stockDate) S.stockDate = r.as_of; });
    if (S.member && S.member.is_owner) {
      const { count } = await sb.from('stock_members').select('user_id', { count: 'exact', head: true }).eq('status', 'pending');
      S.pendingCount = count || 0;
    }
    S.loaded = true;
  } catch (e) { S.loadErr = errMsg(e); }
  S.loading = false; render();
}

/* ---------- auth & membership ---------- */
async function loadMember() {
  if (!S.session) { S.member = null; return; }
  const { data, error } = await sb.from('stock_members').select('*').eq('user_id', S.session.user.id).maybeSingle();
  if (error) { S.authMsg = { kind: 'err', text: errMsg(error) }; S.member = null; return; }
  S.member = data;
}
function start() {
  sb.auth.onAuthStateChange((event, session) => {
    S.session = session;
    if (event === 'PASSWORD_RECOVERY') S.recovery = true;
    if (event === 'SIGNED_OUT') { S.member = null; S.loaded = false; S.skus = []; render(); return; }
    if (['INITIAL_SESSION', 'SIGNED_IN', 'USER_UPDATED'].includes(event)) {
      setTimeout(async () => { await loadMember(); render(); }, 0);
    }
  });
}
document.addEventListener('DOMContentLoaded', start);

function authShell(inner) {
  return `<div class="auth">
    <div class="auth-side">
      <div style="display:flex;align-items:center;gap:12px"><div class="logo">M</div><div class="h" style="font-weight:600;font-size:19px">MEGA Clinic</div></div>
      <div><div class="big">ระบบสต็อก<br>ยา &amp; เวชภัณฑ์</div>
        <p>ดูยอดคงเหลือ ยอดใช้รายเดือน ค่าเฉลี่ย 3 / 6 เดือน คำนวณการสั่งซื้อตามโปรโมชั่น และอัปเดตข้อมูลด้วยไฟล์ Excel</p></div>
      <div style="font-size:13px;color:#9fbccd">เข้าใช้ได้เฉพาะบุคลากรที่ได้รับอนุมัติ</div>
    </div>
    <div class="auth-main"><div class="auth-box">${inner}</div></div>
  </div>`;
}
function msgHtml() { return S.authMsg ? `<div class="${S.authMsg.kind === 'ok' ? 'ok' : 'err'}" role="alert">${esc(S.authMsg.text)}</div>` : ''; }

function renderAuth() {
  const m = S.authMode;
  if (m === 'signup') return authShell(`
    <h1>สมัครเข้าใช้งาน</h1><div class="muted" style="font-size:14px;margin-bottom:20px">ใช้อีเมลบริษัท เจ้าของระบบจะอนุมัติก่อนเข้าใช้ได้</div>
    ${msgHtml()}
    <form id="fSignup" novalidate>
      <div class="field"><label for="su_email">อีเมลบริษัท</label><input id="su_email" type="email" autocomplete="email" placeholder="name@${esc(C.allowedDomain)}" required></div>
      <div class="field"><label for="su_pw">ตั้งรหัสผ่าน (อย่างน้อย 8 ตัว)</label><input id="su_pw" type="password" autocomplete="new-password" required></div>
      <div class="field"><label for="su_name">ชื่อ-นามสกุล</label><input id="su_name" required></div>
      <div class="grid2">
        <div class="field"><label for="su_nick">ชื่อเล่น</label><input id="su_nick"></div>
        <div class="field"><label for="su_dept">แผนก</label><input id="su_dept"></div>
        <div class="field full"><label for="su_pos">ตำแหน่ง</label><input id="su_pos"></div>
      </div>
      <button class="btn block" type="submit">สมัครและส่งคำขอ</button>
    </form>
    <div style="text-align:center;margin-top:16px;font-size:13px">มีบัญชีแล้ว (รวมถึงบัญชีระบบรับของ)? <button class="linkbtn" data-auth="login">เข้าสู่ระบบ</button></div>`);
  if (m === 'forgot') return authShell(`
    <h1>ลืมรหัสผ่าน</h1><div class="muted" style="font-size:14px;margin-bottom:20px">ระบบจะส่งลิงก์ตั้งรหัสผ่านใหม่ไปที่อีเมล</div>
    ${msgHtml()}
    <form id="fForgot" novalidate><div class="field"><label for="fg_email">อีเมล</label><input id="fg_email" type="email" autocomplete="email" required></div>
    <button class="btn block" type="submit">ส่งลิงก์</button></form>
    <div style="text-align:center;margin-top:16px"><button class="linkbtn" data-auth="login">← กลับไปเข้าสู่ระบบ</button></div>`);
  return authShell(`
    <h1>เข้าสู่ระบบ</h1><div class="muted" style="font-size:14px;margin-bottom:24px">ใช้บัญชีเดียวกับระบบรับของได้</div>
    ${msgHtml()}
    <form id="fLogin" novalidate>
      <div class="field"><label for="li_email">อีเมล</label><input id="li_email" type="email" autocomplete="email" placeholder="you@${esc(C.allowedDomain)}" required></div>
      <div class="field"><label for="li_pw">รหัสผ่าน</label><input id="li_pw" type="password" autocomplete="current-password" required></div>
      <button class="btn block" type="submit">เข้าสู่ระบบ</button>
    </form>
    <div style="display:flex;justify-content:space-between;margin-top:16px;font-size:13px">
      <button class="linkbtn" data-auth="forgot">ลืมรหัสผ่าน</button>
      <span>ยังไม่มีบัญชี? <button class="linkbtn" data-auth="signup">สมัครเข้าใช้งาน</button></span>
    </div>`);
}
function bindAuth() {
  $$('[data-auth]').forEach(b => b.onclick = () => { S.authMode = b.dataset.auth; S.authMsg = null; render(); });
  const busy = (f, on) => { const b = f.querySelector('button[type=submit]'); b.disabled = on; };
  const fl = $('#fLogin'); if (fl) fl.onsubmit = async e => {
    e.preventDefault(); busy(fl, true);
    const { error } = await sb.auth.signInWithPassword({ email: $('#li_email').value.trim(), password: $('#li_pw').value });
    if (error) { S.authMsg = { kind: 'err', text: errMsg(error) }; render(); } else S.authMsg = null;
  };
  const fs = $('#fSignup'); if (fs) fs.onsubmit = async e => {
    e.preventDefault();
    const email = $('#su_email').value.trim().toLowerCase(), pw = $('#su_pw').value, name = $('#su_name').value.trim();
    if (!email.endsWith('@' + C.allowedDomain)) { S.authMsg = { kind: 'err', text: 'ใช้ได้เฉพาะอีเมล @' + C.allowedDomain }; return render(); }
    if (pw.length < 8) { S.authMsg = { kind: 'err', text: 'รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร' }; return render(); }
    if (!name) { S.authMsg = { kind: 'err', text: 'กรุณากรอกชื่อ-นามสกุล' }; return render(); }
    busy(fs, true);
    const { data, error } = await sb.auth.signUp({ email, password: pw, options: {
      emailRedirectTo: location.origin + location.pathname,
      data: { app: 'stock', full_name: name, nickname: $('#su_nick').value.trim(), department: $('#su_dept').value.trim(), position: $('#su_pos').value.trim() } } });
    if (error) { S.authMsg = { kind: 'err', text: errMsg(error) }; return render(); }
    if (!data.session) { S.authMode = 'login'; S.authMsg = { kind: 'ok', text: 'ส่งคำขอแล้ว — ถ้ามีอีเมลยืนยันส่งไป ให้กดยืนยันก่อน แล้วรอเจ้าของระบบอนุมัติ' }; render(); }
  };
  const ff = $('#fForgot'); if (ff) ff.onsubmit = async e => {
    e.preventDefault(); busy(ff, true);
    const { error } = await sb.auth.resetPasswordForEmail($('#fg_email').value.trim(), { redirectTo: location.origin + location.pathname });
    S.authMsg = error ? { kind: 'err', text: errMsg(error) } : { kind: 'ok', text: 'ถ้าอีเมลนี้มีบัญชี ระบบได้ส่งลิงก์ตั้งรหัสผ่านใหม่ให้แล้ว' };
    render();
  };
}

function renderRecovery() {
  return authShell(`<h1>ตั้งรหัสผ่านใหม่</h1>${msgHtml()}
    <form id="fReset" novalidate><div class="field"><label for="rs_pw">รหัสผ่านใหม่ (อย่างน้อย 8 ตัว)</label><input id="rs_pw" type="password" autocomplete="new-password" required></div>
    <button class="btn block" type="submit">บันทึกรหัสผ่าน</button></form>`);
}
function bindRecovery() {
  $('#fReset').onsubmit = async e => {
    e.preventDefault(); const pw = $('#rs_pw').value;
    if (pw.length < 8) { S.authMsg = { kind: 'err', text: 'รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร' }; return render(); }
    const { error } = await sb.auth.updateUser({ password: pw });
    if (error) { S.authMsg = { kind: 'err', text: errMsg(error) }; return render(); }
    S.recovery = false; S.authMsg = null; toast('✓ ตั้งรหัสผ่านใหม่แล้ว'); render();
  };
}

function gateShell(inner) {
  return authShell(`${inner}<div style="text-align:center;margin-top:18px"><button class="linkbtn" id="gOut">ออกจากระบบ</button></div>`);
}
function renderGate() {
  const m = S.member, email = S.session.user.email;
  if (!m) return gateShell(`<h1>ขอเข้าใช้ระบบสต็อก</h1>
    <div class="muted" style="font-size:14px;margin-bottom:18px">${esc(email)} — กรอกข้อมูลเพื่อส่งคำขอให้เจ้าของระบบอนุมัติ</div>${msgHtml()}
    <form id="fReq" novalidate>
      <div class="field"><label for="rq_name">ชื่อ-นามสกุล</label><input id="rq_name" required value="${esc(S.session.user.user_metadata?.full_name || '')}"></div>
      <div class="grid2">
        <div class="field"><label for="rq_nick">ชื่อเล่น</label><input id="rq_nick"></div>
        <div class="field"><label for="rq_dept">แผนก</label><input id="rq_dept"></div>
        <div class="field full"><label for="rq_pos">ตำแหน่ง</label><input id="rq_pos"></div>
      </div>
      <button class="btn block" type="submit">ส่งคำขอ</button></form>`);
  if (m.status === 'pending') return gateShell(`<h1>รอการอนุมัติ</h1>
    <div class="info">ส่งคำขอของ <b>${esc(m.full_name)}</b> (${esc(m.email)}) แล้ว เจ้าของระบบจะตรวจและอนุมัติ — เมื่ออนุมัติแล้วกดตรวจสอบอีกครั้ง</div>
    <button class="btn block" id="gRe">ตรวจสอบสถานะอีกครั้ง</button>`);
  return gateShell(`<h1>ไม่สามารถเข้าใช้งานได้</h1><div class="err">บัญชีนี้${m.status === 'rejected' ? 'ไม่ได้รับอนุมัติ' : 'ถูกปิดการใช้งาน'} — ติดต่อเจ้าของระบบ</div>`);
}
function bindGate() {
  $('#gOut').onclick = () => sb.auth.signOut();
  const re = $('#gRe'); if (re) re.onclick = async () => { await loadMember(); render(); };
  const f = $('#fReq'); if (f) f.onsubmit = async e => {
    e.preventDefault(); const name = $('#rq_name').value.trim();
    if (!name) { S.authMsg = { kind: 'err', text: 'กรุณากรอกชื่อ-นามสกุล' }; return render(); }
    const { error } = await sb.from('stock_members').insert({ user_id: S.session.user.id, email: S.session.user.email, full_name: name,
      nickname: $('#rq_nick').value.trim() || null, department: $('#rq_dept').value.trim() || null, position: $('#rq_pos').value.trim() || null });
    if (error) { S.authMsg = { kind: 'err', text: errMsg(error) }; return render(); }
    S.authMsg = null; await loadMember(); render();
  };
}

/* ---------- shell ---------- */
const ROUTES = [['overview', 'ภาพรวมสต็อก'], ['promo', 'คำนวณโปรโมชั่น'], ['sku', 'รายการหลัก (SKU)'], ['import', 'นำเข้าข้อมูล'], ['team', 'ทีม & สิทธิ์']];
function readRoute() { const h = location.hash.replace('#', ''); S.route = ROUTES.some(r => r[0] === h) || h === 'profile' ? h : 'overview'; }
window.addEventListener('hashchange', () => { readRoute(); S.detail = null; render(); window.scrollTo(0, 0); });

function renderShell() {
  const m = S.member;
  const tabs = ROUTES.map(([k, l]) => `<a href="#${k}" class="${S.route === k ? 'on' : ''}">${l}${k === 'team' && m.is_owner && S.pendingCount ? `<span class="badge">${S.pendingCount}</span>` : ''}</a>`).join('');
  let body;
  if (S.loadErr && !S.loaded) body = `<div class="err" style="margin-top:20px">${esc(S.loadErr)} <button class="btn small ghost" id="retry">ลองใหม่</button></div>`;
  else if (!S.loaded) body = `<div class="empty">กำลังโหลดข้อมูล…</div>`;
  else body = (VIEWS[S.route] || VIEWS.overview).html();
  return `<div class="wrap">
    <header class="top">
      <a href="#overview" class="brand" style="text-decoration:none;color:inherit"><div class="logo dark">M</div>MEGA Clinic <span>· คลังยา</span></a>
      <nav class="tabs" aria-label="เมนูหลัก">${tabs}</nav>
      <div class="me">
        <a href="#profile" style="display:flex;align-items:center;gap:10px;text-decoration:none;color:inherit" title="โปรไฟล์ของฉัน">
          <div class="who"><div>${esc(m.nickname ? `${m.nickname} · ${m.full_name}` : m.full_name)}</div><div>${esc(m.position || m.department || '')}${m.is_owner ? ' · เจ้าของระบบ' : ''}</div></div>
          <div class="avatar">${esc(initials(m.nickname || m.full_name))}</div></a>
        <button class="logout" id="logout">ออกจากระบบ</button>
      </div>
    </header>
    ${S.loadErr && S.loaded ? `<div class="warnbox">${esc(S.loadErr)}</div>` : ''}
    <main id="main">${body}</main>
  </div>`;
}
function bindShell() {
  $('#logout').onclick = () => sb.auth.signOut();
  const r = $('#retry'); if (r) r.onclick = () => loadData();
  if (S.loaded) (VIEWS[S.route] || VIEWS.overview).bind();
}

/* ---------- render ---------- */
function render() {
  const app = $('#app');
  if (S.recovery && S.session) { app.innerHTML = renderRecovery(); return bindRecovery(); }
  if (!S.session) { app.innerHTML = renderAuth(); return bindAuth(); }
  if (!S.member || S.member.status !== 'approved') { app.innerHTML = renderGate(); return bindGate(); }
  if (!S.loaded && !S.loading && !S.loadErr) { loadData(); return; }
  const y = window.scrollY;
  app.innerHTML = renderShell(); bindShell();
  window.scrollTo(0, y);
}
readRoute();
