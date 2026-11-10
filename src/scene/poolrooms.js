// The Pool Rooms.
//
// Hand-authored hero set (arrival hall, flooded corridor, two side pools, an
// upper gallery and the deep hall with its abyss) surrounded by a procedural
// far field of repeating bays that fades into haze in every direction.
//
// Plan (x right, camera travels towards -z). Water surface at y = 0.
//
//            z = 18  +----------- back wall -----------+
//                    |        ARRIVAL HALL  H1          |   ceiling 7.5 m
//                    |   pool -2.4 m, light well above  |   splash at (0, 8.5)
//                    |        steps up to the shelf     |
//            z =  2  +--arch--arch--[ARCH]--arch--arch--+   arcade + portholes
//                    |  POOL L   | CORRIDOR |  POOL R   |   ceiling 5 m, gallery above
//            z = -6  +---arch----+--[ARCH]--+----arch---+
//                    |  ledge -0.4 (the camera stops)   |
//            z = -8  |..................................|
//                    |  terrace -4.2   (it stands here) |   DEEP HALL  D
//            z = -13 |..................................|   ceiling 9.5 m
//                    |  abyss -12.5, stairs to nowhere  |
//            z = -24 +------arch-----arch-----arch------+
import * as THREE from 'three';
import { Builder, wall, vault, roundColumn } from './builder.js';
import { createEmissiveMaterial } from './materials.js';
import { mulberry32 } from '../shared/math.js';

export const KEY_LIGHT_DIR = new THREE.Vector3(0.25, -1, -1.0).normalize();

const FAR = { x0: -54, x1: 54, z0: -72, z1: 48, cell: 6, floor: -1.6, ceil: 7.5 };
const MAIN = { x0: -12, x1: 12, z0: -24, z1: 18 };

const arch = (c, w, base, spring) => ({ type: 'arch', c, w, base, spring });
const round = (c, y, r) => ({ type: 'round', c, y, r });

