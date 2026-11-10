// Soundtrack synthesiser. No samples: everything is generated from noise and
// oscillators, shaped by filters, and placed in two convolution reverbs (a
// dead carpeted corridor and a huge tiled hall). It reads the very same GSAP
// timeline and flicker curves as the picture, so glitches, lights, footsteps
// and the final cut are sample-locked to the frames.
//
//   node scripts/audio.mjs            -> build/audio.wav  (48 kHz, 16 bit, stereo, 20 s)
import fs from 'node:fs';
import path from 'node:path';
import { BUILD } from './lib.mjs';
import { DURATION, CUT_TO_BLACK } from '../src/config.js';
import { mulberry32, clamp, smoothstep, hash1 } from '../src/shared/math.js';
import { poolLight, poolLightGroup, corridorLight, POOL_FLICKER_EVENTS } from '../src/shared/flicker.js';
import { createTimeline } from '../src/timeline.js';

const SR = 48000;
const N = SR * DURATION;
const TAU = Math.PI * 2;
const rnd = mulberry32(20241);
const rr = (a, b) => a + (b - a) * rnd();
const dB = (x) => Math.pow(10, x / 20);

// --------------------------------------------------------------- buses
const mk = () => [new Float32Array(N), new Float32Array(N)];
const dry = mk();        // straight to the mix
const sendHall = mk();   // -> pool hall reverb
const sendCorr = mk();   // -> corridor reverb

function put(sig, t0, { pan = 0, gain = 1, hall = 0, corr = 0, dryGain = 1 } = {}) {
  const o = Math.round(t0 * SR);
  const a = (clamp(pan, -1, 1) + 1) * 0.25 * Math.PI;
  const gl = Math.cos(a) * gain, gr = Math.sin(a) * gain;
  for (let i = 0; i < sig.length; i++) {
    const j = o + i;
    if (j < 0 || j >= N) continue;
    const s = sig[i];
    dry[0][j] += s * gl * dryGain; dry[1][j] += s * gr * dryGain;
    if (hall) { sendHall[0][j] += s * gl * hall; sendHall[1][j] += s * gr * hall; }
    if (corr) { sendCorr[0][j] += s * gl * corr; sendCorr[1][j] += s * gr * corr; }
  }
}

// ----------------------------------------------------------- generators
const len = (sec) => Math.max(1, Math.round(sec * SR));
function white(n) { const o = new Float32Array(n); for (let i = 0; i < n; i++) o[i] = rnd() * 2 - 1; return o; }
function gen(sec, fn) { const n = len(sec); const o = new Float32Array(n); for (let i = 0; i < n; i++) o[i] = fn(i / SR, i); return o; }
const val = (f, i, n) => (typeof f === 'function' ? f(i / SR, i / n) : f);

// RBJ biquad; f0 / Q may be functions of (time, 0..1 progress)
function biquad(sig, type, f0, Q = 0.707) {
  const n = sig.length;
  const out = new Float32Array(n);
  let b0 = 0, b1 = 0, b2 = 0, a1 = 0, a2 = 0, x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  const dynamic = typeof f0 === 'function' || typeof Q === 'function';
  const coef = (i) => {
    const f = clamp(val(f0, i, n), 10, SR * 0.45);
    const q = Math.max(0.05, val(Q, i, n));
    const w = (TAU * f) / SR, c = Math.cos(w), al = Math.sin(w) / (2 * q);
    const a0 = 1 + al;
    if (type === 'lp') { b0 = (1 - c) / 2; b1 = 1 - c; b2 = b0; }
    else if (type === 'hp') { b0 = (1 + c) / 2; b1 = -(1 + c); b2 = b0; }
    else { b0 = al; b1 = 0; b2 = -al; }
    b0 /= a0; b1 /= a0; b2 /= a0; a1 = (-2 * c) / a0; a2 = (1 - al) / a0;
  };
  coef(0);
  for (let i = 0; i < n; i++) {
    if (dynamic && (i & 31) === 0) coef(i);
    const x = sig[i];
    const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    out[i] = y;
  }
  return out;
}
const lp = (s, f, q) => biquad(s, 'lp', f, q);
const hp = (s, f, q) => biquad(s, 'hp', f, q);
const bp = (s, f, q) => biquad(s, 'bp', f, q);
function mul(sig, fn) { const o = new Float32Array(sig.length); for (let i = 0; i < sig.length; i++) o[i] = sig[i] * fn(i / SR, i / sig.length); return o; }
function add(...sigs) { const n = Math.max(...sigs.map((s) => s.length)); const o = new Float32Array(n); for (const s of sigs) for (let i = 0; i < s.length; i++) o[i] += s[i]; return o; }
const scale = (sig, g) => mul(sig, () => g);
const hann = (x) => Math.sin(Math.PI * clamp(x)) ** 2;
const ad = (t, a, d) => (t < a ? t / a : Math.exp(-(t - a) / d));
// smooth random control signal in [0,1]
function wander(sec, rate, seed) {
  return (t) => {
    const x = t * rate + seed * 31.7;
    const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f);
    return hash1(i + seed * 7.13) * (1 - u) + hash1(i + 1 + seed * 7.13) * u;
  };
}

