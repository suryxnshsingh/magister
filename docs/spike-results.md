# M1 — voice spike

The go/no-go for the whole architecture. Everything downstream — the op
scheduler, the freeze design, the single-model decision — rests on one
question the docs cannot answer:

> **Does Gemini Live fire board tool calls *during* a spoken sentence, and how
> far ahead of the words do they arrive?**

`toolCall` is a separate top-level server message, so interleaving is
*possible*. Ordering against audio is not guaranteed anywhere, and nobody has
published this working. Hence measuring it before building on it.

## Running it

1. Put your key in `.env.local` at the project root (git-ignored):

   ```
   GEMINI_API_KEY=...
   ```

2. Restart `next dev` — env is read at server start.
3. Open `/spike`, hit **Start session**, and talk. Headphones, or the mic
   hears the teacher and barges in on itself.
4. Aim for **≥20 turns** and **≥10 board calls**. Openers that work:
   - "Sir, projectile ka range formula samajh nahi aata"
   - "Ball ko 20 meter per second se, 30 degree pe phenka — range kya hogi?"
   - Interrupt it mid-sentence on purpose, at least three times.
5. **Export JSON** and drop the numbers in the table below.

The key never reaches the browser: `/api/token` mints a single-use ephemeral
token (v1alpha, `uses: 1`, two-minute window to open the socket).

## Thresholds, and why they are strict

The deliverable is one unbroken take. Per-session averages are the wrong unit —
an op that lands correctly 70% of the time gives a clean run of 25 ops
essentially never (0.7²⁵ ≈ 0.0001). So these are per-op bars.

| Metric | Pass | Why |
|---|---|---|
| TTFA p80 | ≤ 800 ms | above ~1.2 s it reads as a machine |
| Ops landing during speech | ≥ 95% | one op outside its sentence spoils a take |
| Audio gap per call | ≤ 250 ms | tool args are generated in the speech stream, so they cost silence |
| Local HOLD on barge-in | ≤ 150 ms | the pen must stop with the voice |
| LaTeX corruption | 0 | see below — this is now structurally prevented |
| Deixis rate | ≥ 1 point/mark per 2 writes | a teacher that writes but never points is a narrator |

## Results — run 3, 2026-09-20

**The core question is answered: yes, Gemini Live fires board tool calls during
a spoken sentence.** 7 calls, 7 during speech, none narrated.

| Metric | Measured | Verdict |
|---|---|---|
| Ops during speech | **7/7 (100%)** | PASS (formal bar wants ≥10 calls) |
| Tool-call lead p50 | **~6.5 s** | huge, and decisive — see below |
| Tool-call lead range | 5.5 s – 13.2 s | |
| LaTeX corrupted | **0** | PASS — plain notation held |
| Narrated calls | **0** | PASS after the prompt rewrite |
| Barge-in | local HOLD + server `interrupted`, repeatedly | works |
| `calc` | `30² sin(60°)/10 = 77.9` | correct, in degrees |
| TTFA | not yet captured | outstanding |
| Lead slope | not yet captured | outstanding |

### The lead is 5–13 seconds, and that decides the scheduler

The server generates audio far ahead of playback, so when a `toolCall` lands
there are still several seconds of unplayed speech queued. Firing the board op
on arrival would put the chalk **5 to 13 seconds ahead of the voice** — a worse
slideshow than drawing late.

So anchoring ops to the player's sample clock is not a refinement, it is the
only workable design. This was the single riskiest assumption in the plan and
it is now measured rather than hoped for.

It also means the plan's clamp matters in the opposite direction from the one
first feared: the danger is ops landing far too EARLY, not too late.

### Three earlier failures, and what each turned out to be

1. **Calls clustered after `turnComplete`** (runs 1–2). Cause: the prompt
   demanded mid-sentence calls but never showed the rhythm, and models tend to
   treat a tool call as ending a turn. Fixed by prose description.

