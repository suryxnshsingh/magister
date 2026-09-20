# M0 Screenplay — "The range formula isn't magic"

**Status:** draft for Suryansh to rewrite. The dialogue is the part that needs your ear — I've built the beats, the physics and the board choreography around it. Rewrite freely; if a line changes length, only `anchor` matters (times are re-derived from TTS word timestamps).

**Runtime target:** 110–120 s. Current draft ≈ 116 s.
**Problem:** ball thrown at `u = 20 m/s`, `θ = 30°`, `g = 10 m/s²`.
**Arc:** the student has memorised `R = u²sin2θ/g` and doesn't trust it. The teacher never states the formula — he derives range as *horizontal speed × time*, gets the same number, and only then shows the memorised formula is that same thing compressed.

## Why these numbers

| Quantity | Value | Why it matters |
|---|---|---|
| `u_y = u sin30` | **10 m/s exactly** | no decimals in the vertical story |
| `T = 2u_y/g` | **2 s exactly** | "1 second up, 1 second down" is sayable, not computable |
| `u_x = u cos30` | 17.32 m/s (`10√3`) | the one messy number — it's what `calc` is for |
| `R = u_x × T` | **34.64 m** (`20√3`) | |
| `R = u²sin2θ/g` | **34.64 m** | identical — that's the payoff |
| Check question, `θ = 60°` | **34.64 m again** | `sin120° = sin60°`. Tests understanding, not recall |

`calc` must run **degree-mode trig**. Plain mathjs evaluates `sin(60)` in radians and returns **−12.19 m**, which the teacher would then box and say aloud on the climactic beat.

## Board at the end (one page, no erase)

Left column = derivation, 6 lines. Right column = figure. Nothing is erased, because the beat at 1:38 depends on `u_x` still being on the board from 0:44.

```
┌───────────────────────────────────────────┬──────────────────────────┐
│  u = 20 m/s,  θ = 30°                     │            ●             │
│                                           │         ⌒     ⌒         │
│  uₓ = u cos θ = 17.3 m/s   ←circled 1:38  │       ↗  →  v = uₓ       │
│  ──────────── (underlined 1:04)           │     ↗         ⌒         │
│                                     u↗    │   ↗  u_y│      ⌒        │
│  u_y = u sin θ = 10 m/s            30°⌐   │ ↗────────       ⌒      │
│                                           │  u_x            ●ball   │
│      2u_y                                 │ ────────────────────────│
│  T = ───── = 2 s                          │ ├────── R = 34.6 m ─────┤│
│        g                                  │                          │
│                                           │        v̶ ̶=̶ ̶0̶ (struck)    │
│  ┌──────────────────────┐                 │                          │
│  │ R = uₓ × T = 34.6 m  │ ← frozen 1:30,  │                          │
│  └──────────────────────┘   resumed 1:52  │                          │
│        u² sin 2θ                          │                          │
│  R = ───────────                          │                          │
│           g                               │                          │
└───────────────────────────────────────────┴──────────────────────────┘
```

Fit check (board = 10.67 × 8 units, origin centre): 4 plain lines × 0.85 + 2 fraction lines × 1.35 = 6.1 units + 0.6 top margin = **6.7 of 8**. Verified for real in `/board-fit` against typeset MathJax, not estimated here.

## Op conventions

- **One op per plausible tool call.** Never one per glyph. The hand-authored rhythm has to be one the live model can reproduce in M2, or M0 is polishing something unreachable.
- **Dual placement.** Every op carries symbolic intent *and* the hand-tuned result: `place: {intent: "under:ux", resolved: {x: -4.9, y: 0.35}}`. Replay uses `resolved`; M2 asserts the layout manager puts `under:ux` within tolerance of it.
- `anchor` = the word in the spoken line the op fires on. `offset_ms` nudges it.
- Ids are **semantic** (`ux`, `T`, `range`) — never `eq1`/`eq2`, so a near-miss can't silently hit the wrong line.

---

## BEAT 1 — The confession · 0:00–0:14