export function buildPoolRooms({ tileFlat, tileCurved, world, shadowMapSize = 8192 }) {
  const group = new THREE.Group();
  group.name = 'poolrooms';

  const flat = new Builder();
  const curved = new Builder();
  const pan = [new Builder(), new Builder(), new Builder(), new Builder()];
  const panel = (g, x0, z0, x1, z1, y) => pan[g].ceil(x0, z0, x1, z1, y);
  const W = (o) => wall(flat, curved, o);

  // ------------------------------------------------------------------ H1
  flat.floor(-12, 2.6, 12, 18, -2.4);
  flat.box(-12, -2.4, 1.5, 12, -0.4, 2.6, 'ny nx px');
  flat.stairs({ dir: '+z', start: 2.6, a0: -3.4, a1: 3.4, top: -0.4, bottom: -2.4, rise: 0.25, run: 0.3, count: 7, skip: 'ny nz' });
  W({
    axis: 'x', at: 1.75, s0: -12, s1: 12, y0: -0.4, y1: 7.5, caps: false,
    openings: [
      arch(0, 3.4, -0.4, 2.6), arch(-4.8, 3.4, -0.4, 2.6), arch(4.8, 3.4, -0.4, 2.6),
      arch(-9.6, 3.4, -0.4, 2.6), arch(9.6, 3.4, -0.4, 2.6),
      round(0, 6.0, 0.75), round(-4.8, 6.0, 0.75), round(4.8, 6.0, 0.75), round(-9.6, 6.0, 0.75), round(9.6, 6.0, 0.75),
    ],
  });
  for (const x of [-5.2, 5.2]) for (const z of [6.2, 13.8]) flat.box(x - 0.45, -2.4, z - 0.45, x + 0.45, 7.5, z + 0.45, 'ny py');
  flat.ceilWithHole(-12, 2, 12, 18, 7.5, -3.5, 5, 3.5, 12);
  flat.shaft(-3.5, 5, 3.5, 12, 7.5, 11);
  panel(0, -3.5, 5, 3.5, 12, 11);
  panel(1, -8.6, 5.2, -7.4, 7.6, 7.47);
  panel(1, 7.4, 5.2, 8.6, 7.6, 7.47);
  panel(1, -8.6, 13.0, -7.4, 15.4, 7.47);
  panel(1, 7.4, 13.0, 8.6, 15.4, 7.47);
  panel(1, -1.3, 14.6, 1.3, 15.8, 7.47);
  // raised deck with steps into the pool
  flat.box(-12, -2.4, 11, -8.5, 0.3, 18, 'ny nx pz');
  flat.stairs({ dir: '+x', start: -8.5, a0: 12.5, a1: 15.5, top: 0.3, bottom: -2.4, rise: 0.25, run: 0.35, count: 4, skip: 'ny nx' });
  // back wall
  W({
    axis: 'x', at: 18.25, s0: -12.5, s1: 12.5, y0: -2.4, y1: 9.5, caps: false,
    openings: [arch(0, 3.4, -1.0, 3.2), arch(-7.5, 3.4, -1.0, 3.2), arch(7.5, 3.4, -1.0, 3.2), round(-3.75, 6.1, 0.7), round(3.75, 6.1, 0.7)],
  });

  // ------------------------------------------------------------ side walls
  for (const sx of [-1, 1]) {
    W({
      axis: 'z', at: sx * 12.25, s0: -24.5, s1: 18.5, y0: -2.4, y1: 9.5, caps: false,
      openings: [
        arch(-17, 3.2, -0.4, 2.6), arch(-11, 3.2, -0.4, 2.6),
        arch(-3.7, 2.4, -1.0, 1.8), arch(-0.3, 2.4, -1.0, 1.8),
        arch(6, 3.0, -1.0, 3.2), arch(10, 3.0, -1.0, 3.2), arch(14, 3.0, -1.0, 3.2),
        round(4, 6.1, 0.7), round(8, 6.1, 0.7), round(12, 6.1, 0.7), round(16, 6.1, 0.7),
      ],
    });
  }

  // ------------------------------------------------------------ corridor
  flat.floor(-1.7, -6, 1.7, 1.5, -0.4);
  // the two side arches are staggered so each one gets its own glance
  W({ axis: 'z', at: -1.95, s0: -5.5, s1: 1.5, y0: -2.4, y1: 5.0, caps: false, openings: [arch(-3.4, 2.2, -0.4, 1.3)] });
  W({ axis: 'z', at: 1.95, s0: -5.5, s1: 1.5, y0: -2.4, y1: 5.0, caps: false, openings: [arch(-1.2, 2.2, -0.4, 1.3)] });
  vault(curved, { cx: 0, spring: 2.6, r: 1.7, z0: -5.5, z1: 1.5 });
  panel(1, -0.14, -1.0, 0.14, 0.2, 4.27);
  panel(1, -0.14, -4.4, 0.14, -3.2, 4.27);

  // -------------------------------------------------------------- pool L
  flat.floor(-12, -5.5, -2.2, 1.5, -1.6);
  flat.stairs({ dir: '-x', start: -2.2, a0: -4.8, a1: -2.0, top: -0.4, bottom: -1.6, rise: 0.3, run: 0.35, count: 3, skip: 'ny px' });
  for (const x of [-9.4, -4.6]) for (const z of [-4.4, 0.4]) roundColumn(curved, x, z, 0.36, -1.6, 5.0);
  panel(1, -11.5, -2.7, -10.5, -1.3, 4.97);

  // -------------------------------------------------------------- pool R
  flat.box(2.2, -2.4, -5.5, 4.6, -0.4, 1.5, 'ny nx pz nz');
  flat.stairs({ dir: '+x', start: 4.6, a0: -5.5, a1: 1.5, top: -0.4, bottom: -2.2, rise: 0.3, run: 0.4, count: 5, skip: 'ny nx nz pz' });
  flat.floor(4.6, -5.5, 12, 1.5, -2.2);
  for (const z of [-4.2, -2.0, 0.2]) flat.box(8.45, -2.2, z - 0.35, 9.15, 5.0, z + 0.35, 'ny py');
  panel(2, 5.6, -4.5, 6.6, -3.5, 4.97);
  panel(2, 5.6, -2.5, 6.6, -1.5, 4.97);
  panel(2, 5.6, -0.5, 6.6, 0.5, 4.97);
  panel(2, 10.2, -2.7, 11.2, -1.3, 4.97);

  // ------------------------------------- slab over L / corridor / R + gallery
  flat.box(-12, 5.0, -5.5, -9, 5.25, 1.5);
  flat.box(-5, 5.0, -5.5, 12, 5.25, 1.5);
  flat.box(-9, 5.0, -5.5, -5, 5.25, -4);
  flat.box(-9, 5.0, 0, -5, 5.25, 1.5);
  flat.box(-9.12, 5.25, -4.12, -9, 7.5, 0.12);
  flat.box(-5, 5.25, -4.12, -4.88, 7.5, 0.12);
  flat.box(-9, 5.25, -4.12, -5, 7.5, -4);
  flat.box(-9, 5.25, 0, -5, 7.5, 0.12);
  panel(0, -9, -4, -5, 0, 7.5);
  flat.ceilWithHole(-12, -5.5, 12, 1.5, 7.5, -9, -4, -5, 0);
  panel(1, -0.6, -4.6, 0.6, 0.6, 7.47);
  panel(1, 4.2, -4.6, 5.4, 0.6, 7.47);
  panel(1, 9.0, -4.6, 10.2, 0.6, 7.47);
  panel(1, -11.4, -4.6, -10.2, 0.6, 7.47);

  // wall between the corridor block and the deep hall
  W({
    axis: 'x', at: -5.75, s0: -12, s1: 12, y0: -2.4, y1: 9.5, caps: false,
    openings: [
      arch(0, 3.4, -0.4, 2.6), arch(-7, 2.6, -0.4, 1.6), arch(7, 2.6, -0.4, 1.6),
      round(0, 6.4, 0.8), round(-4.4, 6.4, 0.8), round(4.4, 6.4, 0.8), round(-9.8, 6.4, 0.8), round(9.8, 6.4, 0.8),
    ],
  });

  // ----------------------------------------------------------- deep hall D
  flat.box(-12, -13, -8, 12, -0.4, -6, 'ny pz nx px');           // entrance ledge + sheer drop
  flat.box(-12, -13, -24, -9.5, -0.4, -8, 'ny nx pz nz');        // side walkways
  flat.box(9.5, -13, -24, 12, -0.4, -8, 'ny px pz nz');
  flat.box(-9.5, -13, -24, 9.5, -0.4, -22.5, 'ny nz nx px');     // far ledge
  flat.box(-9.5, -13, -13, 9.5, -4.2, -8, 'ny pz nx px');        // terrace
  flat.floor(-9.5, -22.5, 9.5, -13, -12.5);                      // abyss floor
  flat.stairs({ dir: '-z', start: -8, a0: -9.5, a1: -6.5, top: -0.4, bottom: -4.2, rise: 3.8 / 15, run: 0.3, count: 14, skip: 'ny nx pz' });
  flat.stairs({ dir: '-z', start: -13, a0: -1.8, a1: 1.8, top: -4.2, bottom: -12.5, rise: 0.28, run: 0.32, count: 22, skip: 'ny pz' });
  for (const x of [-5.4, 5.4]) for (const z of [-15.5, -20]) flat.box(x - 0.6, -12.5, z - 0.6, x + 0.6, 9.5, z + 0.6, 'ny py');
  flat.ceilWithHole(-12, -24, 12, -6, 9.5, -8, -21, 8, -15);
  flat.shaft(-8, -21, 8, -15, 9.5, 12);
  panel(3, -8, -21, 8, -15, 12);     // dim cap: its mirror image lies right where the camera will stare
  panel(2, -4.6, -11.8, -3.4, -9.2, 9.47);
  panel(2, 3.4, -11.8, 4.6, -9.2, 9.47);
  panel(2, -10.8, -14.0, -9.8, -11.6, 9.47);
  panel(2, 9.8, -14.0, 10.8, -11.6, 9.47);
  W({
    axis: 'x', at: -24.25, s0: -12.5, s1: 12.5, y0: -2.4, y1: 9.5, caps: false,
    openings: [arch(0, 4.2, -0.4, 3.2), arch(-7.5, 4.2, -0.4, 3.2), arch(7.5, 4.2, -0.4, 3.2)],
  });

  // ------------------------------------------------------------- far field
  flat.floor(FAR.x0, FAR.z0, MAIN.x0, FAR.z1, FAR.floor);
  flat.floor(MAIN.x1, FAR.z0, FAR.x1, FAR.z1, FAR.floor);
  flat.floor(MAIN.x0, MAIN.z1, MAIN.x1, FAR.z1, FAR.floor);
  flat.floor(MAIN.x0, FAR.z0, MAIN.x1, MAIN.z0, FAR.floor);

  const mainMesh = new THREE.Mesh(flat.geometry(), tileFlat);
  mainMesh.castShadow = true;
  mainMesh.receiveShadow = true;
  group.add(mainMesh);
  const curvedMesh = new THREE.Mesh(curved.geometry(), tileCurved);
  curvedMesh.castShadow = true;
  curvedMesh.receiveShadow = true;
  group.add(curvedMesh);

  // emissive fittings: 0 = luminous light-well caps, 1 / 2 = ceiling panels
  const emissive = [
    createEmissiveMaterial({ world, color: new THREE.Color(1.0, 0.98, 0.94), intensity: 6.0 }),
    createEmissiveMaterial({ world, color: new THREE.Color(0.93, 0.98, 1.0), intensity: 4.0 }),
    createEmissiveMaterial({ world, color: new THREE.Color(0.93, 0.98, 1.0), intensity: 4.0 }),
    createEmissiveMaterial({ world, color: new THREE.Color(0.9, 0.97, 1.0), intensity: 1.1 }),
  ];
  const emissiveBase = [6.0, 4.0, 4.0, 1.1];
  const emissiveGroup = [0, 1, 2, 2];
  pan.forEach((b, i) => {
    if (b.empty) return;
    const m = new THREE.Mesh(b.geometry(), emissive[i]);
    m.userData.noPrepass = false;
    group.add(m);
  });

  buildFarField({ group, tileFlat, tileCurved, emissive });

  // ---------------------------------------------------------------- lights
  const lights = [];
  const key = new THREE.DirectionalLight(new THREE.Color(1.0, 0.955, 0.87), 3.6);
  key.target.position.set(0, 0, -12);
  key.position.copy(key.target.position).addScaledVector(KEY_LIGHT_DIR, -110);
  key.castShadow = true;
  key.shadow.mapSize.set(shadowMapSize, shadowMapSize);
  key.shadow.bias = -0.00035;
  key.shadow.normalBias = 0.035;
  key.shadow.radius = 2.4;
  group.add(key, key.target);
  fitShadowCamera(key);
  lights.push({ light: key, base: 3.6, g: 0 });

  const point = (x, y, z, intensity, distance, g, color = 0xeaf6ff) => {
    const l = new THREE.PointLight(color, intensity, distance, 2);
    l.position.set(x, y, z);
    group.add(l);
    lights.push({ light: l, base: intensity, g });
    return l;
  };
  const pointLights = [
    point(0, 3.6, -2.2, 15, 10, 1),      // corridor vault strips
    point(7.5, 4.3, -2.0, 34, 13, 2),    // pool R panels
    point(0, 6.8, 14.8, 55, 17, 1),      // arrival hall, far half
    point(0, 8.6, -12.5, 85, 26, 2),    // deep hall panels
  ];

  function update(levels) {
    emissive.forEach((m, i) => { m.uniforms.uIntensity.value = emissiveBase[i] * levels[emissiveGroup[i]]; });
    for (const l of lights) l.light.intensity = l.base * levels[l.g];
  }

  return { group, key, pointLights, update, emissive };
}

