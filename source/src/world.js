import * as THREE from 'three';
import { Sky, sunDirection } from './sky.js';
import {
  clamp, lerp, smoothstep, mulberry32, rnd, canvasTexture, mat, phys, emissive,
  roundedBox, cyl, sphere, box, Noise1D,
} from './util.js';

/* ==================================================================== */
/*  场景预设                                                             */
/* ==================================================================== */
export const PRESETS = {
  coast: {
    label: '黄金海岸', en: 'GOLDEN COAST',
    sky: { zenith: '#1b3f78', horizon: '#ffb45c', ground: '#2b1c11', sunColor: '#ffdfae',
      cloudColor: '#ffd6a4', cloudDark: '#5a3a55', sunSize: 0.007, sunGlow: 1.15, cloud: 0.68, haze: 0.5 },
    sun: { color: '#ffd7a0', intensity: 4.6, azimuth: 0.9 },
    hemi: { sky: '#bcd0f0', ground: '#7d5a38', intensity: 0.62 },
    ambient: 0.2, fog: { color: '#f0a765', density: 0.0032 },
    ground: '#7a6446', roadTint: '#ffffff', particle: 'dust', exposure: 1.02, grade: 1.0, sat: 1.1,
    bloom: 0.62,
  },
  neon: {
    label: '霓虹雨夜', en: 'NEON RAIN',
    sky: { zenith: '#04060f', horizon: '#2a1240', ground: '#080a12', sunColor: '#7a9cff',
      cloudColor: '#3b2a55', cloudDark: '#100b1e', sunSize: 0.004, sunGlow: 0.5, cloud: 0.9, haze: 0.35, stars: 0.85 },
    sun: { color: '#8fa8ff', intensity: 0.9, azimuth: 2.2 },
    hemi: { sky: '#2a3d80', ground: '#120a22', intensity: 0.5 },
    ambient: 0.16, fog: { color: '#0a0d1c', density: 0.0085 },
    ground: '#15161f', roadTint: '#aebcd8', particle: 'rain', exposure: 1.12, grade: 0.85, sat: 1.16,
    bloom: 1.0,
  },
  storm: {
    label: '雷暴荒野', en: 'STORM FRONTIER',
    sky: { zenith: '#171b22', horizon: '#454c56', ground: '#0e1114', sunColor: '#c8d4e2',
      cloudColor: '#4a525c', cloudDark: '#12151a', sunSize: 0.003, sunGlow: 0.3, cloud: 0.95, haze: 0.7 },
    sun: { color: '#b9c7d6', intensity: 1.35, azimuth: 1.4 },
    hemi: { sky: '#5d6b7d', ground: '#1d2418', intensity: 0.62 },
    ambient: 0.18, fog: { color: '#2b3138', density: 0.0062 },
    ground: '#3a4232', roadTint: '#c8d2dd', particle: 'rain', exposure: 0.98, grade: 0.9, sat: 0.98,
    bloom: 0.5,
  },
  desert: {
    label: '沙漠黄昏', en: 'DESERT DUSK',
    sky: { zenith: '#2d3f78', horizon: '#ff9a4d', ground: '#4a2c14', sunColor: '#ffd08a',
      cloudColor: '#ffc08a', cloudDark: '#7a4a4a', sunSize: 0.012, sunGlow: 1.5, cloud: 0.3, haze: 0.62 },
    sun: { color: '#ffca85', intensity: 5.0, azimuth: 0.35 },
    hemi: { sky: '#ffb98a', ground: '#8a4f22', intensity: 0.9 },
    ambient: 0.22, fog: { color: '#e0a878', density: 0.0042 },
    ground: '#c08a52', roadTint: '#ffe2c0', particle: 'dust', exposure: 1.04, grade: 1.0, sat: 1.12,
    bloom: 0.7,
  },
};

/* ==================================================================== */
/*  赛道控制点                                                          */
/* ==================================================================== */
const CTRL = [
  [0, 0, -10], [0, 0, 40], [-8, 0, 86], [24, 1.2, 126], [74, 3.2, 152],
  [130, 5.6, 148], [168, 6.4, 108], [176, 5.2, 58], [152, 3.0, 14], [128, 1.0, -18],
  [118, 0, -54], [92, 0, -86], [44, 0, -104], [-4, 0, -96], [-38, 0, -62],
  [-52, 0, -22], [-40, 0, 4],
];

/* ==================================================================== */
/*  程序化粒子场                                                        */
/* ==================================================================== */
const RAIN_VERT = /* glsl */`
uniform float uTime, uH, uSpeed, uSize;
attribute vec3 aSeed;
varying float vAlpha;
void main(){
  vec3 p = position;
  float fall = mod(aSeed.y*uH - uTime*uSpeed*(0.75+aSeed.x*0.5), uH);
  p.y = fall;
  p.x += sin(uTime*0.6 + aSeed.z*9.0)*0.8;
  vec4 mv = modelViewMatrix * vec4(p,1.0);
  vAlpha = smoothstep(0.0, 6.0, fall) * smoothstep(uH, uH-10.0, fall);
  gl_PointSize = min(uSize * (300.0/ -mv.z), 42.0);
  gl_Position = projectionMatrix * mv;
}`;
const RAIN_FRAG = /* glsl */`
varying float vAlpha;
uniform vec3 uColor;
void main(){
  vec2 c = gl_PointCoord - 0.5;
  // 拉长的雨丝
  float a = smoothstep(0.5, 0.0, abs(c.x)*3.4) * smoothstep(0.5, 0.12, abs(c.y));
  gl_FragColor = vec4(uColor, a*vAlpha*0.75);
}`;

