import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowUpRight,
  Circle,
  Eraser,
  Highlighter,
  Minus,
  PenLine,
  Redo2,
  Square,
  Trash2,
  Undo2,
  X,
  PaintBucket,
} from 'lucide-react';
import type { DrawingData, DrawTool, Stroke } from '../editor/Drawing';

const W = 960;
const H = 600;

const COLORS = ['#1f2328', '#e03131', '#f08c00', '#2f9e44', '#1971c2', '#6741d9', '#c2255c', '#868e96', '#ffffff'];
const SIZES = [2, 4, 8, 14];

type Tool = DrawTool | 'eraser';

export interface DrawingResult {
  data: DrawingData;
  /** PNG data URL, cropped to the drawn content */
  src: string;
  width: number;
  height: number;
}

// ---- Rendering --------------------------------------------------------------

function shapePoints(s: Stroke): [number, number][] {
  const [a, b] = [s.points[0], s.points[s.points.length - 1]];
  if (!a || !b) return [];
  const [x1, y1, x2, y2] = [a[0], a[1], b[0], b[1]];
  switch (s.tool) {
    case 'line':
    case 'arrow':
      return [
        [x1, y1],
        [x2, y2],
      ];
    case 'rect':
      return [
        [x1, y1],
        [x2, y1],
        [x2, y2],
        [x1, y2],
        [x1, y1],
      ];
    case 'ellipse': {
      const cx = (x1 + x2) / 2;
      const cy = (y1 + y2) / 2;
      const rx = Math.abs(x2 - x1) / 2;
      const ry = Math.abs(y2 - y1) / 2;
      return Array.from({ length: 41 }, (_, i) => {
        const t = (i / 40) * Math.PI * 2;
        return [cx + rx * Math.cos(t), cy + ry * Math.sin(t)] as [number, number];
      });
    }
    default:
      return s.points.map((p) => [p[0], p[1]]);
  }
}

