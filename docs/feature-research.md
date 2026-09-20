# Feature research — what to build next

Two parallel research passes, 2026-09-20: one on physics figures and diagram
libraries, one on AI-tutor product features and learning evidence. This is the
distilled result, kept because the ranking below is the build order.

Sources are tiered. **DOCUMENTED** = peer-reviewed or first-party. **OPINION** =
judgement. A large amount of "best AI tutor 2026" content is affiliate material
with invented statistics; none of it is used here.

---

## 1. The one finding that should change the prompt

**Withholding the answer is the highest-leverage design choice available, and
the evidence is unusually strong.**

- Bastani et al., *PNAS* 2025 (~1,000 students): unguarded GPT-4 raised
  in-session performance 48%, but students who then lost access scored **17%
  worse than students who never had it at all**. A variant with teacher-designed
  hints that refused to give answers eliminated the harm entirely.
  https://www.pnas.org/doi/10.1073/pnas.2422633122
- Kestin et al., *Sci Rep* 2025 — Harvard physics, the closest analogue to this
  product. The tutor was instructed to reveal **one step at a time** and make
  the student attempt first. Median learning gains ~2x in-class active learning.
  https://www.nature.com/articles/s41598-025-97652-6
- "More AI Assistance Reduces Cognitive Engagement" (PACM HCI 2025): students
  *prefer* maximum assistance and learn less from it. https://arxiv.org/abs/2509.03392

The consequence for us is concrete and cheap: the teacher should ask before it
tells, and the board should show a hint ladder whose last rung — the answer —
stays unwritten until the student has attempted. That is prompt work plus one
board convention, not a subsystem.

**Counterpoint worth holding onto:** Rosengrant, Van Heuvelen & Etkina, PRPER
5 010108 (2009) found free-body diagrams *supplied* to students did not help and
sometimes hurt, while diagrams students *drew* predicted success. So figures
should be built up a step at a time as the teacher talks — which is exactly what
the `step` mechanism already does, and an argument against ever drawing a
complete diagram in one call.

---

## 2. Competitive position

Table stakes in the Indian exam-prep market, all first-party confirmed: photo
doubt-solving, PYQ banks, video solutions, adaptive practice. Allen ships 1
lakh+ chapter-wise PYQs; PW's AI Guru takes text, voice or textbook image and
returns a teacher video clip, built with Microsoft Research. Khanmigo's
published differentiator is prompt discipline around not giving answers.

**We cannot win on content breadth and should not try.** The recurring complaint
in doubt-app reviews is ads, billing and mismatched solutions — not missing
features. Content is not the gap.

