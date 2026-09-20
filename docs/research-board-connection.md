# Making the board connect — research

Research into what makes a teacher's use of a board create *connection* with a
student, rather than merely display information. Two questions: how a teacher's
gestures and timing carry presence, and what the student should be able to do on
the board.

Sources are tiered. **DOCUMENTED** = peer-reviewed or primary. **OPINION** =
judgement. Where a number is quoted it was read from the source, not from a
summary of it.

> Note on completeness: two further strands — CSCW workspace-awareness, and
> creative prior art in dynamic visual explanation — were researched but the
> machine slept repeatedly and those agents lost their work before writing to
> disk. What follows is what survived. The manim-voiceover bookmark mechanism
> (marking a word in narration and syncing animation to it) remains the single
> most promising unexplored lead, because it is our exact problem solved by
> someone else.

---

## Part 1 — Gesture, timing, and presence

### 1.1 The timing number, and why the folk version is wrong

The received wisdom is "gesture leads speech by about a second." That is true of
**iconic/representational** gestures and **false for pointing**, which is the
only kind our pen does.

**Levelt, Richardson & La Heij (1985)**, *JML* 24:133–164 — the study that
actually measures deictic pointing against deictic words. Four experiments, N=20.
https://www.mpi.nl/world/materials/publications/levelt/Levelt_1985_pointing.pdf

| Quantity | Finding |
|---|---|
| **Gesture apex vs word onset** | Coincident within ±50 ms. Off-line (the natural case): apex *precedes* voice onset by **14 ms**. On-line: apex *follows* by 53 ms. Range across cells −47 to +103 ms |
| **Movement initiation vs word onset** | Movement leads by ~**350 ms** (341 ms near, 373 ms far) |
| **Travel time** | 382 ms for 212 mm; 439 ms for 407 mm |
| **Speech waits for the hand** | Voice onset 611 ms near vs 676 ms far, F(1,19)=44.5, p<.0001 |
| **Dead period** | 300–370 ms before speech onset, after which speech can no longer adapt: "when the pointing gesture is unhampered, speech becomes ballistic almost immediately upon the initiation of gesture" |

So the structure is: **the hand starts moving ~350 ms early, and the tap lands
ON the word.** Not the hand arriving early and waiting.

*Caveat, stated by the source:* this is lab reaching to LEDs at 21–41 cm with
isolated deictic phrases. The sign and order of magnitude transfer; the exact
milliseconds do not. Treat ±50 ms as a band, not 14 ms as a target.

### 1.2 The asymmetry rule

**ITU-R BT.1359-1** on audio-visual sync detectability: **+45 ms** when audio
leads, **−125 ms** when audio lags. Asymmetric — a viewer tolerates the *visual*
running ahead nearly three times as far as behind.

**Rule for our scheduler: a tap may land early. It must never land late.** When
the estimate is uncertain, bias early.

### 1.3 A hold is what recruits the eye

**Gullberg & Holmqvist**, attention to gestures. https://pmc.ncbi.nlm.nih.gov/articles/PMC2766498/

- Addressees spend **90–95% of viewing time on the speaker's face**, not their hands.
- **Holds attract fixations** (M=.11 vs .00, Z=−3.63, p<.001). So does the
  speaker's own gaze at their own gesture (.08 vs .00, Z=−2.41, p=.016).
- **Fixation onset latency to a hold: M=102 ms** (SD 88).
- Central vs peripheral gesture location: not significant (Z=−.957, p=.339).

**Consequence:** a tap that flicks away immediately is wasted. The eye needs
~100 ms to arrive, so a hold under ~150–200 ms buys nothing. The pen should
**land and stay** while the teacher talks about the thing.

That 90–95%-on-the-face figure is also a caution: in a human conversation the
hand is mostly *peripheral*. Our student has no face to look at, so the board
carries all of it — but it argues against assuming every gesture is watched.

### 1.4 The moving locus — why the pen tip earns its place

