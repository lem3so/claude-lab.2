// BACKROOMS — WHAT IF YOU FELL INTO THE POOL ROOMS?
// Scene assembly + deterministic frame API used by the capture script.
import * as THREE from 'three';
import { WIDTH, HEIGHT, FPS, DURATION, TOTAL_FRAMES, WATER_Y, CORRIDOR_Y, SPLASH } from './config.js';
import { poolLight, poolLightGroup, corridorLight } from './shared/flicker.js';
import { makeTileTextures, makeWaterDetailNormal, makeCausticTexture, makeCorridorTextures, makePlainTextures } from './scene/textures.js';
import { createWorldUniforms, createSurfaceMaterial } from './scene/materials.js';
import { buildPoolRooms, buildLadder } from './scene/poolrooms.js';
import { buildCorridor } from './scene/corridor.js';
import { createWater } from './scene/water.js';
import { buildEntities } from './scene/entity.js';
import { buildVoidStreaks, buildBubbles, buildSpray } from './scene/particles.js';
import { Pipeline } from './post/pipeline.js';
import { createTimeline, applyCamera, FIGURE_A, FIGURE_B, SHADOW_PATH } from './timeline.js';

const params = new URLSearchParams(location.search);
const W = +(params.get('w') || WIDTH);
const H = +(params.get('h') || HEIGHT);
const CAPTURE = params.has('capture');
const SHADOW_SIZE = +(params.get('shadow') || 8192);
const DBG_CAM = params.has('dbgcam') ? params.get('dbgcam').split(',').map(Number) : null;
const WORLD_SWITCH = 3.38;   // the moment the corridor is gone for good

const canvas = document.getElementById('view');
canvas.width = W;
canvas.height = H;

const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(W, H, false);
renderer.toneMapping = THREE.NoToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = { basic: THREE.BasicShadowMap, pcf: THREE.PCFShadowMap, soft: THREE.PCFSoftShadowMap, vsm: THREE.VSMShadowMap }[params.get('shadowtype') || 'pcf'];
renderer.info.autoReset = true;

const scene = new THREE.Scene();
scene.background = null;
const camera = new THREE.PerspectiveCamera(66, W / H, 0.05, 220);
camera.rotation.order = 'YXZ';

// ------------------------------------------------------------------ assets
const aniso = Math.min(+(params.get('aniso') || 4), renderer.capabilities.getMaxAnisotropy());
const tile = makeTileTextures({ aniso });
const caustic = makeCausticTexture();
const detail = makeWaterDetailNormal();
// the corridor is seen at very shallow angles: give its fine-grained maps the full anisotropy
const corridorTex = makeCorridorTextures({ aniso: Math.min(16, renderer.capabilities.getMaxAnisotropy()) });
const plain = makePlainTextures();

const POOL_AMB_SKY = new THREE.Color(0.20, 0.25, 0.26);
const POOL_AMB_GROUND = new THREE.Color(0.085, 0.16, 0.16);
const POOL_FOG = new THREE.Color(0.40, 0.53, 0.55);
const poolWorld = createWorldUniforms({ ambSky: POOL_AMB_SKY, ambGround: POOL_AMB_GROUND, fogColor: POOL_FOG, fogDensity: 0.018, dirMask: 1 });
poolWorld.tCaustic.value = caustic;
poolWorld.uZoneDim.value.set(-3.5, -9.5, 0.42);   // the deep hall is the dark end of the complex
const corrWorld = createWorldUniforms({
  ambSky: new THREE.Color(0.075, 0.066, 0.048), ambGround: new THREE.Color(0.03, 0.026, 0.02),
  fogColor: new THREE.Color(0.004, 0.004, 0.003), fogDensity: 0.05, dirMask: 0,
});
corrWorld.tCaustic.value = caustic;
corrWorld.uHolePos.value.set(SPLASH.x, CORRIDOR_Y, SPLASH.z);

