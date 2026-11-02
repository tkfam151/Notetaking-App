import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Clock,
  Copy,
  FileText,
  Folder as FolderIcon,
  FolderInput,
  FolderPlus,
  Grid2x2,
  LayoutList,
  Menu as MenuIcon,
  MoreVertical,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Settings as SettingsIcon,
  Star,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import {
  deleteDocForever,
  deleteFolder,
  duplicateDoc,
  listDocs,
  listFolders,
  saveDoc,
  saveFolder,
  uid,
} from '../lib/db';
import { getTemplates, type Template } from '../lib/templates';
import { createFromTemplate, importAsNewDoc } from '../lib/actions';
import { IMPORT_ACCEPT } from '../lib/io';
import { pickFile } from '../lib/platform';
import type { Folder, InkDoc, Settings } from '../types';
import { Menu, relativeTime, useUI, type MenuItem } from './ui';
import { SettingsDialog } from './SettingsDialog';

type Section = { kind: 'recent' } | { kind: 'starred' } | { kind: 'trash' } | { kind: 'folder'; id: string };

export function Library({
  settings,
  updateSettings,
  onOpen,
}: {
  settings: Settings;
  updateSettings: (p: Partial<Settings>) => void;
  onOpen: (id: string) => void;
}) {
  const ui = useUI();
  const [docs, setDocs] = useState<InkDoc[] | null>(null);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [section, setSection] = useState<Section>({ kind: 'recent' });
  const [query, setQuery] = useState('');
  const [layout, setLayout] = useState<'grid' | 'list'>(
    () => (localStorageGet('inkwell.layout') as 'grid' | 'list') || 'grid',
  );
  const [sort, setSort] = useState<'updated' | 'title' | 'created'>('updated');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const templates = useMemo(getTemplates, []);

  const refresh = useCallback(async () => {
    const [d, f] = await Promise.all([listDocs(), listFolders()]);
    setDocs(d);
    setFolders(f);
  }, []);

  useEffect(() => {
    refresh();
    document.title = 'Inkwell';
  }, [refresh]);

  useEffect(() => {
    try {
      localStorage.setItem('inkwell.layout', layout);
    } catch {
      /* storage unavailable */
    }
  }, [layout]);

  const folderId = section.kind === 'folder' ? section.id : null;

  const visible = useMemo(() => {
    if (!docs) return [];
    const q = query.trim().toLowerCase();
    let list = docs.filter((d) => {
      if (section.kind === 'trash') return d.trashed;
      if (d.trashed) return false;
      if (section.kind === 'starred') return d.starred;
      if (section.kind === 'folder') return d.folderId === section.id;
      return true;
    });
    if (q) list = list.filter((d) => d.title.toLowerCase().includes(q) || d.preview.toLowerCase().includes(q));
    const sorted = [...list];
    if (sort === 'title') sorted.sort((a, b) => a.title.localeCompare(b.title));
    else if (sort === 'created') sorted.sort((a, b) => b.createdAt - a.createdAt);
    else sorted.sort((a, b) => b.updatedAt - a.updatedAt);
    return sorted;
  }, [docs, section, query, sort]);

  const create = async (t: Template | null) => {
    const doc = await createFromTemplate(t, folderId);
    onOpen(doc.id);
  };

  const doImport = async (file?: File | null) => {
    const f = file ?? (await pickFile(IMPORT_ACCEPT));
    if (!f) return;
    try {
      const doc = await importAsNewDoc(f, folderId);
      ui.toast(`Imported “${doc.title}”`);
      onOpen(doc.id);
    } catch (e) {
      ui.toast(e instanceof Error && e.message ? e.message : 'Could not import that file');
    }
  };

  const update = async (doc: InkDoc, patch: Partial<InkDoc>) => {
    await saveDoc({ ...doc, ...patch });
    refresh();
  };

  const docMenu = (doc: InkDoc): MenuItem[] =>
    doc.trashed
      ? [
          { label: 'Restore', icon: <RotateCcw size={16} />, onClick: () => update(doc, { trashed: false }) },
          {
            label: 'Delete forever',
            icon: <Trash2 size={16} />,
            danger: true,
            onClick: async () => {
              if (await ui.confirm('Delete forever?', `“${doc.title}” will be permanently deleted.`, { ok: 'Delete', danger: true })) {
                await deleteDocForever(doc.id);
                refresh();
              }
            },
          },
        ]
      : [
          { label: 'Open', icon: <FileText size={16} />, onClick: () => onOpen(doc.id) },
          {
            label: 'Rename',
            icon: <Pencil size={16} />,
            onClick: async () => {
              const t = await ui.prompt('Rename document', doc.title, { ok: 'Rename' });
              if (t?.trim()) update(doc, { title: t.trim() });
            },
          },
          {
            label: doc.starred ? 'Remove from starred' : 'Add to starred',
            icon: <Star size={16} />,
            onClick: () => update(doc, { starred: !doc.starred }),
          },
          {
            label: 'Make a copy',
            icon: <Copy size={16} />,
            onClick: async () => {
              await duplicateDoc(doc.id);
              refresh();
            },
          },
          {
            label: 'Move to folder',
            icon: <FolderInput size={16} />,
            submenu: [
              { label: 'No folder', checked: !doc.folderId, onClick: () => update(doc, { folderId: null }) },
              ...folders.map((f) => ({
                label: f.name,
                checked: doc.folderId === f.id,
                onClick: () => update(doc, { folderId: f.id }),
              })),
            ],
          },
          { divider: true },
          {
            label: 'Move to trash',
            icon: <Trash2 size={16} />,
            danger: true,
            onClick: () => {
              update(doc, { trashed: true });
              ui.toast('Moved to trash');
            },
          },
        ];

  const newFolder = async () => {
    const name = await ui.prompt('New folder', 'Untitled folder', { ok: 'Create' });
    if (!name?.trim()) return;
    const f = { id: uid(), name: name.trim(), createdAt: Date.now() };
    await saveFolder(f);
    await refresh();
    setSection({ kind: 'folder', id: f.id });
  };

  const sectionTitle =
    section.kind === 'recent'
      ? 'All documents'
      : section.kind === 'starred'
        ? 'Starred'
        : section.kind === 'trash'
          ? 'Trash'
          : folders.find((f) => f.id === section.id)?.name ?? 'Folder';

  const navItem = (s: Section, label: string, icon: React.ReactNode, count?: number) => {
    const active = s.kind === section.kind && (s.kind !== 'folder' || (section.kind === 'folder' && section.id === s.id));
    return (
      <button
        className={`nav-item${active ? ' active' : ''}`}
        onClick={() => {
          setSection(s);
          setSidebarOpen(false);
        }}
      >
        {icon}
        <span>{label}</span>
        {count !== undefined && count > 0 && <span className="nav-count">{count}</span>}
      </button>
    );
  };

  return (
    <div
      className={`library${dragOver ? ' drag-over' : ''}`}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          setDragOver(true);
        }
      }}
      onDragLeave={(e) => e.currentTarget === e.target && setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const f = e.dataTransfer.files?.[0];
        if (f) doImport(f);
      }}
    >
      <header className="lib-header">
        <button className="icon-btn only-mobile" onClick={() => setSidebarOpen(true)} aria-label="Open navigation">
          <MenuIcon size={20} />
        </button>
        <div className="brand">
          <img src="./icon.svg" alt="" width={30} height={30} />
          <span>Inkwell</span>
        </div>
        <div className="search">
          <Search size={18} />
          <input
            placeholder="Search documents"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search documents"
          />
          {query && (
            <button className="icon-btn sm" onClick={() => setQuery('')} aria-label="Clear search">
              <X size={16} />
            </button>
          )}
        </div>
        <button className="icon-btn" onClick={() => setShowSettings(true)} aria-label="Settings" title="Settings">
          <SettingsIcon size={20} />
        </button>
      </header>

      <div className="lib-body">
        {sidebarOpen && <div className="scrim only-mobile" onClick={() => setSidebarOpen(false)} />}
        <aside className={`lib-sidebar${sidebarOpen ? ' open' : ''}`}>
          <button className="btn btn-primary btn-new" onClick={() => create(null)}>
            <Plus size={18} /> New document
          </button>
          <button className="btn btn-new-secondary" onClick={() => doImport()}>
            <Upload size={16} /> Import file
          </button>
          <nav>
            {navItem({ kind: 'recent' }, 'All documents', <Clock size={18} />)}
            {navItem({ kind: 'starred' }, 'Starred', <Star size={18} />)}
            {navItem({ kind: 'trash' }, 'Trash', <Trash2 size={18} />, docs?.filter((d) => d.trashed).length)}
          </nav>
          <div className="nav-heading">
            <span>Folders</span>
            <button className="icon-btn sm" onClick={newFolder} aria-label="New folder" title="New folder">
              <FolderPlus size={16} />
            </button>
          </div>
          <nav>
            {folders.length === 0 && <p className="muted small pad">No folders yet</p>}
            {folders.map((f) => (
              <div key={f.id} className="nav-folder">
                {navItem(
                  { kind: 'folder', id: f.id },
                  f.name,
                  <FolderIcon size={18} />,
                  docs?.filter((d) => !d.trashed && d.folderId === f.id).length,
                )}
                <Menu
                  align="right"
                  trigger={({ toggle }) => (
                    <button className="icon-btn sm folder-more" onClick={toggle} aria-label={`${f.name} options`}>
                      <MoreVertical size={14} />
                    </button>
                  )}
                  items={[
                    {
                      label: 'Rename folder',
                      icon: <Pencil size={16} />,
                      onClick: async () => {
                        const n = await ui.prompt('Rename folder', f.name, { ok: 'Rename' });
                        if (n?.trim()) {
                          await saveFolder({ ...f, name: n.trim() });
                          refresh();
                        }
                      },
                    },
                    {
                      label: 'Delete folder',
                      icon: <Trash2 size={16} />,
                      danger: true,
                      onClick: async () => {
                        if (await ui.confirm('Delete folder?', 'Documents inside will be kept and moved out of the folder.', { ok: 'Delete', danger: true })) {
                          await deleteFolder(f.id);
                          if (section.kind === 'folder' && section.id === f.id) setSection({ kind: 'recent' });
                          refresh();
                        }
                      },
                    },
                  ]}
                />
              </div>
            ))}
          </nav>
        </aside>

        <main className="lib-main">
          {section.kind !== 'trash' && !query && (
            <section className="templates">
              <div className="section-head">
                <h2>Start a new document</h2>
              </div>
              <div className="template-strip">
                {templates.map((t) => (
                  <button key={t.id} className="template-card" onClick={() => create(t)}>
                    <TemplateThumb t={t} />
                    <span className="template-name">{t.name}</span>
                    <span className="template-cat">{t.category}</span>
                  </button>
                ))}
              </div>
            </section>
          )}

          <section className="docs">
            <div className="section-head">
              <h2>{query ? `Results for “${query}”` : sectionTitle}</h2>
              <div className="row gap-sm">
                <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} aria-label="Sort by">
                  <option value="updated">Last modified</option>
                  <option value="created">Date created</option>
                  <option value="title">Title</option>
                </select>
                <button
                  className="icon-btn"
                  onClick={() => setLayout(layout === 'grid' ? 'list' : 'grid')}
                  aria-label={layout === 'grid' ? 'Show as list' : 'Show as grid'}
                  title={layout === 'grid' ? 'List view' : 'Grid view'}
                >
                  {layout === 'grid' ? <LayoutList size={18} /> : <Grid2x2 size={18} />}
                </button>
                {section.kind === 'trash' && visible.length > 0 && (
                  <button
                    className="btn btn-sm"
                    onClick={async () => {
                      if (await ui.confirm('Empty trash?', 'All documents in the trash will be permanently deleted.', { ok: 'Empty trash', danger: true })) {
                        for (const d of visible) await deleteDocForever(d.id);
                        refresh();
                      }
                    }}
                  >
                    Empty trash
                  </button>
                )}
              </div>
            </div>

            {docs && visible.length === 0 && (
              <div className="empty">
                <FileText size={40} />
                <p>
                  {query
                    ? 'No documents match your search.'
                    : section.kind === 'trash'
                      ? 'Trash is empty.'
                      : section.kind === 'starred'
                        ? 'Star documents to find them quickly here.'
                        : 'No documents yet. Pick a template above, or drop a Word, Markdown or text file here to import it.'}
                </p>
              </div>
            )}

            <div className={layout === 'grid' ? 'doc-grid' : 'doc-list'}>
              {visible.map((doc) => (
                <div
                  key={doc.id}
                  className="doc-card"
                  role="button"
                  tabIndex={0}
                  onClick={() => !doc.trashed && onOpen(doc.id)}
                  onKeyDown={(e) => e.key === 'Enter' && !doc.trashed && onOpen(doc.id)}
                >
                  {layout === 'grid' && (
                    <div className="doc-thumb">
                      <p>{doc.preview || <span className="muted">Empty document</span>}</p>
                    </div>
                  )}
                  <div className="doc-meta">
                    <FileText size={18} className="doc-icon" />
                    <div className="doc-text">
                      <span className="doc-title">{doc.title}</span>
                      <span className="doc-date">
                        {doc.starred && <Star size={12} className="star-fill" />} Edited {relativeTime(doc.updatedAt)}
                        {layout === 'list' && doc.wordCount > 0 && ` · ${doc.wordCount.toLocaleString()} words`}
                      </span>
                    </div>
                    <div onClick={(e) => e.stopPropagation()}>
                      <Menu
                        align="right"
                        trigger={({ toggle }) => (
                          <button className="icon-btn sm" onClick={toggle} aria-label={`More options for ${doc.title}`}>
                            <MoreVertical size={16} />
                          </button>
                        )}
                        items={() => docMenu(doc)}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </main>
      </div>

      <button className="fab only-mobile" onClick={() => create(null)} aria-label="New document">
        <Plus size={26} />
      </button>

      {showSettings && (
        <SettingsDialog
          settings={settings}
          update={updateSettings}
          onClose={() => setShowSettings(false)}
          onDataChanged={refresh}
        />
      )}
    </div>
  );
}

function TemplateThumb({ t }: { t: Template }) {
  if (t.id === 'blank')
    return (
      <div className="template-thumb blank">
        <Plus size={36} />
      </div>
    );
  return (
    <div className="template-thumb">
      <div className="tt-bar" style={{ background: t.accent }} />
      <div className="tt-title" style={{ color: t.accent }}>
        {t.name}
      </div>
      <div className="tt-line w90" />
      <div className="tt-line w70" />
      <div className="tt-line w80" />
      <div className="tt-line w50" />
      <div className="tt-line w90" />
      <div className="tt-line w60" />
    </div>
  );
}

function localStorageGet(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
