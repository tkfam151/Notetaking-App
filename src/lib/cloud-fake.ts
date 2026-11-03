/**
 * In-browser stand-in for the Supabase backend, used ONLY by the automated tests
 * (build with VITE_CLOUD=fake). Data lives in localStorage so several tabs act like
 * several devices; the signed-in user is per tab (sessionStorage). It mirrors the
 * permission rules in supabase/schema.sql.
 */
import type { CloudApi, CloudDoc, CloudRole, CloudUser, LinkAccess, Share } from './cloud';

interface Row extends Omit<CloudDoc, 'role'> {
  owner: string;
}
interface DB {
  users: { id: string; email: string; password: string }[];
  docs: Row[];
  shares: { document_id: string; email: string; role: 'view' | 'edit' }[];
}

const KEY = 'inkwell-fake-cloud';
const load = (): DB => {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '') as DB;
  } catch {
    return { users: [], docs: [], shares: [] };
  }
};
const store = (db: DB) => localStorage.setItem(KEY, JSON.stringify(db));
const id = () => crypto.randomUUID();

export function createFakeCloud(): CloudApi {
  const listeners = new Set<(u: CloudUser | null) => void>();
  const current = (): CloudUser | null => {
    try {
      return JSON.parse(sessionStorage.getItem('inkwell-fake-session') ?? 'null');
    } catch {
      return null;
    }
  };
  const setCurrent = (u: CloudUser | null) => {
    if (u) sessionStorage.setItem('inkwell-fake-session', JSON.stringify(u));
    else sessionStorage.removeItem('inkwell-fake-session');
    listeners.forEach((l) => l(u));
  };
  const me = () => {
    const u = current();
    if (!u) throw new Error('Not signed in');
    return u;
  };
  const roleOf = (db: DB, docId: string): CloudRole | null => {
    const u = current();
    const d = db.docs.find((x) => x.id === docId);
    if (!u || !d) return null;
    if (d.owner === u.id) return 'owner';
    const s = db.shares.find((x) => x.document_id === docId && x.email === u.email)?.role;
    if (s === 'edit' || d.link_access === 'edit') return 'edit';
    if (s === 'view' || d.link_access === 'view') return 'view';
    return null;
  };
  const owned = (db: DB, docId: string) => {
    const d = db.docs.find((x) => x.id === docId);
    if (!d || d.owner !== me().id) throw new Error('You do not have permission to do that');
    return d;
  };
  const tick = () => new Promise((r) => setTimeout(r, 30));

  const api: CloudApi = {
    async getUser() {
      return current();
    },
    onAuthChange(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    async signIn(email, password) {
      await tick();
      const u = load().users.find((x) => x.email === email.toLowerCase() && x.password === password);
      if (!u) throw new Error('Invalid login credentials');
      setCurrent({ id: u.id, email: u.email });
    },
    async signUp(email, password) {
      await tick();
      const db = load();
      if (db.users.some((x) => x.email === email.toLowerCase())) throw new Error('User already registered');
      if (password.length < 6) throw new Error('Password should be at least 6 characters');
      const u = { id: id(), email: email.toLowerCase(), password };
      db.users.push(u);
      store(db);
      setCurrent({ id: u.id, email: u.email });
      return false;
    },
    async sendMagicLink() {
      await tick();
    },
    async sendPasswordReset() {
      await tick();
    },
    async signOut() {
      setCurrent(null);
    },
    onPasswordRecovery() {
      return () => {};
    },
    async updatePassword(password) {
      const db = load();
      const u = db.users.find((x) => x.id === me().id)!;
      u.password = password;
      store(db);
    },

    async createDoc(p) {
      await tick();
      const db = load();
      const u = me();
      const row: Row = {
        id: id(),
        owner: u.id,
        owner_email: u.email,
        title: p.title,
        content: p.content,
        page_setup: p.page_setup,
        comments: p.comments,
        preview: p.preview,
        word_count: p.word_count,
        link_access: 'none',
        updated_at: new Date().toISOString(),
        updated_by_email: u.email,
      };
      db.docs.push(row);
      store(db);
      return (await api.openDoc(row.id))!;
    },
    async openDoc(docId) {
      await tick();
      const db = load();
      const role = roleOf(db, docId);
      if (!role) return null;
      const { owner: _owner, ...rest } = db.docs.find((x) => x.id === docId)!;
      void _owner;
      return structuredClone({ ...rest, role });
    },
    async saveDoc(docId, p) {
      await tick();
      const db = load();
      const role = roleOf(db, docId);
      if (role !== 'owner' && role !== 'edit') throw new Error('You do not have permission to edit this document');
      const d = db.docs.find((x) => x.id === docId)!;
      Object.assign(d, structuredClone(p), { updated_at: new Date().toISOString(), updated_by_email: me().email });
      store(db);
      return d.updated_at;
    },
    async status(docId) {
      const db = load();
      const role = roleOf(db, docId);
      return role ? { updated_at: db.docs.find((x) => x.id === docId)!.updated_at, role } : null;
    },
    async deleteDoc(docId) {
      const db = load();
      owned(db, docId);
      db.docs = db.docs.filter((x) => x.id !== docId);
      db.shares = db.shares.filter((x) => x.document_id !== docId);
      store(db);
    },
    async listMine() {
      await tick();
      const db = load();
      const u = me();
      return db.docs
        .filter((d) => d.owner === u.id || db.shares.some((s) => s.document_id === d.id && s.email === u.email))
        .map((d) => ({
          id: d.id,
          title: d.title,
          preview: d.preview,
          owner_email: d.owner_email,
          updated_at: d.updated_at,
          role: roleOf(db, d.id)!,
        }))
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
    },

    async listShares(docId) {
      const db = load();
      owned(db, docId);
      return db.shares.filter((s) => s.document_id === docId).map(({ email, role }): Share => ({ email, role }));
    },
    async setShare(docId, email, role) {
      await tick();
      const db = load();
      owned(db, docId);
      const e = email.trim().toLowerCase();
      db.shares = db.shares.filter((s) => !(s.document_id === docId && s.email === e));
      db.shares.push({ document_id: docId, email: e, role });
      store(db);
    },
    async removeShare(docId, email) {
      const db = load();
      if (email !== me().email) owned(db, docId);
      db.shares = db.shares.filter((s) => !(s.document_id === docId && s.email === email));
      store(db);
    },
    async setLinkAccess(docId, access: LinkAccess) {
      const db = load();
      owned(db, docId).link_access = access;
      store(db);
    },
    async getLinkAccess(docId) {
      return (await api.openDoc(docId))?.link_access ?? 'none';
    },
  };
  return api;
}