const tileFlat = createSurfaceMaterial({ maps: tile, world: poolWorld, pool: true, envIntensity: 1 });
const tileCurved = createSurfaceMaterial({ maps: tile, world: poolWorld, pool: true, curved: true, envIntensity: 1 });

// ------------------------------------------------------------------- world
const pool = buildPoolRooms({ tileFlat, tileCurved, world: poolWorld, shadowMapSize: SHADOW_SIZE });
scene.add(pool.group);
const ladder = buildLadder();
scene.add(ladder);

const corridor = buildCorridor({ textures: corridorTex, plain, world: corrWorld });
scene.add(corridor.group);

const water = createWater({ detailNormal: detail });
const entities = buildEntities();
scene.add(entities.group);
const streaks = buildVoidStreaks();
const bubbles = buildBubbles();
const spray = buildSpray();
scene.add(streaks.mesh, bubbles.mesh, spray.mesh);
bubbles.mat.uniforms.uScale.value = H;
spray.mat.uniforms.uScale.value = H;

const noPrepass = [corridor.floorMesh, streaks.mesh, bubbles.mesh, spray.mesh, entities.shadow];

const shadowCurve = new THREE.CatmullRomCurve3(SHADOW_PATH.map((p) => new THREE.Vector3(...p)), false, 'catmullrom', 0.5);

// ---------------------------------------------------------------- timeline
const { tl, state } = createTimeline();

// ring waves made by the body: sampled from the camera path itself
{
  const at = (t) => { tl.time(t); return [state.x, state.z]; };
  water.addRipple(SPLASH.x, SPLASH.z, 4.0, 0.07);
  water.addRipple(SPLASH.x + 0.2, SPLASH.z - 0.1, 4.18, 0.035);
  water.addRipple(...at(5.2), 5.2, 0.03);
  for (let t = 5.8; t < 9.0; t += 0.62) water.addRipple(...at(t), t, 0.008);
  let side = 1;
  for (let t = 9.25; t < 13.9; t += 0.43) { const [x, z] = at(t); water.addRipple(x + side * 0.16, z, t, 0.013); side = -side; }
  for (let t = 14.4; t < 17.0; t += 0.9) water.addRipple(...at(t), t, 0.003);
  for (const u of [0.42, 0.6]) { const p = shadowCurve.getPoint(u); water.addRipple(p.x, p.z, 14.15 + u * 2.6, 0.006); }
  water.addRipple(FIGURE_A.x, FIGURE_A.z, 17.3, 0.012);
  for (const t of [17.6, 17.85, 18.2, 18.45, 18.7, 18.9]) water.addRipple(...at(t), t, 0.03);
  for (const [t, a] of [[18.14, 0.06], [18.38, 0.045], [18.6, 0.05], [18.82, 0.055]]) water.addRipple(FIGURE_B.x + (a - 0.05) * 20, FIGURE_B.z + 0.4, t, a);
  tl.time(0);
}

entities.figureA.position.set(FIGURE_A.x, FIGURE_A.y, FIGURE_A.z);
entities.figureA.rotation.y = FIGURE_A.rotY;
entities.figureB.position.set(FIGURE_B.x, FIGURE_B.y, FIGURE_B.z);
entities.figureB.rotation.y = FIGURE_B.rotY;
entities.figureB.rotation.x = 0.16;

