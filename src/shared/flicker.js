// Light flicker curves. Shared by the renderer (light intensities) and the
// audio synthesiser (electrical buzz / relay clicks), so picture and sound
// stay locked together.
import { hash1, smoothstep } from './math.js';

// [start, end, level, flutter]
export const POOL_FLICKER_EVENTS = [
  [13.05, 13.11, 0.30, 0],
  [13.27, 13.31, 0.18, 0],
  [13.42, 13.68, 0.45, 1],
  [14.10, 14.19, 0.10, 0],
  [14.62, 14.98, 0.40, 1],
  [15.34, 15.39, 0.15, 0],
  [15.95, 16.30, 0.35, 1],
  [16.58, 16.64, 0.08, 0],
  [16.93, 17.22, 0.012, 0],  // blackout — something is standing there when the light returns
  [18.02, 18.14, 0.012, 0],  // second blackout — it is closer
  [18.14, 19.00, 0.30, 1],   // strobing panic
];

// Global light level of the pool complex, 1 = normal.
export function poolLight(t) {
  if (t < 13.0) return 1;
  // half of the tubes die around 15 s: the hall settles into a dimmer state
  let base = 1 - 0.45 * smoothstep(15.0, 15.5, t);
  let lvl = base;
  for (const [a, b, l, f] of POOL_FLICKER_EVENTS) {
    if (t >= a && t < b) {
      if (f) {
        const q = Math.floor(t * 30);
        const r = hash1(q * 1.731 + a * 3.1);
        lvl = base * (r > 0.5 ? 1.05 : l);
      } else {
        lvl = base * l;
      }
    }
  }
  return lvl;
}

// Per-group variation so the panels do not all blink in perfect unison.
export function poolLightGroup(t, g) {
  const base = poolLight(t);
  if (t < 13.0 || g === 0) return base;
  const q = Math.floor(t * 30);
  const r = hash1(q * 0.917 + g * 41.3);
  const inEvent = POOL_FLICKER_EVENTS.some(([a, b]) => t >= a && t < b);
  if (inEvent) return base * (r > 0.35 ? 1 : 0.4);
  // sporadic single-frame dips outside of the scripted events
  return base * (r > 0.965 ? 0.5 : 1);
}

// Fluorescent tubes of the corridor: stable, then failing as reality tears.
export function corridorLight(t, g = 0) {
  if (t < 2.12) {
    // one tired tube stutters a little from the start
    if (g === 1) {
      const q = Math.floor(t * 30);
      return hash1(q * 2.31 + 9.0) > 0.93 ? 0.55 : 1;
    }
    return 1;
  }
  const q = Math.floor(t * 30);
  const r = hash1(q * 3.17 + g * 7.7 + 5.0);
  const k = smoothstep(2.12, 2.9, t);
  return r > 0.35 + 0.35 * k ? 1 : 0.12;
}