// ------------------------------------------------------- the timeline
const { tl, state } = createTimeline();
const CTRL = 480;                         // control rate: 100 Hz
function sampleTrack(prop) {
  const n = Math.ceil(N / CTRL) + 1;
  const a = new Float32Array(n);
  for (let i = 0; i < n; i++) { tl.time(Math.min((i * CTRL) / SR, DURATION - 1e-4), false); a[i] = state[prop]; }
  return (t) => {
    const x = clamp((t * SR) / CTRL, 0, n - 1.001), i = Math.floor(x);
    return a[i] + (a[i + 1] - a[i]) * (x - i);
  };
}
const glitchAt = sampleTrack('glitch');
const radialAt = sampleTrack('radial');
const agitAt = sampleTrack('agit');
const shakeAt = sampleTrack('shake');

// ====================================================================
// 0.0 - 2.9   THE CORRIDOR
// ====================================================================
{
  // fluorescent ballast hum, following the tubes as they start to fail
  const hum = gen(3.5, (t) => {
    const lvl = 0.35 + 0.65 * (corridorLight(t, 0) * 0.6 + corridorLight(t, 1) * 0.4);
    // after the floor goes the corridor recedes upwards: pitch sags, level drops
    const fall = smoothstep(2.9, 3.4, t);
    const ph = TAU * (t - 0.18 * fall * fall * (t - 2.9));
    const s = Math.sin(120 * ph) * 0.5 + Math.sin(240 * ph + 0.4) * 0.28 + Math.sin(360 * ph + 1.1) * 0.16 + Math.sin(60 * ph) * 0.22 + Math.sin(480 * ph) * 0.09 + Math.sin(600 * ph + 2) * 0.06 + Math.sin(720 * ph) * 0.04;
    return s * lvl * (1 - fall) * (0.9 + 0.1 * Math.sin(TAU * 0.7 * t));
  });
  put(hum, 0, { gain: dB(-23), corr: 0.5 });
  const buzz = mul(bp(white(len(3.4)), 4200, 3), (t) => (0.5 + 0.5 * Math.sin(TAU * 120 * t)) ** 3 * corridorLight(t, 1) * (1 - smoothstep(2.9, 3.3, t)));
  put(buzz, 0, { gain: dB(-31), pan: 0.15, corr: 0.6 });
  // air handling
  const air = mul(lp(white(len(3.6)), 260, 0.6), (t) => 1 - smoothstep(2.95, 3.5, t));
  put(air, 0, { gain: dB(-24), pan: -0.2, corr: 0.3 });
  put(mul(lp(white(len(3.6)), 900, 0.5), (t) => 1 - smoothstep(2.95, 3.5, t)), 0, { gain: dB(-32), pan: 0.3 });

  // footsteps on carpet (strike times follow the head-bob of the camera)
  [0.40, 0.93, 1.47, 2.00, 2.48].forEach((t0, k) => {
    const thud = gen(0.16, (t) => Math.sin(TAU * (74 - 180 * t) * t) * ad(t, 0.004, 0.035));
    const scuff = mul(lp(white(len(0.14)), 1900, 0.7), (t) => ad(t, 0.006, 0.03));
    const cloth = mul(bp(white(len(0.3)), 3200, 1.2), (t, x) => hann(x) * 0.6);
    put(add(scale(thud, 0.9), scale(scuff, 0.55)), t0, { gain: dB(-12), pan: k % 2 ? 0.22 : -0.22, corr: 0.45 });
    put(cloth, t0 - 0.12, { gain: dB(-31), pan: k % 2 ? -0.1 : 0.1 });
  });

  // failing tubes: relay ticks whenever a tube changes state
  let prev = 1;
  for (let q = Math.floor(2.1 * 30); q < 3.3 * 30; q++) {
    const t = (q + 0.5) / 30;
    const now = corridorLight(t, 0);
    if (now !== prev) {
      const tick = mul(bp(white(len(0.03)), rr(2500, 5200), 4), (tt) => ad(tt, 0.0005, 0.006));
      put(tick, q / 30, { gain: dB(-20) * (1 - smoothstep(2.9, 3.3, t)), pan: rr(-0.5, 0.5), corr: 0.8 });
    }
    prev = now;
  }
}

// digital tearing — follows the picture's glitch amount (corridor, fall, finale)
{
  const g = gen(DURATION, (t) => {
    const a = glitchAt(t);
    if (a < 0.01 || t >= CUT_TO_BLACK) return 0;
    const q = Math.floor(t * 24);
    const f = 90 * Math.pow(2, Math.floor(hash1(q * 3.1) * 30) / 6);       // stepped pitches
    const gate = hash1(Math.floor(t * 96) * 1.7 + 4) > 0.42 ? 1 : 0;
    const sq = Math.sign(Math.sin(TAU * f * t)) * 0.5 + Math.sign(Math.sin(TAU * f * 1.498 * t)) * 0.3;
    const crush = Math.round(hash1(Math.floor(t * (2400 + 6000 * hash1(q))) * 0.37) * 6) / 3 - 1;
    return (sq * 0.55 + crush * 0.6) * gate * a;
  });
  const lo = hp(g, 140);
  put(lo, 0, { gain: dB(-15), corr: 0.15 });
}

