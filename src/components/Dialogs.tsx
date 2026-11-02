import { useState } from 'react';
import type { Editor } from '@tiptap/react';
import { PAGE_DIMENSIONS, type PageSetup, type PageSize } from '../types';
import { Modal } from './ui';

export function PageSetupDialog({
  value,
  onSave,
  onClose,
}: {
  value: PageSetup;
  onSave: (p: PageSetup) => void;
  onClose: () => void;
}) {
  const [p, setP] = useState<PageSetup>(structuredClone(value));
  const margin = (k: keyof PageSetup['margins'], label: string) => (
    <label className="field">
      <span>{label} (in)</span>
      <input
        type="number"
        min={0}
        max={4}
        step={0.1}
        value={p.margins[k]}
        onChange={(e) => setP({ ...p, margins: { ...p.margins, [k]: Math.max(0, Math.min(4, Number(e.target.value))) } })}
      />
    </label>
  );
  return (
    <Modal
      title="Page setup"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={() => {
              onSave(p);
              onClose();
            }}
          >
            OK
          </button>
        </>
      }
    >
      <div className="form-grid">
        <label className="field span2">
          <span>Layout</span>
          <div className="segmented">
            <button className={p.viewMode === 'pages' ? 'active' : ''} onClick={() => setP({ ...p, viewMode: 'pages' })}>
              Pages
            </button>
            <button className={p.viewMode === 'pageless' ? 'active' : ''} onClick={() => setP({ ...p, viewMode: 'pageless' })}>
              Pageless
            </button>
          </div>
        </label>
        <label className="field">
          <span>Paper size</span>
          <select value={p.size} onChange={(e) => setP({ ...p, size: e.target.value as PageSize })}>
            {Object.entries(PAGE_DIMENSIONS).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Orientation</span>
          <select value={p.orientation} onChange={(e) => setP({ ...p, orientation: e.target.value as PageSetup['orientation'] })}>
            <option value="portrait">Portrait</option>
            <option value="landscape">Landscape</option>
          </select>
        </label>
        {margin('top', 'Top')}
        {margin('bottom', 'Bottom')}
        {margin('left', 'Left')}
        {margin('right', 'Right')}
      </div>
    </Modal>
  );
}

export function WordCountDialog({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const text = editor.getText();
  const { from, to } = editor.state.selection;
  const selText = from !== to ? editor.state.doc.textBetween(from, to, ' ') : '';
  const words = editor.storage.characterCount.words();
  const chars = editor.storage.characterCount.characters();
  const noSpaces = text.replace(/\s/g, '').length;
  const paragraphs = editor.getJSON().content?.filter((n) => n.type === 'paragraph' && n.content?.length).length ?? 0;
  const minutes = Math.max(1, Math.round(words / 230));
  const rows: [string, string | number][] = [
    ['Words', words],
    ['Characters', chars],
    ['Characters (no spaces)', noSpaces],
    ['Paragraphs', paragraphs],
    ['Reading time', `${minutes} min`],
  ];
  if (selText) rows.unshift(['Selected words', selText.split(/\s+/).filter(Boolean).length]);
  return (
    <Modal title="Word count" onClose={onClose} width={360}>
      <table className="stats-table">
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k}>
              <td>{k}</td>
              <td>{typeof v === 'number' ? v.toLocaleString() : v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Modal>
  );
}

const SHORTCUTS: [string, string][] = [
  ['Bold / Italic / Underline', 'Mod+B / Mod+I / Mod+U'],
  ['Strikethrough', 'Mod+Shift+S'],
  ['Heading 1–4', 'Mod+Alt+1…4'],
  ['Normal text', 'Mod+Alt+0'],
  ['Bulleted / Numbered list', 'Mod+Shift+8 / Mod+Shift+7'],
  ['Checklist', 'Mod+Shift+9'],
  ['Align left / center / right / justify', 'Mod+Shift+L / E / R / J'],
  ['Insert link', 'Mod+K'],
  ['Add comment', 'Mod+Alt+M'],
  ['Page break', 'Mod+Enter'],
  ['Find / Find & replace', 'Mod+F / Mod+H'],
  ['Save a version', 'Mod+S'],
  ['Print', 'Mod+P'],
  ['Clear formatting', 'Mod+\\'],
  ['Undo / Redo', 'Mod+Z / Mod+Shift+Z'],
  ['Markdown shortcuts', '# Heading, - list, 1. list, [ ] checklist, > quote, ``` code'],
];

export function ShortcutsDialog({ onClose, mod }: { onClose: () => void; mod: string }) {
  return (
    <Modal title="Keyboard shortcuts" onClose={onClose} width={560}>
      <table className="stats-table">
        <tbody>
          {SHORTCUTS.map(([k, v]) => (
            <tr key={k}>
              <td>{k}</td>
              <td>
                <kbd>{v.replace(/Mod/g, mod)}</kbd>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Modal>
  );
}

const SPECIAL = '© ® ™ § ¶ † ‡ • … – — ‘ ’ “ ” « » ° ± × ÷ ≈ ≠ ≤ ≥ ∞ √ π Σ µ € £ ¥ ¢ → ← ↑ ↓ ↔ ⇒ ✓ ✗ ★ ☆ ♥ ☐ ☑ ½ ¼ ¾ ¹ ² ³ α β γ δ θ λ'.split(' ');

export function SpecialCharsDialog({ onPick, onClose }: { onPick: (c: string) => void; onClose: () => void }) {
  return (
    <Modal title="Special characters" onClose={onClose} width={420}>
      <div className="char-grid">
        {SPECIAL.map((ch) => (
          <button key={ch} className="char-btn" onClick={() => onPick(ch)} title={`Insert ${ch}`}>
            {ch}
          </button>
        ))}
      </div>
    </Modal>
  );
}
