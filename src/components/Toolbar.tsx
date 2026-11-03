import { useEffect, useReducer, useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Baseline,
  Bold,
  ChevronDown,
  Code,
  Highlighter,
  ImagePlus,
  IndentDecrease,
  IndentIncrease,
  Italic,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  MessageSquarePlus,
  Minus,
  MoreHorizontal,
  Plus,
  Printer,
  Quote,
  Redo2,
  RemoveFormatting,
  SeparatorHorizontal,
  Strikethrough,
  Subscript,
  Superscript,
  Table as TableIcon,
  Underline,
  Undo2,
  Rows3,
  Ban,
  PenTool,
} from 'lucide-react';
import { FONT_FAMILIES, FONT_SIZES, HIGHLIGHT_COLORS, LINE_HEIGHTS, TEXT_COLORS } from '../editor/extensions';
import { Menu } from './ui';
import { modKey } from '../lib/platform';

export function useEditorTick(editor: Editor | null) {
  const [, force] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    if (!editor) return;
    editor.on('transaction', force);
    return () => {
      editor.off('transaction', force);
    };
  }, [editor]);
}

const HEADING_DEFAULT_PT: Record<number, number> = { 1: 22, 2: 16, 3: 13, 4: 11 };

export function currentFontSize(editor: Editor): number {
  const raw = editor.getAttributes('textStyle').fontSize as string | undefined;
  if (raw) {
    const n = parseFloat(raw);
    return raw.endsWith('px') ? Math.round(n * 0.75) : n;
  }
  for (let l = 1; l <= 4; l++) if (editor.isActive('heading', { level: l })) return HEADING_DEFAULT_PT[l];
  return 11;
}

export interface ToolbarActions {
  print: () => void;
  insertImage: () => void;
  editLink: () => void;
  addComment: () => void;
  draw: () => void;
  zoom: number;
  setZoom: (z: number) => void;
}

function Btn({
  onClick,
  active,
  disabled,
  title,
  children,
}: {
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={`tb-btn${active ? ' active' : ''}`}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      aria-pressed={active}
    >
      {children}
    </button>
  );
}

const Sep = () => <span className="tb-sep" aria-hidden />;

function ColorGrid({
  colors,
  onPick,
  onReset,
  resetLabel,
  close,
}: {
  colors: string[];
  onPick: (c: string) => void;
  onReset: () => void;
  resetLabel: string;
  close: () => void;
}) {
  return (
    <div className="color-picker">
      <button
        className="menu-item"
        onClick={() => {
          onReset();
          close();
        }}
      >
        <span className="menu-icon">
          <Ban size={16} />
        </span>
        <span className="menu-label">{resetLabel}</span>
      </button>
      <div className="color-grid">
        {colors.map((c) => (
          <button
            key={c}
            className="swatch"
            style={{ background: c }}
            title={c}
            aria-label={`Colour ${c}`}
            onClick={() => {
              onPick(c);
              close();
            }}
          />
        ))}
      </div>
      <label className="custom-color">
        Custom…
        <input type="color" onChange={(e) => onPick(e.target.value)} />
      </label>
    </div>
  );
}

function TablePicker({ onPick, close }: { onPick: (r: number, c: number) => void; close: () => void }) {
  const [hover, setHover] = useState<[number, number]>([0, 0]);
  return (
    <div className="table-picker">
      <div className="table-picker-grid" onMouseLeave={() => setHover([0, 0])}>
        {Array.from({ length: 8 }, (_, r) =>
          Array.from({ length: 8 }, (_, c) => (
            <button
              key={`${r}-${c}`}
              className={r < hover[0] && c < hover[1] ? 'on' : ''}
              onMouseEnter={() => setHover([r + 1, c + 1])}
              onFocus={() => setHover([r + 1, c + 1])}
              onClick={() => {
                onPick(r + 1, c + 1);
                close();
              }}
              aria-label={`${r + 1} by ${c + 1} table`}
            />
          )),
        )}
      </div>
      <div className="table-picker-label">{hover[0] ? `${hover[0]} × ${hover[1]}` : 'Insert table'}</div>
    </div>
  );
}

/**
 * The font size box. It keeps what you type while it has focus (the toolbar re-renders
 * constantly as the cursor moves), and applies it on Enter or when you click away.
 */