// ====================================================================
// 2.9 - 4.0   THE FALL
// ====================================================================
{
  // sharp intake of breath as the floor goes
  const gasp = mul(add(bp(white(len(0.42)), (t, x) => 1500 + 1500 * x, 2.2), scale(bp(white(len(0.42)), (t, x) => 3400 + 900 * x, 3), 0.5)), (t, x) => Math.pow(x, 1.6) * (1 - smoothstep(0.86, 1, x)));
  put(gasp, 2.78, { gain: dB(-13), corr: 0.2 });

  // air tearing past, rising all the way down
  const T = 1.22;
  const w = white(len(T));
  const rush = add(
    scale(bp(w, (t, x) => 260 + 2600 * x * x, 0.9), 1.0),
    scale(bp(white(len(T)), (t, x) => 900 + 5200 * x * x, 1.4), 0.5),
    scale(lp(white(len(T)), 110, 0.8), 1.6),
  );
  const env = (t, x) => Math.pow(x, 2.2) * (1 - smoothstep(0.985, 1, x)) * (0.8 + 0.2 * Math.sin(TAU * 7.3 * t));
  put(mul(rush, env), 2.8, { gain: dB(-6), pan: -0.25 });
  put(mul(bp(white(len(T)), (t, x) => 340 + 2300 * x * x, 1.1), env), 2.8, { gain: dB(-9), pan: 0.5 });
  // a tone that climbs with the speed (the "noclip" itself)
  const riser = gen(T, (t) => {
    const x = t / T;
    const f = 55 * Math.pow(2, 2.6 * x * x);
    return (Math.sin(TAU * f * t) + 0.5 * Math.sin(TAU * f * 2.01 * t) + 0.3 * Math.sin(TAU * f * 2.99 * t)) * Math.pow(x, 1.7) * (1 - smoothstep(0.985, 1, x));
  });
  put(riser, 2.8, { gain: dB(-17) });
}

// ====================================================================
// 4.0 - 5.3   IMPACT + UNDER WATER
// ====================================================================
{
  // the hit
  const slap = mul(lp(hp(white(len(0.9)), 160), (t) => 9000 * Math.exp(-t * 7) + 420, 0.7), (t) => ad(t, 0.002, 0.16));
  put(slap, 4.0, { gain: dB(-1.5), pan: -0.15, hall: 0.25 });
  put(mul(lp(hp(white(len(0.9)), 300), (t) => 7000 * Math.exp(-t * 6) + 500, 0.7), (t) => ad(t, 0.003, 0.2)), 4.0, { gain: dB(-4), pan: 0.4, hall: 0.25 });
  const boom = gen(0.9, (t) => Math.sin(TAU * (38 * t + 58 * (1 - Math.exp(-t * 6)) / 6)) * ad(t, 0.004, 0.24));
  put(boom, 4.0, { gain: dB(-5) });

  // pressure and rumble with the head under
  const rumble = mul(lp(white(len(1.5)), (t) => 240 - 60 * t, 1.1), (t, x) => smoothstep(0, 0.04, x) * (1 - smoothstep(0.78, 0.92, x)));
  put(rumble, 4.02, { gain: dB(-10), pan: -0.2 });
  put(mul(lp(white(len(1.5)), 170, 1.2), (t, x) => smoothstep(0, 0.04, x) * (1 - smoothstep(0.78, 0.92, x))), 4.02, { gain: dB(-10), pan: 0.3 });
  const ear = gen(1.3, (t) => (Math.sin(TAU * 96 * t) * 0.6 + Math.sin(TAU * 143 * t) * 0.3) * hann(t / 1.3) * (0.7 + 0.3 * Math.sin(TAU * 3.1 * t)));
  put(ear, 4.03, { gain: dB(-21) });

  // bubbles: short rising chirps, dense at first
  const bub = (f, d) => gen(d, (t) => Math.sin(TAU * f * (t + 1.6 * t * t / d * 0.25)) * ad(t, 0.002, d * 0.3));
  for (let k = 0; k < 150; k++) {
    const t0 = 4.02 + Math.pow(rnd(), 1.7) * 1.2;
    const f = rr(260, 1500) * (1 + (t0 - 4) * 0.25);
    put(lp(bub(f, rr(0.02, 0.07)), 1500), t0, { gain: dB(rr(-30, -17)), pan: rr(-0.8, 0.8) });
  }
  // one muffled heartbeat in the quiet under the surface
  const beat = () => gen(0.3, (t) => Math.sin(TAU * 52 * t) * ad(t, 0.006, 0.045) + Math.sin(TAU * 44 * (t - 0.13)) * (t > 0.13 ? ad(t - 0.13, 0.006, 0.06) : 0) * 0.8);
  put(beat(), 4.42, { gain: dB(-13) });
  put(beat(), 4.98, { gain: dB(-12) });

  // breaking the surface: water sheeting off, then the big room opens up
  const sheet = mul(bp(white(len(0.7)), (t, x) => 4200 - 2400 * x, 0.8), (t, x) => ad(t, 0.015, 0.16) * (0.7 + 0.3 * Math.sin(TAU * 31 * t)));
  put(sheet, 5.2, { gain: dB(-10), pan: 0.1, hall: 0.3 });
  for (let k = 0; k < 26; k++) {
    const t0 = 5.25 + Math.pow(rnd(), 1.5) * 1.5;
    const f = rr(900, 3200);
    const plink = gen(0.09, (t) => Math.sin(TAU * f * (t + 4 * t * t)) * ad(t, 0.001, 0.014));
    put(plink, t0, { gain: dB(rr(-34, -24)), pan: rr(-0.6, 0.6), hall: 0.5 });
  }
}

