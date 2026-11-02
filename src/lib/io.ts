import type { Editor } from '@tiptap/core';
import TurndownService from 'turndown';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { PAGE_DIMENSIONS, type InkDoc } from '../types';
import { safeFilename, saveFile } from './platform';

export type ExportFormat = 'docx' | 'pdf' | 'md' | 'html' | 'txt' | 'inkwell';

export const EXPORT_FORMATS: { id: ExportFormat; label: string; ext: string }[] = [
  { id: 'docx', label: 'Microsoft Word (.docx)', ext: 'docx' },
  { id: 'pdf', label: 'PDF document (.pdf)', ext: 'pdf' },
  { id: 'md', label: 'Markdown (.md)', ext: 'md' },
  { id: 'html', label: 'Web page (.html)', ext: 'html' },
  { id: 'txt', label: 'Plain text (.txt)', ext: 'txt' },
  { id: 'inkwell', label: 'Inkwell document (.inkwell)', ext: 'inkwell' },
];

/** Styles embedded into exported HTML / PDF so they look like the editor. */
export const EXPORT_CSS = `
  body { font-family: Inter, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif; font-size: 11pt; line-height: 1.5; color: #1f2328; }
  h1 { font-size: 22pt; margin: 0.6em 0 0.3em; } h2 { font-size: 16pt; margin: 0.6em 0 0.3em; }
  h3 { font-size: 13pt; margin: 0.6em 0 0.3em; } h4 { font-size: 11pt; margin: 0.6em 0 0.3em; }
  p { margin: 0 0 0.6em; }
  blockquote { border-left: 3px solid #ced4da; margin: 0 0 0.6em; padding-left: 1em; color: #495057; }
  pre { background: #f1f3f5; padding: 0.75em 1em; border-radius: 6px; font-family: 'Roboto Mono', 'Courier New', monospace; font-size: 10pt; white-space: pre-wrap; }
  code { background: #f1f3f5; padding: 0.1em 0.3em; border-radius: 4px; font-family: 'Roboto Mono', 'Courier New', monospace; font-size: 0.9em; }
  pre code { background: none; padding: 0; }
  table { border-collapse: collapse; width: 100%; margin: 0 0 0.8em; table-layout: fixed; }
  td, th { border: 1px solid #ced4da; padding: 6px 8px; vertical-align: top; text-align: left; }
  th { background: #f1f3f5; font-weight: 600; }
  td p, th p { margin: 0; }
  img { max-width: 100%; height: auto; }
  hr { border: none; border-top: 1px solid #ced4da; margin: 1em 0; }
  ul[data-type="taskList"] { list-style: none; padding-left: 0.2em; }
  ul[data-type="taskList"] li { display: flex; gap: 0.5em; align-items: flex-start; }
  ul[data-type="taskList"] li > label { flex: 0 0 auto; margin-top: 0.15em; }
  ul[data-type="taskList"] li > div { flex: 1; }
  mark { padding: 0 0.1em; border-radius: 2px; }
  a { color: #1971c2; }
  .page-break { page-break-after: always; break-after: page; height: 0; border: 0; }
  .comment-mark { background: none !important; }
`;

/** HTML of the document with comment highlights removed (they are editor-only). */
export function cleanHTML(editor: Editor) {
  const div = document.createElement('div');
  div.innerHTML = editor.getHTML();
  div.querySelectorAll('span[data-comment-id]').forEach((el) => el.replaceWith(...Array.from(el.childNodes)));
  // Task list checkboxes should render checked state in exports
  div.querySelectorAll('li[data-type="taskItem"]').forEach((li) => {
    const checked = li.getAttribute('data-checked') === 'true';
    if (!li.querySelector('input')) {
      const label = document.createElement('label');
      label.innerHTML = `<input type="checkbox" ${checked ? 'checked' : ''} disabled>`;
      const body = document.createElement('div');
      body.append(...Array.from(li.childNodes));
      li.append(label, body);
    }
  });
  return div.innerHTML;
}

