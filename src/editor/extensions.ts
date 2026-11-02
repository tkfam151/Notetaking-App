import StarterKit from '@tiptap/starter-kit';
import { TextStyleKit } from '@tiptap/extension-text-style';
import TextAlign from '@tiptap/extension-text-align';
import Highlight from '@tiptap/extension-highlight';
import Image from '@tiptap/extension-image';
import { TableKit } from '@tiptap/extension-table';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { CharacterCount, Placeholder } from '@tiptap/extensions';
import Subscript from '@tiptap/extension-subscript';
import Superscript from '@tiptap/extension-superscript';
import { PageBreak } from './PageBreak';
import { Drawing } from './Drawing';
import { CommentMark } from './CommentMark';
import { SearchReplace } from './SearchReplace';

export function buildExtensions() {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3, 4] },
      link: { openOnClick: false, autolink: true, defaultProtocol: 'https' },
    }),
    TextStyleKit,
    TextAlign.configure({ types: ['heading', 'paragraph'] }),
    Highlight.configure({ multicolor: true }),
    Image.configure({
      allowBase64: true,
      resize: { enabled: true, minWidth: 40, minHeight: 40, alwaysPreserveAspectRatio: true },
    }),
    Drawing.configure({
      allowBase64: true,
      resize: { enabled: true, minWidth: 40, minHeight: 40, alwaysPreserveAspectRatio: true },
    }),
    TableKit.configure({ table: { resizable: true } }),
    TaskList,
    TaskItem.configure({ nested: true }),
    CharacterCount,
    Placeholder.configure({ placeholder: 'Start typing…' }),
    Subscript,
    Superscript,
    PageBreak,
    CommentMark,
    SearchReplace,
  ];
}

export const FONT_FAMILIES = [
  { label: 'Inter', value: 'Inter' },
  { label: 'Arial', value: 'Arial' },
  { label: 'Helvetica', value: 'Helvetica' },
  { label: 'Verdana', value: 'Verdana' },
  { label: 'Trebuchet MS', value: 'Trebuchet MS' },
  { label: 'Georgia', value: 'Georgia' },
  { label: 'Times New Roman', value: 'Times New Roman' },
  { label: 'Garamond', value: 'Garamond' },
  { label: 'Merriweather', value: 'Merriweather' },
  { label: 'Lora', value: 'Lora' },
  { label: 'Playfair Display', value: 'Playfair Display' },
  { label: 'Courier New', value: 'Courier New' },
  { label: 'Roboto Mono', value: 'Roboto Mono' },
];

export const FONT_SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 60, 72];

export const LINE_HEIGHTS = [
  { label: 'Single', value: '1.15' },
  { label: '1.5', value: '1.5' },
  { label: 'Double', value: '2' },
  { label: 'Compact', value: '1' },
];

export const TEXT_COLORS = [
  '#000000', '#434343', '#666666', '#999999', '#cccccc', '#ffffff',
  '#c92a2a', '#e8590c', '#f08c00', '#2b8a3e', '#0b7285', '#1971c2',
  '#3b5bdb', '#6741d9', '#9c36b5', '#c2255c', '#5c940d', '#862e9c',
];

export const HIGHLIGHT_COLORS = [
  '#fff3bf', '#ffec99', '#d3f9d8', '#c5f6fa', '#d0ebff', '#e5dbff',
  '#ffdeeb', '#ffe8cc', '#f1f3f5',
];
