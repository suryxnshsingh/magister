/**
 * How long before its anchor a board op should start.
 *
 * The model emits a tool call after speaking the phrase it belongs to, so the
 * anchor is the end of those words. Left alone, every op lands after the thing
 * it illustrates — speak, then write, which is the slideshow this project
 * exists to avoid.
 *
 * Starting each op early by about its own duration makes the chalk and the
 * sentence finish together, the way a teacher writes while talking. The
 * estimate only has to be roughly right: the scheduler clamps it so nothing
 * can precede the first word of its own turn.
 *
 * Deliberately cheap — no typesetting, no layout. Resolving the op here would
 * advance the layout cursor, and the op is not being drawn yet.
 */

/** Rough writing speed for the plain notation the model emits. */
const MS_PER_CHAR = 78;
const WRITE_MIN = 900;
const WRITE_MAX = 4200;

/** Fraction of a write's duration to overlap with the speech. */
const OVERLAP = 0.8;

export function startEarlyMs(name: string, args: Record<string, unknown>): number {
  switch (name) {
    case 'write':
    case 'rewrite': {
      const content = typeof args.content === 'string' ? args.content : '';
      const est = Math.min(WRITE_MAX, Math.max(WRITE_MIN, content.length * MS_PER_CHAR));
      return est * OVERLAP;
    }
    case 'draw':
      // One shape is a quick gesture, not a construction — it should land on
      // the phrase that names it rather than ahead of it.
      return 500;
    case 'scene':
      // A construction takes a while to draw and the teacher talks over it.
      return 2200;
    case 'step':
      return 900;
    case 'erase':
      // Ahead of everything else it could be batched with, because an erase is
      // preparation: the model says "chalo, ab reflection dekhte hain" and
      // emits the clear and what replaces it in the same breath. Firing them
      // in the wrong order would wipe the new work instead of the old.
      return 2600;
    case 'mark':
      // "...aur ye kabhi change nahi hoti" — the underline should be landing
      // as the clause ends, so it starts a beat before.
      return 600;
    case 'point':
      // Deixis must be early or it is pointless: the tap belongs ON "yahan
      // dekho", not after it.
      return 850;
    case 'note':
      // A margin remark lands as it is said, like a mark.
      return 600;
    default:
      return 0;
  }
}

/**
 * Roughly how long an op keeps the chalk busy, ms — so calls the model sends
 * together can be drawn one after another instead of all at once.
 *
 * gemini-3.8-live sends up to seven calls in one message, and every one of
 * them carries the same position in the audio: without this, a whole
 * free-body diagram appears in a single frame, which is a slide, not a
 * teacher drawing it. Zero means "never staggered": an erase is preparation
 * and must keep its place AHEAD of the work it clears the way for.
 */
export function busyMs(name: string, args: Record<string, unknown>): number {
  switch (name) {
    case 'write': {
      const content = typeof args.content === 'string' ? args.content : '';
      return Math.min(WRITE_MAX, Math.max(WRITE_MIN, content.length * MS_PER_CHAR));
    }
    case 'draw':
      return 650;
    case 'mark':
    case 'note':
      return 550;
    case 'point':
      return 620;
    case 'step':
      return 900;
    case 'scene':
      return 1200;
    case 'resume':
      return 1200;
    default:
      return 0;
  }
}