const DUST_VERT = /* glsl */`
uniform float uTime, uH, uSize, uSpeed;
attribute vec3 aSeed;
varying float vAlpha;
void main(){
  vec3 p = position;
  float rise = mod(aSeed.y*uH + uTime*uSpeed*(0.35+aSeed.x*0.4), uH);
  p.y = rise;
  p.x += sin(uTime*0.35 + aSeed.z*12.0)*2.4;
  p.z += cos(uTime*0.28 + aSeed.z*7.0)*2.0;
  vec4 mv = modelViewMatrix * vec4(p,1.0);
  vAlpha = smoothstep(0.0,4.0,rise)*smoothstep(uH,uH-8.0,rise);
  gl_PointSize = min(uSize * (240.0/ -mv.z) * (0.5+aSeed.z), 36.0);
  gl_Position = projectionMatrix * mv;
}`;
const DUST_FRAG = /* glsl */`
varying float vAlpha;
uniform vec3 uColor;
void main(){
  float d = length(gl_PointCoord-0.5);
  float a = smoothstep(0.5, 0.0, d);
  gl_FragColor = vec4(uColor, a*a*vAlpha*0.6);
}`;

class ParticleField {
  constructor(scene, mode) {
    this.mode = mode;
    const rain = mode === 'rain';
    const N = rain ? 5200 : 2600;
    const H = rain ? 90 : 60;
    const R = rain ? 70 : 55;
    const pos = new Float32Array(N * 3);
    const seed = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      pos[i * 3] = (Math.random() - 0.5) * R * 2;
      pos[i * 3 + 1] = 0;
      pos[i * 3 + 2] = (Math.random() - 0.5) * R * 2;
      seed[i * 3] = Math.random();
      seed[i * 3 + 1] = Math.random();
      seed[i * 3 + 2] = Math.random();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 3));
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 }, uH: { value: H }, uSpeed: { value: rain ? 46 : 2.2 },
        uSize: { value: rain ? 2.6 : 3.4 },
        uColor: { value: new THREE.Color(rain ? '#a9c8ff' : '#ffd9a8') },
      },
      vertexShader: rain ? RAIN_VERT : DUST_VERT,
      fragmentShader: rain ? RAIN_FRAG : DUST_FRAG,
      transparent: true, depthWrite: false,
      blending: rain ? THREE.NormalBlending : THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    scene.add(this.points);
  }
  update(dt, camPos) {
    this.mat.uniforms.uTime.value += dt;
    this.points.position.set(camPos.x, camPos.y - (this.mode === 'rain' ? 10 : 14), camPos.z);
  }
  dispose() {
    this.points.parent?.remove(this.points);
    this.points.geometry.dispose(); this.mat.dispose();
  }
}

/* ==================================================================== */
/*  World                                                               */
/* ==================================================================== */
export class World {
  constructor(scene) {
    this.scene = scene;
    this.sky = new Sky(scene);
    this.noise = new Noise1D(2024);
    this.presetName = 'coast';
    this.timeOfDay = 0.16;
    this.lightning = 0;
    this._lightningTimer = 4;

    // 灯光
    this.sun = new THREE.DirectionalLight(0xffffff, 4);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 320;
    this.sun.shadow.bias = -0.0008;
    this.sun.shadow.normalBias = 0.035;
    this._setShadowArea(90);
    scene.add(this.sun);
    scene.add(this.sun.target);

    this.hemi = new THREE.HemisphereLight(0x8fb6ff, 0x6b4a2c, 0.85);
    scene.add(this.hemi);

    this.rim = new THREE.DirectionalLight(0x8ab4ff, 1.1);
    this.rim.position.set(-60, 40, 80);
    scene.add(this.rim);

    scene.fog = new THREE.FogExp2(0xf0a765, 0.0032);

    this.terrainGroup = new THREE.Group();
    this.propGroup = new THREE.Group();
    this.scene.add(this.terrainGroup, this.propGroup);

    this._buildTrack();
    this.applyPreset('coast', true);
  }

  _setShadowArea(size) {
    const c = this.sun.shadow.camera;
    c.left = -size; c.right = size; c.top = size; c.bottom = -size;
    c.updateProjectionMatrix();
  }

