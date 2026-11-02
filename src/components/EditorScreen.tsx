import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import { createDocument } from '@tiptap/core';
import {
  ArrowLeft,
  ChevronDown,
  Download,
  FileText,
  History,
  MessageSquare,
  MoreVertical,
  Star,
  Check,
  Loader2,
  Maximize2,
} from 'lucide-react';
import { buildExtensions } from '../editor/extensions';
import { addVersion, getDoc, saveDoc, uid, duplicateDoc } from '../lib/db';
import { EXPORT_FORMATS, exportDocument, IMPORT_ACCEPT, type ExportFormat } from '../lib/io';
import { createFromTemplate, importAsNewDoc } from '../lib/actions';
import { getTemplates } from '../lib/templates';
import { isNative, modKey, pickFile } from '../lib/platform';
import { PAGE_DIMENSIONS, type DocComment, type DocVersion, type InkDoc, type PageSetup, type Settings } from '../types';
import { Toolbar, useEditorTick } from './Toolbar';
import { Menu, useUI, type MenuItem, type MenubarState } from './ui';
import { CommentsPanel } from './CommentsPanel';
import { HistoryPanel } from './HistoryPanel';
import { FindBar } from './FindBar';
import { PageSetupDialog, ShortcutsDialog, SpecialCharsDialog, WordCountDialog } from './Dialogs';
import { LinkBubble, TableBubble } from './Bubbles';
import { Ruler } from './Ruler';
import { SettingsDialog } from './SettingsDialog';

const DPI = 96;
const SNAPSHOT_EVERY_MS = 10 * 60 * 1000;

interface Props {
  docId: string;
  settings: Settings;
  updateSettings: (p: Partial<Settings>) => void;
  onHome: () => void;
  onOpen: (id: string) => void;
}

export function EditorScreen(props: Props) {
  const [doc, setDoc] = useState<InkDoc | null | undefined>(undefined);
  useEffect(() => {
    getDoc(props.docId).then((d) => setDoc(d ?? null));
  }, [props.docId]);

  if (doc === undefined) return <div className="loading-screen" />;
  if (doc === null)
    return (
      <div className="empty full">
        <FileText size={48} />
        <p>This document could not be found. It may have been deleted.</p>
        <button className="btn btn-primary" onClick={props.onHome}>
          Back to documents
        </button>
      </div>
    );
  return <EditorInner {...props} initial={doc} />;
}

/** Downscale big images so documents stay small and fast. */
async function fileToDataUrl(file: File, max = 1600): Promise<string> {
  const url = await new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = rej;
    r.readAsDataURL(file);
  });
  if (file.type === 'image/gif' || file.type === 'image/svg+xml') return url;
  const img = new Image();
  img.src = url;
  await img.decode().catch(() => undefined);
  if (!img.width || (img.width <= max && img.height <= max)) return url;
  const scale = max / Math.max(img.width, img.height);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL(file.type === 'image/png' ? 'image/png' : 'image/jpeg', 0.9);
}

function replaceDocContent(editor: Editor, content: unknown) {
  const node = createDocument(content as any, editor.schema);
  const tr = editor.state.tr
    .replaceWith(0, editor.state.doc.content.size, node.content)
    .setMeta('addToHistory', false)
    .setMeta('preventUpdate', true);
  editor.view.dispatch(tr);
}

