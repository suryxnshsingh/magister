'use client';

/**
 * Presence — the teacher's "face".
 *
 * An aurora rather than a face or a waveform. A waveform visualises audio; a
 * presence should say what the teacher is *doing* — waiting, listening,
 * thinking, talking — which is what a student reads off a real person.
 *
 * Adapted from React Bits' SoftAurora, with three changes this project needs:
 *
 * 1. **The GL context is built once.** The original lists every prop in its
 *    effect deps and tears down the renderer whenever one changes. Driving
 *    brightness from the mic at 60fps would destroy and rebuild the WebGL
 *    context every frame. Props live in a ref and are written straight into
 *    uniforms inside the render loop instead.
 *
 * 2. **State drives the shader**, through a target/current lerp, so changes
 *    ease rather than snap. A presence that jumps between moods reads as a
 *    status light.
 *
 * 3. **`uMouse` is repurposed as a gaze vector.** It offsets the whole band,
 *    so pointing it at the pen makes the teacher lean toward what it is
 *    writing — which is the attention behaviour the orb was specified to have,
 *    and the thing that separates a presence from a mood light.
 */
import { Renderer, Program, Mesh, Triangle } from 'ogl';
import { useEffect, useRef } from 'react';

import { type PresenceProps, type PresenceState } from './presence-types';

export type { PresenceProps, PresenceState };

interface Look {
  speed: number;
  brightness: number;
  noiseAmp: number;
  bandSpread: number;
  colorSpeed: number;
  c1: [number, number, number];
  c2: [number, number, number];
}

import { hexToRgb as hex } from './presence-types';

/**
 * Moods, in the room's palette — no greens, which belong to the board alone.
 * Slate before it is live, ember when ready, violet while working, chalk while
 * speaking.
 */
const LOOKS: Record<PresenceState, Look> = {
  /** Cold and searching — not yet live. */
  connecting: {
    speed: 0.55, brightness: 0.5, noiseAmp: 1.4, bandSpread: 0.45,
    colorSpeed: 0.2, c1: hex('#93a7bd'), c2: hex('#43546b'),
  },
  error: {
    speed: 0.08, brightness: 0.55, noiseAmp: 0.6, bandSpread: 0.8,
    colorSpeed: 0.1, c1: hex('#e08a7a'), c2: hex('#8a3a2a'),
  },
  idle: {
    speed: 0.10, brightness: 0.72, noiseAmp: 0.7, bandSpread: 0.8,
    colorSpeed: 0.18, c1: hex('#6d6659'), c2: hex('#33302b'),
  },
  listening: {
    speed: 0.16, brightness: 0.82, noiseAmp: 0.9, bandSpread: 1.05,
    colorSpeed: 0.28, c1: hex('#e8b45c'), c2: hex('#8a6427'),
  },
  thinking: {
    // The one state allowed to look like work: fast churn, tight concentrated
    // band, colour cycling hard. Everything else stays calm so this reads as
    // effort rather than just speed.
    speed: 1.05, brightness: 0.85, noiseAmp: 2.0, bandSpread: 0.5,
    colorSpeed: 2.0, c1: hex('#bfb0ee'), c2: hex('#6a5aa8'),
  },
  speaking: {
    speed: 0.24, brightness: 1.22, noiseAmp: 1.0, bandSpread: 1.2,
    colorSpeed: 0.34, c1: hex('#f5f0e2'), c2: hex('#d99a3f'),
  },
};

const vertex = /* glsl */ `
attribute vec2 uv;
attribute vec2 position;
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position, 0, 1); }
`;

