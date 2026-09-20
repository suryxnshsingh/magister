# Making the board connect — research

Research into what makes a teacher's use of a board create *connection* with a
student, rather than merely display information. Two questions: how a teacher's
gestures and timing carry presence, and what the student should be able to do on
the board.

Sources are tiered. **DOCUMENTED** = peer-reviewed or primary. **OPINION** =
judgement. Where a number is quoted it was read from the source, not from a
summary of it.

> Note on completeness: two further strands — CSCW workspace-awareness and
> creative prior art in dynamic visual explanation — were researched but lost
> when the machine slept repeatedly and those agents died before writing to
> disk. The manim-voiceover bookmark mechanism (marking a word in narration and
> syncing animation to it) remains the single most promising unexplored lead,
> because it is our exact problem solved by someone else.

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

### 2.1 The governing axis: hypothesis-space size

Rank student-input ideas by **how large the set of possible inputs is**, not by
how much the student produces.

- **Closed set** — the system knows the candidates in advance. Recognition is a
  hit-test or a nearest-neighbour check against a known target. It cannot
  embarrass us.
- **Open transcription** — arbitrary ink to symbols. It can, and in 2026 it does.

Our own compounding argument from `docs/spike-results.md` applies: 95% per-symbol
accuracy over a 10-symbol line is 0.95¹⁰ ≈ 0.60 per line. A "95% accurate"
recogniser gets a three-line derivation right about **22%** of the time. Vendor
figures are per-symbol; students write lines.

**Every real sketch tutor closed the hypothesis space, and none transcribed free
handwriting for meaning.** Mechanix matches the student's sketch against one the
*instructor* pre-drew. CogSketch Sketch Worksheets compare student to instructor
sketch by analogy. Andes — the most deployed physics ITS ever built — used a
palette and a dialog box and did no recognition at all.

### 2.2 Recognition reality — the numbers that decide this