**Zhang et al. 2024**, *Memory & Cognition*. https://pmc.ncbi.nlm.nih.gov/articles/PMC11779760/
Study 2: hand M=14.59 > drawing-only 12.93 > static 11.77 (hand vs static
p_adj<.001; hand vs drawing-only p_adj=.042). Study 3: **hand ≈ moving cursor**
(t(88)=1.73, p_adj=.264), both > control.

**Fiorella & Mayer 2016** found hand-*less* dynamic drawing did **not** beat
static; with a hand it did.

**Reconciled: the active ingredient is a continuously visible moving locus, not
a hand.** A cursor does the job as well as a hand.

This directly validates the chalk pen tip. It was nearly deleted earlier in the
project for lagging the ink; the lag was fixed instead. That was the right call,
and this is the evidence for it.

### 1.5 Pointing does work speech cannot

- **Valenzeno, Alibali & Klatzky 2003**: children solved **more than twice as
  many** posttest items after a lesson with pointing/tracing gestures.
- **Wakefield et al. 2018** https://pmc.ncbi.nlm.nih.gov/articles/PMC6191377/ —
  gesture condition looked at the problem 64.6% vs 50.1% of the time, at the
  *instructor* 14.7% vs 45.2%. Crucially, **attention did not mediate the
  learning benefit**; gesture *moderated* it. The benefit comes "not merely from
  its ability to guide visual attention, but also from its ability to
  synchronize with speech." **Sync is the mechanism, not just direction of gaze.**
- **Bangerter 2004**, *Psych Sci* 15:415–419: pointing "especially suppressed
  descriptions of target location" — i.e. a teacher who can point stops *saying
  where*. Our teacher should point rather than describe position.
- **Alibali & Nathan 2012**, *JLS* 21:247–286: pointing is the most common
  gesture type in elementary maths lessons. Documents a two-handed move — holding
  a point on one representation while pointing at the corresponding part of
  another, indexing both simultaneously. Also **"addressee gesture"** (Nathan
  2008): the teacher points at the board *on the student's behalf, while the
  student is speaking*.

### 1.6 Wait time

**Rowe 1972/1986**: teachers typically wait 0.7–1.5 s after a question.
Extending to **≥3 s increases response length by 300–700%.**

### 1.7 What is thin

Stated plainly so it is not over-claimed later:

- **No study measures optimal dwell time for a pointing gesture.** Our ~150–200 ms
  floor is inferred from fixation latency, not measured.
- **No causal evidence that handwriting-speed board work beats slides.** Every
  chalk-vs-PowerPoint source found is a preference survey, uncontrolled, or
  opinion. The "writing at handwriting speed aids learning" claim is folklore.
  (The best articulation of the folklore is Peller, arXiv:1204.5141 — an opinion
  essay, useful for its framing, not evidence.)
- **Erase-vs-leave-up**: Japanese *bansho* board practice (divisional zoning,
  arrows connecting ideas, the board as a whole-lesson record) is documented
  *practice*, not a controlled effect.
- **Nothing exists on single-pen virtual boards.** Every mapping from
  two-handed teacher gesture onto our one pen is our own invention.

---

## Part 2 — What the student should do on the board

### 2.1 The organising axis: hypothesis-space size

If the tutor knows the **finite set of possible student inputs in advance**,
recognition is a nearest-neighbour test against a known answer and cannot
embarrass us. If it must transcribe **arbitrary ink**, it can.

The arithmetic that kills most recognition claims: 95% per-symbol accuracy over
a 10-symbol line is 0.95¹⁰ ≈ **60% per line**. Vendor accuracy figures are
per-symbol; students write lines.

### 2.2 ICAP — where the value actually is

**Chi & Wylie 2014**, *Educational Psychologist* 49(4):219–243.
https://dunkin.eeb.ucsc.edu/images/documents/The_ICAP_Framework_Linking_Cognitive_Engagement_to_Active_Learning_Outcomes.pdf

