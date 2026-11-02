import { useEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { Check, MessageSquare, RotateCcw, Trash2, X } from 'lucide-react';
import type { DocComment } from '../types';
import { relativeTime } from './ui';
import { uid } from '../lib/db';

interface Props {
  editor: Editor;
  comments: DocComment[];
  setComments: (c: DocComment[]) => void;
  activeId: string | null;
  setActiveId: (id: string | null) => void;
  author: string;
  onClose: () => void;
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase() || '?';
}

/** Scrolls the editor to the text a comment is attached to and selects it. */
export function focusCommentInEditor(editor: Editor, id: string) {
  let found: { from: number; to: number } | null = null;
  editor.state.doc.descendants((node, pos) => {
    if (found && pos > found.to) return false;
    if (node.isText && node.marks.some((m) => m.type.name === 'comment' && m.attrs.commentId === id)) {
      if (!found) found = { from: pos, to: pos + node.nodeSize };
      else found.to = pos + node.nodeSize;
    }
    return true;
  });
  if (found) {
    const { from } = found as { from: number; to: number };
    editor.chain().setTextSelection(from).scrollIntoView().run();
  }
}

export function CommentsPanel({ editor, comments, setComments, activeId, setActiveId, author, onClose }: Props) {
  const [showResolved, setShowResolved] = useState(false);
  const open = comments.filter((c) => !c.resolved);
  const resolved = comments.filter((c) => c.resolved);
  const list = showResolved ? resolved : open;

  const update = (id: string, patch: Partial<DocComment>) =>
    setComments(comments.map((c) => (c.id === id ? { ...c, ...patch } : c)));

  const remove = (id: string) => {
    editor.commands.unsetComment(id);
    setComments(comments.filter((c) => c.id !== id));
    if (activeId === id) setActiveId(null);
  };

  return (
    <aside className="side-panel comments-panel" aria-label="Comments">
      <div className="panel-head">
        <h2>Comments</h2>
        <button className="icon-btn sm" onClick={onClose} aria-label="Close comments">
          <X size={18} />
        </button>
      </div>
      <div className="segmented small-seg">
        <button className={!showResolved ? 'active' : ''} onClick={() => setShowResolved(false)}>
          Open ({open.length})
        </button>
        <button className={showResolved ? 'active' : ''} onClick={() => setShowResolved(true)}>
          Resolved ({resolved.length})
        </button>
      </div>
      <div className="panel-scroll">
        {list.length === 0 && (
          <div className="empty small">
            <MessageSquare size={28} />
            <p>
              {showResolved
                ? 'No resolved comments.'
                : 'Select some text and click the comment button to start a discussion.'}
            </p>
          </div>
        )}
        {list.map((c) => (
          <CommentCard
            key={c.id}
            c={c}
            active={c.id === activeId}
            author={author}
            onActivate={() => {
              setActiveId(c.id);
              if (!c.resolved) focusCommentInEditor(editor, c.id);
            }}
            onSave={(text) => update(c.id, { text })}
            onCancelNew={() => remove(c.id)}
            onReply={(text) =>
              update(c.id, { replies: [...c.replies, { id: uid(), author, text, createdAt: Date.now() }] })
            }
            onResolve={() => {
              editor.commands.unsetComment(c.id);
              update(c.id, { resolved: true });
            }}
            onReopen={() => update(c.id, { resolved: false })}
            onDelete={() => remove(c.id)}
          />
        ))}
      </div>
    </aside>
  );
}

function CommentCard({
  c,
  active,
  author,
  onActivate,
  onSave,
  onCancelNew,
  onReply,
  onResolve,
  onReopen,
  onDelete,
}: {
  c: DocComment;
  active: boolean;
  author: string;
  onActivate: () => void;
  onSave: (t: string) => void;
  onCancelNew: () => void;
  onReply: (t: string) => void;
  onResolve: () => void;
  onReopen: () => void;
  onDelete: () => void;
}) {
  const isDraft = !c.text;
  const [draft, setDraft] = useState('');
  const [reply, setReply] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [active]);

  return (
    <div ref={ref} className={`comment-card${active ? ' active' : ''}`} onClick={onActivate}>
      {c.quote && <blockquote className="comment-quote">{c.quote}</blockquote>}
      <div className="comment-head">
        <span className="avatar">{initials(c.author)}</span>
        <div className="comment-who">
          <strong>{c.author}</strong>
          <span className="muted small">{relativeTime(c.createdAt)}</span>
        </div>
        {!isDraft && (
          <div className="comment-actions">
            {c.resolved ? (
              <button className="icon-btn sm" title="Re-open" aria-label="Re-open" onClick={(e) => (e.stopPropagation(), onReopen())}>
                <RotateCcw size={15} />
              </button>
            ) : (
              <button className="icon-btn sm" title="Resolve" aria-label="Resolve" onClick={(e) => (e.stopPropagation(), onResolve())}>
                <Check size={16} />
              </button>
            )}
            <button className="icon-btn sm" title="Delete" aria-label="Delete comment" onClick={(e) => (e.stopPropagation(), onDelete())}>
              <Trash2 size={15} />
            </button>
          </div>
        )}
      </div>
      {isDraft ? (
        <div className="comment-compose">
          <textarea
            autoFocus
            placeholder="Add a comment…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && draft.trim()) onSave(draft.trim());
            }}
          />
          <div className="row gap-sm end">
            <button className="btn btn-sm" onClick={(e) => (e.stopPropagation(), onCancelNew())}>
              Cancel
            </button>
            <button className="btn btn-sm btn-primary" disabled={!draft.trim()} onClick={(e) => (e.stopPropagation(), onSave(draft.trim()))}>
              Comment
            </button>
          </div>
        </div>
      ) : (
        <p className="comment-text">{c.text}</p>
      )}
      {c.replies.map((r) => (
        <div key={r.id} className="comment-reply">
          <div className="comment-head">
            <span className="avatar sm">{initials(r.author)}</span>
            <div className="comment-who">
              <strong>{r.author}</strong>
              <span className="muted small">{relativeTime(r.createdAt)}</span>
            </div>
          </div>
          <p className="comment-text">{r.text}</p>
        </div>
      ))}
      {!isDraft && !c.resolved && active && (
        <div className="comment-compose" onClick={(e) => e.stopPropagation()}>
          <input
            placeholder={`Reply as ${author}…`}
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && reply.trim()) {
                onReply(reply.trim());
                setReply('');
              }
            }}
          />
        </div>
      )}
    </div>
  );
}
