// The 20 second cut, authored as one paused GSAP timeline.
//
// Every animated quantity (camera position / orientation / lens, effects,
// creature motion) is a property of the plain `state` object, driven by GSAP
// tweens. The renderer seeks the timeline to an exact time for each frame, so
// playback is frame-accurate and any frame can be rendered independently.
//
//   0.0 -  4.0   THE NOCLIP        ordinary corridor, the floor fails, the fall
//   4.0 -  8.0   THE ARRIVAL       impact, one second under water, surfacing
//   8.0 - 13.0   THE EXPLORATION   steps, flooded corridor, side pools
//  13.0 - 17.0   SOMETHING IS OFF  flicker, the shadow, staring into the deep
//  17.0 - 20.0   THE END           the figure, panic, hard cut to black at 19.0
import gsapModule from 'gsap';
import { CORRIDOR_Y, EYE, SPLASH, CUT_TO_BLACK } from './config.js';
import { fbm1, smoothstep } from './shared/math.js';

// the browser gets the ES module build, Node (audio tooling) the UMD build
const gsap = gsapModule.gsap || gsapModule.default || gsapModule;

const FLOAT_Y = 0.42;         // eye height while swimming (neck deep)

// Constant-speed move with soft acceleration / braking (fraction `a` each).
const cruise = (a) => (u) => {
  const v = 1 / (1 - a);
  if (u < a) return (v * u * u) / (2 * a);
  if (u > 1 - a) return 1 - (v * (1 - u) * (1 - u)) / (2 * a);
  return v * (u - a / 2);
};

// keys: [time, value, ease] — the ease shapes the move that ARRIVES at the key.
function track(tl, s, prop, keys, defEase = 'sine.inOut') {
  s[prop] = keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const [t0, v0] = keys[i - 1];
    const [t1, v1, ease = defEase] = keys[i];
    if (t1 - t0 < 1e-5) tl.set(s, { [prop]: v1 }, t1);
    else tl.fromTo(s, { [prop]: v0 }, { [prop]: v1, duration: t1 - t0, ease, immediateRender: false }, t0);
  }
}

export const FIGURE_A = { x: 0.45, y: -4.2, z: -10.3, rotY: 0.12 };
export const FIGURE_B = { x: 0.12, y: -1.66, z: -9.0, rotY: 0.03 };

// Path of the shadow under the surface of the deep hall.
export const SHADOW_PATH = [
  [-11.5, -6.5, -19.5], [-7.0, -3.6, -15.0], [-2.2, -2.7, -11.4], [2.8, -2.75, -10.0], [7.0, -4.0, -12.0], [9.5, -8.5, -17.5],
];

