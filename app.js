import { createBackend, DEMO } from './db.js';
import {
  SECTIONS, SECTION_MAP, GROUPS, ROLES, ROLE_LABEL, num, gla, ledger, registerHint, sectionProgress, revenueNOI, weightedScore, sectionForRoles,
} from './questionnaire.js';

const APP_NAME = (window.NOI_CONFIG && window.NOI_CONFIG.APP_NAME) || 'NOI Optimization Workbook';
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const app = $('#app');

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = {
  currency: (v) => (v === null || v === undefined ? '—' : (v < 0 ? '−$' : '$') + Math.abs(Math.round(v)).toLocaleString('en-CA')),
  currency2: (v) => (v === null || v === undefined ? '—' : (v < 0 ? '−$' : '$') + Math.abs(v).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })),
  years: (v) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : v.toFixed(1) + ' yrs'),
  int: (v) => (v === null || v === undefined ? '—' : String(Math.round(v))),
  flag: (v) => v || '—',
  band: (v) => v || '—',
};
const timeAgo = (iso) => {
  if (!iso) return '';
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + ' min ago';
  if (s < 86400) return Math.floor(s / 3600) + ' h ago';
  return new Date(iso).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' });
};
const STATUS = { in_progress: 'In progress', submitted: 'Submitted', reviewed: 'Reviewed' };

let api; let session = null; let profile = null;
const state = { q: null, rows: {}, data: {}, members: [], role: null, section: null, calcs: [], timers: {}, pending: new Set(), saving: new Set() };

// ------------------------------------------------------------------ helpers
function toast(msg, kind = '') {
  const t = document.createElement('div');
  t.className = 'toast ' + kind; t.textContent = msg; t.setAttribute('role', 'status');
  $('#toasts').appendChild(t);
  setTimeout(() => t.classList.add('out'), 3200);
  setTimeout(() => t.remove(), 3700);
}
const go = (hash) => { if (location.hash === hash) render(); else location.hash = hash; };
const errMsg = (e) => (e && (e.message || e.error_description)) || 'Something went wrong. Try again.';

function getPath(obj, path) { return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj); }
function setPath(obj, path, value) {
  const keys = path.split('.');
  let o = obj;
  keys.slice(0, -1).forEach((k, i) => {
    const nextIsIndex = /^\d+$/.test(keys[i + 1]);
    if (o[k] == null || typeof o[k] !== 'object') o[k] = nextIsIndex ? [] : {};
    o = o[k];
  });
  o[keys[keys.length - 1]] = value;
}

const canEdit = () => state.role === 'owner' || state.role === 'editor' || (profile && profile.is_admin);
const isOwner = () => state.role === 'owner' || (profile && profile.is_admin);
const locked = () => !canEdit() || (state.q && state.q.status !== 'in_progress');

// ----- roles: each person sees the sections for their role(s)
const myRoles = () => (profile && Array.isArray(profile.job_roles) ? profile.job_roles : []);
const showAllKey = () => 'noi-show-all-' + (session ? session.user.id : '');
const getShowAll = () => { try { return localStorage.getItem(showAllKey()) === '1'; } catch { return false; } };
const setShowAll = (v) => { try { localStorage.setItem(showAllKey(), v ? '1' : '0'); } catch { /* ignore */ } };
const canSeeAll = () => isOwner() || (profile && profile.is_admin);
function visibleSections() {
  if (!myRoles().length) return SECTIONS; // e.g. an admin who skipped choosing a role
  if (canSeeAll() && getShowAll()) return SECTIONS;
  return SECTIONS.filter((s) => sectionForRoles(s, myRoles()));
}
const canEditSection = (s) => isOwner() || (canEdit() && sectionForRoles(s, myRoles()));
const roleLabels = (roles) => (roles || []).map((r) => ROLE_LABEL[r] || r).join(', ');

function rolePicker(selected = [], name = 'job_roles') {
  return `<div class="role-grid" role="group" aria-label="Your role">${ROLES.map((r) => `
    <label class="role-opt"><input type="checkbox" name="${name}" value="${r.key}" ${selected.includes(r.key) ? 'checked' : ''}><span>${esc(r.label)}</span></label>`).join('')}</div>`;
}
const pickedRoles = (form, name = 'job_roles') => $$(`input[name="${name}"]:checked`, form).map((x) => x.value);

function ctxFor() {
  const all = state.data;
  return {
    all, gla: gla(all),
    registerHint: (row) => registerHint(row, all),
  };
}

// --------------------------------------------------------------- boot
async function boot() {
  try {
    api = await createBackend();
  } catch (e) {
    app.innerHTML = `<div class="fatal"><h1>Can't reach Supabase</h1><p>The site couldn't load the Supabase library. Check your internet connection and the values in <code>config.js</code>, then reload.</p><pre>${esc(errMsg(e))}</pre></div>`;
    return;
  }
  session = await api.session();
  if (location.search.includes('code=')) history.replaceState(null, '', location.pathname + location.hash);
  api.onAuth(async (event, s) => {
    if (!s || !session || s.user.id !== session.user.id) { state.q = null; profile = null; }
    session = s;
    if (event === 'PASSWORD_RECOVERY') { location.hash = '#/reset'; return; }
    if (event === 'SIGNED_OUT') { profile = null; go('#/login'); return; }
    if (event === 'SIGNED_IN' && s && (!location.hash || location.hash.startsWith('#/login') || location.hash.startsWith('#/signup'))) {
      profile = null; go('#/');
    }
  });
  window.addEventListener('hashchange', render);
  window.addEventListener('beforeunload', (e) => { if (state.pending.size) { flushAll(); e.preventDefault(); } });
  render();
}

async function render() {
  const hash = location.hash || '#/';
  const parts = hash.replace(/^#\/?/, '').split('/');
  const publicRoutes = ['login', 'signup', 'forgot', 'reset'];

  if (publicRoutes.includes(parts[0])) {
    if (parts[0] === 'reset') return renderReset();
    if (session && parts[0] !== 'reset') return go('#/');
    return renderAuth(parts[0]);
  }
  if (!session) return go('#/login');
  if (!profile) profile = (await api.profile(session.user.id)) || { email: session.user.email, full_name: '', is_admin: false, job_roles: [] };
  if (parts[0] === 'welcome' || (!myRoles().length && !profile.is_admin && !profile.skipRoles)) return renderWelcome();

  await flushAll();
  if (parts[0] === 'q' && parts[1]) return renderWorkbook(parts[1], parts[2]);
  if (parts[0] === 'account') return renderAccount();
  return renderDashboard();
}

// ----------------------------------------------------------------- auth
function authShell(inner) {
  app.innerHTML = `
  <div class="auth">
    <aside class="auth-art" aria-hidden="true">
      <div class="brand"><span class="mark"></span>${esc(APP_NAME)}</div>
      <div class="tape">
        <div class="tape-row"><span>Operating expense calibration</span><b>$48,200</b></div>
        <div class="tape-row"><span>Property tax</span><b>$31,500</b></div>
        <div class="tape-row"><span>Other revenue</span><b>$22,750</b></div>
        <div class="tape-row"><span>Energy savings</span><b>$96,000</b></div>
        <div class="tape-total"><span>Identified NOI opportunity</span><b>$198,450</b></div>
      </div>
      <p class="auth-quote">Each of us takes a slice of the work — combined, it makes a bigger pie.</p>
    </aside>
    <main class="auth-main">${DEMO ? '<div class="demo-flag">Demo mode — add your Supabase keys in config.js to go live. Data stays in this browser.</div>' : ''}${inner}</main>
  </div>`;
}

function renderAuth(mode) {
  const forms = {
    login: `
      <h1>Sign in</h1>
      <p class="lede">Open your property's NOI workbook.</p>
      <form id="f" novalidate>
        <label class="fl">Email<input name="email" type="email" autocomplete="email" required></label>
        <label class="fl">Password<input name="password" type="password" autocomplete="current-password" required></label>
        <div class="err" id="err" role="alert"></div>
        <button class="btn primary wide" type="submit">Sign in</button>
      </form>
      <div class="auth-links"><a href="#/forgot">Forgot password?</a><span>New here? <a href="#/signup">Create an account</a></span></div>`,
    signup: `
      <h1>Create an account</h1>
      <p class="lede">Use the work email your manager invited, so your property's workbook appears when you sign in.</p>
      <form id="f" novalidate>
        <label class="fl">Full name<input name="full_name" autocomplete="name" required></label>
        <label class="fl">Title / role<input name="title" placeholder="e.g. Property Manager"></label>
        <label class="fl">Work email<input name="email" type="email" autocomplete="email" required></label>
        <label class="fl">Password<input name="password" type="password" autocomplete="new-password" minlength="8" required><small>At least 8 characters.</small></label>
        <fieldset class="fl roles-fs"><legend>Your role</legend><small>You'll see the questions for your role. Pick more than one if you cover several.</small>${rolePicker()}</fieldset>
        <div class="err" id="err" role="alert"></div>
        <button class="btn primary wide" type="submit">Create account</button>
      </form>
      <div class="auth-links"><span>Already have an account? <a href="#/login">Sign in</a></span></div>`,
    forgot: `
      <h1>Reset your password</h1>
      <p class="lede">We'll email you a link to choose a new one.</p>
      <form id="f" novalidate>
        <label class="fl">Email<input name="email" type="email" autocomplete="email" required></label>
        <div class="err" id="err" role="alert"></div>
        <button class="btn primary wide" type="submit">Email reset link</button>
      </form>
      <div class="auth-links"><a href="#/login">Back to sign in</a></div>`,
  };
  authShell(forms[mode] || forms.login);
  const f = $('#f'); const err = $('#err');
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = Object.fromEntries(new FormData(f));
    const btn = $('button[type=submit]', f); btn.disabled = true; err.textContent = '';
    try {
      if (mode === 'login') { await api.signIn(v.email.trim(), v.password); }
      else if (mode === 'signup') {
        if ((v.password || '').length < 8) throw new Error('Use a password with at least 8 characters.');
        const roles = pickedRoles(f);
        if (!roles.length) throw new Error('Choose your role so we can show you the right questions.');
        const res = await api.signUp(v.email.trim(), v.password, v.full_name.trim(), v.title.trim(), roles);
        if (!res.session) {
          $('.auth-main').innerHTML = `<h1>Check your email</h1><p class="lede">We sent a confirmation link to <b>${esc(v.email)}</b>. Open it on this device to finish creating your account.</p><a class="btn" href="#/login">Back to sign in</a>`;
          return;
        }
      } else if (mode === 'forgot') {
        await api.resetPassword(v.email.trim());
        $('.auth-main').innerHTML = `<h1>Check your email</h1><p class="lede">If an account exists for <b>${esc(v.email)}</b>, a reset link is on its way.</p><a class="btn" href="#/login">Back to sign in</a>`;
        return;
      }
    } catch (ex) { err.textContent = errMsg(ex); }
    btn.disabled = false;
  });
  $('input', f).focus();
}

