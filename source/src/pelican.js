import * as THREE from 'three';
import {
  mat, phys, emissive, cyl, sphere, roundedBox, solveIK, clamp, lerp, damp, TAU,
  smoothstep, easeInOutCubic, Noise1D, canvasTexture,
} from './util.js';

/* ==================================================================== */
/*  姿势定义：所有数值可线性插值                                          */
/* ==================================================================== */
const POSE = {
  /* 站在地面 */
  stand: {
    bodyY: 0.62, bodyPitch: 0.10, bodyRoll: 0, bodyYaw: 0,
    neckP: [-0.45, -0.34, -0.10, 0.10, 0.20, 0.14, 0.04],
    neckY: [0, 0.03, 0.04, 0.02, 0, 0, 0],
    headPitch: -0.08, headYaw: 0, headRoll: 0,
    beakOpen: 0.06, pouch: 0.35,
    wingLPitch: 0.15, wingLRoll: 0.55, wingLTwist: 0.1,
    wingRPitch: 0.15, wingRRoll: -0.55, wingRTwist: -0.1,
    tailPitch: -0.25,
    legSpread: 0.16, kneeFwd: 0.0,
    scarf: 0.5, scarfFlap: 0.2,
  },
  /* 骑自行车 */
  ride: {
    bodyY: 0.0, bodyPitch: 0.40, bodyRoll: 0, bodyYaw: 0,
    neckP: [-0.18, -0.14, 0.04, 0.12, 0.12, 0.08, 0.04],
    neckY: [0, 0.02, 0.03, 0.02, 0, 0, 0],
    headPitch: -0.48, headYaw: 0, headRoll: 0,
    beakOpen: 0.10, pouch: 0.55,
    wingLPitch: 1.28, wingLRoll: 0.16, wingLTwist: 0.0,
    wingRPitch: 1.28, wingRRoll: -0.16, wingRTwist: 0.0,
    tailPitch: -0.45,
    legSpread: 0.0, kneeFwd: 0.0,
    scarf: 1.0, scarfFlap: 1.0,
  },
  /* 走路 */
  walk: {
    bodyY: 0.58, bodyPitch: 0.16, bodyRoll: 0, bodyYaw: 0,
    neckP: [-0.45, -0.34, -0.10, 0.10, 0.20, 0.14, 0.04],
    neckY: [0, 0.02, 0.03, 0.02, 0, 0, 0],
    headPitch: -0.05, headYaw: 0, headRoll: 0,
    beakOpen: 0.10, pouch: 0.42,
    wingLPitch: 0.05, wingLRoll: 0.95, wingLTwist: 0.2,
    wingRPitch: 0.05, wingRRoll: -0.95, wingRTwist: -0.2,
    tailPitch: -0.18,
    legSpread: 0.20, kneeFwd: 0.0,
    scarf: 0.8, scarfFlap: 0.5,
  },
  /* 坐进驾驶座 */
  sit: {
    bodyY: 0.0, bodyPitch: 0.06, bodyRoll: 0, bodyYaw: 0,
    neckP: [-0.38, -0.30, -0.08, 0.12, 0.18, 0.14, 0.05],
    neckY: [0, 0.02, 0.03, 0.02, 0, 0, 0],
    headPitch: -0.04, headYaw: 0, headRoll: 0,
    beakOpen: 0.04, pouch: 0.30,
    wingLPitch: 1.05, wingLRoll: 0.42, wingLTwist: -0.15,
    wingRPitch: 1.05, wingRRoll: -0.42, wingRTwist: 0.15,
    tailPitch: -0.1,
    legSpread: 0.0, kneeFwd: 1.0,
    scarf: 0.6, scarfFlap: 0.3,
  },
  /* 腾空 */
  air: {
    bodyY: 0.0, bodyPitch: -0.08, bodyRoll: 0, bodyYaw: 0,
    neckP: [-0.05, 0.02, 0.10, 0.12, 0.10, 0.06, 0.03],
    neckY: [0, 0.02, 0.03, 0.02, 0, 0, 0],
    headPitch: -0.30, headYaw: 0, headRoll: 0,
    beakOpen: 0.45, pouch: 0.9,
    wingLPitch: 0.0, wingLRoll: 1.35, wingLTwist: 0.0,
    wingRPitch: 0.0, wingRRoll: -1.35, wingRTwist: 0.0,
    tailPitch: 0.2,
    legSpread: 0.05, kneeFwd: 0.0,
    scarf: 1.2, scarfFlap: 1.4,
  },
};

