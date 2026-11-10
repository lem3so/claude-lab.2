// Procedural textures. Nothing is loaded from disk: every map is synthesised
// at start-up from seeded noise so the render is fully reproducible.
import * as THREE from 'three';
import { mulberry32, clamp, smoothstep } from '../shared/math.js';

const lin2srgb = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
const to8 = (c) => Math.round(clamp(c) * 255);

// Tileable value noise sampled on a size x size grid.
function valueNoise(size, cells, seed) {
  const rnd = mulberry32(seed);
  const g = new Float32Array(cells * cells);
  for (let i = 0; i < g.length; i++) g[i] = rnd();
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    const fy = (y / size) * cells;
    const iy = Math.floor(fy);
    let ty = fy - iy;
    ty = ty * ty * (3 - 2 * ty);
    const y0 = (iy % cells) * cells;
    const y1 = ((iy + 1) % cells) * cells;
    for (let x = 0; x < size; x++) {
      const fx = (x / size) * cells;
      const ix = Math.floor(fx);
      let tx = fx - ix;
      tx = tx * tx * (3 - 2 * tx);
      const x0 = ix % cells;
      const x1 = (ix + 1) % cells;
      const a = g[y0 + x0] * (1 - tx) + g[y0 + x1] * tx;
      const b = g[y1 + x0] * (1 - tx) + g[y1 + x1] * tx;
      out[y * size + x] = a * (1 - ty) + b * ty;
    }
  }
  return out;
}

function fbm(size, baseCells, octaves, seed) {
  const out = new Float32Array(size * size);
  let amp = 0.5;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    const cells = Math.min(size, baseCells << o);
    const n = valueNoise(size, cells, seed + o * 101);
    for (let i = 0; i < out.length; i++) out[i] += n[i] * amp;
    norm += amp;
    amp *= 0.5;
  }
  for (let i = 0; i < out.length; i++) out[i] /= norm;
  return out;
}

// height: Float32Array in "texture widths"; returns RGBA8 tangent-space normal map.
function heightToNormal(height, size, extraX, extraY) {
  const data = new Uint8Array(size * size * 4);
  const half = size / 2;
  for (let y = 0; y < size; y++) {
    const ym = ((y - 1 + size) % size) * size;
    const yp = ((y + 1) % size) * size;
    for (let x = 0; x < size; x++) {
      const xm = (x - 1 + size) % size;
      const xp = (x + 1) % size;
      const i = y * size + x;
      let nx = -(height[y * size + xp] - height[y * size + xm]) * half;
      let ny = -(height[yp + x] - height[ym + x]) * half;
      if (extraX) { nx += extraX[i]; ny += extraY[i]; }
      const inv = 1 / Math.hypot(nx, ny, 1);
      data[i * 4] = to8(nx * inv * 0.5 + 0.5);
      data[i * 4 + 1] = to8(ny * inv * 0.5 + 0.5);
      data[i * 4 + 2] = to8(inv * 0.5 + 0.5);
      data[i * 4 + 3] = 255;
    }
  }
  return data;
}