const fragment = /* glsl */ `
precision highp float;
uniform float uTime;
uniform vec3  uResolution;
uniform float uSpeed;
uniform float uScale;
uniform float uBrightness;
uniform vec3  uColor1;
uniform vec3  uColor2;
uniform float uNoiseFreq;
uniform float uNoiseAmp;
uniform float uBandHeight;
uniform float uBandSpread;
uniform float uOctaveDecay;
uniform float uLayerOffset;
uniform float uColorSpeed;
uniform vec2  uGaze;
uniform float uGazeInfluence;

#define TAU 6.28318

vec3 gradientHash(vec3 p) {
  p = vec3(dot(p, vec3(127.1, 311.7, 234.6)),
           dot(p, vec3(269.5, 183.3, 198.3)),
           dot(p, vec3(169.5, 283.3, 156.9)));
  vec3 h = fract(sin(p) * 43758.5453123);
  float phi = acos(2.0 * h.x - 1.0);
  float theta = TAU * h.y;
  return vec3(cos(theta) * sin(phi), sin(theta) * cos(phi), cos(phi));
}

float quinticSmooth(float t) {
  float t2 = t * t, t3 = t * t2;
  return 6.0 * t3 * t2 - 15.0 * t2 * t2 + 10.0 * t3;
}

vec3 cosineGradient(float t, vec3 a, vec3 b, vec3 c, vec3 d) {
  return a + b * cos(TAU * (c * t + d));
}

float perlin3D(float amplitude, float frequency, float px, float py, float pz) {
  float x = px * frequency, y = py * frequency;
  float fx = floor(x), fy = floor(y), fz = floor(pz);
  float cx = ceil(x),  cy = ceil(y),  cz = ceil(pz);
  vec3 g000 = gradientHash(vec3(fx, fy, fz));
  vec3 g100 = gradientHash(vec3(cx, fy, fz));
  vec3 g010 = gradientHash(vec3(fx, cy, fz));
  vec3 g110 = gradientHash(vec3(cx, cy, fz));
  vec3 g001 = gradientHash(vec3(fx, fy, cz));
  vec3 g101 = gradientHash(vec3(cx, fy, cz));
  vec3 g011 = gradientHash(vec3(fx, cy, cz));
  vec3 g111 = gradientHash(vec3(cx, cy, cz));
  float d000 = dot(g000, vec3(x - fx, y - fy, pz - fz));
  float d100 = dot(g100, vec3(x - cx, y - fy, pz - fz));
  float d010 = dot(g010, vec3(x - fx, y - cy, pz - fz));
  float d110 = dot(g110, vec3(x - cx, y - cy, pz - fz));
  float d001 = dot(g001, vec3(x - fx, y - fy, pz - cz));
  float d101 = dot(g101, vec3(x - cx, y - fy, pz - cz));
  float d011 = dot(g011, vec3(x - fx, y - cy, pz - cz));
  float d111 = dot(g111, vec3(x - cx, y - cy, pz - cz));
  float sx = quinticSmooth(x - fx), sy = quinticSmooth(y - fy), sz = quinticSmooth(pz - fz);
  float lx00 = mix(d000, d100, sx), lx10 = mix(d010, d110, sx);
  float lx01 = mix(d001, d101, sx), lx11 = mix(d011, d111, sx);
  return amplitude * mix(mix(lx00, lx10, sy), mix(lx01, lx11, sy), sz);
}

float auroraGlow(float t, vec2 shift) {
  vec2 uv = gl_FragCoord.xy / uResolution.y + shift;
  float noiseVal = 0.0, freq = uNoiseFreq, amp = uNoiseAmp;
  vec2 samplePos = uv * uScale;
  for (float i = 0.0; i < 3.0; i += 1.0) {
    noiseVal += perlin3D(amp, freq, samplePos.x, samplePos.y, t);
    amp *= uOctaveDecay;
    freq *= 2.0;
  }
  float yBand = uv.y * 10.0 - uBandHeight * 10.0;
  return 0.3 * max(exp(uBandSpread * (1.0 - 1.1 * abs(noiseVal + yBand))), 0.0);
}

void main() {
  vec2 uv = gl_FragCoord.xy / uResolution.xy;
  float t = uSpeed * 0.4 * uTime;
  // Gaze leans the band toward whatever the teacher is attending to.
  vec2 shift = (uGaze - 0.5) * uGazeInfluence;
  float glow1 = auroraGlow(t, shift);
  float glow2 = auroraGlow(t + uLayerOffset, shift);
  vec3 g1 = cosineGradient(uv.x + uTime * uSpeed * 0.2 * uColorSpeed, vec3(0.5), vec3(0.5), vec3(1.0), vec3(0.3, 0.20, 0.20));
  vec3 g2 = cosineGradient(uv.x + uTime * uSpeed * 0.1 * uColorSpeed, vec3(0.5), vec3(0.5), vec3(2.0, 1.0, 0.0), vec3(0.5, 0.20, 0.25));
  vec3 col = 0.99 * glow1 * g1 * uColor1 + 0.99 * glow2 * g2 * uColor2;
  col *= uBrightness;
  gl_FragColor = vec4(col, clamp(length(col), 0.0, 1.0));
}
`;

import { lerp } from './presence-types';

