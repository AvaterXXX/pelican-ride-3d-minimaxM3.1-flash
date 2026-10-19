import * as THREE from 'three';
import { World, PRESETS } from './world.js';
import { Pelican } from './pelican.js';
import { Bicycle } from './bicycle.js';
import { Car } from './car.js';
import { CameraDirector } from './camera.js';
import { Cinematic } from './postfx.js';
import { AudioEngine } from './audio.js';
import { UI } from './ui.js';
import { clamp, lerp, damp, smoothstep, easeInOutCubic, easeOutCubic, easeOutBack, TAU } from './util.js';

const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const X_AXIS = V3(1, 0, 0), Y_AXIS = V3(0, 1, 0), Z_AXIS = V3(0, 0, 1);

/* 自行车动作预设 */
const ACTIONS = {
  coast: { speed: 9.5, lean: 0.16, cadence: 1.0, label: '巡航' },
  sprint: { speed: 17.5, lean: 0.46, cadence: 1.25, label: '冲刺' },
  climb: { speed: 4.6, lean: 0.58, cadence: 0.8, pitch: 0.12, label: '爬坡' },
  jump: { speed: 13.0, lean: 0.2, cadence: 1.1, label: '跳台腾空' },
  wheelie: { speed: 7.2, lean: 0.3, cadence: 0.9, wheelie: 0.62, label: '翘头' },
  flip: { speed: 10.5, lean: 0.1, cadence: 1.0, flip: true, label: '后空翻' },
  weave: { speed: 10.5, lean: 0.34, cadence: 1.0, weave: true, label: '蛇行' },
  brake: { speed: 0.4, lean: 0.5, cadence: 0.25, label: '急刹' },
  idle: { speed: 0, lean: 0.05, cadence: 0, label: '静止' },
};

/* 场景 */
const STAGE = { BIKE: 'bike', TRANS: 'transition', DRIVE: 'drive' };