> **STUDENT:** Sir, ek problem hai. Projectile ka range formula — R equals u square sin two theta by g. Yaad toh hai mujhe. Par exam mein confuse ho jaata hoon — kabhi sin two theta likh deta hoon, kabhi two sin theta. Kabhi samajh hi nahi aaya ki aaya kahan se.

> **TEACHER:** Accha. Matlab formula yaad hai, bharosa nahi hai. ◆Toh chalo — aaj yaad karna band. Aaj isko banate hain.◆

| anchor | op |
|---|---|
| `banate` | `scene(id="fig", name="projectile", params="u=20, theta=30")` → draws `setup`: ground, launch point, `u` arrow at 30°, angle mark |

Board starts empty. The figure appearing *as he says "banate hain"* is the first proof the board is listening.

## BEAT 2 — The throw · 0:14–0:30

> **TEACHER:** Dekho. Tumne ball phenki — ◆bees meter per second se, aur thirty degree ke angle pe.◆ Bas itni si baat hai. ◆Ab sirf ek cheez pakad lo:◆ ye ball do kaam ek saath kar rahi hai.

| anchor | op |
|---|---|
| `bees` | `write(id="given", content="$u = 20$ m/s,  $\theta = 30°$", place="title")` |
| `pakad` | `point(id="fig.u")` — pen glides to the velocity arrow and taps |

## BEAT 3 — Two balls, not one · 0:30–0:52

> **TEACHER:** Aage ja rahi hai — horizontally. Aur upar ja rahi hai — vertically. ◆Do alag-alag ball samjho.◆ Aage waali ki speed — ◆u cos theta.◆ Upar waali ki — ◆u sin theta.◆ Bas, aur kuch nahi.

| anchor | op |
|---|---|
| `alag-alag` | `step(id="fig", step="components")` — `u` splits into `u_x`, `u_y` arrows |
| `cos` | `write(id="ux", content="$u_x = u\cos\theta = 17.3$ m/s", place="under:given")` |
| `sin` | `write(id="uy", content="$u_y = u\sin\theta = 10$ m/s", place="under:ux")` |

## BEAT 4 — The hold · 0:52–1:02

> **TEACHER:** Ab ek sawaal. ◆Ye horizontal speed◆ — poore flight mein, shuru se end tak — kitni baar change hogi?

| anchor | op |
|---|---|
| `Ye horizontal` | `point(id="ux")` — pen taps it and **stays there** |

Teacher stops. Orb → expectant. Pen rests on `u_x`. **Silence is the op here** — a teacher who asks and then keeps talking isn't teaching. Hold until the student speaks.

## BEAT 5 — Student answers · 1:02–1:12

> **STUDENT:** Change nahi hogi na sir... gravity toh sirf neeche ki taraf hai.

> **TEACHER:** ◆Bilkul.◆ Gravity vertical pe kaam karti hai, horizontal ko chhoti bhi nahi. Horizontal speed constant — poore flight. ◆Ye line yaad rakhna.◆

| anchor | op |
|---|---|
| `Bilkul` | `mark(id="ux", style="underline")` |

## BEAT 6 — Time of flight · 1:12–1:26

> **TEACHER:** Toh ab bolo — ball hawa mein rahegi kitni der? Upar ki speed das, gravity das. ◆Ek second mein upar rukegi◆, ek second mein wapas. ◆Total do second.◆

| anchor | op |
|---|---|
| `Total do` | `write(id="T", content="$T = \frac{2u_y}{g} = 2$ s", place="under:uy")` |

## BEAT 7 — The barge-in · 1:26–1:34 ★

> **TEACHER:** Ab range. Range matlab — aage kitna gaya. Horizontal speed constant hai, time do second hai, toh range bas—

> **STUDENT (cutting in):** Sir sir, ek second — ◆top pe velocity zero hoti hai na?◆

| anchor | op |
|---|---|
| `toh range bas` | `write(id="range", content="$R = u_x \times T$", place="under:T")` |

**The moment the whole project exists for.** The student cuts in ~1.1 s into a ~2.4 s write. Audio stops in ≤150 ms; `SceneClock` stops; the pen sits frozen inside `$R = u_x \times$` with the `T` never written. It stays that way for the next 18 seconds, in shot, while the teacher deals with the question.

For the fixture, `truncated_at` is hardcoded so every replay freezes identically.