**FERMAT**, "Can Vision-Language Models Evaluate Handwritten Math?"
https://arxiv.org/abs/2501.07244 — 2,200+ handwritten solutions, 609 problems,
grades 7–12, 9 VLMs. From Table 3 (https://arxiv.org/html/2501.07244v2):

| Task | Gemini-1.5-Pro | GPT-4o |
|---|---|---|
| Error **detection** (balanced acc., chance 0.50) | 0.63 hw / 0.67 +OCR | 0.65 hw / 0.64 +OCR |
| Error **localization** (acc.) | **0.43** hw / 0.56 +OCR | **0.45** hw / 0.50 +OCR |
| Error **correction** (acc.) | 0.76 hw / 0.77 +OCR | 0.66 hw / 0.71 +OCR |

A VLM finds **where** a student went wrong **under half the time**. Detection is
13–15 points above a coin flip. Handing the model a clean transcription lifts
localisation 0.43 → 0.56 but does not rescue it — the bottleneck is perception
*and* reasoning, so a better OCR front end does not fix this.

**And the failure is biased, not random.** "When VLMs 'Fix' Students"
(https://arxiv.org/abs/2604.22774), 15 VLMs on FERMAT:

> "Instead of faithfully transcribing a student's work, these models often 'fix'
> errors, thereby hiding the very mistakes an educational assessment aims to
> detect."

GPT-4o is "heavily penalized for aggressive over-correction"; Gemini 2.5 Flash is
the most faithful. **A VLM-transcription tutor systematically reads the student's
wrong line as the right line and praises it.** That is strictly worse than not
reading at all — and it is the exact failure this project has been avoiding
elsewhere: a system claiming a state it has not reached.

**Consequence: do not build free-form "student writes a derivation, teacher
diagnoses it."** Revisit only if a benchmark shows handwriting localisation
above ~0.85. Every idea below is closed-set, or uses ink without transcribing it.

### 2.3 ICAP — where the value actually is

**Chi & Wylie 2014**, *Educational Psychologist* 49(4):219–243.
https://dunkin.eeb.ucsc.edu/images/documents/The_ICAP_Framework_Linking_Cognitive_Engagement_to_Active_Learning_Outcomes.pdf

> "the Interactive mode of engagement achieves the greatest level of learning,
> greater than the Constructive mode, which is greater than the Active mode,
> which in turn is greater than the Passive mode (I>C>A>P)."

Chi's criterion is **not the input device** — it is whether the output adds
information not already present. Typing worked-out content is Constructive;
typing a copy is Active. The keyboard is irrelevant.

**The physics FBD case is decided explicitly** (p.222): if the worked example has
no diagram and the student draws a free-body diagram, the student has
*constructed*; if the diagram was already there and the student copied it, that
is merely *active*. **So the teacher drawing the FBD first destroys the thing
that teaches.**

**Menus are demoted** (p.223–4): "selecting is only *active* in our taxonomy in
that the student does not generate a product."

**Pointing is Active** (p.222), and only when content-relevant — p.224: pointing
"at random figures on the whiteboard" is not even beneficially active.

**The practical lever: a tap becomes Constructive the moment the student has to
say why.**

**A diagnosis of the product as it stands** (p.223): "individual dialogue pattern
tend to promote more learning for the dominant speaker, whereas both partners can
benefit from joint dialogue pattern." *A board the teacher monopolises makes the
teacher the learner.*

An AI qualifies as the Interactive partner — "a peer, a teacher, a parent, or
computer agent (assuming the computer agent responds in a content-relevant way)"
— on two conditions: both partners' utterances primarily constructive, and
sufficient turn-taking.

### 2.4 Self-explanation

**Chi, de Leeuw, Chiu & LaVancher 1994**, *Cognitive Science* 18(3):439–477.
https://onlinelibrary.wiley.com/doi/10.1207/s15516709cog1803_3

Reporting Chi et al. 1989 on **physics** worked examples: the 4 students who
scored **82%** on the posttest generated **15.3** self-explanations per example;
the 4 who scored **46%** generated **2.8**. (Correlational, N=8.)

The 1994 study is causal but on circulatory-system text. The mechanism worth
copying is its schedule: prompted **after each line** — line-granular and
content-free, which maps exactly onto our per-line board writes.

### 2.5 Drawing, with its boundary condition

**Fiorella & Mayer**: "Drawing was superior to control conditions in 26 of 28
studies with a median effect size of **d = 0.40**." (Secondary summary, not read
in primary.)

But **unsupported drawing nulls out** — Frontiers in Psychology 2024, "when
summarizing is effective but drawing is not."
https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2024.1452385/full

The defensible claim is **production + scaffold + feedback**, never production
alone. Which is exactly what a tutor watching the student draw can supply.

### 2.6 Productive failure — attempt before instruction

**Sinha & Kapur 2021**, *Review of Educational Research* 91(5):761–798 —
53 studies, 166 comparisons, favouring problem-solving *before* instruction:
**Hedges' g = 0.36 (95% CI 0.20–0.51)**. Quoted verbatim from the open-access
Kapur et al. 2022: https://www.frontiersin.org/articles/10.3389/feduc.2022.956416/full

Mechanism 3: students "compare and contrast their solutions with the correct
solutions during subsequent instruction" — **the board must hold the attempt and
the correct version side by side.**

### 2.7 The honest counterweight — interaction is not free value

**VanLehn, Graesser, Jackson, Jordan, Olney & Rosé 2007**, *Cognitive Science*,
7 experiments, qualitative physics. https://doi.org/10.1080/03640210709336984

> "When novices ... studied content that was written for intermediates ..., then
> tutorial dialogue was reliably more beneficial than less interactive
> instruction, with large effect sizes. When novices studied material written for
> novices or intermediates studied material written for intermediates, then
> tutorial dialogue was not reliably more effective than the text-based control."

**Spend student-action moments where the student is actually stuck**, not on a
schedule.

### 2.8 Turn-taking — the hardest number in the whole report

**Rowe 1972**, ERIC ED061103, read in primary.
https://files.eric.ed.gov/fulltext/ED061103.pdf

> "Analysis of over 300 tape recordings showed mean wait-time to be on the order
> of one second. ... When a student makes a response, the teacher reacts or asks
> another question within an average time of 0.9 seconds."

And the finding that gives the mechanism:

> "students discussing science phenomena tend to speak in bursts with intervals
> of **three to five seconds** between bursts being fairly common. The average
> post-student response wait-time of 0.9 seconds apparently intervenes between
> bursts **to prevent completion of a thought**."

At 3–5 s wait, across more than 900 tapes, nine student variables improve:
response length, unsolicited appropriate responses, failures to respond (down),
confidence, speculative responses, child-child comparisons, evidence-inference
statements, student questions, and responses from students the teacher rates as
slow. Rowe also found teachers already ration time by expectation — the top five
students get nearly two seconds, the bottom five get 0.9.

**A VAD-driven voice agent defaults to ~0.5–0.8 s. That is precisely the interval
Rowe identifies as destroying the student's thought.** Our silence threshold
after a student stops should be **≥3 s**.

### 2.9 Against building an error library

**Brown & Burton** (BUGGY/DEBUGGY) and **Brown & VanLehn 1980**, Repair Theory.
https://onlinelibrary.wiley.com/doi/abs/10.1207/s15516709cog0404_3

The documented limitation is that the paradigm cannot "explicitly represent the
semantic nature of a bug," and libraries were hand-built at the scale of
place-value subtraction. **Prefer mechanical checks** — dimensional analysis,
sign checks, limiting cases. A physics error library is a research programme,
not a feature.

---

## Part 3 — Ranked buildable ideas

Every one must route through **COMMIT** (flush queued audio, drop ops with
`anchor > samplesPlayed`) or the 5–13 s tool-call lead makes the reply land
6–13 s late.

### 1. Justify-the-pick — effort 1 — best ratio in the list
After any student action the teacher marks what was touched and asks one "kyun?".
The student answers **by voice**, which our stack already handles reliably.
Semantics from speech, referent from the tap. **Converts an Active tap into
Constructive/Interactive with zero recognition**, and satisfies both of Chi's
Interactive criteria.
*Risk:* our prompt is tuned to answer completely in one turn; this needs the
opposite discipline at these moments. Fall back after ~6 s (two Rowe intervals)
if the student will not talk.

### 2. Spot-the-error: the teacher plants a wrong line — effort 1–2
The teacher writes a short derivation with exactly one wrong line: "inme se ek
galat hai — dhoondh". **The model knows where the error is because it planted
it** — 100% ground truth, against the 0.43 a VLM manages on real student work.
*Risk:* the model must actually commit the planted error to the op log rather
than "helpfully" writing it correctly — the same over-correction instinct
documented in arXiv 2604.22774, here in generation. Verify against the written
op, not the transcript. Once per demo; gimmicky if repeated.

### 3. Commit-before-reveal: the board locks until the student predicts — effort 2
At a decision point the teacher writes 2–4 candidate next-lines as chalk options
with ids and **refuses to write the next line** until the student taps one. Closed
set of existing board objects, so "recognition" is a hit-test. On a wrong pick,
do not say wrong — keep the pick on the board and work the consequence until it
contradicts something.
*Risk:* our prompt currently forbids stopping to ask permission, so this needs a
distinct "real question" affordance or the model talks past its own lock.

### 4. Stroke-burst turn-taking — effort 2
Pen-down HOLDs teacher audio within the existing ~150 ms barge-in budget. The
teacher does **not** resume on pen-up; it waits 3 s of pen-idle. A short pen-up
inside a burst is not a turn boundary; a 3 s gap is.
*Tier split, and it matters:* **DOCUMENTED** — the 3–5 s burst gaps and the 0.9 s
intrusion (Rowe, primary). **OPINION** — that a *writing* student's stroke bursts
have the same structure as a *speaking* student's speech bursts. Nobody has
measured pen-idle gaps; 3 s is an inference and the first constant to tune.
*Risk:* palm-rest false triggers — require a deliberate press or stylus only.

### 5. Place-the-vector: closed-set sketching against named anchors — effort 3
The teacher draws the body only; the student drags chevrons onto it, snapping to
the figure's named compass anchors (`block.north` — the TikZ convention already
adopted) and angle buckets. The op carries `{anchor, angle_bucket, force_name}`
— a tuple from a closed set. The teacher gets structure, never a transcription.
Genuinely ICAP-Constructive, because the diagram was not already present.
*Needs* the chevron/anchor primitive layer that `docs/feature-research.md`
already schedules before figure #1.