function FontSizeBox({ editor, size, onApply }: { editor: Editor; size: number; onApply: (n: number, range: { from: number; to: number }) => void }) {
  const [value, setValue] = useState(String(size));
  const editing = useRef(false);
  // Typing here takes focus away from the document; remember which text was selected
  // so the new size is applied to it even if the browser resets the selection on refocus.
  const range = useRef({ from: 0, to: 0 });
  useEffect(() => {
    if (!editing.current) setValue(String(size));
  }, [size]);
  const apply = () => {
    const n = parseFloat(value);
    if (n > 0 && n !== size) onApply(n, range.current);
    else setValue(String(size));
  };
  return (
    <input
      className="tb-size"
      value={value}
      aria-label="Font size"
      title="Font size"
      inputMode="numeric"
      list="inkwell-font-sizes"
      onFocus={() => {
        editing.current = true;
        const { from, to } = editor.state.selection;
        range.current = { from, to };
      }}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          editing.current = false;
          apply();
        } else if (e.key === 'Escape') {
          editing.current = false;
          setValue(String(size));
        }
      }}
      onBlur={() => {
        if (editing.current) {
          editing.current = false;
          apply();
        }
      }}
    />
  );
}

export function Toolbar({ editor, actions }: { editor: Editor; actions: ToolbarActions }) {
  useEditorTick(editor);
  const c = () => editor.chain().focus();
  const ts = editor.getAttributes('textStyle');
  const size = currentFontSize(editor);
  const family = (ts.fontFamily as string | undefined)?.replace(/["']/g, '') ?? '';
  const blockType = editor.isActive('heading', { level: 1 })
    ? 'h1'
    : editor.isActive('heading', { level: 2 })
      ? 'h2'
      : editor.isActive('heading', { level: 3 })
        ? 'h3'
        : editor.isActive('heading', { level: 4 })
          ? 'h4'
          : editor.isActive('codeBlock')
            ? 'code'
            : 'p';
  const align = (['left', 'center', 'right', 'justify'] as const).find((a) => editor.isActive({ textAlign: a })) ?? 'left';
  const AlignIcon = { left: AlignLeft, center: AlignCenter, right: AlignRight, justify: AlignJustify }[align];

  const setSize = (pt: number, range?: { from: number; to: number }) => {
    const v = Math.max(1, Math.min(400, Math.round(pt)));
    const chain = c();
    if (range && range.to <= editor.state.doc.content.size) chain.setTextSelection(range);
    chain.setFontSize(`${v}pt`).run();
  };

  const inList = editor.isActive('bulletList') || editor.isActive('orderedList') || editor.isActive('taskList');
  const listItemType = editor.isActive('taskList') ? 'taskItem' : 'listItem';

  return (
    <div className="toolbar" role="toolbar" aria-label="Formatting">
      <Btn title={`Undo (${modKey}+Z)`} onClick={() => c().undo().run()} disabled={!editor.can().undo()}>
        <Undo2 size={17} />
      </Btn>
      <Btn title={`Redo (${modKey}+Shift+Z)`} onClick={() => c().redo().run()} disabled={!editor.can().redo()}>
        <Redo2 size={17} />
      </Btn>
      <Btn title={`Print (${modKey}+P)`} onClick={actions.print}>
        <Printer size={17} />
      </Btn>
      <select
        className="tb-select zoom-select hide-mobile"
        value={actions.zoom}
        onChange={(e) => actions.setZoom(Number(e.target.value))}
        aria-label="Zoom"
        title="Zoom"
      >
        {[50, 75, 90, 100, 125, 150, 200].map((z) => (
          <option key={z} value={z}>
            {z}%
          </option>
        ))}
        {![50, 75, 90, 100, 125, 150, 200].includes(actions.zoom) && <option value={actions.zoom}>{actions.zoom}%</option>}
      </select>
      <Sep />
      <select
        className="tb-select style-select"
        value={blockType}
        aria-label="Text style"
        title="Text style"
        onChange={(e) => {
          const v = e.target.value;
          if (v === 'p') c().setParagraph().run();
          else if (v === 'code') c().toggleCodeBlock().run();
          else c().setHeading({ level: Number(v[1]) as 1 | 2 | 3 | 4 }).run();
        }}
      >
        <option value="p">Normal text</option>
        <option value="h1">Heading 1</option>
        <option value="h2">Heading 2</option>
        <option value="h3">Heading 3</option>
        <option value="h4">Heading 4</option>
        <option value="code">Code</option>
      </select>
      <select
        className="tb-select font-select"
        value={family}
        aria-label="Font"
        title="Font"
        style={{ fontFamily: family || undefined }}
        onChange={(e) => (e.target.value ? c().setFontFamily(e.target.value).run() : c().unsetFontFamily().run())}
      >
        <option value="">Default (Inter)</option>
        {FONT_FAMILIES.map((f) => (
          <option key={f.value} value={f.value} style={{ fontFamily: f.value }}>
            {f.label}
          </option>
        ))}
        {family && !FONT_FAMILIES.some((f) => f.value === family) && <option value={family}>{family}</option>}
      </select>
      <Sep />
      <Btn title="Decrease font size" onClick={() => setSize([...FONT_SIZES].reverse().find((s) => s < size) ?? size - 1)}>
        <Minus size={15} />
      </Btn>
      <FontSizeBox editor={editor} size={size} onApply={setSize} />
      <datalist id="inkwell-font-sizes">
        {FONT_SIZES.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
      <Btn title="Increase font size" onClick={() => setSize(FONT_SIZES.find((s) => s > size) ?? size + 1)}>
        <Plus size={15} />
      </Btn>
      <Sep />
      <Btn title={`Bold (${modKey}+B)`} active={editor.isActive('bold')} onClick={() => c().toggleBold().run()}>
        <Bold size={17} />
      </Btn>
      <Btn title={`Italic (${modKey}+I)`} active={editor.isActive('italic')} onClick={() => c().toggleItalic().run()}>
        <Italic size={17} />
      </Btn>
      <Btn
        title={`Underline (${modKey}+U)`}
        active={editor.isActive('underline')}
        onClick={() => c().toggleUnderline().run()}
      >
        <Underline size={17} />
      </Btn>
      <Btn
        title={`Strikethrough (${modKey}+Shift+S)`}
        active={editor.isActive('strike')}
        onClick={() => c().toggleStrike().run()}
      >
        <Strikethrough size={17} />
      </Btn>
      <Menu
        trigger={({ toggle }) => (
          <button className="tb-btn color-btn" onMouseDown={(e) => e.preventDefault()} onClick={toggle} title="Text colour" aria-label="Text colour">
            <Baseline size={17} />
            <span className="color-bar" style={{ background: ts.color || 'currentColor' }} />
          </button>
        )}
        items={[
          {
            render: (close) => (
              <ColorGrid
                colors={TEXT_COLORS}
                resetLabel="Automatic"
                onPick={(col) => c().setColor(col).run()}
                onReset={() => c().unsetColor().run()}
                close={close}
              />
            ),
          },
        ]}
      />
      <Menu
        trigger={({ toggle }) => (
          <button className="tb-btn color-btn" onMouseDown={(e) => e.preventDefault()} onClick={toggle} title="Highlight colour" aria-label="Highlight colour">
            <Highlighter size={17} />
            <span className="color-bar" style={{ background: editor.getAttributes('highlight').color || 'transparent' }} />
          </button>
        )}
        items={[
          {
            render: (close) => (
              <ColorGrid
                colors={HIGHLIGHT_COLORS}
                resetLabel="None"
                onPick={(col) => c().setHighlight({ color: col }).run()}
                onReset={() => c().unsetHighlight().run()}
                close={close}
              />
            ),
          },
        ]}
      />
      <Sep />
      <Btn title={`Insert link (${modKey}+K)`} active={editor.isActive('link')} onClick={actions.editLink}>
        <Link2 size={17} />
      </Btn>
      <Btn title={`Add comment (${modKey}+Alt+M)`} onClick={actions.addComment}>
        <MessageSquarePlus size={17} />
      </Btn>
      <Btn title="Insert image" onClick={actions.insertImage}>
        <ImagePlus size={17} />
      </Btn>
      <Btn title="Draw" active={editor.isActive('drawing')} onClick={actions.draw}>
        <PenTool size={17} />
      </Btn>
      <Menu
        trigger={({ toggle }) => (
          <button className="tb-btn" onMouseDown={(e) => e.preventDefault()} onClick={toggle} title="Insert table" aria-label="Insert table">
            <TableIcon size={17} />
          </button>
        )}
        items={[
          {
            render: (close) => (
              <TablePicker
                close={close}
                onPick={(rows, cols) => c().insertTable({ rows, cols, withHeaderRow: true }).run()}
              />
            ),
          },
        ]}
      />
      <Sep />
      <Menu
        trigger={({ toggle }) => (
          <button className="tb-btn" onMouseDown={(e) => e.preventDefault()} onClick={toggle} title="Align" aria-label="Align">
            <AlignIcon size={17} />
            <ChevronDown size={12} />
          </button>
        )}
        items={[
          { label: 'Left', icon: <AlignLeft size={16} />, shortcut: `${modKey}+Shift+L`, checked: align === 'left', onClick: () => c().setTextAlign('left').run() },
          { label: 'Center', icon: <AlignCenter size={16} />, shortcut: `${modKey}+Shift+E`, checked: align === 'center', onClick: () => c().setTextAlign('center').run() },
          { label: 'Right', icon: <AlignRight size={16} />, shortcut: `${modKey}+Shift+R`, checked: align === 'right', onClick: () => c().setTextAlign('right').run() },
          { label: 'Justify', icon: <AlignJustify size={16} />, shortcut: `${modKey}+Shift+J`, checked: align === 'justify', onClick: () => c().setTextAlign('justify').run() },
        ]}
      />
      <Menu
        trigger={({ toggle }) => (
          <button className="tb-btn" onMouseDown={(e) => e.preventDefault()} onClick={toggle} title="Line spacing" aria-label="Line spacing">
            <Rows3 size={17} />
            <ChevronDown size={12} />
          </button>
        )}
        items={() => [
          ...LINE_HEIGHTS.map((l) => ({
            label: l.label,
            checked: (ts.lineHeight ?? '') === l.value,
            onClick: () => c().setLineHeight(l.value).run(),
          })),
          { divider: true },
          { label: 'Reset spacing', onClick: () => c().unsetLineHeight().run() },
        ]}
      />
      <Btn title="Checklist" active={editor.isActive('taskList')} onClick={() => c().toggleTaskList().run()}>
        <ListChecks size={17} />
      </Btn>
      <Btn title={`Bulleted list (${modKey}+Shift+8)`} active={editor.isActive('bulletList')} onClick={() => c().toggleBulletList().run()}>
        <List size={17} />
      </Btn>
      <Btn title={`Numbered list (${modKey}+Shift+7)`} active={editor.isActive('orderedList')} onClick={() => c().toggleOrderedList().run()}>
        <ListOrdered size={17} />
      </Btn>
      <Btn title="Decrease indent" disabled={!inList} onClick={() => c().liftListItem(listItemType).run()}>
        <IndentDecrease size={17} />
      </Btn>
      <Btn title="Increase indent" disabled={!inList} onClick={() => c().sinkListItem(listItemType).run()}>
        <IndentIncrease size={17} />
      </Btn>
      <Btn title={`Clear formatting (${modKey}+\\)`} onClick={() => c().unsetAllMarks().unsetTextAlign().unsetLineHeight().run()}>
        <RemoveFormatting size={17} />
      </Btn>
      <Menu
        align="right"
        trigger={({ toggle }) => (
          <button className="tb-btn" onMouseDown={(e) => e.preventDefault()} onClick={toggle} title="More" aria-label="More formatting">
            <MoreHorizontal size={17} />
          </button>
        )}
        items={() => [
          { label: 'Superscript', icon: <Superscript size={16} />, shortcut: `${modKey}+.`, checked: editor.isActive('superscript'), onClick: () => c().toggleSuperscript().run() },
          { label: 'Subscript', icon: <Subscript size={16} />, shortcut: `${modKey}+,`, checked: editor.isActive('subscript'), onClick: () => c().toggleSubscript().run() },
          { label: 'Inline code', icon: <Code size={16} />, shortcut: `${modKey}+E`, checked: editor.isActive('code'), onClick: () => c().toggleCode().run() },
          { label: 'Quote', icon: <Quote size={16} />, shortcut: `${modKey}+Shift+B`, checked: editor.isActive('blockquote'), onClick: () => c().toggleBlockquote().run() },
          { divider: true },
          { label: 'Horizontal line', icon: <Minus size={16} />, onClick: () => c().setHorizontalRule().run() },
          { label: 'Page break', icon: <SeparatorHorizontal size={16} />, shortcut: `${modKey}+Enter`, onClick: () => c().setPageBreak().run() },
        ]}
      />
    </div>
  );
}