// ====================================================================
// breathing (close to the microphone, all the way through)
// ====================================================================
function breath(dur, { inhale = true, bright = 1, voice = 0 } = {}) {
  const n = len(dur);
  const f1 = inhale ? (t, x) => (1500 + 900 * x) * bright : (t, x) => (1050 - 250 * x) * bright;
  const f2 = inhale ? 3300 * bright : 2300 * bright;
  let s = add(scale(bp(white(n), f1, 1.6), 1), scale(bp(white(n), f2, 2.4), 0.45), scale(hp(white(n), 5200), inhale ? 0.1 : 0.05));
  const flut = wander(dur, 38, rnd() * 100);
  s = mul(s, (t, x) => {
    const e = inhale ? Math.pow(Math.sin(Math.PI * Math.pow(x, 0.75)), 1.2) : Math.pow(Math.sin(Math.PI * Math.pow(x, 0.55)), 1.5);
    return e * (0.75 + 0.25 * flut(t));
  });
  if (voice > 0) {
    // a little throat in it: panic
    const v = gen(dur, (t) => {
      const x = t / dur;
      const f = (inhale ? 250 + 80 * x : 215 - 55 * x) * (1 + 0.02 * Math.sin(TAU * 31 * t));
      return (Math.sin(TAU * f * t) + 0.5 * Math.sin(TAU * 2 * f * t) + 0.25 * Math.sin(TAU * 3 * f * t)) * Math.sin(Math.PI * x) ** 2;
    });
    s = add(s, scale(lp(v, 1400), voice));
  }
  return s;
}
{
  const B = (t0, dur, gain, o = {}) => put(breath(dur, o), t0, { gain: dB(gain), pan: 0.04, hall: 0.12, ...(o.corr ? { corr: 0.2, hall: 0 } : {}) });
  // corridor: barely there
  B(0.55, 0.9, -37, { corr: true }); B(1.5, 1.1, -39, { inhale: false, corr: true });
  // gasping after the dive
  B(5.26, 0.62, -9, { voice: 0.25 });
  B(5.92, 0.5, -13, { inhale: false });
  B(6.46, 0.5, -13); B(7.0, 0.56, -16, { inhale: false });
  B(7.62, 0.6, -17); B(8.28, 0.72, -20, { inhale: false });
  // settling while wading
  B(9.1, 0.85, -23); B(10.05, 1.0, -25, { inhale: false });
  B(11.2, 0.9, -25); B(12.2, 1.1, -27, { inhale: false });
  // the lights: shallow, uneven
  B(13.25, 0.5, -20); B(13.85, 0.7, -24, { inhale: false });
  B(14.75, 0.45, -21); B(15.3, 0.6, -25, { inhale: false });
  // holding it... one shaky draw
  B(16.2, 0.75, -24, { bright: 0.9 });
  // it is there
  B(17.25, 0.3, -7, { voice: 0.4, bright: 1.15 });
  let t = 17.62;
  for (let k = 0; t < CUT_TO_BLACK - 0.12; k++) {
    const d = 0.2 - 0.004 * k;
    B(t, d, -9 + (k % 2 ? -3 : 0), { inhale: k % 2 === 1, voice: k % 2 ? 0.2 : 0.45, bright: 1.1 });
    t += d + 0.03;
  }
}

