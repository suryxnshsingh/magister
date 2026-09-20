/**
 * Every figure the teacher can draw, registered by importing this module.
 *
 * Registration happens as an import side effect, which is only safe if there is
 * exactly one place that does it. There were three — `scene.ts`, `tools.ts` and
 * the test page — and each had to remember the full list, so a figure added to
 * one would be drawable but not offered to the model, or offered and then
 * silently absent. A barrel makes adding a figure one edit here and one file.
 */
import './projectile';
import './graph';

export {
  describeFigures,
  figureNames,
  getFigure,
  parseParams,
  registerFigure,
  type FigureSpec,
} from './registry';
