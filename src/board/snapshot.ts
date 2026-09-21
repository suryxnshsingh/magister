/**
 * What the student is looking at, as a picture the model can read.
 *
 * The model's picture of the board used to be a text summary of what it had
 * asked for — which is not what is there. A figure clamped to fit, a label
 * that landed on a ray, a step still fading in, a line half-written when the
 * student cut in: none of it reaches a list of ids. A picture carries all of
 * it, and measured on the Live API costs about what the sentence describing it
 * does (63 tokens at MEDIA_RESOLUTION_LOW for a 1024-wide board).
 *
 * Rasterised in the browser: serialise the board's own SVG, draw it onto a
 * canvas, encode. Self-contained because MathJax runs with `fontCache: 'none'`
 * — every glyph is an inline path, with no `<use>` pointing outside the board.
 * Elements marked `data-snapshot="skip"` are left out: the surface texture is
 * noise to a reader, its gradient names CSS variables that an SVG rendered as
 * an image cannot resolve, and the pen is the teacher's hand, not the board.
 */

export interface Snapshot {
  mimeType: 'image/jpeg';
  /** Base64, no data-URL prefix — the shape an inlineData part wants. */
  data: string;
  width: number;
  height: number;
}

/** A flat board colour behind the chalk, standing in for the skipped surface. */
const SURFACE = '#1f2a25';

export async function snapshotBoard(
  svg: SVGSVGElement,
  { width = 1024, quality = 0.8 }: { width?: number; quality?: number } = {},
): Promise<Snapshot> {
  const box = svg.viewBox.baseVal;
  const height = Math.round((width * box.height) / box.width);

  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.querySelectorAll('[data-snapshot="skip"]').forEach((el) => el.remove());
  clone.removeAttribute('style');
  clone.removeAttribute('class');
  clone.setAttribute('width', String(width));
  clone.setAttribute('height', String(height));
  const markup = new XMLSerializer().serializeToString(clone);

  const img = new Image();
  img.decoding = 'async';
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
  await img.decode();

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2d context for the board snapshot');
  ctx.fillStyle = SURFACE;
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);

  const url = canvas.toDataURL('image/jpeg', quality);
  return { mimeType: 'image/jpeg', data: url.slice(url.indexOf(',') + 1), width, height };
}
