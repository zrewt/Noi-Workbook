// Data layer. Uses Supabase when configured; otherwise a local demo store.

const cfg = window.NOI_CONFIG || {};
export const DEMO = !(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY);

const uuid = () => (crypto.randomUUID ? crypto.randomUUID()
  : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16); }));

// ---------------------------------------------------------------- Supabase
async function supabaseBackend() {
  const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
  const sb = createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
  const unwrap = ({ data, error }) => { if (error) throw error; return data; };
  const redirect = () => location.origin + location.pathname;

  return {
    demo: false,
    async session() { return unwrap(await sb.auth.getSession()).session; },
    onAuth(cb) { sb.auth.onAuthStateChange((event, session) => cb(event, session)); },
    async signIn(email, password) { return unwrap(await sb.auth.signInWithPassword({ email, password })); },
    async signUp(email, password, full_name, title, job_roles) {
      return unwrap(await sb.auth.signUp({ email, password, options: { data: { full_name, title, job_roles }, emailRedirectTo: redirect() } }));
    },
    async magicLink(email) { return unwrap(await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: redirect(), shouldCreateUser: false } })); },
    async resetPassword(email) { return unwrap(await sb.auth.resetPasswordForEmail(email, { redirectTo: redirect() + '#/reset' })); },
    async updatePassword(password) { return unwrap(await sb.auth.updateUser({ password })); },
    async signOut() { await sb.auth.signOut(); },
    async profile(userId) {
      const { data } = await sb.from('profiles').select('*').eq('id', userId).maybeSingle();
      return data;
    },
    async updateProfile(userId, patch) { return unwrap(await sb.from('profiles').update(patch).eq('id', userId)); },

    async listQuestionnaires() {
      const qs = unwrap(await sb.from('questionnaires').select('*').order('updated_at', { ascending: false }));
      if (!qs.length) return [];
      const ids = qs.map((q) => q.id);
      const [resp, members] = await Promise.all([
        sb.from('responses').select('questionnaire_id, section_key, data').in('questionnaire_id', ids).then(unwrap),
        sb.from('questionnaire_members').select('questionnaire_id, email, role').in('questionnaire_id', ids).then(unwrap),
      ]);
      return qs.map((q) => ({
        ...q,
        responses: Object.fromEntries(resp.filter((r) => r.questionnaire_id === q.id).map((r) => [r.section_key, r.data])),
        members: members.filter((m) => m.questionnaire_id === q.id),
      }));
    },
    async createQuestionnaire(property_name, property_address, userId) {
      const id = uuid();
      unwrap(await sb.from('questionnaires').insert({ id, property_name, property_address, created_by: userId }));
      return id;
    },
    async getQuestionnaire(id) { return unwrap(await sb.from('questionnaires').select('*').eq('id', id).maybeSingle()); },
    async updateQuestionnaire(id, patch) { return unwrap(await sb.from('questionnaires').update(patch).eq('id', id)); },
    async deleteQuestionnaire(id) { return unwrap(await sb.from('questionnaires').delete().eq('id', id)); },
    async getResponses(id) {
      const rows = unwrap(await sb.from('responses').select('*').eq('questionnaire_id', id));
      return Object.fromEntries(rows.map((r) => [r.section_key, r]));
    },
    async saveResponse(id, section_key, data) {
      return unwrap(await sb.from('responses').upsert({ questionnaire_id: id, section_key, data }, { onConflict: 'questionnaire_id,section_key' }).select('updated_at, updated_by_email').single());
    },
    async listMembers(id) { return unwrap(await sb.from('questionnaire_members').select('*').eq('questionnaire_id', id).order('created_at')); },
    async teamProfiles(id) { return unwrap(await sb.rpc('team_profiles', { q: id })); },
    async addMember(id, email, role) { return unwrap(await sb.from('questionnaire_members').upsert({ questionnaire_id: id, email: email.toLowerCase().trim(), role })); },
    async removeMember(id, email) { return unwrap(await sb.from('questionnaire_members').delete().eq('questionnaire_id', id).eq('email', email)); },
    async uploadPhoto(id, file) {
      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '');
      const path = `${id}/${uuid()}.${ext}`;
      unwrap(await sb.storage.from('site-photos').upload(path, file, { contentType: file.type, upsert: false }));
      return path;
    },
    async photoUrl(path) {
      const { data } = await sb.storage.from('site-photos').createSignedUrl(path, 3600);
      return data ? data.signedUrl : '';
    },
    async deletePhoto(path) { await sb.storage.from('site-photos').remove([path]); },
  };
}

