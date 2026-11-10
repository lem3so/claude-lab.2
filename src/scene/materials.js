// PBR surface material used by every solid surface in the film.
//
// It is a MeshStandardMaterial (GGX specular, image based lighting, shadow
// maps) extended through onBeforeCompile with:
//   * world-space projected UVs, so tiles line up across the whole complex
//   * hemispherical ambient light and distance haze, per "world" (pool/corridor)
//   * a mask for the key light (the corridor must not be lit by the pool sun)
//   * pool effects: wet band at the waterline, depth absorption below the
//     surface, animated caustics below and reflected caustics above
//   * the reality failure of the corridor floor (tiles blinking out)
import * as THREE from 'three';
import { TILE_TEX_METERS, WATER_Y } from '../config.js';

export const GLSL_HASH = /* glsl */ `
float hash21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}
`;

// Two scrolling copies of the photon-mapped caustic texture.
export const GLSL_CAUSTIC = /* glsl */ `
uniform sampler2D tCaustic;
float causticAt(vec2 p, float t) {
  vec2 a = p * 0.37 + vec2(t * 0.021, t * 0.013);
  vec2 b = p.yx * 0.29 + vec2(-t * 0.017, t * 0.019) + 0.37;
  float c1 = texture2D(tCaustic, a).r * 4.0;
  float c2 = texture2D(tCaustic, b).r * 4.0;
  return min(c1, c2) * 1.55;
}
`;

// Uniforms shared by all materials of one "world".
export function createWorldUniforms({ ambSky, ambGround, fogColor, fogDensity, dirMask }) {
  return {
    uTime: { value: 0 },
    uAmbSky: { value: new THREE.Color().copy(ambSky) },
    uAmbGround: { value: new THREE.Color().copy(ambGround) },
    uAmbScale: { value: 1 },
    uFogColor: { value: new THREE.Color().copy(fogColor) },
    uFogDensity: { value: fogDensity },
    uDirMask: { value: dirMask },
    uWaterY: { value: WATER_Y },
    uCausticAmp: { value: 1.0 },
    uCausticAir: { value: 0.5 },
    uAbsorb: { value: new THREE.Vector3(0.36, 0.085, 0.070) },
    tCaustic: { value: null },
    uFloorGlitch: { value: 0 },
    uHolePos: { value: new THREE.Vector3() },
    uZoneDim: { value: new THREE.Vector3(-4, -9, 1) },       // ambient falls off between z0 and z1 down to `factor`
    uShadowA: { value: new THREE.Vector3() },                // the thing in the water: head / middle / tail
    uShadowB: { value: new THREE.Vector3() },
    uShadowC: { value: new THREE.Vector3() },
    uShadowK: { value: 0 },
  };
}

const patchedLightsBegin = (() => {
  const src = THREE.ShaderChunk.lights_fragment_begin;
  const key = 'getDirectionalLightInfo( directionalLight, directLight );';
  if (!src.includes(key)) throw new Error('three.js lights chunk changed: cannot patch the key light mask');
  return src.replace(key, `${key}\n\t\tdirectLight.color *= uDirMask;`);
})();

let matId = 0;