export function createTimeline() {
  const s = {};
  const tl = gsap.timeline({ paused: true, defaults: { overwrite: false } });
  const T = (prop, keys, ease) => track(tl, s, prop, keys, ease);
  const CY = CORRIDOR_Y + EYE;

  tl.addLabel('noclip', 0).addLabel('arrival', 4).addLabel('exploration', 8).addLabel('wrong', 13).addLabel('end', 17);

  // ------------------------------------------------------------- position
  T('z', [
    [0, 12.35], [2.45, 8.95, 'none'], [2.9, SPLASH.z, 'power2.out'],
    [4.0, SPLASH.z], [5.2, 8.3, 'sine.out'], [6.6, 8.0, 'sine.inOut'],
    [13.9, -7.0, cruise(0.22)],
    [16.0, -7.0], [16.9, -7.14, 'sine.inOut'], [17.5, -7.14],
    [18.0, -6.6, 'power3.out'], [18.14, -6.5, 'none'], [CUT_TO_BLACK, -4.1, 'power2.out'], [20, -4.1],
  ]);
  T('x', [
    [0, -0.05], [1.4, 0.08], [2.9, SPLASH.x], [4.0, SPLASH.x], [5.2, 0.12, 'sine.out'], [6.6, 0.0],
    [9.4, 0.0], [10.7, 0.22], [11.9, -0.2], [13.9, 0.0],
    [17.45, 0.0], [18.0, -0.1, 'power3.out'], [18.14, -0.1], [CUT_TO_BLACK, 0.4, 'power2.out'], [20, 0.4],
  ]);
  T('y', [
    [0, CY], [2.8, CY], [2.9, CY - 0.1, 'power2.in'],
    [4.0, 0.0, 'power1.in'],                       // the fall
    [4.55, -1.75, 'power2.out'],                    // plunge
    [5.2, -0.07, 'sine.inOut'],                     // float back up
    [6.4, FLOAT_Y, 'sine.out'],                     // surface, slowly
    [16.0, FLOAT_Y], [16.9, FLOAT_Y - 0.07], [17.45, FLOAT_Y - 0.07],
    [18.0, FLOAT_Y + 0.02, 'power3.out'], [18.14, FLOAT_Y + 0.02], [CUT_TO_BLACK, FLOAT_Y + 0.1, 'power2.out'], [20, FLOAT_Y + 0.1],
  ]);

  // ---------------------------------------------------------- orientation
  // yaw > 0 turns left, pitch > 0 looks up (radians)
  T('yaw', [
    [0, 0.02], [0.9, 0.0], [1.5, -0.34], [2.15, 0.02], [2.9, 0.0],
    [4.0, 1.2, 'power1.in'], [5.2, 1.5, 'sine.out'], [6.1, 1.42], [8.6, 0.0],
    [10.0, 0.0], [10.55, -0.74], [10.85, -0.72], [11.42, 0.8], [11.72, 0.78], [12.5, 0.0],
    [13.3, 0.0], [13.9, -0.26], [14.35, -0.22], [15.0, 0.5], [16.3, -0.24], [16.9, 0.04],
    [17.45, 0.04], [18.0, 0.07, 'power3.out'], [18.14, 0.05], [CUT_TO_BLACK, -0.16, 'power2.out'], [20, -0.16],
  ]);
  T('pitch', [
    [0, -0.04], [2.2, -0.05], [2.55, -0.6], [2.9, -0.98, 'sine.in'],
    [3.14, 0.8, 'power2.out'], [3.3, 0.72], [3.64, -1.3], [4.0, -1.18],
    [4.5, -0.25, 'sine.out'], [5.0, 0.8], [5.65, 0.1], [6.5, 0.2], [8.3, 0.04], [9.2, -0.1], [10.0, 0.0],
    [12.5, 0.02], [13.2, 0.0], [13.9, 0.42], [14.4, 0.38], [15.0, -0.44], [16.3, -0.54], [16.9, -0.72],
    [17.26, -0.72], [17.55, -0.86, 'power2.out'], [18.0, -0.8], [18.14, -0.62, 'none'], [18.6, -0.44, 'power2.out'], [CUT_TO_BLACK, -0.2, 'power1.in'], [20, -0.2],
  ]);
  T('roll', [
    [0, 0], [2.9, 0], [3.3, 0.5], [3.7, -0.36], [4.0, 0.22], [4.6, -0.12, 'sine.out'], [5.5, 0.0],
    [17.45, 0], [17.8, 0.05], [18.5, -0.1], [CUT_TO_BLACK, 0.13], [20, 0.13],
  ]);
  T('fov', [
    [0, 66], [2.9, 66], [3.9, 92, 'power1.in'], [4.0, 92], [4.3, 70, 'power2.out'], [5.2, 70], [8.0, 66],
    [16.0, 66], [16.9, 57], [17.26, 57], [17.56, 45, 'power2.out'], [18.0, 45], [18.14, 62, 'none'], [18.34, 70, 'power3.out'], [CUT_TO_BLACK, 74], [20, 74],
  ]);

  // ------------------------------------------------------------ body feel
  T('shake', [
    [0, 0.6], [2.2, 0.6], [2.9, 1.6], [3.5, 3.0], [4.0, 3.2], [4.3, 1.3], [5.2, 0.8], [8.0, 0.5], [13.9, 0.45],
    [16.9, 0.22], [17.4, 0.22], [17.52, 2.8, 'power3.out'], [18.0, 1.7], [18.14, 4.2, 'none'], [CUT_TO_BLACK, 4.8], [20, 0],
  ], 'none');
  T('walk', [[0, 1], [2.5, 1], [2.86, 0], [20, 0]], 'none');
  T('swim', [[0, 0], [5.2, 0], [5.6, 1], [9.0, 1], [9.9, 0], [20, 0]], 'none');
  T('wade', [[0, 0], [9.2, 0], [9.9, 1], [13.3, 1], [13.95, 0], [17.5, 0], [17.7, 0.6], [20, 0.6]], 'none');

  // -------------------------------------------------------------- effects
  T('glitch', [
    [0, 0.5], [0.12, 0], [2.18, 0], [2.2, 0.5], [2.28, 0], [2.44, 0], [2.46, 0.7], [2.56, 0.1], [2.7, 0.15],
    [2.74, 0.6], [2.84, 0.25], [2.9, 0.75], [3.05, 0.45], [3.2, 0.22], [3.36, 0.22], [3.38, 1.0], [3.46, 0.28],
    [3.8, 0.18], [3.96, 0.85], [4.02, 0], [13.04, 0], [13.06, 0.25], [13.12, 0], [16.9, 0], [16.93, 0.35], [17.0, 0],
    [17.2, 0], [17.22, 0.4], [17.3, 0], [18.0, 0], [18.02, 0.4], [18.14, 0.22], [18.2, 0], [18.62, 0], [18.64, 0.4],
    [18.7, 0], [18.9, 0], [18.93, 0.7], [CUT_TO_BLACK, 1.0], [20, 0],
  ], 'none');
  T('floorGlitch', [[0, 0], [2.2, 0], [2.62, 0.4, 'power1.in'], [2.9, 1.0, 'power2.in'], [3.3, 1.6], [20, 1.6]], 'none');
  T('chroma', [[0, 0.0016], [2.9, 0.0016], [3.5, 0.007], [4.0, 0.007], [5.3, 0.0035], [6.5, 0.0016], [17.4, 0.0016], [17.6, 0.004], [CUT_TO_BLACK, 0.006], [20, 0]], 'none');
  T('radial', [[0, 0], [2.9, 0], [3.4, 0.7], [3.95, 1.0], [4.06, 0], [18.14, 0], [18.3, 0.12], [CUT_TO_BLACK, 0.3], [20, 0]], 'none');
  T('exposure', [
    [0, 1.0], [2.9, 1.0], [3.5, 1.35], [3.86, 1.35], [4.0, 1.3], [4.7, 0.95, 'power2.out'], [6.0, 1.0],
    [15.0, 1.0], [16.6, 1.15], [17.3, 1.2], [20, 1.2],
  ]);
  T('grain', [[0, 0.055], [3.0, 0.055], [3.5, 0.075], [4.6, 0.038], [15.0, 0.038], [16.6, 0.062], [20, 0.07]], 'none');
  T('splash', [[0, 0], [3.985, 0], [4.0, 1.0], [4.5, 0, 'power2.out'], [20, 0]], 'none');
  T('droplets', [[0, 0], [5.25, 0], [5.4, 1.0], [7.6, 0.8], [10.8, 0.0], [20, 0]], 'none');
  T('streaks', [[0, 0], [2.9, 0], [3.15, 1], [3.9, 1], [4.0, 0], [20, 0]], 'none');
  T('splashFoam', [[0, 0], [3.99, 0], [4.0, 1], [8.6, 0, 'power1.out'], [20, 0]], 'none');
  T('fade', [[0, 1], [0.1, 0, 'none'], [CUT_TO_BLACK - 1e-4, 0], [CUT_TO_BLACK, 1], [20, 1]], 'none');

  // ------------------------------------------------------------ the water
  T('agit', [[0, 0], [17.4, 0], [18.0, 0.45], [18.08, 0.45], [18.14, 1.3], [CUT_TO_BLACK, 1.9], [20, 1.9]], 'none');
  T('agitRad', [[0, 5.5], [18.08, 5.5], [18.14, 2.1], [20, 2.4]], 'none');
  T('agitX', [[0, FIGURE_A.x], [18.08, FIGURE_A.x], [18.14, FIGURE_B.x], [20, FIGURE_B.x]], 'none');
  T('agitZ', [[0, FIGURE_A.z + 1.2], [18.08, FIGURE_A.z + 1.2], [18.14, FIGURE_B.z + 0.35], [20, FIGURE_B.z + 0.35]], 'none');
  // it starts to drift up towards the lens before the lights die again
  T('figRise', [[0, 0], [17.62, 0], [18.04, 1, 'power1.in'], [20, 1]], 'none');

  // ---------------------------------------------------------- the visitor
  T('shadowU', [[0, 0], [14.15, 0], [16.75, 1, 'sine.inOut'], [20, 1]], 'none');
  T('shadowOpacity', [[0, 0], [14.15, 0], [14.7, 0.96], [16.25, 0.96], [16.75, 0], [20, 0]], 'none');
  T('figure', [[0, 0], [17.2, 0], [17.22, 1], [18.02, 1], [18.14, 2], [20, 2]], 'none');   // 0 none, 1 = A (far), 2 = B (close)

  tl.set({}, {}, 20);
  return { tl, state: s };
}

