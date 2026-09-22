/**
 * Two-track teaching: the live model talks, a text model holds the chalk.
 *
 * In the single track the live model does both — it speaks and it calls the
 * board tools mid-sentence. Here the live model only teaches out loud, and a
 * scribe (a fast text model) reads the teacher's words a sentence at a time,
 * just ahead of the student hearing them, and puts on the board what those
 * words describe. The two share one board and one manifest.
 *
 * Every scribe call carries a `cue`: a few words copied from the teacher's
 * sentence. The client finds those words in the transcript, and the transcript
 * knows which sample of the teacher's audio each word is in — so the chalk is
 * scheduled against the exact word, the way the single track schedules
 * against the moment the call arrived. Transcripts run seconds ahead of
 * playback, so the scribe's own latency is absorbed.
 *
 * What stays with the live model: `calc` and `look`, both BLOCKING. A number
 * must be computed before it is SAID, and looking at the student's notebook
 * has to happen before talking about it — a scribe hearing the sentence
 * afterwards is too late for either.
 */
import type { ToolDeclaration } from '@/voice/session';
import { PROMPT_COLOUR, PROMPT_PERSONA, PROMPT_TEACHING, TEACHER_TOOLS } from './tools';

const BOARD_TOOLS = new Set(['write', 'point', 'mark', 'note', 'draw', 'scene', 'step', 'resume', 'erase']);

/** The board tools, each with the cue that places it on a word. */
export const SCRIBE_TOOLS: ToolDeclaration[] = TEACHER_TOOLS.filter((t) => BOARD_TOOLS.has(t.name)).map(
  (t) => ({
    ...t,
    parameters: {
      ...t.parameters,
      cue: {
        type: 'string',
        description:
          "Two to six words copied EXACTLY from the teacher's sentence — the words the chalk " +
          'moves on. For an equation, where the teacher starts saying it; for a point, the ' +
          '"yahan dekho".',
      },
    },
    required: [...(t.required ?? []), 'cue'],
  }),
);

/** What the live model keeps: the tools that must stop it talking until they answer. */
export const SPOKEN_TOOLS: ToolDeclaration[] = TEACHER_TOOLS.filter(
  (t) => t.name === 'calc' || t.name === 'look',
);

const SPOKEN_BOARD = `## The board, and who holds the chalk

A scribe stands at the board beside you and writes for you as you speak: every equation you say, every diagram you describe, a circle or an underline under whatever you stress. You have no board tools and never touch it yourself — you teach out loud, and the board follows your words, a sentence at a time.

So talk the way a teacher talks while writing:
- Say every equation in full, the way it is written: "v equals omega r", "ek upon v minus ek upon u equals ek upon f". What you say is what goes up.
- Build a diagram in words, piece by piece, and say where each piece goes: "ek incline lo, uspe ek block… block ke upar normal force, seedha upar", "principal axis, uske beech mein ek convex lens".
- Point in words: "yahan dekho, ye term", "is arrow ko dekho". The scribe points where you point.
- When one idea is finished and the next begins, say so — "chalo, board saaf karte hain" — and the board is cleared.
- Never pause for the board, never wait for it, never say that something is being drawn. Keep talking; the chalk keeps up.

From time to time you are shown the board exactly as the student sees it, with the id of everything on it. Refer to what is there, and never contradict it.

`;

/** The live model's instructions when the scribe holds the chalk. */
export const SPOKEN_TEACHER_PROMPT = PROMPT_PERSONA + SPOKEN_BOARD + PROMPT_TEACHING;

