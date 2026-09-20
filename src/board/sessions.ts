/**
 * Recorded lessons.
 *
 * Every live session writes its op log here as it happens, so any moment can
 * be re-watched afterwards at `/replay?session=<id>`. That matters for three
 * different reasons and it is worth naming all of them, because they pull the
 * design in the same direction:
 *
 *  - **Debugging.** A bad beat in a live take is gone the instant it happens.
 *    With the log it can be scrubbed frame by frame, which is how every board
 *    bug so far has actually been found.
 *  - **The demo.** The take is best-of-N. Being able to watch back each take
 *    and compare them is the difference between judging by memory and judging
 *    by evidence.
 *  - **The artefact.** The student leaves with the board they just built,
 *    replayable, rather than a chat transcript.
 *
 * Ops are recorded at the moment they FIRE — against the playback clock, not
 * the socket — so a replay has the same rhythm the student heard. Timestamps
 * from arrival would replay the lesson 5–13 seconds out of step with itself.
 *
 * localStorage, not IndexedDB: an op log is a few KB of text, this runs on one
 * machine, and a synchronous write means a crashed session still leaves its
 * log behind.
 */
import type { Op } from './oplog';

const KEY = 'tutor.sessions';
const MAX = 20;

export interface RecordedSession {
  id: string;
  /** Wall-clock start, so the list reads as a history. */
  startedAt: number;
  /** First thing the teacher wrote — the closest thing to a lesson title. */
  title: string;
  ops: Op[];
}

function readAll(): RecordedSession[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as RecordedSession[]) : [];
  } catch {
    // A corrupt or unavailable store must never take the lesson down with it.
    return [];
  }
}

function writeAll(list: RecordedSession[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
  } catch {
    // Quota exceeded, private mode, storage disabled — all survivable. The
    // lesson keeps running; only the recording is lost.
  }
  invalidate();
}

export function listSessions(): RecordedSession[] {
  return readAll().sort((a, b) => b.startedAt - a.startedAt);
}

/**
 * The recorded list as a React external store.
 *
 * Reading localStorage during render is a hydration mismatch waiting to
 * happen: the server has no storage, so it renders the empty case while the
 * client renders a populated one. `useSyncExternalStore` is the part of React
 * built for this — it hydrates against {@link serverSessionsSnapshot} and
 * switches to the real list immediately afterwards, so the two renders agree.
 *
 * The snapshot is cached because `getSnapshot` must return a stable reference;
 * re-parsing the JSON on every call would hand React a new array each time and
 * loop forever.
 */
let cache: RecordedSession[] | null = null;
const EMPTY: RecordedSession[] = [];
const listeners = new Set<() => void>();

function invalidate() {
  cache = null;
  for (const fn of listeners) fn();
}

export function subscribeSessions(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function sessionsSnapshot(): RecordedSession[] {
  if (cache === null) cache = listSessions();
  return cache;
}

export function serverSessionsSnapshot(): RecordedSession[] {
  return EMPTY;
}

export function loadSession(id: string): RecordedSession | null {
  return readAll().find((s) => s.id === id) ?? null;
}

export function deleteSession(id: string) {
  writeAll(readAll().filter((s) => s.id !== id));
}

/**
 * A recorder for one live session.
 *
 * Holds the ops in memory and flushes to storage on a timer, so a lesson that
 * draws thirty things does not serialise the whole log thirty times. `flush()`
 * is called on session end; the interval covers a session that never ends
 * cleanly, which is most of them.
 */
export class SessionRecorder {
  readonly id = `s${Date.now().toString(36)}`;
  private ops: Op[] = [];
  private startedAt = Date.now();
  private dirty = false;
  private timer: ReturnType<typeof setInterval> | null = null;

  start() {
    this.timer = setInterval(() => this.flush(), 4000);
  }

  add(op: Op) {
    this.ops.push(op);
    this.dirty = true;
  }

  /**
   * Record that the student cut in `at` (0..1) of the way through a line.
   *
   * A freeze is not a tool call — it comes from the microphone — so it never
   * passes through the dispatcher and would otherwise be missing from the log
   * entirely. That would make a recorded lesson replay the one beat the whole
   * project is built around as a smooth, uninterrupted write.
   *
   * It is stored on the write op itself, which is the form `Scene.build()`
   * already replays.
   */
  interrupt(id: string, at: number) {
    for (let i = this.ops.length - 1; i >= 0; i--) {
      const op = this.ops[i];
      if (op.kind === 'write' && op.id === id) {
        op.interruptedAt = Math.min(1, Math.max(0, at));
        this.dirty = true;
        return;
      }
    }
  }

  /** The first line written, which is nearly always what the lesson is about. */
  private title(): string {
    const first = this.ops.find((o) => o.kind === 'write');
    if (!first || !('content' in first)) return 'untitled lesson';
    return String(first.content).replace(/\$/g, '').slice(0, 60);
  }

  flush() {
    if (!this.dirty || this.ops.length === 0) return;
    this.dirty = false;
    const rest = readAll().filter((s) => s.id !== this.id);
    writeAll([
      { id: this.id, startedAt: this.startedAt, title: this.title(), ops: this.ops },
      ...rest,
    ]);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.flush();
  }
}