function renderReset() {
  authShell(`
    <h1>Choose a new password</h1>
    <form id="f" novalidate>
      <label class="fl">New password<input name="password" type="password" minlength="8" autocomplete="new-password" required></label>
      <div class="err" id="err" role="alert"></div>
      <button class="btn primary wide" type="submit">Save password</button>
    </form>`);
  $('#f').addEventListener('submit', async (e) => {
    e.preventDefault();
    const p = new FormData(e.target).get('password');
    if (p.length < 8) { $('#err').textContent = 'Use at least 8 characters.'; return; }
    try { await api.updatePassword(p); toast('Password saved'); go('#/'); } catch (ex) { $('#err').textContent = errMsg(ex); }
  });
}

// ------------------------------------------------------------- top bar
function topbar(crumb = '') {
  const name = (profile && (profile.full_name || profile.email)) || '';
  return `
  <header class="topbar">
    <a class="brand" href="#/"><span class="mark"></span><span class="brand-name">${esc(APP_NAME)}</span></a>
    ${crumb ? `<span class="crumb">${crumb}</span>` : ''}
    <div class="spacer"></div>
    ${DEMO ? '<span class="pill warn" title="Add Supabase keys in config.js">Demo mode</span>' : ''}
    <details class="menu">
      <summary aria-label="Account menu"><span class="avatar">${esc((name[0] || '?').toUpperCase())}</span><span class="menu-name">${esc(name)}</span></summary>
      <div class="menu-pop">
        <div class="menu-head">${esc(profile.email || '')}${profile.is_admin ? ' <span class="pill">Admin</span>' : ''}</div>
        <a href="#/account">Account</a>
        <button type="button" id="signout">Sign out</button>
      </div>
    </details>
  </header>`;
}
function wireTopbar() {
  const so = $('#signout'); if (so) so.onclick = async () => { await flushAll(); await api.signOut(); };
}

// -------------------------------------------------------------- welcome
function renderWelcome() {
  const first = (profile.full_name || '').split(' ')[0];
  app.innerHTML = topbar() + `
  <main class="narrow welcome">
    <h1>${first ? 'Welcome, ' + esc(first) : 'Welcome'}</h1>
    <p class="lede">What's your role on the site team? The workbook will show you the questions you're responsible for.</p>
    <form id="wf" class="card-form">
      ${profile.full_name ? '' : '<label class="fl">Full name<input name="full_name" autocomplete="name" required></label>'}
      <fieldset class="fl roles-fs"><legend>Your role</legend><small>Pick more than one if you cover several areas.</small>${rolePicker(myRoles())}</fieldset>
      <div class="err" id="err" role="alert"></div>
      <div class="row-btns end">
        ${profile.is_admin ? '<button type="button" class="btn ghost" id="skip">Skip — show me everything</button>' : ''}
        <button class="btn primary" type="submit">Continue</button>
      </div>
    </form>
  </main>`;
  wireTopbar();
  $('#wf').onsubmit = async (e) => {
    e.preventDefault();
    const roles = pickedRoles(e.target);
    if (!roles.length) { $('#err').textContent = 'Choose at least one role.'; return; }
    const patch = { job_roles: roles };
    const fn = e.target.full_name; if (fn) patch.full_name = fn.value.trim();
    try { await api.updateProfile(session.user.id, patch); Object.assign(profile, patch); state.q = null; go('#/'); } catch (ex) { $('#err').textContent = errMsg(ex); }
  };
  const skip = $('#skip'); if (skip) skip.onclick = () => { profile.skipRoles = true; go('#/'); };
}

// ------------------------------------------------------------ dashboard
function avgProgress(list, responses) {
  const vals = list.map((s) => sectionProgress(s, responses[s.key])).filter((v) => v !== null);
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
}
function overallProgress(responses) {
  const vals = SECTIONS.map((s) => sectionProgress(s, responses[s.key])).filter((v) => v !== null);
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
}

async function renderDashboard() {
  app.innerHTML = topbar() + '<main class="dash"><div class="loading">Loading workbooks…</div></main>';
  wireTopbar();
  let list = [];
  try { list = await api.listQuestionnaires(); } catch (e) { $('.dash').innerHTML = `<div class="empty"><h2>Couldn't load workbooks</h2><p>${esc(errMsg(e))}</p><p class="muted">If you just set up Supabase, check that <code>supabase/schema.sql</code> ran without errors.</p></div>`; return; }

  const first = (profile.full_name || '').split(' ')[0];
  const portfolio = list.reduce((a, q) => a + ledger(q.responses).reduce((x, l) => x + (l.value || 0), 0), 0);
  const cards = list.map((q) => {
    const total = ledger(q.responses).reduce((a, l) => a + (l.value || 0), 0);
    const mine = SECTIONS.filter((s) => sectionForRoles(s, myRoles()) && !s.noProgress);
    const p = myRoles().length ? avgProgress(mine, q.responses) : overallProgress(q.responses);
    const me = q.members.find((m) => m.email === (profile.email || '').toLowerCase());
    return `
    <a class="wb-card" href="#/q/${q.id}">
      <div class="wb-top"><span class="pill ${q.status}">${STATUS[q.status]}</span><span class="muted small">Updated ${timeAgo(q.updated_at)}</span></div>
      <h3>${esc(q.property_name)}</h3>
      <p class="muted">${esc(q.property_address || '')}</p>
      <div class="wb-figure"><b>${total ? fmt.currency(total) : '—'}</b><span>NOI opportunity identified</span></div>
      <div class="bar" role="progressbar" aria-valuenow="${Math.round(p * 100)}" aria-valuemin="0" aria-valuemax="100"><i style="width:${Math.round(p * 100)}%"></i></div>
      <div class="wb-foot"><span>${Math.round(p * 100)}% ${myRoles().length ? 'of your sections' : 'answered'}</span><span>${q.members.length} ${q.members.length === 1 ? 'person' : 'people'}${me ? ' · ' + me.role : ''}</span></div>
    </a>`;
  }).join('');

  $('.dash').innerHTML = `
    <div class="dash-head">
      <div><h1>${first ? 'Hi ' + esc(first) : 'Your workbooks'}</h1>
      <p class="lede">${list.length ? 'Pick up where your team left off. Answers save automatically.' : "You don't have access to any property workbooks yet."}</p></div>
      <div class="dash-actions">
        ${list.length ? `<div class="dash-stat"><b>${fmt.currency(portfolio)}</b><span>identified across ${list.length} ${list.length === 1 ? 'property' : 'properties'}</span></div>` : ''}
        <button class="btn primary" id="new">New property workbook</button>
      </div>
    </div>
    ${list.length ? `<div class="wb-grid">${cards}</div>` : `<div class="empty"><h2>No workbooks yet</h2><p>Start one for your property, or ask your account lead to add your email (<b>${esc(profile.email)}</b>) to an existing workbook.</p></div>`}`;
  $('#new').onclick = newWorkbookDialog;
}