export function createSurfaceMaterial({
  maps,
  world,
  texMeters = TILE_TEX_METERS,
  color = 0xffffff,
  metalness = 0,
  roughness = 1,
  normalStrength = 1,
  envIntensity = 1,
  envMap = null,
  curved = false,
  pool = false,
  floorGlitch = false,
}) {
  const mat = new THREE.MeshStandardMaterial({ color, roughness, metalness });
  mat.envMapIntensity = envIntensity;
  if (envMap) mat.envMap = envMap;
  if (curved) mat.defines.CURVED_UV = 1;
  if (pool) mat.defines.POOL_FX = 1;
  if (floorGlitch) mat.defines.FLOOR_GLITCH = 1;
  mat.userData.id = matId++;

  const own = {
    tAlb: { value: maps.albedo },
    tNrm: { value: maps.normal },
    tOrm: { value: maps.orm },
    uTexScale: { value: 1 / texMeters },
    uNrmStrength: { value: normalStrength },
  };
  mat.userData.uniforms = own;

  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, world, own);

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', /* glsl */ `#include <common>
        varying vec3 vWPos;
        varying vec3 vWNrm;
        varying vec2 vTUv;`)
      .replace('#include <fog_vertex>', /* glsl */ `#include <fog_vertex>
        {
          vec4 wp_ = vec4(transformed, 1.0);
          vec3 wn_ = objectNormal;
          #ifdef USE_INSTANCING
            wp_ = instanceMatrix * wp_;
            wn_ = mat3(instanceMatrix) * wn_;
          #endif
          vWPos = (modelMatrix * wp_).xyz;
          vWNrm = normalize(mat3(modelMatrix) * wn_);
          vTUv = uv;
        }`);

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', /* glsl */ `#include <common>
        varying vec3 vWPos;
        varying vec3 vWNrm;
        varying vec2 vTUv;
        uniform sampler2D tAlb;
        uniform sampler2D tNrm;
        uniform sampler2D tOrm;
        uniform float uTexScale;
        uniform float uNrmStrength;
        uniform float uTime;
        uniform vec3 uAmbSky;
        uniform vec3 uAmbGround;
        uniform float uAmbScale;
        uniform vec3 uFogColor;
        uniform float uFogDensity;
        uniform float uDirMask;
        uniform float uWaterY;
        uniform float uCausticAmp;
        uniform float uCausticAir;
        uniform vec3 uAbsorb;
        uniform float uFloorGlitch;
        uniform vec3 uHolePos;
        uniform vec3 uZoneDim;
        uniform vec3 uShadowA;
        uniform vec3 uShadowB;
        uniform vec3 uShadowC;
        uniform float uShadowK;
        float sdSeg(vec2 p, vec2 a, vec2 b) {
          vec2 pa = p - a, ba = b - a;
          return length(pa - ba * clamp(dot(pa, ba) / max(dot(ba, ba), 1e-5), 0.0, 1.0));
        }
        ${GLSL_HASH}
        ${GLSL_CAUSTIC}
      `)
      .replace('#include <clipping_planes_fragment>', /* glsl */ `#include <clipping_planes_fragment>
        float glitchSmear = 0.0;
        #ifdef FLOOR_GLITCH
        {
          // reality fails tile by tile around the point where the floor gives way
          vec2 cell = floor(vWPos.xz / 0.5);
          float d = length((cell + 0.5) * 0.5 - uHolePos.xz);
          float tq = floor(uTime * 18.0);
          float r1 = hash21(cell + tq * 0.37);
          float r2 = hash21(cell * 1.7 + 3.1);
          float open = uFloorGlitch * 2.6 - d * 0.42 - r2 * 0.75;
          if (open > 0.4 || (open > 0.0 && r1 > 0.45)) discard;
          glitchSmear = smoothstep(-0.5, 0.0, open) * smoothstep(0.0, 0.06, uFloorGlitch);
        }
        #endif`)
      .replace('#include <map_fragment>', /* glsl */ `
        vec3 wn = normalize(vWNrm);
        vec2 tuv; vec3 tT; vec3 tB;
        #ifdef CURVED_UV
        {
          tuv = vTUv;
          vec3 dp1 = dFdx(vWPos), dp2 = dFdy(vWPos);
          vec2 du1 = dFdx(vTUv), du2 = dFdy(vTUv);
          vec3 dp2perp = cross(dp2, wn), dp1perp = cross(wn, dp1);
          tT = dp2perp * du1.x + dp1perp * du2.x;
          tB = dp2perp * du1.y + dp1perp * du2.y;
          float invmax = inversesqrt(max(max(dot(tT, tT), dot(tB, tB)), 1e-12));
          tT *= invmax; tB *= invmax;
        }
        #else
        {
          vec3 an = abs(wn);
          if (an.y > 0.5) { tuv = vWPos.xz; tT = vec3(1.0, 0.0, 0.0); tB = vec3(0.0, 0.0, 1.0); }
          else if (an.x > an.z) { tuv = vWPos.zy; tT = vec3(0.0, 0.0, 1.0); tB = vec3(0.0, 1.0, 0.0); }
          else { tuv = vWPos.xy; tT = vec3(1.0, 0.0, 0.0); tB = vec3(0.0, 1.0, 0.0); }
          tuv *= uTexScale;
        }
        #endif
        #ifdef FLOOR_GLITCH
          // texture streaming failure: the map smears into stripes before the tile drops out
          tuv.y = mix(tuv.y, floor(tuv.y * 2.0) * 0.5, step(0.5, glitchSmear));
        #endif
        vec4 tileAlb = texture2D(tAlb, tuv);
        vec4 tileOrm = texture2D(tOrm, tuv);
        diffuseColor.rgb *= tileAlb.rgb;
        // large scale unevenness so repeats never read as a pattern
        float macro = sin(vWPos.x * 0.61 + vWPos.y * 0.43) * sin(vWPos.z * 0.53 - vWPos.y * 0.71) * sin((vWPos.x + vWPos.z) * 0.23);
        diffuseColor.rgb *= 0.965 + 0.035 * macro;
        // every tile gets its own shade and tilt from its world position (never repeats);
        // faded out once tiles become smaller than a pixel
        vec2 tileId = floor(tuv * 8.0);
        float tileFade = 1.0 - smoothstep(0.3, 0.9, length(fwidth(tuv * 8.0)));
        float tileMask = smoothstep(0.78, 0.98, tileOrm.r) * tileFade;
        #ifdef POOL_FX
          diffuseColor.rgb *= 1.0 + (hash21(tileId) - 0.5) * 0.07 * tileMask;
        #endif
        float wetBand = 0.0;
        #ifdef POOL_FX
        {
          // darker, glossier band where the water keeps the wall wet
          float hAbove = vWPos.y - uWaterY;
          wetBand = smoothstep(0.42, 0.02, hAbove) * step(0.0, hAbove);
          diffuseColor.rgb *= mix(vec3(1.0), vec3(0.90, 0.93, 0.92), wetBand);
        }
        #endif
        #ifdef FLOOR_GLITCH
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.3, 0.9, 1.5), glitchSmear * 0.6);
        #endif
      `)
      .replace('#include <roughnessmap_fragment>', /* glsl */ `
        float roughnessFactor = roughness * tileOrm.g;
        roughnessFactor = mix(roughnessFactor, roughnessFactor * 0.45, wetBand);
      `)
      .replace('#include <normal_fragment_maps>', /* glsl */ `
        {
          vec3 tn = texture2D(tNrm, tuv).xyz * 2.0 - 1.0;
          tn.xy *= uNrmStrength;
          #ifdef POOL_FX
            tn.xy += (vec2(hash21(tileId + 1.37), hash21(tileId + 7.11)) - 0.5) * 0.045 * tileMask;
          #endif
          vec3 wPert = normalize(tT * tn.x + tB * tn.y + wn * max(tn.z, 0.05));
          normal = normalize(mat3(viewMatrix) * wPert);
        }
      `)
      .replace('#include <lights_fragment_begin>', patchedLightsBegin)
      .replace('#include <aomap_fragment>', /* glsl */ `
        {
          // hemispherical ambient (bounce light of the hall), with tile cavity occlusion
          vec3 nW = normalize(inverseTransformDirection(normal, viewMatrix));
          vec3 amb = mix(uAmbGround, uAmbSky, nW.y * 0.5 + 0.5) * uAmbScale;
          reflectedLight.indirectDiffuse += amb * diffuseColor.rgb;
          reflectedLight.indirectDiffuse *= tileOrm.r;
          float zone = mix(uZoneDim.z, 1.0, smoothstep(uZoneDim.y, uZoneDim.x, vWPos.z));
          reflectedLight.indirectDiffuse *= zone;
          reflectedLight.indirectSpecular *= zone;
          #ifdef POOL_FX
            float below = uWaterY - vWPos.y;
            vec2 cp = vWPos.xz + vWPos.y * vec2(0.31, 0.19);
            if (below > 0.0) {
              // light is absorbed on its way down, and focused into caustics
              vec3 att = exp(-uAbsorb * below);
              float c = min(causticAt(cp, uTime), 3.2);
              float k = uCausticAmp * mix(0.45, 1.0, clamp(nW.y, 0.0, 1.0)) * smoothstep(0.0, 0.6, below) / (1.0 + below * 0.2);
              float cm = mix(1.0, c, clamp(k, 0.0, 1.0));
              // something large passes between the light and the floor
              float sh = 0.0;
              if (uShadowK > 0.001 && vWPos.y < uShadowB.y) {
                float dsh = min(sdSeg(vWPos.xz, uShadowA.xz, uShadowB.xz), sdSeg(vWPos.xz, uShadowB.xz, uShadowC.xz));
                sh = smoothstep(1.9, 0.25, dsh) * uShadowK;
              }
              att *= 1.0 - 0.8 * sh;
              reflectedLight.directDiffuse *= att * cm * 1.1;
              reflectedLight.indirectDiffuse *= att * mix(1.0, cm, 0.7);
              reflectedLight.directSpecular *= 0.0;
              reflectedLight.indirectSpecular *= 0.12;
            } else {
              // light bounced off the moving surface plays on nearby walls
              float h = -below;
              float c = causticAt(cp * 0.6 + 3.0, uTime * 0.85);
              float k = uCausticAir * exp(-h * 0.55) * (1.0 - clamp(nW.y, 0.0, 1.0) * 0.6);
              reflectedLight.indirectDiffuse += diffuseColor.rgb * uAmbSky * uAmbScale * (c - 0.55) * k;
            }
          #endif
        }
      `)
      .replace('#include <fog_fragment>', /* glsl */ `
        {
          float fd = length(vViewPosition);
          float ff = 1.0 - exp(-uFogDensity * uFogDensity * fd * fd);
          gl_FragColor.rgb = mix(gl_FragColor.rgb, uFogColor, ff);
        }
      `);
  };
  return mat;
}

