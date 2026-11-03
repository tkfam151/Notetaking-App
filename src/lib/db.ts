import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import {
  DEFAULT_PAGE_SETUP,
  type DocVersion,
  type Folder,
  type InkDoc,
  type Settings,
} from '../types';

/**
 * All documents live on the device in IndexedDB. Nothing leaves the device unless
 * the user exports a file. The storage API is intentionally small so a cloud sync
 * backend can be added later behind the same functions.
 */
interface InkwellDB extends DBSchema {
  docs: { key: string; value: InkDoc; indexes: { updatedAt: number } };
  versions: { key: string; value: DocVersion; indexes: { docId: string } };
  folders: { key: string; value: Folder };
  settings: { key: string; value: Settings };
}

let dbPromise: Promise<IDBPDatabase<InkwellDB>> | null = null;
const DEFAULT_DB = 'inkwell';
let dbName = DEFAULT_DB;

function open(name: string) {
  return openDB<InkwellDB>(name, 1, {
    upgrade(d) {
      const docs = d.createObjectStore('docs', { keyPath: 'id' });
      docs.createIndex('updatedAt', 'updatedAt');
      const versions = d.createObjectStore('versions', { keyPath: 'id' });
      versions.createIndex('docId', 'docId');
      d.createObjectStore('folders', { keyPath: 'id' });
      d.createObjectStore('settings');
    },
  });
}

function db() {
  if (!dbPromise) dbPromise = open(dbName);
  return dbPromise;
}

/**
 * Web with accounts: keep each signed-in user's documents in their own on-device database,
 * so people sharing a browser don't see each other's files. The desktop and mobile apps
 * never call this and keep using the default database.
 */
export async function selectAccountStorage(userId: string) {
  const name = `${DEFAULT_DB}-${userId}`;
  if (name === dbName) return;
  if (dbPromise) (await dbPromise).close();
  dbName = name;
  dbPromise = null;
  // One-time: documents created on this website before accounts existed move into the
  // first account that signs in here.
  const legacy = await open(DEFAULT_DB);
  try {
    const claimed = await legacy.get('settings', 'claimedBy');
    if (!claimed) {
      const [docs, folders, versions, settings] = await Promise.all([
        legacy.getAll('docs'),
        legacy.getAll('folders'),
        legacy.getAll('versions'),
        legacy.get('settings', 'app'),
      ]);
      const target = await db();
      const tx = target.transaction(['docs', 'folders', 'versions', 'settings'], 'readwrite');
      for (const d of docs) await tx.objectStore('docs').put(d);
      for (const f of folders) await tx.objectStore('folders').put(f);
      for (const v of versions) await tx.objectStore('versions').put(v);
      if (settings && !(await tx.objectStore('settings').get('app'))) await tx.objectStore('settings').put(settings, 'app');
      await tx.done;
      await legacy.put('settings', { claimedBy: userId } as unknown as Settings, 'claimedBy');
    }
  } finally {
    legacy.close();
  }
}

export async function findByCloudId(cloudId: string) {
  return (await (await db()).getAll('docs')).find((d) => d.cloudId === cloudId);
}

export const uid = () =>
  (crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`).replace(/-/g, '').slice(0, 16);

export function newDoc(partial: Partial<InkDoc> = {}): InkDoc {
  const now = Date.now();
  return {
    id: uid(),
    title: 'Untitled document',
    content: { type: 'doc', content: [{ type: 'paragraph' }] },
    preview: '',
    createdAt: now,
    updatedAt: now,
    starred: false,
    trashed: false,
    folderId: null,
    pageSetup: structuredClone(DEFAULT_PAGE_SETUP),
    comments: [],
    wordCount: 0,
    ...partial,
  };
}

// ---- Documents -------------------------------------------------------------

export async function listDocs(): Promise<InkDoc[]> {
  const all = await (await db()).getAll('docs');
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getDoc(id: string) {
  return (await db()).get('docs', id);
}

export async function saveDoc(doc: InkDoc) {
  await (await db()).put('docs', doc);
  return doc;
}

export async function deleteDocForever(id: string) {
  const d = await db();
  const tx = d.transaction(['docs', 'versions'], 'readwrite');
  await tx.objectStore('docs').delete(id);
  const idx = tx.objectStore('versions').index('docId');
  for (const key of await idx.getAllKeys(id)) await tx.objectStore('versions').delete(key);
  await tx.done;
}

export async function duplicateDoc(id: string) {
  const src = await getDoc(id);
  if (!src) return null;
  const copy = newDoc({
    ...structuredClone(src),
    id: uid(),
    title: `${src.title} (copy)`,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    starred: false,
  });
  await saveDoc(copy);
  return copy;
}

// ---- Versions --------------------------------------------------------------

export async function listVersions(docId: string): Promise<DocVersion[]> {
  const all = await (await db()).getAllFromIndex('versions', 'docId', docId);
  return all.sort((a, b) => b.createdAt - a.createdAt);
}

export async function addVersion(doc: InkDoc, label: string | null = null) {
  const v: DocVersion = {
    id: uid(),
    docId: doc.id,
    title: doc.title,
    content: structuredClone(doc.content),
    createdAt: Date.now(),
    label,
    wordCount: doc.wordCount,
  };
  await (await db()).put('versions', v);
  // Keep the newest 50 automatic snapshots; named versions are kept forever.
  const versions = await listVersions(doc.id);
  const auto = versions.filter((x) => !x.label);
  for (const old of auto.slice(50)) await (await db()).delete('versions', old.id);
  return v;
}

export async function renameVersion(id: string, label: string | null) {
  const d = await db();
  const v = await d.get('versions', id);
  if (v) await d.put('versions', { ...v, label });
}

// ---- Folders ---------------------------------------------------------------

export async function listFolders(): Promise<Folder[]> {
  const all = await (await db()).getAll('folders');
  return all.sort((a, b) => a.name.localeCompare(b.name));
}

export async function saveFolder(f: Folder) {
  await (await db()).put('folders', f);
}

export async function deleteFolder(id: string) {
  const d = await db();
  const tx = d.transaction(['folders', 'docs'], 'readwrite');
  await tx.objectStore('folders').delete(id);
  for (const doc of await tx.objectStore('docs').getAll()) {
    if (doc.folderId === id) await tx.objectStore('docs').put({ ...doc, folderId: null });
  }
  await tx.done;
}

// ---- Settings --------------------------------------------------------------

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  authorName: 'Me',
  defaultFont: 'Inter',
  spellcheck: true,
};

export async function getSettings(): Promise<Settings> {
  const s = await (await db()).get('settings', 'app');
  return { ...DEFAULT_SETTINGS, ...(s ?? {}) };
}

export async function saveSettings(s: Settings) {
  await (await db()).put('settings', s, 'app');
}

// ---- Backup ----------------------------------------------------------------

export async function exportBackup() {
  const d = await db();
  return {
    app: 'inkwell',
    version: 1,
    exportedAt: Date.now(),
    docs: await d.getAll('docs'),
    folders: await d.getAll('folders'),
  };
}

export async function importBackup(data: { docs?: InkDoc[]; folders?: Folder[] }) {
  const d = await db();
  let count = 0;
  for (const f of data.folders ?? []) await d.put('folders', f);
  for (const doc of data.docs ?? []) {
    await d.put('docs', { ...newDoc(), ...doc });
    count++;
  }
  return count;
}