> "the Interactive mode of engagement achieves the greatest level of learning,
> greater than the Constructive mode, which is greater than the Active mode,
> which in turn is greater than the Passive mode (I>C>A>P)."

Three findings that bear directly on design decisions:

**Menus are demoted.** "Suppose a student's response ... consists of selecting an
answer from a menu of choices; selecting is only *active* in our taxonomy in that
the student does not generate a product." So a multiple-choice hint ladder is
worth materially less than making the student produce something.

**The physics FBD case is decided explicitly** (p.222): if a worked example has
no diagram and the student draws a free-body diagram, the student has
*constructed*. If the diagram was already there and the student copied it, that
is merely *active*. **Drawing the FBD is where the value is — so the teacher
should not draw it first.**

**Pointing counts as Active** (p.222) — "pointing to or gesturing at what they
are reading or solving (Alibali & DiRusso, 1999)" is listed among activities that
exceed passive. So student-side deixis is real, if modest, value. With the
caveat (p.224): "if students point instead at random figures on the whiteboard,
then their behavior would not be considered a beneficial active one."

**And a diagnosis of the product as it stands** (p.223): "individual dialogue
pattern tend to promote more learning for the dominant speaker, whereas both
partners can benefit from joint dialogue pattern." *A board the teacher
monopolises makes the teacher the learner.*

An AI tutor does qualify as an Interactive partner — "a peer, a teacher, a
parent, or computer agent (assuming the computer agent responds in a
content-relevant way)" — on two conditions: both partners' utterances are
primarily constructive, and there is sufficient turn-taking.

### 2.3 Self-explanation

**Chi, de Leeuw, Chiu & LaVancher 1994**, *Cognitive Science* 18(3):439–477.
https://onlinelibrary.wiley.com/doi/10.1207/s15516709cog1803_3

Reporting Chi et al. 1989 on **physics** worked examples: the 4 students who
scored **82%** on the posttest generated **15.3** self-explanations per example;
the 4 who scored **46%** generated **2.8**. (Correlational, N=8.)

The 1994 study itself is causal but on circulatory-system text, not physics. The
mechanism worth copying is its prompt schedule: students were prompted to
self-explain **after each line**. Line-granular and content-free — which maps
exactly onto our per-line board writes.

### 2.4 Drawing, with its boundary condition

**Fiorella & Mayer 2015**: "Drawing was superior to control conditions in 26 of
28 studies with a median effect size of **d = 0.40**." (Secondary summary.)

But **unsupported drawing nulls out** — Frontiers in Psychology 2024,
"Generative learning activities for online multimedia learning: when summarizing
is effective but drawing is not."
https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2024.1452385/full

The defensible claim is **production + scaffold + feedback**, not production
alone. Which is precisely what a tutor watching the student draw can provide.

### 2.5 The honest counterweight — interaction is not free value

**VanLehn, Graesser, Jackson, Jordan, Olney & Rosé 2007**, *Cognitive Science*,
"When Are Tutorial Dialogues More Effective Than Reading?" (7 experiments,
qualitative physics). https://doi.org/10.1080/03640210709336984

> "When novices ... studied content that was written for intermediates ..., then
> tutorial dialogue was reliably more beneficial than less interactive
> instruction, with large effect sizes. When novices studied material written for
> novices or intermediates studied material written for intermediates, then
> tutorial dialogue was not reliably more effective than the text-based control."

**Interaction pays when the material is over the student's head.** Put the
student-action moments where the student is actually stuck, not on a schedule.

### 2.6 Productive failure — attempt before instruction

**Sinha & Kapur 2021**, *Review of Educational Research* 91(5):761–798 —
meta-analysis of 53 studies, 166 comparisons. Effect in favour of
problem-solving *before* instruction: **Hedges' g = 0.36 (95% CI 0.20–0.51)**.
Figure quoted from the open-access Kapur et al. 2022:
https://www.frontiersin.org/articles/10.3389/feduc.2022.956416/full