// ====================================================================
// 5.2 - 19.0   THE POOL ROOMS
// ====================================================================
const POOL_IN = 5.2;
const openUp = (t) => smoothstep(POOL_IN - 0.05, POOL_IN + 0.25, t);
const cut = (t) => (t < CUT_TO_BLACK ? 1 : 0);
{
  // ventilation and air of a very large tiled room; the plant dies at ~15 s
  const plant = (t) => 1 - smoothstep(15.0, 15.55, t);
  const vent = gen(DURATION, (t) => {
    if (t < POOL_IN - 0.1 || t > 16.2) return 0;
    const sag = smoothstep(15.0, 15.6, t);
    const ph = TAU * (t - 0.42 * sag * (t - 15.0));
    return (Math.sin(49.7 * ph) * 0.5 + Math.sin(50.4 * ph) * 0.5 + Math.sin(100.3 * ph) * 0.3 + Math.sin(149 * ph) * 0.1) * openUp(t) * plant(t);
  });
  put(vent, 0, { gain: dB(-27), hall: 0.3 });
  const room = mul(lp(white(N), 1700, 0.5), (t) => openUp(t) * (0.35 + 0.65 * plant(t)) * cut(t));
  put(room, 0, { gain: dB(-32), pan: -0.4, hall: 0.2 });
  put(mul(lp(white(N), 2300, 0.5), (t) => openUp(t) * (0.35 + 0.65 * plant(t)) * cut(t)), 0, { gain: dB(-33), pan: 0.4, hall: 0.2 });

  // water against tile, all around
  for (let t0 = POOL_IN + 0.2; t0 < CUT_TO_BLACK - 0.3; t0 += rr(0.35, 1.05)) {
    const d = rr(0.3, 0.9);
    const quiet = 1 - 0.5 * smoothstep(15.2, 16.5, t0) * (1 - smoothstep(17.3, 17.6, t0));
    const lap = mul(bp(white(len(d)), rr(420, 1900), rr(0.8, 2)), (t, x) => hann(x) * (0.6 + 0.4 * Math.sin(TAU * rr(9, 22) * t)));
    put(lap, t0, { gain: dB(rr(-31, -23)) * quiet, pan: rr(-0.9, 0.9), hall: 0.8 });
  }
  // drips somewhere far off, each one ringing down the halls
  const drip = (f) => gen(0.14, (t) => Math.sin(TAU * f * (t + 5 * t * t)) * ad(t, 0.001, 0.022) + Math.sin(TAU * f * 0.52 * t) * ad(t, 0.004, 0.03) * 0.3);
  for (const [t0, g, p] of [[6.3, -24, -0.7], [7.9, -27, 0.6], [9.4, -25, 0.3], [10.9, -28, -0.5], [12.1, -24, 0.8], [13.5, -27, -0.3], [14.6, -25, 0.5], [16.4, -14, -0.45]]) {
    put(drip(rr(1100, 2500)), t0, { gain: dB(g), pan: p, hall: 1.6, dryGain: 0.5 });
  }

  // the body in the water: treading, then wading (same instants as the ring waves)
  const slosh = (d, bright = 1) => {
    const a = mul(bp(white(len(d)), (t, x) => (520 + 900 * x) * bright, 0.9), (t, x) => Math.pow(Math.sin(Math.PI * Math.pow(x, 0.6)), 1.4));
    const b = mul(bp(white(len(d)), (t, x) => (1900 + 1400 * x) * bright, 1.3), (t, x) => smoothstep(0.25, 0.5, x) * (1 - x) * (0.6 + 0.4 * Math.sin(TAU * 43 * t)));
    const c = gen(d, (t) => Math.sin(TAU * (130 - 160 * t) * t) * ad(t, 0.01, 0.05));
    return add(a, scale(b, 0.6), scale(c, 0.8));
  };
  for (let t0 = 5.8, k = 0; t0 < 9.0; t0 += 0.62, k++) put(slosh(0.42, 0.8), t0 - 0.1, { gain: dB(-22), pan: k % 2 ? 0.3 : -0.3, hall: 0.35 });
  for (let t0 = 9.25, k = 0; t0 < 13.9; t0 += 0.43, k++) {
    const fade = 1 - 0.5 * smoothstep(13.0, 13.9, t0);
    put(slosh(0.4), t0 - 0.08, { gain: dB(-15) * fade, pan: k % 2 ? 0.28 : -0.28, hall: 0.35 });
  }
  for (const t0 of [14.4, 15.3]) put(slosh(0.5, 0.7), t0, { gain: dB(-31), pan: 0.1, hall: 0.4 });
  for (const [t0, g] of [[17.6, -12], [17.85, -11], [18.2, -8], [18.45, -8], [18.7, -7], [18.9, -7]]) put(slosh(0.3, 1.25), t0 - 0.06, { gain: dB(g), pan: rr(-0.4, 0.4), hall: 0.4 });
}

// the lights: tube hum, relay clicks and arcing while they flicker
{
  const hum = gen(DURATION, (t) => {
    if (t < 11.5 || t >= CUT_TO_BLACK) return 0;
    const lvl = poolLightGroup(t, 2);
    const near = smoothstep(11.5, 13.2, t);
    return (Math.sin(TAU * 100 * t) * 0.5 + Math.sin(TAU * 200 * t + 0.7) * 0.3 + Math.sin(TAU * 300 * t) * 0.18 + Math.sin(TAU * 400 * t + 2) * 0.1) * lvl * near;
  });
  put(hum, 0, { gain: dB(-31), hall: 0.5 });
  const arc = mul(bp(white(N), 3100, 2.2), (t) => {
    if (t < 13 || t >= CUT_TO_BLACK) return 0;
    const inEvent = POOL_FLICKER_EVENTS.some(([a, b, , f]) => f && t >= a && t < b);
    const lvl = poolLightGroup(t, 2);
    return inEvent ? (0.5 + 0.5 * Math.sin(TAU * 100 * t)) ** 4 * (lvl > 0.5 ? 1 : 0.25) : 0;
  });
  put(arc, 0, { gain: dB(-22), pan: 0.2, hall: 0.9 });
  let prev = 1;
  for (let q = 13 * 60; q < CUT_TO_BLACK * 60; q++) {
    const t = (q + 0.5) / 60;
    const now = poolLight(t);
    if (Math.abs(now - prev) > 0.18) {
      const big = Math.abs(now - prev) > 0.5;
      const tick = add(
        mul(bp(white(len(0.05)), rr(1800, 4200), 5), (tt) => ad(tt, 0.0005, 0.007)),
        scale(gen(0.08, (tt) => Math.sin(TAU * 140 * tt) * ad(tt, 0.001, 0.02)), big ? 0.9 : 0.3),
      );
      put(tick, q / 60, { gain: dB(big ? -11 : -17), pan: rr(-0.6, 0.6), hall: 1.2 });
    }
    prev = now;
  }
  // the plant shutting down at 15 s
  const down = gen(1.1, (t) => {
    const f = 310 * Math.exp(-t * 2.6) + 30;
    return (Math.sin(TAU * f * t) + 0.4 * Math.sin(TAU * f * 2.02 * t)) * ad(t, 0.02, 0.4);
  });
  put(down, 15.0, { gain: dB(-22), pan: -0.3, hall: 1.0 });
}