function dataTex(data, size, { srgb = false, aniso = 1 } = {}) {
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = aniso;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

// ---------------------------------------------------------------------------
// Glazed white ceramic pool tiles: 8 x 8 tiles per repeat, rounded bevels,
// recessed grout, every tile very slightly tilted and tinted.
// ---------------------------------------------------------------------------
export function makeTileTextures({ size = 1024, tiles = 8, seed = 7, aniso = 8 } = {}) {
  const px = size / tiles;
  const H = new Float32Array(size * size);
  const tiltX = new Float32Array(size * size);
  const tiltY = new Float32Array(size * size);
  const alb = new Uint8Array(size * size * 4);
  const orm = new Uint8Array(size * size * 4);
  const rnd = mulberry32(seed);
  const tr = [];
  for (let i = 0; i < tiles * tiles; i++) {
    tr.push({ b: rnd(), hue: rnd(), tx: rnd() - 0.5, ty: rnd() - 0.5, r: rnd() });
  }
  const nA = fbm(size, 6, 4, seed + 1);    // broad mottling
  const nB = fbm(size, 96, 2, seed + 2);   // fine grain
  const g = 0.019;     // half grout width, in tile widths
  const bev = 0.05;    // bevel width
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const u = (x + 0.5) / px;
      const v = (y + 0.5) / px;
      const ti = Math.floor(u);
      const tj = Math.floor(v);
      const fu = u - ti;
      const fv = v - tj;
      // rounded-corner distance to the tile edge
      const ex = Math.min(fu, 1 - fu);
      const ey = Math.min(fv, 1 - fv);
      const k = g + bev;
      const dx = Math.max(0, k - ex);
      const dy = Math.max(0, k - ey);
      const e = k - Math.hypot(dx, dy);
      const s = smoothstep(g, k, e);
      const t = tr[tj * tiles + ti];
      const pillow = 1 - Math.pow(Math.max(Math.abs(2 * fu - 1), Math.abs(2 * fv - 1)), 2.5);
      // height in tile widths, converted to texture widths at the end
      const h = 0.011 * s + 0.0016 * pillow * s + (nB[i] - 0.5) * 0.0011 * (1 - s) + (nA[i] - 0.5) * 0.0005 * s;
      H[i] = h / tiles;
      tiltX[i] = t.tx * 0.03 * s;
      tiltY[i] = t.ty * 0.03 * s;

      // albedo (linear)
      const bright = 0.985 + 0.02 * t.b;
      let r = 0.800 * bright + (t.hue - 0.5) * 0.018;
      let gch = 0.826 * bright;
      let b = 0.818 * bright - (t.hue - 0.5) * 0.02;
      const mott = 0.975 + 0.05 * nA[i];
      r *= mott; gch *= mott; b *= mott;
      const gn = 0.82 + 0.36 * nB[i];
      const gr = 0.56 * gn, gg = 0.585 * gn, gb = 0.57 * gn;
      const edge = 0.9 + 0.1 * smoothstep(g, g + 0.14, e);
      r = (gr + (r - gr) * s) * edge;
      gch = (gg + (gch - gg) * s) * edge;
      b = (gb + (b - gb) * s) * edge;
      alb[i * 4] = to8(lin2srgb(r));
      alb[i * 4 + 1] = to8(lin2srgb(gch));
      alb[i * 4 + 2] = to8(lin2srgb(b));
      alb[i * 4 + 3] = 255;

      // roughness in G (glTF ORM convention), cavity AO in R
      const rough = 0.9 + (0.13 + 0.09 * nA[i] + 0.05 * t.r - 0.9) * s;
      orm[i * 4] = to8(0.72 + 0.28 * s);
      orm[i * 4 + 1] = to8(rough);
      orm[i * 4 + 2] = 0;
      orm[i * 4 + 3] = 255;
    }
  }
  return {
    albedo: dataTex(alb, size, { srgb: true, aniso }),
    normal: dataTex(heightToNormal(H, size, tiltX, tiltY), size, { aniso }),
    orm: dataTex(orm, size, { aniso }),
  };
}

// ---------------------------------------------------------------------------
// Tileable wave field used for (a) fine water ripples and (b) the caustics.
// ---------------------------------------------------------------------------
function waveField(size, seed, { kMin = 2, kMax = 9, falloff = 1.4, count = 40 } = {}) {
  const rnd = mulberry32(seed);
  const waves = [];
  for (let n = 0; n < count; n++) {
    let kx = 0, ky = 0, km = 0;
    do {
      kx = Math.round((rnd() * 2 - 1) * kMax);
      ky = Math.round((rnd() * 2 - 1) * kMax);
      km = Math.hypot(kx, ky);
    } while (km < kMin || km > kMax);
    waves.push({ kx, ky, a: Math.pow(km, -falloff), p: rnd() * Math.PI * 2 });
  }
  // slope field (dh/du, dh/dv) with u, v in [0,1)
  const sx = new Float32Array(size * size);
  const sy = new Float32Array(size * size);
  const TAU = Math.PI * 2;
  for (const w of waves) {
    const cu = new Float32Array(size), su = new Float32Array(size);
    const cv = new Float32Array(size), sv = new Float32Array(size);
    for (let i = 0; i < size; i++) {
      cu[i] = Math.cos((TAU * w.kx * i) / size); su[i] = Math.sin((TAU * w.kx * i) / size);
      cv[i] = Math.cos((TAU * w.ky * i) / size + w.p); sv[i] = Math.sin((TAU * w.ky * i) / size + w.p);
    }
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        // h = a sin(kx u + ky v + p)  ->  dh = a cos(...) * k
        const c = cu[x] * cv[y] - su[x] * sv[y];
        sx[y * size + x] += w.a * c * w.kx;
        sy[y * size + x] += w.a * c * w.ky;
      }
    }
  }
  return { sx, sy };
}