  /* ---------------------------- 赛道 ---------------------------- */
  _buildTrack() {
    const pts = CTRL.map(c => new THREE.Vector3(c[0], c[1], c[2]));
    this.curve = new THREE.CatmullRomCurve3(pts, true, 'catmullrom', 0.5);
    this.trackLength = this.curve.getLength();

    // 路面网格
    const N = 900, W = 13;
    const positions = [], uvs = [], indices = [];
    const frames = [];
    for (let i = 0; i <= N; i++) {
      const u = i / N;
      const f = this.frameAt(u);
      frames.push(f);
      positions.push(f.left.x, f.left.y, f.left.z, f.right.x, f.right.y, f.right.z);
      const v = u * this.trackLength / 12;
      uvs.push(0, v, 1, v);
    }
    for (let i = 0; i < N; i++) {
      const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
      indices.push(a, c, b, b, c, d);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.setIndex(indices);
    g.computeVertexNormals();

    const tex = canvasTexture(512, 512, (ctx, w, h) => {
      ctx.fillStyle = '#3b3b42'; ctx.fillRect(0, 0, w, h);
      // 沥青颗粒
      const r = mulberry32(7);
      for (let i = 0; i < 26000; i++) {
        const g = 44 + r() * 40;
        ctx.fillStyle = `rgba(${g},${g},${g + 4},${0.25 + r() * 0.4})`;
        ctx.fillRect(r() * w, r() * h, 1 + r() * 2, 1 + r() * 2);
      }
      // 轮胎痕
      for (let i = 0; i < 26; i++) {
        ctx.fillStyle = `rgba(0,0,0,${0.04 + r() * 0.07})`;
        ctx.fillRect(r() * w, 0, 3 + r() * 12, h);
      }
      // 中心虚线
      ctx.fillStyle = '#f4e9c8';
      ctx.fillRect(w * 0.5 - 4, 0, 8, h * 0.42);
      // 边线
      ctx.fillStyle = '#f6f0d6';
      ctx.fillRect(10, 0, 7, h);
      ctx.fillRect(w - 17, 0, 7, h);
      ctx.fillStyle = '#e8b23c';
      ctx.fillRect(24, 0, 4, h);
      ctx.fillRect(w - 28, 0, 4, h);
    }, { repeat: [1, 1], aniso: 16 });

    this.roadMat = new THREE.MeshStandardMaterial({
      map: tex, roughness: 0.78, metalness: 0.08, color: 0xffffff,
    });
    this.road = new THREE.Mesh(g, this.roadMat);
    this.road.receiveShadow = true;
    this.terrainGroup.add(this.road);

    // 路肩
    const shoulder = this._ribbon(0.5, 1.2, 0.06, new THREE.MeshStandardMaterial({ color: 0x6b6250, roughness: 0.95 }));
    this.terrainGroup.add(shoulder);

    // 起点门架
    this._buildStartGate();
    // 跳台
    this._buildRamp();
  }

  /** 在 u 处取样路面坐标系 */
  frameAt(u) {
    u = ((u % 1) + 1) % 1;
    const p = this.curve.getPointAt(u);
    const t = this.curve.getTangentAt(u).normalize();
    const up = new THREE.Vector3(0, 1, 0);
    const side = new THREE.Vector3().crossVectors(t, up).normalize();
    // 曲率 → 倾斜
    const e = 0.004;
    const t2 = this.curve.getTangentAt((u + e) % 1).normalize();
    const curv = new THREE.Vector3().crossVectors(t, t2).dot(side) / (2 * e * this.trackLength);
    const bank = clamp(curv * 34, -0.22, 0.22);
    const upB = new THREE.Vector3().crossVectors(side, t).normalize();
    const q = new THREE.Quaternion().setFromAxisAngle(t, bank);
    side.applyQuaternion(q); upB.applyQuaternion(q);
    const W = 6.5;
    return {
      pos: p.clone(),
      tangent: t,
      side,
      up: upB,
      bank,
      left: p.clone().addScaledVector(side, W),
      right: p.clone().addScaledVector(side, -W),
      center: p.clone().addScaledVector(upB, 0),
    };
  }

  /** 侧向偏移的世界坐标点 */
  pointAt(u, lateral = 0, up = 0) {
    const f = this.frameAt(u);
    return f.pos.clone().addScaledVector(f.side, lateral).addScaledVector(f.up, up);
  }

  roadHeightAt(u) { return this.frameAt(u).pos.y; }

  _ribbon(lateralIn, lateralOut, lift, material) {
    const N = 500;
    const pos = [], idx = [], uv = [];
    for (let i = 0; i <= N; i++) {
      const u = i / N;
      const f = this.frameAt(u);
      const a = f.pos.clone().addScaledVector(f.side, lateralIn).addScaledVector(f.up, lift);
      const b = f.pos.clone().addScaledVector(f.side, lateralOut).addScaledVector(f.up, lift - 0.35);
      pos.push(a.x, a.y, a.z, b.x, b.y, b.z);
      uv.push(0, u * this.trackLength / 6, 1, u * this.trackLength / 6);
    }
    for (let i = 0; i < N; i++) {
      const p = i * 2;
      idx.push(p, p + 2, p + 1, p + 1, p + 2, p + 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx); g.computeVertexNormals();
    const m = new THREE.Mesh(g, material);
    m.receiveShadow = true;
    return m;
  }

  _buildStartGate() {
    const g = new THREE.Group();
    const f = this.frameAt(0.004);
    const post = mat(0x2b2f36, { roughness: 0.55, metalness: 0.5 });
    const sign = mat(0xe8e2d0, { roughness: 0.7 });
    const gold = emissive('#f2c26b', 0.55, { roughness: 0.4 });

    for (const s of [-1, 1]) {
      const p = cyl(0.32, 0.4, 9, post, 10);
      p.position.copy(f.pos).addScaledVector(f.side, s * 8.4);
      p.position.y += 4.5;
      p.castShadow = true;
      g.add(p);
    }
    const board = roundedBox(19, 3.1, 0.5, 0.3, sign, 0.08);
    board.position.copy(f.pos).addScaledVector(f.up, 8.2);
    board.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), f.tangent);
    board.castShadow = true;
    g.add(board);
    // 横幅文字
    const cvs = document.createElement('canvas');
    cvs.width = 1024; cvs.height = 168;
    const ctx = cvs.getContext('2d');
    ctx.fillStyle = '#12161d'; ctx.fillRect(0, 0, 1024, 168);
    ctx.strokeStyle = '#f2c26b'; ctx.lineWidth = 6; ctx.strokeRect(12, 12, 1000, 144);
    ctx.fillStyle = '#f2c26b';
    ctx.font = 'bold 72px Impact, "Arial Narrow", sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('PELICAN GRAND PRIX', 512, 90);
    const tex = new THREE.CanvasTexture(cvs);
    tex.colorSpace = THREE.SRGBColorSpace;
    const face = new THREE.Mesh(new THREE.PlaneGeometry(18.2, 2.9), new THREE.MeshStandardMaterial({
      map: tex, emissiveMap: tex, emissive: new THREE.Color('#ffffff'), emissiveIntensity: 0.28, roughness: 0.6,
    }));
    face.position.copy(board.position).addScaledVector(f.tangent, 0.28);
    face.quaternion.copy(board.quaternion);
    g.add(face);
    this.terrainGroup.add(g);
    this.startGate = g;
  }

