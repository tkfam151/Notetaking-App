/**
 * Accounts and sharing.
 *
 * Switched on only when the build has Supabase settings (VITE_SUPABASE_URL +
 * VITE_SUPABASE_ANON_KEY); without them Inkwell is purely local, exactly as before.
 *  - Web: signing in is required (it's how the browser version knows whose documents to show).
 *  - Desktop & mobile apps: signing in is optional and only needed to share. The apps
 *    always open straight to your documents and work offline.
 */
import { isElectron, isNative } from './platform';

export type CloudRole = 'owner' | 'edit' | 'view';
export type LinkAccess = 'none' | 'view' | 'edit';

export interface CloudUser {
  id: string;
  email: string;
}

export interface CloudDoc {
  id: string;
  owner_email: string;
  title: string;
  content: unknown;
  page_setup: unknown;
  comments: unknown;
  preview: string;
  word_count: number;
  link_access: LinkAccess;
  updated_at: string;
  updated_by_email: string | null;
  role: CloudRole;
}

export type CloudDocSummary = Pick<CloudDoc, 'id' | 'title' | 'preview' | 'owner_email' | 'updated_at' | 'role'>;

export interface Share {
  email: string;
  role: 'view' | 'edit';
}

export interface DocPayload {
  title: string;
  content: unknown;
  page_setup: unknown;
  comments: unknown;
  preview: string;
  word_count: number;
}

export interface CloudApi {
  getUser(): Promise<CloudUser | null>;
  onAuthChange(cb: (u: CloudUser | null) => void): () => void;
  signIn(email: string, password: string): Promise<void>;
  /** Returns true when the user must confirm their email before signing in */
  signUp(email: string, password: string): Promise<boolean>;
  sendMagicLink(email: string): Promise<void>;
  sendPasswordReset(email: string): Promise<void>;
  signOut(): Promise<void>;
  /** Fires when someone arrives from a "reset password" email and must choose a new password */
  onPasswordRecovery(cb: () => void): () => void;
  updatePassword(password: string): Promise<void>;

  /** Upload a document for the first time (the caller becomes the owner). */
  createDoc(p: DocPayload): Promise<CloudDoc>;
  openDoc(id: string): Promise<CloudDoc | null>;
  saveDoc(id: string, p: Partial<DocPayload>): Promise<string>;
  /** Last change time and my current role, or null if I no longer have access */
  status(id: string): Promise<{ updated_at: string; role: CloudRole } | null>;
  deleteDoc(id: string): Promise<void>;
  /** Documents I own in the cloud + documents shared with me by email */
  listMine(): Promise<CloudDocSummary[]>;

  listShares(id: string): Promise<Share[]>;
  setShare(id: string, email: string, role: Share['role']): Promise<void>;
  removeShare(id: string, email: string): Promise<void>;
  setLinkAccess(id: string, access: LinkAccess): Promise<void>;
  getLinkAccess(id: string): Promise<LinkAccess>;
}

const env = import.meta.env;
const SUPABASE_URL = env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_KEY = env.VITE_SUPABASE_ANON_KEY as string | undefined;
const FAKE = env.VITE_CLOUD === 'fake';

/** True when this build can sign in and share (all platforms, if configured). */
export const cloudEnabled = FAKE || (!!SUPABASE_URL && !!SUPABASE_KEY);
/** Only the web version makes you sign in before using it. */
export const isApp = isNative || isElectron;
export const loginRequired = cloudEnabled && !isApp;

/** Public address of the web version, used for share links made inside the apps. */
const WEB_URL = (import.meta.env.VITE_WEB_URL as string | undefined) ?? 'https://tkfam151.github.io/notetaking-app/';

let apiPromise: Promise<CloudApi> | null = null;

export function cloud(): Promise<CloudApi> {
  if (!cloudEnabled) return Promise.reject(new Error('Cloud features are not available in this version'));
  if (!apiPromise) {
    apiPromise = FAKE
      ? import('./cloud-fake').then((m) => m.createFakeCloud())
      : import('./cloud-supabase').then((m) => m.createSupabaseCloud(SUPABASE_URL!, SUPABASE_KEY!));
  }
  return apiPromise;
}

/** The address people use to open a shared document. */
export function shareLink(cloudId: string) {
  // Links must work for everyone, so the apps (file:// or capacitor://) link to the website.
  const base = isApp ? WEB_URL : `${location.origin}${location.pathname}`;
  return `${base}#/shared/${cloudId}`;
}

/** Where emailed links (confirm account, reset password) send people: always the website. */
export function emailRedirectUrl() {
  return isApp ? WEB_URL : `${location.origin}${location.pathname}`;
}

/** Pulls the document id out of a pasted share link (or a bare id). */
export function parseShareLink(text: string): string | null {
  const m = text.trim().match(/(?:#\/shared\/)?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
  return m ? m[1].toLowerCase() : null;
}

export function friendlyError(e: unknown): string {
  const msg = e instanceof Error ? e.message : typeof e === 'object' && e && 'message' in e ? String((e as { message: unknown }).message) : String(e);
  if (/invalid login credentials/i.test(msg)) return 'Wrong email or password.';
  if (/email not confirmed/i.test(msg)) return 'Please confirm your email first. Check your inbox for the link.';
  if (/already registered|already been registered/i.test(msg)) return 'An account with this email already exists. Try signing in.';
  if (/password should be at least/i.test(msg)) return 'Password must be at least 6 characters.';
  if (/rate limit|too many/i.test(msg)) return 'Too many attempts. Please wait a minute and try again.';
  if (/failed to fetch|network/i.test(msg)) return 'Can’t reach the server. Check your internet connection.';
  if (/permission/i.test(msg)) return 'You don’t have permission to do that.';
  return msg || 'Something went wrong.';
}