// -------------------------------------------------------------------- Demo
function demoBackend() {
  const KEY = 'noi-demo-v1';
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };
  const db = Object.assign({ users: {}, session: null, questionnaires: {}, responses: {}, members: [], photos: {} }, load());
  const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch { /* storage full or blocked */ } };
  const listeners = [];
  const emit = (e) => listeners.forEach((cb) => cb(e, db.session));
  const me = () => (db.session ? db.session.user : null);
  const now = () => new Date().toISOString();

  return {
    demo: true,
    async session() { return db.session; },
    onAuth(cb) { listeners.push(cb); },
    async signIn(email, password) {
      const u = db.users[email.toLowerCase()];
      if (!u || u.password !== password) throw new Error('Invalid login credentials');
      db.session = { user: { id: u.id, email: u.email } }; persist(); emit('SIGNED_IN');
    },
    async signUp(email, password, full_name, title, job_roles) {
      email = email.toLowerCase();
      if (db.users[email]) throw new Error('User already registered');
      const id = uuid();
      db.users[email] = { id, email, password, full_name, title, job_roles: job_roles || [], is_admin: Object.keys(db.users).length === 0 };
      db.session = { user: { id, email } }; persist(); emit('SIGNED_IN');
      return { session: db.session };
    },
    async magicLink() { throw new Error('Email links are not available in demo mode.'); },
    async resetPassword() { throw new Error('Password reset emails are not available in demo mode.'); },
    async updatePassword(password) { const u = Object.values(db.users).find((x) => x.id === me().id); u.password = password; persist(); },
    async signOut() { db.session = null; persist(); emit('SIGNED_OUT'); },
    async profile(userId) {
      const u = Object.values(db.users).find((x) => x.id === userId);
      return u ? { id: u.id, email: u.email, full_name: u.full_name, title: u.title, job_roles: u.job_roles || [], is_admin: u.is_admin } : null;
    },
    async updateProfile(userId, patch) { const u = Object.values(db.users).find((x) => x.id === userId); Object.assign(u, patch); persist(); },
    _visible() {
      const u = me(); const prof = Object.values(db.users).find((x) => x.id === u.id);
      return Object.values(db.questionnaires).filter((q) => prof.is_admin || db.members.some((m) => m.questionnaire_id === q.id && m.email === u.email));
    },
    async listQuestionnaires() {
      return this._visible().sort((a, b) => b.updated_at.localeCompare(a.updated_at)).map((q) => ({
        ...q,
        responses: Object.fromEntries(Object.entries(db.responses[q.id] || {}).map(([k, r]) => [k, r.data])),
        members: db.members.filter((m) => m.questionnaire_id === q.id),
      }));
    },
    async createQuestionnaire(property_name, property_address, userId) {
      const id = uuid();
      db.questionnaires[id] = { id, property_name, property_address, status: 'in_progress', created_by: userId, created_at: now(), updated_at: now() };
      db.members.push({ questionnaire_id: id, email: me().email, role: 'owner', created_at: now() });
      persist(); return id;
    },
    async getQuestionnaire(id) { return this._visible().find((q) => q.id === id) || null; },
    async updateQuestionnaire(id, patch) { Object.assign(db.questionnaires[id], patch, { updated_at: now() }); persist(); },
    async deleteQuestionnaire(id) { delete db.questionnaires[id]; delete db.responses[id]; db.members = db.members.filter((m) => m.questionnaire_id !== id); persist(); },
    async getResponses(id) { return JSON.parse(JSON.stringify(db.responses[id] || {})); },
    async saveResponse(id, key, data) {
      db.responses[id] = db.responses[id] || {};
      const row = { questionnaire_id: id, section_key: key, data, updated_at: now(), updated_by_email: me().email };
      db.responses[id][key] = row; db.questionnaires[id].updated_at = now(); persist();
      return row;
    },
    async listMembers(id) { return db.members.filter((m) => m.questionnaire_id === id); },
    async teamProfiles(id) {
      return db.members.filter((m) => m.questionnaire_id === id).map((m) => {
        const u = db.users[m.email];
        return { email: m.email, full_name: u ? u.full_name : null, title: u ? u.title : null, job_roles: u ? (u.job_roles || []) : [], signed_up: !!u };
      });
    },
    async addMember(id, email, role) {
      email = email.toLowerCase().trim();
      const ex = db.members.find((m) => m.questionnaire_id === id && m.email === email);
      if (ex) ex.role = role; else db.members.push({ questionnaire_id: id, email, role, created_at: now() });
      persist();
    },
    async removeMember(id, email) { db.members = db.members.filter((m) => !(m.questionnaire_id === id && m.email === email)); persist(); },
    async uploadPhoto(id, file) {
      const dataUrl = await new Promise((res, rej) => {
        const img = new Image(); const url = URL.createObjectURL(file);
        img.onload = () => {
          const s = Math.min(1, 900 / Math.max(img.width, img.height));
          const c = document.createElement('canvas'); c.width = img.width * s; c.height = img.height * s;
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
          res(c.toDataURL('image/jpeg', 0.75));
        };
        img.onerror = rej; img.src = url;
      });
      const path = `${id}/${uuid()}.jpg`; db.photos[path] = dataUrl; persist(); return path;
    },
    async photoUrl(path) { return db.photos[path] || ''; },
    async deletePhoto(path) { delete db.photos[path]; persist(); },
  };
}

export async function createBackend() {
  return DEMO ? demoBackend() : supabaseBackend();
}
