import Image from '@tiptap/extension-image';

/**
 * A freehand drawing. It behaves like an image (so it can be resized, exported to Word/PDF,
 * printed, etc.) but also keeps the original pen strokes in `data-drawing`, so it can be
 * opened and edited again by double-clicking it.
 */
export const Drawing = Image.extend({
  name: 'drawing',
  // Must win over the plain image rule for <img data-drawing>.
  priority: 1000,

  addAttributes() {
    return {
      ...this.parent?.(),
      drawing: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-drawing'),
        renderHTML: (attrs) => (attrs.drawing ? { 'data-drawing': attrs.drawing } : {}),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'img[data-drawing]' }];
  },

  addInputRules() {
    return [];
  },

  // Reuse the image's resizable view, but rebuild it whenever the picture itself changes
  // (after editing the drawing) so its size and aspect ratio are recalculated.
  addNodeView() {
    const parentFactory = this.parent?.();
    if (!parentFactory) return null;
    return (props) => {
      const view = parentFactory(props);
      let currentSrc = props.node.attrs.src;
      const originalUpdate = view.update?.bind(view);
      view.update = (node, ...rest) => {
        if (node.type !== props.node.type || node.attrs.src !== currentSrc) return false;
        currentSrc = node.attrs.src;
        return originalUpdate ? originalUpdate(node, ...rest) : true;
      };
      return view;
    };
  },

  addCommands() {
    return {};
  },
});

// ---- Drawing data model (shared with the drawing dialog) ---------------------

export type DrawTool = 'pen' | 'highlighter' | 'line' | 'arrow' | 'rect' | 'ellipse';

export interface Stroke {
  tool: DrawTool;
  color: string;
  size: number;
  /** [x, y, pressure] in canvas coordinates */
  points: [number, number, number][];
  fill?: boolean;
}

export interface DrawingData {
  v: 1;
  w: number;
  h: number;
  background: 'white' | 'transparent' | 'grid';
  strokes: Stroke[];
}

export function parseDrawing(raw: string | null | undefined): DrawingData | null {
  if (!raw) return null;
  try {
    const d = JSON.parse(raw);
    return d && d.v === 1 && Array.isArray(d.strokes) ? d : null;
  } catch {
    return null;
  }
}
