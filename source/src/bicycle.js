import * as THREE from 'three';
import { mat, phys, emissive, cyl, sphere, roundedBox, tube, box, alignSegment, clamp, lerp, damp, TAU } from './util.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

export class Bicycle {
  constructor() {
    this.root = new THREE.Group();
    this.root.name = 'bicycle';
    this.wheelR = 0.42;

    const M = {
      frame: mat('#e03a2f', { roughness: 0.28, metalness: 0.35 }),
      frame2: mat('#f5f5f0', { roughness: 0.3, metalness: 0.25 }),
      chrome: mat('#d8dde4', { roughness: 0.14, metalness: 0.95 }),
      tire: mat('#17181c', { roughness: 0.92 }),
      rim: mat('#c9ced6', { roughness: 0.2, metalness: 0.9 }),
      hub: mat('#2b2f36', { roughness: 0.3, metalness: 0.7 }),
      grip: mat('#25272c', { roughness: 0.85 }),
      saddle: mat('#2c2320', { roughness: 0.7 }),
      chain: mat('#8d949c', { roughness: 0.35, metalness: 0.9 }),
      basket: mat('#a97b3f', { roughness: 0.85 }),
      lamp: emissive('#fff0c0', 2.2),
    };
    this.M = M;

    /* ---------- 坐标 ---------- */
    const rearHub = V(0, this.wheelR, -0.6);
    const frontHub = V(0, this.wheelR, 0.58);
    const bb = V(0, 0.30, -0.02);
    const seatTop = V(0, 0.94, -0.16);
    const headTop = V(0, 1.00, 0.44);
    const headBot = V(0, 0.66, 0.50);

    this.frame = new THREE.Group();
    this.root.add(this.frame);

    const addTube = (a, b, r, m) => {
      const t = tube(a, b, r, m, 10);
      this.frame.add(t);
      return t;
    };
    addTube(seatTop, headTop, 0.028, M.frame);         // 上管
    addTube(headBot, bb, 0.033, M.frame);              // 下管
    addTube(bb, seatTop, 0.030, M.frame);              // 座管
    addTube(seatTop, rearHub, 0.020, M.frame2);        // 后上叉
    addTube(bb, rearHub, 0.022, M.frame2);             // 后下叉
    addTube(headTop, headBot, 0.036, M.frame);          // 头管
    // 头管延长 + 把立
    addTube(headTop, V(0, 1.07, 0.42), 0.030, M.chrome);
    // 五通
    const bbShell = cyl(0.052, 0.052, 0.12, M.chrome, 12);
    bbShell.rotation.z = Math.PI / 2; bbShell.position.copy(bb);
    this.frame.add(bbShell);

    /* ---------- 前叉 + 车把（可转向）---------- */
    this.steer = new THREE.Group();
    this.steer.position.set(0, 0.62, 0.50);
    this.root.add(this.steer);

    const forkLen = V(0, this.wheelR, 0.58).sub(this.steer.position);
    for (const s of [-1, 1]) {
      const t = tube(V(s * 0.055, 0, 0), V(s * 0.055, forkLen.y, forkLen.z), 0.017, M.chrome, 8);
      this.steer.add(t);
    }
    // 车把
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.52, 10), M.chrome);
    bar.rotation.z = Math.PI / 2;
    bar.position.set(0, 0.44, -0.08);
    this.steer.add(bar);
    for (const s of [-1, 1]) {
      const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.021, 0.021, 0.11, 10), M.grip);
      grip.rotation.z = Math.PI / 2;
      grip.position.set(s * 0.21, 0.44, -0.08);
      this.steer.add(grip);
      const brake = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.12, 0.02), M.chrome);
      brake.position.set(s * 0.16, 0.37, -0.06);
      brake.rotation.x = 0.3;
      this.steer.add(brake);
    }
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.12, 8), M.chrome);
    stem.rotation.x = 0.35; stem.position.set(0, 0.37, -0.03);
    this.steer.add(stem);

    // 前灯
    const lampBody = cyl(0.055, 0.05, 0.08, M.chrome, 12);
    lampBody.rotation.x = Math.PI / 2;
    lampBody.position.set(0, 0.28, 0.06);
    this.steer.add(lampBody);
    const lampFace = new THREE.Mesh(new THREE.CircleGeometry(0.048, 12), M.lamp);
    lampFace.position.set(0, 0.28, 0.101);
    this.steer.add(lampFace);
    this.lampFace = lampFace;

    /* ---------- 车架 + 前叉上的前轮组 ---------- */
    this.frontWheel = this._makeWheel(M);
    this.frontWheel.position.copy(frontHub);
    this.steer.add(this.frontWheel);

    /* ---------- 后轮 ---------- */
    this.rearWheel = this._makeWheel(M);
    this.rearWheel.position.copy(rearHub);
    this.root.add(this.rearWheel);

    /* ---------- 座垫 ---------- */
    const post = cyl(0.022, 0.022, 0.16, M.chrome, 8);
    post.position.set(0, 0.99, -0.16);
    this.root.add(post);
    const saddle = roundedBox(0.16, 0.055, 0.30, 0.06, M.saddle, 0.02);
    saddle.position.set(0, 1.06, -0.16);
    saddle.rotation.x = -0.06;
    saddle.castShadow = true;
    this.root.add(saddle);

    /* ---------- 曲柄 / 牙盘 / 链条 ---------- */
    this.crank = new THREE.Group();
    this.crank.position.copy(bb);
    this.root.add(this.crank);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.105, 0.012, 8, 26), M.chrome);
    ring.rotation.y = Math.PI / 2;
    ring.position.set(0.055, 0, 0);
    this.crank.add(ring);
    for (let i = 0; i < 5; i++) {
      const spoke = box(0.01, 0.19, 0.01, M.chrome);
      spoke.position.set(0.055, 0, 0);
      spoke.rotation.x = (i / 5) * Math.PI;
      this.crank.add(spoke);
    }
    this.pedals = [];
    for (const def of [{ s: 1, phase: 0 }, { s: -1, phase: Math.PI }]) {
      const s = def.s;
      const arm = new THREE.Group();
      arm.position.set(s * 0.075, 0, 0);
      arm.rotation.x = def.phase;
      this.crank.add(arm);
      const a = box(0.022, 0.17, 0.026, M.chrome);
      a.position.y = 0.085;
      arm.add(a);
      const pedal = roundedBox(0.11, 0.028, 0.09, 0.012, M.grip, 0.008);
      pedal.position.set(s * 0.045, 0.17, 0);
      arm.add(pedal);
      this.pedals.push({ arm, pedal, side: s, phase: def.phase });
    }
    // 后飞轮 + 链条
    const cog = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.03, 14), M.chrome);
    cog.rotation.z = Math.PI / 2;
    cog.position.copy(rearHub);
    this.root.add(cog);
    this.chain = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.008, 6, 4, Math.PI), M.chain);
    this.chain.rotation.y = Math.PI / 2;
    this.chain.position.copy(bb).add(V(0.05, -0.02, 0.02));
    this.root.add(this.chain);

    /* ---------- 前置鱼篓（鹈鹕的鱼）---------- */
    const basket = new THREE.Group();
    basket.position.set(0, 0.50, 0.46);
    const bwire = mat('#c8a05a', { roughness: 0.5, metalness: 0.7 });
    const bmat = mat('#9c6f33', { roughness: 0.8 });
    for (let i = 0; i < 10; i++) {
      const w = box(0.012, 0.24, 0.012, bwire);
      const a = (i / 10) * Math.PI * 2;
      w.position.set(Math.cos(a) * 0.13, 0.12, Math.sin(a) * 0.10);
      basket.add(w);
    }
    const rimTop = new THREE.Mesh(new THREE.TorusGeometry(0.135, 0.012, 6, 18), bwire);
    rimTop.rotation.x = Math.PI / 2; rimTop.position.y = 0.24;
    basket.add(rimTop);
    const rimBot = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.01, 6, 18), bwire);
    rimBot.rotation.x = Math.PI / 2; rimBot.position.y = 0.01;
    basket.add(rimBot);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.02, 14), bmat);
    base.position.y = 0.01;
    basket.add(base);
    // 鱼
    const fish = new THREE.Group();
    const bodyF = new THREE.Mesh(new THREE.SphereGeometry(0.09, 14, 10), mat('#7fb2c9', { roughness: 0.35, metalness: 0.25 }));
    bodyF.scale.set(0.55, 0.75, 1.35);
    fish.add(bodyF);
    const tailF = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.12, 4), mat('#6aa0b8', { roughness: 0.4 }));
    tailF.rotation.x = -Math.PI / 2; tailF.position.z = -0.13;
    fish.add(tailF);
    fish.position.set(0.02, 0.1, 0.02);
    fish.rotation.y = 0.5;
    basket.add(fish);
    this.fish = fish;
    this.root.add(basket);
    this.basket = basket;

    /* ---------- 支撑脚撑 ---------- */
    this.stand = new THREE.Group();
    this.stand.position.set(0.06, 0.3, -0.02);
    const leg = cyl(0.012, 0.012, 0.32, M.chrome, 6);
    leg.position.y = -0.16;
    this.stand.add(leg);
    this.stand.rotation.x = 1.2;
    this.root.add(this.stand);

    this.root.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  }

  _makeWheel(M) {
    const g = new THREE.Group();
    const R = this.wheelR;
    const tire = new THREE.Mesh(new THREE.TorusGeometry(R - 0.032, 0.034, 10, 34), M.tire);
    g.add(tire);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(R - 0.062, 0.014, 8, 30), M.rim);
    g.add(rim);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.09, 10), M.hub);
    hub.rotation.z = Math.PI / 2;
    g.add(hub);
    // 辐条
    const spokeGeo = new THREE.CylinderGeometry(0.0045, 0.0045, R - 0.07, 4);
    for (let i = 0; i < 16; i++) {
      const s = new THREE.Mesh(spokeGeo, M.rim);
      s.rotation.z = (i / 16) * Math.PI * 2;
      s.rotation.y = 0.28;
      const s2 = s.clone();
      s2.rotation.y = -0.28;
      const holder = new THREE.Group();
      holder.rotation.z = (i / 16) * Math.PI * 2;
      s.position.set(0, (R - 0.07) / 2, 0);
      s.rotation.set(0, 0, 0);
      s2.position.set(0, (R - 0.07) / 2, 0);
      s2.rotation.set(0, 0, 0);
      holder.add(s, s2);
      g.add(holder);
    }
    // 刹车盘
    const disc = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.008, 6, 18), M.chrome);
    disc.rotation.y = Math.PI / 2;
    disc.position.x = 0.05;
    g.add(disc);
    return g;
  }

  /**
   * @param dt
   * @param st  speed, steer, lean, wheelie, flip, pedalAngle
   */
  update(dt, st) {
    const spin = st.speed / this.wheelR * dt;
    this.rearWheel.rotation.x -= spin;
    this.frontWheel.rotation.x -= spin;
    this.crank.rotation.x = st.pedalAngle;
    for (const p of this.pedals) p.pedal.rotation.x = -st.pedalAngle + p.phase;
    this.steer.rotation.y = damp(this.steer.rotation.y, st.steer || 0, 8, dt);
    this.stand.rotation.x = damp(this.stand.rotation.x, st.kickstand ? 0.05 : 1.2, 6, dt);
    if (this.fish) {
      this.fish.rotation.z = Math.sin((st.time || 0) * 2.2) * 0.2;
      this.fish.position.y = 0.1 + Math.sin((st.time || 0) * 3.1) * 0.012;
    }
  }
}