  _buildRamp() {
    const f = this.frameAt(0.5);
    const g = new THREE.Group();
    const m = mat(0x3a3a40, { roughness: 0.8 });
    const shape = new THREE.Shape();
    shape.moveTo(-13, 0); shape.lineTo(0, 0); shape.lineTo(0, 3.4); shape.lineTo(-13, 0);
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 8.5, bevelEnabled: false });
    geo.rotateY(Math.PI / 2);
    geo.translate(0, 0, 0);
    const ramp = new THREE.Mesh(geo, m);
    ramp.castShadow = true; ramp.receiveShadow = true;
    g.add(ramp);
    // 侧板
    for (const s of [-1, 1]) {
      const side = new THREE.Mesh(new THREE.PlaneGeometry(13, 3.4), mat(0xd8552e, { roughness: 0.6, side: THREE.DoubleSide }));
      side.position.set(-6.5, 1.7, s * 4.3);
      side.rotation.y = Math.PI / 2;
      side.rotation.x = 0;
      g.add(side);
    }
    g.position.copy(f.pos);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), f.tangent);
    g.quaternion.copy(q);
    this.terrainGroup.add(g);
    this.ramp = g;
    this.rampU = 0.5;
  }

  /* ---------------------------- 预设 ---------------------------- */
  applyPreset(name, instant = false) {
    const p = PRESETS[name] || PRESETS.coast;
    this.presetName = name;
    this.preset = p;

    // 清理旧道具
    while (this.propGroup.children.length) {
      const c = this.propGroup.children.pop();
      c.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(mm => mm.dispose()); });
    }
    if (this.particles) { this.particles.dispose(); this.particles = null; }

    // 天空 / 雾
    const sky = { ...p.sky };
    const sd = sunDirection(this.timeOfDay, p.sun.azimuth);
    sky.sunDir = sd;
    this.sky.set(sky);
    this.scene.fog = new THREE.FogExp2(new THREE.Color(p.fog.color), p.fog.density);

    // 灯光
    this.sun.color.set(p.sun.color);
    this.sun.intensity = p.sun.intensity;
    this.hemi.color.set(p.hemi.sky);
    this.hemi.groundColor.set(p.hemi.ground);
    this.hemi.intensity = p.hemi.intensity;
    this.rim.intensity = name === 'neon' ? 1.6 : 1.1;

    this.roadMat.color.set(p.roadTint);
    this.roadMat.metalness = name === 'neon' ? 0.55 : 0.08;
    this.roadMat.roughness = name === 'neon' ? 0.22 : 0.78;

    this._buildTerrain(name, p);
    this._buildProps(name, p);
    this.particles = new ParticleField(this.scene, p.particle);
  }

  _buildTerrain(name, p) {
    while (this.terrainGroup.children.length > 3) {
      const c = this.terrainGroup.children.pop();
      c.traverse(o => { if (o.geometry) o.geometry.dispose(); });
    }
    // 路面 + 路肩 + 门架 + 跳台 是前 3 个
    const land = new THREE.Group();

    if (name === 'coast') {
      // 岛屿圆盘 + 峭壁
      const rock = mat('#6b5843', { roughness: 0.95 });
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(430, 396, 26, 72, 1), rock);
      disc.position.y = -13; disc.receiveShadow = true;
      land.add(disc);
      const cap = new THREE.Mesh(new THREE.CircleGeometry(430, 72), mat('#8a7350', { roughness: 0.98 }));
      cap.rotation.x = -Math.PI / 2; cap.position.y = 0.01; cap.receiveShadow = true;
      land.add(cap);
      // 海洋
      const ocean = new THREE.Mesh(new THREE.PlaneGeometry(4200, 4200, 1, 1), new THREE.MeshStandardMaterial({
        color: '#0b3550', roughness: 0.12, metalness: 0.65,
      }));
      ocean.rotation.x = -Math.PI / 2; ocean.position.y = -11;
      land.add(ocean);
      this.ocean = ocean;
      // 远处岛屿剪影
      for (let i = 0; i < 9; i++) {
        const a = rnd(0, Math.PI * 2), d = rnd(600, 1500);
        const isl = new THREE.Mesh(new THREE.ConeGeometry(rnd(60, 160), rnd(60, 190), 7), mat('#2c3a4a', { roughness: 1 }));
        isl.position.set(Math.cos(a) * d, -10, Math.sin(a) * d);
        land.add(isl);
      }
    } else if (name === 'neon') {
      const g = new THREE.Mesh(new THREE.PlaneGeometry(2600, 2600), mat('#14151d', { roughness: 0.55, metalness: 0.3 }));
      g.rotation.x = -Math.PI / 2; g.receiveShadow = true;
      land.add(g);
    } else if (name === 'storm') {
      const g = new THREE.Mesh(new THREE.PlaneGeometry(3000, 3000, 90, 90), mat('#3c4535', { roughness: 0.98 }));
      const pa = g.geometry.attributes.position;
      for (let i = 0; i < pa.count; i++) {
        const x = pa.getX(i), y = pa.getY(i);
        const d = Math.hypot(x, y);
        const h = this.noise.fbm(x * 0.012 + 11, 3) * 9 + this.noise.fbm(y * 0.011, 2) * 7;
        // 靠近赛道压平并贴合路面高度，避免地形淹没公路
        pa.setZ(i, this._groundHeight(x, y, h * smoothstep(120, 420, Math.hypot(x, y))) - 0.6);
      }
      g.geometry.computeVertexNormals();
      g.receiveShadow = true;
      land.add(g);
      // 远山
      for (let i = 0; i < 16; i++) {
        const a = rnd(0, Math.PI * 2), d = rnd(500, 1200);
        const mt = new THREE.Mesh(new THREE.ConeGeometry(rnd(120, 300), rnd(180, 420), 6), mat('#2a313a', { roughness: 1 }));
        mt.position.set(Math.cos(a) * d, 60, Math.sin(a) * d);
        land.add(mt);
      }
    } else {
      // 沙漠
      const g = new THREE.Mesh(new THREE.PlaneGeometry(3200, 3200, 110, 110), mat('#c08a52', { roughness: 1 }));
      const pa = g.geometry.attributes.position;
      for (let i = 0; i < pa.count; i++) {
        const x = pa.getX(i), y = pa.getY(i);
        const h = this.noise.fbm(x * 0.006, 4) * 13 + this.noise.fbm(y * 0.005 + 5, 3) * 10;
        pa.setZ(i, this._groundHeight(x, y, h - 1.2));
      }
      g.geometry.computeVertexNormals();
      g.receiveShadow = true;
      land.add(g);
      // 台地
      for (let i = 0; i < 12; i++) {
        const a = rnd(0, Math.PI * 2), d = rnd(280, 900);
        const h = rnd(40, 130), r = rnd(40, 110);
        const mesa = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.82, r, h, 9, 1), mat(i % 2 ? '#9a5f36' : '#b5713d', { roughness: 1 }));
        mesa.position.set(Math.cos(a) * d, h / 2 - 6, Math.sin(a) * d);
        land.add(mesa);
      }
    }
    this.terrainGroup.add(land);
    this.land = land;
  }

  _buildProps(name, p) {
    const G = this.propGroup;
    const rndSeeded = mulberry32(name.length * 991 + 17);

    // --- 沿路灯柱 / 电线杆 ---
    const poleMat = mat('#2f333a', { roughness: 0.6, metalness: 0.55 });
    const lampCount = name === 'neon' ? 56 : name === 'desert' ? 22 : 34;
    const poleGeo = new THREE.CylinderGeometry(0.16, 0.22, 8.4, 8);
    const poleInst = new THREE.InstancedMesh(poleGeo, poleMat, lampCount);
    const armGeo = new THREE.BoxGeometry(1.9, 0.16, 0.16);
    const armInst = new THREE.InstancedMesh(armGeo, poleMat, lampCount);
    const dummy = new THREE.Object3D();
    const lampPositions = [];
    for (let i = 0; i < lampCount; i++) {
      const u = (i / lampCount) * 0.5;
      const f = this.frameAt(u);
      const side = i % 2 === 0 ? 1 : -1;
      const p0 = f.pos.clone().addScaledVector(f.side, side * 8.0);
      dummy.position.copy(p0).add(new THREE.Vector3(0, 4.2, 0));
      dummy.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), f.up);
      dummy.updateMatrix();
      poleInst.setMatrixAt(i, dummy.matrix);
      const armP = p0.clone().addScaledVector(f.side, -side * 0.95).add(new THREE.Vector3(0, 8.1, 0));
      dummy.position.copy(armP);
      dummy.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), f.side);
      dummy.updateMatrix();
      armInst.setMatrixAt(i, dummy.matrix);
      lampPositions.push(armP.clone().addScaledVector(f.side, -side * 0.85));
    }
    poleInst.castShadow = true;
    G.add(poleInst, armInst);

    // 灯头
    const lampMat = emissive(name === 'neon' ? '#8ad8ff' : name === 'storm' ? '#cfd8e4' : '#ffc879', name === 'neon' ? 3.4 : 1.8);
    const headGeo = new THREE.SphereGeometry(0.34, 10, 8);
    const headInst = new THREE.InstancedMesh(headGeo, lampMat, lampCount);
    for (let i = 0; i < lampCount; i++) {
      dummy.position.copy(lampPositions[i]);
      dummy.quaternion.identity();
      dummy.scale.set(1, 0.7, 1);
      dummy.updateMatrix();
      headInst.setMatrixAt(i, dummy.matrix);
    }
    G.add(headInst);
    this.lampPositions = lampPositions;
    this.lampMat = lampMat;

    // --- 树木 / 仙人掌 ---
    if (name === 'coast' || name === 'storm') {
      const count = name === 'storm' ? 190 : 130;
      const trunkGeo = new THREE.CylinderGeometry(0.24, 0.42, 5.2, 6);
      const trunkMat = mat('#3c2c20', { roughness: 1 });
      const ti = new THREE.InstancedMesh(trunkGeo, trunkMat, count);
      const coneGeo = new THREE.ConeGeometry(2.3, 8.5, 7);
      const coneMat = mat(name === 'storm' ? '#26382a' : '#2f4a2c', { roughness: 0.95 });
      const ci = new THREE.InstancedMesh(coneGeo, coneMat, count * 2);
      for (let i = 0; i < count; i++) {
        const u = rndSeeded(), side = rndSeeded() < 0.5 ? 1 : -1;
        const f = this.frameAt(u);
        const d = rndSeeded() * 90 + 16;
        const pos = f.pos.clone().addScaledVector(f.side, side * d);
        const s = 0.7 + rndSeeded() * 0.9;
        dummy.position.set(pos.x, f.pos.y + 2.6 * s, pos.z);
        dummy.quaternion.identity();
        dummy.scale.setScalar(s);
        dummy.updateMatrix(); ti.setMatrixAt(i, dummy.matrix);
        for (let k = 0; k < 2; k++) {
          dummy.position.set(pos.x, f.pos.y + (k === 0 ? 6.2 : 9.4) * s, pos.z);
          dummy.scale.setScalar(s * (k === 0 ? 1 : 0.68));
          dummy.updateMatrix(); ci.setMatrixAt(i * 2 + k, dummy.matrix);
        }
      }
      ti.castShadow = true; ci.castShadow = true;
      G.add(ti, ci);
    }
    if (name === 'desert') {
      const count = 120;
      const cactusMat = mat('#3f6b46', { roughness: 0.9 });
      const cg = new THREE.CylinderGeometry(0.55, 0.7, 5.4, 8);
      const ci = new THREE.InstancedMesh(cg, cactusMat, count);
      for (let i = 0; i < count; i++) {
        const u = rndSeeded(), side = rndSeeded() < 0.5 ? 1 : -1;
        const f = this.frameAt(u);
        const d = rndSeeded() * 130 + 14;
        const pos = f.pos.clone().addScaledVector(f.side, side * d);
        dummy.position.set(pos.x, f.pos.y + 2.7, pos.z);
        dummy.rotation.z = (rndSeeded() - 0.5) * 0.25;
        dummy.scale.setScalar(0.8 + rndSeeded() * 0.8);
        dummy.updateMatrix(); ci.setMatrixAt(i, dummy.matrix);
      }
      ci.castShadow = true;
      G.add(ci);
    }
    if (name === 'neon') {
      // 城市建筑
      const winTex = canvasTexture(256, 512, (ctx, w, h) => {
        ctx.fillStyle = '#080a12'; ctx.fillRect(0, 0, w, h);
        const r = mulberry32(31);
        for (let y = 8; y < h - 10; y += 14) {
          for (let x = 8; x < w - 10; x += 16) {
            const on = r() > 0.42;
            const col = r() > 0.78 ? '#ffd48a' : r() > 0.5 ? '#8fd8ff' : '#e8ecff';
            ctx.fillStyle = on ? col : '#101423';
            ctx.globalAlpha = on ? 0.55 + r() * 0.45 : 1;
            ctx.fillRect(x, y, 9, 8);
          }
        }
        ctx.globalAlpha = 1;
      });
      const bMat = new THREE.MeshStandardMaterial({ map: winTex, emissiveMap: winTex, emissive: new THREE.Color('#ffffff'), emissiveIntensity: 1.1, roughness: 0.6, metalness: 0.2 });
      const geo = new THREE.BoxGeometry(1, 1, 1);
      const count = 150;
      const inst = new THREE.InstancedMesh(geo, bMat, count);
      let placed = 0, guard = 0;
      while (placed < count && guard < 3000) {
        guard++;
        const a = rndSeeded() * Math.PI * 2, d = rndSeeded() * 420 + 60;
        const x = Math.cos(a) * d, z = Math.sin(a) * d;
        if (this._distToTrack(x, z) < 34) continue;
        const h = rndSeeded() * 150 + 28, w = rndSeeded() * 26 + 14;
        dummy.position.set(x, h / 2 - 1, z);
        dummy.rotation.set(0, rndSeeded() * Math.PI, 0);
        dummy.scale.set(w, h, w * (0.7 + rndSeeded() * 0.7));
        dummy.updateMatrix(); inst.setMatrixAt(placed++, dummy.matrix);
      }
      inst.count = placed;
      inst.castShadow = false;
      G.add(inst);

      // 霓虹招牌
      const neonCols = ['#ff3d81', '#39f5ff', '#b46bff', '#ffe14d'];
      for (let i = 0; i < 26; i++) {
        const u = rndSeeded(), side = rndSeeded() < 0.5 ? 1 : -1;
        const f = this.frameAt(u);
        const pos = f.pos.clone().addScaledVector(f.side, side * (rndSeeded() * 26 + 18));
        const c = neonCols[i % neonCols.length];
        const bar = roundedBox(rndSeeded() * 9 + 3, rndSeeded() * 1.6 + 0.5, 0.4, 0.15, emissive(c, 3.2));
        bar.position.set(pos.x, f.pos.y + rndSeeded() * 9 + 4, pos.z);
        bar.rotation.y = rndSeeded() * Math.PI;
        G.add(bar);
      }
    }

    // --- 岩石 ---
    const rockCount = 90;
    const rockGeo = new THREE.IcosahedronGeometry(1, 0);
    const rockMat = mat(name === 'neon' ? '#2a2d38' : name === 'desert' ? '#a9713d' : '#6a5b48', { roughness: 1 });
    const ri = new THREE.InstancedMesh(rockGeo, rockMat, rockCount);
    for (let i = 0; i < rockCount; i++) {
      const u = rndSeeded(), side = rndSeeded() < 0.5 ? 1 : -1;
      const f = this.frameAt(u);
      const d = rndSeeded() * 150 + 12;
      const pos = f.pos.clone().addScaledVector(f.side, side * d);
      const s = rndSeeded() * 3.6 + 0.6;
      dummy.position.set(pos.x, f.pos.y + s * 0.25, pos.z);
      dummy.rotation.set(rndSeeded() * 3, rndSeeded() * 3, rndSeeded() * 3);
      dummy.scale.set(s, s * 0.72, s * 0.9);
      dummy.updateMatrix(); ri.setMatrixAt(i, dummy.matrix);
    }
    ri.castShadow = true;
    G.add(ri);

    // --- 路肩护栏桩 + 里程牌 ---
    const markerMat = mat('#e8e3d2', { roughness: 0.8 });
    for (let i = 0; i < 40; i++) {
      const u = i / 40;
      const f = this.frameAt(u);
      const post = cyl(0.12, 0.12, 1.1, markerMat, 6);
      post.position.copy(f.pos).addScaledVector(f.side, 7.2);
      post.position.y += 0.55;
      G.add(post);
    }
    // 指示牌
    for (const [u, txt] of [[0.18, 'PELICAN BAY →'], [0.38, 'GRAND PRIX 12KM'], [0.72, 'REST AREA ⤴'], [0.88, 'WELCOME']]) {
      const f = this.frameAt(u);
      const cvs = document.createElement('canvas');
      cvs.width = 512; cvs.height = 128;
      const ctx = cvs.getContext('2d');
      ctx.fillStyle = '#0e1a2c'; ctx.fillRect(0, 0, 512, 128);
      ctx.strokeStyle = '#f2c26b'; ctx.lineWidth = 5; ctx.strokeRect(8, 8, 496, 112);
      ctx.fillStyle = '#f2c26b';
      ctx.font = 'bold 48px "Arial Narrow", Impact, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(txt, 256, 66);
      const tex = new THREE.CanvasTexture(cvs); tex.colorSpace = THREE.SRGBColorSpace;
      const board = new THREE.Mesh(new THREE.PlaneGeometry(6, 1.5), new THREE.MeshStandardMaterial({
        map: tex, emissiveMap: tex, emissive: new THREE.Color('#ffffff'), emissiveIntensity: 0.35, roughness: 0.6, side: THREE.DoubleSide,
      }));
      board.position.copy(f.pos).addScaledVector(f.side, 10).add(new THREE.Vector3(0, 4.2, 0));
      board.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), f.side);
      G.add(board);
      const pst = cyl(0.12, 0.14, 4.4, mat('#3a3f47'), 6);
      pst.position.copy(board.position).add(new THREE.Vector3(0, -2.2, 0));
      G.add(pst);
    }

    // --- 灯塔（海岸）---
    if (name === 'coast') {
      const f = this.frameAt(0.12);
      const pos = f.pos.clone().addScaledVector(f.side, -95);
      const lg = new THREE.Group();
      const body = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 5.2, 34, 16), mat('#f0ece2', { roughness: 0.8 }));
      body.position.y = 17; body.castShadow = true;
      lg.add(body);
      for (let i = 0; i < 3; i++) {
        const st = new THREE.Mesh(new THREE.CylinderGeometry(3.3, 3.5, 4, 16), mat('#d8412f', { roughness: 0.8 }));
        st.position.y = 8 + i * 11; lg.add(st);
      }
      const lamp = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.6, 4, 12), emissive('#ffe9a8', 3));
      lamp.position.y = 36; lg.add(lamp);
      const beam = new THREE.Mesh(new THREE.ConeGeometry(9, 90, 16, 1, true),
        new THREE.MeshBasicMaterial({ color: '#ffe9a8', transparent: true, opacity: 0.09, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
      beam.rotation.z = Math.PI / 2; beam.position.set(45, 36, 0);
      lg.add(beam);
      this.beam = beam;
      lg.position.set(pos.x, f.pos.y - 2, pos.z);
      G.add(lg);
      this.lighthouse = lg;
    }
  }

  _distToTrack(x, z) {
    return this._nearestTrack(x, z).d;
  }

  /** 找到最接近赛道的点（返回参数 u 与距离），使用缓存折线加速 */
  _nearestTrack(x, z) {
    if (!this._trackPts) {
      this._trackPts = [];
      for (let i = 0; i < 240; i++) this._trackPts.push(this.curve.getPointAt(i / 240));
    }
    const pts = this._trackPts;
    let bestU = 0, bestD = Infinity;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const d = (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z);
      if (d < bestD) { bestD = d; bestU = i / pts.length; }
    }
    return { u: bestU, d: Math.sqrt(bestD) };
  }

  /** 地形高度：靠近赛道时贴合路面高度，避免出现路堑 */
  _groundHeight(x, z, rawH) {
    const n = this._nearestTrack(x, z);
    const roadY = this.roadHeightAt(n.u);
    const k = smoothstep(16, 90, n.d);
    return lerp(roadY - 0.35, rawH, k);
  }

  /* ---------------------------- 每帧 ---------------------------- */
  update(dt, camPos, focus) {
    // 太阳跟随焦点，保证阴影贴图精度
    const sd = sunDirection(this.timeOfDay, this.preset.sun.azimuth);
    const f = focus || camPos;
    this.sun.position.set(f.x + sd.x * 120, f.y + Math.max(sd.y, 0.12) * 160, f.z + sd.z * 120);
    this.sun.target.position.set(f.x, f.y, f.z);
    this.sun.target.updateMatrixWorld();
    this.rim.position.set(f.x - 80, f.y + 70, f.z + 90);
    this.rim.target.position.set(f.x, f.y, f.z);
    this.rim.target.updateMatrixWorld();
    this.rim.target.updateMatrixWorld();

    this.sky.update(dt, camPos);
    if (this.particles) this.particles.update(dt, camPos);

    // 灯塔光束旋转
    if (this.beam) {
      this.beam.parent.rotation.y += dt * 0.55;
    }

    // 雷暴闪电
    if (this.presetName === 'storm') {
      this._lightningTimer -= dt;
      if (this._lightningTimer <= 0) {
        this._lightningTimer = rnd(3.5, 9);
        this.lightning = 1.0;
        this.onLightning?.(rnd(0.5, 1.2));
      }
    }
    if (this.lightning > 0) this.lightning = Math.max(0, this.lightning - dt * 3.2);
  }

  setTimeOfDay(t) {
    this.timeOfDay = clamp(t, 0, 1);
    const p = this.preset;
    const sd = sunDirection(this.timeOfDay, p.sun.azimuth);
    this.sky.set({ sunDir: sd });
    this.sky.uniforms.uSunGlow.value = p.sky.sunGlow * (0.5 + Math.sin(this.timeOfDay * Math.PI) * 0.7);
    this.sun.intensity = p.sun.intensity * (0.25 + Math.sin(clamp(this.timeOfDay, 0, 1) * Math.PI) * 0.95);
    this.hemi.intensity = p.hemi.intensity * (0.45 + Math.sin(clamp(this.timeOfDay, 0, 1) * Math.PI) * 0.75);
  }

  setFog(v) {
    this.scene.fog.density = lerp(0.0005, 0.012, v);
  }
}
