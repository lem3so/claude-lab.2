// Tiny architectural geometry kit: boxes, walls with arched / round openings,
// barrel vaults, round columns and stairs — merged into a few big buffers.
//
// Two builders are used side by side:
//   flat   -> axis aligned faces; the tile material projects its UVs from
//             world space, so every surface lines up on one global tile grid.
//   curved -> arcs, vaults and cylinders; UVs are baked along the arc length.
import * as THREE from 'three';
import { TILE_TEX_METERS } from '../config.js';

const UVS = 1 / TILE_TEX_METERS;

export class Builder {
  constructor() {
    this.pos = [];
    this.nrm = [];
    this.uv = [];
    this.idx = [];
    this.n = 0;
  }

  _v(p, n, uv) {
    this.pos.push(p[0], p[1], p[2]);
    this.nrm.push(n[0], n[1], n[2]);
    this.uv.push(uv ? uv[0] : 0, uv ? uv[1] : 0);
    return this.n++;
  }

  // Flat quad a-b-c-d. If `want` (a direction) is given the winding is fixed
  // so that the face normal points that way.
  quad(a, b, c, d, want) {
    const n = faceNormal(a, b, d);
    if (want && n[0] * want[0] + n[1] * want[1] + n[2] * want[2] < 0) {
      return this.quad(a, d, c, b);
    }
    const i0 = this._v(a, n, [0, 0]), i1 = this._v(b, n, [1, 0]), i2 = this._v(c, n, [1, 1]), i3 = this._v(d, n, [0, 1]);
    this.idx.push(i0, i1, i2, i0, i2, i3);
    return this;
  }

  // Quad with per-vertex normals and UVs (curved surfaces).
  quadSmooth(p, n, uv) {
    const g = faceNormal(p[0], p[1], p[3]);
    const s = g[0] * (n[0][0] + n[2][0]) + g[1] * (n[0][1] + n[2][1]) + g[2] * (n[0][2] + n[2][2]);
    const i = [0, 1, 2, 3].map((k) => this._v(p[k], n[k], uv[k]));
    if (s >= 0) this.idx.push(i[0], i[1], i[2], i[0], i[2], i[3]);
    else this.idx.push(i[0], i[2], i[1], i[0], i[3], i[2]);
    return this;
  }

  // Axis aligned box. `skip` lists faces to omit: px nx py ny pz nz.
  box(x0, y0, z0, x1, y1, z1, skip = '') {
    if (x0 > x1) [x0, x1] = [x1, x0];
    if (y0 > y1) [y0, y1] = [y1, y0];
    if (z0 > z1) [z0, z1] = [z1, z0];
    const s = (f) => skip.includes(f);
    if (!s('px')) this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0]);
    if (!s('nx')) this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0]);
    if (!s('py')) this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0]);
    if (!s('ny')) this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0]);
    if (!s('pz')) this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1]);
    if (!s('nz')) this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1]);
    return this;
  }

  // Horizontal rectangle facing up (floor) or down (ceiling).
  floor(x0, z0, x1, z1, y) {
    return this.quad([x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0], [0, 1, 0]);
  }

  ceil(x0, z0, x1, z1, y) {
    return this.quad([x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1], [0, -1, 0]);
  }

  // Ceiling rectangle with a rectangular hole (light well).
  ceilWithHole(x0, z0, x1, z1, y, hx0, hz0, hx1, hz1) {
    this.ceil(x0, z0, x1, hz0, y);
    this.ceil(x0, hz1, x1, z1, y);
    this.ceil(x0, hz0, hx0, hz1, y);
    this.ceil(hx1, hz0, x1, hz1, y);
    return this;
  }

  // Inner faces of a vertical shaft.
  shaft(x0, z0, x1, z1, y0, y1) {
    this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [1, 0, 0]);
    this.quad([x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0], [-1, 0, 0]);
    this.quad([x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [0, 0, 1]);
    this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, -1]);
    return this;
  }

  // Flight of steps as stacked boxes. dir: '+x' '-x' '+z' '-z' = direction of descent.
  stairs({ dir, start, a0, a1, top, bottom, rise, run, count, skip = 'ny' }) {
    for (let k = 1; k <= count; k++) {
      const yTop = top - rise * k;
      const s0 = start + run * (k - 1) * (dir[0] === '+' ? 1 : -1);
      const s1 = start + run * k * (dir[0] === '+' ? 1 : -1);
      if (dir[1] === 'x') this.box(s0, bottom, a0, s1, yTop, a1, skip);
      else this.box(a0, bottom, s0, a1, yTop, s1, skip);
    }
    return this;
  }

  get empty() { return this.n === 0; }

  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.n > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

