/**
 * Draw the chalk tip straight into the DOM.
 *
 * The pen must not go through React state. Strokes are written into the SVG by
 * each animation's `apply()` during the clock tick; routing the tip through
 * `setState` puts it a render behind, so the dot visibly trails the ink it is
 * supposed to be making. Same tick, same DOM write, no lag.
 */
import type { PenState } from './pen';

const SVG_NS = 'http://www.w3.org/2000/svg';

export interface PenElements {
  group: SVGGElement;
  tip: SVGCircleElement;
  halo: SVGCircleElement;
}

export function createPenElements(parent: SVGGElement): PenElements {
  const group = document.createElementNS(SVG_NS, 'g');
  const halo = document.createElementNS(SVG_NS, 'circle');
  halo.setAttribute('r', '22');
  halo.setAttribute('fill', '#fff8e0');
  halo.setAttribute('opacity', '0.1');
  const tip = document.createElementNS(SVG_NS, 'circle');
  tip.setAttribute('r', '8');
  tip.setAttribute('fill', '#fff8e0');
  group.appendChild(halo);
  group.appendChild(tip);
  group.style.visibility = 'hidden';
  parent.appendChild(group);
  return { group, tip, halo };
}

export function renderPen(els: PenElements | null, pen: PenState | null) {
  if (!els) return;
  if (!pen?.pos) {
    els.group.style.visibility = 'hidden';
    return;
  }
  const { x, y } = pen.pos;
  els.group.style.visibility = 'visible';
  // Faded while travelling: the hand is between marks, not making one.
  els.group.style.opacity = pen.mode === 'travelling' ? '0.45' : '1';
  els.tip.setAttribute('cx', String(x));
  els.tip.setAttribute('cy', String(y));
  els.halo.setAttribute('cx', String(x));
  els.halo.setAttribute('cy', String(y));
  els.halo.setAttribute('r', String(22 + pen.tap * 14));
}