function dialog(html, onSubmit) {
  const d = document.createElement('dialog');
  d.className = 'dlg';
  d.innerHTML = `<form method="dialog" class="dlg-form">${html}<div class="err" role="alert"></div></form>`;
  document.body.appendChild(d);
  d.addEventListener('close', () => d.remove());
  $('[data-cancel]', d)?.addEventListener('click', () => d.close());
  $('form', d).addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('button[type=submit]', d); btn.disabled = true;
    try { await onSubmit(Object.fromEntries(new FormData(e.target)), d); d.close(); } catch (ex) { $('.err', d).textContent = errMsg(ex); btn.disabled = false; }
  });
  d.showModal();
  $('input', d)?.focus();
  return d;
}

function newWorkbookDialog() {
  dialog(`
    <h2>New property workbook</h2>
    <label class="fl">Property name<input name="name" required></label>
    <label class="fl">Address<input name="address"></label>
    <p class="muted small">You'll be the owner and can add your site team next.</p>
    <div class="dlg-actions"><button type="button" class="btn ghost" data-cancel>Cancel</button><button class="btn primary" type="submit">Create workbook</button></div>`,
  async (v) => {
    if (!v.name.trim()) throw new Error('Enter a property name.');
    const id = await api.createQuestionnaire(v.name.trim(), v.address.trim(), session.user.id);
    await api.saveResponse(id, 'site', { property_name: v.name.trim(), property_address: v.address.trim() });
    go(`#/q/${id}/team`);
  });
}

// --------------------------------------------------------------- account
function renderAccount() {
  app.innerHTML = topbar('Account') + `
  <main class="narrow">
    <h1>Account</h1>
    <form id="prof" class="card-form">
      <label class="fl">Full name<input name="full_name" value="${esc(profile.full_name || '')}"></label>
      <label class="fl">Title / role<input name="title" value="${esc(profile.title || '')}"></label>
      <label class="fl">Email<input value="${esc(profile.email || session.user.email)}" disabled></label>
      <fieldset class="fl roles-fs"><legend>Your role</legend><small>Controls which questionnaire sections you see and can answer.</small>${rolePicker(myRoles())}</fieldset>
      <button class="btn primary" type="submit">Save profile</button>
    </form>
    <form id="pw" class="card-form">
      <h2>Change password</h2>
      <label class="fl">New password<input name="password" type="password" minlength="8" autocomplete="new-password"></label>
      <button class="btn" type="submit">Change password</button>
    </form>
  </main>`;
  wireTopbar();
  $('#prof').onsubmit = async (e) => {
    e.preventDefault(); const v = Object.fromEntries(new FormData(e.target));
    const patch = { full_name: v.full_name, title: v.title, job_roles: pickedRoles(e.target) };
    if (!patch.job_roles.length && !profile.is_admin) return toast('Choose at least one role.', 'bad');
    try { await api.updateProfile(session.user.id, patch); Object.assign(profile, patch); state.q = null; toast('Profile saved'); renderAccount(); } catch (ex) { toast(errMsg(ex), 'bad'); }
  };
  $('#pw').onsubmit = async (e) => {
    e.preventDefault(); const p = new FormData(e.target).get('password');
    if (p.length < 8) return toast('Use at least 8 characters.', 'bad');
    try { await api.updatePassword(p); toast('Password changed'); e.target.reset(); } catch (ex) { toast(errMsg(ex), 'bad'); }
  };
}

// -------------------------------------------------------------- workbook
async function loadWorkbook(id) {
  if (state.q && state.q.id === id && state.loadedFor === session.user.id) return true;
  state.loadedFor = session.user.id;
  const [q, rows, members] = await Promise.all([api.getQuestionnaire(id), api.getResponses(id), api.listMembers(id)]);
  if (!q) return false;
  state.q = q; state.rows = rows; state.members = members;
  state.data = Object.fromEntries(Object.entries(rows).map(([k, r]) => [k, r.data || {}]));
  const me = members.find((m) => m.email === (session.user.email || '').toLowerCase());
  state.role = me ? me.role : (profile.is_admin ? 'owner' : 'viewer');
  return true;
}

async function renderWorkbook(id, sectionKey) {
  if (!state.q || state.q.id !== id) app.innerHTML = topbar() + '<main class="dash"><div class="loading">Opening workbook…</div></main>';
  let ok;
  try { ok = await loadWorkbook(id); } catch (e) { ok = false; }
  if (!ok) {
    app.innerHTML = topbar() + `<main class="dash"><div class="empty"><h2>Workbook not found</h2><p>It may have been deleted, or you haven't been added to it. Ask the workbook owner to add <b>${esc(session.user.email)}</b>.</p><a class="btn" href="#/">Back to workbooks</a></div></main>`;
    wireTopbar(); return;
  }
  if (!sectionKey) return go(`#/q/${id}/${SECTIONS[0].key}`);

  const vis = visibleSections();
  const nav = GROUPS.filter((g) => vis.some((s) => s.group === g.key)).map((g) => `
    <div class="nav-group"><div class="nav-label">${esc(g.label)}</div>
    ${vis.filter((s) => s.group === g.key).map((s) => {
      const p = sectionProgress(s, state.data[s.key]);
      return `<a class="nav-item ${s.key === sectionKey ? 'on' : ''}" href="#/q/${id}/${s.key}" data-key="${s.key}">
        <span class="ring" style="--p:${p === null ? 0 : Math.round(p * 100)}" ${p === null ? 'data-none' : ''}></span>
        <span class="nav-text">${esc(s.title)}${s.optional ? ' <em>optional</em>' : ''}</span></a>`;
    }).join('')}</div>`).join('');

  app.innerHTML = topbar(`<a href="#/">Workbooks</a><span class="sep">/</span>${esc(state.q.property_name)}`) + `
  <div class="wb">
    <nav class="side" id="side" aria-label="Sections">
      <div class="side-head">
        <div class="side-title">${esc(state.q.property_name)}</div>
        <div class="side-meta"><span class="pill ${state.q.status}">${STATUS[state.q.status]}</span><a href="#/q/${id}/team" class="${sectionKey === 'team' ? 'on' : ''}">Team & status</a></div>
        ${myRoles().length ? `<div class="side-roles">Showing questions for <b>${esc(roleLabels(myRoles()))}</b></div>` : ''}
        ${myRoles().length && canSeeAll() ? `<div class="seg" role="group" aria-label="Sections to show">
          <button type="button" data-show="0" aria-pressed="${!getShowAll()}">My sections</button><button type="button" data-show="1" aria-pressed="${getShowAll()}">All sections</button></div>` : ''}
      </div>
      ${nav}
    </nav>
    <button class="side-toggle" id="sideToggle" aria-controls="side" aria-expanded="false">Sections</button>
    <main class="main" id="main"></main>
    <aside class="rail" id="rail" aria-label="NOI opportunity ledger"></aside>
  </div>`;
  wireTopbar();
  $$('[data-show]').forEach((b) => { b.onclick = () => { setShowAll(b.dataset.show === '1'); renderWorkbook(id, sectionKey); }; });
  $('#sideToggle').onclick = () => { const s = $('#side'); const open = s.classList.toggle('open'); $('#sideToggle').setAttribute('aria-expanded', open); };

  if (sectionKey === 'team') renderTeam();
  else if (SECTION_MAP[sectionKey]) renderSection(SECTION_MAP[sectionKey]);
  else return go(`#/q/${id}/${SECTIONS[0].key}`);
  renderRail();
  $('.nav-item.on')?.scrollIntoView({ block: 'nearest' });
}

