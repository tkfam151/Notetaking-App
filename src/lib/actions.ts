import { newDoc, saveDoc } from './db';
import { getTemplates, type Template } from './templates';
import { importFile } from './io';
import type { InkDoc } from '../types';

export function htmlToText(html: string) {
  const div = document.createElement('div');
  div.innerHTML = html.replace(/<\/(p|h\d|li|tr|div)>|<br\s*\/?>/g, (m) => `${m}\n`);
  return (div.textContent ?? '')
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

export async function createFromTemplate(t: Template | null, folderId: string | null = null): Promise<InkDoc> {
  const tpl = t ?? getTemplates()[0];
  const preview = htmlToText(tpl.html).slice(0, 400);
  const doc = newDoc({
    title: tpl.title,
    content: tpl.html,
    preview,
    folderId,
    wordCount: preview ? preview.split(/\s+/).length : 0,
  });
  await saveDoc(doc);
  return doc;
}

export async function importAsNewDoc(file: File, folderId: string | null = null): Promise<InkDoc> {
  const res = await importFile(file);
  const preview = typeof res.content === 'string' ? htmlToText(res.content).slice(0, 400) : '';
  const doc = newDoc({ title: res.title, content: res.content, preview, folderId, ...res.extra });
  await saveDoc(doc);
  return doc;
}
