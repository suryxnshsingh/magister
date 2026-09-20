# magister

A voice-first physics teacher that uses a blackboard.

You call it and talk. It talks back in Hinglish, and while it talks it writes on
the board behind it — equations glyph by glyph, figures built up a step at a
time, pointing at what it wrote a minute ago. Interrupt it mid-sentence and the
chalk stops mid-stroke, because that is what happens when a teacher is
interrupted.

Built for NEET/JEE physics.

## The idea

Most "AI tutors" are a chat window. The interesting part of a physics lesson is
not the text — it is the board, and a teacher's relationship to it: what they
choose to write, where they put it, what they leave up, what they point back to.

So the board here is not an illustration of the answer. It is the teacher's
working surface, driven live by the same model that is speaking, with the ink
landing on the word.

## What makes it hard

The model generates faster than it speaks. A tool call arrives **5–13 seconds
before the audio it belongs to**, so drawing when the call arrives puts the ink
a sentence and a half ahead of the voice. Every board op is therefore anchored
to the audio **playback** clock and fired when the speaker actually reaches it.

The same gap shows up everywhere else: anything the student perceives has to be
driven by what they are actually experiencing, never by the event that predicts
it.

## Running it

Needs Node 22+ and a Gemini API key.

```bash
npm install
echo "GEMINI_API_KEY=your-key-here" > .env.local
npm run dev
```

Then open http://localhost:3000 and press **Begin lesson**. Use headphones — the
echo guard handles speaker bleed, but headphones make it cleaner.

## Pages

| Route | What it is |
|---|---|
| `/` | The lesson. Mic, board, presence, transcript |
| `/replay` | Any recorded lesson played back from its op log, with 1–8x time-lapse |
| `/figure-test` | Every registered figure at board scale, steps drivable |
| `/write-test` | Mid-stroke freeze rendering, settled vs raw |
| `/board-fit` | Does a full lesson's board fit one page |
| `/chalk-test` | Chalk roughening |
| `/presence-test` | The presence orb's states |
| `/spike` | The voice-transport measurements |

## How it fits together

```
mic → capture worklet → local VAD → hold/commit/resume
                                          │
                              Gemini Live (WebSocket)
                                          │
        audio ──► player worklet ──► samplesPlayed
                                          │
             toolCall ──► scheduler (anchored to playback) ──► dispatch
                                          │
                        Scene: one clock, ops as pure functions of time
                                          │
                                   append-only op log
```

- `src/board` — the board. Framework-free TypeScript: clock, scene, pen,
  animations, chalk, figure templates, op log.
- `src/voice` — transport and scheduling. Gemini Live sits behind a
  `VoiceSession` interface so it can be swapped.
- `src/teacher` — what the model is told and what its calls mean: prompt, tools,
  dispatch, the degree-mode calculator.
- `src/ui` — presence orb and transcript.
- `docs/` — the screenplay, the transport measurements, the feature research.

Every animation is a pure function of scene time, so scrubbing backwards lands
on exactly the frame the forward pass showed. A freeze mid-stroke is not a
special case — it is a gap between two time segments, which is why it can be
resumed.

## State

Working: the full voice loop, board writing with real MathJax, figures with
reveal steps, pointing and marking, mid-stroke interruption, session recording
and replay.

Not built yet: the freeform drawing DSL, student input on the board, and most of
the figure library — free-body diagrams, ray diagrams and circuits are the next
three. See `docs/feature-research.md` for the ranked build order.