function blankPose() { const o = {}; for (const k in POSE.stand) o[k] = Array.isArray(POSE.stand[k]) ? POSE.stand[k].slice() : POSE.stand[k]; return o; }
function copyInto(a, b) { for (const k in b) { if (Array.isArray(b[k])) { if (!Array.isArray(a[k])) a[k] = b[k].slice(); else for (let i = 0; i < b[k].length; i++) a[k][i] = b[k][i]; } else a[k] = b[k]; } return a; }
function lerpPose(a, b, t) {
  for (const k in b) {
    if (Array.isArray(b[k])) { for (let i = 0; i < b[k].length; i++) a[k][i] = lerp(a[k][i], b[k][i], t); }
    else a[k] = lerp(a[k], b[k], t);
  }
  return a;
}

/* ==================================================================== */
/*  Pelican                                                              */
/* ==================================================================== */
export class Pelican {
  constructor() {
    this.root = new THREE.Group();
    this.root.name = 'pelican';
    this.noise = new Noise1D(88);
    this.pose = blankPose();
    this.blend = { ride: 0, stand: 0, walk: 0, sit: 0, air: 0 };
    this.crankAngle = 0;
    this.stepPhase = 0;
    this.headLook = 0;
    this.headLookTarget = 0;
    this.lookTimer = 2;
    this.beakTimer = 3;
    this.beakImpulse = 0;
    this.flapPhase = 0;
    this.waddle = 0;
    this._ik = new THREE.Vector3();
    this._tmp = new THREE.Vector3();
    this._legTarget = new THREE.Vector3();
    this._legLocal = new THREE.Vector3();
    this._hipLocal = new THREE.Vector3();
    this._pole = new THREE.Vector3();
    this._boneDir = new THREE.Vector3();
    this._w1 = new THREE.Vector3();
    this._w2 = new THREE.Vector3();
    this._w3 = new THREE.Vector3();
    this._invQ = new THREE.Quaternion();
    this._q2 = new THREE.Quaternion();
    this._q3 = new THREE.Quaternion();
    this._UP = new THREE.Vector3(0, 1, 0);
    this._NEG_Y = new THREE.Vector3(0, -1, 0);

    this._build();
  }

