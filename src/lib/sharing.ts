import { cloud, type CloudDoc } from './cloud';
import { findByCloudId, newDoc, saveDoc } from './db';
import { DEFAULT_PAGE_SETUP, type DocComment, type InkDoc, type PageSetup } from '../types';

/** Fields of a local document that come from its shared cloud copy. */
export function fromCloud(remote: CloudDoc): Partial<InkDoc> {
  return {
    title: remote.title,
    content: remote.content,
    preview: remote.preview,
    wordCount: remote.word_count,
    pageSetup: (remote.page_setup as PageSetup | null) ?? structuredClone(DEFAULT_PAGE_SETUP),
    comments: (remote.comments as DocComment[] | null) ?? [],
    cloudId: remote.id,
    cloudRole: remote.role,
    cloudUpdatedAt: remote.updated_at,
    cloudDirty: false,
    sharedBy: remote.role === 'owner' ? undefined : remote.owner_email,
  };
}

/**
 * Opens a shared document (from a link or the "Shared" list): returns the id of the
 * local copy, creating it the first time. Returns null if I have no access.
 */
export async function openSharedDoc(cloudId: string): Promise<string | null> {
  const api = await cloud();
  const local = await findByCloudId(cloudId);
  const remote = await api.openDoc(cloudId);
  if (!remote) return null;
  if (local) {
    if (local.trashed || local.cloudRole !== remote.role) {
      await saveDoc({ ...local, trashed: false, cloudRole: remote.role });
    }
    return local.id; // the editor pulls the latest content when it opens
  }
  const doc = newDoc(fromCloud(remote));
  await saveDoc(doc);
  return doc.id;
}

/** Turns a shared-copy document back into a normal private document. */
export function detachFromCloud(doc: InkDoc): InkDoc {
  const { cloudId: _a, cloudRole: _b, cloudUpdatedAt: _c, cloudDirty: _d, sharedBy: _e, ...rest } = doc;
  void _a;
  void _b;
  void _c;
  void _d;
  void _e;
  return rest;
}
