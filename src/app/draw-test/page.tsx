'use client';

/**
 * Every shape `draw` can make, in the board's inks — the acceptance test for
 * the primitive layer.
 *
 * A path string existing is not the same as a spring that looks like a
 * spring, so this renders the real `buildShape` output, fully revealed, on
 * the real board colours. Below the catalogue, two diagrams built only from
 * these primitives the way the teacher would build them: a colour-coded
 * free-body diagram on an incline, and a circuit.
 */
import { useEffect, useRef } from 'react';

import { buildShape, SHAPES, type Shape, type ShapeSpec } from '@/board/draw-shapes';
import { INKS, type Ink } from '@/board/templates/primitives';
import { CANVAS_H, CANVAS_W, type Pt } from '@/board/units';

const COLS = 6;
const CELL_W = CANVAS_W / COLS;
const CELL_H = 190;

/** Where each shape's points go inside its cell. */
function specFor(shape: Shape, o: Pt): Omit<ShapeSpec, 'shape'> {
  const p = (x: number, y: number): Pt => ({ x: o.x + x, y: o.y + y });
  switch (shape) {
    case 'dot':
    case 'charge':
      return { from: p(120, 80), text: shape === 'charge' ? '+' : undefined };
    case 'label':
      return { from: p(120, 80), text: 'F_N = mg cos theta' };
    case 'circle':
      return { from: p(120, 80), to: p(170, 80) };
    case 'box':
      return { from: p(60, 40), to: p(180, 120) };
    case 'angle':
      return { from: p(40, 130), to: p(200, 130), to2: p(170, 40), text: 'theta' };
    case 'turn':
      return { from: p(120, 85), to: p(165, 85), text: 'tau' };
    case 'triangle':
      return { from: p(30, 140), to: p(210, 140), to2: p(210, 40) };
    case 'shade':
      return { from: p(40, 40), to: p(200, 130) };
    case 'curve':
    case 'curvearrow':
      return { from: p(30, 130), to: p(210, 130), to2: p(120, 30) };
    case 'field':
      return { from: p(60, 85), to: p(190, 85), n: 3 };
    case 'dimension':
      return { from: p(30, 110), to: p(210, 110), text: 'd' };
    case 'meter':
      return { from: p(20, 80), to: p(220, 80), text: 'V' };
    default:
      return { from: p(20, 80), to: p(220, 80) };
  }
}

const INK_CYCLE: Ink[] = ['chalk', 'yellow', 'blue', 'red', 'green', 'orange', 'purple'];

function reveal(g: SVGGElement) {
  g.querySelectorAll<SVGElement>('path, text, circle').forEach((el) => {
    el.style.opacity = '1';
  });
}

export default function DrawTest() {
  const root = useRef<SVGGElement>(null);

  useEffect(() => {
    const host = root.current;
    if (!host) return;
    host.replaceChildren();
    const add = (id: string, spec: ShapeSpec) => {
      const built = buildShape(id, spec);
      reveal(built.group);
      host.appendChild(built.group);
    };

    SHAPES.forEach((shape, i) => {
      const o = { x: (i % COLS) * CELL_W + 20, y: Math.floor(i / COLS) * CELL_H + 20 };
      add(`cat-${shape}`, { shape, colour: INK_CYCLE[i % INK_CYCLE.length], ...specFor(shape, o) });
      const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      t.setAttribute('x', String(o.x));
      t.setAttribute('y', String(o.y + 170));
      t.setAttribute('fill', INKS.dim);
      t.setAttribute('font-size', '20');
      t.textContent = shape;
      host.appendChild(t);
    });

    // A free-body diagram on an incline, forces colour-coded by kind.
    const y0 = Math.ceil(SHAPES.length / COLS) * CELL_H + 40;
    const A = { x: 80, y: y0 + 300 };
    const B = { x: 620, y: y0 + 300 };
    const C = { x: 620, y: y0 + 20 };
    add('incline', { shape: 'triangle', from: A, to: B, to2: C });
    add('floor', { shape: 'ground', from: { x: 40, y: A.y }, to: { x: 700, y: A.y }, colour: 'dim' });
    add('theta', { shape: 'angle', from: A, to: B, to2: C, text: 'theta', colour: 'dim' });
    const blockC = { x: 360, y: y0 + 145 };
    add('block', { shape: 'box', from: { x: 320, y: y0 + 110 }, to: { x: 400, y: y0 + 180 } });
    add('mg', { shape: 'arrow', from: blockC, to: { x: blockC.x, y: blockC.y + 150 }, colour: 'red' });
    add('mgL', { shape: 'label', from: { x: blockC.x + 40, y: blockC.y + 160 }, text: 'mg', colour: 'red' });
    add('N', { shape: 'arrow', from: blockC, to: { x: blockC.x - 70, y: blockC.y - 135 }, colour: 'blue' });
    add('NL', { shape: 'label', from: { x: blockC.x - 95, y: blockC.y - 140 }, text: 'N', colour: 'blue' });
    add('f', { shape: 'arrow', from: blockC, to: { x: blockC.x + 125, y: blockC.y - 65 }, colour: 'orange' });
    add('fL', { shape: 'label', from: { x: blockC.x + 150, y: blockC.y - 75 }, text: 'f', colour: 'orange' });

    // A circuit, component by component, end to end.
    const L = 820;
    const T = y0 + 40;
    const R = 1420;
    const Bm = y0 + 300;
    add('cell', { shape: 'cell', from: { x: L, y: Bm }, to: { x: L, y: T }, text: 'E' });
    add('r1', { shape: 'resistor', from: { x: L, y: T }, to: { x: 1120, y: T }, colour: 'orange', text: 'R_1' });
    add('bulb', { shape: 'bulb', from: { x: 1120, y: T }, to: { x: R, y: T }, colour: 'yellow' });
    add('amm', { shape: 'meter', from: { x: R, y: T }, to: { x: R, y: Bm }, text: 'A', colour: 'blue' });
    add('sw', { shape: 'switch', from: { x: R, y: Bm }, to: { x: 1120, y: Bm } });
    add('cap', { shape: 'capacitor', from: { x: 1120, y: Bm }, to: { x: L, y: Bm }, colour: 'green', text: 'C' });
  }, []);

  return (
    <main className="min-h-screen p-6" style={{ background: 'var(--void)' }}>
      <svg
        viewBox={`0 0 ${CANVAS_W} ${CANVAS_H * 1.6}`}
        style={{ width: '100%', background: 'var(--board-lit)', borderRadius: 3 }}
      >
        <g ref={root} />
      </svg>
    </main>
  );
}
