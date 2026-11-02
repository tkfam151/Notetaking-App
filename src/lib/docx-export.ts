import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  Packer,
  PageBreak,
  PageOrientation,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  type IParagraphOptions,
  type ParagraphChild,
} from 'docx';
import { PAGE_DIMENSIONS, type PageSetup } from '../types';

/* Minimal ProseMirror JSON shape */
interface PMMark { type: string; attrs?: Record<string, any> }
interface PMNode {
  type: string;
  attrs?: Record<string, any>;
  content?: PMNode[];
  text?: string;
  marks?: PMMark[];
}

const TWIP = 1440; // twips per inch
const HEADINGS = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4];

const ALIGN: Record<string, (typeof AlignmentType)[keyof typeof AlignmentType]> = {
  left: AlignmentType.LEFT,
  center: AlignmentType.CENTER,
  right: AlignmentType.RIGHT,
  justify: AlignmentType.JUSTIFIED,
};

function hex(color?: string | null): string | undefined {
  if (!color) return undefined;
  const c = color.trim();
  if (/^#[0-9a-f]{6}$/i.test(c)) return c.slice(1);
  if (/^#[0-9a-f]{3}$/i.test(c)) return c.slice(1).split('').map((x) => x + x).join('');
  const m = c.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (m) return [m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('');
  return undefined;
}

function pxToHalfPoints(size?: string | null) {
  if (!size) return undefined;
  const n = parseFloat(size);
  if (!n) return undefined;
  const pt = size.endsWith('pt') ? n : n * 0.75;
  return Math.round(pt * 2);
}

interface Ctx {
  listLevel: number;
  listRef: string | null;
  inQuote: boolean;
  inCode: boolean;
}

function textRuns(nodes: PMNode[] | undefined, ctx: Ctx): ParagraphChild[] {
  const out: ParagraphChild[] = [];
  for (const n of nodes ?? []) {
    if (n.type === 'hardBreak') {
      out.push(new TextRun({ text: '', break: 1 }));
      continue;
    }
    if (n.type === 'image') {
      const img = imageRun(n);
      if (img) out.push(img);
      continue;
    }
    if (n.type !== 'text' || !n.text) continue;
    const marks = n.marks ?? [];
    const has = (t: string) => marks.find((m) => m.type === t);
    const style = has('textStyle')?.attrs ?? {};
    const hl = has('highlight');
    const link = has('link');
    const run = new TextRun({
      text: n.text,
      bold: !!has('bold'),
      italics: !!has('italic') || ctx.inQuote,
      underline: has('underline') || link ? {} : undefined,
      strike: !!has('strike'),
      subScript: !!has('subscript'),
      superScript: !!has('superscript'),
      color: link ? '1971C2' : hex(style.color),
      size: pxToHalfPoints(style.fontSize),
      font: has('code') || ctx.inCode ? 'Courier New' : style.fontFamily?.replace(/["']/g, '').split(',')[0] || undefined,
      shading: hl
        ? { type: ShadingType.CLEAR, color: 'auto', fill: hex(hl.attrs?.color) ?? 'FFF3BF' }
        : has('code')
          ? { type: ShadingType.CLEAR, color: 'auto', fill: 'F1F3F5' }
          : undefined,
    });
    out.push(link ? new ExternalHyperlink({ link: link.attrs?.href ?? '', children: [run] }) : run);
  }
  return out;
}

function dataUrlToBytes(src: string): { data: Uint8Array; type: 'png' | 'jpg' | 'gif' | 'bmp' } | null {
  const m = src.match(/^data:image\/(png|jpe?g|gif|bmp);base64,(.*)$/i);
  if (!m) return null;
  const bin = atob(m[2]);
  const data = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) data[i] = bin.charCodeAt(i);
  const t = m[1].toLowerCase();
  return { data, type: (t === 'jpeg' ? 'jpg' : t) as 'png' | 'jpg' | 'gif' | 'bmp' };
}

function imageRun(n: PMNode) {
  const parsed = dataUrlToBytes(n.attrs?.src ?? '');
  if (!parsed) return null;
  const w = Number(n.attrs?.width) || 400;
  const h = Number(n.attrs?.height) || Math.round(w * 0.66);
  const scale = Math.min(1, 600 / w);
  return new ImageRun({
    type: parsed.type,
    data: parsed.data,
    transformation: { width: Math.round(w * scale), height: Math.round(h * scale) },
  });
}

function para(n: PMNode, ctx: Ctx, extra: Partial<IParagraphOptions> = {}): Paragraph {
  const align = ALIGN[n.attrs?.textAlign as string];
  const lh = parseFloat(n.attrs?.lineHeight ?? '');
  const opts: IParagraphOptions = {
    children: textRuns(n.content, ctx),
    alignment: align,
    spacing: lh ? { line: Math.round(240 * lh) } : undefined,
    ...extra,
  };
  if (ctx.inQuote) {
    Object.assign(opts, {
      indent: { left: 0.4 * TWIP },
      border: { left: { style: BorderStyle.SINGLE, size: 12, color: 'ADB5BD', space: 8 } },
    });
  }
  return new Paragraph(opts);
}

function blocks(nodes: PMNode[] | undefined, ctx: Ctx): (Paragraph | Table)[] {
  const out: (Paragraph | Table)[] = [];
  for (const n of nodes ?? []) {
    switch (n.type) {
      case 'paragraph':
        if (ctx.listRef) {
          out.push(para(n, ctx, { numbering: { reference: ctx.listRef, level: ctx.listLevel } }));
          // Only the first paragraph of a list item gets the bullet.
          ctx = { ...ctx, listRef: null };
        } else out.push(para(n, ctx));
        break;
      case 'heading': {
        const level = Math.min(Math.max(Number(n.attrs?.level) || 1, 1), 4);
        out.push(para(n, ctx, { heading: HEADINGS[level - 1] }));
        break;
      }
      case 'blockquote':
        out.push(...blocks(n.content, { ...ctx, inQuote: true }));
        break;
      case 'codeBlock':
        for (const line of (n.content?.map((c) => c.text ?? '').join('') ?? '').split('\n')) {
          out.push(
            new Paragraph({
              children: [new TextRun({ text: line, font: 'Courier New', size: 20 })],
              shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'F1F3F5' },
              spacing: { after: 0 },
            }),
          );
        }
        break;
      case 'bulletList':
      case 'orderedList':
        for (const item of n.content ?? []) {
          out.push(
            ...blocks(item.content, {
              ...ctx,
              listRef: n.type === 'bulletList' ? 'bullets' : 'numbers',
              listLevel: Math.min(ctx.listLevel + 1, 5),
            }),
          );
        }
        break;
      case 'taskList':
        for (const item of n.content ?? []) {
          const [first, ...rest] = item.content ?? [];
          const box = item.attrs?.checked ? '☑ ' : '☐ ';
          if (first) {
            out.push(
              para({ ...first, content: [{ type: 'text', text: box }, ...(first.content ?? [])] }, ctx, {
                indent: { left: (ctx.listLevel + 1) * 0.3 * TWIP },
              }),
            );
          }
          out.push(...blocks(rest, { ...ctx, listLevel: ctx.listLevel + 1 }));
        }
        break;
      case 'horizontalRule':
        out.push(
          new Paragraph({
            children: [],
            border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'CED4DA', space: 1 } },
          }),
        );
        break;
      case 'pageBreak':
        out.push(new Paragraph({ children: [new PageBreak()] }));
        break;
      case 'image': {
        const img = imageRun(n);
        if (img) out.push(new Paragraph({ children: [img] }));
        break;
      }
      case 'table':
        out.push(table(n, ctx));
        break;
      default:
        if (n.content) out.push(...blocks(n.content, ctx));
    }
  }
  return out;
}

function table(n: PMNode, ctx: Ctx) {
  const rows = (n.content ?? []).map(
    (row) =>
      new TableRow({
        children: (row.content ?? []).map((cell) => {
          const children = blocks(cell.content, { ...ctx, listRef: null, listLevel: -1 });
          return new TableCell({
            children: children.length ? children : [new Paragraph('')],
            columnSpan: (cell.attrs?.colspan ?? 1) > 1 ? cell.attrs?.colspan : undefined,
            rowSpan: (cell.attrs?.rowspan ?? 1) > 1 ? cell.attrs?.rowspan : undefined,
            shading:
              cell.type === 'tableHeader'
                ? { type: ShadingType.CLEAR, color: 'auto', fill: 'F1F3F5' }
                : cell.attrs?.backgroundColor
                  ? { type: ShadingType.CLEAR, color: 'auto', fill: hex(cell.attrs.backgroundColor) }
                  : undefined,
          });
        }),
      }),
  );
  return new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } });
}