Mechanism 3 from the same paper: "prior knowledge activation affords students
opportunities to compare and contrast their solutions with the correct solutions
during subsequent instruction."

**Design consequence: the board should hold the student's attempt and the
correct version side by side.** That is a board layout decision, and we have a
two-column board already.

### 2.7 Against building an error library

**Brown & Burton** (BUGGY/DEBUGGY) and **Brown & VanLehn 1980**, Repair Theory.
https://onlinelibrary.wiley.com/doi/abs/10.1207/s15516709cog0404_3

Documented limitation: the paradigm is "unable to explicitly represent the
semantic nature of a bug or to explain how a bug was generated." Bug libraries
are expensive, domain-specific, and sized for something as narrow as
place-value subtraction.

**Prefer mechanical checks over an error library.** Dimensional analysis, sign
checks, limiting cases — cheap, general, and they cannot be wrong about physics.

### 2.8 Codebase notes, verified against source

- `src/board/units.ts` already converts pointer pixels ↔ board units
  (`toPx`/`toUnits`). Student ink needs no new coordinate work.
- `point` and `mark` already accept `"id"`, `"id:subexpr"` and `"fig.part"`.
  **A student-side deixis event has an identical target grammar** — the addressing
  scheme is already built.
- **Correction to an assumption worth recording:** `units.ts` is *geometry*
  units, not physical dimensions. A dimensional checker would be ~150 lines of
  new code, not a reuse of something that exists.
- Student-produced expressions must round-trip through the same plain-notation
  converter in `src/teacher/latex.ts` that the model's output uses.
- Any student action must route through **HOLD/COMMIT/RESUME**, or the reply
  lands 5–13 s late — see §3.

---

## Part 3 — What this means for our code

Concrete and checkable, in rough order of value per unit of work.

### 3.1 Split the tap into travel and apex

`src/teacher/pacing.ts` currently fires `point` as one lump, 850 ms before its
anchor, and `scene.ts` gives it a 620 ms window whose pulse *decays from the
first frame* — so the apex is at the start and the pen is already fading out
while the teacher is still saying the word.

The research says the shape should be: **movement starts ~350 ms before the
word, the apex lands on it, and then it holds.** Since `PenTrack` already
computes travel time from distance, the tap should be anchored and travel
derived, rather than one number standing for both.

### 3.2 Give the tap a minimum hold

A fixation takes ~102 ms to arrive. The pen should rest on the target for at
least ~200 ms after the apex before it is allowed to travel onward. Currently
nothing prevents the next op yanking it away immediately.

### 3.3 Write down the asymmetry rule

Early is cheap (125 ms unnoticed), late is expensive (45 ms noticed). Anywhere
the scheduler rounds, it should round early. This belongs as a comment in the
scheduler, because the next person to tune it will not know.

### 3.4 Point instead of describing position

Bangerter: pointing suppresses verbal location description. The prompt should
tell the teacher to point rather than say "the second line from the top" — it is
both more natural and shorter, which matters when every token is time.

### 3.5 Wait three seconds

After a check question, ≥3 s. Manual-activity mode already means we are not
racing the student, but nothing currently enforces that the teacher does not
fill the silence itself.

### 3.6 Stop drawing the diagram the student should draw

The strongest single pedagogical finding here (ICAP p.222, plus Rosengrant on
FBDs) is that the student drawing the free-body diagram is where the learning
is, and the teacher drawing it first destroys exactly that. When the FBD figure
gets built, the default should be that the teacher sets up the situation and
*asks*, not draws.

### 3.7 Prefer a bounded hypothesis space for student input

Rather than transcribing arbitrary handwriting (0.95¹⁰ ≈ 60% per line), start
where the tutor knows the candidate set: place a vector, choose which of two
drawn options is wrong, drag a value. Recognition then cannot embarrass us. Note
the ICAP trade-off honestly, though — selection is only *Active*, so this is the
safe version, not the valuable one. The valuable one is the student producing a
diagram.
