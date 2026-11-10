// Frame pipeline.
//
//   1. depth pre-pass + opaque scene      -> rtOpaque (HDR colour + depth)
//   2. ambient occlusion from depth       -> rtAO (half res, bilateral blur)
//   3. planar reflection                  -> rtRefl (half res)
//   4. opaque x AO, then the water        -> rtMain (HDR colour + depth)
//   5. bloom pyramid
//   6. camera: lens, waterline, underwater haze, glitch, tone map, grain
import * as THREE from 'three';
import { GLSL_HASH } from '../scene/materials.js';
import { updateReflectionCamera } from '../scene/water.js';
import { WATER_Y } from '../config.js';

const VERT = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const GLSL_DEPTH = /* glsl */ `
  uniform float uNear;
  uniform float uFar;
  float linDepth(float d) { return (uNear * uFar) / (uFar - d * (uFar - uNear)); }`;

function pass(fragmentShader, uniforms, extra = {}) {
  return new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader, uniforms, depthTest: false, depthWrite: false, ...extra });
}

export class Pipeline {
  constructor(renderer, width, height, { prepass = true, ao = true, msaa = 0 } = {}) {
    this.renderer = renderer;
    this.w = width;
    this.h = height;
    this.usePrepass = prepass;
    this.useAO = ao;

    const hdr = { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false };
    const mkDepth = () => {
      const d = new THREE.DepthTexture(width, height);
      d.type = THREE.UnsignedIntType;
      d.minFilter = d.magFilter = THREE.NearestFilter;
      return d;
    };
    this.rtOpaque = new THREE.WebGLRenderTarget(width, height, { ...hdr, depthTexture: mkDepth(), samples: msaa });
    this.rtMain = new THREE.WebGLRenderTarget(width, height, { ...hdr, depthTexture: mkDepth() });
    const hw = Math.ceil(width / 2), hh = Math.ceil(height / 2);
    this.rtRefl = new THREE.WebGLRenderTarget(hw, hh, { ...hdr, depthBuffer: true });
    const ldr = { type: THREE.UnsignedByteType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, generateMipmaps: false };
    this.rtAO = new THREE.WebGLRenderTarget(hw, hh, ldr);
    this.rtAOb = new THREE.WebGLRenderTarget(hw, hh, ldr);
    const bl = { ...hdr, depthBuffer: false };
    const q = (d) => [Math.ceil(width / d), Math.ceil(height / d)];
    this.rtB = [4, 8, 16].map((d) => [new THREE.WebGLRenderTarget(...q(d), bl), new THREE.WebGLRenderTarget(...q(d), bl)]);

    this.white = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    this.white.needsUpdate = true;

    this.ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), null);
    this.quad.frustumCulled = false;
    this.quadScene = new THREE.Scene();
    this.quadScene.add(this.quad);

    this.reflCam = new THREE.PerspectiveCamera();
    this.reflCam.matrixAutoUpdate = true;

    this.depthMat = new THREE.MeshBasicMaterial({ colorWrite: false });

    const near = { value: 0.05 }, far = { value: 220 };
    this.uNear = near;
    this.uFar = far;

    // ---- AO ---------------------------------------------------------------
    this.aoMat = pass(/* glsl */ `
      uniform sampler2D tDepth;
      uniform mat4 uProj;
      uniform mat4 uProjInv;
      uniform vec2 uTexel;
      uniform float uRadius;
      varying vec2 vUv;
      ${GLSL_DEPTH}
      vec3 viewPos(vec2 uv) {
        float d = texture2D(tDepth, uv).x;
        vec4 p = uProjInv * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
        return p.xyz / p.w;
      }
      float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
      void main() {
        float d = texture2D(tDepth, vUv).x;
        if (d >= 0.99999) { gl_FragColor = vec4(1.0); return; }
        vec3 P = viewPos(vUv);
        vec3 px = viewPos(vUv + vec2(uTexel.x, 0.0)), mx = viewPos(vUv - vec2(uTexel.x, 0.0));
        vec3 py = viewPos(vUv + vec2(0.0, uTexel.y)), my = viewPos(vUv - vec2(0.0, uTexel.y));
        vec3 dx = abs(px.z - P.z) < abs(P.z - mx.z) ? px - P : P - mx;
        vec3 dy = abs(py.z - P.z) < abs(P.z - my.z) ? py - P : P - my;
        vec3 N = normalize(cross(dx, dy));
        float rot = ign(gl_FragCoord.xy) * 6.2831853;
        vec3 rv = vec3(cos(rot), sin(rot), 0.0);
        vec3 T = normalize(rv - N * dot(rv, N));
        vec3 B = cross(N, T);
        float radius = uRadius * clamp(-P.z * 0.35, 0.25, 1.0);
        float occ = 0.0;
        const int K = 10;
        for (int i = 0; i < K; i++) {
          float fi = float(i);
          float a = fi * 2.399963 + rot;
          float r = sqrt((fi + 0.5) / float(K));
          vec3 h = vec3(cos(a) * r, sin(a) * r, sqrt(1.0 - r * r));
          float sc = mix(0.25, 1.0, (fi + 1.0) / float(K));
          vec3 S = P + (T * h.x + B * h.y + N * h.z) * radius * sc;
          vec4 c = uProj * vec4(S, 1.0);
          vec2 suv = c.xy / c.w * 0.5 + 0.5;
          float sz = viewPos(suv).z;
          float range = smoothstep(0.0, 1.0, radius / max(abs(P.z - sz), 1e-4));
          occ += step(S.z + 0.02, sz) * range;
        }
        float ao = 1.0 - occ / float(K);
        gl_FragColor = vec4(vec3(ao), 1.0);
      }`, {
      tDepth: { value: null }, uProj: { value: new THREE.Matrix4() }, uProjInv: { value: new THREE.Matrix4() },
      uTexel: { value: new THREE.Vector2(1 / width, 1 / height) }, uRadius: { value: 0.75 }, uNear: near, uFar: far,
    });

    this.aoBlurMat = pass(/* glsl */ `
      uniform sampler2D tAO;
      uniform sampler2D tDepth;
      uniform vec2 uTexel;
      uniform float uStrength;
      varying vec2 vUv;
      ${GLSL_DEPTH}
      void main() {
        float dc = linDepth(texture2D(tDepth, vUv).x);
        float sum = 0.0, wsum = 0.0;
        for (int y = -2; y <= 1; y++) for (int x = -2; x <= 1; x++) {
          vec2 uv = vUv + (vec2(float(x), float(y)) + 0.5) * uTexel;
          float ds = linDepth(texture2D(tDepth, uv).x);
          float w = 1.0 / (1.0 + abs(ds - dc) * 40.0 / dc);
          sum += texture2D(tAO, uv).r * w;
          wsum += w;
        }
        float ao = sum / wsum;
        gl_FragColor = vec4(vec3(mix(1.0, ao, uStrength)), 1.0);
      }`, {
      tAO: { value: null }, tDepth: { value: null }, uTexel: { value: new THREE.Vector2(1 / hw, 1 / hh) },
      uStrength: { value: 0.9 }, uNear: near, uFar: far,
    });

    // ---- opaque x AO copy (also restores depth so the water can depth test) --
    this.copyMat = pass(/* glsl */ `
      uniform sampler2D tColor;
      uniform sampler2D tDepth;
      uniform sampler2D tAO;
      varying vec2 vUv;
      void main() {
        gl_FragColor = vec4(texture2D(tColor, vUv).rgb * texture2D(tAO, vUv).r, 1.0);
        gl_FragDepth = texture2D(tDepth, vUv).x;
      }`, { tColor: { value: null }, tDepth: { value: null }, tAO: { value: null } },
      { depthTest: true, depthWrite: true, depthFunc: THREE.AlwaysDepth });

    // ---- bloom -------------------------------------------------------------
    this.brightMat = pass(/* glsl */ `
      uniform sampler2D tColor;
      uniform vec2 uTexel;
      uniform float uThreshold;
      varying vec2 vUv;
      vec3 pre(vec2 uv) {
        vec3 c = min(texture2D(tColor, uv).rgb, vec3(24.0));
        float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
        return c * smoothstep(uThreshold, uThreshold * 2.2, l);
      }
      void main() {
        vec3 c = pre(vUv + uTexel * vec2(-1.0, -1.0)) + pre(vUv + uTexel * vec2(1.0, -1.0))
               + pre(vUv + uTexel * vec2(-1.0, 1.0)) + pre(vUv + uTexel * vec2(1.0, 1.0));
        gl_FragColor = vec4(c * 0.25, 1.0);
      }`, { tColor: { value: null }, uTexel: { value: new THREE.Vector2(1 / width, 1 / height) }, uThreshold: { value: 1.25 } });

    this.blurMat = pass(/* glsl */ `
      uniform sampler2D tColor;
      uniform vec2 uDir;
      varying vec2 vUv;
      void main() {
        vec3 c = texture2D(tColor, vUv).rgb * 0.227027;
        c += (texture2D(tColor, vUv + uDir * 1.384615).rgb + texture2D(tColor, vUv - uDir * 1.384615).rgb) * 0.316216;
        c += (texture2D(tColor, vUv + uDir * 3.230769).rgb + texture2D(tColor, vUv - uDir * 3.230769).rgb) * 0.070270;
        gl_FragColor = vec4(c, 1.0);
      }`, { tColor: { value: null }, uDir: { value: new THREE.Vector2() } });

    // ---- the camera --------------------------------------------------------
    this.finalU = {
      tMain: { value: null }, tDepth: { value: null },
      tBloom0: { value: null }, tBloom1: { value: null }, tBloom2: { value: null },
      uRes: { value: new THREE.Vector2(width, height) },
      uTime: { value: 0 }, uFrame: { value: 0 },
      uNear: near, uFar: far,
      uProjInv: { value: new THREE.Matrix4() }, uCamWorld: { value: new THREE.Matrix4() },
      uWaterY: { value: WATER_Y },
      uUnderFog: { value: new THREE.Color(0.03, 0.30, 0.34) }, uUnderDensity: { value: 0.24 },
      uLight: { value: 1 },
      uGlitch: { value: 0 }, uChroma: { value: 0.0015 }, uRadial: { value: 0 }, uBarrel: { value: 0.07 },
      uFade: { value: 0 }, uExposure: { value: 1 }, uGrain: { value: 0.04 }, uVignette: { value: 0.42 },
      uSplash: { value: 0 }, uDroplets: { value: 0 }, uBloom: { value: 1 }, uSat: { value: 1 },
      uTint: { value: new THREE.Color(1, 1, 1) }, uWaterOn: { value: 1 },
    };
    this.finalMat = pass(/* glsl */ `
      uniform sampler2D tMain;
      uniform sampler2D tDepth;
      uniform sampler2D tBloom0;
      uniform sampler2D tBloom1;
      uniform sampler2D tBloom2;
      uniform vec2 uRes;
      uniform float uTime;
      uniform float uFrame;
      uniform mat4 uProjInv;
      uniform mat4 uCamWorld;
      uniform float uWaterY;
      uniform vec3 uUnderFog;
      uniform float uUnderDensity;
      uniform float uLight;
      uniform float uGlitch;
      uniform float uChroma;
      uniform float uRadial;
      uniform float uBarrel;
      uniform float uFade;
      uniform float uExposure;
      uniform float uGrain;
      uniform float uVignette;
      uniform float uSplash;
      uniform float uDroplets;
      uniform float uBloom;
      uniform float uSat;
      uniform vec3 uTint;
      uniform float uWaterOn;
      varying vec2 vUv;
      ${GLSL_DEPTH}
      ${GLSL_HASH}

      vec3 fetch(vec2 uv) { return texture2D(tMain, clamp(uv, 0.0015, 0.9985)).rgb; }

      vec3 aces(vec3 x) {
        return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
      }
      float vnoise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x), mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x), f.y);
      }
      // water beads left on the lens after surfacing
      vec3 droplets(vec2 uv, float amount) {
        vec2 off = vec2(0.0);
        float hl = 0.0;
        for (int L = 0; L < 2; L++) {
          float sc = L == 0 ? 7.0 : 13.0;
          vec2 g = uv * vec2(sc * uRes.x / uRes.y, sc);
          g.y += uTime * (L == 0 ? 0.035 : 0.02) * sc * 0.2;
          vec2 id = floor(g);
          vec2 f = fract(g) - 0.5;
          float r = hash21(id + float(L) * 17.0);
          if (r > amount * 0.3) continue;
          vec2 c = (vec2(hash21(id + 3.1), hash21(id + 7.7)) - 0.5) * 0.5;
          float rad = 0.07 + 0.13 * hash21(id + 11.3);
          vec2 d = f - c;
          d.y *= 0.72;
          float k = smoothstep(rad, rad * 0.35, length(d));
          off += -d * k * 0.55 / sc;
          hl += k * smoothstep(rad * 0.5, 0.0, length(d - vec2(-0.3, 0.35) * rad)) * 0.06;
        }
        return vec3(off, hl);
      }

      void main() {
        vec2 uv = vUv;
        float aspect = uRes.x / uRes.y;

        // wide-angle barrel distortion
        vec2 cc = uv - 0.5;
        float r2 = dot(cc * vec2(aspect, 1.0), cc * vec2(aspect, 1.0));
        float rMax = 0.25 * (aspect * aspect + 1.0);
        uv = 0.5 + cc * (1.0 + uBarrel * r2) / (1.0 + uBarrel * rMax);

        // is this part of the lens under water?
        vec4 vp = uProjInv * vec4(uv * 2.0 - 1.0, -1.0, 1.0);
        vp /= vp.w;
        vec3 wp = (uCamWorld * vec4(vp.xyz, 1.0)).xyz;
        float wl = uWaterY + 0.0022 * sin(wp.x * 55.0 + uTime * 3.1) + 0.0016 * sin(wp.z * 41.0 - uTime * 2.3) + 0.0012 * sin((wp.x + wp.z) * 130.0 + uTime * 5.0);
        float under = smoothstep(0.0008, -0.0008, wp.y - wl) * uWaterOn;
        float meniscus = smoothstep(0.0034, 0.0005, abs(wp.y - wl)) * uWaterOn;

        uv += under * 0.0035 * vec2(sin(uv.y * 31.0 + uTime * 2.9), cos(uv.x * 23.0 + uTime * 2.3));
        uv.y += meniscus * 0.012;

        vec3 drop = vec3(0.0);
        if (uDroplets > 0.001) {
          drop = droplets(uv, uDroplets) * (1.0 - under);
          uv += drop.xy;
        }

        // digital tearing
        float gl = uGlitch;
        if (gl > 0.001) {
          float tq = floor(uTime * 24.0);
          float band = floor(uv.y * mix(10.0, 34.0, hash11(tq * 1.3)));
          float rb = hash21(vec2(band, tq));
          if (rb < gl * 0.55) uv.x += (hash21(vec2(band * 3.7, tq + 9.0)) - 0.5) * 0.35 * gl;
          vec2 blk = floor(uv * vec2(24.0, 13.5)) / vec2(24.0, 13.5);
          float rk = hash21(blk * 91.7 + tq * 0.13);
          if (rk < gl * 0.22) uv = mix(uv, blk + vec2(0.02), 0.92);
          if (hash11(tq * 7.1) < gl * 0.35) uv.y = fract(uv.y + (hash11(tq * 3.3) - 0.5) * 0.25 * gl);
        }

        // chromatic aberration + zoom streaks
        vec2 dir = uv - 0.5;
        float ca = uChroma * (1.0 + 10.0 * gl) + 0.004 * under;
        vec3 col = vec3(0.0);
        if (uRadial > 0.001) {
          float wsum = 0.0;
          for (int i = 0; i < 10; i++) {
            float f = float(i) / 9.0;
            float s = 1.0 - uRadial * 0.16 * f;
            float w = 1.0 - f * 0.6;
            vec2 u2 = 0.5 + dir * s;
            col += vec3(fetch(u2 + dir * ca).r, fetch(u2).g, fetch(u2 - dir * ca).b) * w;
            wsum += w;
          }
          col /= wsum;
        } else {
          col = vec3(fetch(uv + dir * ca).r, fetch(uv).g, fetch(uv - dir * ca).b);
        }
        if (gl > 0.001) {
          float tq = floor(uTime * 24.0);
          col.r = mix(col.r, fetch(uv + vec2(0.03 * gl, 0.0)).r, 0.8);
          col.b = mix(col.b, fetch(uv - vec2(0.025 * gl, 0.0)).b, 0.8);
          float inv = step(hash11(tq * 5.7 + 2.0), gl * 0.10);
          col = mix(col, vec3(1.6) - col, inv * 0.8);
        }

        // underwater haze by distance
        float d = texture2D(tDepth, clamp(uv, 0.0015, 0.9985)).x;
        float ray = linDepth(d) * length(vp.xyz) / max(-vp.z, 1e-4);
        vec3 fogc = uUnderFog * uLight;
        float shaft = 0.85 + 0.3 * vnoise(vec2(uv.x * 9.0 + uTime * 0.2, uTime * 0.35));
        col = mix(col, mix(col * vec3(0.55, 0.9, 0.95), fogc * shaft, 1.0 - exp(-ray * uUnderDensity)), under);
        col = mix(col, col * 0.45 + vec3(0.10, 0.22, 0.22) * uLight, meniscus * 0.85);
        col += drop.z * vec3(0.9, 1.0, 1.0) * uLight * 0.6;

        // bloom
        vec3 bloom = texture2D(tBloom0, uv).rgb * 0.5 + texture2D(tBloom1, uv).rgb * 0.75 + texture2D(tBloom2, uv).rgb * 1.0;
        col += bloom * 0.05 * uBloom;

        // the hit on the water: white churn across the lens
        if (uSplash > 0.001) {
          vec2 sp = uv * vec2(aspect, 1.0);
          float n = vnoise(sp * 5.0 + vec2(0.0, uTime * 5.0)) * 0.5 + vnoise(sp * 13.0 - vec2(uTime * 3.0, uTime * 9.0)) * 0.3 + vnoise(sp * 37.0 + uTime * 13.0) * 0.2;
          float th = 1.05 - uSplash * 1.45;
          float k = smoothstep(th, th + 0.32, n);
          col = mix(col, vec3(1.25, 1.5, 1.5) * (0.55 + 0.9 * n) * uLight, k);
        }

        // exposure, filmic curve, grade
        col *= uExposure * uTint;
        col = aces(col);
        float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
        col = mix(vec3(lum), col, uSat);
        col = mix(col, col * vec3(0.94, 1.0, 0.99) + vec3(0.0, 0.006, 0.010), 0.6);   // cheap sensor cast
        col = pow(col, vec3(1.0 / 2.2));
        col = col * 0.965 + 0.012;                                                   // lifted blacks, clipped whites

        // vignette + sensor noise
        float vg = 1.0 - uVignette * pow(r2 / rMax, 1.25);
        col *= vg;
        vec2 gp = gl_FragCoord.xy + vec2(uFrame * 37.0, uFrame * 17.0);
        float n1 = hash21(gp) - 0.5;
        float n2 = hash21(gp * 1.37 + 71.0) - 0.5;
        float n3 = hash21(gp * 0.73 + 13.0) - 0.5;
        float gAmp = uGrain * (1.25 - 0.75 * lum);
        col += vec3(n1 + n2 * 0.35, n1 + n3 * 0.35, n1 - n2 * 0.35) * gAmp;

        col *= 1.0 - uFade;
        gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
      }`, this.finalU);
  }

  _fs(material, target) {
    this.quad.material = material;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.quadScene, this.ortho);
  }

  _sceneInto(scene, camera, target, hidden) {
    const r = this.renderer;
    r.setRenderTarget(target);
    r.setClearColor(0x000000, 1);
    r.clear(true, true, false);
    if (this.usePrepass) {
      for (const o of hidden) o.visible = false;
      scene.overrideMaterial = this.depthMat;
      r.render(scene, camera);
      scene.overrideMaterial = null;
      for (const o of hidden) o.visible = true;
    }
    r.render(scene, camera);
  }

  // `noPrepass`: objects that must not write the early depth (alpha, discard).
  render({ scene, water, camera, noPrepass = [], fx, time, frame, waterVisible = true }) {
    const r = this.renderer;
    r.autoClear = false;
    const prof = this.profile ? [] : null;
    const px = new Uint8Array(4);
    const mark = (name) => {
      if (!prof) return;
      const gl = r.getContext();
      r.setRenderTarget(null);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);   // forces the GPU process to catch up
      prof.push([name, performance.now()]);
    };
    mark('start');
    camera.updateMatrixWorld();
    this.uNear.value = camera.near;
    this.uFar.value = camera.far;
    const hidden = noPrepass.filter((o) => o.visible);

    // 1. opaque
    this._sceneInto(scene, camera, this.rtOpaque, hidden);

    mark('opaque');
    // 2. ambient occlusion
    let aoTex = this.white;
    if (this.useAO) {
      this.aoMat.uniforms.tDepth.value = this.rtOpaque.depthTexture;
      this.aoMat.uniforms.uProj.value.copy(camera.projectionMatrix);
      this.aoMat.uniforms.uProjInv.value.copy(camera.projectionMatrixInverse);
      this._fs(this.aoMat, this.rtAO);
      this.aoBlurMat.uniforms.tAO.value = this.rtAO.texture;
      this.aoBlurMat.uniforms.tDepth.value = this.rtOpaque.depthTexture;
      this._fs(this.aoBlurMat, this.rtAOb);
      aoTex = this.rtAOb.texture;
    }

    mark('ao');
    // 3. planar reflection (only useful from above the surface)
    const above = camera.position.y > WATER_Y + 0.005;
    const wu = water.uniforms;
    if (waterVisible) {
      updateReflectionCamera(camera, this.reflCam, !above);
      this._sceneInto(scene, this.reflCam, this.rtRefl, hidden);
      wu.uReflOn.value = 1;
    } else {
      wu.uReflOn.value = 0;
    }

    mark('reflection');
    // 4. opaque x AO + water
    this.copyMat.uniforms.tColor.value = this.rtOpaque.texture;
    this.copyMat.uniforms.tDepth.value = this.rtOpaque.depthTexture;
    this.copyMat.uniforms.tAO.value = aoTex;
    r.setRenderTarget(this.rtMain);
    r.clear(true, true, false);
    this._fs(this.copyMat, this.rtMain);
    if (waterVisible) {
      wu.tRefl.value = this.rtRefl.texture;
      wu.tScene.value = this.rtOpaque.texture;
      wu.tDepth.value = this.rtOpaque.depthTexture;
      wu.tAO.value = aoTex;
      wu.uRes.value.set(this.w, this.h);
      wu.uNear.value = camera.near;
      wu.uFar.value = camera.far;
      r.setRenderTarget(this.rtMain);
      r.render(water.scene, camera);
    }

    mark('water');
    // 5. bloom pyramid
    this.brightMat.uniforms.tColor.value = this.rtMain.texture;
    this._fs(this.brightMat, this.rtB[0][0]);
    for (let i = 0; i < this.rtB.length; i++) {
      const [a, b] = this.rtB[i];
      if (i > 0) {
        // downsample the previous level with a plain bilinear blit through the blur shader
        this.blurMat.uniforms.tColor.value = this.rtB[i - 1][0].texture;
        this.blurMat.uniforms.uDir.value.set(0, 0);
        this._fs(this.blurMat, a);
      }
      this.blurMat.uniforms.tColor.value = a.texture;
      this.blurMat.uniforms.uDir.value.set(1 / a.width, 0);
      this._fs(this.blurMat, b);
      this.blurMat.uniforms.tColor.value = b.texture;
      this.blurMat.uniforms.uDir.value.set(0, 1 / a.height);
      this._fs(this.blurMat, a);
    }

    mark('bloom');
    // 6. camera
    const u = this.finalU;
    u.tMain.value = this.rtMain.texture;
    u.tDepth.value = this.rtMain.depthTexture;
    u.tBloom0.value = this.rtB[0][0].texture;
    u.tBloom1.value = this.rtB[1][0].texture;
    u.tBloom2.value = this.rtB[2][0].texture;
    u.uTime.value = time;
    u.uFrame.value = frame;
    u.uProjInv.value.copy(camera.projectionMatrixInverse);
    u.uCamWorld.value.copy(camera.matrixWorld);
    u.uWaterOn.value = waterVisible ? 1 : 0;
    for (const k in fx) if (u[k] !== undefined) {
      if (u[k].value && u[k].value.isColor) u[k].value.copy(fx[k]);
      else u[k].value = fx[k];
    }
    this._fs(this.finalMat, null);
    mark('final');
    if (prof) this.lastProfile = prof.slice(1).map(([n, t], i) => `${n} ${(t - prof[i][1]).toFixed(0)}`).join('  ');
  }
}
