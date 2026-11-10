// The ordinary corridor: carpet tiles, tired paint, a drop ceiling with
// fluorescent troffers, a row of closed doors. It hangs in the void exactly
// above the arrival hall, so when the floor fails the pools are really there,
// far below, visible through the holes.
import * as THREE from 'three';
import { Builder } from './builder.js';
import { createSurfaceMaterial, createEmissiveMaterial } from './materials.js';
import { CORRIDOR_Y } from '../config.js';

export const CORRIDOR = { x0: -1.2, x1: 1.2, z0: -12, z1: 24, h: 2.7, y: CORRIDOR_Y };

export function buildCorridor({ textures, plain, world, envMap = null }) {
  const group = new THREE.Group();
  group.name = 'corridor';
  const { x0, x1, z0, z1, h, y } = CORRIDOR;
  const top = y + h;

  const mk = (maps, texMeters, extra = {}) => createSurfaceMaterial({ maps, world, texMeters, envMap, envIntensity: 0.6, ...extra });
  const matFloor = mk(textures.carpet, 1.0, { floorGlitch: true });
  const matWall = mk(textures.wall, 1.4);
  const matCeil = mk(textures.ceiling, 1.2);
  const matWood = mk(textures.wood, 1.1);
  const matTrim = mk(plain, 1, { color: 0x2a2620, roughness: 0.55 });
  const matFrame = mk(plain, 1, { color: 0x8f8a7c, roughness: 0.5 });
  const matMetal = mk(plain, 1, { color: 0xb9b3a4, roughness: 0.3, metalness: 1 });
  const matDead = mk(plain, 1, { color: 0x77776f, roughness: 0.4 });

  const floor = new Builder();
  floor.floor(x0, z0, x1, z1, y);
  const floorMesh = new THREE.Mesh(floor.geometry(), matFloor);
  floorMesh.receiveShadow = false;
  group.add(floorMesh);

  const walls = new Builder();
  walls.quad([x0, y, z0], [x0, y, z1], [x0, top, z1], [x0, top, z0], [1, 0, 0]);
  walls.quad([x1, y, z0], [x1, y, z1], [x1, top, z1], [x1, top, z0], [-1, 0, 0]);
  walls.quad([x0, y, z0], [x1, y, z0], [x1, top, z0], [x0, top, z0], [0, 0, 1]);
  walls.quad([x0, y, z1], [x1, y, z1], [x1, top, z1], [x0, top, z1], [0, 0, -1]);
  group.add(new THREE.Mesh(walls.geometry(), matWall));

  const ceil = new Builder();
  ceil.ceil(x0, z0, x1, z1, top);
  group.add(new THREE.Mesh(ceil.geometry(), matCeil));

  // skirting, door frames, doors, handles
  const trim = new Builder();
  const frame = new Builder();
  const wood = new Builder();
  const metal = new Builder();
  trim.box(x0, y, z0, x0 + 0.015, y + 0.1, z1, 'ny nx');
  trim.box(x1 - 0.015, y, z0, x1, y + 0.1, z1, 'ny px');
  const doorZs = [20.6, 16.4, 12.3, 8.1, 3.9, -0.3, -4.5, -8.7];
  doorZs.forEach((dz, i) => {
    const left = i % 2 === 0;
    const zc = dz + (left ? 0 : 1.9);
    const xw = left ? x0 : x1;
    const s = left ? 1 : -1;             // direction into the corridor
    const a = xw, b = xw + s * 0.035;
    const dw = 0.46, dh = 2.06, fw = 0.075;
    frame.box(a, y, zc - dw - fw, b, y + dh + fw, zc - dw);
    frame.box(a, y, zc + dw, b, y + dh + fw, zc + dw + fw);
    frame.box(a, y + dh, zc - dw, b, y + dh + fw, zc + dw);
    wood.box(a, y + 0.008, zc - dw, xw + s * 0.014, y + dh, zc + dw);
    // lever handle + plate
    const hz = zc + dw - 0.085;
    metal.box(xw + s * 0.014, y + 0.93, hz - 0.022, xw + s * 0.02, y + 1.13, hz + 0.022);
    metal.box(xw + s * 0.02, y + 1.035, hz - 0.012, xw + s * 0.062, y + 1.059, hz + 0.012);
    metal.box(xw + s * 0.05, y + 1.035, hz - 0.115, xw + s * 0.066, y + 1.059, hz + 0.012);
  });
  // double door closing the far end
  frame.box(-0.82, y, z0, 0.82, y + 2.16, z0 + 0.03, 'nz');
  wood.box(-0.74, y + 0.008, z0, -0.006, y + 2.08, z0 + 0.045, 'nz');
  wood.box(0.006, y + 0.008, z0, 0.74, y + 2.08, z0 + 0.045, 'nz');
  metal.box(-0.1, y + 0.95, z0 + 0.045, -0.07, y + 1.2, z0 + 0.075);
  metal.box(0.07, y + 0.95, z0 + 0.045, 0.1, y + 1.2, z0 + 0.075);
  group.add(new THREE.Mesh(trim.geometry(), matTrim));
  group.add(new THREE.Mesh(frame.geometry(), matFrame));
  group.add(new THREE.Mesh(wood.geometry(), matWood));
  group.add(new THREE.Mesh(metal.geometry(), matMetal));

  // fluorescent troffers: [z, state] — 1 = on, 2 = on but failing, 0 = dead
  const fittings = [[21.3, 1], [16.5, 1], [11.7, 2], [6.9, 1], [2.1, 0], [-2.7, 2], [-7.5, 0]];
  const emissive = [
    createEmissiveMaterial({ world, color: new THREE.Color(1.0, 0.96, 0.84), intensity: 4.2 }),
    createEmissiveMaterial({ world, color: new THREE.Color(1.0, 0.96, 0.84), intensity: 4.2 }),
  ];
  const lamps = [new Builder(), new Builder()];
  const dead = new Builder();
  const lights = [];
  for (const [z, state] of fittings) {
    const b = state === 0 ? dead : lamps[state - 1];
    b.ceil(-0.3, z - 0.6, 0.3, z + 0.6, top - 0.012);
    if (state !== 0 && z > 4) {
      const l = new THREE.PointLight(new THREE.Color(1.0, 0.93, 0.76), 5.2, 9.5, 2);
      l.position.set(0, top - 0.35, z);
      group.add(l);
      lights.push({ light: l, base: 5.2, g: state - 1 });
    }
  }
  lamps.forEach((b, i) => { if (!b.empty) group.add(new THREE.Mesh(b.geometry(), emissive[i])); });
  if (!dead.empty) group.add(new THREE.Mesh(dead.geometry(), matDead));

  group.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });

  function update(levels) {
    emissive.forEach((m, i) => { m.uniforms.uIntensity.value = 4.2 * levels[i]; });
    for (const l of lights) l.light.intensity = l.base * levels[l.g];
  }

  return { group, floorMesh, lights: lights.map((l) => l.light), update };
}