class Game {
  constructor() {
    this.canvas = document.getElementById('scene');
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.6));
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 2600);

    this.world = new World(this.scene);
    this.pelican = new Pelican();
    this.bike = new Bicycle();
    this.car = new Car({ paint: '#c0392b' });
    this.scene.add(this.bike.root, this.car.root, this.pelican.root);

    this.director = new CameraDirector(this.camera, this.world);
    this.cine = new Cinematic(this.renderer, this.scene, this.camera);
    this.audio = new AudioEngine();

    this.clock = new THREE.Clock();
    this.time = 0;
    this.running = false;
    this.slowmo = false;

    /* 自行车状态 */
    this.bikeState = {
      u: 0.02, speed: 0, action: 'coast', pedalAngle: 0, phase: 0,
      lane: -3.2, airY: 0, airVY: 0, airborne: false, flipT: -1, flipAngle: 0,
      wheelie: 0, lean: 0.16, steer: 0, kickstand: false, speedFactor: 0.45,
    };
    /* 汽车状态 */
    this.carState = {
      u: 0.02, speed: 0, steer: 0, gear: 'D', gearIndex: 0, auto: true,
      throttle: 0.55, brake: 0, lateralG: 0, pos: V3(), heading: 0, rpm: 900,
      lane: -3.2, manual: false, y: 0, pitch: 0, suspension: 0,
    };

    this.stage = STAGE.BIKE;
    this.stageTime = 0;
    this.transition = null;
    this.pelicanState = { mode: 'ride', weights: { ride: 1 }, flap: 0, stride: 0 };

    this.post = { grain: 0.45, vignette: 0.85, aberration: 0.9, speedBlur: 0, grade: 1, saturation: 1.08, bloom: 0.62, warm: null, cool: null };
    this.letterbox = 0;
    this.letterboxTarget = 0;

    this.keys = new Set();
    this.userCam = { yaw: 0, pitch: 0, dist: 1 };
    this._dragging = false;
    this._lastPointer = { x: 0, y: 0 };
    this._follow = { pos: V3(), forward: V3(0, 0, 1), right: V3(-1, 0, 0), up: V3(0, 1, 0), speed: 0 };
    this._v = V3(); this._v2 = V3(); this._q = new THREE.Quaternion(); this._m = new THREE.Matrix4();
    this._pq = new THREE.Quaternion();
    this._pelicanWorld = V3();
    this._pelicanForward = V3(0, 0, 1);

    this.ui = new UI({
      onStart: () => this.start(),
      onRide: () => this.toggleRide(),
      onSwap: () => this.toggleSwap(),
      onScene: d => this.setScene(d.scene),
      onAction: d => this.setAction(d.act),
      onCamera: (cam, stage) => this.setCamera(cam, stage),
      onDrive: d => this.setDrive(d.drive),
      onToggleAuto: v => this.setAuto(v),
      onHorn: v => this.audio.horn(v),
      onTime: v => this.world.setTimeOfDay(v),
      onFog: v => this.world.setFog(v),
      onGrain: v => { this.post.grain = v; },
      onBloom: v => { this.post.bloom = v; },
      onBikeSpeed: v => { this.bikeState.speedFactor = v; },
      onLean: v => { this.post.leanAmt = v; },
      onThrottle: v => { this.carState.throttle = v; },
      onSteerSens: v => { this.steerSens = v; },
      onFov: v => { this.director.baseFov = lerp(28, 92, v); },
      onLights: v => { this.lightsOn = v; this.car.setLights(v); },
      onSlow: v => { this.slowmo = v; },
      onShake: v => { this.director.shakeEnabled = v; },
      onAudio: v => { this.audio.setEnabled(v); },
    });
    this.steerSens = 0.65;
    this.lightsOn = true;

    this._bindInput();
    this._setupActors();
    this._applyPresetPost('coast');

    // 早期点击补偿：任何来源的“开始”请求都会在引擎就绪后立刻生效
    this._startWatch = setInterval(() => {
      if (window.__startRequested && !this.running) this.start();
    }, 200);

    addEventListener('resize', () => this._resize());
    this._resize();
  }

  /* ------------------------------------------------------------------ */
  _setupActors() {
    // 鹈鹕骑上车（整体缩放 0.78：真实鹈鹕体型，同时保证腿能踩到脚踏）
    this.pelican.root.scale.setScalar(0.78);
    this.bike.root.add(this.pelican.root);
    this.pelican.root.position.set(0, 0.885, -0.02);
    this.pelican.root.rotation.set(0, 0, 0);
    // 汽车停在路边待命
    this._parkCar();
    this.car.setLights(false);
    this.car.setDoor(0);
  }

  _parkCar() {
    const u = this.bikeState.u + 0.016;
    const f = this.world.frameAt(u);
    this.carState.u = u;
    this.carState.parkU = u;
    this.carState.parkLateral = -6.0;
    this._placeCarOnTrack(u, -6.0, 0);
  }

  _placeCarOnTrack(u, lateral, heightAdd = 0) {
    const f = this.world.frameAt(u);
    const pos = f.pos.clone().addScaledVector(f.side, lateral).addScaledVector(f.up, heightAdd);
    this.car.root.position.copy(pos);
    // 朝向切线
    const yaw = Math.atan2(f.tangent.x, f.tangent.z);
    this.car.root.rotation.set(0, yaw, 0);
    this.car.root.rotation.z = 0;
    this.carState.pos.copy(pos);
    this.carState.heading = yaw;
  }

  /* ------------------------------------------------------------------ */
  _bindInput() {
    addEventListener('keydown', e => {
      if (e.target.tagName === 'INPUT') return;
      this.keys.add(e.code);
      switch (e.code) {
        case 'KeyC': this._cycleCamera(); break;
        case 'KeyV': this.setAuto(!this.carState.auto); break;
        case 'KeyL': this.lightsOn = !this.lightsOn; this.car.setLights(this.lightsOn); { const ck = document.getElementById('chkLights'); if (ck) ck.checked = this.lightsOn; } break;
        case 'KeyH': this.ui.hornOn = !this.ui.hornOn; this.audio.horn(this.ui.hornOn); this.ui.el.btnHorn.classList.toggle('on', this.ui.hornOn); break;
        case 'KeyB': this.ui.el.btnHorn.click(); break;
        case 'KeyP': {
          this._dbgOn = !this._dbgOn;
          const d = document.getElementById('dbg');
          if (d) d.style.display = this._dbgOn ? 'block' : 'none';
          break;
        }
        case 'Space': if (this.stage === STAGE.DRIVE) e.preventDefault(); break;
      }
    });
    addEventListener('keyup', e => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());

    // 鼠标：拖拽转视角，滚轮推拉
    const c = this.canvas;
    c.addEventListener('pointerdown', e => {
      this._dragging = true; this._lastPointer = { x: e.clientX, y: e.clientY };
      c.setPointerCapture(e.pointerId);
    });
    c.addEventListener('pointermove', e => {
      if (!this._dragging) return;
      const dx = e.clientX - this._lastPointer.x, dy = e.clientY - this._lastPointer.y;
      this._lastPointer = { x: e.clientX, y: e.clientY };
      this.userCam.yaw -= dx * 0.005;
      this.userCam.pitch = clamp(this.userCam.pitch + dy * 0.004, -0.9, 1.1);
    });
    const up = e => { this._dragging = false; };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
    c.addEventListener('wheel', e => {
      e.preventDefault();
      this.userCam.dist = clamp(this.userCam.dist * (1 + Math.sign(e.deltaY) * 0.09), 0.25, 4);
    }, { passive: false });
  }

  /* ------------------------------------------------------------------ */
  async start() {
    if (this.running) return;
    this.running = true;
    this.clock.start();
    this.ui.setLoading(0.35, '编译着色器…');
    this.loop();

    await new Promise(r => setTimeout(r, 80));
    this.ui.setLoading(0.7, '调度镜头…');
    await new Promise(r => setTimeout(r, 80));
    this.ui.setLoading(1, '就绪');

    try { this.audio.start(); this.audio.resume(); } catch (e) { console.warn('audio unavailable', e); }

    this.ui.hideLoader();
    this.ui.hideGate();
    this.ui.setLetterbox(Math.round(innerHeight * 0.055));
    this.letterboxTarget = Math.round(innerHeight * 0.055);
    this.ui.showTitle(true);
    setTimeout(() => this.ui.showTitle(false), 5200);
    this.ui.subtitle('在一段无尽的高速公路上，一只鹈鹕正在赶路。', 4.5);
    if (this.autoRide) setTimeout(() => this.toggleRide(), 900);
  }

  _resize() {
    const w = innerWidth, h = innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.cine.setSize(w, h);
  }

  /* ------------------------------------------------------------------ */
  /*  对外操作                                                            */
  /* ------------------------------------------------------------------ */
  setScene(name) {
    if (!PRESETS[name]) return;
    this.world.applyPreset(name);
    this._applyPresetPost(name);
    this.ui.setScene(PRESETS[name].label);
    this.ui.setSceneActive(name);
    this.ui.subtitle(`场景切换 · ${PRESETS[name].label}`, 2.4);
    this.audio.whoosh(0.6);
  }

  _applyPresetPost(name) {
    const p = PRESETS[name];
    this.post.bloom = p.bloom;
    this.post.grade = p.grade;
    this.post.saturation = p.sat;
    this.renderer.toneMappingExposure = p.exposure;
    this.world.setTimeOfDay(this.world.timeOfDay);
  }

  setAction(a) {
    if (!ACTIONS[a]) return;
    this.bikeState.action = a;
    this.ui.setAction(a);
    if (a === 'flip') { this.bikeState.flipT = 0; this.bikeState.flipAngle = 0; }
    this.ui.subtitle(`动作 · ${ACTIONS[a].label}`, 2.0);
  }

  setCamera(cam, stage) {
    const isCar = stage === 'car' || this.stage === STAGE.DRIVE;
    this.director.setMode(cam);
    this.userCam.yaw = 0; this.userCam.pitch = 0; this.userCam.dist = 1;
    const names = {
      cine: '电影跟拍', carcine: '车外电影', orbit: '环绕', fpov: '骑手视角', low: '低机位',
      drone: '航拍', free: '自由视角', cockpit: '车内副驾', driver: '驾驶员视角',
      chase: '车外跟拍', hood: '引擎盖', wheel: '车轮视角',
    };
    this.ui.setCam(names[cam] || cam);
    this.ui.setCamActive(cam);
    // 车内机位隐藏防滚架，避免遮挡画面
    if (this.car.rollBar) this.car.rollBar.visible = !(cam === 'cockpit' || cam === 'driver');
    if (this.stage === STAGE.DRIVE) {
      document.querySelectorAll('#segCamCar button').forEach(b => b.classList.toggle('on', b.dataset.cam === cam));
      document.querySelectorAll('#segCamBike button').forEach(b => b.classList.remove('on'));
    } else {
      document.querySelectorAll('#segCamBike button').forEach(b => b.classList.toggle('on', b.dataset.cam === cam));
      document.querySelectorAll('#segCamCar button').forEach(b => b.classList.remove('on'));
    }
  }

  _cycleCamera() {
    const list = this.stage === STAGE.DRIVE
      ? ['cockpit', 'driver', 'chase', 'carcine', 'hood', 'wheel', 'drone', 'free']
      : ['cine', 'orbit', 'fpov', 'low', 'drone', 'free'];
    const i = list.indexOf(this.director.mode);
    this.setCamera(list[(i + 1) % list.length], this.stage === STAGE.DRIVE ? 'car' : 'bike');
  }

  setDrive(mode) { this.setAuto(mode === 'auto'); }

  setAuto(v) {
    this.carState.auto = v;
    this.ui.setDriveMode(v ? 'auto' : 'manual');
    this.ui.subtitle(v ? '自动驾驶已接管 · 按 V 随时接管' : '人工手动驾驶 · WASD 控制', 2.6);
    if (v) {
      // 重新吸附回赛道
      this._placeCarOnTrack(this.carState.u, this.carState.lane);
      this.carState.speed = Math.max(this.carState.speed, 6);
    }
  }

  toggleRide() {
    if (this.stage === STAGE.BIKE) this._beginTransition();
    else if (this.stage === STAGE.DRIVE) this._beginSwapBack();
  }

  toggleSwap() {
    if (this.stage === STAGE.DRIVE) this._beginSwapBack();
    else if (this.stage === STAGE.BIKE) this._beginTransition();
  }

  /* ------------------------------------------------------------------ */
  /*  过场：鹈鹕下车 → 上车 → 驾驶                                          */
  /* ------------------------------------------------------------------ */
  _beginTransition() {
    if (this.stage !== STAGE.BIKE) return;
    this.stage = STAGE.TRANS;
    this.stageTime = 0;
    this.transition = { phase: 'brake', t: 0 };

    // 汽车就位到路边
    this._parkCar();
    this.car.setLights(false);
    this.car.setDoor(0);

    // 鹈鹕从车上脱离，保持世界变换
    this.scene.attach(this.pelican.root);

    const bikePos = this.bike.root.position.clone();
    const f = this.world.frameAt(this.bikeState.u);
    this.transition.dismountPos = bikePos.clone().addScaledVector(f.side, -1.35);
    this.transition.dismountPos.y = this.world.roadHeightAt(this.bikeState.u) + 0.02;
    this.transition.bikeStop = bikePos.clone();
    this.transition.carU = this.carState.parkU;

    this.ui.setRideButton('busy');
    this.ui.setMode('换车中', true);
    this.ui.setCamStage('car');
    this.letterboxTarget = Math.round(innerHeight * 0.085);

    this.director.playSequence(this._transitionShots(), () => {
      this.stage = STAGE.DRIVE;
      this.stageTime = 0;
    });
    this.audio.whoosh(0.8);
    this.ui.subtitle('这辆公路跑者，等的就是这一刻。', 3.4);
  }

  _transitionShots() {
    const gp = () => this.pelican.root.getWorldPosition(this._v2);
    const carMid = () => this.car.root.localToWorld(V3(0, 0.8, -0.2));
    return [
      {
        t0: 0, t1: 1.35, fov: 34,
        pos: () => {
          const b = this.bike.root.position;
          const f = this.world.frameAt(this.bikeState.u);
          return b.clone().addScaledVector(f.side, 3.2).addScaledVector(f.tangent, 4.6).add(V3(0, 0.55, 0));
        },
        look: () => gp().add(V3(0, 0.95, 0)),
      },
      {
        t0: 1.35, t1: 2.9, fov: 38,
        pos: () => {
          const b = this.bike.root.position;
          const f = this.world.frameAt(this.bikeState.u);
          return b.clone().addScaledVector(f.side, -5.2).addScaledVector(f.tangent, 0.8).add(V3(0, 1.8, 0));
        },
        look: () => gp().add(V3(0, 0.8, 0)),
      },
      {
        t0: 2.9, t1: 5.0, fov: 42,
        pos: () => {
          const c = this.car.root.position;
          return c.clone().add(V3(0, 5.2, 0)).addScaledVector(this._carRight(), 8.6);
        },
        look: () => gp().add(V3(0, 0.6, 0)),
      },
      {
        t0: 5.0, t1: 6.1, fov: 40,
        pos: () => {
          const c = this.car.root.position;
          return c.clone().addScaledVector(this._carRight(), -3.0).addScaledVector(this._carForward(), 1.0).add(V3(0, 1.3, 0));
        },
        look: () => this.car.root.localToWorld(V3(-0.95, 0.85, 0.35)),
      },
      {
        t0: 6.1, t1: 7.6, fov: 42,
        pos: () => this.car.root.localToWorld(V3(0.42, 1.0, 0.18)),
        look: () => gp().add(V3(0, 0.3, 0)),
      },
      {
        t0: 7.6, t1: 8.7, fov: 36,
        pos: () => {
          const c = this.car.root.position;
          return c.clone().addScaledVector(this._carForward(), -7.0).addScaledVector(this._carRight(), 4.0).add(V3(0, 2.1, 0));
        },
        look: () => carMid(),
      },
      {
        t0: 8.7, t1: 11.3, fov: 30,
        pos: () => {
          const c = this.car.root.position;
          return c.clone().addScaledVector(this._carRight(), -3.0).addScaledVector(this._carForward(), 3.6).add(V3(0, 0.4, 0));
        },
        look: () => this.car.root.localToWorld(V3(-0.4, 0.55, 0.6)),
      },
    ];
  }

  _carForward() { return V3(0, 0, 1).applyQuaternion(this.car.root.quaternion); }
  _carRight() { return V3(-1, 0, 0).applyQuaternion(this.car.root.quaternion); }

  /* ------------------------------------------------------------------ */
  /*  反向：回到自行车                                                       */
  /* ------------------------------------------------------------------ */
  _beginSwapBack() {
    if (this.stage !== STAGE.DRIVE) return;
    this.stage = STAGE.TRANS;
    this.stageTime = 0;
    this.transition = { phase: 'stop', t: 0, back: true };
    this.ui.setRideButton('busy');
    this.ui.setMode('回到单车', true);
    this.ui.setCamStage('bike');
    this.director.setMode('cine');
    this.ui.subtitle('巡航，还是公路？', 3.0);
  }

  /* ------------------------------------------------------------------ */
  /*  主更新                                                              */
  /* ------------------------------------------------------------------ */
  update(dt) {
    this.time += dt;
    this.stageTime += dt;

    if (this.stage === STAGE.BIKE) this._updateBikeStage(dt);
    else if (this.stage === STAGE.TRANS) this._updateTransition(dt);
    else this._updateDriveStage(dt);

    // 相机
    this._updateFollow();
    // 鹈鹕头部世界位置（用于驾驶员第一人称机位）
    this.pelican.headPivot.getWorldPosition(this._pelicanWorld);
    this.pelican.headPivot.getWorldQuaternion(this._pq);
    this._pelicanForward.set(0, 0, 1).applyQuaternion(this._pq);
    const ctx = {
      dt, time: this.time, speed: this._follow.speed,
      follow: this._follow, pelican: this.pelican.root, car: this.car.root,
      cockpitAnchor: this.car.getCockpitAnchor(),
      pelicanHead: this._pelicanWorld, pelicanForward: this._pelicanForward,
      lateralG: this.carState.lateralG,
    };
    this.director.update(dt, ctx);
    this._applyUserCam();

    // 世界
    this.world.update(dt, this.camera.position, this._follow.pos);
    this.world.onLightning = (p) => { this.cine.flash(p); this.director.addShake(0.25 * p); };

    // 后期
    this.post.speedBlur = clamp(Math.abs(this._follow.speed) / 34, 0, 1) * (this.stage === STAGE.DRIVE ? 0.9 : 0.55);
    this.cine.update(dt, this.post);

    // 遮幅
    this.letterbox = damp(this.letterbox, this.letterboxTarget, 4, dt);
    this.ui.setLetterbox(Math.round(this.letterbox));

    // 音频
    this.audio.update(dt, {
      carActive: this.stage === STAGE.DRIVE,
      bikeActive: this.stage === STAGE.BIKE,
      rpm: this.carState.rpm,
      throttle: this.carState.auto ? 0.35 : this.carState.throttle,
      speed: Math.abs(this._follow.speed),
      bikeSpeed: this.bikeState.speed,
    });

    // HUD
    const st = this.stage === STAGE.DRIVE
      ? { speed: this.carState.speed, rpm: this.carState.rpm, gear: this.carState.gear }
      : { speed: this.bikeState.speed, rpm: this.bikeState.speed * 60, gear: 'D' };
    this.ui.update(dt, st);
  }

  /* ------------------------- 自行车阶段 ------------------------- */
  _updateBikeStage(dt) {
    const B = this.bikeState;
    const A = ACTIONS[B.action] || ACTIONS.coast;

    // 速度
    const target = A.speed * (0.35 + B.speedFactor * 1.3);
    B.speed = damp(B.speed, target, A.speed > B.speed ? 0.7 : 1.8, dt);
    if (B.action === 'brake') B.speed = damp(B.speed, 0.4, 3.2, dt);
    if (B.action === 'idle') B.speed = damp(B.speed, 0, 3, dt);

    // 前进
    B.u = (B.u + (B.speed / this.world.trackLength) * dt) % 1;

    // 空翻
    if (B.flipT >= 0) {
      B.flipT += dt;
      B.flipAngle = -TAU * easeInOutCubic(clamp(B.flipT / 1.25, 0, 1));
      B.airborne = true;
      B.airY = Math.max(0, Math.sin(clamp(B.flipT / 1.25, 0, 1) * Math.PI) * 1.7);
      if (B.flipT > 1.25) {
        B.flipT = -1; B.flipAngle = 0; B.airborne = false; B.airY = 0;
        this.audio.thud(0.8); this.director.addShake(0.3);
      }
    } else {
      B.flipAngle = damp(B.flipAngle, 0, 8, dt);
    }

    // 跳台
    if (B.action === 'jump' && !B.airborne && B.flipT < 0) {
      const prevU = (B.u - (B.speed / this.world.trackLength) * dt + 1) % 1;
      const crossed = (prevU < this.world.rampU && B.u >= this.world.rampU);
      if (crossed) {
        B.airborne = true; B.airVY = 8.4;
        this.audio.whoosh(0.5);
      }
    }
    if (B.airborne && B.flipT < 0) {
      B.airVY -= 21 * dt;
      B.airY += B.airVY * dt;
      if (B.airY <= 0) {
        B.airY = 0; B.airborne = false; B.airVY = 0;
        this.audio.thud(0.6); this.director.addShake(0.22);
      }
    }

    // 姿态
    const f = this.world.frameAt(B.u);
    const weave = A.weave ? Math.sin(this.time * 2.2) * 2.6 : 0;
    B.lean = damp(B.lean, A.lean + (A.weave ? Math.cos(this.time * 2.2) * 0.22 : 0), 3, dt);
    B.wheelie = damp(B.wheelie, A.wheelie || 0, 4, dt);
    B.steer = damp(B.steer, A.weave ? Math.sin(this.time * 2.2) * 0.42 : Math.sin(this.time * 0.4) * 0.05, 4, dt);

    const lateral = B.lane + weave;
    const pos = f.pos.clone().addScaledVector(f.side, lateral).addScaledVector(f.up, B.airY);
    this.bike.root.position.copy(pos);

    // 朝向
    this._m.makeBasis(
      V3().crossVectors(f.up, f.tangent).normalize(),
      f.up,
      f.tangent,
    );
    this.bike.root.quaternion.setFromRotationMatrix(this._m);
    this._q.setFromAxisAngle(Z_AXIS, B.lean);
    this.bike.root.quaternion.multiply(this._q);
    if (B.wheelie > 0.01) {
      this._q.setFromAxisAngle(X_AXIS, -B.wheelie);
      this.bike.root.quaternion.multiply(this._q);
    }
    if (B.flipT >= 0) {
      this._q.setFromAxisAngle(X_AXIS, B.flipAngle);
      this.bike.root.quaternion.multiply(this._q);
    }
    if (A.pitch) {
      this._q.setFromAxisAngle(X_AXIS, A.pitch);
      this.bike.root.quaternion.multiply(this._q);
    }
    this.bike.root.position.y += A.pitch ? 0 : 0;

    // 踩踏
    B.pedalAngle += (B.speed / 2.639) * TAU * dt * 0.55;
    B.phase += B.speed * dt * 0.55;

    this.bike.update(dt, {
      speed: B.speed, steer: B.steer, pedalAngle: B.pedalAngle,
      kickstand: B.speed < 0.2, time: this.time,
    });

    // 鹈鹕
    this._pelicanRide(dt, B, f);
  }

  /** 把父空间中的点转成鹈鹕自身坐标系（含缩放与位移补偿） */
  _toPelicanLocal(v) {
    const P = this.pelican;
    const s = P.root.scale.x || 1;
    return v.clone().sub(P.root.position).divideScalar(s);
  }

  _pelicanRide(dt, B, f) {
    const P = this.pelican;
    // 车把握持点：转换到鹈鹕“自身坐标系”（含缩放补偿）
    const s = P.root.scale.x || 1;
    const gL = V3(0.21, 1.06, 0.42).sub(P.root.position).divideScalar(s);
    const gR = V3(-0.21, 1.06, 0.42).sub(P.root.position).divideScalar(s);
    P.update(dt, {
      mode: 'ride',
      weights: { ride: 1 },
      speed: B.speed, phase: B.phase, pedalAngle: B.pedalAngle,
      crankCenter: V3(0, -0.75, 0), pedalRadius: 0.17, pedalX: 0.12,
      gripL: gL, gripR: gR, flap: 0, time: this.time, stride: 0,
    });
  }

  /* ------------------------- 过场 ------------------------- */
  _updateTransition(dt) {
    const T = this.transition;
    if (!T) return;
    T.t += dt;
    const t = T.t;
    const P = this.pelican;

    if (T.back) { this._updateSwapBack(dt, T, t); return; }

    const B = this.bikeState;
    const C = this.carState;

    // 自行车刹停
    B.speed = damp(B.speed, 0, 4.5, dt);
    B.u = (B.u + (B.speed / this.world.trackLength) * dt) % 1;
    const f = this.world.frameAt(B.u);
    const bikePos = f.pos.clone().addScaledVector(f.side, B.lane);
    this.bike.root.position.copy(bikePos);
    this._m.makeBasis(V3().crossVectors(f.up, f.tangent).normalize(), f.up, f.tangent);
    this.bike.root.quaternion.setFromRotationMatrix(this._m);
    this.bike.root.quaternion.multiply(this._q.setFromAxisAngle(Z_AXIS, damp(B.lean, 0.62, 3, dt)));
    B.pedalAngle += (B.speed / 2.639) * TAU * dt * 0.55;
    this.bike.update(dt, { speed: B.speed, steer: 0, pedalAngle: B.pedalAngle, kickstand: true, time: this.time });

    // 阶段
    let phase = 'brake';
    if (t > 1.35) phase = 'dismount';
    if (t > 2.9) phase = 'walk';
    if (t > 5.0) phase = 'door';
    if (t > 6.1) phase = 'enter';
    if (t > 7.6) phase = 'close';
    if (t > 8.7) phase = 'launch';
    if (T.phase !== phase) {
      T.phase = phase;
      if (phase === 'door') this.audio.clunk();
      if (phase === 'close') { this.audio.clunk(); this.audio.startEngine(); this.car.setLights(true); this.lightsOn = true; const ck = document.getElementById('chkLights'); if (ck) ck.checked = true; }
      if (phase === 'launch') this.audio.whoosh(0.9);
    }

    // 鹈鹕世界位置
    const carDoor = this.car.root.localToWorld(V3(-1.25, 0.72, 0.05));
    const groundY = this.world.roadHeightAt(C.parkU);
    let target = this._v;
    let mode = 'stand', weights = { stand: 1 }, flap = 0, stride = 0;
    let setPos = true;          // 是否用 target 覆盖鹈鹕位置
    let inCar = P.root.parent === this.car.interior;

    if (phase === 'brake' || phase === 'dismount') {
      const k = clamp((t - 1.35) / 1.0, 0, 1);
      const p = T.dismountPos;
      // 从车座跳到车右侧
      const seat = V3(0, 0.885, -0.02).applyQuaternion(this.bike.root.quaternion).add(bikePos);
      target.copy(seat).lerp(p, easeOutBack(k));
      target.y = Math.max(p.y, seat.y - 0.95 * k);
      if (phase === 'dismount') {
        const hop = Math.sin(k * Math.PI) * 0.55;
        target.y += hop;
        weights = { stand: 1, air: k * 0.9 };
        mode = 'stand';
        flap = Math.sin(k * Math.PI) * 0.7;
      } else {
        weights = { ride: 1 - k * 0.6, stand: k * 0.6 };
      }
    } else if (phase === 'walk') {
      const k = clamp((t - 2.9) / 2.1, 0, 1);
      const from = T.dismountPos;
      const to = carDoor;
      target.copy(from).lerp(to, easeInOutCubic(k));
      target.y = groundY + 0.02;
      weights = { walk: 1 };
      mode = 'walk';
      stride = 0.26;
      P.root.rotation.y = Math.atan2(to.x - from.x, to.z - from.z);
    } else if (phase === 'door') {
      const k = clamp((t - 5.0) / 1.1, 0, 1);
      target.copy(carDoor).addScaledVector(this._carRight(), -0.18 * k);
      target.y = groundY + 0.02;
      weights = { stand: 1 };
      mode = 'stand';
      this.car.setDoor(easeOutCubic(k));
    } else if (phase === 'enter') {
      const k = clamp((t - 6.1) / 1.5, 0, 1);
      const seatPos = this.car.root.localToWorld(V3(-0.45, 0.95, -0.28));
      target.copy(carDoor).lerp(seatPos, easeInOutCubic(k));
      target.y = lerp(groundY + 0.02, seatPos.y, easeInOutCubic(k)) + Math.sin(k * Math.PI) * 0.42;
      weights = { stand: 1 - k, sit: k };
      mode = k > 0.5 ? 'sit' : 'stand';
      flap = Math.sin(k * Math.PI) * 0.5;
      if (k > 0.9) {
        // 完全入座，绑定到车内（此后位置由车辆驱动，不再写世界坐标）
        this.car.interior.add(P.root);
        P.root.position.set(-0.45, 0.95, -0.28);
        P.root.rotation.set(0, 0, 0);
        setPos = false;
        inCar = true;
      }
    } else if (phase === 'close') {
      const k = clamp((t - 7.6) / 1.1, 0, 1);
      this.car.setDoor(1 - easeOutCubic(k));
      weights = { sit: 1 };
      mode = 'sit';
      if (!inCar) {   // 兜底：确保入座
        this.car.interior.add(P.root);
        P.root.position.set(-0.45, 0.95, -0.28);
        P.root.rotation.set(0, 0, 0);
        inCar = true;
      }
      setPos = false;
    } else if (phase === 'launch') {
      const k = clamp((t - 8.7) / 2.6, 0, 1);
      weights = { sit: 1 };
      mode = 'sit';
      if (!inCar) {
        this.car.interior.add(P.root);
        P.root.position.set(-0.45, 0.95, -0.28);
        P.root.rotation.set(0, 0, 0);
        inCar = true;
      }
      setPos = false;
      // 并线起步
      const lat = lerp(C.parkLateral, C.lane, easeInOutCubic(k));
      this._placeCarOnTrack(C.parkU, lat);
      C.speed = lerp(0, 13, easeOutCubic(k));
      C.u = (C.parkU + (C.speed * k) / this.world.trackLength) % 1;
      C.gear = 'D';
      C.gearIndex = 1;
      C.rpm = 1400 + C.speed * 90;
      this.car.update(dt, { speed: C.speed, steer: 0, gear: 'D', gearIndex: 1, lateralG: 0, pitch: 0, suspension: 0 });
    }

    if (setPos) {
      P.root.position.copy(target);
    }
    if (phase === 'brake' || phase === 'dismount') {
      P.root.rotation.set(0, this.bike.root.rotation.y + Math.PI / 2, 0);
    }

    // 鹈鹕姿态
    P.update(dt, {
      mode, weights, speed: 4, phase: this.time * 6, pedalAngle: 0,
      crankCenter: V3(0, -0.75, 0), pedalRadius: 0.17, pedalX: 0.12,
      gripL: (mode === 'sit') ? this._toPelicanLocal(V3(-0.28, 0.88, 0.58)) : null,
      gripR: (mode === 'sit') ? this._toPelicanLocal(V3(-0.62, 0.88, 0.58)) : null,
      flap, time: this.time, stride,
    });

    // 相机主体
    if (phase === 'launch' || phase === 'close') {
      this._follow.pos.copy(this.car.root.position);
      this._follow.forward.copy(this._carForward());
      this._follow.right.copy(this._carRight());
      this._follow.up.set(0, 1, 0);
      this._follow.speed = C.speed;
    } else {
      this._follow.pos.copy(P.root.position);
      this._follow.forward.set(Math.sin(P.root.rotation.y), 0, Math.cos(P.root.rotation.y));
      this._follow.right.set(Math.cos(P.root.rotation.y), 0, -Math.sin(P.root.rotation.y));
      this._follow.up.set(0, 1, 0);
      this._follow.speed = 0;
    }

    // 结束
    if (t > 11.3) {
      this.stage = STAGE.DRIVE;
      this.stageTime = 0;
      this.transition = null;
      this.ui.setRideButton('done');
      this.ui.setMode('驾驶中', true);
      this.ui.setCamStage('car');
      this.setCamera('cockpit', 'car');
      this.letterboxTarget = Math.round(innerHeight * 0.055);
      this.ui.subtitle('坐稳了。接下来的路，交给你。', 3.6);
      if (this.carState.auto) this.ui.setDriveMode('auto');
      if (this._autoBack) setTimeout(() => this.toggleSwap(), 1200);
    }
  }

  /* ------------------------- 反向回单车 ------------------------- */
  _updateSwapBack(dt, T, t) {
    const P = this.pelican;
    const C = this.carState;
    const B = this.bikeState;
    let phase = 'stop';
    if (t > 1.1) phase = 'open';
    if (t > 2.3) phase = 'out';
    if (t > 3.5) phase = 'walkback';
    if (t > 5.6) phase = 'mount';
    if (t > 6.6) phase = 'done';
    if (T.phase !== phase) {
      T.phase = phase;
      if (phase === 'open') this.audio.clunk();
      if (phase === 'mount') this.audio.clunk();
    }

    C.speed = damp(C.speed, 0, 3, dt);
    C.u = (C.u + (C.speed / this.world.trackLength) * dt) % 1;
    this._placeCarOnTrack(C.u, C.lane);
    this.car.update(dt, { speed: C.speed, steer: 0, gear: 'N', gearIndex: 0, lateralG: 0, pitch: 0, suspension: 0 });

    const carDoor = this.car.root.localToWorld(V3(-1.25, 0.72, 0.05));
    const bikeSeat = V3(0, 0.885, -0.02).applyQuaternion(this.bike.root.quaternion).add(this.bike.root.position);

    let target = this._v;
    let mode = 'sit', weights = { sit: 1 }, flap = 0, stride = 0;

    if (phase === 'stop') {
      weights = { sit: 1 }; mode = 'sit';
      target.copy(P.root.position);
    } else if (phase === 'open') {
      const k = clamp((t - 1.1) / 1.2, 0, 1);
      this.car.setDoor(easeOutCubic(k));
      target.copy(this.car.interior.localToWorld(V3(-0.45, 0.95, -0.28)));
      weights = { sit: 1 }; mode = 'sit';
    } else if (phase === 'out') {
      const k = clamp((t - 2.3) / 1.2, 0, 1);
      this.car.setDoor(1);
      const from = this.car.interior.localToWorld(V3(-0.45, 0.95, -0.28));
      const to = carDoor;
      target.copy(from).lerp(to, easeInOutCubic(k));
      target.y = lerp(from.y, this.world.roadHeightAt(C.u) + 0.02, easeInOutCubic(k)) + Math.sin(k * Math.PI) * 0.4;
      weights = { sit: 1 - k, stand: k };
      mode = k > 0.5 ? 'stand' : 'sit';
      flap = Math.sin(k * Math.PI) * 0.6;
      if (k > 0.9) {
        this.scene.attach(P.root);
      }
    } else if (phase === 'walkback') {
      const k = clamp((t - 3.5) / 2.1, 0, 1);
      const from = carDoor;
      const to = this.bike.root.position.clone().addScaledVector(
        V3().crossVectors(this.world.frameAt(B.u).up, this.world.frameAt(B.u).tangent).normalize(), -1.1);
      to.y = this.world.roadHeightAt(B.u) + 0.02;
      target.copy(from).lerp(to, easeInOutCubic(k));
      target.y = to.y;
      weights = { walk: 1 };
      mode = 'walk';
      stride = 0.26;
      P.root.rotation.y = Math.atan2(to.x - from.x, to.z - from.z);
    } else if (phase === 'mount') {
      const k = clamp((t - 5.6) / 1.0, 0, 1);
      const seat = bikeSeat;
      target.copy(this.bike.root.position).addScaledVector(
        V3().crossVectors(this.world.frameAt(B.u).up, this.world.frameAt(B.u).tangent).normalize(), -1.1);
      target.lerp(seat, easeOutBack(k));
      target.y = lerp(this.world.roadHeightAt(B.u) + 0.02, seat.y, easeInOutCubic(k)) + Math.sin(k * Math.PI) * 0.5;
      weights = { stand: 1 - k, ride: k };
      mode = k > 0.6 ? 'ride' : 'stand';
      flap = Math.sin(k * Math.PI) * 0.7;
      if (k > 0.92) {
        this.bike.root.add(P.root);
        P.root.position.set(0, 0.885, -0.02);
        P.root.rotation.set(0, 0, 0);
      }
    } else {
      this.car.setDoor(0);
      this.car.setLights(false);
      weights = { ride: 1 }; mode = 'ride';
      target.copy(P.root.position);
    }

    if (phase !== 'mount' || (t - 5.6) / 1.0 < 0.92) P.root.position.copy(target);

    P.update(dt, {
      mode, weights, speed: 3, phase: this.time * 6, pedalAngle: 0,
      crankCenter: V3(0, -0.75, 0), pedalRadius: 0.17, pedalX: 0.12,
      gripL: mode === 'ride' ? this._toPelicanLocal(V3(0.21, 1.06, 0.42)) : null,
      gripR: mode === 'ride' ? this._toPelicanLocal(V3(-0.21, 1.06, 0.42)) : null,
      flap, time: this.time, stride,
    });

    this._follow.pos.copy(P.root.position);
    this._follow.forward.set(Math.sin(P.root.rotation.y), 0, Math.cos(P.root.rotation.y));
    this._follow.speed = 0;

    if (t > 6.6) {
      this.stage = STAGE.BIKE;
      this.transition = null;
      this.ui.setRideButton(null);
      this.ui.setMode('自行车', false);
      this.ui.setCamStage('bike');
      this.setCamera('cine', 'bike');
      this.ui.subtitle('回到最初的公路。', 3.0);
      this.bikeState.speed = 3;
    }
  }

  /* ------------------------- 驾驶阶段 ------------------------- */
  _updateDriveStage(dt) {
    const C = this.carState;
    const k = this.keys;
    const throttleKey = k.has('KeyW') || k.has('ArrowUp');
    const brakeKey = k.has('KeyS') || k.has('ArrowDown');
    const leftKey = k.has('KeyA') || k.has('ArrowLeft');
    const rightKey = k.has('KeyD') || k.has('ArrowRight');
    const handbrake = k.has('Space');

    if (C.auto) {
      this._autoDrive(dt);
    } else {
      this._manualDrive(dt, throttleKey, brakeKey, leftKey, rightKey, handbrake);
    }

    // 汽车视觉
    this.car.update(dt, {
      speed: C.speed, steer: C.steer, gear: C.gear, gearIndex: C.gearIndex,
      lateralG: C.lateralG, pitch: C.pitch, suspension: C.suspension,
    });
    this.car.setBrake(C.brake > 0.05 || (C.auto && C.speed < 1));
  }

  _autoDrive(dt) {
    const C = this.carState;
    const W = this.world;
    // 前视点
    const lookAhead = 0.010 + C.speed * 0.0009;
    const target = W.pointAt((C.u + lookAhead) % 1, C.lane);
    const pos = W.pointAt(C.u, C.lane);
    const fwd = W.frameAt(C.u).tangent;

    // 转向：指向目标点
    const toT = this._v.subVectors(target, pos);
    const desired = Math.atan2(toT.x, toT.z);
    const current = Math.atan2(fwd.x, fwd.z);
    let diff = desired - current;
    while (diff > Math.PI) diff -= TAU;
    while (diff < -Math.PI) diff += TAU;
    C.steer = damp(C.steer, clamp(diff * 2.2, -0.55, 0.55), 3.4, dt);
    C.lateralG = damp(C.lateralG, C.steer * (C.speed / 12), 4, dt);

    // 速度：油门与弯道限速
    const curveLimit = 1 - clamp(Math.abs(diff) * 2.2, 0, 0.62);
    const targetSpeed = C.throttle * 34 * curveLimit;
    C.speed = damp(C.speed, targetSpeed, C.speed < targetSpeed ? 0.9 : 2.2, dt);

    C.u = (C.u + (C.speed / W.trackLength) * dt) % 1;
    this._placeCarOnTrack(C.u, C.lane);
    C.pos.copy(this.car.root.position);
    C.pitch = damp(C.pitch, 0, 3, dt);
    C.suspension = damp(C.suspension, Math.sin(this.time * 9) * 0.4 * clamp(C.speed / 20, 0, 1), 8, dt);

    // 挡位
    C.gearIndex = clamp(Math.floor(C.speed / 9), 0, 4);
    C.gear = C.speed < 0.4 ? 'N' : 'D';
    C.rpm = 900 + C.speed * 95 + Math.sin(this.time * 12) * 60 * clamp(C.speed / 8, 0, 1);
  }

  _manualDrive(dt, thr, brk, left, right, hb) {
    const C = this.carState;
    const W = this.world;

    // 油门 / 刹车
    if (thr) C.speed += 9.5 * dt;
    if (brk) C.speed -= 16 * dt;
    C.speed -= C.speed * 0.32 * dt;
    if (hb) C.speed -= 9 * dt;
    C.speed = clamp(C.speed, 0, 62);
    C.brake = brk ? 1 : (hb ? 0.8 : 0);

    // 转向
    const steerIn = (left ? 1 : 0) - (right ? 1 : 0);
    C.steer = damp(C.steer, steerIn * 0.52, 7, dt);
    C.lateralG = damp(C.lateralG, C.steer * clamp(C.speed / 10, 0, 1.4), 5, dt);

    // 位姿
    C.heading -= C.steer * dt * clamp(C.speed / 9, 0, 1.6) * (hb ? 1.8 : 1);
    const step = C.speed * dt;
    const nx = C.pos.x + Math.sin(C.heading) * step;
    const nz = C.pos.z + Math.cos(C.heading) * step;

    // 贴地高度
    let bestU = 0, bestD = Infinity;
    for (let i = 0; i < 64; i++) {
      const u = i / 64;
      const p = W.curve.getPointAt(u);
      const d = (p.x - nx) ** 2 + (p.z - nz) ** 2;
      if (d < bestD) { bestD = d; bestU = u; }
    }
    C.u = bestU;
    const roadY = W.roadHeightAt(bestU);
    const onRoad = Math.sqrt(bestD) < 7.2;
    C.pos.set(nx, onRoad ? roadY : 0.0, nz);
    this.car.root.position.copy(C.pos);
    this.car.root.rotation.set(0, C.heading, 0);
    // 车身随路面起伏
    const aheadY = W.roadHeightAt((bestU + 0.004) % 1);
    C.pitch = damp(C.pitch, clamp((aheadY - roadY) * 3, -0.4, 0.4), 6, dt);
    this.car.root.rotation.x = C.pitch;
    C.suspension = damp(C.suspension, Math.sin(this.time * 11) * 0.5 * clamp(C.speed / 18, 0, 1), 8, dt);

    // 挡位
    C.gearIndex = clamp(Math.floor(C.speed / 9), 0, 4);
    C.gear = C.speed < 0.4 ? 'N' : 'D';
    C.rpm = 900 + C.speed * 100;
  }

  /* ------------------------------------------------------------------ */
  _updateFollow() {
    if (this.stage === STAGE.DRIVE) {
      this._follow.pos.copy(this.car.root.position);
      this._follow.forward.copy(this._carForward());
      this._follow.right.copy(this._carRight());
      this._follow.up.set(0, 1, 0);
      this._follow.speed = this.carState.speed;
    } else {
      const f = this.world.frameAt(this.bikeState.u);
      this._follow.pos.copy(this.bike.root.position);
      this._follow.forward.copy(f.tangent);
      this._follow.right.copy(f.side);
      this._follow.up.copy(f.up);
      this._follow.speed = this.bikeState.speed;
    }
  }

  _applyUserCam() {
    const d = this.director;
    if (d.mode === 'cockpit' || d.mode === 'hood' || d.mode === 'wheel') return;
    const u = this.userCam;
    if (Math.abs(u.yaw) < 0.001 && Math.abs(u.pitch) < 0.001 && Math.abs(u.dist - 1) < 0.001) return;
    const off = this._v.subVectors(d.targetPos, d.targetLook);
    const dist = off.length();
    this._q.setFromAxisAngle(Y_AXIS, u.yaw);
    off.applyQuaternion(this._q);
    const right = this._v2.crossVectors(Y_AXIS, off).normalize();
    this._q.setFromAxisAngle(right, u.pitch);
    off.applyQuaternion(this._q);
    off.setLength(dist * u.dist);
    d.targetPos.copy(d.targetLook).add(off);
  }

  /* ------------------------------------------------------------------ */
  loop() {
    if (!this.running) return;
    requestAnimationFrame(() => this.loop());
    const raw = this.clock.getDelta();
    let dt = Math.min(0.05, raw);
    if (this.slowmo) dt *= 0.32;
    try {
      this.update(dt);
      this.cine.render();
    } catch (err) {
      // 单帧异常不应中断整个演出：记录一次并继续
      if (!this._errLogged) {
        this._errLogged = true;
        console.error('[frame error]', err);
        const box = document.getElementById('errbox');
        if (box) {
          box.style.display = 'block';
          box.textContent += '[FRAME] ' + ((err && err.stack) || String(err)) + '\n';
        }
        this.ui?.subtitle?.('渲染出现异常，已跳过该帧', 3);
      }
    }
    // 调试探针（按 P 开关）
    const dbg = document.getElementById('dbg');
    if (dbg && this._dbgOn) {
      dbg.textContent = `running=${this.running} stage=${this.stage} mode=${this.director.mode}\n`
        + `fps=${this._fpsN || 0} bikeU=${this.bikeState.u.toFixed(3)} v=${this.bikeState.speed.toFixed(1)}\n`
        + `cam=(${this.camera.position.x.toFixed(1)},${this.camera.position.y.toFixed(1)},${this.camera.position.z.toFixed(1)}) `
        + `pel=(${this.pelican.root.position.x.toFixed(1)},${this.pelican.root.position.y.toFixed(1)},${this.pelican.root.position.z.toFixed(1)})`;
    }
    // FPS
    this._fpsAcc = (this._fpsAcc || 0) + Math.min(1, raw);
    this._fpsN = (this._fpsN || 0) + 1;
    if (this._fpsAcc > 0.5) {
      this.ui.setFps(Math.round(this._fpsN / this._fpsAcc));
      this._fpsAcc = 0; this._fpsN = 0;
    }
  }
}

/* ---------------------------------------------------------------- */
window.addEventListener('DOMContentLoaded', () => {
  const game = new Game();
  window.__game = game;
  game.ui.ready();

  // URL 深链参数：?auto=1&scene=neon&act=sprint&cam=cockpit&drive=manual
  const q = new URLSearchParams(location.search);
  if (q.has('scene')) game.setScene(q.get('scene'));
  if (q.has('act')) game.setAction(q.get('act'));
  if (q.has('drive')) game.setDrive(q.get('drive'));
  if (q.has('cam')) {
    const cam = q.get('cam');
    setTimeout(() => game.setCamera(cam, 'bike'), 400);
  }
  if (q.has('auto') || q.has('ride')) window.__startRequested = true;
  if (q.has('ride')) game.autoRide = true;
  if (q.has('back')) game._autoBack = true;
  if (q.has('debug')) {
    game._dbgOn = true;
    const d = document.getElementById('dbg');
    if (d) d.style.display = 'block';
  }
  if (q.has('hud') && q.get('hud') === '0') {
    document.body.classList.add('clean-mode');
  }
});