### 6. Side-by-side: the student's attempt stays next to the correct line — effort 2
Whatever the student produced is never erased; it moves to a parallel dimmer
column keeping its `author` field, and the teacher points between the two. Our
planned student layer and `author` field are exactly the right substrate, and
replay then shows both tracks in the time-lapse.
*Risk:* board real estate — `units.ts` splits DERIVATION (5.2u) / FIGURE with no
third column. That is a layout decision, not just a render.

### 7. Student ink the teacher never reads — effort 2 — OPINION
Let the student write freely; the teacher **never transcribes it**, only points
at regions and asks the student to narrate. Ink stores as polylines, and our
chalk pipeline already takes `d` strings so student ink renders natively.
*Risk:* the illusion breaks the instant the teacher says anything specific about
content it cannot see. The prompt must forbid claims about student ink. This is
the honest way to have handwriting in a 2026 demo.

### 8. Dimensional check on any student-committed expression — effort 3
Mechanically exact, no ML, no false positives.
*Correction to an assumption worth recording:* `src/board/units.ts` is
**geometry** units (Manim board coordinates, `toPx`/`toUnits`), not physical
dimensions. A dimensional engine is ~150 lines of new code, not a reuse.
*Risk:* catches only dimensional errors — sign errors, wrong-body errors and
wrong formulae all pass clean, so never present a pass as "correct".