**Settled, not raw — decided, not assumed.** Compared as still frames at `/write-test`. Because Write traces a glyph's *outline*, a raw freeze mid-glyph gives a thin contour around the whole letter plus partial fill: a grey ghost letter, which reads as a rendering fault when it's held on screen for 18 seconds. `settle()` finishes a glyph that's ≥50% drawn, erases one barely begun, and pins the rest unwritten — solid chalk with a clean edge, exactly like a teacher stopping. The cost is ≤100 ms of extra pen travel, which nobody sees. Raw freeze is still correct for shapes and single-line prose, where the stroke *is* a centerline.

## BEAT 8 — The correction · 1:34–1:56 ★

> **TEACHER:** Arre ruko ruko. ◆Bahut accha sawaal◆ — aur yahi sabse badi galti hai. Top pe ◆vertical velocity zero hoti hai. Vertical.◆ ◆Horizontal toh abhi bhi chal rahi hai◆ — dekho, ye arrow abhi bhi hai. Aur hai kitni? ◆Yahan dekho — u cos theta. Wahi jo humne abhi likha tha.◆

| anchor | op |
|---|---|
| `Bahut accha` | `point(id="fig.apex")` |
| `vertical velocity zero` | `write(id="vapex", content="$v = 0$", place="at:fig.apex")` |
| `Vertical.` | `mark(id="vapex", style="strike")` — written, then struck. The misconception shown and crossed out beats never writing it |
| `Horizontal toh` | `step(id="fig", step="apex_velocity")` — only the horizontal arrow survives at the apex |
| `Yahan dekho` | `mark(id="ux", style="circle", part="u\\cos\\theta")` |

That last op is the **refer-back criterion**, and it's the hardest thing in the demo: the pen leaves the figure, travels back across the board, and circles a term written 54 seconds earlier. It's also why nothing may be erased before this point.

It circles the **term**, not the line — `u\cos\theta` alone, not all of `u_x = u\cos\theta = 17.3 m/s`. Two reasons. A loose oval around the whole line has to be ~1.4× its width to circumscribe it, which overflows the column and slices through "m/s"; and a teacher saying "ye term" points at the term. The whole line already carries the beat-5 underline, so the two marks read as a hierarchy — *remember this line*, then *look at this piece of it*.

## BEAT 9 — Resume · 1:56–2:08 ★

> **TEACHER:** Samjhe? Chalo — ◆toh hum yahan the.◆ Range. Horizontal speed, into time. ◆Sattrah point teen, into do◆ — ◆chauntis point chhe meter.◆

| anchor | op |
|---|---|
| `toh hum yahan the` | pen travels back to `range` and **resumes the frozen stroke** — writes the `T` it never finished |
| `Sattrah point teen` | `calc(expr="17.3205 * 2")` → `34.641` **(BLOCKING)** |
| `chauntis point chhe` | `rewrite(id="range", content="$R = u_x \times T = 34.6$ m")` then `mark(id="range", style="box")` |

The resume is the payoff for the freeze. A teacher returning to a half-finished line and simply continuing it is the single most human thing on the board.

## BEAT 10 — The formula comes home · 2:08–2:20

> **TEACHER:** ◆Aur ab dekho tumhara formula.◆ u cos theta into two u sin theta by g. Do sin theta cos theta ko compress karo — ◆sin two theta ban jaata hai.◆ ◆Wahi formula.◆ Jo tumne ratta maara tha, wo yahi tha — horizontal speed, into time. Aur kuch nahi.

| anchor | op |
|---|---|
| `Aur ab dekho` | `write(id="formula", content="$R = \frac{u^2\sin 2\theta}{g}$", place="under:range")` |
| `sin two theta` | `mark(id="formula", style="circle", part="\\sin 2\\theta")` |
| `Wahi formula` | `step(id="fig", step="launch")` — ball flies the trajectory and lands on the range marker |

## BEAT 11 — Check question, hold · 2:20–2:28

> **TEACHER:** Ab tum batao. Agar main angle thirty ki jagah ◆saath degree◆ kar doon — same speed — toh range badhegi, ghategi, ya same rahegi?

