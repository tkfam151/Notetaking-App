import { useRef } from 'react';
import type { PageSetup } from '../types';

const DPI = 96;

/** A Word-style horizontal ruler. Drag the triangles to change the left and right margins. */
export function Ruler({
  widthIn,
  setup,
  onChange,
}: {
  widthIn: number;
  setup: PageSetup;
  onChange: (m: PageSetup['margins']) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const ticks = [];
  for (let i = 0; i <= widthIn * 8; i++) {
    const x = (i / 8) * DPI;
    const major = i % 8 === 0;
    const half = i % 4 === 0;
    ticks.push(
      <div key={i} className={`tick${major ? ' major' : half ? ' half' : ''}`} style={{ left: x }}>
        {major && i > 0 && i < widthIn * 8 && <span>{i / 8}</span>}
      </div>,
    );
  }

  const drag = (side: 'left' | 'right') => (e: React.PointerEvent) => {
    e.preventDefault();
    const el = ref.current!;
    const rect = el.getBoundingClientRect();
    const scale = rect.width / (widthIn * DPI);
    const move = (ev: PointerEvent) => {
      const inches = (ev.clientX - rect.left) / scale / DPI;
      const snapped = Math.round(inches * 8) / 8;
      const m = { ...setup.margins };
      if (side === 'left') m.left = Math.max(0, Math.min(snapped, widthIn - m.right - 1));
      else m.right = Math.max(0, Math.min(widthIn - snapped, widthIn - m.left - 1));
      onChange(m);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <div className="ruler" ref={ref} style={{ width: widthIn * DPI }} aria-hidden>
      <div className="ruler-margin" style={{ left: 0, width: setup.margins.left * DPI }} />
      <div className="ruler-margin" style={{ right: 0, width: setup.margins.right * DPI }} />
      {ticks}
      <div className="ruler-handle" style={{ left: setup.margins.left * DPI }} onPointerDown={drag('left')} title="Left margin" />
      <div
        className="ruler-handle"
        style={{ left: (widthIn - setup.margins.right) * DPI }}
        onPointerDown={drag('right')}
        title="Right margin"
      />
    </div>
  );
}