// ====================================================================
// 12.5 - 19.0   WHAT THE ROOM DOES TO YOU
// ====================================================================
{
  // drone: two low notes a semitone apart, beating, swelling into the silence
  // it swells with the lights failing, pulls right back for the held breath, then slams in with the figure
  const swell = (t) => smoothstep(12.2, 15.2, t) * 0.7 * (1 - 0.72 * smoothstep(15.6, 16.3, t)) + smoothstep(17.2, 17.26, t) * 0.8;
  const drone = gen(DURATION, (t) => {
    if (t < 12 || t >= CUT_TO_BLACK) return 0;
    const a = Math.sin(TAU * 41.2 * t) + 0.7 * Math.sin(TAU * 43.65 * t + 1) + 0.35 * Math.sin(TAU * 82.9 * t) + 0.2 * Math.sin(TAU * 123.1 * t + 0.5);
    return a * swell(t) * (0.8 + 0.2 * Math.sin(TAU * 0.31 * t));
  });
  put(drone, 0, { gain: dB(-21), hall: 0.4 });
  // thin dissonant air above it
  const w1 = wander(DURATION, 0.7, 1), w2 = wander(DURATION, 0.9, 2), w3 = wander(DURATION, 0.5, 3);
  const pad = gen(DURATION, (t) => {
    if (t < 12.5 || t >= CUT_TO_BLACK) return 0;
    return (Math.sin(TAU * 493.9 * t) * w1(t) + Math.sin(TAU * 523.3 * t) * w2(t) + Math.sin(TAU * 739.9 * t + Math.sin(TAU * 4.1 * t) * 0.5) * w3(t) * 0.7 + Math.sin(TAU * 1046.9 * t) * w1(t) * w2(t) * 0.5) * smoothstep(12.5, 16.8, t) * (1 - 0.6 * smoothstep(15.6, 16.3, t) * (1 - smoothstep(17.2, 17.3, t)));
  });
  put(pad, 0, { gain: dB(-28), pan: -0.3, hall: 2.2, dryGain: 0.4 });

  // the shadow: a pressure wave that crosses from left to right, and a slow moan inside it
  const T = 2.35;
  const sub = gen(T, (t) => (Math.sin(TAU * 31 * t) + 0.6 * Math.sin(TAU * 37.5 * t)) * hann(t / T) ** 1.2);
  const moan = lp(gen(T, (t) => {
    const x = t / T;
    const f = 118 - 34 * x + 3 * Math.sin(TAU * 4.6 * t);
    return (Math.sin(TAU * f * t) + 0.6 * Math.sin(TAU * f * 2.0 * t + 1) + 0.4 * Math.sin(TAU * f * 3.01 * t) + 0.25 * Math.sin(TAU * f * 4.02 * t)) * hann(x) ** 1.6;
  }), 620);
  const wash = mul(lp(white(len(T)), (t, x) => 160 + 240 * Math.sin(Math.PI * x), 1.5), (t, x) => hann(x) ** 1.3);
  const steps = 24;
  for (let k = 0; k < steps; k++) {
    // panned in slices so the mass travels across the stereo field
    const a = Math.floor((k / steps) * sub.length), b = Math.floor(((k + 1) / steps) * sub.length);
    const pan = -0.85 + 1.7 * (k / (steps - 1));
    put(sub.subarray(a, b), 14.05 + a / SR, { gain: dB(-18) });
    put(moan.subarray(a, b), 14.05 + a / SR, { gain: dB(-18), pan, hall: 1.0, dryGain: 0.6 });
    put(wash.subarray(a, b), 14.05 + a / SR, { gain: dB(-17), pan });
  }

  // heart: starts in the silence, runs away
  const thump = (g) => gen(0.34, (t) => ((Math.sin(TAU * (60 - 50 * t) * t) + 0.5 * Math.sin(TAU * (120 - 100 * t) * t) + 0.25 * Math.sin(TAU * (180 - 150 * t) * t)) * ad(t, 0.005, 0.04) + (t > 0.14 ? (Math.sin(TAU * (50 - 40 * (t - 0.14)) * (t - 0.14)) + 0.5 * Math.sin(TAU * (100 - 80 * (t - 0.14)) * (t - 0.14))) * ad(t - 0.14, 0.005, 0.055) * 0.75 : 0)) * g);
  let t = 15.75, period = 0.86;
  while (t < CUT_TO_BLACK - 0.1) {
    const g = 0.35 + 0.65 * smoothstep(15.7, 17.3, t);
    put(thump(g), t, { gain: dB(-11) });
    period = t < 16.9 ? Math.max(0.6, period - 0.05) : Math.max(0.34, period * 0.88);
    t += period;
  }

  // 17.22 — it is standing there
  {
    // a breath of reversed air into the hit
    const pre = mul(bp(white(len(0.3)), (tt, x) => 800 + 5000 * x * x, 1.2), (tt, x) => Math.pow(x, 3));
    put(pre, 16.93, { gain: dB(-13), hall: 0.3 });
    const D = 1.7;
    const sting = gen(D, (tt) => {
      const e = ad(tt, 0.004, 0.55) * (0.75 + 0.25 * Math.sin(TAU * 11.3 * tt));
      let s = 0;
      for (const [f, a] of [[1108.7, 1], [1174.7, 0.9], [1244.5, 0.8], [1661.2, 0.5], [2217.5, 0.35], [3061, 0.22], [587.3, 0.5]]) {
        s += a * (Math.sin(TAU * f * tt + 2.5 * Math.sin(TAU * f * 0.503 * tt) * Math.exp(-tt * 3)));
      }
      return s * e * 0.2;
    });
    put(sting, 17.22, { gain: dB(-6), pan: -0.1, hall: 1.3 });
    const hit = mul(lp(white(len(0.6)), (tt) => 5000 * Math.exp(-tt * 9) + 200, 0.8), (tt) => ad(tt, 0.002, 0.11));
    put(hit, 17.22, { gain: dB(-5), hall: 0.9 });
    const drop = gen(1.2, (tt) => Math.sin(TAU * (30 * tt + 55 * (1 - Math.exp(-tt * 4)) / 4)) * ad(tt, 0.006, 0.45));
    put(drop, 17.22, { gain: dB(-6) });
  }

  // 18.14 — and now it is right there, coming out of the water
  {
    const erupt = mul(lp(hp(white(len(0.8)), 220), (tt) => 8000 * Math.exp(-tt * 5) + 900, 0.7), (tt) => ad(tt, 0.003, 0.2));
    put(erupt, 18.14, { gain: dB(-2), pan: 0.1, hall: 0.6 });
    const drop = gen(0.9, (tt) => Math.sin(TAU * (28 * tt + 70 * (1 - Math.exp(-tt * 5)) / 5)) * ad(tt, 0.004, 0.33));
    put(drop, 18.14, { gain: dB(-5) });
    // thrashing water for as long as the picture holds
    const D = CUT_TO_BLACK - 18.14;
    const w1 = wander(D, 17, 5), w2 = wander(D, 23, 6);
    put(mul(bp(white(len(D)), (tt) => 700 + 1300 * w1(tt), 0.8), (tt, x) => (0.35 + 0.65 * w2(tt) ** 2) * (0.6 + 0.4 * x)), 18.14, { gain: dB(-8), pan: -0.35, hall: 0.5 });
    put(mul(bp(white(len(D)), (tt) => 1800 + 2600 * w2(tt), 1.0), (tt, x) => (0.3 + 0.7 * w1(tt) ** 2) * (0.6 + 0.4 * x)), 18.14, { gain: dB(-11), pan: 0.4, hall: 0.5 });
    // something like a voice, far too low
    const growl = lp(gen(D, (tt) => {
      const x = tt / D;
      const f = 46 + 16 * x + 2 * Math.sin(TAU * 6 * tt);
      let s = 0;
      for (let h = 1; h <= 9; h++) s += Math.sin(TAU * f * h * tt + h) / h;
      return s * (0.55 + 0.45 * Math.sin(TAU * 23 * tt)) * smoothstep(0, 0.15, x) * (0.5 + 0.5 * x);
    }), (tt, x) => 300 + 500 * x, 2.5);
    put(growl, 18.14, { gain: dB(-9), hall: 0.7 });
    // everything rises into the cut
    const riser = gen(D, (tt) => {
      const x = tt / D;
      const f = 180 * Math.pow(2, 3.1 * x);
      return (Math.sin(TAU * f * tt) + 0.6 * Math.sin(TAU * f * 1.42 * tt) + 0.4 * Math.sin(TAU * f * 2.37 * tt)) * Math.pow(x, 1.6);
    });
    put(riser, 18.14, { gain: dB(-13), hall: 0.6 });
    put(mul(hp(white(len(D)), (tt, x) => 1200 + 5000 * x), (tt, x) => Math.pow(x, 2.2)), 18.14, { gain: dB(-12), pan: 0.2 });
  }

  // the camera being thrown about
  const handling = mul(lp(white(N), 150, 0.9), (t) => (t < CUT_TO_BLACK ? clamp((shakeAt(t) - 1.2) / 3.2, 0, 1) ** 1.5 * (0.5 + 0.5 * hash1(Math.floor(t * 19) * 1.3)) : 0));
  put(handling, 0, { gain: dB(-9) });
}