| anchor | op |
|---|---|
| `saath degree` | `point(id="fig.theta")` |

Ends on the hold. Orb expectant, pen resting on the angle, board full and correct. **Answer: exactly the same** — `sin120° = sin60°`. A student who memorised the formula can't see it; one who watched this lesson can. Ending on an unanswered question is also the strongest possible closing frame for the video.

---

## What M0 must build for this

Only what the look depends on. Layout manager, eraser wipe, orb behaviour, chalk sound and determinism tests are M2+.

| # | Thing | Used by |
|---|---|---|
| 1 | `SceneClock` + op-log player (hand-placed geometry) | everything |
| 2 | MathJax v4 Write (`fontCache:'none'`, DrawBorderThenFill) | 6 lines |
| 3 | Single-line prose font (Relief SingleLine SVG font, parsed direct) | "m/s", "s" |
| 4 | Marks: underline, strike, circle, box | beats 5, 8, 9, 10 |
| 5 | Pen tip — travels, taps, freezes | every beat |
| 6 | **Freeze + resume** | beats 7, 9 |
| 7 | `projectile` template: `setup`, `components`, `apex_velocity`, `launch` + `at:` placement | beats 1, 3, 8, 10 |
| 8 | Chalk look (static grain overlay, never a live `<filter>`) | — |
| 9 | Static 75/25 shell, placeholder orb | — |

## Exit test

A screen recording of `/replay` you would post as-is. 60 fps in a Chrome trace, no long frames during Write. Then three stills judged by eye: the frozen `R = u_x ×`, the circle landing on `u_x`, and the final full board.

### Verified so far

| Check | Where | Result |
|---|---|---|
| Final board fits one page | `/board-fit` | **PASS** — 6.08/7.10 height, 4.52/4.85 width, measured on real typeset output |
| `fontCache:'none'` gives per-glyph animatable paths | probe | **PASS** — 11 inline `<path>`, 0 `<use>`; repeats keep separate elements |
| Beat 7→8→9: write, freeze part-way, hold, finish | `/write-test` | **PASS** — 6/6 glyphs → 3/6 frozen → stable while held → 6/6 resumed |
| Beats 1–10 play from the op log | `/replay` | **PASS** — 6 objects, 4 marks, figure with 10 parts; resume writes the remaining 8 glyphs |
| `part()` deixis lands on the right term | `/replay` | **PASS** — circles `u\cos\theta` inside `ux`, and `\sin 2\theta` inside `formula` |
| Template steps fire in order | `/replay` | **PASS** — ground/u/θ → trajectory + components → apex velocity → range + ball |
| The board is a pure function of scene time | `/replay` | **PASS** — identical frame reached forwards, backwards, or via 0 |
| 60 fps with overlapping ops | `/replay` | **PASS** — 105 animated paths, p50 8.3 ms, p95 8.6 ms, 0 frames >18 ms (120 Hz display) |

`penAt()` calls `getScreenCTM()` twice per frame, which forces layout. Fine at this scale, and the first thing to look at if the frame budget ever slips.

### Two bugs the tests caught

- **Truncation was one-way.** A frozen line could never be finished, silently killing beat 9. Fixed by modelling each animation's timeline as segments: the freeze *is* the gap between two of them, so resume is just a second segment rather than a special case.
- **Fraction bars floated in mid-air.** MathJax draws them as `<rect>`, which has no path length and so ignores stroke-dashoffset — the formula's bar was visible nine seconds before its equation. Rects are now rewritten as paths at typeset time.

## Open for your rewrite

1. **Does it sound like a real teacher?** I've aimed at a warm Kota-style tutor. Too chatty? Too formal?
2. **"Do alag-alag ball samjho"** (beat 3) is the load-bearing metaphor. Better one?
3. **Beat 8's "Arre ruko ruko"** — right register for being interrupted, or too casual?
4. **Numerals**: spoken Hindi (`bees`, `chauntis point chhe`) or English (`twenty`, `thirty-four point six`)? Real Hinglish teachers mix; TTS may handle one better. Worth testing both in M1.
5. **Is 116 s too long?** Beat 6 (time of flight) is the most cuttable — it could drop to one line and save ~8 s.
