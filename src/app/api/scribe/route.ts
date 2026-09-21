/**
 * The scribe: a fast text model that holds the chalk while the live model
 * talks — see `teacher/scribe.ts`.
 *
 * Server-side because it needs the real API key: the browser only ever holds
 * an ephemeral token, and those are good for the Live API alone.
 *
 * Thinking is set LOW — the lowest gemini-3.8-flash accepts (MINIMAL is
 * refused with a 400). The scribe's job is transcription into chalk, not
 * reasoning, and every millisecond it spends is taken out of the few seconds
 * of lead the transcript has over the student's ears.
 */
import { FunctionCallingConfigMode, GoogleGenAI, ThinkingLevel } from '@google/genai';
import { NextResponse } from 'next/server';

import { SCRIBE_PROMPT, SCRIBE_TOOLS, scribeMessage, type ScribeRequest } from '@/teacher/scribe';

export const runtime = 'nodejs';
/** Every request is a fresh moment of the lesson; nothing here may be cached. */
export const dynamic = 'force-dynamic';

const MODEL = 'gemini-3.8-flash';

const declarations = SCRIBE_TOOLS.map((t) => ({
  name: t.name,
  description: t.description,
  parametersJsonSchema: { type: 'object', properties: t.parameters, required: t.required ?? [] },
}));

let ai: GoogleGenAI | null = null;

export async function POST(req: Request) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { calls: [], ms: 0, error: 'GEMINI_API_KEY is not set. Add it to .env.local, then restart `next dev`.' },
      { status: 500 },
    );
  }
  ai ??= new GoogleGenAI({ apiKey });

  const body = (await req.json()) as ScribeRequest;
  const t0 = Date.now();
  try {
    const res = await ai.models.generateContent({
      model: MODEL,
      contents: [{ role: 'user', parts: [{ text: scribeMessage(body) }] }],
      config: {
        systemInstruction: SCRIBE_PROMPT,
        tools: [{ functionDeclarations: declarations }],
        toolConfig: { functionCallingConfig: { mode: FunctionCallingConfigMode.AUTO } },
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      },
    });
    const calls = (res.functionCalls ?? []).map((c) => ({
      name: c.name ?? '',
      args: (c.args ?? {}) as Record<string, unknown>,
    }));
    return NextResponse.json({ calls, ms: Date.now() - t0 });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ calls: [], ms: Date.now() - t0, error: message }, { status: 502 });
  }
}
