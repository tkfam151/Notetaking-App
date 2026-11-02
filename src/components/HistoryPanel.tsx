import { useEffect, useState } from 'react';
import { Clock, Pencil, X } from 'lucide-react';
import { listVersions, renameVersion } from '../lib/db';
import type { DocVersion } from '../types';
import { useUI } from './ui';

function fmt(ts: number) {
  return new Date(ts).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function HistoryPanel({
  docId,
  previewId,
  onPreview,
  onClose,
  refreshKey,
}: {
  docId: string;
  previewId: string | null;
  onPreview: (v: DocVersion | null) => void;
  onClose: () => void;
  refreshKey: number;
}) {
  const ui = useUI();
  const [versions, setVersions] = useState<DocVersion[] | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    listVersions(docId).then(setVersions);
  }, [docId, refreshKey, tick]);

  return (
    <aside className="side-panel history-panel" aria-label="Version history">
      <div className="panel-head">
        <h2>Version history</h2>
        <button className="icon-btn sm" onClick={onClose} aria-label="Close version history">
          <X size={18} />
        </button>
      </div>
      <p className="muted small pad">
        Inkwell saves a snapshot automatically as you work. Press {navigator.platform.includes('Mac') ? '⌘' : 'Ctrl'}+S
        to save one now.
      </p>
      <div className="panel-scroll">
        <button className={`version-row${previewId === null ? ' active' : ''}`} onClick={() => onPreview(null)}>
          <strong>Current version</strong>
          <span className="muted small">Editing now</span>
        </button>
        {versions?.length === 0 && (
          <div className="empty small">
            <Clock size={28} />
            <p>No earlier versions yet.</p>
          </div>
        )}
        {versions?.map((v) => (
          <div key={v.id} className={`version-row${previewId === v.id ? ' active' : ''}`}>
            <button className="version-main" onClick={() => onPreview(v)}>
              <strong>{v.label || fmt(v.createdAt)}</strong>
              <span className="muted small">
                {v.label ? `${fmt(v.createdAt)} · ` : ''}
                {v.wordCount.toLocaleString()} words
              </span>
            </button>
            <button
              className="icon-btn sm"
              title="Name this version"
              aria-label="Name this version"
              onClick={async () => {
                const name = await ui.prompt('Name this version', v.label ?? '', { ok: 'Save' });
                if (name !== null) {
                  await renameVersion(v.id, name.trim() || null);
                  setTick((t) => t + 1);
                }
              }}
            >
              <Pencil size={14} />
            </button>
          </div>
        ))}
      </div>
    </aside>
  );
}