**Nobody is doing parametric, addressable, stroke-animated figures driven by a
speaking tutor that can be interrupted.** Khan Academy has Gemini generate
interactive diagrams (six months of Google engineering, no architecture
published); an arXiv pipeline generates raw SVG from an LLM
(https://arxiv.org/abs/2503.07429). Neither is synchronous with speech. That
synchrony is the moat, and it should not be traded for any library's aesthetic.

---

## 3. Figures ranked by frequency × teaching value

NTA publishes no official weightage; percentages are coaching-site aggregations
of past papers. Current Electricity and Ray Optics are jointly top at ~6%.

| # | Figure | Chapters | Status |
|---|---|---|---|
| 1 | **Free-body diagram** | Laws of Motion, WEP, Rotation, Fluids | to build |
| 2 | **Ray diagram** (lens/mirror) | Ray Optics ~6% | to build |
| 3 | **Circuit** | Current Electricity ~6%, EMI/AC | to build |
| 4 | **Cartesian graph** | Kinematics, Thermo, SHM, Modern | **done** |
| 5 | Inclined plane + friction | Laws of Motion, Rotation | to build |
| 6 | Pulley / connected bodies | Laws of Motion, WEP, Rotation | to build |
| 7 | Vector resolution | all of mechanics | cheap |
| 8 | E-field / charges | Electrostatics | to build |
| 9 | Wave / SHM | Waves, SHM, AC | cheapest on the list |
| 10 | Capacitor | Electrostatic potential ~4% | later |

**The structural point, which matters more than the ranking:** four of the top
six share the same sub-primitives — labelled chevron arrow, block, hatched
surface, angle arc, dashed construction line. A primitive layer beneath
`scene()` collapses the marginal cost of figures 5, 6 and 7 toward zero. Build
it before figure #1, not after.

### Libraries — the real acceptance test

Our chalk pipeline roughens an SVG path `d` string:

```ts
gen.toPaths(gen.path(d, { roughness, strokeWidth: 3, bowing: 1 })).map(q => q.d)
```

So **anything that emits a `d` string is compatible; anything emitting `<use>`,
`<text>`, `<circle>` or filled shapes is not.** That eliminates almost every
candidate — JSXGraph, Mafs, function-plot, Observable Plot and ray-optics all
own their own rendering. It also means filled arrowheads will not survive, so
arrowheads must be two-stroke chevrons in the shared primitive.

Two exceptions worth taking:

- **`d3.arc()`** (ISC, no DOM) returns a pure `d` string for angle arcs — θ on
  an incline, the angle between vectors, the sweep in circular motion, phase in
  SHM. Four of the next six figures need it. Note: `d3.line()` is *not* worth
  adding; we already sample into a polyline and it works.
- **schemdraw** (MIT, actively maintained) — port the *symbol geometry* for
  circuits, which is fiddly and already solved. Attribution required. This is
  the only figure where a library genuinely saves work.

Explicitly rejected: `tscircuit/circuit-to-svg` (**no licence declared = all
rights reserved**) and `manim-physics` (also unlicensed, and stale since 2024) —
readable for vocabulary, not copyable.

### Vocabulary worth stealing

- **TikZ compass anchors** (`.north`, `.center`, `.east`) — this is precisely
  our "named addressable parts" idea and it is self-documenting:
  `point("block.north")`. Adopt wholesale.
- **PGFPlots** `domain=` / `samples=` — the right parametrisation for the plot
  figure, which currently hardcodes its sample count.
- **Manim's animation verbs** — `Indicate` and `Circumscribe` are almost exactly
  our `mark` styles, and have been usability-tested on millions of viewers.

---

## 4. Product features, ranked (demo impact /5, effort /5)

| # | Feature | Demo | Effort | Notes |
|---|---|---|---|---|
| 1 | **Spatial deixis** — student clicks a term, teacher circles it and answers | 5 | 2 | Must route through COMMIT, not plain context injection — see below |
| 2 | **Rewind and interrogate** — "go back to the free-body diagram" | 5 | 2 | `seek()` already does this; needs a board summary after the scrub |
| 3 | Photo → board reconstruction (redraw the textbook figure in chalk) | 5 | 3 | Vision emits our ops, not text. Not OCR |
| 4 | Live parametric object — drag θ, curve re-renders, teacher narrates | 5 | 3 | |
| 5 | Teach-back — student writes, teacher critiques | 4 | 3 | Teaching expectancy g = 0.48 |
| 6 | **Replay link + time-lapse** | 4 | 1 | **done** |
| 7 | Visible hint ladder, answer stays locked | 3 | 1 | Implements §1 directly |
| 8 | Auto mistake card | 3 | 2 | Error logs are already a topper ritual in Indian exam prep |

**The latency trap in #1 and #2.** The socket runs 5–13 s ahead of playback.
A click injected as plain context is answered six to thirteen seconds late,
about an object the student has moved on from. Both features must reuse the
existing HOLD/COMMIT/RESUME path: treat the click as a COMMIT — flush queued
audio, drop ops with `anchor > samplesPlayed`, then inject `{objectId, latex}`.
For #2 the mirror problem applies: `seek()` fixes the board but the model's
context still describes the final state, so a scrub must be followed by a board
summary or the teacher narrates ink that is no longer there.

### Do not build

PYQ bank (Allen has 1 lakh+, invisible on video). Video-solution library
(Doubtnut owns it). **Spaced repetition and streaks** — real evidence (g ≈ 0.28)
but needs accounts, persistence and multi-day sessions, and shows nothing in 90
seconds. Flashcard export. Talking-head avatar — it competes with the board for
attention, which is the one thing we cannot afford.

### The tension worth naming

The best-evidenced features (answer-withholding, error logs, spacing) are the
least cinematic; the most cinematic (deixis, rewind, live params) have no direct
RCT behind them. For a portfolio piece demo impact wins — but #5 and #7 are the
ones that answer "does it actually teach?", and they are cheap, so there is no
real trade to make.

---

## 5. Demo beats

The only documented signal on what travels: iFlytek's WAIC 2026 blackboard clip
went viral on exactly one beat — handwriting turning into a manipulable object.
VideoTutor reached 50M TikTok views on *generated instruction*, not answers.

Ordered for the take:

1. **Interruption mid-stroke** — lead with it in the first six seconds, pen
   visibly frozen half-way through a symbol. We already have this.
2. **Deixis both ways** — student points at a term and asks about it. Chat
   products structurally cannot do this.
3. **Rewind mid-lesson** — board scrubs back 40 s and the teacher resumes
   teaching from that state.
4. **The drawing coming alive** — drag θ, the curve re-renders, narration
   tracks the drag.
5. Closing shot: the 8-second time-lapse replay of the whole board.