// Height the walker's eyes gain while climbing the submerged steps.
const terrainLift = (z) => 0.8 * smoothstep(4.4, 2.5, z);

// Turns the timeline state into the final camera pose: adds foot steps, the
// sway of wading, treading water, breathing and hand-held jitter.
export function applyCamera(s, t, camera) {
  let x = s.x, y = s.y, z = s.z;
  let yaw = s.yaw, pitch = s.pitch, roll = s.roll;

  if (t >= 4.0) y += terrainLift(z);

  // walking on carpet: phase follows the distance covered
  if (s.walk > 0.001) {
    const ph = ((12.35 - z) / 0.74) * Math.PI;
    y += s.walk * 0.03 * Math.sin(ph * 2);
    x += s.walk * 0.02 * Math.sin(ph);
    roll += s.walk * 0.007 * Math.sin(ph);
    pitch += s.walk * 0.006 * Math.sin(ph * 2 + 0.6);
  }
  // wading through knee-deep water: slower, wider
  if (s.wade > 0.001) {
    const ph = ((8.0 - z) / 0.66) * Math.PI;
    y += s.wade * 0.024 * Math.sin(ph * 2);
    x += s.wade * 0.038 * Math.sin(ph);
    roll += s.wade * 0.012 * Math.sin(ph);
    pitch += s.wade * 0.008 * Math.sin(ph * 2 + 0.4);
  }
  // treading water
  if (s.swim > 0.001) {
    y += s.swim * (0.028 * Math.sin(t * 4.6) + 0.012 * Math.sin(t * 2.3 + 1.0));
    roll += s.swim * 0.014 * Math.sin(t * 2.3);
    x += s.swim * 0.02 * Math.sin(t * 1.9);
  }
  // breathing
  pitch += 0.0035 * Math.sin((t * Math.PI * 2) / 3.1);

  // hand-held noise: slow drift plus a fast tremor that grows with fear
  const k = s.shake;
  const fast = Math.max(0, k - 1);
  yaw += k * 0.011 * fbm1(t * 1.3, 1) + fast * 0.012 * fbm1(t * 11.0, 4, 2);
  pitch += k * 0.009 * fbm1(t * 1.6, 2) + fast * 0.011 * fbm1(t * 12.5, 5, 2);
  roll += k * 0.007 * fbm1(t * 1.1, 3) + fast * 0.016 * fbm1(t * 9.0, 6, 2);
  x += k * 0.006 * fbm1(t * 1.9, 7) + fast * 0.012 * fbm1(t * 10.0, 8, 2);
  y += k * 0.005 * fbm1(t * 2.1, 9) + fast * 0.012 * fbm1(t * 13.0, 10, 2);

  camera.position.set(x, y, z);
  camera.rotation.set(pitch, yaw, roll, 'YXZ');
  if (Math.abs(camera.fov - s.fov) > 1e-4) {
    camera.fov = s.fov;
    camera.updateProjectionMatrix();
  }
  camera.updateMatrixWorld(true);
}
