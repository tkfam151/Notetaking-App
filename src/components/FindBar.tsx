import { useEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { ChevronDown, ChevronUp, X } from 'lucide-react';
import { searchKey } from '../editor/SearchReplace';
import { useEditorTick } from './Toolbar';

export function FindBar({
  editor,
  showReplace,
  onClose,
}: {
  editor: Editor;
  showReplace: boolean;
  onClose: () => void;
}) {
  useEditorTick(editor);
  const [term, setTerm] = useState(() => {
    const { from, to } = editor.state.selection;
    return from !== to ? editor.state.doc.textBetween(from, to, ' ').slice(0, 100) : '';
  });
  const [replace, setReplace] = useState('');
  const [replaceOpen, setReplaceOpen] = useState(showReplace);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => setReplaceOpen((v) => v || showReplace), [showReplace]);
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [showReplace]);
  useEffect(() => {
    editor.commands.setSearch({ term, caseSensitive, wholeWord });
  }, [editor, term, caseSensitive, wholeWord]);
  useEffect(() => () => void editor.commands.clearSearch(), [editor]);

  const s = searchKey.getState(editor.state);
  const count = s?.results.length ?? 0;
  const idx = count ? (s?.index ?? 0) + 1 : 0;

  return (
    <div className="find-bar" role="search">
      <div className="find-row">
        <input
          ref={inputRef}
          placeholder="Find in document"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              if (e.shiftKey) editor.commands.prevMatch();
              else editor.commands.nextMatch();
            }
            if (e.key === 'Escape') onClose();
          }}
          aria-label="Find"
        />
        <span className="find-count">{term ? `${idx} of ${count}` : ''}</span>
        <button className="icon-btn sm" onClick={() => editor.commands.prevMatch()} disabled={!count} aria-label="Previous match">
          <ChevronUp size={16} />
        </button>
        <button className="icon-btn sm" onClick={() => editor.commands.nextMatch()} disabled={!count} aria-label="Next match">
          <ChevronDown size={16} />
        </button>
        <button className="icon-btn sm" onClick={onClose} aria-label="Close find">
          <X size={16} />
        </button>
      </div>
      <div className="find-options">
        <label className="checkbox small">
          <input type="checkbox" checked={caseSensitive} onChange={(e) => setCaseSensitive(e.target.checked)} />
          Match case
        </label>
        <label className="checkbox small">
          <input type="checkbox" checked={wholeWord} onChange={(e) => setWholeWord(e.target.checked)} />
          Whole words
        </label>
        <button className="link-btn small" onClick={() => setReplaceOpen(!replaceOpen)}>
          {replaceOpen ? 'Hide replace' : 'Replace…'}
        </button>
      </div>
      {replaceOpen && (
        <div className="find-row">
          <input
            placeholder="Replace with"
            value={replace}
            onChange={(e) => setReplace(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                editor.commands.replaceCurrent(replace);
              }
              if (e.key === 'Escape') onClose();
            }}
            aria-label="Replace with"
          />
          <button className="btn btn-sm" disabled={!count} onClick={() => editor.commands.replaceCurrent(replace)}>
            Replace
          </button>
          <button className="btn btn-sm" disabled={!count} onClick={() => editor.commands.replaceAll(replace)}>
            All
          </button>
        </div>
      )}
    </div>
  );
}
