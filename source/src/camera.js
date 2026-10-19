import * as THREE from 'three';
import { clamp, lerp, damp, smoothstep, easeInOutCubic, easeOutCubic, Noise1D, TAU } from './util.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const Y_UP = V(0, 1, 0);

/* 电影机位库：偏移定义在主体局部坐标系 (right, up, forward) */
const BIKE_SHOTS = [
  { name: 'low-hero', off: V(3.4, 0.62, 7.6), look: V(0, 1.0, 0), fov: 36, hold: 3.4 },
  { name: 'side-track', off: V(-8.6, 2.4, 0.8), look: V(0, 1.2, 0), fov: 40, hold: 3.0 },
  { name: 'front-wide', off: V(1.8, 3.6, -10.6), look: V(0, 1.0, 0), fov: 44, hold: 2.8 },
  { name: 'low-sweep', off: V(4.8, 0.42, 4.4), look: V(0, 0.9, 0.3), fov: 34, hold: 2.4 },
  { name: 'high-angle', off: V(-3.6, 7.0, 4.6), look: V(0, 0.9, 0), fov: 42, hold: 2.6 },
  { name: 'rear-chase', off: V(1.0, 3.4, -9.4), look: V(0, 1.3, 0), fov: 38, hold: 2.8 },
];

const CAR_SHOTS = [
  { name: 'front-3q', off: V(6.6, 1.9, 9.6), look: V(0, 0.8, 0.4), fov: 36, hold: 3.2 },
  { name: 'side-slip', off: V(-9.4, 1.3, 1.0), look: V(0, 0.7, 0), fov: 38, hold: 2.8 },
  { name: 'low-intense', off: V(3.8, 0.42, 7.6), look: V(0, 0.6, 0.8), fov: 32, hold: 2.4 },
  { name: 'rear-hero', off: V(-1.4, 2.6, -9.6), look: V(0, 0.9, -0.4), fov: 34, hold: 2.8 },
  { name: 'over-shoulder', off: V(2.8, 2.4, 4.4), look: V(0, 1.0, -0.6), fov: 44, hold: 3.0 },
];

export class CameraDirector {
  constructor(camera, world) {
    this.camera = camera;
    this.world = world;
    this.noise = new Noise1D(4242);
    this.mode = 'cine';
    this.baseFov = 55;

    this.pos = new THREE.Vector3(0, 4, 12);
    this.look = new THREE.Vector3();
    this.targetPos = new THREE.Vector3();
    this.targetLook = new THREE.Vector3();
    this.shake = 0;
    this.shakeEnabled = true;
    this.roll = 0;

    this.shotIndex = 0;
    this.shotTime = 0;
    this.orbitAngle = 0.6;
    this.freeYaw = 0.6;
    this.freePitch = 0.35;
    this.freeDist = 9;
    this.freeTarget = new THREE.Vector3();

    this.sequence = null;
    this.seqTime = 0;
    this._tmpA = new THREE.Vector3();
    this._tmpB = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._m = new THREE.Matrix4();
  }

  setMode(m) {
    if (this.mode === m) return;
    this.mode = m;
    this.shotTime = 0;
    this.shotIndex = Math.floor(Math.random() * 6);
    // 切入时做一次快切 + 轻微稳定，避免跳切突兀
    this._cut = true;
  }

  addShake(v) { this.shake = Math.min(1.6, this.shake + v); }

  /** 播放一段脚本镜头 */
  playSequence(shots, onEnd) {
    this.sequence = shots;
    this.seqTime = 0;
    this._seqEnd = onEnd;
    this.mode = 'sequence';
  }

