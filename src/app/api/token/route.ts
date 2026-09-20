/**
 * Mints a single-use ephemeral token for the browser's Live API socket.
 *
 * The Live API is WebSocket-only — there is no WebRTC path — so the browser
 * connects directly and needs a credential. It must never be the real API key:
 * this route keeps GEMINI_API_KEY server-side and hands out a token that is
 * good for one session and expires in minutes.
 *
 * Two details that are easy to get wrong:
 *   - Ephemeral tokens are supported on **v1alpha only**, on both the mint and
 *     the client that uses the token.
 *   - `newSessionExpireTime` is the window in which a session may be OPENED
 *     (default ~1 minute), which is separate from how long that session may
 *     then run. So the token is minted at click-to-call, not at page load.
 */
import { GoogleGenAI } from '@google/genai';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
/** Every call must mint a fresh token; nothing here may be cached. */
export const dynamic = 'force-dynamic';

export async function POST() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      {
        error:
          'GEMINI_API_KEY is not set. Add it to .env.local in the project root, then restart `next dev`.',
      },
      { status: 500 },
    );
  }

  try {
    const ai = new GoogleGenAI({ apiKey, httpOptions: { apiVersion: 'v1alpha' } });
    const now = Date.now();
    // `authTokens`, not `tokens` — the SDK's own docstring example is stale.
    const token = await ai.authTokens.create({
      config: {
        // One socket per token.
        uses: 1,
        // How long the opened session may keep using it.
        expireTime: new Date(now + 30 * 60_000).toISOString(),
        // How long the browser has to open that session at all.
        newSessionExpireTime: new Date(now + 2 * 60_000).toISOString(),
      },
    });

    return NextResponse.json({ token: token.name });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
