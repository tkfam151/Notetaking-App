import { createClient, type User } from '@supabase/supabase-js';
import type { CloudApi, CloudDoc, CloudDocSummary, CloudRole, CloudUser, LinkAccess, Share } from './cloud';

const toUser = (u: User | null | undefined): CloudUser | null => (u ? { id: u.id, email: (u.email ?? '').toLowerCase() } : null);

function check<R extends { data: unknown; error: unknown }>(res: R): R['data'] {
  if (res.error) throw new Error((res.error as { message?: string }).message ?? 'Request failed');
  return res.data;
}

export function createSupabaseCloud(url: string, key: string): CloudApi {
  const sb = createClient(url, key, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' },
  });
  // Where email links (confirm / magic link / reset) send people back to.
  const redirectTo = `${location.origin}${location.pathname}`;
  const summaryCols = 'id,title,preview,owner_email,updated_at';

  const api: CloudApi = {
    async getUser() {
      const { data } = await sb.auth.getSession();
      return toUser(data.session?.user);
    },
    onAuthChange(cb) {
      const { data } = sb.auth.onAuthStateChange((_event, session) => cb(toUser(session?.user)));
      return () => data.subscription.unsubscribe();
    },
    async signIn(email, password) {
      check(await sb.auth.signInWithPassword({ email, password }));
    },
    async signUp(email, password) {
      const data = check(await sb.auth.signUp({ email, password, options: { emailRedirectTo: redirectTo } }));
      return !data.session;
    },
    async sendMagicLink(email) {
      check(await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo } }));
    },
    async sendPasswordReset(email) {
      check(await sb.auth.resetPasswordForEmail(email, { redirectTo }));
    },
    async signOut() {
      await sb.auth.signOut();
    },
    onPasswordRecovery(cb) {
      const { data } = sb.auth.onAuthStateChange((event) => event === 'PASSWORD_RECOVERY' && cb());
      return () => data.subscription.unsubscribe();
    },
    async updatePassword(password) {
      check(await sb.auth.updateUser({ password }));
    },

    async createDoc(p) {
      const row = check(
        await sb
          .from('documents')
          .insert({ ...p, page_setup: p.page_setup ?? null })
          .select('id')
          .single(),
      ) as { id: string };
      const doc = await api.openDoc(row.id);
      if (!doc) throw new Error('Could not create the shared document');
      return doc;
    },
    async openDoc(id) {
      const data = check(await sb.rpc('open_document', { doc_id: id }));
      return (data as CloudDoc | null) ?? null;
    },
    async saveDoc(id, p) {
      return check(await sb.rpc('save_document', { doc_id: id, doc: p })) as string;
    },
    async status(id) {
      return (check(await sb.rpc('document_status', { doc_id: id })) as { updated_at: string; role: CloudRole } | null) ?? null;
    },
    async deleteDoc(id) {
      check(await sb.from('documents').delete().eq('id', id));
    },
    async listMine() {
      const user = await api.getUser();
      if (!user) return [];
      const owned = check(await sb.from('documents').select(summaryCols).eq('owner', user.id)) as Omit<
        CloudDocSummary,
        'role'
      >[];
      const shared = check(
        await sb.from('document_shares').select(`role, documents(${summaryCols})`).eq('email', user.email),
      ) as unknown as { role: 'view' | 'edit'; documents: Omit<CloudDocSummary, 'role'> | null }[];
      const out: CloudDocSummary[] = owned.map((d) => ({ ...d, role: 'owner' as const }));
      for (const s of shared) if (s.documents && !out.some((d) => d.id === s.documents!.id)) out.push({ ...s.documents, role: s.role });
      return out.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
    },

    async listShares(id) {
      return check(await sb.from('document_shares').select('email,role').eq('document_id', id).order('created_at')) as Share[];
    },
    async setShare(id, email, role) {
      check(await sb.from('document_shares').upsert({ document_id: id, email: email.trim().toLowerCase(), role }));
    },
    async removeShare(id, email) {
      check(await sb.from('document_shares').delete().eq('document_id', id).eq('email', email));
    },
    async setLinkAccess(id, access) {
      check(await sb.from('documents').update({ link_access: access }).eq('id', id));
    },
    async getLinkAccess(id) {
      const d = await api.openDoc(id);
      return (d?.link_access ?? 'none') as LinkAccess;
    },
  };
  return api;
}