function drawStroke(ctx: CanvasRenderingContext2D, s: Stroke) {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = s.color;
  ctx.fillStyle = s.color;
  const pts = s.points;
  if (s.tool === 'pen') {
    if (pts.length === 1) {
      ctx.beginPath();
      ctx.arc(pts[0][0], pts[0][1], (s.size * (0.5 + pts[0][2])) / 2, 0, Math.PI * 2);
      ctx.fill();
    }
    // Smooth curve through midpoints; width follows stylus pressure.
    for (let i = 1; i < pts.length; i++) {
      const p0 = pts[i - 2] ?? pts[i - 1];
      const p1 = pts[i - 1];
      const p2 = pts[i];
      ctx.beginPath();
      ctx.lineWidth = s.size * (0.5 + (p1[2] + p2[2]) / 2);
      ctx.moveTo((p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2);
      ctx.quadraticCurveTo(p1[0], p1[1], (p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2);
      ctx.stroke();
    }
  } else if (s.tool === 'highlighter') {
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = s.size * 3;
    ctx.lineCap = 'square';
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
    if (pts.length === 1) ctx.lineTo(pts[0][0] + 0.1, pts[0][1]);
    ctx.stroke();
  } else {
    const sp = shapePoints(s);
    ctx.lineWidth = s.size;
    ctx.beginPath();
    sp.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
    if (s.fill && (s.tool === 'rect' || s.tool === 'ellipse')) {
      ctx.globalAlpha = 0.9;
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.stroke();
    if (s.tool === 'arrow' && sp.length === 2) {
      const [[x1, y1], [x2, y2]] = sp;
      const ang = Math.atan2(y2 - y1, x2 - x1);
      const len = Math.max(12, s.size * 4);
      ctx.beginPath();
      ctx.moveTo(x2, y2);
      ctx.lineTo(x2 - len * Math.cos(ang - Math.PI / 7), y2 - len * Math.sin(ang - Math.PI / 7));
      ctx.moveTo(x2, y2);
      ctx.lineTo(x2 - len * Math.cos(ang + Math.PI / 7), y2 - len * Math.sin(ang + Math.PI / 7));
      ctx.stroke();
    }
  }
  ctx.restore();
}

function drawBackground(ctx: CanvasRenderingContext2D, bg: DrawingData['background'], w: number, h: number) {
  if (bg === 'transparent') return;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  if (bg === 'grid') {
    ctx.strokeStyle = '#e7ebf0';
    ctx.lineWidth = 1;
    for (let x = 24; x < w; x += 24) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    for (let y = 24; y < h; y += 24) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
  }
}

function bounds(strokes: Stroke[]) {
  let [x1, y1, x2, y2] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const s of strokes) {
    const pad = (s.tool === 'highlighter' ? s.size * 3 : s.size * 1.5) / 2 + (s.tool === 'arrow' ? s.size * 4 : 0);
    for (const [x, y] of shapePoints(s)) {
      x1 = Math.min(x1, x - pad);
      y1 = Math.min(y1, y - pad);
      x2 = Math.max(x2, x + pad);
      y2 = Math.max(y2, y + pad);
    }
  }
  return { x1, y1, x2, y2 };
}

/** Renders the drawing to a PNG cropped to its content (plus a margin). */
export function renderDrawing(data: DrawingData): { src: string; width: number; height: number } {
  const b = bounds(data.strokes);
  const m = 16;
  const x = Math.max(0, Math.floor(b.x1 - m));
  const y = Math.max(0, Math.floor(b.y1 - m));
  const w = Math.min(data.w, Math.ceil(b.x2 + m)) - x;
  const h = Math.min(data.h, Math.ceil(b.y2 + m)) - y;
  const scale = 2; // crisp on retina screens and in print
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, w * scale);
  canvas.height = Math.max(1, h * scale);
  const ctx = canvas.getContext('2d')!;
  ctx.scale(scale, scale);
  ctx.translate(-x, -y);
  drawBackground(ctx, data.background, data.w, data.h);
  data.strokes.forEach((s) => drawStroke(ctx, s));
  // Display at up to 6.5" wide (the text width of a Letter page with 1" margins)
  const displayW = Math.min(w, 624);
  return { src: canvas.toDataURL('image/png'), width: Math.round(displayW), height: Math.round((h * displayW) / w) };
}

function distToSegment(px: number, py: number, [ax, ay]: [number, number], [bx, by]: [number, number]) {
  const dx = bx - ax;
  const dy = by - ay;
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function hitsStroke(s: Stroke, x: number, y: number, r: number) {
  const sp = shapePoints(s);
  const reach = r + (s.tool === 'highlighter' ? s.size * 1.5 : s.size / 2);
  if (sp.length === 1) return Math.hypot(sp[0][0] - x, sp[0][1] - y) <= reach;
  for (let i = 1; i < sp.length; i++) if (distToSegment(x, y, sp[i - 1], sp[i]) <= reach) return true;
  if (s.fill && (s.tool === 'rect' || s.tool === 'ellipse')) {
    const b = bounds([s]);
    return x >= b.x1 && x <= b.x2 && y >= b.y1 && y <= b.y2;
  }
  return false;
}

// ---- Dialog -----------------------------------------------------------------

export function DrawingDialog({
  initial,
  onSave,
  onClose,
}: {
  initial: DrawingData | null;
  onSave: (r: DrawingResult) => void;
  onClose: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [strokes, setStrokes] = useState<Stroke[]>(initial?.strokes ?? []);
  const [background, setBackground] = useState<DrawingData['background']>(initial?.background ?? 'white');
  const [redoStack, setRedoStack] = useState<Stroke[][]>([]);
  const [undoStack, setUndoStack] = useState<Stroke[][]>([]);
  const [tool, setTool] = useState<Tool>('pen');
  const [color, setColor] = useState(COLORS[0]);
  const [size, setSize] = useState(4);
  const [fill, setFill] = useState(false);
  const current = useRef<Stroke | null>(null);
  const erasing = useRef<{ before: Stroke[] } | null>(null);
  const strokesRef = useRef(strokes);
  strokesRef.current = strokes;

  const redraw = useCallback(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d')!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.setTransform(c.width / W, 0, 0, c.height / H, 0, 0);
    drawBackground(ctx, background === 'transparent' ? 'grid' : background, W, H);
    if (background === 'transparent') {
      // Show a checker hint so "no background" is visible while editing
      ctx.fillStyle = 'rgba(0,0,0,0.03)';
      ctx.fillRect(0, 0, W, H);
    }
    strokesRef.current.forEach((s) => drawStroke(ctx, s));
    if (current.current) drawStroke(ctx, current.current);
  }, [background]);

  useLayoutEffect(() => {
    const c = canvasRef.current!;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    c.width = W * dpr;
    c.height = H * dpr;
    redraw();
  }, [redraw]);

  useEffect(redraw, [strokes, redraw]);

  const commit = (next: Stroke[], before: Stroke[] = strokes) => {
    setUndoStack((u) => [...u, before]);
    setRedoStack([]);
    setStrokes(next);
  };
  const undo = useCallback(() => {
    setUndoStack((u) => {
      if (!u.length) return u;
      setRedoStack((r) => [...r, strokesRef.current]);
      setStrokes(u[u.length - 1]);
      return u.slice(0, -1);
    });
  }, []);
  const redo = useCallback(() => {
    setRedoStack((r) => {
      if (!r.length) return r;
      setUndoStack((u) => [...u, strokesRef.current]);
      setStrokes(r[r.length - 1]);
      return r.slice(0, -1);
    });
  }, []);

  const toCanvas = (e: React.PointerEvent): [number, number, number] => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * W;
    const y = ((e.clientY - rect.top) / rect.height) * H;
    // Mouse/touch report 0 or 0.5; only real styluses give useful pressure.
    const p = e.pointerType === 'pen' && e.pressure > 0 ? e.pressure : 0.5;
    return [Math.round(x * 10) / 10, Math.round(y * 10) / 10, Math.round(p * 100) / 100];
  };

  const eraseAt = (x: number, y: number) => {
    const r = size * 2 + 4;
    const remaining = strokesRef.current.filter((s) => !hitsStroke(s, x, y, r));
    if (remaining.length !== strokesRef.current.length) {
      strokesRef.current = remaining;
      setStrokes(remaining);
    }
  };

  const onDown = (e: React.PointerEvent) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    e.preventDefault();
    canvasRef.current!.setPointerCapture(e.pointerId);
    const pt = toCanvas(e);
    if (tool === 'eraser') {
      erasing.current = { before: strokes };
      eraseAt(pt[0], pt[1]);
      return;
    }
    current.current = { tool, color, size, points: [pt], fill: fill || undefined };
    redraw();
  };

  const onMove = (e: React.PointerEvent) => {
    if (erasing.current) {
      const pt = toCanvas(e);
      eraseAt(pt[0], pt[1]);
      return;
    }
    const s = current.current;
    if (!s) return;
    // Use coalesced events for smoother lines with fast pens
    const events = (e.nativeEvent as PointerEvent).getCoalescedEvents?.() ?? [e.nativeEvent];
    for (const ev of events.length ? events : [e.nativeEvent]) {
      const pt = toCanvas(ev as unknown as React.PointerEvent);
      if (s.tool === 'pen' || s.tool === 'highlighter') {
        const last = s.points[s.points.length - 1];
        if (Math.hypot(pt[0] - last[0], pt[1] - last[1]) >= 1.2) s.points.push(pt);
      } else {
        let [x, y] = pt;
        if (e.shiftKey) {
          const [ox, oy] = s.points[0];
          if (s.tool === 'rect' || s.tool === 'ellipse') {
            const d = Math.max(Math.abs(x - ox), Math.abs(y - oy));
            x = ox + Math.sign(x - ox || 1) * d;
            y = oy + Math.sign(y - oy || 1) * d;
          } else {
            // snap lines to 45°
            const ang = Math.round(Math.atan2(y - oy, x - ox) / (Math.PI / 4)) * (Math.PI / 4);
            const len = Math.hypot(x - ox, y - oy);
            x = ox + len * Math.cos(ang);
            y = oy + len * Math.sin(ang);
          }
        }
        s.points = [s.points[0], [x, y, pt[2]]];
      }
    }
    redraw();
  };

  const onUp = () => {
    if (erasing.current) {
      const before = erasing.current.before;
      erasing.current = null;
      if (before.length !== strokesRef.current.length) {
        setUndoStack((u) => [...u, before]);
        setRedoStack([]);
      }
      return;
    }
    const s = current.current;
    current.current = null;
    if (!s) return;
    const isShape = s.tool !== 'pen' && s.tool !== 'highlighter';
    if (isShape && (s.points.length < 2 || Math.hypot(s.points[1][0] - s.points[0][0], s.points[1][1] - s.points[0][1]) < 3)) {
      redraw();
      return;
    }
    commit([...strokes, s]);
  };

  // Keyboard: undo/redo, tool shortcuts. Stop events reaching the document editor.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        e.stopPropagation();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        e.stopPropagation();
        redo();
        return;
      }
      if (mod) {
        // keep Ctrl+S / Ctrl+P etc. from firing on the document underneath
        e.stopPropagation();
        return;
      }
      const map: Record<string, Tool> = { p: 'pen', h: 'highlighter', e: 'eraser', l: 'line', a: 'arrow', r: 'rect', o: 'ellipse' };
      if (map[e.key.toLowerCase()]) setTool(map[e.key.toLowerCase()]);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [undo, redo, onClose]);

  const save = () => {
    if (!strokes.length) {
      onClose();
      return;
    }
    const data: DrawingData = { v: 1, w: W, h: H, background, strokes };
    onSave({ data, ...renderDrawing(data) });
  };

  const tools: { id: Tool; label: string; icon: React.ReactNode; key: string }[] = [
    { id: 'pen', label: 'Pen', icon: <PenLine size={18} />, key: 'P' },
    { id: 'highlighter', label: 'Highlighter', icon: <Highlighter size={18} />, key: 'H' },
    { id: 'eraser', label: 'Eraser', icon: <Eraser size={18} />, key: 'E' },
    { id: 'line', label: 'Line', icon: <Minus size={18} />, key: 'L' },
    { id: 'arrow', label: 'Arrow', icon: <ArrowUpRight size={18} />, key: 'A' },
    { id: 'rect', label: 'Rectangle', icon: <Square size={18} />, key: 'R' },
    { id: 'ellipse', label: 'Ellipse', icon: <Circle size={18} />, key: 'O' },
  ];

  return createPortal(
    <div className="modal-backdrop draw-backdrop" onMouseDown={(e) => e.target === e.currentTarget && e.preventDefault()}>
      <div className="draw-dialog" role="dialog" aria-modal="true" aria-label="Drawing">
        <div className="draw-header">
          <h2>{initial ? 'Edit drawing' : 'New drawing'}</h2>
          <div className="row gap-sm">
            <button className="btn btn-sm" onClick={onClose}>
              Cancel
            </button>
            <button className="btn btn-sm btn-primary" onClick={save}>
              {initial ? 'Save' : 'Insert'}
            </button>
            <button className="icon-btn sm" onClick={onClose} aria-label="Close drawing">
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="draw-toolbar" role="toolbar" aria-label="Drawing tools">
          <div className="draw-group">
            {tools.map((t) => (
              <button
                key={t.id}
                className={`tb-btn${tool === t.id ? ' active' : ''}`}
                onClick={() => setTool(t.id)}
                title={`${t.label} (${t.key})`}
                aria-label={t.label}
                aria-pressed={tool === t.id}
              >
                {t.icon}
              </button>
            ))}
            {(tool === 'rect' || tool === 'ellipse') && (
              <button
                className={`tb-btn${fill ? ' active' : ''}`}
                onClick={() => setFill(!fill)}
                title="Fill shape"
                aria-label="Fill shape"
                aria-pressed={fill}
              >
                <PaintBucket size={18} />
              </button>
            )}
          </div>
          <span className="tb-sep" />
          <div className="draw-group">
            {COLORS.map((c) => (
              <button
                key={c}
                className={`draw-swatch${color === c ? ' active' : ''}`}
                style={{ background: c }}
                onClick={() => {
                  setColor(c);
                  if (tool === 'eraser') setTool('pen');
                }}
                aria-label={`Colour ${c}`}
                title={c}
              />
            ))}
            <label className="draw-swatch custom" title="Custom colour">
              <input
                type="color"
                value={color}
                onChange={(e) => {
                  setColor(e.target.value);
                  if (tool === 'eraser') setTool('pen');
                }}
                aria-label="Custom colour"
              />
            </label>
          </div>
          <span className="tb-sep" />
          <div className="draw-group">
            {SIZES.map((s) => (
              <button
                key={s}
                className={`tb-btn${size === s ? ' active' : ''}`}
                onClick={() => setSize(s)}
                title={`Size ${s}`}
                aria-label={`Brush size ${s}`}
                aria-pressed={size === s}
              >
                <span className="size-dot" style={{ width: Math.min(18, s + 2), height: Math.min(18, s + 2) }} />
              </button>
            ))}
          </div>
          <span className="tb-sep" />
          <div className="draw-group">
            <button className="tb-btn" onClick={undo} disabled={!undoStack.length} title="Undo (Ctrl/⌘+Z)" aria-label="Undo">
              <Undo2 size={18} />
            </button>
            <button className="tb-btn" onClick={redo} disabled={!redoStack.length} title="Redo" aria-label="Redo">
              <Redo2 size={18} />
            </button>
            <button
              className="tb-btn"
              onClick={() => strokes.length && commit([])}
              disabled={!strokes.length}
              title="Clear drawing"
              aria-label="Clear drawing"
            >
              <Trash2 size={18} />
            </button>
            <select
              className="tb-select"
              value={background}
              onChange={(e) => setBackground(e.target.value as DrawingData['background'])}
              aria-label="Background"
              title="Background"
            >
              <option value="white">White</option>
              <option value="grid">Grid</option>
              <option value="transparent">No background</option>
            </select>
          </div>
        </div>

        <div className="draw-stage">
          <canvas
            ref={canvasRef}
            className={`draw-canvas tool-${tool}`}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
            aria-label="Drawing canvas"
          />
        </div>
        <p className="draw-hint muted small">
          Draw with a mouse, finger or stylus (pressure-sensitive). Hold Shift for straight lines, squares and circles.
        </p>
      </div>
    </div>,
    document.body,
  );
}