function renderRail() {
  const rail = $('#rail'); if (!rail) return;
  const items = ledger(state.data);
  const total = items.reduce((a, l) => a + (l.value || 0), 0);
  const g = gla(state.data);
  rail.innerHTML = `
    <div class="tape live">
      <div class="tape-title">NOI opportunity identified</div>
      <div class="tape-big" id="tapeTotal">${fmt.currency(total || 0)}</div>
      <div class="tape-sub">${g && total ? fmt.currency2(total / g) + ' / SF' : 'Updates as your team fills in the workbook'}</div>
      ${items.map((l) => `<a class="tape-row" href="#/q/${state.q.id}/${l.section}"><span>${esc(l.label)}</span><b>${l.value === null ? '—' : fmt.currency(l.value)}</b></a>`).join('')}
    </div>
    <p class="rail-note">Totals come from the calculation tables. Confirm final figures in the <a href="#/q/${state.q.id}/gm_priority">NOI register</a>.</p>`;
}

function sectionNavButtons(section) {
  const list = visibleSections();
  const i = list.indexOf(section);
  const prev = i > 0 ? list[i - 1] : null; const next = i === -1 ? list[0] : list[i + 1];
  return `<div class="sec-nav">
    ${prev ? `<a class="btn ghost" href="#/q/${state.q.id}/${prev.key}">Back: ${esc(prev.title)}</a>` : '<span></span>'}
    ${next ? `<a class="btn" href="#/q/${state.q.id}/${next.key}">Next: ${esc(next.title)}</a>` : `<a class="btn primary" href="#/q/${state.q.id}/team">Review & submit</a>`}
  </div>`;
}

function savedLine(key) {
  const r = state.rows[key];
  if (!r || !r.updated_at) return 'Not started';
  return `Saved ${timeAgo(r.updated_at)}${r.updated_by_email ? ' by ' + esc(r.updated_by_email) : ''}`;
}

function renderSection(section) {
  state.section = section.key;
  state.calcs = [];
  const data = state.data[section.key] || (state.data[section.key] = {});
  const ctx = ctxFor();
  const roleRO = canEdit() && !canEditSection(section);
  const ro = locked() || roleRO;
  const main = $('#main');
  const banner = !canEdit() ? '<div class="banner">You have view-only access to this workbook.</div>'
    : roleRO ? `<div class="banner">This section is answered by <b>${esc(section.owner)}</b>. You can read it, but only they (or the workbook owner) can change it. <a href="#/account">Change your role</a></div>`
    : state.q.status !== 'in_progress' ? `<div class="banner">This workbook was ${STATUS[state.q.status].toLowerCase()}, so answers are locked. ${isOwner() ? `<a href="#/q/${state.q.id}/team">Reopen it</a> to make changes.` : 'Ask the owner to reopen it to make changes.'}</div>` : '';

  main.innerHTML = `
    <div class="sec-head">
      <div class="sec-owner">Answered by: <b>${esc(section.owner)}</b></div>
      <h1>${esc(section.title)}</h1>
      <div class="save-state" id="saveState" aria-live="polite">${savedLine(section.key)}</div>
    </div>
    ${banner}
    <form class="form ${ro ? 'ro' : ''}" id="form" autocomplete="off" onsubmit="return false">
      ${section.fields.map((f) => renderField(f, data, ctx, ro)).join('')}
    </form>
    ${sectionNavButtons(section)}`;
  if (ro) $$('#form input, #form textarea, #form select, #form button').forEach((el) => { el.disabled = true; });
  wireForm(section);
  updateCalcs();
  hydratePhotos();
  main.focus({ preventScroll: true });
  window.scrollTo(0, 0);
}

// ------------------------------------------------------------ field render
let uid = 0;
const nid = () => 'f' + (++uid);

function labelBlock(f, forId) {
  return `${f.label ? `<label class="q" ${forId ? `for="${forId}"` : ''}>${esc(f.label)}</label>` : ''}${f.help ? `<p class="help">${esc(f.help)}</p>` : ''}`;
}
const width = (f) => (f.half ? 'half' : f.third ? 'third' : 'full');