function standaloneHTML(title: string, body: string) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title.replace(/</g, '&lt;')}</title>
<style>${EXPORT_CSS} body { max-width: 760px; margin: 40px auto; padding: 0 24px; }</style>
</head><body>
${body}
</body></html>`;
}

function turndown() {
  const td = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-' });
  td.addRule('strike', { filter: ['s', 'del'] as any, replacement: (c) => `~~${c}~~` });
  td.addRule('taskItem', {
    filter: (node) => node.nodeName === 'LI' && node.getAttribute('data-type') === 'taskItem',
    replacement: (content, node) => {
      const checked = (node as HTMLElement).getAttribute('data-checked') === 'true';
      return `- [${checked ? 'x' : ' '}] ${content.replace(/^\s+|\s+$/g, '').replace(/\n+/g, '\n  ')}\n`;
    },
  });
  td.addRule('taskCheckbox', { filter: (n) => n.nodeName === 'LABEL' && !!n.querySelector('input'), replacement: () => '' });
  td.addRule('pageBreak', {
    filter: (n) => n.nodeName === 'DIV' && (n as HTMLElement).hasAttribute('data-page-break'),
    replacement: () => '\n\n---\n\n',
  });
  td.addRule('table', {
    filter: 'table',
    replacement: (_c, node) => {
      const rows = Array.from((node as HTMLTableElement).rows).map((r) =>
        Array.from(r.cells).map((c) => (c.textContent ?? '').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim()),
      );
      if (!rows.length) return '';
      const cols = Math.max(...rows.map((r) => r.length));
      const line = (r: string[]) => `| ${Array.from({ length: cols }, (_, i) => r[i] ?? '').join(' | ')} |`;
      return `\n\n${line(rows[0])}\n| ${Array(cols).fill('---').join(' | ')} |\n${rows.slice(1).map(line).join('\n')}\n\n`;
    },
  });
  return td;
}

export function toMarkdown(html: string) {
  return turndown().turndown(html);
}

async function toPdfBlob(editor: Editor, doc: InkDoc): Promise<Blob> {
  const { default: html2pdf } = await import('html2pdf.js');
  const setup = doc.pageSetup;
  const dims = PAGE_DIMENSIONS[setup.size];
  const landscape = setup.orientation === 'landscape';
  const widthIn = landscape ? dims.h : dims.w;
  const wrapper = document.createElement('div');
  wrapper.className = 'pdf-export';
  wrapper.style.cssText = `width:${widthIn - setup.margins.left - setup.margins.right}in;background:#fff;color:#1f2328;`;
  wrapper.innerHTML = `<style>${EXPORT_CSS}</style>${cleanHTML(editor)}`;
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-10000px;top:0;';
  host.appendChild(wrapper);
  document.body.appendChild(host);
  try {
    const worker = html2pdf()
      .set({
        margin: [setup.margins.top, setup.margins.left, setup.margins.bottom, setup.margins.right],
        image: { type: 'jpeg', quality: 0.95 },
        html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff' },
        jsPDF: { unit: 'in', format: [dims.w, dims.h], orientation: setup.orientation },
        pagebreak: { mode: ['css', 'legacy'], avoid: ['tr', 'img', 'li', 'h1', 'h2', 'h3'] },
      } as any)
      .from(wrapper);
    return (await worker.outputPdf('blob')) as Blob;
  } finally {
    host.remove();
  }
}

export async function exportDocument(editor: Editor, doc: InkDoc, format: ExportFormat) {
  const name = safeFilename(doc.title);
  const ext = EXPORT_FORMATS.find((f) => f.id === format)!.ext;
  let blob: Blob;
  switch (format) {
    case 'docx': {
      const { toDocxBlob } = await import('./docx-export');
      blob = await toDocxBlob(editor.getJSON() as any, doc.title, doc.pageSetup);
      break;
    }
    case 'pdf':
      blob = await toPdfBlob(editor, doc);
      break;
    case 'md':
      blob = new Blob([toMarkdown(cleanHTML(editor))], { type: 'text/markdown' });
      break;
    case 'html':
      blob = new Blob([standaloneHTML(doc.title, cleanHTML(editor))], { type: 'text/html' });
      break;
    case 'txt':
      blob = new Blob([editor.getText({ blockSeparator: '\n\n' })], { type: 'text/plain' });
      break;
    case 'inkwell':
      blob = new Blob(
        [JSON.stringify({ app: 'inkwell', version: 1, doc: { ...doc, content: editor.getJSON() } }, null, 2)],
        { type: 'application/json' },
      );
      break;
  }
  await saveFile(`${name}.${ext}`, blob);
}

// ---- Import ----------------------------------------------------------------

export const IMPORT_ACCEPT = '.docx,.md,.markdown,.txt,.html,.htm,.inkwell,.json';

export interface ImportResult {
  title: string;
  /** Either sanitized HTML or ProseMirror JSON */
  content: unknown;
  extra?: Partial<InkDoc>;
}

function escapeHTML(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function sanitize(html: string) {
  return DOMPurify.sanitize(html, {
    ADD_ATTR: ['data-type', 'data-checked', 'data-page-break', 'data-comment-id', 'colspan', 'rowspan', 'style'],
  });
}

export async function importFile(file: File): Promise<ImportResult> {
  const name = file.name.replace(/\.[^.]+$/, '');
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'docx') {
    const mammoth = await import('mammoth');
    const { value } = await mammoth.convertToHtml(
      { arrayBuffer: await file.arrayBuffer() },
      { convertImage: mammoth.images.dataUri } as any,
    );
    return { title: name, content: sanitize(value) };
  }
  const text = await file.text();
  if (ext === 'md' || ext === 'markdown') {
    let html = await marked.parse(text, { gfm: true });
    // Convert GitHub-style task lists into Inkwell checklists
    html = html.replace(
      /<li>\s*<input (checked="" )?disabled="" type="checkbox">\s*/g,
      (_m, checked) => `<li data-type="taskItem" data-checked="${!!checked}">`,
    );
    html = html.replace(/<ul>(\s*<li data-type="taskItem")/g, '<ul data-type="taskList">$1');
    return { title: name, content: sanitize(html) };
  }
  if (ext === 'html' || ext === 'htm') {
    const docTitle = text.match(/<title>([^<]*)<\/title>/i)?.[1];
    const body = text.match(/<body[^>]*>([\s\S]*)<\/body>/i)?.[1] ?? text;
    return { title: docTitle || name, content: sanitize(body) };
  }
  if (ext === 'inkwell' || ext === 'json') {
    const data = JSON.parse(text);
    if (data?.app !== 'inkwell' || !data.doc) throw new Error('This file is not an Inkwell document.');
    const d = data.doc as InkDoc;
    return {
      title: d.title || name,
      content: d.content,
      extra: { pageSetup: d.pageSetup, comments: d.comments ?? [] },
    };
  }
  // Plain text
  const html = text
    .split(/\r?\n\r?\n/)
    .map((p) => `<p>${escapeHTML(p).replace(/\r?\n/g, '<br>')}</p>`)
    .join('');
  return { title: name, content: html || '<p></p>' };
}
