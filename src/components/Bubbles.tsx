import type { Editor } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import {
  ArrowDownToLine,
  ArrowLeftToLine,
  ArrowRightToLine,
  ArrowUpToLine,
  Columns2,
  ExternalLink,
  Heading,
  Merge,
  Pencil,
  PenTool,
  Rows2,
  Split,
  Trash2,
  Unlink,
} from 'lucide-react';

const B = ({ title, onClick, children, danger }: { title: string; onClick: () => void; children: React.ReactNode; danger?: boolean }) => (
  <button
    className={`bubble-btn${danger ? ' danger' : ''}`}
    title={title}
    aria-label={title}
    onMouseDown={(e) => e.preventDefault()}
    onClick={onClick}
  >
    {children}
  </button>
);

export function TableBubble({ editor }: { editor: Editor }) {
  const c = () => editor.chain().focus();
  return (
    <BubbleMenu
      editor={editor}
      pluginKey="tableBubble"
      shouldShow={({ editor: e }) => e.isEditable && e.isActive('table')}
      options={{ placement: 'top', offset: 8 }}
      className="bubble"
    >
      <B title="Insert row above" onClick={() => c().addRowBefore().run()}>
        <ArrowUpToLine size={16} />
      </B>
      <B title="Insert row below" onClick={() => c().addRowAfter().run()}>
        <ArrowDownToLine size={16} />
      </B>
      <B title="Insert column left" onClick={() => c().addColumnBefore().run()}>
        <ArrowLeftToLine size={16} />
      </B>
      <B title="Insert column right" onClick={() => c().addColumnAfter().run()}>
        <ArrowRightToLine size={16} />
      </B>
      <span className="bubble-sep" />
      <B title="Delete row" onClick={() => c().deleteRow().run()}>
        <Rows2 size={16} />
      </B>
      <B title="Delete column" onClick={() => c().deleteColumn().run()}>
        <Columns2 size={16} />
      </B>
      <B title="Merge cells" onClick={() => c().mergeCells().run()}>
        <Merge size={16} />
      </B>
      <B title="Split cell" onClick={() => c().splitCell().run()}>
        <Split size={16} />
      </B>
      <B title="Toggle header row" onClick={() => c().toggleHeaderRow().run()}>
        <Heading size={16} />
      </B>
      <span className="bubble-sep" />
      <B title="Delete table" danger onClick={() => c().deleteTable().run()}>
        <Trash2 size={16} />
      </B>
    </BubbleMenu>
  );
}

export function LinkBubble({ editor, onEdit }: { editor: Editor; onEdit: () => void }) {
  const href = editor.getAttributes('link').href as string | undefined;
  return (
    <BubbleMenu
      editor={editor}
      pluginKey="linkBubble"
      shouldShow={({ editor: e, from, to }) => e.isActive('link') && from === to}
      options={{ placement: 'bottom', offset: 8 }}
      className="bubble"
    >
      <a className="bubble-link" href={href} target="_blank" rel="noreferrer noopener">
        <ExternalLink size={14} /> {href && href.length > 40 ? `${href.slice(0, 40)}…` : href}
      </a>
      <span className="bubble-sep" />
      <B title="Edit link" onClick={onEdit}>
        <Pencil size={15} />
      </B>
      <B title="Remove link" onClick={() => editor.chain().focus().extendMarkRange('link').unsetLink().run()}>
        <Unlink size={15} />
      </B>
    </BubbleMenu>
  );
}

export function DrawingBubble({ editor, onEdit }: { editor: Editor; onEdit: () => void }) {
  return (
    <BubbleMenu
      editor={editor}
      pluginKey="drawingBubble"
      shouldShow={({ editor: e }) => e.isEditable && e.isActive('drawing')}
      options={{ placement: 'top', offset: 8 }}
      className="bubble"
    >
      <button className="bubble-text-btn" onMouseDown={(e) => e.preventDefault()} onClick={onEdit}>
        <PenTool size={15} /> Edit drawing
      </button>
      <span className="bubble-sep" />
      <B title="Delete drawing" danger onClick={() => editor.chain().focus().deleteSelection().run()}>
        <Trash2 size={16} />
      </B>
    </BubbleMenu>
  );
}