function inputFor(type, path, value, extra = {}) {
  const id = extra.id || nid();
  const ph = extra.placeholder ? ` placeholder="${esc(extra.placeholder)}"` : '';
  const aria = extra.aria ? ` aria-label="${esc(extra.aria)}"` : '';
  const v = esc(value ?? '');
  switch (type) {
    case 'textarea': return `<textarea id="${id}" data-path="${path}" rows="${extra.rows || 3}"${ph}${aria}>${v}</textarea>`;
    case 'currency': return `<span class="adorn pre" data-a="$"><input id="${id}" data-path="${path}" data-num inputmode="decimal" value="${v}"${ph}${aria}></span>`;
    case 'percent': return `<span class="adorn post" data-a="%"><input id="${id}" data-path="${path}" data-num inputmode="decimal" value="${v}"${ph}${aria}></span>`;
    case 'number': return extra.unit ? `<span class="adorn post" data-a="${esc(extra.unit)}"><input id="${id}" data-path="${path}" data-num inputmode="decimal" value="${v}"${ph}${aria}></span>`
      : `<input id="${id}" data-path="${path}" data-num inputmode="decimal" value="${v}"${ph}${aria}>`;
    case 'date': return `<input id="${id}" type="date" data-path="${path}" value="${v}"${aria}>`;
    case 'select':
    case 'score': {
      const opts = type === 'score' ? ['1', '2', '3', '4', '5'] : extra.options;
      return `<select id="${id}" data-path="${path}"${aria} class="${type === 'score' ? 'score' : ''}"><option value="">${type === 'score' ? '–' : 'Select…'}</option>${opts.map((o) => `<option ${String(value) === o ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
    }
    default: return `<input id="${id}" data-path="${path}" value="${v}"${ph}${aria}>`;
  }
}

function calcSlot(fn, format, cls = '') {
  const id = nid();
  state.calcs.push({ id, fn, format });
  return `<output id="${id}" class="calc ${cls}">—</output>`;
}

function renderField(f, data, ctx, ro) {
  switch (f.type) {
    case 'info': return `<div class="info full">${f.html}</div>`;
    case 'heading': return `<div class="subhead full"><h2>${esc(f.text)}</h2>${f.sub ? `<p class="help">${esc(f.sub)}</p>` : ''}</div>`;
    case 'calc': return `<div class="field calc-field ${f.big ? 'big' : ''} ${width(f)}"><div class="q">${esc(f.label)}</div>${calcSlot(() => f.compute(ctxFor()), f.format)}${f.help ? `<p class="help">${esc(f.help)}</p>` : ''}</div>`;
    case 'text': case 'textarea': case 'number': case 'currency': case 'percent': case 'date': case 'select': {
      const id = nid();
      let ph = f.placeholder;
      if (f.suggest !== undefined) ph = topInitiatives()[f.suggest] || '';
      return `<div class="field ${width(f)}">${labelBlock(f, id)}${inputFor(f.type, f.id, data[f.id], { id, unit: f.unit, options: f.options, rows: f.rows, placeholder: ph })}</div>`;
    }
    case 'radio': case 'yesno': {
      const opts = f.type === 'yesno' ? ['Yes', 'Partially', 'No', 'Unsure'] : f.options;
      const name = nid();
      return `<fieldset class="field ${width(f)}"><legend class="q">${esc(f.label)}</legend>${f.help ? `<p class="help">${esc(f.help)}</p>` : ''}
        <div class="pills">${opts.map((o) => `<label class="pill-opt"><input type="radio" name="${name}" data-path="${f.id}" data-radio value="${esc(o)}" ${data[f.id] === o ? 'checked' : ''}><span>${esc(o)}</span></label>`).join('')}</div></fieldset>`;
    }
    case 'checks': {
      const vals = Array.isArray(data[f.id]) ? data[f.id] : [];
      return `<fieldset class="field ${width(f)}"><legend class="q">${esc(f.label)}</legend>${f.help ? `<p class="help">${esc(f.help)}</p>` : ''}
        <div class="chips">${f.options.map((o) => `<label class="chip"><input type="checkbox" data-path="${f.id}" data-check value="${esc(o)}" ${vals.includes(o) ? 'checked' : ''}><span>${esc(o)}</span></label>`).join('')}</div>
        ${f.other ? `<div class="other">${inputFor('text', f.id + '_other', data[f.id + '_other'], { placeholder: 'Other (describe)', aria: f.label + ' — other' })}</div>` : ''}</fieldset>`;
    }
    case 'slider': {
      const v = data[f.id] ?? '';
      return `<div class="field ${width(f)}">${labelBlock(f)}<div class="slider"><input type="range" min="${f.min}" max="${f.max}" step="5" data-path="${f.id}" data-num value="${esc(v === '' ? 0 : v)}" aria-label="${esc(f.label)}" ${v === '' ? 'data-unset' : ''}><output class="slider-val">${v === '' ? 'Not set' : esc(v)}</output></div></div>`;
    }
    case 'rank': {
      const order = Array.isArray(data[f.id]) && data[f.id].length ? data[f.id] : f.items;
      return `<div class="field full">${labelBlock(f)}<ol class="rank" data-rank="${f.id}">${order.map((it, i) => `
        <li><span class="rank-n">${i + 1}</span><span class="rank-t">${esc(it)}</span>
        <button type="button" class="icon" data-move="-1" data-i="${i}" aria-label="Move ${esc(it)} up" ${i === 0 ? 'disabled' : ''}>↑</button>
        <button type="button" class="icon" data-move="1" data-i="${i}" aria-label="Move ${esc(it)} down" ${i === order.length - 1 ? 'disabled' : ''}>↓</button></li>`).join('')}</ol></div>`;
    }
    case 'photos': {
      const paths = Array.isArray(data[f.id]) ? data[f.id] : [];
      return `<div class="field full">${labelBlock(f)}<div class="photos" data-photos="${f.id}" data-max="${f.max}">
        ${paths.map((p) => `<figure class="ph" data-src="${esc(p)}"><img alt="" loading="lazy"><button type="button" class="icon del" data-delphoto="${esc(p)}" aria-label="Remove photo">×</button></figure>`).join('')}
        ${paths.length < f.max && !ro ? `<label class="ph add"><input type="file" accept="image/*" multiple data-upload="${f.id}"><span>Add photo${f.max - paths.length > 1 ? 's' : ''}</span><small>${paths.length} of ${f.max}</small></label>` : ''}
      </div></div>`;
    }
    case 'table': return renderTable(f, data, ctx);
    case 'revenue': return renderRevenue(f, data);
    case 'deploy': return renderDeploy(f, data);
    default: return '';
  }
}

function cellInput(col, path, value, row, ctx, rowLabel) {
  const type = (row && row.cellType && col.type !== 'calc' && col.type !== 'select' && col.type !== 'score') ? row.cellType : col.type;
  const aria = `${rowLabel ? rowLabel + ' — ' : ''}${col.label}`;
  if (col.type === 'static') return `<span class="static">${esc(row.static ? row.static[col.key] : '')}</span>`;
  const ph = col.placeholder ? col.placeholder(row || {}, ctx) : null;
  const phStr = ph === null || ph === undefined ? '' : (typeof ph === 'number' ? Math.round(ph).toLocaleString('en-CA') : ph);
  return inputFor(type, path, value, { options: col.options, aria, placeholder: phStr, rows: 2 });
}

function renderTable(f, data, ctx) {
  const t = data[f.id] || {};
  const cols = f.columns;
  const head = `<tr>${f.rows || f.dynamic ? (f.rows ? '<th class="rowh"></th>' : '') : ''}${cols.map((c) => `<th class="c-${c.type} ${c.accent ? 'accent' : ''} ${c.wide ? 'wide' : ''} ${['currency', 'number', 'percent', 'calc', 'score'].includes(c.type) ? 'numc' : ''}">${esc(c.label)}</th>`).join('')}${f.dynamic ? '<th class="act"></th>' : ''}</tr>`;
  let body = '';

  if (f.rows) {
    body = f.rows.map((r) => {
      if (r.heading) return `<tr class="hrow"><th colspan="${cols.length + 1}">${esc(r.label)}</th></tr>`;
      const rowData = t[r.key] || {};
      if (r.calcRow) {
        return `<tr class="trow"><th class="rowh">${esc(r.label)}</th>${cols.map((c) => (['currency', 'number'].includes(c.type)
          ? `<td class="numc">${calcSlot(() => { const tt = state.data[state.section][f.id] || {}; const vs = r.calcRow.map((k) => num((tt[k] || {})[c.key])); return vs.some((v) => v !== null) ? vs.reduce((a, b) => a + (b || 0), 0) : null; }, c.type === 'currency' ? 'currency' : 'int')}</td>` : '<td></td>')).join('')}</tr>`;
      }
      const label = r.editableLabel
        ? `<th class="rowh">${inputFor('text', `${f.id}.${r.key}.label`, rowData.label, { placeholder: r.label, aria: 'Opportunity name' })}</th>`
        : `<th class="rowh ${r.bold ? 'b' : ''} ${r.sub ? 'subrow' : ''}">${esc(r.label)}</th>`;
      return `<tr class="${r.bold ? 'brow' : ''}">${label}${cols.map((c) => {
        if (c.type === 'calc') {
          if (r.noCalc) return '<td></td>';
          return `<td class="numc">${calcSlot(() => c.compute((state.data[state.section][f.id] || {})[r.key] || {}, ctxFor()), c.format, c.format)}</td>`;
        }
        const val = rowData[c.key] ?? (r.defaults ? r.defaults[c.key] : undefined);
        return `<td class="${c.accent ? 'accent' : ''}">${cellInput(c, `${f.id}.${r.key}.${c.key}`, val, r, ctx, r.label)}</td>`;
      }).join('')}</tr>`;
    }).join('');
  } else if (f.dynamic) {
    const arr = Array.isArray(t) ? t : [];
    const n = Math.max(arr.length, f.dynamic.min);
    for (let i = 0; i < n; i++) {
      const rowData = arr[i] || {};
      const seed = f.dynamic.seed ? f.dynamic.seed[i] : undefined;
      body += `<tr data-row="${i}">${cols.map((c) => {
        if (c.type === 'calc') return `<td class="numc">${calcSlot(() => c.compute(((state.data[state.section][f.id]) || [])[i] || {}, ctxFor()), c.format, c.format)}</td>`;
        const val = rowData[c.key] ?? (c.key === 'name' && seed ? seed : undefined);
        return `<td>${cellInput(c, `${f.id}.${i}.${c.key}`, val, { seed }, ctx, `Row ${i + 1}`)}${seed && c.key === 'name' ? `<input type="hidden" data-seed="${f.id}.${i}.name" value="${esc(seed)}">` : ''}</td>`;
      }).join('')}<td class="act">${i >= f.dynamic.min || arr.length > f.dynamic.min ? `<button type="button" class="icon" data-delrow="${f.id}" data-i="${i}" aria-label="Remove row ${i + 1}">×</button>` : ''}</td></tr>`;
    }
  }

  let foot = '';
  if (f.footer) {
    foot = `<tfoot><tr>${f.rows ? `<th class="rowh">${esc(f.footer)}</th>` : ''}${cols.map((c, ci) => {
      if (!c.total) return !f.rows && ci === 0 ? `<th class="rowh">${esc(f.footer)}</th>` : '<td></td>';
      return `<td class="numc">${calcSlot(() => {
        const tt = state.data[state.section][f.id];
        const rows = f.rows ? f.rows.filter((r) => !r.heading && !r.calcRow).map((r) => ({ r, d: (tt || {})[r.key] || {} })) : (Array.isArray(tt) ? tt : []).map((d) => ({ d: d || {} }));
        const vs = rows.map(({ d }) => (c.type === 'calc' ? c.compute(d, ctxFor()) : num(d[c.key])));
        return vs.some((v) => v !== null && v !== undefined) ? vs.reduce((a, b) => a + (b || 0), 0) : null;
      }, c.format || 'currency')}</td>`;
    }).join('')}${f.dynamic ? '<td></td>' : ''}</tr></tfoot>`;
  }

  const addBtn = f.dynamic ? `<button type="button" class="btn ghost small add-row" data-addrow="${f.id}" data-max="${f.dynamic.max}">${esc(f.dynamic.addLabel)}</button>` : '';
  return `<div class="field full table-field">${f.label ? `<div class="q">${esc(f.label)}</div>` : ''}${f.help ? `<p class="help">${esc(f.help)}</p>` : ''}
    <div class="tbl-wrap ${f.scroll ? 'scroll' : ''}"><table class="tbl ${f.readonly ? 'readonly' : ''}"><thead>${head}</thead><tbody>${body}</tbody>${foot}</table></div>${addBtn}</div>`;
}

function renderRevenue(f, data) {
  const g = data[f.id] || {};
  const p = (k) => `${f.id}.${k}`;
  const sel = (key, opts) => `<div class="pills">${opts.map((o) => `<label class="pill-opt"><input type="radio" name="${f.id}-${key}" data-path="${p(key)}" data-radio value="${o}" ${g[key] === o ? 'checked' : ''}><span>${o}</span></label>`).join('')}</div>`;
  const cur = () => state.data[state.section][f.id] || {};
  return `
  <details class="rev full ${g.na ? 'na' : ''}" ${g.na ? '' : 'open'} data-rev="${f.id}">
    <summary><span class="rev-title">${esc(f.title)}</span><span class="rev-e">${calcSlot(() => revenueNOI(cur()), 'currency')}</span></summary>
    <div class="rev-body">
      <label class="na-toggle"><input type="checkbox" data-path="${p('na')}" data-bool ${g.na ? 'checked' : ''}> Not applicable at this asset</label>
      <div class="rev-grid">
        <p class="basis"><b>Revenue basis:</b> ${esc(f.revBasis)}</p>
        <label>A. Potential annual gross revenue ${inputFor('currency', p('A'), g.A)}</label>
        <label>B. Less: current annual revenue ${inputFor('currency', p('B'), g.B)}</label>
        <div class="calc-line">C. Incremental gross revenue (A − B) ${calcSlot(() => { const x = cur(); return num(x.A) !== null || num(x.B) !== null ? (num(x.A) || 0) - (num(x.B) || 0) : null; }, 'currency')}</div>
        <p class="basis"><b>Cost basis:</b> ${esc(f.costBasis)}</p>
        <label>D. Incremental annual costs ${inputFor('currency', p('D'), g.D)}</label>
        <div class="calc-line strong">E. Annual NOI opportunity (C − D) ${calcSlot(() => revenueNOI(cur()), 'currency')}</div>
        <label>F. One-time implementation / capital cost ${inputFor('currency', p('F'), g.F)}</label>
        <div class="calc-line">G. NOI opportunity / SF ${calcSlot(() => { const e = revenueNOI(cur()); const gl = gla(state.data); return e !== null && gl ? e / gl : null; }, 'currency2')}</div>
        <div class="calc-line">Payback ${calcSlot(() => { const e = revenueNOI(cur()); const fv = num(cur().F); return e && fv ? fv / e : null; }, 'years')}</div>
      </div>
      <div class="rev-row"><span class="q small">Estimated time to implement</span>${sel('time', ['<3 mo', '3–6 mo', '6–12 mo', '>12 mo'])}</div>
      <div class="rev-row"><span class="q small">Confidence in estimate</span>${sel('conf', ['High', 'Medium', 'Low'])}</div>
      <label class="rev-basis">Basis / supporting information ${inputFor('textarea', p('basis'), g.basis, { rows: 2, placeholder: 'Market comparable, vendor quote, historical experience…' })}</label>
    </div>
  </details>`;
}

function renderDeploy(f, data) {
  const v = data[f.id] || {};
  const label = { yes: 'Deployed', no: 'Not deployed' };
  return `<div class="field full"><div class="deploy-legend"><span class="dot yes"></span>Deployed <span class="dot no"></span>Not deployed <span class="dot"></span>Not answered — tap an item to cycle</div>
    ${f.pillars.map((pl) => `
    <section class="pillar"><header><h3>${esc(pl.name)}</h3><p class="muted small">${esc(pl.sub)}</p></header>
      <div class="tiers">${pl.tiers.map(([tier, items], ti) => `
        <div class="tier"><div class="tier-name">${esc(tier)}</div>
        ${items.length ? items.map((it, ii) => { const k = `${ti}-${ii}`; const s = (v[pl.key] || {})[k] || ''; return `<button type="button" class="dep ${s}" data-dep="${f.id}.${pl.key}.${k}" aria-label="${esc(it)}: ${label[s] || 'not answered'}">${esc(it)}</button>`; }).join('') : '<p class="muted small">Not recommended without oversight</p>'}
        </div>`).join('')}</div>
    </section>`).join('')}</div>`;
}

function topInitiatives() {
  const m = ((state.data.gm_priority || {}).matrix) || [];
  return m.filter((r) => r && r.name).map((r) => ({ name: r.name, s: weightedScore(r) ?? -1, noi: num(r.noi) || 0 }))
    .sort((a, b) => b.s - a.s || b.noi - a.noi).map((r) => r.name);
}

// ------------------------------------------------------------ interaction
function updateCalcs() {
  state.calcs.forEach((c) => {
    const el = document.getElementById(c.id); if (!el) return;
    let v; try { v = c.fn(); } catch { v = null; }
    el.textContent = (fmt[c.format] || String)(v);
    el.dataset.v = v === null || v === undefined ? '' : String(v);
    if (c.format === 'flag') el.className = 'calc flag ' + (v ? v.toLowerCase() : '');
    if (c.format === 'band') el.className = 'calc band ' + (v ? v.slice(0, 2).toLowerCase() : '');
  });
  renderRailNumbers();
}
function renderRailNumbers() {
  const rail = $('#rail'); if (!rail) return;
  const items = ledger(state.data);
  const rows = $$('.tape-row b', rail);
  items.forEach((l, i) => { if (rows[i]) rows[i].textContent = l.value === null ? '—' : fmt.currency(l.value); });
  const total = items.reduce((a, l) => a + (l.value || 0), 0);
  const t = $('#tapeTotal'); if (t) t.textContent = fmt.currency(total || 0);
  const g = gla(state.data); const sub = $('.tape-sub', rail);
  if (sub) sub.textContent = g && total ? fmt.currency2(total / g) + ' / SF' : 'Updates as your team fills in the workbook';
}
function updateNavRing() {
  const s = SECTION_MAP[state.section]; const el = $(`.nav-item[data-key="${state.section}"] .ring`);
  if (!s || !el) return;
  const p = sectionProgress(s, state.data[s.key]);
  if (p !== null) el.style.setProperty('--p', Math.round(p * 100));
}

function change(path, value) {
  const d = state.data[state.section] || (state.data[state.section] = {});
  setPath(d, path, value);
  // seed default names for dynamic rows the first time a row is edited
  const m = path.match(/^([^.]+)\.(\d+)\./);
  if (m) { const seedEl = $(`[data-seed="${m[1]}.${m[2]}.name"]`); const row = d[m[1]][m[2]]; if (seedEl && row && row.name === undefined) row.name = seedEl.value; }
  updateCalcs(); updateNavRing(); scheduleSave(state.section);
}

function wireForm(section) {
  const form = $('#form');
  form.addEventListener('input', (e) => {
    const el = e.target; const path = el.dataset.path; if (!path) return;
    if (el.dataset.check !== undefined) {
      const vals = $$(`input[data-check][data-path="${path}"]`, form).filter((x) => x.checked).map((x) => x.value);
      return change(path, vals);
    }
    if (el.dataset.bool !== undefined) {
      change(path, el.checked);
      const det = el.closest('details.rev'); if (det) det.classList.toggle('na', el.checked);
      return;
    }
    if (el.dataset.radio !== undefined) return change(path, el.value);
    if (el.type === 'range') { el.removeAttribute('data-unset'); el.nextElementSibling.textContent = el.value; return change(path, el.value); }
    change(path, el.value);
  });
  // let a selected pill be cleared by clicking it again
  form.addEventListener('click', (e) => {
    const inp = e.target.closest('label.pill-opt')?.querySelector('input');
    if (inp && inp.checked && e.target.tagName !== 'INPUT') { e.preventDefault(); inp.checked = false; change(inp.dataset.path, ''); }
  });
  form.addEventListener('focusout', (e) => {
    const el = e.target;
    if (el.dataset && el.dataset.num !== undefined && el.type !== 'range' && el.value.trim()) {
      const n = num(el.value);
      if (n !== null) { const f = n.toLocaleString('en-CA', { maximumFractionDigits: 4 }); if (f !== el.value) { el.value = f; change(el.dataset.path, f); } }
    }
  });
  form.addEventListener('click', async (e) => {
    const b = e.target.closest('button'); if (!b || locked() || !canEditSection(section)) return;
    const d = state.data[state.section];
    if (b.dataset.addrow) {
      const f = section.fields.find((x) => x.id === b.dataset.addrow);
      const arr = Array.isArray(d[f.id]) ? d[f.id] : [];
      const n = Math.max(arr.length, f.dynamic.min);
      if (n >= f.dynamic.max) return toast(`Up to ${f.dynamic.max} rows.`);
      while (arr.length < n + 1) arr.push({});
      d[f.id] = arr; scheduleSave(state.section); rerender();
    } else if (b.dataset.delrow) {
      const arr = Array.isArray(d[b.dataset.delrow]) ? d[b.dataset.delrow] : [];
      arr.splice(Number(b.dataset.i), 1); d[b.dataset.delrow] = arr; scheduleSave(state.section); rerender();
    } else if (b.dataset.move) {
      const ol = b.closest('[data-rank]'); const f = section.fields.find((x) => x.id === ol.dataset.rank);
      const order = Array.isArray(d[f.id]) && d[f.id].length ? [...d[f.id]] : [...f.items];
      const i = Number(b.dataset.i); const j = i + Number(b.dataset.move);
      [order[i], order[j]] = [order[j], order[i]]; d[f.id] = order; scheduleSave(state.section); rerender(`[data-rank="${f.id}"] [data-i="${j}"][data-move="${b.dataset.move}"]`);
    } else if (b.dataset.dep) {
      const cur = getPath(d, b.dataset.dep) || '';
      const next = cur === '' ? 'yes' : cur === 'yes' ? 'no' : '';
      setPath(d, b.dataset.dep, next); b.className = 'dep ' + next;
      b.setAttribute('aria-label', b.textContent + ': ' + ({ yes: 'Deployed', no: 'Not deployed' }[next] || 'not answered'));
      updateNavRing(); scheduleSave(state.section);
    } else if (b.dataset.delphoto) {
      const path = b.dataset.delphoto; const fid = b.closest('[data-photos]').dataset.photos;
      d[fid] = (d[fid] || []).filter((p) => p !== path); await saveNow(state.section);
      api.deletePhoto(path).catch(() => {}); rerender();
    }
  });
  form.addEventListener('change', async (e) => {
    const el = e.target; if (!el.dataset.upload) return;
    const fid = el.dataset.upload; const box = el.closest('[data-photos]'); const max = Number(box.dataset.max);
    const d = state.data[state.section]; const cur = Array.isArray(d[fid]) ? d[fid] : [];
    const files = [...el.files].slice(0, max - cur.length);
    if (!files.length) return;
    box.classList.add('busy');
    try {
      for (const file of files) {
        if (file.size > 10 * 1024 * 1024) { toast(`${file.name} is over 10 MB — choose a smaller image.`, 'bad'); continue; }
        cur.push(await api.uploadPhoto(state.q.id, file));
      }
      d[fid] = cur; await saveNow(state.section); rerender();
    } catch (ex) { toast('Upload failed: ' + errMsg(ex), 'bad'); box.classList.remove('busy'); }
  });
  $$('[data-goto]').forEach((a) => { a.onclick = (e) => { e.preventDefault(); go(`#/q/${state.q.id}/${a.dataset.goto}`); }; });
}

function rerender(focusSel) {
  const y = window.scrollY;
  renderSection(SECTION_MAP[state.section]);
  window.scrollTo(0, y);
  if (focusSel) { const el = $(focusSel) || $(focusSel.replace(/\[data-move="[^"]+"\]/, '')); el && el.focus(); }
}

async function hydratePhotos() {
  for (const fig of $$('figure.ph[data-src]')) {
    const url = await api.photoUrl(fig.dataset.src).catch(() => '');
    const img = $('img', fig); if (url) img.src = url; else fig.classList.add('missing');
  }
}

// ----------------------------------------------------------------- saving
function setSaveState(text, cls = '') {
  const el = $('#saveState'); if (el) { el.textContent = text; el.className = 'save-state ' + cls; }
}
function scheduleSave(key) {
  if (locked() || (SECTION_MAP[key] && !canEditSection(SECTION_MAP[key]))) return;
  state.pending.add(key);
  setSaveState('Saving…', 'saving');
  clearTimeout(state.timers[key]);
  state.timers[key] = setTimeout(() => saveNow(key), 700);
}
function saveNow(key) {
  const job = persistSection(key);
  state.saving.add(job);
  return job.finally(() => state.saving.delete(job));
}
async function persistSection(key) {
  clearTimeout(state.timers[key]);
  if (!state.q) return;
  state.pending.delete(key);
  try {
    const row = await api.saveResponse(state.q.id, key, state.data[key] || {});
    state.rows[key] = { ...(state.rows[key] || {}), ...row, data: state.data[key] };
    if (state.section === key) setSaveState(savedLine(key), 'ok');
  } catch (e) {
    state.pending.add(key);
    if (state.section === key) setSaveState('Not saved — ' + errMsg(e) + '. Retrying…', 'bad');
    state.timers[key] = setTimeout(() => saveNow(key), 4000);
  }
}
// Waits for saves already on the wire too. Whatever failed is left in state.pending.
async function flushAll() {
  state.pending.forEach((k) => saveNow(k));
  await Promise.all(state.saving);
}

// -------------------------------------------------------------- team view
async function renderTeam() {
  state.section = 'team'; state.calcs = [];
  const main = $('#main');
  state.members = await api.listMembers(state.q.id).catch(() => state.members);
  const people = await api.teamProfiles(state.q.id).catch(() => []);
  const byEmail = Object.fromEntries(people.map((x) => [x.email, x]));
  const coverers = (sec) => people.filter((x) => sectionForRoles(sec, x.job_roles || []));
  const personName = (x) => esc(x.full_name || x.email.split('@')[0]);
  const owner = isOwner();
  const progress = SECTIONS.filter((s) => !s.noProgress).map((s) => ({ s, p: sectionProgress(s, state.data[s.key]) || 0, r: state.rows[s.key] }));
  const overall = progress.reduce((a, x) => a + x.p, 0) / progress.length;

  main.innerHTML = `
    <div class="sec-head"><div class="sec-owner">Workbook settings</div><h1>Team & status</h1></div>

    <section class="panel">
      <h2>Status</h2>
      <p>This workbook is <span class="pill ${state.q.status}">${STATUS[state.q.status]}</span>. ${Math.round(overall * 100)}% of questions have an answer.</p>
      <div class="row-btns">
        ${state.q.status === 'in_progress' && canEdit() ? '<button class="btn primary" data-status="submitted">Submit for review</button>' : ''}
        ${state.q.status === 'submitted' && profile.is_admin ? '<button class="btn primary" data-status="reviewed">Mark as reviewed</button>' : ''}
        ${state.q.status !== 'in_progress' && owner ? '<button class="btn" data-status="in_progress">Reopen for editing</button>' : ''}
        <button class="btn ghost" id="exportCsv">Download answers (CSV)</button>
        <button class="btn ghost" id="exportJson">Download answers (JSON)</button>
      </div>
      <table class="tbl progress-tbl"><thead><tr><th>Section</th><th>Answered by</th><th>Who on this team</th><th class="numc">Progress</th><th>Last saved</th></tr></thead><tbody>
      ${progress.map(({ s, p, r }) => { const c = s.owner === 'Everyone' ? null : coverers(s); return `<tr><th class="rowh"><a href="#/q/${state.q.id}/${s.key}">${esc(s.title)}</a></th><td class="small">${esc(s.owner)}</td>
        <td class="small">${c === null ? '<span class="muted">Everyone</span>' : c.length ? c.map(personName).join(', ') : '<span class="gap">No one yet</span>'}</td><td class="numc"><span class="bar small"><i style="width:${Math.round(p * 100)}%"></i></span> ${Math.round(p * 100)}%</td><td class="muted small">${r && r.updated_at ? timeAgo(r.updated_at) + (r.updated_by_email ? ' · ' + esc(r.updated_by_email) : '') : '—'}</td></tr>`; }).join('')}
      </tbody></table>
    </section>

    <section class="panel">
      <h2>People with access</h2>
      <p class="muted">Add the site team by email. They'll see this workbook as soon as they sign in with that email (or create an account with it), and they'll only see the sections for the role they choose.</p>
      <ul class="members">${state.members.map((m) => `
        <li><span class="avatar sm">${esc(m.email[0].toUpperCase())}</span><span class="m-email"><span class="m-name">${byEmail[m.email] && byEmail[m.email].full_name ? esc(byEmail[m.email].full_name) + ' · ' : ''}${esc(m.email)}</span>
          <span class="m-roles">${!byEmail[m.email] || !byEmail[m.email].signed_up ? 'Hasn\'t signed up yet' : (byEmail[m.email].job_roles || []).length ? esc(roleLabels(byEmail[m.email].job_roles)) : 'No role chosen yet'}</span></span>
        ${owner ? `<select data-role="${esc(m.email)}" aria-label="Role for ${esc(m.email)}">${['owner', 'editor', 'viewer'].map((r) => `<option ${m.role === r ? 'selected' : ''} value="${r}">${r[0].toUpperCase() + r.slice(1)}</option>`).join('')}</select>
        <button class="icon" data-remove="${esc(m.email)}" aria-label="Remove ${esc(m.email)}">×</button>` : `<span class="pill">${esc(m.role)}</span>`}</li>`).join('')}</ul>
      ${owner ? `<form id="addMember" class="add-member">
        <input name="email" type="email" placeholder="name@company.com" aria-label="Email to add" required>
        <select name="role" aria-label="Role"><option value="editor">Editor — answers their role's sections</option><option value="viewer">Viewer — read only</option><option value="owner">Owner — all sections + manage team</option></select>
        <button class="btn primary" type="submit">Add person</button></form>` : ''}
      <p class="muted small">Editors answer the sections for their role. Owners can answer any section, add people, reopen and delete the workbook.</p>
    </section>

    <section class="panel">
      <h2>Property</h2>
      <form id="propForm" class="prop-form">
        <label class="fl">Property name<input name="property_name" value="${esc(state.q.property_name)}" ${canEdit() ? '' : 'disabled'}></label>
        <label class="fl">Address<input name="property_address" value="${esc(state.q.property_address || '')}" ${canEdit() ? '' : 'disabled'}></label>
        ${canEdit() ? '<button class="btn" type="submit">Save</button>' : ''}
      </form>
      ${owner ? '<div class="danger"><button class="btn danger-btn" id="del">Delete workbook</button><span class="muted small">Removes every answer and photo. This can\'t be undone.</span></div>' : ''}
    </section>`;

  $$('[data-status]').forEach((b) => { b.onclick = async () => {
    const status = b.dataset.status;
    if (status === 'submitted' && overall < 0.5 && !confirm(`Only ${Math.round(overall * 100)}% is answered. Submit anyway?`)) return;
    try {
      await flushAll();
      // Submitting locks the answers, so it needs every save to have landed. Reopening must not wait: it is how a blocked save gets through.
      if (status === 'submitted' && state.pending.size) {
        const names = [...state.pending].map((k) => SECTION_MAP[k]?.title || k).join(', ');
        return toast(`Not submitted because these answers didn't save: ${names}. Check your connection and try again.`, 'bad');
      }
      await api.updateQuestionnaire(state.q.id, { status, submitted_at: status === 'submitted' ? new Date().toISOString() : state.q.submitted_at || null });
      state.q.status = status; toast({ submitted: 'Submitted for review', reviewed: 'Marked as reviewed', in_progress: 'Reopened for editing' }[status]);
      renderWorkbook(state.q.id, 'team');
    } catch (e) { toast(errMsg(e), 'bad'); }
  }; });
  $$('[data-role]').forEach((s) => { s.onchange = async () => { try { await api.addMember(state.q.id, s.dataset.role, s.value); toast('Role updated'); } catch (e) { toast(errMsg(e), 'bad'); } }; });
  $$('[data-remove]').forEach((b) => { b.onclick = async () => {
    const email = b.dataset.remove;
    if (state.members.filter((m) => m.role === 'owner').length === 1 && state.members.find((m) => m.email === email)?.role === 'owner') return toast('Add another owner before removing the last one.', 'bad');
    if (!confirm(`Remove ${email} from this workbook?`)) return;
    try { await api.removeMember(state.q.id, email); toast('Removed ' + email); renderTeam(); } catch (e) { toast(errMsg(e), 'bad'); }
  }; });
  const add = $('#addMember');
  if (add) add.onsubmit = async (e) => {
    e.preventDefault(); const v = Object.fromEntries(new FormData(add));
    if (!/^\S+@\S+\.\S+$/.test(v.email)) return toast('Enter a valid email address.', 'bad');
    try { await api.addMember(state.q.id, v.email, v.role); toast('Added ' + v.email.toLowerCase()); renderTeam(); } catch (ex) { toast(errMsg(ex), 'bad'); }
  };
  $('#propForm').onsubmit = async (e) => {
    e.preventDefault(); const v = Object.fromEntries(new FormData(e.target));
    if (!v.property_name.trim()) return toast('Enter a property name.', 'bad');
    try { await api.updateQuestionnaire(state.q.id, v); Object.assign(state.q, v); toast('Property saved'); renderWorkbook(state.q.id, 'team'); } catch (ex) { toast(errMsg(ex), 'bad'); }
  };
  const del = $('#del');
  if (del) del.onclick = async () => {
    const name = prompt(`Type the property name to delete this workbook:\n${state.q.property_name}`);
    if (name !== state.q.property_name) return name !== null && toast('Name did not match — nothing was deleted.');
    try {
      const photos = Object.values(state.data).flatMap((d) => Object.values(d || {}).filter((v) => Array.isArray(v) && typeof v[0] === 'string' && v[0].startsWith(state.q.id + '/')).flat());
      await Promise.all(photos.map((p) => api.deletePhoto(p).catch(() => {})));
      await api.deleteQuestionnaire(state.q.id); state.q = null; toast('Workbook deleted'); go('#/');
    } catch (ex) { toast(errMsg(ex), 'bad'); }
  };
  $('#exportJson').onclick = () => download(`${slug(state.q.property_name)}-noi-workbook.json`, JSON.stringify({ property: state.q, answers: state.data }, null, 2), 'application/json');
  $('#exportCsv').onclick = () => download(`${slug(state.q.property_name)}-noi-workbook.csv`, toCsv(), 'text/csv');
  renderRail();
}

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
function download(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function toCsv() {
  const out = [['Section', 'Question', 'Value']];
  const walk = (section, prefix, v) => {
    if (v === null || v === undefined || v === '') return;
    if (Array.isArray(v) && v.every((x) => typeof x !== 'object')) { out.push([section, prefix, v.join('; ')]); return; }
    if (typeof v === 'object') { Object.entries(v).forEach(([k, x]) => walk(section, prefix ? `${prefix} › ${labelFor(section, prefix, k)}` : labelFor(section, '', k), x)); return; }
    out.push([section, prefix, String(v)]);
  };
  SECTIONS.forEach((s) => walk(s.title, '', state.data[s.key]));
  return out.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\r\n');
}
function labelFor(sectionTitle, prefix, key) {
  const s = SECTIONS.find((x) => x.title === sectionTitle);
  if (!s) return key;
  if (!prefix) { const f = s.fields.find((x) => x.id === key); return f ? (f.label || f.title || key) : key; }
  for (const f of s.fields) {
    if (f.rows) { const r = f.rows.find((x) => x.key === key); if (r) return r.label; }
    if (f.columns) { const c = f.columns.find((x) => x.key === key); if (c) return c.label; }
  }
  if (/^\d+$/.test(key)) return 'Row ' + (Number(key) + 1);
  return { A: 'Potential gross revenue (A)', B: 'Current revenue (B)', D: 'Incremental costs (D)', F: 'One-time cost (F)', na: 'Not applicable', time: 'Time to implement', conf: 'Confidence', basis: 'Basis' }[key] || key;
}

boot();