// ====================================================================
// reverbs (FFT convolution with synthetic impulse responses)
// ====================================================================
function fft(re, im, inverse) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const ang = ((inverse ? 1 : -1) * TAU) / size;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    const half = size >> 1;
    for (let i = 0; i < n; i += size) {
      let cr = 1, ci = 0;
      for (let k = 0; k < half; k++) {
        const a = i + k, b = a + half;
        const xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr; im[b] = im[a] - xi;
        re[a] += xr; im[a] += xi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
}

function makeIR(sec, { bands, predelay = 0.02, early = 10, earlySpan = 0.09, seed = 1 }) {
  const r = mulberry32(seed);
  const n = len(sec);
  const ir = new Float32Array(n);
  const pd = Math.round(predelay * SR);
  // dense tail: band-limited noise, each band with its own decay time
  for (const [f0, f1, rt60, g] of bands) {
    const w = new Float32Array(n);
    for (let i = 0; i < n; i++) w[i] = r() * 2 - 1;
    let b = f0 > 20 ? hp(w, f0, 0.6) : w;
    b = f1 < SR / 2.2 ? lp(b, f1, 0.6) : b;
    const k = 6.908 / (rt60 * SR);
    for (let i = pd; i < n; i++) ir[i] += b[i] * Math.exp(-k * (i - pd)) * g * smoothstep(0, 0.03 * SR, i - pd);
  }
  // a few discrete early reflections
  for (let e = 0; e < early; e++) {
    const i = pd + Math.round((0.004 + r() * earlySpan) * SR);
    ir[i] += (r() > 0.5 ? 1 : -1) * (0.9 - 0.6 * r()) * 3;
  }
  let en = 0;
  for (let i = 0; i < n; i++) en += ir[i] * ir[i];
  const norm = 1 / Math.sqrt(en);
  for (let i = 0; i < n; i++) ir[i] *= norm;
  return ir;
}

function convolve(input, ir) {
  let size = 1;
  while (size < input.length + ir.length) size <<= 1;
  const ar = new Float64Array(size), ai = new Float64Array(size), br = new Float64Array(size), bi = new Float64Array(size);
  ar.set(input); br.set(ir);
  fft(ar, ai, false); fft(br, bi, false);
  for (let i = 0; i < size; i++) {
    const r = ar[i] * br[i] - ai[i] * bi[i];
    ai[i] = ar[i] * bi[i] + ai[i] * br[i];
    ar[i] = r;
  }
  fft(ar, ai, true);
  return ar;
}

console.log('convolving reverbs ...');
const hallBands = [[0, 400, 4.6, 1.0], [400, 2500, 3.6, 0.8], [2500, 24000, 1.7, 0.55]];
const corrBands = [[0, 500, 0.55, 1.0], [500, 3000, 0.4, 0.7], [3000, 24000, 0.22, 0.3]];
const wet = mk();
for (const ch of [0, 1]) {
  // nothing may ring past the cut: the send is silenced there and the tail is truncated below
  const hall = convolve(sendHall[ch], makeIR(5.0, { bands: hallBands, predelay: 0.032, early: 14, earlySpan: 0.14, seed: 11 + ch }));
  const corr = convolve(sendCorr[ch], makeIR(0.9, { bands: corrBands, predelay: 0.006, early: 8, earlySpan: 0.03, seed: 31 + ch }));
  for (let i = 0; i < N; i++) wet[ch][i] = hall[i] * 0.5 + corr[i] * 0.55;
}

// ====================================================================
// master: sum, hard cut at 19.0, gentle saturation, normalise
// ====================================================================
const out = mk();
let peak = 0;
const cutSample = Math.round(CUT_TO_BLACK * SR);
for (const ch of [0, 1]) {
  // a touch of crossfeed keeps the low end in the centre
  const o = out[ch];
  for (let i = 0; i < N; i++) {
    let s = dry[ch][i] + wet[ch][i];
    const fadeIn = Math.min(1, i / (0.08 * SR));
    s *= fadeIn;
    if (i >= cutSample) s = 0;                 // the recording simply stops
    o[i] = Math.tanh(s * 1.5) / 1.5;
    peak = Math.max(peak, Math.abs(o[i]));
  }
}
const g = dB(-1.5) / peak;
const pcm = Buffer.alloc(44 + N * 4);
pcm.write('RIFF', 0); pcm.writeUInt32LE(36 + N * 4, 4); pcm.write('WAVE', 8); pcm.write('fmt ', 12);
pcm.writeUInt32LE(16, 16); pcm.writeUInt16LE(1, 20); pcm.writeUInt16LE(2, 22); pcm.writeUInt32LE(SR, 24);
pcm.writeUInt32LE(SR * 4, 28); pcm.writeUInt16LE(4, 32); pcm.writeUInt16LE(16, 34); pcm.write('data', 36); pcm.writeUInt32LE(N * 4, 40);
const dither = mulberry32(99);
for (let i = 0; i < N; i++) {
  for (const ch of [0, 1]) {
    const d = i < cutSample ? (dither() - dither()) / 65536 : 0;
    pcm.writeInt16LE(Math.round(clamp(out[ch][i] * g + d, -1, 1) * 32767), 44 + i * 4 + ch * 2);
  }
}
fs.mkdirSync(BUILD, { recursive: true });
const file = path.join(BUILD, 'audio.wav');
fs.writeFileSync(file, pcm);
console.log(`${file}  peak ${(20 * Math.log10(peak)).toFixed(1)} dBFS before normalisation`);
