// What lives in the water.
//
//  * `shadow`  — a long dark mass that glides under the surface (13-17 s)
//  * `figureA` — a too-tall humanoid silhouette standing on the terrace
//  * `figureB` — the same thing, suddenly just below the surface, reaching up
//
// They are deliberately unlit: pure absence of light, shaped only by the
// water in front of them.
import * as THREE from 'three';

const Y = new THREE.Vector3(0, 1, 0);

function limb(mat, a, b, r) {
  const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b);
  const len = va.distanceTo(vb);
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 5, 12), mat);
  m.position.copy(va).add(vb).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(Y, vb.clone().sub(va).normalize());
  return m;
}

function blob(mat, p, r, s = [1, 1, 1]) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, 18, 14), mat);
  m.position.set(...p);
  m.scale.set(...s);
  return m;
}

function makeFigure(mat, pose) {
  const g = new THREE.Group();
  const P = pose;
  g.add(limb(mat, [-0.11, 0.0, 0], P.hipL, 0.058));
  g.add(limb(mat, [0.11, 0.0, 0], P.hipR, 0.058));
  g.add(limb(mat, P.pelvis, P.chest, 0.135));
  g.add(limb(mat, P.shL, P.shR, 0.085));
  g.add(limb(mat, P.shL, P.elL, 0.042));
  g.add(limb(mat, P.elL, P.haL, 0.036));
  g.add(limb(mat, P.shR, P.elR, 0.042));
  g.add(limb(mat, P.elR, P.haR, 0.036));
  g.add(blob(mat, P.haL, 0.06, [0.7, 1.5, 0.45]));
  g.add(blob(mat, P.haR, 0.06, [0.7, 1.5, 0.45]));
  g.add(limb(mat, P.chest, P.head, 0.04));
  g.add(blob(mat, P.head, 0.118, [0.92, 1.3, 1.0]));
  return g;
}

export function buildEntities() {
  const dark = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.004, 0.006, 0.008) });

  // standing far too still, arms far too long, head a little to one side
  const figureA = makeFigure(dark, {
    hipL: [-0.1, 1.02, 0], hipR: [0.1, 1.02, 0],
    pelvis: [0, 1.0, 0], chest: [0.01, 1.58, 0.02],
    shL: [-0.23, 1.6, 0.02], shR: [0.23, 1.6, 0.02],
    elL: [-0.29, 1.12, 0.03], haL: [-0.27, 0.58, 0.06],
    elR: [0.29, 1.12, 0.03], haR: [0.27, 0.58, 0.06],
    head: [0.045, 1.9, 0.06],
  });
  figureA.scale.setScalar(1.12);

  // floating upright under the surface, one arm stretched towards the lens
  const figureB = makeFigure(dark, {
    hipL: [-0.09, 1.0, -0.12], hipR: [0.12, 1.02, -0.05],
    pelvis: [0, 1.0, 0], chest: [0.0, 1.57, 0.12],
    shL: [-0.23, 1.6, 0.12], shR: [0.23, 1.6, 0.12],
    elL: [-0.33, 1.2, 0.22], haL: [-0.36, 0.72, 0.3],
    elR: [0.24, 1.86, 0.52], haR: [0.02, 2.12, 1.0],
    head: [0.03, 1.9, 0.2],
  });
  figureB.scale.setScalar(1.12);

  figureA.visible = false;
  figureB.visible = false;

  // the shadow: a tapered body ~7 m long, soft-edged, undulating
  const pts = [];
  const L = 7.0;
  for (let i = 0; i <= 28; i++) {
    const u = i / 28;
    const body = Math.pow(Math.sin(Math.PI * Math.pow(u, 0.62)), 0.85);
    pts.push(new THREE.Vector2(Math.max(0.001, body * 0.62), (u - 0.38) * L));
  }
  const geo = new THREE.LatheGeometry(pts, 20);
  geo.rotateX(Math.PI / 2);            // length along z, head towards +z
  geo.scale(1.0, 0.5, 1.0);
  const shadowMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { uTime: { value: 0 }, uOpacity: { value: 0 } },
    vertexShader: /* glsl */ `
      uniform float uTime;
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        vec3 p = position;
        float w = (0.5 - p.z / 7.0);
        p.x += sin(p.z * 0.95 - uTime * 2.6) * 0.34 * w * w;
        p.y += sin(p.z * 0.6 - uTime * 1.7) * 0.08 * w;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vN = normalize(normalMatrix * normal);
        vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uOpacity;
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        float f = abs(dot(normalize(vN), normalize(vV)));
        float a = pow(smoothstep(0.0, 1.0, f), 1.4) * uOpacity * 0.85;
        gl_FragColor = vec4(vec3(0.0, 0.006, 0.008), a);
      }`,
  });
  const shadow = new THREE.Mesh(geo, shadowMat);
  shadow.visible = false;
  shadow.frustumCulled = false;

  const group = new THREE.Group();
  group.add(figureA, figureB, shadow);
  return { group, figureA, figureB, shadow, shadowMat };
}