2. **The model spoke a tool call aloud** — the transcript carried
   `write(id:"ux", content:"$u_x = u cos(theta)$")` mid-sentence, placed
   exactly where the chalk should have moved. Cause: the prompt's worked
   example showed literal call syntax, so it copied the format. The timing was
   already right; only the mechanism was wrong. Now counted as
   `narratedCalls`.

3. **The model went silent after `calc`.** Not the model — `calc` is BLOCKING,
   so generation stops to wait, and every tool response was being sent with
   `SILENT` scheduling, which means "do not trigger generation". It was
   stranded by its own answer. Blocking responses now use `WHEN_IDLE`.

Worth recording that all three were client or prompt bugs wearing the costume
of a model limitation. The spike's value was as much in finding those as in
the headline number.

### Still open

- **TTFA.** The first local VAD used a fixed gate that a quiet mic never
  tripped, so `turns: 0` and nothing to time. Now adaptive to the room's noise
  floor; needs a clean run.
- **Lead slope.** Constant lead → a fixed bias corrects it. Growing lead →
  anchoring must fall back to a transcript-rate estimate. Needs ≥4 calls
  within single turns to fit.
- **Does the teacher vocalise LaTeX?** The transcript shows `$u_x$` and even
  `\sin(90)`. Either Gemini's own transcription is formatting maths as LaTeX
  (harmless) or the teacher is reading symbols aloud (fatal for the demo).
  Only listening settles it.

### The lead slope is the important one

Every call is stamped with the output-sample position when it arrived and the
position actually playing, and the difference is the *lead*. Two regimes, and
they demand different designs:

- **Constant lead** → the server paces audio and tool calls together. A fixed
  per-op bias corrects it, and byte-offset anchoring works as planned.
- **Lead grows through a turn** (non-zero slope) → audio is paced while tool
  calls are not, so the error is `P(1 − 1/k)` at turn-position P and no
  constant bias can fix it. Anchoring must fall back to estimating position
  from transcript characters against a measured speaking rate.

There is also a third case worth watching: a call arriving *before the turn's
first audio*, which is the commonest Gemini pattern. The anchor is then at or
behind playback, so the scheduler clamps: **no ink before the turn's first
played sample + ~300 ms**. Pen travel may start earlier, since a pen moving
toward where it will write is exactly what a teacher does.

## Already settled before the session

**LaTeX in tool arguments was a live hazard and is now designed out.** Tool
args are JSON, and an unescaped backslash is a JSON escape. Measured across 26
ordinary kinematics macros:

- **12 corrupt silently** — `\theta \times \tan \text \frac \forall \beta \bar
  \nu \nabla \rho \right`. `"\theta"` parses to TAB + `"heta"`.
- **14 fail hard** — `\cos \sin \alpha \lambda \pi \delta \mu \gamma \omega
  \vec \sqrt \int \underline \upsilon`. `\c` is not a valid JSON escape, so
  `JSON.parse` throws and the call is unusable.

The screenplay's own `u_x = u\cos\theta` hits both at once.

Rather than repair this after the fact, the model is asked for a
**backslash-free plain notation** — `u_x = u cos(theta) = 17.3 m/s`,
`R = frac(u^2 sin(2 theta), g)` — which `src/teacher/latex.ts` converts.
Verified: all five screenplay lines render **glyph-for-glyph identical** to
hand-written LaTeX. Control-character repair remains as a safety net for a
model that reaches for a backslash anyway, and the metric still counts it.

## If it fails

1. Re-run against `gemini-2.5-flash-native-audio-preview-12-2025` (community
   TTFA 320–800 ms). The model id is config.
2. Try manual activity mode — local VAD owning turn boundaries — which also
   removes the double-VAD ambiguity on barge-in.
3. Still failing → the cascade: Deepgram Flux (integrated end-of-turn, median
   <300 ms) → Gemini Flash text with inline op tags → Cartesia or ElevenLabs
   for word timestamps. Word-level sync is *documented* there rather than
   hoped for; the costs are three vendors and weaker Hinglish. It goes behind
   the same `VoiceSession` interface, so the board and tools do not change.