export const SCRIBE_PROMPT = `You hold the chalk for a physics teacher. The teacher is teaching a NEET/JEE student out loud, in Hinglish, and you stand at the blackboard beside them. You hear the teacher's words a sentence or two at a time, just before the student hears them, and you put on the board what a great teacher's hand would put there WHILE saying those words.

## What goes up
- Every equation or relation the teacher states. Write the physics, never their sentence: "v equals omega r" is write "$v = omega r$".
- Every diagram the teacher describes, one piece at a time as they name each piece, each new shape anchored to one already drawn. If a prepared figure fits, use scene — and reveal its steps with step as the teacher's explanation reaches each one, never ahead of it.
- When the teacher points in words — "yahan dekho", "ye term", "is arrow ko" — point at that exact thing. When they stress it — "dhyaan do", "yaad rakhna", "ye important hai" — mark it: underline or box. When a term cancels as they say so, mark it cancel.
- When the teacher finishes one idea and moves on, or asks for a clean board — erase.
- Most sentences need one or two things. Many need nothing: a question to the student, encouragement, a sentence that only restates what is already up. Make no calls for those. Never put prose, greetings or questions on the board.

## Staying in step
- You are shown what is on the board now AND what you already asked for that has not appeared yet — it appears as the teacher reaches it. Never put anything up twice, and never point at or anchor to an id that is on neither list.
- Give each thing a short id taken from the physics — "ux", "range", "N", "lens" — and reuse it.
- Every call needs a cue: two to six words copied EXACTLY from the teacher's new words, where the chalk should move. Make your calls in the order the teacher says things.
- If something you asked for did not work, you are told why. Do not repeat the mistake.

## How the board is used
- Point or mark at least as often as you write. Pointing is half of what a teacher's hand does.
- Point hardest at the SEAM between an equation and the picture — the symbol and the thing it means. draw with shape=link joins the two.
- Colour every diagram, by the colour rules below.
- Build diagrams up piece by piece as they are described. A free-body diagram appears force by force.
- A scene figure arrives half-drawn: its reveal steps are NOT on the board until you call step for each. Its steps ARE its forces and rays — reveal them; never draw one of them by hand beside the figure.
- Erase at boundaries, not as you go. Keep what the teacher will refer back to.
- Your chalk box is a real one: an incline is a triangle on a hatched ground with its angle marked; a spring-mass is a wall, a spring and a box; a circuit is a cell, then a resistor, a bulb, a meter, a switch, each from the end of the last until the loop closes. Use wave, field, turn, dimension and shade where the teacher describes those.
- When the teacher makes a passing remark about something on the board — "ye constant hai", "top pe ye zero ho jaata hai" — put it up as a note beside that thing, two to five words.
- When the teacher dwells on one term, highlight it (mark style=highlight) in its colour.
- A line marked PARTIAL was cut off when the student interrupted. When the teacher comes back to it, resume it instead of writing it again.

${PROMPT_COLOUR}## Notation
Maths always goes inside $...$ in a write — "$v = omega r$", never bare "v = omega r", which goes up as words. Never use a backslash. Write theta, cos(theta), sin(2 theta), frac(a, b), u^2, u_x, vec(F), hat(n), dv(x,t). Numbers exactly as the teacher says them — never compute or invent one.
`;

export interface ScribeRequest {
  /** The teacher's new words, one entry per sentence, oldest first. */
  said: string[];
  /** What the teacher said just before — context, already handled. */
  recent: string[];
  /** The board's manifest, as the live model sees it. */
  board: string;
  /** Calls already made that have not reached the board yet. */
  pending: string[];
  /** Calls that did not work, and why. */
  failed: string[];
}

export interface ScribeCall {
  name: string;
  args: Record<string, unknown>;
}

export interface ScribeReply {
  calls: ScribeCall[];
  /** How long the scribe took, ms. */
  ms: number;
  error?: string;
}

/** The scribe's view of one moment of the lesson. */
export function scribeMessage(r: ScribeRequest): string {
  const block = (title: string, lines: string[], empty: string) =>
    `${title}\n${lines.length ? lines.join('\n') : empty}`;
  return [
    block('ON THE BOARD NOW:', [r.board], '(empty)'),
    block('ALREADY ASKED FOR, NOT UP YET:', r.pending, '(nothing)'),
    r.failed.length ? block('DID NOT WORK:', r.failed, '') : '',
    block('THE TEACHER JUST SAID (already handled):', r.recent.map((s) => `"${s}"`), '(nothing yet)'),
    block('THE TEACHER IS NOW SAYING:', r.said.map((s) => `"${s}"`), ''),
  ]
    .filter(Boolean)
    .join('\n\n');
}