function faceNormal(a, b, d) {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const l = Math.hypot(nx, ny, nz) || 1;
  return [nx / l, ny / l, nz / l];
}

const ARC_N = 20;

// Outline of an opening in wall space (s along the wall, y up).
function openingOutline(o) {
  const pts = [];
  if (o.type === 'round') {
    const N = 32;
    for (let k = 0; k < N; k++) {
      const a = (k / N) * Math.PI * 2;
      pts.push([o.c + o.r * Math.cos(a), o.y + o.r * Math.sin(a)]);
    }
    return pts;
  }
  const r = o.w / 2;
  if (o.type === 'rect') {
    return [[o.c - r, o.base], [o.c + r, o.base], [o.c + r, o.top], [o.c - r, o.top]];
  }
  // arch: jambs up to the spring line, semicircle on top
  pts.push([o.c - r, o.base], [o.c + r, o.base]);
  for (let k = 0; k <= ARC_N; k++) {
    const a = (k / ARC_N) * Math.PI;
    pts.push([o.c + r * Math.cos(a), o.spring + r * Math.sin(a)]);
  }
  return pts;
}

// A wall slab with openings.
//   axis 'x': the wall runs along x at z = at;  axis 'z': runs along z at x = at.
//   openings: { type: 'arch', c, w, base, spring } | { type: 'rect', c, w, base, top }
//             | { type: 'round', c, y, r }
// Openings whose base sits on the wall's bottom edge become notches in the
// outline; everything else is a true hole.
export function wall(flat, curved, { axis, at, th = 0.5, s0, s1, y0, y1, openings = [], caps = true, top = false }) {
  const W = (s, y, o) => (axis === 'x' ? [s, y, at + o] : [at + o, y, s]);
  const N = (ns, ny, no) => (axis === 'x' ? [ns, ny, no] : [no, ny, ns]);
  const h = th / 2;

  const isNotch = (o) => o.type !== 'round' && o.base <= y0 + 1e-6;
  const notches = openings.filter(isNotch).sort((a, b) => a.c - b.c);
  const holes = openings.filter((o) => !isNotch(o));

  const contour = [[s0, y0]];
  for (const o of notches) {
    const r = o.w / 2;
    if (o.type === 'rect') {
      contour.push([o.c - r, y0], [o.c - r, o.top], [o.c + r, o.top], [o.c + r, y0]);
    } else {
      contour.push([o.c - r, y0]);
      for (let k = 0; k <= ARC_N; k++) {
        const a = Math.PI - (k / ARC_N) * Math.PI;
        contour.push([o.c + r * Math.cos(a), o.spring + r * Math.sin(a)]);
      }
      contour.push([o.c + r, y0]);
    }
  }
  contour.push([s1, y0], [s1, y1], [s0, y1]);
  const holePts = holes.map(openingOutline);

  const v2 = (p) => new THREE.Vector2(p[0], p[1]);
  const tris = THREE.ShapeUtils.triangulateShape(contour.map(v2), holePts.map((hp) => hp.map(v2)));
  const all = contour.concat(...holePts);

  // the two big faces
  for (const side of [1, -1]) {
    const n = N(0, 0, side);
    const base = flat.n;
    for (const p of all) flat._v(W(p[0], p[1], side * h), n);
    for (const t of tris) {
      const a = all[t[0]], b = all[t[1]], c = all[t[2]];
      const g = faceNormal(W(a[0], a[1], 0), W(b[0], b[1], 0), W(c[0], c[1], 0));
      const d = g[0] * n[0] + g[1] * n[1] + g[2] * n[2];
      if (d >= 0) flat.idx.push(base + t[0], base + t[1], base + t[2]);
      else flat.idx.push(base + t[0], base + t[2], base + t[1]);
    }
  }

  // rim
  if (caps) {
    flat.quad(W(s0, y0, -h), W(s0, y0, h), W(s0, y1, h), W(s0, y1, -h), N(-1, 0, 0));
    flat.quad(W(s1, y0, -h), W(s1, y0, h), W(s1, y1, h), W(s1, y1, -h), N(1, 0, 0));
  }
  if (top) flat.quad(W(s0, y1, -h), W(s1, y1, -h), W(s1, y1, h), W(s0, y1, h), N(0, 1, 0));

  // reveals of every opening
  for (const o of openings) {
    if (o.type === 'round') {
      arcStrip(curved, W, N, o.c, o.y, o.r, 0, Math.PI * 2, 32, h);
      continue;
    }
    const r = o.w / 2;
    const base = isNotch(o) ? y0 : o.base;
    const yTop = o.type === 'rect' ? o.top : o.spring;
    flat.quad(W(o.c - r, base, -h), W(o.c - r, base, h), W(o.c - r, yTop, h), W(o.c - r, yTop, -h), N(1, 0, 0));
    flat.quad(W(o.c + r, base, -h), W(o.c + r, base, h), W(o.c + r, yTop, h), W(o.c + r, yTop, -h), N(-1, 0, 0));
    if (!isNotch(o)) flat.quad(W(o.c - r, base, -h), W(o.c + r, base, -h), W(o.c + r, base, h), W(o.c - r, base, h), N(0, 1, 0));
    if (o.type === 'rect') flat.quad(W(o.c - r, o.top, -h), W(o.c + r, o.top, -h), W(o.c + r, o.top, h), W(o.c - r, o.top, h), N(0, -1, 0));
    else arcStrip(curved, W, N, o.c, o.spring, r, 0, Math.PI, ARC_N, h);
  }
}