export function makeWaterDetailNormal({ size = 256, seed = 31 } = {}) {
  const { sx, sy } = waveField(size, seed, { kMin: 3, kMax: 14, falloff: 1.3, count: 48 });
  let rms = 0;
  for (let i = 0; i < sx.length; i++) rms += sx[i] * sx[i] + sy[i] * sy[i];
  rms = Math.sqrt(rms / sx.length);
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < sx.length; i++) {
    // store normalised slopes, +-3 sigma mapped to +-1
    data[i * 4] = to8((sx[i] / (rms * 3)) * 0.5 + 0.5);
    data[i * 4 + 1] = to8((sy[i] / (rms * 3)) * 0.5 + 0.5);
    data[i * 4 + 2] = 255;
    data[i * 4 + 3] = 255;
  }
  return dataTex(data, size);
}

// Real caustics: photons are refracted through the wave field and splatted on
// the pool floor. The result tiles, and two scrolling copies animate it.
export function makeCausticTexture({ size = 512, seed = 53 } = {}) {
  const { sx, sy } = waveField(size, seed, { kMin: 2, kMax: 7, falloff: 1.15, count: 36 });
  // normalise the focal strength from the mean curvature of the field
  let lap = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const dxx = (sx[y * size + ((x + 1) % size)] - sx[i]) * size;
      const dyy = (sy[((y + 1) % size) * size + x] - sy[i]) * size;
      lap += (dxx + dyy) * (dxx + dyy);
    }
  }
  lap = Math.sqrt(lap / (size * size));
  const F = 1.05 / lap;
  const acc = new Float32Array(size * size);
  const SS = 3; // photons per texel side
  const bil = (arr, fx, fy) => {
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const tx = fx - x0, ty = fy - y0;
    const xa = ((x0 % size) + size) % size, xb = (xa + 1) % size;
    const ya = ((y0 % size) + size) % size, yb = (ya + 1) % size;
    return (arr[ya * size + xa] * (1 - tx) + arr[ya * size + xb] * tx) * (1 - ty)
         + (arr[yb * size + xa] * (1 - tx) + arr[yb * size + xb] * tx) * ty;
  };
  for (let y = 0; y < size * SS; y++) {
    for (let x = 0; x < size * SS; x++) {
      const fx = x / SS, fy = y / SS;
      const px = fx - F * bil(sx, fx, fy) * size;
      const py = fy - F * bil(sy, fx, fy) * size;
      const x0 = Math.floor(px), y0 = Math.floor(py);
      const tx = px - x0, ty = py - y0;
      const xa = ((x0 % size) + size) % size, xb = (xa + 1) % size;
      const ya = ((y0 % size) + size) % size, yb = (ya + 1) % size;
      acc[ya * size + xa] += (1 - tx) * (1 - ty);
      acc[ya * size + xb] += tx * (1 - ty);
      acc[yb * size + xa] += (1 - tx) * ty;
      acc[yb * size + xb] += tx * ty;
    }
  }
  const data = new Uint8Array(size * size * 4);
  const norm = 1 / (SS * SS);
  for (let i = 0; i < acc.length; i++) {
    const v = acc[i] * norm;          // mean 1
    data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = to8(v / 4);
    data[i * 4 + 3] = 255;
  }
  return dataTex(data, size);
}

// ---------------------------------------------------------------------------
// The "ordinary" corridor: carpet, painted walls, acoustic ceiling, doors.
// ---------------------------------------------------------------------------
function simpleSet(size, fn, aniso) {
  const H = new Float32Array(size * size);
  const alb = new Uint8Array(size * size * 4);
  const orm = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const o = fn(x, y, i);
      H[i] = o.h;
      alb[i * 4] = to8(lin2srgb(o.c[0]));
      alb[i * 4 + 1] = to8(lin2srgb(o.c[1]));
      alb[i * 4 + 2] = to8(lin2srgb(o.c[2]));
      alb[i * 4 + 3] = 255;
      orm[i * 4] = 255;
      orm[i * 4 + 1] = to8(o.rough);
      orm[i * 4 + 2] = 0;
      orm[i * 4 + 3] = 255;
    }
  }
  return {
    albedo: dataTex(alb, size, { srgb: true, aniso }),
    normal: dataTex(heightToNormal(H, size), size, { aniso }),
    orm: dataTex(orm, size, { aniso }),
  };
}