function useIsNarrow() {
  const [narrow, setNarrow] = useState(() => window.innerWidth < 860);
  useEffect(() => {
    const on = () => setNarrow(window.innerWidth < 860);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return narrow;
}

function EditorInner({ initial, settings, updateSettings, onHome, onOpen }: Props & { initial: InkDoc }) {
  const ui = useUI();
  const narrow = useIsNarrow();

  // ---- Document state ------------------------------------------------------
  const [title, setTitle] = useState(initial.title);
  const [starred, setStarred] = useState(initial.starred);
  const [pageSetup, setPageSetup] = useState<PageSetup>(initial.pageSetup);
  const [comments, setComments] = useState<DocComment[]>(initial.comments ?? []);
  const [status, setStatus] = useState<'saved' | 'saving' | 'unsaved'>('saved');

  const docRef = useRef<InkDoc>(initial);
  const saveTimer = useRef<number | undefined>(undefined);
  const lastSnapshot = useRef<number>(Date.now());
  const dirtySinceSnapshot = useRef(false);
  const editorRef = useRef<Editor | null>(null);
  const previewing = useRef(false);

  // ---- UI state -----------------------------------------------------------
  const [panel, setPanel] = useState<'comments' | 'history' | null>(() =>
    window.innerWidth >= 1100 && (initial.comments ?? []).some((c) => !c.resolved) ? 'comments' : null,
  );
  const [activeComment, setActiveComment] = useState<string | null>(null);
  const [find, setFind] = useState<null | { replace: boolean }>(null);
  const [dialog, setDialog] = useState<null | 'pageSetup' | 'wordCount' | 'shortcuts' | 'special' | 'settings'>(null);
  const [zoom, setZoom] = useState(100);
  const [showRuler, setShowRuler] = useState(true);
  const [focusMode, setFocusMode] = useState(false);
  const [preview, setPreview] = useState<DocVersion | null>(null);
  const [historyKey, setHistoryKey] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [menubarActive, setMenubarActive] = useState<string | null>(null);
  const menubar: MenubarState = { active: menubarActive, setActive: setMenubarActive };

  // ---- Persistence ----------------------------------------------------------
  const persist = useCallback(async () => {
    const editor = editorRef.current;
    if (!editor || previewing.current) return;
    window.clearTimeout(saveTimer.current);
    const text = editor.getText({ blockSeparator: '\n' });
    const next: InkDoc = {
      ...docRef.current,
      content: editor.getJSON(),
      preview: text.slice(0, 400),
      wordCount: editor.storage.characterCount.words(),
      updatedAt: Date.now(),
    };
    docRef.current = next;
    await saveDoc(next);
    if (dirtySinceSnapshot.current && Date.now() - lastSnapshot.current > SNAPSHOT_EVERY_MS) {
      await addVersion(next);
      lastSnapshot.current = Date.now();
      dirtySinceSnapshot.current = false;
      setHistoryKey((k) => k + 1);
    }
    setStatus('saved');
  }, []);

  const scheduleSave = useCallback(() => {
    dirtySinceSnapshot.current = true;
    setStatus('unsaved');
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      setStatus('saving');
      persist();
    }, 600);
  }, [persist]);

  // Keep metadata on the doc ref and save when it changes
  const firstMeta = useRef(true);
  useEffect(() => {
    docRef.current = { ...docRef.current, title: title.trim() || 'Untitled document', starred, pageSetup, comments };
    if (firstMeta.current) {
      firstMeta.current = false;
      return;
    }
    scheduleSave();
  }, [title, starred, pageSetup, comments, scheduleSave]);

  useEffect(() => {
    document.title = `${title || 'Untitled'} – Inkwell`;
  }, [title]);

  // ---- Editor ---------------------------------------------------------------
  const extensions = useMemo(buildExtensions, []);
  const insertImageFiles = useCallback(async (files: File[], pos?: number) => {
    const editor = editorRef.current;
    if (!editor) return;
    for (const f of files.filter((x) => x.type.startsWith('image/'))) {
      const src = await fileToDataUrl(f);
      const chain = editor.chain().focus();
      if (pos !== undefined) chain.insertContentAt(pos, { type: 'image', attrs: { src, alt: f.name } }).run();
      else chain.setImage({ src, alt: f.name }).run();
    }
  }, []);

  const editor = useEditor({
    extensions,
    content: initial.content as any,
    immediatelyRender: true,
    shouldRerenderOnTransaction: false,
    editorProps: {
      attributes: { class: 'doc-content', spellcheck: String(settings.spellcheck), 'aria-label': 'Document' },
      handlePaste: (_view, event) => {
        const files = Array.from(event.clipboardData?.files ?? []).filter((f) => f.type.startsWith('image/'));
        if (!files.length) return false;
        insertImageFiles(files);
        return true;
      },
      handleDrop: (view, event, _slice, moved) => {
        if (moved) return false;
        const files = Array.from(event.dataTransfer?.files ?? []).filter((f) => f.type.startsWith('image/'));
        if (!files.length) return false;
        const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
        insertImageFiles(files, pos);
        return true;
      },
    },
    onUpdate: () => scheduleSave(),
    onSelectionUpdate: ({ editor: e }) => {
      const mark = e.state.selection.$from.marks().find((m) => m.type.name === 'comment');
      if (mark) setActiveComment(mark.attrs.commentId);
    },
  });
  editorRef.current = editor;

  useEffect(() => {
    editor.view.dom.setAttribute('spellcheck', String(settings.spellcheck));
  }, [editor, settings.spellcheck]);

  // Focus a fresh, empty document
  useEffect(() => {
    if (editor.isEmpty) editor.commands.focus('end');
  }, [editor]);

  // Flush on unmount / page hide
  useEffect(() => {
    const flush = () => {
      if (status !== 'saved') persist();
    };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', flush);
    };
  }, [persist, status]);
  useEffect(
    () => () => {
      window.clearTimeout(saveTimer.current);
      if (previewing.current) return;
      const ed = editorRef.current;
      if (!ed || ed.isDestroyed) return;
      persist().then(() => {
        if (dirtySinceSnapshot.current) addVersion(docRef.current);
      });
    },
    [persist],
  );

  // ---- Actions -------------------------------------------------------------
  const saveVersion = useCallback(
    async (label: string | null = null) => {
      await persist();
      await addVersion(docRef.current, label);
      lastSnapshot.current = Date.now();
      dirtySinceSnapshot.current = false;
      setHistoryKey((k) => k + 1);
      ui.toast(label ? `Saved version “${label}”` : 'Version saved');
    },
    [persist, ui],
  );

  const doExport = useCallback(
    async (format: ExportFormat) => {
      setBusy(`Exporting ${format.toUpperCase()}…`);
      try {
        await persist();
        await exportDocument(editor, docRef.current, format);
      } catch (e) {
        console.error(e);
        ui.toast('Export failed. Please try again.');
      } finally {
        setBusy(null);
      }
    },
    [editor, persist, ui],
  );

  const print = useCallback(() => {
    if (isNative) {
      ui.toast('Creating a PDF you can print or share…');
      doExport('pdf');
      return;
    }
    const dims = PAGE_DIMENSIONS[pageSetup.size];
    const [w, h] = pageSetup.orientation === 'landscape' ? [dims.h, dims.w] : [dims.w, dims.h];
    const m = pageSetup.margins;
    let style = document.getElementById('print-page-style');
    if (!style) {
      style = document.createElement('style');
      style.id = 'print-page-style';
      document.head.appendChild(style);
    }
    style.textContent = `@page { size: ${w}in ${h}in; margin: ${m.top}in ${m.right}in ${m.bottom}in ${m.left}in; }`;
    window.print();
  }, [pageSetup, doExport, ui]);

  const insertImage = useCallback(async () => {
    const f = await pickFile('image/*');
    if (f) insertImageFiles([f]);
  }, [insertImageFiles]);

  const editLink = useCallback(async () => {
    const prev = editor.getAttributes('link').href as string | undefined;
    const { from, to } = editor.state.selection;
    const url = await ui.prompt(prev ? 'Edit link' : 'Insert link', prev ?? 'https://', { label: 'Web address', ok: 'Apply' });
    if (url === null) return;
    const chain = editor.chain().focus().extendMarkRange('link');
    if (!url.trim() || url.trim() === 'https://') {
      chain.unsetLink().run();
      return;
    }
    const href = /^(https?:|mailto:|tel:|#)/i.test(url.trim()) ? url.trim() : `https://${url.trim()}`;
    if (from === to && !prev) {
      editor.chain().focus().insertContent({ type: 'text', text: url.trim(), marks: [{ type: 'link', attrs: { href } }] }).run();
    } else chain.setLink({ href }).run();
  }, [editor, ui]);

  const addComment = useCallback(() => {
    const { from, to } = editor.state.selection;
    if (from === to) {
      ui.toast('Select some text to comment on');
      return;
    }
    const id = uid();
    const quote = editor.state.doc.textBetween(from, to, ' ').slice(0, 160);
    editor.chain().focus().setComment(id).run();
    setComments((c) => [
      ...c,
      { id, author: settings.authorName || 'Me', text: '', quote, createdAt: Date.now(), resolved: false, replies: [] },
    ]);
    setActiveComment(id);
    setPanel('comments');
  }, [editor, settings.authorName, ui]);

  const showPreview = useCallback(
    (v: DocVersion | null) => {
      if (v && !previewing.current) {
        persist();
        previewing.current = true;
        editor.setEditable(false);
      }
      if (v) {
        replaceDocContent(editor, v.content);
      } else if (previewing.current) {
        replaceDocContent(editor, docRef.current.content);
        previewing.current = false;
        editor.setEditable(true);
      }
      setPreview(v);
    },
    [editor, persist],
  );

  const restoreVersion = useCallback(async () => {
    if (!preview) return;
    await addVersion(docRef.current, 'Before restoring an earlier version');
    previewing.current = false;
    editor.setEditable(true);
    editor.commands.setContent(preview.content as any, { emitUpdate: true });
    setPreview(null);
    await persist();
    setHistoryKey((k) => k + 1);
    ui.toast('Version restored');
  }, [preview, editor, persist, ui]);

  const newDocFromTemplate = async (tplId: string) => {
    const doc = await createFromTemplate(getTemplates().find((t) => t.id === tplId) ?? null, docRef.current.folderId);
    onOpen(doc.id);
  };

  const importNew = async () => {
    const f = await pickFile(IMPORT_ACCEPT);
    if (!f) return;
    try {
      const d = await importAsNewDoc(f);
      onOpen(d.id);
    } catch (e) {
      ui.toast(e instanceof Error && e.message ? e.message : 'Could not import that file');
    }
  };

  // ---- Keyboard shortcuts --------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      const k = e.key.toLowerCase();
      if (k === 's' && !e.shiftKey) {
        e.preventDefault();
        saveVersion();
      } else if (k === 'f' && !e.shiftKey) {
        e.preventDefault();
        setFind({ replace: false });
      } else if (k === 'h' && !e.shiftKey) {
        e.preventDefault();
        setFind({ replace: true });
      } else if (k === 'p' && !e.shiftKey) {
        e.preventDefault();
        print();
      } else if (k === 'k') {
        e.preventDefault();
        editLink();
      } else if (k === 'm' && e.altKey) {
        e.preventDefault();
        addComment();
      } else if (e.key === '\\') {
        e.preventDefault();
        editor.chain().focus().unsetAllMarks().run();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [saveVersion, print, editLink, addComment, editor]);

  // ---- Page geometry -------------------------------------------------------
  const dims = PAGE_DIMENSIONS[pageSetup.size];
  const landscape = pageSetup.orientation === 'landscape';
  const pageW = landscape ? dims.h : dims.w;
  const pageH = landscape ? dims.w : dims.h;
  const m = pageSetup.margins;
  const fluid = narrow || pageSetup.viewMode === 'pageless';
  const contentH = Math.max(1, (pageH - m.top - m.bottom) * DPI);

  const pageRef = useRef<HTMLDivElement>(null);
  const [contentPx, setContentPx] = useState(0);
  const [paperPx, setPaperPx] = useState(0);
  useLayoutEffect(() => {
    const el = editor.view.dom as HTMLElement;
    const page = pageRef.current;
    if (!page) return;
    const ro = new ResizeObserver(() => {
      setContentPx(el.offsetHeight);
      setPaperPx(page.offsetHeight);
    });
    ro.observe(el);
    ro.observe(page);
    return () => ro.disconnect();
  }, [editor, fluid]);
  const pages = Math.max(1, Math.ceil((contentPx - 1) / contentH));
  const z = fluid ? 1 : zoom / 100;

  // ---- Menus ---------------------------------------------------------------
  const c = () => editor.chain().focus();
  const toggleTheme = (t: Settings['theme']) => updateSettings({ theme: t });

  const menus: { id: string; label: string; items: () => MenuItem[] }[] = [
    {
      id: 'file',
      label: 'File',
      items: () => [
        {
          label: 'New',
          submenu: getTemplates().map((t) => ({ label: t.name, onClick: () => newDocFromTemplate(t.id) })),
        },
        { label: 'Open…', shortcut: '', onClick: onHome },
        { label: 'Import file…', onClick: importNew },
        {
          label: 'Make a copy',
          onClick: async () => {
            await persist();
            const d = await duplicateDoc(docRef.current.id);
            if (d) onOpen(d.id);
          },
        },
        { divider: true },
        {
          label: 'Download as',
          icon: <Download size={16} />,
          submenu: EXPORT_FORMATS.map((f) => ({ label: f.label, onClick: () => doExport(f.id) })),
        },
        { divider: true },
        {
          label: 'Rename…',
          onClick: async () => {
            const t = await ui.prompt('Rename document', title, { ok: 'Rename' });
            if (t?.trim()) setTitle(t.trim());
          },
        },
        { label: starred ? 'Remove star' : 'Star document', onClick: () => setStarred(!starred) },
        {
          label: 'Version history',
          icon: <History size={16} />,
          submenu: [
            {
              label: 'Name current version…',
              onClick: async () => {
                const l = await ui.prompt('Name current version', '', { ok: 'Save' });
                if (l !== null) saveVersion(l.trim() || null);
              },
            },
            { label: 'See version history', onClick: () => setPanel('history') },
          ],
        },
        { divider: true },
        { label: 'Page setup…', onClick: () => setDialog('pageSetup') },
        { label: 'Print', shortcut: `${modKey}+P`, onClick: print },
        { divider: true },
        {
          label: 'Move to trash',
          danger: true,
          onClick: async () => {
            if (await ui.confirm('Move to trash?', `“${title}” will be moved to the trash. You can restore it later.`, { ok: 'Move to trash', danger: true })) {
              docRef.current = { ...docRef.current, trashed: true };
              await persist();
              onHome();
            }
          },
        },
      ],
    },
    {
      id: 'edit',
      label: 'Edit',
      items: () => [
        { label: 'Undo', shortcut: `${modKey}+Z`, disabled: !editor.can().undo(), onClick: () => c().undo().run() },
        { label: 'Redo', shortcut: `${modKey}+Shift+Z`, disabled: !editor.can().redo(), onClick: () => c().redo().run() },
        { divider: true },
        { label: 'Cut', shortcut: `${modKey}+X`, onClick: () => (editor.commands.focus(), document.execCommand('cut')) },
        { label: 'Copy', shortcut: `${modKey}+C`, onClick: () => (editor.commands.focus(), document.execCommand('copy')) },
        { label: 'Select all', shortcut: `${modKey}+A`, onClick: () => c().selectAll().run() },
        { divider: true },
        { label: 'Find', shortcut: `${modKey}+F`, onClick: () => setFind({ replace: false }) },
        { label: 'Find and replace', shortcut: `${modKey}+H`, onClick: () => setFind({ replace: true }) },
      ],
    },
    {
      id: 'view',
      label: 'View',
      items: () => [
        {
          label: 'Pages',
          checked: pageSetup.viewMode === 'pages',
          onClick: () => setPageSetup({ ...pageSetup, viewMode: 'pages' }),
        },
        {
          label: 'Pageless',
          checked: pageSetup.viewMode === 'pageless',
          onClick: () => setPageSetup({ ...pageSetup, viewMode: 'pageless' }),
        },
        { divider: true },
        { label: 'Show ruler', checked: showRuler, onClick: () => setShowRuler(!showRuler) },
        { label: 'Focus mode', checked: focusMode, onClick: () => setFocusMode(!focusMode) },
        {
          label: 'Zoom',
          submenu: [50, 75, 90, 100, 125, 150, 200].map((v) => ({ label: `${v}%`, checked: zoom === v, onClick: () => setZoom(v) })),
        },
        { divider: true },
        { label: 'Comments', checked: panel === 'comments', onClick: () => setPanel(panel === 'comments' ? null : 'comments') },
        { label: 'Version history', checked: panel === 'history', onClick: () => setPanel(panel === 'history' ? null : 'history') },
        { divider: true },
        {
          label: 'Theme',
          submenu: [
            { label: 'Light', checked: settings.theme === 'light', onClick: () => toggleTheme('light') },
            { label: 'Dark', checked: settings.theme === 'dark', onClick: () => toggleTheme('dark') },
            { label: 'System', checked: settings.theme === 'system', onClick: () => toggleTheme('system') },
          ],
        },
        {
          label: 'Full screen',
          icon: <Maximize2 size={16} />,
          onClick: () =>
            document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.().catch(() => {}),
        },
      ],
    },
    {
      id: 'insert',
      label: 'Insert',
      items: () => [
        { label: 'Image…', onClick: insertImage },
        {
          label: 'Table',
          submenu: [
            [2, 2],
            [3, 3],
            [4, 4],
            [3, 5],
            [6, 3],
          ].map(([r, col]) => ({ label: `${r} × ${col}`, onClick: () => c().insertTable({ rows: r, cols: col, withHeaderRow: true }).run() })),
        },
        { label: 'Link…', shortcut: `${modKey}+K`, onClick: editLink },
        { label: 'Comment', shortcut: `${modKey}+Alt+M`, onClick: addComment },
        { divider: true },
        { label: 'Checklist', onClick: () => c().toggleTaskList().run() },
        { label: 'Quote', onClick: () => c().toggleBlockquote().run() },
        { label: 'Code block', onClick: () => c().toggleCodeBlock().run() },
        { label: 'Horizontal line', onClick: () => c().setHorizontalRule().run() },
        { label: 'Page break', shortcut: `${modKey}+Enter`, onClick: () => c().setPageBreak().run() },
        { divider: true },
        {
          label: 'Date',
          onClick: () => c().insertContent(new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })).run(),
        },
        { label: 'Time', onClick: () => c().insertContent(new Date().toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })).run() },
        { label: 'Special characters…', onClick: () => setDialog('special') },
      ],
    },
    {
      id: 'format',
      label: 'Format',
      items: () => [
        {
          label: 'Text',
          submenu: [
            { label: 'Bold', shortcut: `${modKey}+B`, checked: editor.isActive('bold'), onClick: () => c().toggleBold().run() },
            { label: 'Italic', shortcut: `${modKey}+I`, checked: editor.isActive('italic'), onClick: () => c().toggleItalic().run() },
            { label: 'Underline', shortcut: `${modKey}+U`, checked: editor.isActive('underline'), onClick: () => c().toggleUnderline().run() },
            { label: 'Strikethrough', checked: editor.isActive('strike'), onClick: () => c().toggleStrike().run() },
            { label: 'Superscript', checked: editor.isActive('superscript'), onClick: () => c().toggleSuperscript().run() },
            { label: 'Subscript', checked: editor.isActive('subscript'), onClick: () => c().toggleSubscript().run() },
            { label: 'Inline code', checked: editor.isActive('code'), onClick: () => c().toggleCode().run() },
          ],
        },
        {
          label: 'Paragraph styles',
          submenu: [
            { label: 'Normal text', shortcut: `${modKey}+Alt+0`, onClick: () => c().setParagraph().run() },
            ...([1, 2, 3, 4] as const).map((l) => ({
              label: `Heading ${l}`,
              shortcut: `${modKey}+Alt+${l}`,
              checked: editor.isActive('heading', { level: l }),
              onClick: () => c().setHeading({ level: l }).run(),
            })),
          ],
        },
        {
          label: 'Align',
          submenu: (['left', 'center', 'right', 'justify'] as const).map((a) => ({
            label: a[0].toUpperCase() + a.slice(1),
            checked: editor.isActive({ textAlign: a }),
            onClick: () => c().setTextAlign(a).run(),
          })),
        },
        {
          label: 'Bullets & numbering',
          submenu: [
            { label: 'Bulleted list', checked: editor.isActive('bulletList'), onClick: () => c().toggleBulletList().run() },
            { label: 'Numbered list', checked: editor.isActive('orderedList'), onClick: () => c().toggleOrderedList().run() },
            { label: 'Checklist', checked: editor.isActive('taskList'), onClick: () => c().toggleTaskList().run() },
          ],
        },
        { divider: true },
        { label: 'Clear formatting', shortcut: `${modKey}+\\`, onClick: () => c().unsetAllMarks().unsetTextAlign().unsetLineHeight().run() },
      ],
    },
    {
      id: 'tools',
      label: 'Tools',
      items: () => [
        { label: 'Word count', onClick: () => setDialog('wordCount') },
        { label: 'Spelling check', checked: settings.spellcheck, onClick: () => updateSettings({ spellcheck: !settings.spellcheck }) },
        { label: 'Keyboard shortcuts', onClick: () => setDialog('shortcuts') },
        { divider: true },
        { label: 'Settings…', onClick: () => setDialog('settings') },
      ],
    },
  ];

  const openComments = comments.filter((x) => !x.resolved && x.text).length;

  return (
    <div className={`editor-screen${focusMode ? ' focus-mode' : ''}${fluid ? ' fluid' : ''}`}>
      <header className="ed-header">
        <button className="icon-btn" onClick={onHome} aria-label="Back to documents" title="Back to documents">
          <ArrowLeft size={20} />
        </button>
        <img className="ed-logo hide-mobile" src="./icon.svg" alt="" width={32} height={32} />
        <div className="ed-titles">
          <div className="ed-title-row">
            <input
              className="ed-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && editor.commands.focus()}
              onBlur={() => !title.trim() && setTitle('Untitled document')}
              aria-label="Document title"
              size={Math.max(8, Math.min(40, title.length + 1))}
            />
            <button
              className={`icon-btn sm${starred ? ' starred' : ''}`}
              onClick={() => setStarred(!starred)}
              aria-label={starred ? 'Unstar' : 'Star'}
              title={starred ? 'Starred' : 'Star'}
            >
              <Star size={16} />
            </button>
            <span className="save-status" aria-live="polite">
              {status === 'saved' ? (
                <>
                  <Check size={14} /> Saved
                </>
              ) : (
                <>
                  <Loader2 size={14} className="spin" /> Saving…
                </>
              )}
            </span>
          </div>
          <nav className="menubar hide-mobile" aria-label="Menu">
            {menus.map((mn) => (
              <Menu
                key={mn.id}
                id={mn.id}
                menubarGroup={menubar}
                items={mn.items}
                trigger={({ open, toggle }) => (
                  <button className={`menubar-btn${open ? ' open' : ''}`} onClick={toggle}>
                    {mn.label}
                  </button>
                )}
              />
            ))}
          </nav>
        </div>
        <div className="ed-actions">
          <button
            className={`icon-btn with-badge${panel === 'comments' ? ' active' : ''}`}
            onClick={() => setPanel(panel === 'comments' ? null : 'comments')}
            aria-label="Comments"
            title="Comments"
          >
            <MessageSquare size={20} />
            {openComments > 0 && <span className="badge">{openComments}</span>}
          </button>
          <button
            className={`icon-btn hide-mobile${panel === 'history' ? ' active' : ''}`}
            onClick={() => setPanel(panel === 'history' ? null : 'history')}
            aria-label="Version history"
            title="Version history"
          >
            <History size={20} />
          </button>
          <Menu
            align="right"
            trigger={({ toggle }) => (
              <button className="btn btn-primary btn-export" onClick={toggle}>
                <Download size={16} />
                <span className="hide-mobile">Export</span>
                <ChevronDown size={14} className="hide-mobile" />
              </button>
            )}
            items={EXPORT_FORMATS.map((f) => ({ label: f.label, onClick: () => doExport(f.id) }))}
          />
          <Menu
            align="right"
            className="only-mobile"
            trigger={({ toggle }) => (
              <button className="icon-btn" onClick={toggle} aria-label="More">
                <MoreVertical size={20} />
              </button>
            )}
            items={() => menus.map((mn) => ({ label: mn.label, submenu: mn.items() }))}
          />
        </div>
      </header>

      {preview ? (
        <div className="preview-banner">
          <span>
            Viewing version from <strong>{new Date(preview.createdAt).toLocaleString()}</strong>
            {preview.label ? ` — ${preview.label}` : ''}
          </span>
          <div className="row gap-sm">
            <button className="btn btn-sm" onClick={() => showPreview(null)}>
              Back to current
            </button>
            <button className="btn btn-sm btn-primary" onClick={restoreVersion}>
              Restore this version
            </button>
          </div>
        </div>
      ) : (
        <Toolbar
          editor={editor}
          actions={{ print, insertImage, editLink, addComment, zoom, setZoom }}
        />
      )}

      <div className="ed-body">
        <div className="canvas" onMouseDown={(e) => {
          // Clicking the grey area focuses the end of the document, like a word processor
          if (e.target === e.currentTarget) {
            e.preventDefault();
            editor.commands.focus('end');
          }
        }}>
          {find && <FindBar editor={editor} showReplace={find.replace} onClose={() => setFind(null)} />}
          {!fluid && showRuler && !focusMode && (
            <div className="ruler-wrap" style={{ width: pageW * DPI * z }}>
              <div style={{ transform: `scale(${z})`, transformOrigin: 'top left' }}>
                <Ruler widthIn={pageW} setup={pageSetup} onChange={(margins) => setPageSetup({ ...pageSetup, margins })} />
              </div>
            </div>
          )}
          <div
            className="page-zoom"
            style={fluid ? undefined : { width: pageW * DPI * z, height: paperPx * z }}
          >
            <div
              ref={pageRef}
              className={`page${fluid ? ' page-fluid' : ''}`}
              style={
                fluid
                  ? undefined
                  : {
                      width: pageW * DPI,
                      minHeight: pages * contentH + (m.top + m.bottom) * DPI,
                      padding: `${m.top * DPI}px ${m.right * DPI}px ${m.bottom * DPI}px ${m.left * DPI}px`,
                      transform: z === 1 ? undefined : `scale(${z})`,
                    }
              }
            >
              {!fluid &&
                Array.from({ length: pages - 1 }, (_, i) => (
                  <div key={i} className="page-boundary" style={{ top: m.top * DPI + (i + 1) * contentH }} aria-hidden>
                    <span>Page {i + 2}</span>
                  </div>
                ))}
              <EditorContent editor={editor} />
            </div>
          </div>
          <StatusBar editor={editor} pages={fluid ? null : pages} onWordCount={() => setDialog('wordCount')} zoom={zoom} setZoom={fluid ? null : setZoom} />
        </div>

        {panel === 'comments' && (
          <CommentsPanel
            editor={editor}
            comments={comments}
            setComments={setComments}
            activeId={activeComment}
            setActiveId={setActiveComment}
            author={settings.authorName || 'Me'}
            onClose={() => setPanel(null)}
          />
        )}
        {panel === 'history' && (
          <HistoryPanel
            docId={initial.id}
            previewId={preview?.id ?? null}
            onPreview={showPreview}
            refreshKey={historyKey}
            onClose={() => {
              showPreview(null);
              setPanel(null);
            }}
          />
        )}
      </div>

      {!preview && <TableBubble editor={editor} />}
      {!preview && <LinkBubble editor={editor} onEdit={editLink} />}

      {dialog === 'pageSetup' && <PageSetupDialog value={pageSetup} onSave={setPageSetup} onClose={() => setDialog(null)} />}
      {dialog === 'wordCount' && <WordCountDialog editor={editor} onClose={() => setDialog(null)} />}
      {dialog === 'shortcuts' && <ShortcutsDialog mod={modKey} onClose={() => setDialog(null)} />}
      {dialog === 'special' && (
        <SpecialCharsDialog
          onPick={(ch) => editor.chain().focus().insertContent(ch).run()}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'settings' && <SettingsDialog settings={settings} update={updateSettings} onClose={() => setDialog(null)} />}
      {busy && (
        <div className="busy-overlay">
          <Loader2 size={28} className="spin" />
          <span>{busy}</span>
        </div>
      )}
    </div>
  );
}

function StatusBar({
  editor,
  pages,
  onWordCount,
  zoom,
  setZoom,
}: {
  editor: Editor;
  pages: number | null;
  onWordCount: () => void;
  zoom: number;
  setZoom: ((z: number) => void) | null;
}) {
  useEditorTick(editor);
  const words = editor.storage.characterCount.words();
  const chars = editor.storage.characterCount.characters();
  return (
    <div className="status-bar">
      {pages !== null && <span>{pages === 1 ? '1 page' : `${pages} pages`}</span>}
      <button className="link-btn" onClick={onWordCount} title="Word count">
        {words.toLocaleString()} {words === 1 ? 'word' : 'words'}
      </button>
      <span className="hide-mobile">{chars.toLocaleString()} characters</span>
      {setZoom && (
        <label className="zoom-slider hide-mobile">
          <input type="range" min={50} max={200} step={5} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} aria-label="Zoom" />
          <span>{zoom}%</span>
        </label>
      )}
    </div>
  );
}