// ------------------------------------------------- image based lighting
const pipeline = new Pipeline(renderer, W, H, { prepass: params.has('prepass'), ao: !params.has('noao'), msaa: +(params.get('msaa') ?? 4) });
const ENV_INTENSITY = 0.42;
let poolEnv = null;
{
  const pmrem = new THREE.PMREMGenerator(renderer);
  const cubeRT = new THREE.WebGLCubeRenderTarget(256, { type: THREE.HalfFloatType, generateMipmaps: false });
  const cube = new THREE.CubeCamera(0.1, 180, cubeRT);

  // pools: probe in the arrival hall, with a stand-in for the water surface
  const proxy = new THREE.Mesh(new THREE.PlaneGeometry(130, 140).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.10, 0.36, 0.38) }));
  proxy.position.set(0, WATER_Y, -12);
  scene.add(proxy);
  corridor.group.visible = false;
  pool.update([1, 1, 1]);
  cube.position.set(0, 1.7, 8.5);
  cube.update(renderer, scene);
  poolEnv = pmrem.fromCubemap(cubeRT.texture).texture;
  scene.remove(proxy);

  // corridor: its own probe so the carpet does not reflect a swimming pool
  corridor.group.visible = true;
  corridor.update([1, 1]);
  cube.position.set(0, CORRIDOR_Y + 1.5, 10);
  cube.update(renderer, scene);
  const corrEnv = pmrem.fromCubemap(cubeRT.texture).texture;
  corridor.group.traverse((o) => {
    if (o.isMesh && o.material.isMeshStandardMaterial) { o.material.envMap = corrEnv; o.material.needsUpdate = true; }
  });
  scene.environment = poolEnv;
  cubeRT.dispose();
  pmrem.dispose();
  // the set never moves: the key light's shadow map is rendered exactly once
  renderer.shadowMap.autoUpdate = false;
  renderer.setRenderTarget(null);
}

// ------------------------------------------------------------------ frame
const tmp = new THREE.Vector3();
const fx = { uTint: new THREE.Color(1, 1, 1) };

function renderAt(t, frame) {
  tl.time(Math.min(t, DURATION - 1e-4), false);
  const s = state;
  applyCamera(s, t, camera);

  if (DBG_CAM) {
    // look-development override: ?dbgcam=x,y,z,pitch,yaw[,fov]
    camera.position.set(DBG_CAM[0], DBG_CAM[1], DBG_CAM[2]);
    camera.rotation.set(DBG_CAM[3], DBG_CAM[4], 0, 'YXZ');
    if (DBG_CAM[5]) { camera.fov = DBG_CAM[5]; camera.updateProjectionMatrix(); }
    camera.updateMatrixWorld(true);
  }

  // lights
  const L = poolLight(t);
  const amb = Math.max(L, 0.03);
  const groups = [poolLightGroup(t, 0), poolLightGroup(t, 1), poolLightGroup(t, 2)];
  pool.update(groups);
  poolWorld.uTime.value = t;
  poolWorld.uAmbScale.value = params.has('dbgnoamb') ? 0 : amb;
  poolWorld.uFogColor.value.copy(POOL_FOG).multiplyScalar(amb);
  scene.environmentIntensity = params.has('dbgnoamb') ? 0 : ENV_INTENSITY * amb;

  const cl = [corridorLight(t, 0), corridorLight(t, 1)];
  corridor.update(cl);
  corrWorld.uTime.value = t;
  corrWorld.uAmbScale.value = 0.3 + 0.7 * (cl[0] * 0.6 + cl[1] * 0.4);
  corrWorld.uFloorGlitch.value = s.floorGlitch;

  const corridorPhase = t < WORLD_SWITCH;
  corridor.group.visible = corridorPhase;
  for (const l of pool.pointLights) l.visible = !corridorPhase && !params.has('nopoints');

  // water
  water.update(t);
  const wu = water.uniforms;
  wu.uLight.value = amb;
  wu.uAgit.value = s.agit;
  wu.uAgitPos.value.set(s.agitX, s.agitZ);
  wu.uAgitRad.value = s.agitRad;
  wu.uSplashFoam.value = s.splashFoam;
  wu.uSplashPos.value.set(SPLASH.x, SPLASH.z);
  wu.uFogColor.value.copy(poolWorld.uFogColor.value);
  wu.uFogDensity.value = poolWorld.uFogDensity.value;

  // things in the water
  entities.figureA.visible = s.figure > 0.5 && s.figure < 1.5;
  entities.figureB.visible = s.figure >= 1.5;
  if (entities.figureA.visible) {
    const k = s.figRise;
    entities.figureA.position.set(FIGURE_A.x - 0.1 * k, FIGURE_A.y + 0.75 * k, FIGURE_A.z + 0.55 * k);
    entities.figureA.rotation.x = 0.1 * k;
  }
  if (entities.figureB.visible) {
    const k = Math.min(Math.max((t - 18.14) / 0.8, 0), 1);
    entities.figureB.position.set(FIGURE_B.x + 0.02 * Math.sin(t * 9), FIGURE_B.y + 0.26 * k + 0.025 * Math.sin(t * 13), FIGURE_B.z + 0.3 * k);
  }
  entities.shadow.visible = s.shadowOpacity > 0.002;
  poolWorld.uShadowK.value = s.shadowOpacity;
  if (entities.shadow.visible) {
    const u = Math.min(Math.max(s.shadowU, 0), 0.999);
    shadowCurve.getPoint(u, entities.shadow.position);
    shadowCurve.getPoint(Math.min(u + 0.01, 1), tmp);
    entities.shadow.lookAt(tmp);
    shadowCurve.getPoint(Math.min(u + 0.035, 1), poolWorld.uShadowA.value);
    shadowCurve.getPoint(Math.max(u - 0.03, 0), poolWorld.uShadowB.value);
    shadowCurve.getPoint(Math.max(u - 0.1, 0), poolWorld.uShadowC.value);
    entities.shadowMat.uniforms.uTime.value = t;
    entities.shadowMat.uniforms.uOpacity.value = s.shadowOpacity;
  }

  // particles
  streaks.mesh.visible = s.streaks > 0.002;
  streaks.mat.uniforms.uAmount.value = s.streaks;
  bubbles.mesh.visible = t >= 4.0 && t < 7.5;
  bubbles.mat.uniforms.uTau.value = t - 4.0;
  bubbles.mat.uniforms.uLight.value = amb;
  spray.mesh.visible = t >= 18.14 && t < 19.0;
  spray.mat.uniforms.uTau.value = t - 18.14;
  spray.mat.uniforms.uOrigin.value.set(FIGURE_B.x, 0, FIGURE_B.z + 0.45);
  spray.mat.uniforms.uLight.value = amb;

  fx.uGlitch = s.glitch;
  fx.uChroma = s.chroma;
  fx.uRadial = s.radial;
  fx.uExposure = s.exposure;
  fx.uGrain = s.grain;
  fx.uFade = s.fade;
  fx.uSplash = s.splash;
  fx.uDroplets = s.droplets;
  fx.uLight = amb;
  // the corridor is lit by old warm tubes; the pools read cooler
  fx.uTint.setRGB(1, 1, 1);

  pipeline.render({ scene, water, camera, noPrepass, fx, time: t, frame, waterVisible: true });
}