// Inner surface of a circular arc cut through a wall (normals face the centre).
function arcStrip(curved, W, N, c, cy, r, a0, a1, segs, h) {
  for (let k = 0; k < segs; k++) {
    const ta = a0 + ((a1 - a0) * k) / segs;
    const tb = a0 + ((a1 - a0) * (k + 1)) / segs;
    const A = [c + r * Math.cos(ta), cy + r * Math.sin(ta)];
    const B = [c + r * Math.cos(tb), cy + r * Math.sin(tb)];
    const nA = N(-Math.cos(ta), -Math.sin(ta), 0);
    const nB = N(-Math.cos(tb), -Math.sin(tb), 0);
    curved.quadSmooth(
      [W(A[0], A[1], -h), W(A[0], A[1], h), W(B[0], B[1], h), W(B[0], B[1], -h)],
      [nA, nA, nB, nB],
      [[r * ta * UVS, -h * UVS], [r * ta * UVS, h * UVS], [r * tb * UVS, h * UVS], [r * tb * UVS, -h * UVS]],
    );
  }
}

// Barrel vault running along z (seen from inside).
export function vault(curved, { cx, spring, r, z0, z1, segs = 28 }) {
  for (let k = 0; k < segs; k++) {
    const ta = (k / segs) * Math.PI;
    const tb = ((k + 1) / segs) * Math.PI;
    const A = [cx + r * Math.cos(ta), spring + r * Math.sin(ta)];
    const B = [cx + r * Math.cos(tb), spring + r * Math.sin(tb)];
    const nA = [-Math.cos(ta), -Math.sin(ta), 0];
    const nB = [-Math.cos(tb), -Math.sin(tb), 0];
    curved.quadSmooth(
      [[A[0], A[1], z0], [A[0], A[1], z1], [B[0], B[1], z1], [B[0], B[1], z0]],
      [nA, nA, nB, nB],
      [[r * ta * UVS, z0 * UVS], [r * ta * UVS, z1 * UVS], [r * tb * UVS, z1 * UVS], [r * tb * UVS, z0 * UVS]],
    );
  }
}

// Round column. The radius is snapped so that a whole number of tiles wraps it.
export function roundColumn(curved, cx, cz, r, y0, y1, segs = 28) {
  const tile = TILE_TEX_METERS / 8;
  const circ = Math.max(4, Math.round((2 * Math.PI * r) / tile)) * tile;
  const R = circ / (2 * Math.PI);
  for (let k = 0; k < segs; k++) {
    const ta = (k / segs) * Math.PI * 2;
    const tb = ((k + 1) / segs) * Math.PI * 2;
    const nA = [Math.cos(ta), 0, Math.sin(ta)];
    const nB = [Math.cos(tb), 0, Math.sin(tb)];
    curved.quadSmooth(
      [[cx + R * nA[0], y0, cz + R * nA[2]], [cx + R * nA[0], y1, cz + R * nA[2]],
       [cx + R * nB[0], y1, cz + R * nB[2]], [cx + R * nB[0], y0, cz + R * nB[2]]],
      [nA, nA, nB, nB],
      [[R * ta * UVS, y0 * UVS], [R * ta * UVS, y1 * UVS], [R * tb * UVS, y1 * UVS], [R * tb * UVS, y0 * UVS]],
    );
  }
}