function levels(format: (typeof LevelFormat)[keyof typeof LevelFormat], texts: string[]) {
  return Array.from({ length: 6 }, (_, i) => ({
    level: i,
    format,
    text: texts[i % texts.length].replace('%', `%${i + 1}`),
    alignment: AlignmentType.LEFT,
    style: { paragraph: { indent: { left: (i + 1) * 0.35 * TWIP, hanging: 0.25 * TWIP } } },
  }));
}

export async function toDocxBlob(json: PMNode, title: string, setup: PageSetup): Promise<Blob> {
  const dims = PAGE_DIMENSIONS[setup.size];
  const landscape = setup.orientation === 'landscape';
  const doc = new Document({
    title,
    creator: 'Inkwell',
    styles: {
      default: { document: { run: { font: 'Calibri', size: 22 } } },
    },
    numbering: {
      config: [
        { reference: 'bullets', levels: levels(LevelFormat.BULLET, ['•', '◦', '▪']) },
        { reference: 'numbers', levels: levels(LevelFormat.DECIMAL, ['%.', '%.', '%.']).map((l, i) => ({
          ...l,
          format: [LevelFormat.DECIMAL, LevelFormat.LOWER_LETTER, LevelFormat.LOWER_ROMAN][i % 3],
        })) },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            size: {
              // docx swaps width/height itself when orientation is landscape
              width: dims.w * TWIP,
              height: dims.h * TWIP,
              orientation: landscape ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT,
            },
            margin: {
              top: setup.margins.top * TWIP,
              right: setup.margins.right * TWIP,
              bottom: setup.margins.bottom * TWIP,
              left: setup.margins.left * TWIP,
            },
          },
        },
        children: blocks(json.content, { listLevel: -1, listRef: null, inQuote: false, inCode: false }),
      },
    ],
  });
  return Packer.toBlob(doc);
}