export function makeCorridorTextures({ aniso = 8 } = {}) {
  const S = 512;
  // carpet tiles: 2 x 2 squares per repeat (repeat = 1 m), alternating pile direction
  const cF = fbm(S, 128, 2, 201);
  const cM = fbm(S, 5, 3, 202);
  const carpet = simpleSet(S, (x, y, i) => {
    const tx = Math.floor((x / S) * 2), ty = Math.floor((y / S) * 2);
    const alt = (tx + ty) % 2;
    const fx = ((x / S) * 2) % 1, fy = ((y / S) * 2) % 1;
    const seam = Math.min(fx, 1 - fx, fy, 1 - fy);
    const seamK = smoothstep(0.0, 0.012, seam);
    const streak = alt ? cF[(y * S + ((x * 3) % S))] : cF[(((y * 3) % S) * S + x)];
    const v = (0.72 + 0.4 * cF[i] + 0.25 * (streak - 0.5)) * (0.92 + 0.16 * cM[i]) * (0.8 + 0.2 * seamK) * (alt ? 1.0 : 0.93);
    return { c: [0.105 * v, 0.125 * v, 0.14 * v], h: (cF[i] * 0.004 + (seamK - 1) * 0.0012), rough: 0.97 };
  }, aniso);

  // painted wall: tired off-white with a yellow cast, roller texture
  const wF = fbm(S, 160, 2, 211);
  const wM = fbm(S, 3, 5, 212);
  const wall = simpleSet(S, (x, y, i) => {
    const v = 0.955 + 0.05 * wM[i] + 0.03 * (wF[i] - 0.5);
    return { c: [0.60 * v, 0.545 * v, 0.40 * v], h: wF[i] * 0.0011, rough: 0.82 + 0.1 * wM[i] };
  }, aniso);

  // acoustic drop ceiling: 2 x 2 tiles per repeat (repeat = 1.2 m), pin holes, T-bars
  const rnd = mulberry32(221);
  const holes = new Float32Array(S * S);
  for (let n = 0; n < 5200; n++) {
    const cx = Math.floor(rnd() * S), cy = Math.floor(rnd() * S);
    const rr = 1 + Math.floor(rnd() * 2);
    for (let dy = -rr; dy <= rr; dy++) for (let dx = -rr; dx <= rr; dx++) {
      if (dx * dx + dy * dy > rr * rr) continue;
      holes[(((cy + dy) + S) % S) * S + (((cx + dx) + S) % S)] = 1;
    }
  }
  const ceF = fbm(S, 64, 3, 222);
  const ceiling = simpleSet(S, (x, y, i) => {
    const fx = ((x / S) * 2) % 1, fy = ((y / S) * 2) % 1;
    const bar = Math.min(fx, 1 - fx, fy, 1 - fy);
    const isBar = bar < 0.022 ? 1 : 0;
    const hole = holes[i] * (1 - isBar);
    const v = isBar ? 0.74 : (0.6 + 0.08 * ceF[i]) * (1 - 0.6 * hole);
    return {
      c: [v, v * 0.985, v * 0.94],
      h: isBar ? 0.004 : ceF[i] * 0.0015 - hole * 0.004,
      rough: isBar ? 0.45 : 0.95,
    };
  }, aniso);

  // door veneer: vertical grain
  const dA = fbm(S, 4, 3, 231);
  const dB = fbm(S, 64, 2, 232);
  const wood = simpleSet(S, (x, y, i) => {
    const warp = dA[i] * 40;
    const grain = dB[(y >> 3) * S + ((x * 4 + Math.floor(warp)) % S)];
    const v = 0.75 + 0.5 * grain;
    return { c: [0.215 * v, 0.125 * v, 0.068 * v], h: grain * 0.0012, rough: 0.42 + 0.2 * grain };
  }, aniso);

  return { carpet, wall, ceiling, wood };
}

// Flat neutral set for plain painted / plastic / metal parts.
export function makePlainTextures() {
  const mk = (r, g, b, a = 255) => {
    const t = new THREE.DataTexture(new Uint8Array([r, g, b, a]), 1, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
    t.needsUpdate = true;
    return t;
  };
  const albedo = mk(255, 255, 255);
  albedo.colorSpace = THREE.SRGBColorSpace;
  return { albedo, normal: mk(128, 128, 255), orm: mk(255, 255, 0) };
}