  /**
   * ctx: {
   *   subject: THREE.Object3D,   // 跟随主体
   *   follow: { pos, forward, up },
   *   speed, time, dt,
   *   pelican: THREE.Object3D,
   *   car: THREE.Object3D,
   *   stage: 'bike'|'car'|'transition'
   * }
   */
  update(dt, ctx) {
    this.shake = Math.max(0, this.shake - dt * 2.2);
    const f = ctx.follow;

    if (this.mode === 'sequence' && this.sequence) {
      this._updateSequence(dt, ctx);
    } else {
      switch (this.mode) {
        case 'cine': this._cineBike(ctx, f); break;
        case 'carcine': this._cineCar(ctx, f); break;
        case 'orbit': this._orbit(ctx, f); break;
        case 'fpov': this._fpov(ctx); break;
        case 'low': this._low(ctx, f); break;
        case 'drone': this._drone(ctx, f); break;
        case 'cockpit': this._cockpit(ctx); break;
        case 'driver': this._driver(ctx); break;
        case 'chase': this._chase(ctx, f); break;
        case 'hood': this._hood(ctx); break;
        case 'wheel': this._wheel(ctx); break;
        case 'free': this._free(dt, ctx, f); break;
        default: this._cineBike(ctx, f);
      }
    }

    // 应用阻尼（sequence 模式下更硬，接近剪切感）
    const k = this.mode === 'sequence' ? 26 : (this.mode === 'free' ? 30 : 6.5);
    this.pos.lerp(this.targetPos, 1 - Math.exp(-k * dt));
    this.look.lerp(this.targetLook, 1 - Math.exp(-(k * 1.15) * dt));

    // FOV
    const speedFov = clamp(ctx.speed / 40, 0, 1) * 9;
    const targetFov = this._fov !== undefined ? this._fov : this.baseFov;
    this.camera.fov = damp(this.camera.fov, targetFov + speedFov, 4, dt);
    this.camera.updateProjectionMatrix();

    // 应用
    this.camera.position.copy(this.pos);

    // 抖动
    if (this.shakeEnabled && this.shake > 0.001) {
      const t = ctx.time * 24;
      const s = this.shake * 0.12;
      this.camera.position.x += this.noise.fbm(t, 2) * s;
      this.camera.position.y += this.noise.fbm(t + 31, 2) * s;
      this.camera.position.z += this.noise.fbm(t + 71, 2) * s;
    }

    this.camera.lookAt(this.look);

    // 滚转（过弯倾斜）
    const targetRoll = clamp((ctx.lateralG || 0) * 0.012, -0.06, 0.06) + (this.shakeEnabled ? this.noise.fbm(ctx.time * 1.3, 2) * 0.006 * this.shake : 0);
    this.roll = damp(this.roll, targetRoll, 4, dt);
    this.camera.rotateZ(this.roll);
  }

  /* -------------------- 各类机位 -------------------- */
  _cineBike(ctx, f) {
    this.shotTime += ctx.dt;
    const shots = BIKE_SHOTS;
    let s = shots[this.shotIndex];
    if (this.shotTime > s.hold) {
      this.shotTime = 0;
      this.shotIndex = (this.shotIndex + 1) % shots.length;
      s = shots[this.shotIndex];
      this._cut = true;
      this.addShake(0.12);
    }
    this._fov = s.fov;
    // 偏移定义在主体局部坐标系
    const o = s.off;
    this.targetPos.copy(f.pos)
      .addScaledVector(f.right, o.x)
      .addScaledVector(f.up || Y_UP, o.y)
      .addScaledVector(f.forward, o.z);
    this.targetLook.copy(f.pos)
      .addScaledVector(f.right, s.look.x)
      .addScaledVector(f.up || Y_UP, s.look.y)
      .addScaledVector(f.forward, s.look.z);
  }

  _cineCar(ctx, f) {
    this.shotTime += ctx.dt;
    const shots = CAR_SHOTS;
    let s = shots[this.shotIndex % shots.length];
    if (this.shotTime > s.hold) {
      this.shotTime = 0;
      this.shotIndex = (this.shotIndex + 1) % shots.length;
      s = shots[this.shotIndex];
      this._cut = true;
      this.addShake(0.16);
    }
    this._fov = s.fov;
    const o = s.off;
    this.targetPos.copy(f.pos)
      .addScaledVector(f.right, o.x)
      .addScaledVector(f.up || Y_UP, o.y)
      .addScaledVector(f.forward, o.z);
    this.targetLook.copy(f.pos)
      .addScaledVector(f.right, s.look.x)
      .addScaledVector(f.up || Y_UP, s.look.y)
      .addScaledVector(f.forward, s.look.z);
  }

  _orbit(ctx, f) {
    this.orbitAngle += ctx.dt * 0.22;
    const r = 7.5;
    this._fov = 42;
    this.targetPos.set(
      f.pos.x + Math.cos(this.orbitAngle) * r,
      f.pos.y + 2.4,
      f.pos.z + Math.sin(this.orbitAngle) * r,
    );
    this.targetLook.copy(f.pos).add(V(0, 1.1, 0));
  }

  _fpov(ctx) {
    this._fov = 72;
    const p = ctx.pelican;
    p.getWorldPosition(this._tmpA);
    this._tmpA.y += 1.55;
    this.targetPos.copy(this._tmpA);
    const dir = ctx.follow.forward;
    this.targetLook.copy(this._tmpA).addScaledVector(dir, 12);
  }

  _low(ctx, f) {
    this._fov = 32;
    const t = ctx.time * 0.5;
    this.targetPos.set(
      f.pos.x - f.forward.x * 5.5 + f.right.x * 3.4,
      f.pos.y + 0.42,
      f.pos.z - f.forward.z * 5.5 + f.right.z * 3.4,
    );
    this.targetLook.copy(f.pos).add(V(0, 1.3, 0));
  }

