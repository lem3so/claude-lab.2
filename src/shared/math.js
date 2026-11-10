// Deterministic helpers. Everything in the film is a pure function of time,
// so any frame can be rendered in isolation (and in parallel).

export const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hash1(n) {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
  return s - Math.floor(s);
}

// 1D value noise in [-1, 1], C1 continuous.
export function noise1(x, seed = 0) {
  const xs = x + seed * 57.31;
  const i = Math.floor(xs);
  const f = xs - i;
  const u = f * f * (3 - 2 * f);
  return (hash1(i) * (1 - u) + hash1(i + 1) * u) * 2 - 1;
}

export function fbm1(x, seed = 0, octaves = 3) {
  let a = 0.5, s = 0, n = 0;
  for (let o = 0; o < octaves; o++) {
    s += a * noise1(x * (1 << o), seed + o * 13.7);
    n += a;
    a *= 0.5;
  }
  return s / n;
}