// ----------------------------------------------------------- capture API
window.__info = { width: W, height: H, fps: FPS, frames: TOTAL_FRAMES, duration: DURATION };
window.__renderFrame = (i, mime = 'image/jpeg', quality = 0.95) => {
  renderAt(i / FPS, i);
  return canvas.toDataURL(mime, quality);
};
window.__profile = (i) => {
  pipeline.profile = true;
  renderAt(i / FPS, i);
  pipeline.profile = false;
  return pipeline.lastProfile;
};

// warm-up: compiles every shader variant and renders the shadow map
renderAt(0, 0);
window.__ready = true;

// ------------------------------------------------------ real-time preview
if (!CAPTURE) {
  const audio = new Audio('build/audio.wav');
  audio.loop = true;
  let t0 = performance.now();
  let playing = true;
  const hud = document.getElementById('hint');
  const start = () => { audio.currentTime = ((performance.now() - t0) / 1000) % DURATION; audio.play().catch(() => {}); if (hud) hud.remove(); };
  window.addEventListener('pointerdown', start, { once: true });
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') { playing = !playing; if (playing) { t0 = performance.now() - last * 1000; audio.play().catch(() => {}); } else audio.pause(); }
  });
  let last = 0;
  const loop = () => {
    if (playing) {
      last = ((performance.now() - t0) / 1000) % DURATION;
      renderAt(last, Math.floor(last * FPS));
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}