  _build() {
    const M = {
      body: mat('#f6f1e6', { roughness: 0.82, metalness: 0.0 }),
      bodyShade: mat('#e7e0d1', { roughness: 0.85 }),
      wing: mat('#ece5d6', { roughness: 0.8 }),
      wingTip: mat('#2f333c', { roughness: 0.6, metalness: 0.1 }),
      beak: mat('#f9a93f', { roughness: 0.38, metalness: 0.05 }),
      beakTip: mat('#e2673a', { roughness: 0.42 }),
      pouch: mat('#dfa07f', { roughness: 0.55, transparent: true, opacity: 0.94 }),
      leg: mat('#cf9068', { roughness: 0.62 }),
      eye: new THREE.MeshStandardMaterial({ color: '#0a0b0e', roughness: 0.15, metalness: 0.2 }),
      glint: new THREE.MeshBasicMaterial({ color: '#ffffff' }),
      scarf: mat('#d8402f', { roughness: 0.85, side: THREE.DoubleSide }),
      tongue: mat('#c8586a', { roughness: 0.6 }),
    };
    this.M = M;

    /* ---------- 身体 ---------- */
    this.bodyPivot = new THREE.Group();
    this.root.add(this.bodyPivot);

    const torso = sphere(0.5, M.body, 24, 18);
    torso.scale.set(0.78, 0.82, 1.32);
    torso.castShadow = true;
    this.bodyPivot.add(torso);

    const belly = sphere(0.42, M.bodyShade, 20, 14);
    belly.scale.set(0.74, 0.7, 1.05);
    belly.position.set(0, -0.12, 0.12);
    this.bodyPivot.add(belly);

    // 背脊绒毛
    const back = sphere(0.36, M.body, 16, 12);
    back.scale.set(0.6, 0.5, 1.0);
    back.position.set(0, 0.24, -0.05);
    this.bodyPivot.add(back);

    // 尾
    this.tailPivot = new THREE.Group();
    this.tailPivot.position.set(0, 0.06, -0.62);
    this.bodyPivot.add(this.tailPivot);
    const tailShape = new THREE.Shape();
    tailShape.moveTo(0, 0); tailShape.quadraticCurveTo(0.18, 0.26, 0.05, 0.5);
    tailShape.lineTo(-0.05, 0.5); tailShape.quadraticCurveTo(-0.18, 0.26, 0, 0);
    const tailGeo = new THREE.ExtrudeGeometry(tailShape, { depth: 0.05, bevelEnabled: true, bevelSize: 0.02, bevelThickness: 0.02, bevelSegments: 2, curveSegments: 6 });
    const tail = new THREE.Mesh(tailGeo, M.wing);
    tail.rotation.x = Math.PI / 2 - 0.2;
    tail.castShadow = true;
    this.tailPivot.add(tail);
    const tailTip = new THREE.Mesh(tailGeo, M.wingTip);
    tailTip.scale.set(0.7, 0.7, 0.9);
    tailTip.position.set(0, 0, 0.22);
    tailTip.rotation.x = Math.PI / 2 - 0.2;
    this.tailPivot.add(tailTip);

    /* ---------- 翅膀 ---------- */
    // 翅膀自肩部向 -Y（体侧后方）展开，翼尖羽在末端
    const wingShape = new THREE.Shape();
    wingShape.moveTo(0, 0);
    wingShape.bezierCurveTo(0.17, -0.36, 0.09, -0.82, -0.02, -1.14);
    wingShape.bezierCurveTo(-0.13, -0.86, -0.21, -0.40, -0.11, -0.02);
    wingShape.quadraticCurveTo(-0.05, 0.05, 0, 0);
    const wingGeo = new THREE.ExtrudeGeometry(wingShape, { depth: 0.07, bevelEnabled: true, bevelSize: 0.025, bevelThickness: 0.025, bevelSegments: 3, curveSegments: 10 });
    wingGeo.translate(0, 0, -0.035);
    wingGeo.rotateY(Math.PI / 2);

    this.wingL = new THREE.Group(); this.wingR = new THREE.Group();
    this.wingL.position.set(0.34, 0.14, 0.02);
    this.wingR.position.set(-0.34, 0.14, 0.02);
    this.bodyPivot.add(this.wingL, this.wingR);

    this.wingLMid = new THREE.Group(); this.wingRMid = new THREE.Group();
    this.wingL.add(this.wingLMid); this.wingR.add(this.wingRMid);
    const wm = new THREE.Mesh(wingGeo, M.wing);
    wm.castShadow = true;
    this.wingLMid.add(wm);
    const wmr = new THREE.Mesh(wingGeo, M.wing);
    wmr.castShadow = true;
    this.wingRMid.add(wmr);

    // 翼尖（深色飞羽）
    this.wingLEnd = new THREE.Group(); this.wingREnd = new THREE.Group();
    this.wingLEnd.position.set(0, -1.08, 0);
    this.wingREnd.position.set(0, -1.08, 0);
    this.wingLMid.add(this.wingLEnd); this.wingRMid.add(this.wingREnd);
    const tipGeo = new THREE.ExtrudeGeometry(wingShape, { depth: 0.06, bevelEnabled: true, bevelSize: 0.02, bevelThickness: 0.02, bevelSegments: 2, curveSegments: 8 });
    tipGeo.translate(0, 0, -0.03); tipGeo.rotateY(Math.PI / 2); tipGeo.scale(0.66, 0.62, 0.8);
    const tl = new THREE.Mesh(tipGeo, M.wingTip); tl.castShadow = true;
    const tr = new THREE.Mesh(tipGeo, M.wingTip); tr.castShadow = true;
    this.wingLEnd.add(tl); this.wingREnd.add(tr);

    // 初级飞羽（几根长条）
    for (let i = 0; i < 4; i++) {
      const f = roundedBox(0.03, 0.52 - i * 0.06, 0.11, 0.01, M.wingTip, 0.01);
      f.position.set(0.02, -0.2, -0.02 - i * 0.05);
      f.rotation.z = -0.08 + i * 0.05;
      this.wingLEnd.add(f);
      const f2 = f.clone();
      this.wingREnd.add(f2);
    }

    /* ---------- 脖子（链式）---------- */
    this.neckSegs = [];
    this.neckBase = new THREE.Group();
    this.neckBase.position.set(0, 0.26, 0.5);
    this.bodyPivot.add(this.neckBase);
    let parent = this.neckBase;
    const SEG = 0.135;
    for (let i = 0; i < 7; i++) {
      const g = new THREE.Group();
      g.position.set(0, i === 0 ? 0 : SEG, 0);
      parent.add(g);
      const r0 = lerp(0.145, 0.095, i / 6), r1 = lerp(0.145, 0.095, (i + 1) / 6);
      const seg = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, SEG * 1.7, 12, 1), M.body);
      seg.position.y = SEG / 2;
      seg.castShadow = true;
      g.add(seg);
      this.neckSegs.push(g);
      parent = g;
    }

    /* ---------- 头 ---------- */
    this.headPivot = new THREE.Group();
    this.headPivot.position.set(0, SEG, 0);
    parent.add(this.headPivot);

    const head = sphere(0.175, M.body, 18, 14);
    head.scale.set(0.95, 1.0, 1.05);
    head.castShadow = true;
    this.headPivot.add(head);

    // 头顶冠羽
    const crest = roundedBox(0.12, 0.18, 0.1, 0.05, M.body, 0.02);
    crest.position.set(0, 0.16, -0.02);
    crest.rotation.x = -0.4;
    this.headPivot.add(crest);

    // 眼睛
    this.eyeL = sphere(0.042, M.eye, 12, 10); this.eyeR = sphere(0.042, M.eye, 12, 10);
    this.eyeL.position.set(0.115, 0.045, 0.08);
    this.eyeR.position.set(-0.115, 0.045, 0.08);
    this.headPivot.add(this.eyeL, this.eyeR);
    const gl = sphere(0.016, M.glint, 8, 6); gl.position.set(0.128, 0.062, 0.105);
    const gr = sphere(0.016, M.glint, 8, 6); gr.position.set(-0.128, 0.062, 0.105);
    this.headPivot.add(gl, gr);
    // 眼眶
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.012, 6, 14), mat('#e5d9b8'));
    ring.position.set(0.115, 0.045, 0.078); ring.rotation.y = Math.PI / 2;
    this.headPivot.add(ring);
    const ring2 = ring.clone(); ring2.position.set(-0.115, 0.045, 0.078);
    this.headPivot.add(ring2);

    /* ---------- 喙 ---------- */
    this.beakPivot = new THREE.Group();
    this.beakPivot.position.set(0, -0.02, 0.13);
    this.headPivot.add(this.beakPivot);

    // 上喙：锥形 + 钩
    const upperShape = new THREE.Shape();
    upperShape.moveTo(0, 0.03);
    upperShape.bezierCurveTo(0.22, 0.075, 0.62, 0.035, 0.86, -0.005);
    upperShape.quadraticCurveTo(0.92, -0.035, 0.84, -0.06);
    upperShape.bezierCurveTo(0.6, -0.085, 0.22, -0.075, 0, -0.045);
    upperShape.quadraticCurveTo(-0.04, -0.01, 0, 0.03);
    const upperGeo = new THREE.ExtrudeGeometry(upperShape, { depth: 0.13, bevelEnabled: true, bevelSize: 0.022, bevelThickness: 0.022, bevelSegments: 3, curveSegments: 12 });
    upperGeo.rotateY(-Math.PI / 2); upperGeo.translate(0.065, 0, 0);
    const upper = new THREE.Mesh(upperGeo, M.beak);
    upper.castShadow = true;
    this.beakPivot.add(upper);
    // 喙尖
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.055, 0.14, 8), M.beakTip);
    tip.rotation.x = Math.PI / 2; tip.position.set(0, -0.025, 0.86);
    this.beakPivot.add(tip);
    // 鼻孔
    for (const s of [1, -1]) {
      const n = sphere(0.014, M.beakTip, 6, 5);
      n.position.set(s * 0.035, 0.03, 0.2);
      this.beakPivot.add(n);
    }

    // 下喙 + 喉囊
    this.lowerJaw = new THREE.Group();
    this.lowerJaw.position.set(0, -0.035, 0.02);
    this.beakPivot.add(this.lowerJaw);
    const lowerShape = new THREE.Shape();
    lowerShape.moveTo(0, 0);
    lowerShape.quadraticCurveTo(0.42, -0.05, 0.8, -0.02);
    lowerShape.quadraticCurveTo(0.4, -0.1, 0, -0.055);
    const lowerGeo = new THREE.ExtrudeGeometry(lowerShape, { depth: 0.11, bevelEnabled: true, bevelSize: 0.018, bevelThickness: 0.018, bevelSegments: 2, curveSegments: 10 });
    lowerGeo.rotateY(-Math.PI / 2); lowerGeo.translate(0.055, 0, 0);
    const lower = new THREE.Mesh(lowerGeo, M.beak);
    this.lowerJaw.add(lower);

    this.pouch = sphere(0.5, M.pouch, 18, 14);
    this.pouch.scale.set(0.26, 0.24, 0.5);
    this.pouch.position.set(0, -0.19, 0.32);
    this.pouch.castShadow = true;
    this.lowerJaw.add(this.pouch);
    const tongue = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), M.tongue);
    tongue.scale.set(0.7, 0.35, 1.6);
    tongue.position.set(0, -0.06, 0.18);
    this.lowerJaw.add(tongue);

    /* ---------- 腿 ---------- */
    this.legs = [];
    for (const s of [1, -1]) {
      const hip = new THREE.Group();
      hip.position.set(s * 0.17, -0.2, 0.02);
      this.bodyPivot.add(hip);
      const thigh = new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.052, 1, 10), M.leg);
      thigh.geometry.translate(0, 0.5, 0);
      thigh.castShadow = true;
      const knee = new THREE.Group();
      hip.add(knee); knee.add(thigh);
      const shin = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.04, 1, 10), M.leg);
      shin.geometry.translate(0, 0.5, 0);
      shin.castShadow = true;
      const ankle = new THREE.Group();
      knee.add(ankle); ankle.add(shin);
      // 蹼足
      const footShape = new THREE.Shape();
      footShape.moveTo(0, 0);
      footShape.lineTo(0.055, 0.08); footShape.lineTo(0.12, 0.2);
      footShape.lineTo(0.07, 0.19); footShape.lineTo(0.09, 0.27);
      footShape.lineTo(0.0, 0.23); footShape.lineTo(-0.09, 0.27);
      footShape.lineTo(-0.07, 0.19); footShape.lineTo(-0.12, 0.2);
      footShape.lineTo(-0.055, 0.08);
      const footGeo = new THREE.ExtrudeGeometry(footShape, { depth: 0.035, bevelEnabled: true, bevelSize: 0.012, bevelThickness: 0.012, bevelSegments: 2, curveSegments: 4 });
      footGeo.rotateX(-Math.PI / 2);
      const foot = new THREE.Mesh(footGeo, M.leg);
      foot.position.set(0, 0, 0.0);
      foot.castShadow = true;
      ankle.add(foot);
      this.legs.push({ side: s, hip, knee, ankle, thigh, shin, foot, L1: 0.30, L2: 0.32 });
    }

    /* ---------- 围巾 ---------- */
    this.scarf = [];
    let spar = this.bodyPivot;
    const scarfRoot = new THREE.Group();
    scarfRoot.position.set(0, 0.3, 0.42);
    this.bodyPivot.add(scarfRoot);
    spar = scarfRoot;
    for (let i = 0; i < 6; i++) {
      const g = new THREE.Group();
      g.position.set(0, i === 0 ? 0 : 0.02, i === 0 ? 0 : -0.16);
      spar.add(g);
      const seg = new THREE.Mesh(new THREE.PlaneGeometry(0.17 - i * 0.012, 0.17), M.scarf);
      seg.rotation.x = -Math.PI / 2;
      seg.position.z = -0.08;
      g.add(seg);
      this.scarf.push(g);
      spar = g;
    }
    // 脖子上的围巾结
    const knot = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.045, 6, 14), M.scarf);
    knot.position.set(0, 0.3, 0.42);
    knot.rotation.x = Math.PI / 2 - 0.3;
    this.bodyPivot.add(knot);

    this.root.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; } });
  }

  /* ---------- 姿势控制 ---------- */
  setPose(name, weight = 1) {
    this.blend[name] = weight;
  }
  clearPoses() { for (const k in this.blend) this.blend[k] = 0; }

  /**
   * @param {object} st
   *   mode: 'ride' | 'stand' | 'walk' | 'sit' | 'air'
   *   speed: number
   *   pedalAngle: number  (曲柄角)
   *   pedalRadius
   *   crankCenter: Vector3 (局部)
   *   headTurn: number
   *   blend weights
   */
  update(dt, st) {
    const p = this.pose;
    const w = st.weights || { stand: 1 };
    let best = null, bw = 0;
    for (const k in w) if (POSE[k] && w[k] > bw) { bw = w[k]; best = k; }
    if (!best) { best = 'stand'; bw = 1; }
    copyInto(p, POSE[best]);
    for (const k in w) {
      if (k === best || !POSE[k]) continue;
      const t = clamp(w[k] / Math.max(bw, 0.0001), 0, 1) * 0.5;
      lerpPose(p, POSE[k], t);
    }

    // 头部随机张望
    this.lookTimer -= dt;
    if (this.lookTimer <= 0) { this.lookTimer = 1.6 + Math.random() * 3.4; this.headLookTarget = (Math.random() - 0.5) * 1.0; }
    this.headLook = damp(this.headLook, this.headLookTarget, 2.2, dt);

    // 张嘴
    this.beakTimer -= dt;
    if (this.beakTimer <= 0) { this.beakTimer = 2.4 + Math.random() * 4; this.beakImpulse = 0.5 + Math.random() * 0.5; }
    this.beakImpulse = Math.max(0, this.beakImpulse - dt * 1.6);

    this._applyPose(dt, st);
  }

  _applyPose(dt, st) {
    const p = this.pose;
    const speedN = clamp(st.speed / 22, 0, 1);

    // 身体
    const bob = Math.sin(st.phase * 2) * (0.012 + 0.02 * speedN) * (st.bobAmount ?? 1);
    this.bodyPivot.position.y = p.bodyY + bob;
    this.bodyPivot.rotation.x = p.bodyPitch + (st.bodyPitchAdd ?? 0);
    this.bodyPivot.rotation.z = p.bodyRoll + (st.bodyRollAdd ?? 0);
    this.bodyPivot.rotation.y = p.bodyYaw;
    this.bodyPivot.updateMatrix();
    this._invQ.copy(this.bodyPivot.quaternion).invert();

    // 脖子链
    for (let i = 0; i < this.neckSegs.length; i++) {
      const seg = this.neckSegs[i];
      const sway = this.noise.fbm(st.time * 1.1 + i * 0.7, 2) * 0.035 * (0.4 + speedN);
      seg.rotation.x = p.neckP[i] + sway;
      seg.rotation.y = p.neckY[i] + this.noise.fbm(st.time * 0.9 + i * 1.3, 2) * 0.05;
    }
    this.headPivot.rotation.x = p.headPitch + this.headLook * 0.10;
    this.headPivot.rotation.y = this.headLook + p.headYaw;
    this.headPivot.rotation.z = p.headRoll;

    // 喙
    const open = clamp(p.beakOpen + this.beakImpulse * 0.5, 0, 1);
    this.lowerJaw.rotation.x = open * 0.85;
    this.pouch.scale.set(0.26 + open * 0.05, 0.24 * (0.6 + p.pouch * 0.6) + open * 0.06, 0.5 + open * 0.06);
    this.pouch.position.y = -0.19 - open * 0.02;

    // 翅膀：优先用“握持点”解算，让翼尖准确落在车把/方向盘上
    this._updateWings(dt, st, p);

    // 尾
    this.tailPivot.rotation.x = p.tailPitch;

    // 腿
    this._updateLegs(dt, st, p);

    // 围巾飘动
    const wind = clamp(p.scarf * (0.25 + speedN), 0, 1.6);
    for (let i = 0; i < this.scarf.length; i++) {
      const g = this.scarf[i];
      const t = i / this.scarf.length;
      const w = this.noise.fbm(st.time * (3 + wind * 4) + i * 1.1, 3);
      g.rotation.x = -0.15 - wind * 0.55 + w * 0.25 * wind * p.scarfFlap;
      g.rotation.y = w * 0.4 * wind * p.scarfFlap;
      g.rotation.z = Math.sin(st.time * 4 + i) * 0.12 * wind;
    }
  }

  _updateLegs(dt, st, p) {
    const mode = st.mode;
    const R = st.pedalRadius ?? 0.17;
    const ang = st.pedalAngle || 0;
    const cc = st.crankCenter;

    for (let li = 0; li < 2; li++) {
      const leg = this.legs[li];
      const sgn = li === 0 ? 1 : -1;
      const t = this._legTarget;

      if (mode === 'ride' || mode === 'air') {
        t.set(
          (cc?.x ?? 0) + sgn * (st.pedalX ?? 0.12),
          (cc?.y ?? -0.75) + sgn * Math.cos(ang) * R,
          (cc?.z ?? 0) + sgn * Math.sin(ang) * R,
        );
      } else if (mode === 'sit') {
        t.set(leg.side * 0.16, -0.45, 0.30);
      } else {
        const ph = (st.phase || 0) + (li === 0 ? 0 : Math.PI);
        const stride = st.stride || 0;
        const lift = Math.max(0, Math.sin(ph)) * stride;
        t.set(leg.side * p.legSpread, lift * 0.16, 0.02 + Math.cos(ph) * stride * 0.7);
      }

      // root 空间 → bodyPivot 局部空间
      const local = this._toBodyLocal(t, this._legLocal);

      // 髋（bodyPivot 局部）
      const hipW = this._hipLocal.set(leg.side * p.legSpread * 0.6, -0.2, 0.02);

      // 膝盖极向量
      const pole = this._pole;
      if (mode === 'ride') pole.set(leg.side * 0.35, 0.75, 1);
      else if (mode === 'sit') pole.set(leg.side * 0.25, 0.85, 1);
      else if (mode === 'air') pole.set(leg.side * 0.6, 0.1, 0.9);
      else pole.set(leg.side * 0.22, 0.12, 1);
      pole.normalize();

      const knee = solveIK(hipW, local, leg.L1, leg.L2, pole, this._ik);

      const setBone = (mesh, a, b) => {
        const dir = this._boneDir.subVectors(b, a);
        const len = dir.length() || 0.001;
        mesh.position.copy(a);
        mesh.quaternion.setFromUnitVectors(this._UP, dir.divideScalar(len));
        mesh.scale.set(1, len, 1);
      };
      setBone(leg.thigh, hipW, knee);
      setBone(leg.shin, knee, local);
      leg.ankle.position.copy(local);
      const footAng = (mode === 'ride' || mode === 'air') ? ang + (li === 0 ? 0 : Math.PI) : 0;
      leg.foot.rotation.x = -footAng - (mode === 'sit' ? 0.3 : 0.15);
    }
  }

  _toBodyLocal(v, out) {
    out.copy(v).sub(this.bodyPivot.position);
    out.applyQuaternion(this._invQ);
    return out;
  }

  /** 翅膀：握持点解算 */
  _updateWings(dt, st, p) {
    const flap = st.flap || 0;
    this.flapPhase += dt * (5 + flap * 9);
    const flapAmt = flap * Math.sin(this.flapPhase);

    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? 1 : -1;
      const wing = i === 0 ? this.wingL : this.wingR;
      const mid = i === 0 ? this.wingLMid : this.wingRMid;
      const end = i === 0 ? this.wingLEnd : this.wingREnd;
      const grip = i === 0 ? st.gripL : st.gripR;

      if (grip) {
        this._toBodyLocal(grip, this._w1);
        this._w2.copy(wing.position);
        this._w3.subVectors(this._w1, this._w2);
        const len = this._w3.length() || 0.001;
        this._w3.divideScalar(len);
        // 翅膀沿 -Y 展开：把 -Y 对准握持点
        this._q2.setFromUnitVectors(this._NEG_Y, this._w3);
        this._q3.setFromAxisAngle(this._w3, side * 0.22);
        wing.quaternion.copy(this._q2).multiply(this._q3);
        wing.scale.set(1, clamp(len / 1.14, 0.74, 1.0), 1);
      } else {
        wing.scale.set(1, 1, 1);
        if (i === 0) {
          wing.rotation.set(p.wingLPitch - flapAmt * 0.85, p.wingLTwist, p.wingLRoll + flapAmt * 0.25);
        } else {
          wing.rotation.set(p.wingRPitch - flapAmt * 0.85, p.wingRTwist, p.wingRRoll - flapAmt * 0.25);
        }
      }
      mid.rotation.x = flapAmt * 0.55;
      end.rotation.x = flapAmt * 0.45;
    }
  }
}