  _drone(ctx, f) {
    this._fov = 44;
    const t = ctx.time * 0.16;
    this.targetPos.set(
      f.pos.x + Math.cos(t) * 15,
      f.pos.y + 11 + Math.sin(t * 0.7) * 2.5,
      f.pos.z + Math.sin(t) * 15,
    );
    this.targetLook.copy(f.pos).add(V(0, 1.0, 0));
  }

  _cockpit(ctx) {
    this._fov = 64;
    const a = ctx.cockpitAnchor;
    a.getWorldPosition(this._tmpA);
    a.getWorldQuaternion(this._q);
    this.targetPos.copy(this._tmpA);
    const fwd = V(0, 0, 1).applyQuaternion(this._q);
    const right = V(-1, 0, 0).applyQuaternion(this._q);
    // 看向前方略偏左下：同时框住鹈鹕侧影与公路
    this.targetLook.copy(this._tmpA)
      .addScaledVector(fwd, 14)
      .addScaledVector(right, 0.5)
      .add(V(0, -1.3, 0));
  }

  /** 驾驶员第一人称：鹈鹕的视线 */
  _driver(ctx) {
    this._fov = 74;
    const head = ctx.pelicanHead;
    if (!head) { this._chase(ctx, ctx.follow); return; }
    this.targetPos.copy(head).addScaledVector(ctx.pelicanForward, 0.28);
    this.targetLook.copy(head).addScaledVector(ctx.pelicanForward, 18).add(V(0, -1.2, 0));
  }

  _chase(ctx, f) {
    this._fov = 52;
    const back = 8.2 + clamp(ctx.speed / 30, 0, 1) * 2.4;
    const side = 0.4;
    this.targetPos.set(
      f.pos.x - f.forward.x * back + f.right.x * side,
      f.pos.y + 3.1,
      f.pos.z - f.forward.z * back + f.right.z * side,
    );
    this.targetLook.copy(f.pos).addScaledVector(f.forward, 3.0).add(V(0, 1.0, 0));
  }

  _hood(ctx) {
    this._fov = 60;
    const car = ctx.car;
    this._tmpA.set(0, 1.05, 1.45);
    car.localToWorld(this._tmpA);
    this.targetPos.copy(this._tmpA);
    this._tmpB.set(0, 0.6, 24);
    car.localToWorld(this._tmpB);
    this.targetLook.copy(this._tmpB);
  }

  _wheel(ctx) {
    this._fov = 48;
    const car = ctx.car;
    this._tmpA.set(-1.05, 0.45, -0.2);
    car.localToWorld(this._tmpA);
    this.targetPos.copy(this._tmpA);
    this._tmpB.set(-0.4, 0.5, 3.0);
    car.localToWorld(this._tmpB);
    this.targetLook.copy(this._tmpB);
  }

  _free(dt, ctx, f) {
    this._fov = this.baseFov;
    const t = ctx.time * 0.1;
    this.targetPos.set(
      f.pos.x + Math.cos(this.freeYaw) * Math.cos(this.freePitch) * this.freeDist,
      f.pos.y + Math.sin(this.freePitch) * this.freeDist + 1.2,
      f.pos.z + Math.sin(this.freeYaw) * Math.cos(this.freePitch) * this.freeDist,
    );
    this.targetLook.copy(f.pos).add(V(0, 1.1, 0));
  }

  /* -------------------- 脚本镜头 -------------------- */
  _updateSequence(dt, ctx) {
    this.seqTime += dt;
    const shots = this.sequence;
    let cur = shots[0];
    for (const s of shots) { if (this.seqTime >= s.t0 && this.seqTime < s.t1) { cur = s; break; } }
    if (this.seqTime >= shots[shots.length - 1].t1) {
      const end = this._seqEnd; this.sequence = null; this._seqEnd = null;
      end?.();
      return;
    }
    // 镜头内也可以做小推拉
    const local = clamp((this.seqTime - cur.t0) / Math.max(0.001, cur.t1 - cur.t0), 0, 1);
    const push = cur.push || 0;
    const p = cur.pos(ctx);
    const l = cur.look(ctx);
    this.targetPos.copy(p).addScaledVector(cur.dir ? cur.dir(ctx) : V(0, 0, 0), -push * local);
    this.targetLook.copy(l);
    this._fov = lerp(cur.fov0 ?? cur.fov, cur.fov1 ?? cur.fov, easeInOutCubic(local));
    // 硬切检测
    if (this._lastSeqShot !== cur) {
      this._lastSeqShot = cur;
      this.addShake(0.1);
    }
  }
}