function fitShadowCamera(key) {
  key.updateMatrixWorld(true);
  key.target.updateMatrixWorld(true);
  const cam = key.shadow.camera;
  cam.position.copy(key.position);
  cam.lookAt(key.target.position);
  cam.updateMatrixWorld(true);
  const inv = cam.matrixWorld.clone().invert();
  const b = new THREE.Box3();
  const v = new THREE.Vector3();
  for (const x of [FAR.x0, FAR.x1]) for (const y of [-13, 12.5]) for (const z of [FAR.z0, FAR.z1]) {
    b.expandByPoint(v.set(x, y, z).applyMatrix4(inv));
  }
  cam.left = b.min.x - 1; cam.right = b.max.x + 1;
  cam.bottom = b.min.y - 1; cam.top = b.max.y + 1;
  cam.near = Math.max(0.5, -b.max.z - 2); cam.far = -b.min.z + 2;
  cam.updateProjectionMatrix();
}

// Repeating bays on a 6 m grid: columns on every node, arcades / solid walls
// on random edges, ceiling coffers with occasional light wells, raised decks.
function buildFarField({ group, tileFlat, tileCurved, emissive }) {
  const rnd = mulberry32(90210);
  const C = FAR.cell;
  const H0 = FAR.floor, H1 = FAR.ceil;
  const inMain = (x, z) => x >= MAIN.x0 - 0.01 && x <= MAIN.x1 + 0.01 && z >= MAIN.z0 - 0.01 && z <= MAIN.z1 + 0.01;
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const qRot = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
  const one = new THREE.Vector3(1, 1, 1);
  const tr = (x, y, z, rot = false) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), rot ? qRot : q, one);

  const inst = { ceil: [], well: [], cap: [], col: [], arch: [], solid: [], deck: [], lamp: [] };

  for (let cx = FAR.x0 + C / 2; cx < FAR.x1; cx += C) {
    for (let cz = FAR.z0 + C / 2; cz < FAR.z1; cz += C) {
      if (inMain(cx, cz)) continue;
      const r = rnd(), r2 = rnd(), r3 = rnd();
      const nearMain = Math.abs(cx) < 30 && cz > -48 && cz < 36;
      if (r < (nearMain ? 0.13 : 0.08)) {
        inst.well.push(tr(cx, H1, cz));
        inst.cap.push(tr(cx, H1 + 3, cz));
      } else {
        inst.ceil.push(tr(cx, H1, cz));
        if (r2 < 0.38) inst.lamp.push(tr(cx, H1 - 0.03, cz, r3 < 0.5));
      }
      if (r3 > 0.86) inst.deck.push(tr(cx, 0, cz));
    }
  }
  for (let x = FAR.x0; x <= FAR.x1 + 0.01; x += C) {
    for (let z = FAR.z0; z <= FAR.z1 + 0.01; z += C) {
      if (!inMain(x, z)) inst.col.push(tr(x, 0, z));
      // edge towards +x
      if (x < FAR.x1 - 0.01 && !(inMain(x, z) && inMain(x + C, z))) {
        const border = Math.abs(z - FAR.z0) < 0.01 || Math.abs(z - FAR.z1) < 0.01;
        const r = rnd();
        if (border || r < 0.14) inst.solid.push(tr(x + C / 2, 0, z));
        else if (r < 0.60) inst.arch.push(tr(x + C / 2, 0, z));
      }
      // edge towards +z
      if (z < FAR.z1 - 0.01 && !(inMain(x, z) && inMain(x, z + C))) {
        const border = Math.abs(x - FAR.x0) < 0.01 || Math.abs(x - FAR.x1) < 0.01;
        const r = rnd();
        if (border || r < 0.14) inst.solid.push(tr(x, 0, z + C / 2, true));
        else if (r < 0.60) inst.arch.push(tr(x, 0, z + C / 2, true));
      }
    }
  }

  const add = (geometry, material, mats, { cast = false } = {}) => {
    if (!mats.length) return null;
    const mesh = new THREE.InstancedMesh(geometry, material, mats.length);
    mats.forEach((m, i) => mesh.setMatrixAt(i, m));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = cast;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    group.add(mesh);
    return mesh;
  };

  const h = C / 2;
  add(new Builder().ceil(-h, -h, h, h, 0).geometry(), tileFlat, inst.ceil, { cast: true });
  add(new Builder().shaft(-h, -h, h, h, 0, 3).geometry(), tileFlat, inst.well, { cast: true });
  add(new Builder().ceil(-h, -h, h, h, 0).geometry(), emissive[0], inst.cap);
  add(new Builder().box(-0.5, H0, -0.5, 0.5, H1, 0.5, 'ny py').geometry(), tileFlat, inst.col);
  add(new Builder().box(-h, H0, -0.25, h, H1, 0.25, 'ny py nx px').geometry(), tileFlat, inst.solid);
  add(new Builder().box(-h, H0, -h, h, 0.25, h, 'ny').geometry(), tileFlat, inst.deck);
  add(new Builder().ceil(-0.6, -1.3, 0.6, 1.3, 0).geometry(), emissive[1], inst.lamp);

  const aFlat = new Builder();
  const aCurved = new Builder();
  wall(aFlat, aCurved, {
    axis: 'x', at: 0, th: 0.5, s0: -h, s1: h, y0: H0, y1: H1, caps: false,
    openings: [arch(0, 4.0, H0, 3.0), round(0, 6.3, 0.62)],
  });
  add(aFlat.geometry(), tileFlat, inst.arch);
  add(aCurved.geometry(), tileCurved, inst.arch);
}

// Chrome pool ladder on the deck of the arrival hall.
export function buildLadder() {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0xd9dde0, metalness: 1, roughness: 0.14 });
  const railPts = (z) => [
    [-9.15, 0.3], [-9.15, 0.95], [-9.02, 1.18], [-8.7, 1.22], [-8.46, 1.05], [-8.4, 0.6], [-8.4, -1.35],
  ].map(([x, y]) => new THREE.Vector3(x, y, z));
  for (const z of [11.35, 11.85]) {
    const curve = new THREE.CatmullRomCurve3(railPts(z), false, 'catmullrom', 0.35);
    const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 48, 0.024, 10, false), mat);
    tube.castShadow = true;
    g.add(tube);
  }
  for (const y of [-0.25, -0.58, -0.91, -1.24]) {
    const rung = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.025, 0.5), mat);
    rung.position.set(-8.4, y, 11.6);
    g.add(rung);
  }
  return g;
}