### Deliberately not recommended
- **Full handwritten-expression recognition for diagnosis** — FERMAT
  localisation 0.43 plus systematic over-correction bias.
- **A physics buggy-rule library** — documented as expensive and non-transferable.
- **Selling sketch input on learning outcomes.** The readable Mechanix evaluation
  reports a **null** result: "there was no change in the homework and concept
  inventory scores between both groups" (confounded by a server failure, N=122
  recruited). Only liking and motivation were positive. Take the learning claim
  from ICAP and productive failure instead.

### Two design facts worth copying verbatim from the real systems
- **Mechanix takes quantities through form fields with a unit dropdown**, never
  handwritten numerals (ASEE 2012 p.5). *Geometry by sketch, quantities by
  widget.*
- **Misrecognition is absorbed by an explicit loop, not hidden**: "Students are
  allowed to correct any errors in their work and resubmit until the entire
  content is correct." The student is always the arbiter of what they meant.
- Newton's Pen took the opposite bet and paid for it — it "relies on a particular
  digital pen and input technology, constraining the user to draw the sketches in
  a very particular way and order."

---

## Part 4 — Implications for our code

### 4.1 Split the tap into travel and apex
`src/teacher/pacing.ts` fires `point` as one lump 850 ms before its anchor, and
`scene.ts` gives it a 620 ms window whose pulse **decays from the first frame** —
so the apex is at the start and the pen is already fading while the teacher is
still saying the word. Per §1.1 the shape should be: movement starts ~350 ms
before the word, apex lands on it, then it holds. `PenTrack` already computes
travel from distance, so the tap should be anchored and travel derived.

### 4.2 Give the tap a minimum hold
A fixation takes ~102 ms to arrive. The pen should rest on target for ≥~200 ms
after the apex before it may travel onward. Nothing currently stops the next op
yanking it away.

### 4.3 Write down the asymmetry rule
Early is cheap (125 ms unnoticed), late is expensive (45 ms noticed). Wherever
the scheduler rounds, it should round early — as a comment in the scheduler,
because the next person to tune it will not know.

### 4.4 Raise the post-student silence threshold to ≥3 s
Currently VAD-driven and in the 0.5–0.8 s range, which is exactly the interval
Rowe identifies as cutting the student off between thought-bursts. This is the
cheapest change in the document and one of the best evidenced.

### 4.5 Point instead of describing position
Bangerter: pointing suppresses verbal location description. The prompt should
tell the teacher to point rather than say "the second line from the top" — more
natural, and shorter, which matters when every token is time.

### 4.6 Stop drawing the diagram the student should draw
When the FBD figure is built, the default should be that the teacher sets up the
situation and *asks*, rather than drawing it. ICAP p.222 decides this case
explicitly.

---

## Open questions and known gaps

**The largest unvalidated assumption.** Ideas 1–5 are all deictic — tap to
choose, drag to place, tap to refer. That vocabulary was chosen for *recognition
safety*, not because elicitation research supports it. No gesture-elicitation
study on what learners spontaneously reach for at a shared display could be
retrieved (Oviatt's multimodal percentages are paywalled).

**Open question for take 1: does a student tap, or circle/lasso, when asked
"which one?"** If they circle, ideas 2 and 3 need a lasso hit-test rather than a
point hit-test — cheap to add, but only if we know. This is the cheapest thing to
learn from the first real take, and it is upstream of four ranked ideas.

**A correction to this project's own brief:** AnimalWatch was cited as a
sketch-recognition tutor. It does not appear in that lineage. Mechanix's own
related-work section, by the leading sketch-tutor lab, enumerates the systems
that evaluate a student's FBD sketch — Andes, WinTruss, VaNTH ERC FBD Assistant,
Newton's Pen — and states: "None (but Newton's Pen) evaluate the student's sketch
of a FBD."

**Do not cite these as facts** — attempted and not verified: Mechanix recognition
accuracy; CROHME ExpRate and current handwritten-maths SOTA; MyScript / Mathpix /
ML Kit accuracy, browser support and latency; Oviatt's percentages; VanLehn 2011
ITS-vs-human effect sizes; Rosengrant 2009 exact percentages (direction verified
from the abstract only); Newton's Pen and CogSketch measured results;
Fiorella & Mayer's d = 0.40 (secondary summary only).
