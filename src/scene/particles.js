// Small particle systems, all closed-form functions of time (no simulation
// state), so any frame can be rendered on its own.
import * as THREE from 'three';
import { mulberry32 } from '../shared/math.js';
import { CORRIDOR_Y, SPLASH } from '../config.js';

// Streaks of nothing rushing past while falling between the two worlds.
export function buildVoidStreaks() {
  const rnd = mulberry32(4242);
  const N = 900;
  const pos = new Float32Array(N * 6);
  const a = new Float32Array(N * 2);
  for (let i = 0; i < N; i++) {
    const ang = rnd() * Math.PI * 2;
    const r = 1.6 + Math.pow(rnd(), 0.7) * 17;
    const x = SPLASH.x + Math.cos(ang) * r;
    const z = SPLASH.z + Math.sin(ang) * r;
    const y = 12.5 + rnd() * (CORRIDOR_Y - 13.5);
    const len = 1.5 + rnd() * 6;
    pos.set([x, y, z, x, y + len, z], i * 6);
    const b = 0.25 + rnd() * 0.75;
    a[i * 2] = 0;
    a[i * 2 + 1] = b;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aB', new THREE.BufferAttribute(a, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uAmount: { value: 0 } },
    vertexShader: /* glsl */ `
      attribute float aB;
      varying float vB;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vB = aB / (1.0 + length(mv.xyz) * 0.05);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uAmount;
      varying float vB;
      void main() { gl_FragColor = vec4(vec3(0.45, 0.62, 0.7) * vB * uAmount, 1.0); }`,
  });
  const lines = new THREE.LineSegments(g, mat);
  lines.frustumCulled = false;
  lines.visible = false;
  return { mesh: lines, mat };
}

// Air dragged under by the impact, then rising.
export function buildBubbles() {
  const rnd = mulberry32(777);
  const N = 900;
  const pos = new Float32Array(N * 3);
  const s0 = new Float32Array(N * 4);
  const s1 = new Float32Array(N * 4);
  for (let i = 0; i < N; i++) {
    const ang = rnd() * Math.PI * 2;
    const r = Math.pow(rnd(), 0.6) * 1.0;
    s0.set([Math.cos(ang) * r, Math.sin(ang) * r, 0.25 + rnd() * 2.3, 0.45 + rnd() * 1.3], i * 4);  // offset xz, plunge depth, rise speed
    s1.set([0.4 + rnd() * rnd() * 2.6, rnd() * 6.28, rnd() * 0.35, rnd()], i * 4);                  // size, phase, delay, shade
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aS0', new THREE.BufferAttribute(s0, 4));
  g.setAttribute('aS1', new THREE.BufferAttribute(s1, 4));
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: {
      uTau: { value: -1 }, uOrigin: { value: new THREE.Vector3(SPLASH.x, 0, SPLASH.z) },
      uScale: { value: 1080 }, uLight: { value: 1 },
    },
    vertexShader: /* glsl */ `
      attribute vec4 aS0;
      attribute vec4 aS1;
      uniform float uTau;
      uniform vec3 uOrigin;
      uniform float uScale;
      varying float vA;
      varying float vShade;
      void main() {
        float tau = uTau - aS1.z * 0.25;
        float plunge = aS0.z * (1.0 - exp(-max(tau, 0.0) * 9.0));
        float rise = aS0.w * max(tau - 0.22, 0.0) * (1.0 + max(tau - 0.22, 0.0) * 0.6);
        float y = -plunge + rise;
        float spread = 0.35 + 1.5 * (1.0 - exp(-max(tau, 0.0) * 2.2));
        vec3 p = uOrigin + vec3(aS0.x * spread, y, aS0.y * spread);
        p.x += sin(tau * 9.0 + aS1.y) * 0.035;
        p.z += cos(tau * 7.0 + aS1.y * 1.7) * 0.035;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        float d = max(-mv.z, 0.02);
        gl_PointSize = clamp(aS1.x * 0.011 * uScale / d, 0.0, uScale * 0.22);
        vA = step(0.0, tau) * smoothstep(0.0, -0.06, y) * smoothstep(0.03, 0.2, d);
        vShade = aS1.w;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uLight;
      varying float vA;
      varying float vShade;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float r = length(c) * 2.0;
        if (r > 1.0 || vA < 0.01) discard;
        float rim = smoothstep(0.55, 0.95, r) * smoothstep(1.0, 0.92, r);
        float spec = smoothstep(0.3, 0.0, length(c - vec2(-0.16, -0.18)) * 2.0);
        float body = 0.16 * (1.0 - r);
        float a = (rim * 0.7 + spec * 0.9 + body) * vA;
        vec3 col = mix(vec3(0.55, 0.9, 0.95), vec3(1.0), spec + vShade * 0.3) * (0.8 + 1.4 * spec) * uLight;
        gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
      }`,
  });
  const points = new THREE.Points(g, mat);
  points.frustumCulled = false;
  points.visible = false;
  return { mesh: points, mat };
}

// Water thrown up when the surface starts to churn.
export function buildSpray() {
  const rnd = mulberry32(999);
  const N = 700;
  const pos = new Float32Array(N * 3);
  const v = new Float32Array(N * 4);
  const o = new Float32Array(N * 4);
  for (let i = 0; i < N; i++) {
    const ang = rnd() * Math.PI * 2;
    const sp = 0.4 + rnd() * 1.9;
    v.set([Math.cos(ang) * sp, 1.6 + rnd() * 3.4, Math.sin(ang) * sp, rnd() * 1.25], i * 4);       // velocity, birth
    const rr = Math.pow(rnd(), 0.7) * 1.1;
    const a2 = rnd() * Math.PI * 2;
    o.set([Math.cos(a2) * rr, Math.sin(a2) * rr, 0.5 + rnd() * 1.6, rnd()], i * 4);                 // offset, size
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aV', new THREE.BufferAttribute(v, 4));
  g.setAttribute('aO', new THREE.BufferAttribute(o, 4));
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { uTau: { value: -1 }, uOrigin: { value: new THREE.Vector3() }, uScale: { value: 1080 }, uLight: { value: 1 } },
    vertexShader: /* glsl */ `
      attribute vec4 aV;
      attribute vec4 aO;
      uniform float uTau;
      uniform vec3 uOrigin;
      uniform float uScale;
      varying float vA;
      void main() {
        float tau = uTau - aV.w;
        tau = tau > 0.0 ? mod(tau, 0.62) : -1.0;
        vec3 p = uOrigin + vec3(aO.x, 0.0, aO.y) + aV.xyz * tau + vec3(0.0, -4.9 * tau * tau, 0.0);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = clamp(aO.z * 0.012 * uScale / max(-mv.z, 0.05), 1.0, 40.0);
        vA = step(0.0, tau) * step(0.0, p.y) * (1.0 - tau / 0.62);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uLight;
      varying float vA;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float r = length(c) * 2.0;
        if (r > 1.0 || vA < 0.01) discard;
        gl_FragColor = vec4(vec3(0.82, 0.93, 0.95) * uLight, (1.0 - r * r) * vA * 0.8);
      }`,
  });
  const points = new THREE.Points(g, mat);
  points.frustumCulled = false;
  points.visible = false;
  return { mesh: points, mat };
}