// Self-lit panels (light fittings). HDR values feed the bloom.
export function createEmissiveMaterial({ world, color = new THREE.Color(1, 1, 1), intensity = 1 }) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: color.clone() },
      uIntensity: { value: intensity },
      uFogColor: world.uFogColor,
      uFogDensity: world.uFogDensity,
    },
    vertexShader: /* glsl */ `
      varying float vDist;
      varying vec2 vUv;
      void main() {
        vec4 p = vec4(position, 1.0);
        #ifdef USE_INSTANCING
          p = instanceMatrix * p;
        #endif
        vec4 mv = modelViewMatrix * p;
        vDist = length(mv.xyz);
        vUv = uv;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uIntensity;
      uniform vec3 uFogColor;
      uniform float uFogDensity;
      varying float vDist;
      varying vec2 vUv;
      void main() {
        // faint diffuser falloff towards the frame of the fitting
        vec2 e = min(vUv, 1.0 - vUv);
        float edge = smoothstep(0.0, 0.08, min(e.x, e.y));
        vec3 col = uColor * uIntensity * (0.72 + 0.28 * edge);
        float ff = 1.0 - exp(-uFogDensity * uFogDensity * vDist * vDist);
        gl_FragColor = vec4(mix(col, uFogColor, ff * 0.85), 1.0);
      }`,
  });
}
