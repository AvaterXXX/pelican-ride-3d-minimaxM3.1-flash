import * as THREE from 'three';

/* ============================ 数学与缓动 ============================ */
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => (b === a ? 0 : clamp((v - a) / (b - a), 0, 1));
export const smoothstep = (e0, e1, x) => { const t = invLerp(e0, e1, x); return t * t * (3 - 2 * t); };
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

export const easeInOutCubic = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const easeOutCubic = t => 1 - Math.pow(1 - t, 3);
export const easeInCubic = t => t * t * t;
export const easeOutQuint = t => 1 - Math.pow(1 - t, 5);
export const easeInOutQuart = t => (t < 0.5 ? 8 * t * t * t * t : 1 - Math.pow(-2 * t + 2, 4) / 2);
export const easeOutBack = t => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };
export const easeOutElastic = t => {
  const c4 = (2 * Math.PI) / 3;
  return t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
};

/* 确定性随机 */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* 一维值噪声（用于镜头抖动 / 风吹） */
export class Noise1D {
  constructor(seed = 1337) {
    const r = mulberry32(seed);
    this.t = new Float32Array(256);
    for (let i = 0; i < 256; i++) this.t[i] = r() * 2 - 1;
  }
  at(x) {
    const i = Math.floor(x), f = x - i;
    const a = this.t[i & 255], b = this.t[(i + 1) & 255];
    const u = f * f * (3 - 2 * f);
    return a + (b - a) * u;
  }
  fbm(x, oct = 3) {
    let s = 0, amp = 0.5, fr = 1;
    for (let i = 0; i < oct; i++) { s += this.at(x * fr) * amp; fr *= 2.03; amp *= 0.5; }
    return s;
  }
}

/* ============================ 几何辅助 ============================ */
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);

/** 让一根沿 +Y 的圆柱（mesh）从 a 指向 b */
export function alignSegment(mesh, a, b, thickness = 1) {
  _v1.subVectors(b, a);
  const len = _v1.length() || 0.0001;
  mesh.position.copy(a).addScaledVector(_v1, 0.5);
  _v1.normalize();
  _q.setFromUnitVectors(UP, _v1);
  mesh.quaternion.copy(_q);
  mesh.scale.set(thickness, len, thickness);
}

/** 两骨 IK：返回中间关节（膝盖）位置 */
export function solveIK(root, target, l1, l2, pole, out = new THREE.Vector3()) {
  const d = _v2.subVectors(target, root);
  let dist = d.length();
  const min = Math.abs(l1 - l2) + 0.0005, max = l1 + l2 - 0.0005;
  dist = clamp(dist, min, max);
  d.normalize();
  const a = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  // 极向量投影到与骨骼方向垂直的平面
  const poleDir = pole.clone().addScaledVector(d, -pole.dot(d));
  if (poleDir.lengthSq() < 1e-6) poleDir.set(0, 0, 1);
  poleDir.normalize();
  out.copy(root).addScaledVector(d, a).addScaledVector(poleDir, h);
  return out;
}

/* ============================ 建模辅助 ============================ */
export function tube(from, to, r, mat, seg = 10) {
  const g = new THREE.CylinderGeometry(r, r, 1, seg, 1);
  g.translate(0, 0.5, 0);
  const m = new THREE.Mesh(g, mat);
  alignSegment(m, from, to, 1);
  m.userData.segLen = from.distanceTo(to);
  return m;
}

export function box(w, h, d, mat, seg = 1) {
  return new THREE.Mesh(new THREE.BoxGeometry(w, h, d, seg, seg, seg), mat);
}

export function sphere(r, mat, w = 18, h = 14) {
  return new THREE.Mesh(new THREE.SphereGeometry(r, w, h), mat);
}

export function cyl(rt, rb, h, mat, seg = 16, open = false) {
  return new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg, 1, open), mat);
}

/** 圆角盒：用 ExtrudeGeometry 的 bevel 得到柔和的“电影道具”质感 */
export function roundedBox(w, h, d, r, mat, bevel = 0.04) {
  const s = new THREE.Shape();
  const x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  const g = new THREE.ExtrudeGeometry(s, {
    depth: d, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 3, curveSegments: 8,
  });
  g.translate(0, 0, -d / 2);
  g.computeVertexNormals();
  return new THREE.Mesh(g, mat);
}

/* ============================ 材质工厂 ============================ */
export function mat(color, opts = {}) {
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color(color), roughness: 0.72, metalness: 0.06, ...opts,
  });
}
export function phys(color, opts = {}) {
  return new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(color), roughness: 0.4, metalness: 0.0, ...opts,
  });
}
export function emissive(color, intensity = 2, opts = {}) {
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color(color), emissive: new THREE.Color(color), emissiveIntensity: intensity,
    roughness: 0.4, metalness: 0, ...opts,
  });
}

/* ============================ 贴图 ============================ */
export function canvasTexture(w, h, draw, opts = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  draw(ctx, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = opts.srgb === false ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  t.wrapS = opts.wrapS || THREE.RepeatWrapping;
  t.wrapT = opts.wrapT || THREE.RepeatWrapping;
  t.anisotropy = opts.aniso || 8;
  if (opts.repeat) t.repeat.set(opts.repeat[0], opts.repeat[1]);
  return t;
}

/* 速度相关的简易伪影 */
export const rnd = (a = 0, b = 1) => a + Math.random() * (b - a);
export const pick = arr => arr[Math.floor(Math.random() * arr.length)];
