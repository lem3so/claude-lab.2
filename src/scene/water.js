// Custom water surface.
//
//  * planar reflection (the scene rendered from a mirrored camera)
//  * screen-space refraction of the already rendered opaque scene
//  * Beer-Lambert absorption + in-scatter by the real optical path length,
//    which is what turns white tile into turquoise and the abyss into night
//  * analytic height field: slow swell, fine ripples, expanding ring waves
//    from every splash / footstep, and a churning mode for the finale
//  * seen from below: Snell's window with total internal reflection
import * as THREE from 'three';
import { GLSL_HASH } from './materials.js';
import { WATER_Y } from '../config.js';

export const MAX_RIPPLES = 8;

export function createWater({ detailNormal }) {
  const uniforms = {
    tRefl: { value: null },
    tScene: { value: null },
    tDepth: { value: null },
    tAO: { value: null },
    tDetail: { value: detailNormal },
    uTime: { value: 0 },
    uRes: { value: new THREE.Vector2(1920, 1080) },
    uNear: { value: 0.05 },
    uFar: { value: 220 },
    uLight: { value: 1 },
    uCalm: { value: 1 },
    uAgit: { value: 0 },
    uAgitPos: { value: new THREE.Vector2() },
    uAgitRad: { value: 3 },
    uSplashFoam: { value: 0 },
    uSplashPos: { value: new THREE.Vector2() },
    uRipples: { value: Array.from({ length: MAX_RIPPLES }, () => new THREE.Vector4(0, 0, -100, 0)) },
    uAbsorb: { value: new THREE.Vector3(0.34, 0.085, 0.070) },
    uScatter: { value: new THREE.Color(0.003, 0.034, 0.042) },
    uScatterK: { value: 0.16 },
    uFogColor: { value: new THREE.Color() },
    uFogDensity: { value: 0.018 },
    uUnderColor: { value: new THREE.Color(0.02, 0.2, 0.23) },
    uReflOn: { value: 1 },
    uRippleN: { value: 0 },
  };

  const material = new THREE.ShaderMaterial({
    uniforms,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      varying vec3 vWPos;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWPos = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      #define MAX_RIPPLES ${MAX_RIPPLES}
      uniform sampler2D tRefl;
      uniform sampler2D tScene;
      uniform sampler2D tDepth;
      uniform sampler2D tAO;
      uniform sampler2D tDetail;
      uniform float uTime;
      uniform vec2 uRes;
      uniform float uNear;
      uniform float uFar;
      uniform float uLight;
      uniform float uCalm;
      uniform float uAgit;
      uniform vec2 uAgitPos;
      uniform float uAgitRad;
      uniform float uSplashFoam;
      uniform vec2 uSplashPos;
      uniform vec4 uRipples[MAX_RIPPLES];
      uniform vec3 uAbsorb;
      uniform vec3 uScatter;
      uniform float uScatterK;
      uniform vec3 uFogColor;
      uniform float uFogDensity;
      uniform vec3 uUnderColor;
      uniform float uReflOn;
      uniform int uRippleN;
      varying vec3 vWPos;
      ${GLSL_HASH}

      float linDepth(float d) { return (uNear * uFar) / (uFar - d * (uFar - uNear)); }
      float vnoise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x), mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x), f.y);
      }

      float agitFalloff(vec2 p) { vec2 d = (p - uAgitPos) / uAgitRad; return exp(-dot(d, d)); }

      float heightAt(vec2 p) {
        float t = uTime;
        float h = 0.0;
        // slow swell of a big indoor basin
        h += 0.0085 * sin(dot(p, vec2(0.92, 0.39)) * 1.15 + t * 1.05);
        h += 0.0060 * sin(dot(p, vec2(-0.47, 0.88)) * 1.9 + t * 1.32 + 1.3);
        h += 0.0036 * sin(dot(p, vec2(0.31, -0.95)) * 3.4 + t * 1.85 + 4.0);
        h += 0.0020 * sin(dot(p, vec2(-0.86, -0.51)) * 5.9 + t * 2.5 + 2.1);
        h *= uCalm;
        // ring waves
        for (int i = 0; i < uRippleN; i++) {
          vec4 r = uRipples[i];
          float age = max(t - r.z, 0.0);
          float d = distance(p, r.xy);
          float front = age * 1.25;
          float behind = front - d;
          float env = smoothstep(-0.25, 0.25, behind) * exp(-max(behind, 0.0) * 0.75);
          float fade = exp(-age * 0.42) / (1.0 + d * 0.45);
          h += r.w * env * fade * sin(d * 8.5 - age * 10.6);
        }
        return h;
      }

      void main() {
        vec2 suv = gl_FragCoord.xy / uRes;
        vec3 toCam = cameraPosition - vWPos;
        float dist = length(toCam);
        vec3 V = toCam / dist;

        float e = 0.025 + dist * 0.0025;
        float h0 = heightAt(vWPos.xz);
        float hx = heightAt(vWPos.xz + vec2(e, 0.0));
        float hz = heightAt(vWPos.xz + vec2(0.0, e));
        vec2 slope = vec2(h0 - hx, h0 - hz) / e;

        float detailFade = 1.0 / (1.0 + dist * 0.07);
        vec2 d1 = texture2D(tDetail, vWPos.xz * 0.31 + vec2(uTime * 0.021, uTime * 0.013)).xy * 2.0 - 1.0;
        vec2 d2 = texture2D(tDetail, vWPos.zx * 0.77 + vec2(-uTime * 0.029, uTime * 0.017)).xy * 2.0 - 1.0;
        float agit = uAgit * agitFalloff(vWPos.xz);
        slope += (d1 * 0.022 + d2 * 0.013) * detailFade * (uCalm + agit * 1.5);
        if (agit > 0.001) {
          // churning water of the finale: fast, irregular chop instead of a calm swell
          vec2 a1 = texture2D(tDetail, vWPos.xz * 0.52 + vec2(uTime * 0.33, -uTime * 0.24)).xy * 2.0 - 1.0;
          vec2 a2 = texture2D(tDetail, vWPos.zx * 1.27 + vec2(-uTime * 0.41, uTime * 0.3)).xy * 2.0 - 1.0;
          slope += (a1 * 0.2 + a2 * 0.1) * agit;
        }

        vec3 N = normalize(vec3(slope.x, 1.0, slope.y));
        float dWater = linDepth(gl_FragCoord.z);
        vec3 col;

        if (gl_FrontFacing) {
          // ------------------------------------------------ seen from above
          float ndv = max(dot(N, V), 0.0);
          float fres = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);

          vec2 ruv = vec2(1.0 - suv.x, suv.y) + slope * vec2(-0.55, 0.9) / (1.0 + dist * 0.03);
          vec3 refl = texture2D(tRefl, clamp(ruv, 0.002, 0.998)).rgb * uReflOn;

          vec2 fuv = suv + slope * 0.14 * clamp(2.5 / dist, 0.05, 1.0);
          float dS = linDepth(texture2D(tDepth, fuv).x);
          if (dS < dWater) { fuv = suv; dS = linDepth(texture2D(tDepth, fuv).x); }
          vec3 sceneCol = texture2D(tScene, fuv).rgb * texture2D(tAO, fuv).r;
          float thick = max(dS - dWater, 0.0) * (dist / dWater);
          vec3 trans = exp(-uAbsorb * thick);
          vec3 refr = sceneCol * trans + uScatter * uLight * (1.0 - exp(-thick * uScatterK));

          col = mix(refr, refl, fres);

          // foam where the water is being torn up
          // white water: where the surface is torn up, and drifting flecks after the dive
          vec2 sd = (vWPos.xz - uSplashPos) / 2.4;
          float cover = smoothstep(0.5, 1.0, agit) * smoothstep(0.25, 0.8, distance(vWPos.xz, uAgitPos));
          float cover2 = uSplashFoam * exp(-dot(sd, sd));
          if (cover + cover2 > 0.002) {
            vec2 fp = vWPos.xz + slope * 0.6;
            float fn = vnoise(fp * 2.3 + vec2(uTime * 0.9, -uTime * 0.6)) * 0.55
                     + vnoise(fp * 5.9 - vec2(uTime * 1.3, uTime * 0.7)) * 0.30
                     + vnoise(fp * 14.0 + uTime * 2.1) * 0.15;
            float foam = smoothstep(0.62 - 0.2 * cover, 0.74 - 0.2 * cover, fn) * cover;
            float fn2 = vnoise(fp * 4.7 + uTime * 0.15) * 0.4 + vnoise(fp * 13.0 - uTime * 0.2) * 0.35 + vnoise(fp * 31.0 + uTime * 0.4) * 0.25;
            foam = max(foam, smoothstep(0.74 - 0.24 * cover2, 0.84 - 0.24 * cover2, fn2) * min(cover2 * 3.0, 1.0) * 0.65);
            col = mix(col, vec3(0.78, 0.88, 0.88) * uLight * (0.75 + 0.5 * fn), foam * 0.8);
          }

          float ff = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
          col = mix(col, uFogColor, ff);
        } else {
          // ------------------------------------------------ seen from below
          float cosI = max(dot(-N, V), 0.0);
          float sin2T = 1.769 * (1.0 - cosI * cosI);
          float tir = smoothstep(0.80, 1.0, sin2T);
          vec2 fuv = suv + slope * 0.9;
          vec3 above = texture2D(tScene, clamp(fuv, 0.002, 0.998)).rgb * 1.25;
          // outside Snell's window the surface is a rippling mirror of the pool itself
          vec2 ruv = vec2(1.0 - suv.x, suv.y) + slope * vec2(-1.3, 1.6);
          vec3 mirror = texture2D(tRefl, clamp(ruv, 0.002, 0.998)).rgb;
          float dR = min(dist * 2.0, 30.0);
          vec3 below = mix(uUnderColor * uLight, mirror * vec3(0.72, 0.95, 0.97), exp(-dR * 0.16)) * (0.9 + length(slope) * 3.0);
          col = mix(above, below, tir);
        }
        gl_FragColor = vec4(col, 1.0);
      }`,
  });

  const geo = new THREE.PlaneGeometry(1, 1, 1, 1);
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, material);
  mesh.scale.set(124, 1, 136);
  mesh.position.set(0, WATER_Y, -12);
  mesh.frustumCulled = false;

  const scene = new THREE.Scene();
  scene.add(mesh);

  // ripple bookkeeping: events are scripted, the 8 strongest live ones are uploaded
  const events = [];
  function addRipple(x, z, t0, amp) { events.push({ x, z, t0, amp }); }
  function update(t) {
    uniforms.uTime.value = t;
    const live = events
      .filter((e) => t > e.t0 && t - e.t0 < 9)
      .map((e) => ({ e, w: e.amp * Math.exp(-(t - e.t0) * 0.42) }))
      .sort((a, b) => b.w - a.w)
      .slice(0, MAX_RIPPLES);
    for (let i = 0; i < MAX_RIPPLES; i++) {
      const v = uniforms.uRipples.value[i];
      if (i < live.length) v.set(live[i].e.x, live[i].e.z, live[i].e.t0, live[i].e.amp);
      else v.set(0, 0, -100, 0);
    }
    uniforms.uRippleN.value = live.length;
  }

  return { scene, mesh, material, uniforms, addRipple, update, events };
}

// Mirror the camera across the water plane and clip everything below it
// (oblique near plane, after Lengyel — same construction as THREE.Reflector).
const _plane = new THREE.Plane();
const _clip = new THREE.Vector4();
const _q = new THREE.Vector4();
const _fwd = new THREE.Vector3();
const _up = new THREE.Vector3();
const _tgt = new THREE.Vector3();

export function updateReflectionCamera(camera, virtual, below = false, clipBias = 0.003) {
  camera.updateMatrixWorld();
  const e = camera.matrixWorld.elements;
  _up.set(e[4], e[5], e[6]);
  _fwd.set(-e[8], -e[9], -e[10]);
  virtual.position.set(camera.position.x, 2 * WATER_Y - camera.position.y, camera.position.z);
  virtual.up.set(_up.x, -_up.y, _up.z);
  _tgt.set(virtual.position.x + _fwd.x, virtual.position.y - _fwd.y, virtual.position.z + _fwd.z);
  virtual.lookAt(_tgt);
  virtual.updateMatrixWorld();
  virtual.matrixWorldInverse.copy(virtual.matrixWorld).invert();
  virtual.projectionMatrix.copy(camera.projectionMatrix);

  // keep the half-space the real camera is in: above the water, or below it
  _plane.set(new THREE.Vector3(0, below ? -1 : 1, 0), below ? WATER_Y : -WATER_Y);
  _plane.applyMatrix4(virtual.matrixWorldInverse);
  _clip.set(_plane.normal.x, _plane.normal.y, _plane.normal.z, _plane.constant);
  const p = virtual.projectionMatrix.elements;
  _q.x = (Math.sign(_clip.x) + p[8]) / p[0];
  _q.y = (Math.sign(_clip.y) + p[9]) / p[5];
  _q.z = -1.0;
  _q.w = (1.0 + p[10]) / p[14];
  _clip.multiplyScalar(2.0 / _clip.dot(_q));
  p[2] = _clip.x;
  p[6] = _clip.y;
  p[10] = _clip.z + 1.0 - clipBias;
  p[14] = _clip.w;
  virtual.projectionMatrixInverse.copy(virtual.projectionMatrix).invert();
}
