/**
 * Shared contract for presence renderers.
 *
 * Two are implemented — an aurora band and a plasma filament — so they can be
 * compared as the same thing rather than as two different components. Whatever
 * wins, the session only ever talks to this interface.
 */
export type PresenceState =
  | 'idle'
  /** Socket opening / mic starting. Must be unmistakable: speaking into a
   *  session that is not live yet is the commonest way to lose a first turn. */
  | 'connecting'
  | 'listening'
  | 'thinking'
  | 'speaking'
  /** Dropped, refused, or retrying. */
  | 'error';

export interface PresenceProps {
  state: PresenceState;
  /** 0..1 — the teacher's own voice while speaking, the mic while listening. */
  level?: number;
  /** Where attention is, in 0..1 of the board. Drives the lean. */
  gaze?: { x: number; y: number } | null;
  className?: string;
}

export const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

export const hexToRgb = (h: string): [number, number, number] => [
  parseInt(h.slice(1, 3), 16) / 255,
  parseInt(h.slice(3, 5), 16) / 255,
  parseInt(h.slice(5, 7), 16) / 255,
];

/**
 * Loudness -> 0..1, saturating smoothly.
 *
 * A hard clamp makes loud passages pin to maximum and then fall off a cliff,
 * which is what made the first version jerky.
 */
export const softKnee = (level: number, gain = 2.2) =>
  1 - Math.exp(-Math.max(0, level) * gain);