export default function Presence({ state, level = 0, gaze = null, className }: PresenceProps) {
  const host = useRef<HTMLDivElement>(null);
  // Live props, read inside the render loop — never in the effect's deps.
  // Synced after render rather than during it: writing a ref mid-render is a
  // concurrent-rendering hazard, and this is the whole mechanism that keeps
  // the GL context from being rebuilt on every level change.
  const live = useRef({ state, level, gaze });
  useEffect(() => {
    live.current = { state, level, gaze };
  });

  useEffect(() => {
    const el = host.current;
    if (!el) return;

    const renderer = new Renderer({ alpha: true, premultipliedAlpha: false });
    const gl = renderer.gl;
    gl.clearColor(0, 0, 0, 0);

    const start = { ...LOOKS.idle };
    const program = new Program(gl, {
      vertex,
      fragment,
      uniforms: {
        uTime: { value: 0 },
        uResolution: { value: [1, 1, 1] },
        uSpeed: { value: start.speed },
        uScale: { value: 1.5 },
        uBrightness: { value: start.brightness },
        uColor1: { value: [...start.c1] },
        uColor2: { value: [...start.c2] },
        uNoiseFreq: { value: 2.5 },
        uNoiseAmp: { value: start.noiseAmp },
        uBandHeight: { value: 0.5 },
        uBandSpread: { value: start.bandSpread },
        uOctaveDecay: { value: 0.1 },
        uLayerOffset: { value: 0.35 },
        uColorSpeed: { value: start.colorSpeed },
        uGaze: { value: new Float32Array([0.5, 0.5]) },
        uGazeInfluence: { value: 0.3 },
      },
    });
    const mesh = new Mesh(gl, { geometry: new Triangle(gl), program });

    const resize = () => {
      renderer.setSize(el.offsetWidth, el.offsetHeight);
      program.uniforms.uResolution.value = [
        gl.canvas.width,
        gl.canvas.height,
        gl.canvas.width / gl.canvas.height,
      ];
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();
    el.appendChild(gl.canvas);

    const cur = { ...start, gx: 0.5, gy: 0.5, lvl: 0, think: 0 };
    let raf = 0;

    const frame = (ms: number) => {
      raf = requestAnimationFrame(frame);
      const { state: s, level: lv, gaze: gz } = live.current;
      const want = LOOKS[s];
      // Ease toward the target look; a presence that snaps reads as a status light.
      // Mood eases slowly; loudness (below) rides on top of it faster.
      const k = 0.045;
      // A slow sweep while thinking — turning something over, not spinning.
      cur.think = lerp(cur.think, s === 'thinking' ? 1 : 0, 0.05);
      const search = Math.sin(ms * 0.0022) * cur.think;
      cur.colorSpeed = lerp(cur.colorSpeed, want.colorSpeed, k);
      for (let i = 0; i < 3; i++) {
        cur.c1[i] = lerp(cur.c1[i], want.c1[i], k);
        cur.c2[i] = lerp(cur.c2[i], want.c2[i], k);
      }
      /**
       * Loudness drives motion, not just brightness — but gently.
       *
       * A band that only brightens per syllable reads as a level meter, so the
       * same signal also moves the flow. The temptation is to push it hard;
       * that produces jitter. What reads as alive is a slow, continuous drift
       * with shallow swells on top — the voice modulates an existing motion
       * rather than starting and stopping one.
       *
       * `softKnee` saturates smoothly instead of clipping at 1, which is what
       * made loud passages pin to maximum and then drop off a cliff.
       */
      // Asymmetric here too: the presence should rise with the voice and
      // settle slowly, not lag it in both directions.
      const target = 1 - Math.exp(-Math.max(0, lv) * 2.2);
      cur.lvl = lerp(cur.lvl, target, target > cur.lvl ? 0.2 : 0.05);
      const kf = k * 1.5;
      cur.brightness = lerp(cur.brightness, want.brightness * (0.86 + cur.lvl * 0.34), kf);
      cur.speed = lerp(cur.speed, want.speed * (1 + cur.lvl * 0.35), kf);
      cur.noiseAmp = lerp(cur.noiseAmp, want.noiseAmp * (1 + cur.lvl * 0.2) + search * 0.45, kf);
      // Louder moments bloom a little wider before settling back.
      cur.bandSpread = lerp(cur.bandSpread, want.bandSpread * (1 + cur.lvl * 0.22), kf);

      const tx = gz ? gz.x : 0.5;
      const ty = gz ? gz.y : 0.5;
      // Slow enough to read as looking over, not snapping to.
      cur.gx = lerp(cur.gx, tx, 0.02);
      cur.gy = lerp(cur.gy, ty, 0.02);

      const u = program.uniforms;
      u.uTime.value = ms * 0.001;
      u.uSpeed.value = cur.speed;
      u.uBrightness.value = cur.brightness;
      u.uNoiseAmp.value = cur.noiseAmp;
      u.uBandSpread.value = cur.bandSpread;
      u.uColorSpeed.value = cur.colorSpeed;
      (u.uColor1.value as number[])[0] = cur.c1[0];
      (u.uColor1.value as number[])[1] = cur.c1[1];
      (u.uColor1.value as number[])[2] = cur.c1[2];
      (u.uColor2.value as number[])[0] = cur.c2[0];
      (u.uColor2.value as number[])[1] = cur.c2[1];
      (u.uColor2.value as number[])[2] = cur.c2[2];
      (u.uGaze.value as Float32Array)[0] = cur.gx;
      (u.uGaze.value as Float32Array)[1] = cur.gy;

      renderer.render({ scene: mesh });
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      if (gl.canvas.parentNode === el) el.removeChild(gl.canvas);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    };
    // Runs once. Everything dynamic goes through `live`.
  }, []);

  return <div ref={host} className={className} style={{ width: '100%', height: '100%' }} />;
}
