/**
 * Which board reply wakes the teacher.
 *
 * Board tools are answered when their chalk lands — seconds after the model
 * asked for them — and answered SILENT: "add the result to the context, do not
 * trigger generation". That is right for a call the model makes in passing
 * while it talks. Answering those any other way starts a fresh turn every time
 * the teacher's own chalk lands.
 *
 * It is fatal for a model that has STOPPED to wait. gemini-3.8-live regularly
 * ends a generation on its tool calls — measured on 5/5 lesson openers: a turn
 * of nothing but `write`s and `turnComplete`, not one sample of speech — and a
 * model waiting on a result that comes back SILENT waits for ever. The board
 * draws and the lesson dies there, a teacher standing mute beside a diagram
 * until the student asks why it keeps stopping. WHEN_IDLE, the API's own
 * default, restarted every one of those turns.
 *
 * What the model is waiting on is a generation's TRAILING calls: the ones after
 * its last word. The last of them to be answered is answered WHEN_IDLE; every
 * other reply stays SILENT. Whether a call is trailing is only known once the
 * generation either speaks again or ends, so a reply ready before then is held
 * until one of those happens — a few milliseconds, in practice.
 */

/** Sends one reply; `wake` asks the model to carry on. */
export type Send = (wake: boolean) => void;

interface Generation {
  /** Calls since the last chunk of speech — what it would be waiting on. */
  trailing: Set<string>;
  /** Replies that were ready before anyone knew whether it was waiting. */
  held: Map<string, Send>;
  done: boolean;
  /** The student cut in. Their turn restarts the model; nothing here should. */
  cut: boolean;
}

export class Wakeup {
  private gen: Generation | null = null;
  private owner = new Map<string, Generation>();
  /** Which generation is holding each held reply. */
  private holder = new Map<string, Generation>();

  private current(): Generation {
    if (!this.gen || this.gen.done) {
      this.gen = { trailing: new Set(), held: new Map(), done: false, cut: false };
    }
    return this.gen;
  }

  /** A board call arrived. */
  call(id: string) {
    const g = this.current();
    g.trailing.add(id);
    this.owner.set(id, g);
  }

  /** Speech arrived: nothing asked for before it was being waited on. */
  audio() {
    const g = this.current();
    for (const [id, send] of g.held) {
      this.holder.delete(id);
      send(false);
    }
    g.held.clear();
    g.trailing.clear();
  }

  /** The server cut this generation off because the student began speaking. */
  interrupted() {
    const g = this.gen;
    if (!g || g.done) return;
    g.cut = true;
    g.done = true;
    for (const [id, send] of g.held) {
      this.holder.delete(id);
      send(false);
    }
    g.held.clear();
    g.trailing.clear();
  }

  /**
   * The generation is over. Returns the calls it ended on — what the model is
   * now waiting for — so they can be drawn without waiting on speech that is
   * never coming.
   *
   * Safe to call for both of the server's end signals; the second is a no-op.
   */
  turnComplete(): string[] {
    return this.gen ? this.finish(this.gen) : [];
  }

  /**
   * A reply has been held this long and nothing has said whether the model is
   * waiting on it. Stop holding it: treat its generation as over. A held reply
   * that is never sent is worse than any scheduling of it — the model would
   * be waiting on a call that has already been drawn.
   */
  expire(id: string): string[] {
    const g = this.holder.get(id);
    return g && g.held.has(id) ? this.finish(g) : [];
  }

  private finish(g: Generation): string[] {
    if (g.done) return [];
    g.done = true;
    const waiting = [...g.trailing];
    const held = [...g.held];
    g.held.clear();
    for (const [id, send] of held) {
      this.holder.delete(id);
      g.trailing.delete(id);
      send(g.trailing.size === 0);
    }
    return waiting;
  }

  /**
   * This call's result is ready. `send` is called now, or once it is known
   * whether to wake — in which case this returns true, and the caller should
   * {@link expire} it if that never becomes known.
   */
  answer(id: string, send: Send): boolean {
    const g = this.owner.get(id);
    this.owner.delete(id);
    if (!g || g.cut || !g.trailing.has(id)) {
      send(false);
      return false;
    }
    if (!g.done) {
      g.held.set(id, send);
      this.holder.set(id, g);
      return true;
    }
    g.trailing.delete(id);
    send(g.trailing.size === 0);
    return false;
  }

  /**
   * This call was answered some other way — dropped because the student cut
   * in, or cancelled by the server — and must not be waited on.
   */
  drop(id: string) {
    const g = this.owner.get(id) ?? this.holder.get(id);
    this.owner.delete(id);
    if (!g) return;
    g.trailing.delete(id);
    g.held.delete(id);
    this.holder.delete(id);
  }
}
