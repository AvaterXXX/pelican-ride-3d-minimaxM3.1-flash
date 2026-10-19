import * as THREE from 'three';
import { mat, phys, emissive, cyl, sphere, roundedBox, box, tube, clamp, lerp, damp, TAU, canvasTexture } from './util.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

function profileShape(pts) {
  const s = new THREE.Shape();
  s.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]);
  s.closePath();
  return s;
}

export class Car {
  constructor(opts = {}) {
    this.root = new THREE.Group();
    this.root.name = 'car';
    this.paint = opts.paint || '#c0392b';
    this.wheelR = 0.36;
    this.wheelBase = 2.72;
    this.halfWidth = 0.98;

    const M = {
      paint: mat(this.paint, { roughness: 0.22, metalness: 0.72 }),
      paintDark: mat('#1a1c20', { roughness: 0.45, metalness: 0.5 }),
      glass: phys('#0e1620', { roughness: 0.06, metalness: 0.1, transparent: true, opacity: 0.32, transmission: 0.0, side: THREE.DoubleSide }),
      chrome: mat('#dfe4ea', { roughness: 0.12, metalness: 0.98 }),
      trim: mat('#15171b', { roughness: 0.55, metalness: 0.3 }),
      tire: mat('#141518', { roughness: 0.95 }),
      rim: mat('#cfd5dd', { roughness: 0.22, metalness: 0.9 }),
      interior: mat('#2a1f1b', { roughness: 0.85 }),
      interior2: mat('#3a2b24', { roughness: 0.8 }),
      head: emissive('#fff6d8', 0.6),
      tail: emissive('#ff2a2a', 0.7),
      reverse: emissive('#ffffff', 0.0),
      plate: mat('#e8e6dc', { roughness: 0.6 }),
    };
    this.M = M;

    this.shell = new THREE.Group();   // 外部车身
    this.glassGroup = new THREE.Group();
    this.roofGroup = new THREE.Group();
    this.interior = new THREE.Group();
    this.lights = new THREE.Group();
    this.root.add(this.shell, this.glassGroup, this.roofGroup, this.interior, this.lights);

    this._buildBody();
    this._buildCabin();
    this._buildWheels();
    this._buildInterior();
    this._buildLights();

    this.root.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  }

  /* ---------------- 车身 ---------------- */
  _buildBody() {
    const bodyPts = [
      [-2.30, 0.26], [-2.34, 0.60], [-2.10, 0.86], [-1.40, 0.94],
      [1.02, 0.94], [1.80, 0.88], [2.26, 0.74], [2.34, 0.46],
      [2.24, 0.24], [1.55, 0.20], [-1.55, 0.20],
    ];
    const geo = new THREE.ExtrudeGeometry(profileShape(bodyPts), {
      depth: this.halfWidth * 2, bevelEnabled: true, bevelSize: 0.07, bevelThickness: 0.07, bevelSegments: 4, curveSegments: 4,
    });
    geo.rotateY(-Math.PI / 2);
    geo.translate(this.halfWidth, 0, 0);
    geo.computeVertexNormals();
    const body = new THREE.Mesh(geo, this.M.paint);
    this.shell.add(body);
    this.body = body;

    // 前脸进气格栅
    const grille = roundedBox(1.5, 0.28, 0.12, 0.05, this.M.trim, 0.02);
    grille.position.set(0, 0.62, 2.30);
    this.shell.add(grille);
    for (let i = 0; i < 5; i++) {
      const bar = box(1.4, 0.025, 0.06, this.M.chrome);
      bar.position.set(0, 0.52 + i * 0.05, 2.34);
      this.shell.add(bar);
    }
    // 前唇
    const lip = roundedBox(1.86, 0.1, 0.34, 0.05, this.M.paintDark, 0.02);
    lip.position.set(0, 0.3, 2.22);
    this.shell.add(lip);
    // 后扩散器
    const diff = roundedBox(1.7, 0.16, 0.3, 0.05, this.M.paintDark, 0.02);
    diff.position.set(0, 0.32, -2.24);
    this.shell.add(diff);
    // 侧裙
    for (const s of [-1, 1]) {
      const skirt = roundedBox(0.12, 0.16, 3.1, 0.04, this.M.paintDark, 0.02);
      skirt.position.set(s * 0.96, 0.26, -0.1);
      this.shell.add(skirt);
    }
    // 后视镜
    for (const s of [-1, 1]) {
      const arm = box(0.16, 0.05, 0.05, this.M.paintDark);
      arm.position.set(s * 1.04, 0.98, 0.86);
      this.shell.add(arm);
      const mir = roundedBox(0.1, 0.13, 0.2, 0.04, this.M.paintDark, 0.015);
      mir.position.set(s * 1.16, 1.0, 0.86);
      this.shell.add(mir);
    }
    // 尾翼
    const wingPost = box(0.08, 0.22, 0.16, this.M.paintDark);
    wingPost.position.set(0, 1.1, -2.0);
    this.shell.add(wingPost);
    const wing = roundedBox(1.6, 0.06, 0.42, 0.03, this.M.paintDark, 0.015);
    wing.position.set(0, 1.22, -2.02);
    wing.rotation.x = -0.12;
    this.shell.add(wing);
    // 排气
    for (const s of [-1, 1]) {
      const ex = cyl(0.07, 0.08, 0.3, this.M.chrome, 10);
      ex.rotation.x = Math.PI / 2;
      ex.position.set(s * 0.5, 0.34, -2.32);
      this.shell.add(ex);
    }
    // 车牌
    const plate = roundedBox(0.5, 0.14, 0.03, 0.02, this.M.plate, 0.008);
    plate.position.set(0, 0.6, -2.33);
    this.shell.add(plate);
    const ptxt = canvasTexture(256, 72, (ctx, w, h) => {
      ctx.fillStyle = '#e8e6dc'; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#1a1c20';
      ctx.font = 'bold 44px "Arial Narrow", Impact, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('PELICAN 01', w / 2, h / 2 + 2);
    });
    const pface = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 0.12), new THREE.MeshStandardMaterial({ map: ptxt, roughness: 0.7 }));
    pface.position.set(0, 0.6, -2.35);
    pface.rotation.y = Math.PI;
    this.shell.add(pface);

    /* -------- 车门（驾驶侧，可开） -------- */
    this.doorHinge = new THREE.Group();
    this.doorHinge.position.set(-this.halfWidth - 0.02, 0, 0.95);
    this.shell.add(this.doorHinge);
    const doorShape = roundedBox(0.09, 0.66, 1.9, 0.06, this.M.paint, 0.02);
    doorShape.position.set(0, 0.6, -0.95);
    this.doorHinge.add(doorShape);
    // 门把手
    const handle = roundedBox(0.05, 0.05, 0.2, 0.02, this.M.chrome, 0.01);
    handle.position.set(-0.06, 0.78, -0.35);
    this.doorHinge.add(handle);
    // 门槛
    const sill = roundedBox(0.08, 0.1, 1.9, 0.03, this.M.paintDark, 0.015);
    sill.position.set(0, 0.28, -0.95);
    this.doorHinge.add(sill);
    this.door = this.doorHinge;

    // 驾驶侧门洞（暗色内衬，开门时可见）
    const cavity = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.72, 1.75), mat('#0b0c0f', { roughness: 1 }));
    cavity.position.set(-this.halfWidth + 0.02, 0.58, -0.02);
    this.shell.add(cavity);
  }

  /* ---------------- 座舱（敞篷：鹈鹕驾驶员需要敞篷空间） ---------------- */
  _buildCabin() {
    // 挡风玻璃框 + 防滚架（不封顶，鹈鹕的头颈才能自由伸展）
    const frameMat = this.M.paintDark;
    for (const s of [-1, 1]) {
      const pil = tube(V(s * 0.80, 0.92, 1.00), V(s * 0.72, 1.24, 0.44), 0.042, frameMat, 8);
      this.shell.add(pil);
    }
    const header = tube(V(-0.72, 1.24, 0.44), V(0.72, 1.24, 0.44), 0.038, frameMat, 8);
    this.shell.add(header);
    // 挡风玻璃（薄、略暗，位于框内）
    const wind = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.5), this.M.glass);
    wind.position.set(0, 1.06, 0.72);
    wind.rotation.x = -0.62;
    this.glassGroup.add(wind);
    // 防滚架（车内机位下会隐藏，避免遮挡画面）
    this.rollBar = new THREE.Group();
    const barMat = this.M.chrome;
    const hoop = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.035, 8, 24, Math.PI), barMat);
    hoop.position.set(0, 1.06, -0.92);
    this.rollBar.add(hoop);
    for (const s of [-1, 1]) {
      const stay = tube(V(s * 0.6, 0.86, -0.92), V(s * 0.6, 1.06, -0.92), 0.03, barMat, 6);
      this.rollBar.add(stay);
    }
    this.shell.add(this.rollBar);
  }

  /* ---------------- 车轮 ---------------- */
  _buildWheels() {
    this.wheels = [];
    const steerF = new THREE.Group();
    this.root.add(steerF);
    this.steerFront = steerF;

    const mk = (x, z, steered) => {
      const g = new THREE.Group();
      const tire = new THREE.Mesh(new THREE.CylinderGeometry(this.wheelR, this.wheelR, 0.28, 22, 1), this.M.tire);
      tire.rotation.z = Math.PI / 2;
      g.add(tire);
      const rim = new THREE.Mesh(new THREE.CylinderGeometry(this.wheelR * 0.66, this.wheelR * 0.66, 0.29, 20, 1), this.M.rim);
      rim.rotation.z = Math.PI / 2;
      g.add(rim);
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.31, 12), this.M.paintDark);
      hub.rotation.z = Math.PI / 2;
      g.add(hub);
      // 辐条
      for (let i = 0; i < 6; i++) {
        const sp = box(0.06, this.wheelR * 1.05, 0.07, this.M.paintDark);
        sp.rotation.x = (i / 6) * Math.PI;
        sp.position.x = (sp.position.x);
        g.add(sp);
      }
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.33, 10), this.M.chrome);
      cap.rotation.z = Math.PI / 2;
      g.add(cap);
      g.position.set(x, this.wheelR, z);
      g.userData.steered = steered;
      return g;
    };

    const fx = this.halfWidth * 0.88, bx = this.halfWidth * 0.88;
    const fz = this.wheelBase / 2, bz = -this.wheelBase / 2;
    // 前轮（可转向）
    this.fl = mk(-fx, fz, true); this.fr = mk(fx, fz, true);
    steerF.add(this.fl, this.fr);
    steerF.position.set(0, 0, 0);
    this.fl.position.set(-fx, this.wheelR, fz);
    this.fr.position.set(fx, this.wheelR, fz);
    // 后轮
    this.rl = mk(-bx, bz, false); this.rr = mk(bx, bz, false);
    this.root.add(this.rl, this.rr);

    this.wheels = [this.fl, this.fr, this.rl, this.rr];
    this.wheelSpin = 0;
  }

  /* ---------------- 内饰 ---------------- */
  _buildInterior() {
    const I = this.interior;
    // 地板
    const floor = box(1.7, 0.06, 3.0, this.M.trim);
    floor.position.set(0, 0.4, -0.2);
    I.add(floor);
    // 仪表台
    const dash = roundedBox(1.72, 0.26, 0.46, 0.08, this.M.interior, 0.02);
    dash.position.set(0, 0.86, 0.82);
    I.add(dash);
    // 仪表台上盖
    const dashTop = roundedBox(1.68, 0.05, 0.3, 0.04, this.M.interior2, 0.015);
    dashTop.position.set(0, 1.0, 0.78);
    I.add(dashTop);
    // 中控屏
    const scr = roundedBox(0.34, 0.24, 0.04, 0.03, emissive('#2ad4ff', 0.8), 0.01);
    scr.position.set(0.05, 0.94, 0.66);
    scr.rotation.x = 0.2;
    I.add(scr);
    this.screen = scr;
    // 仪表盘（驾驶侧）
    const gaugeTex = canvasTexture(512, 256, (ctx, w, h) => {
      ctx.fillStyle = '#0a0c10'; ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = '#f2c26b'; ctx.lineWidth = 6;
      ctx.beginPath(); ctx.arc(150, 128, 96, Math.PI * 0.78, Math.PI * 2.22); ctx.stroke();
      ctx.strokeStyle = '#4fd0ff'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(360, 128, 76, Math.PI * 0.78, Math.PI * 2.22); ctx.stroke();
      ctx.fillStyle = '#f2c26b'; ctx.font = 'bold 30px "Arial Narrow", sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('KM/H', 150, 210);
      ctx.fillStyle = '#4fd0ff'; ctx.font = 'bold 26px "Arial Narrow", sans-serif';
      ctx.fillText('RPM ×1000', 360, 210);
    });
    const cluster = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.3), new THREE.MeshStandardMaterial({
      map: gaugeTex, emissiveMap: gaugeTex, emissive: new THREE.Color('#ffffff'), emissiveIntensity: 0.9, roughness: 0.5,
    }));
    cluster.position.set(-0.45, 0.99, 0.66);
    cluster.rotation.x = 0.32;
    I.add(cluster);
    this.cluster = cluster;
    this.clusterTex = gaugeTex;

    // 方向盘
    this.steerWheel = new THREE.Group();
    this.steerWheel.position.set(-0.45, 0.88, 0.58);
    this.steerWheel.rotation.x = -0.42;
    I.add(this.steerWheel);
    const rimW = new THREE.Mesh(new THREE.TorusGeometry(0.185, 0.022, 10, 30), this.M.interior);
    this.steerWheel.add(rimW);
    const hubW = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.05, 12), this.M.paintDark);
    hubW.rotation.x = Math.PI / 2;
    this.steerWheel.add(hubW);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + Math.PI / 2;
      const sp = box(0.03, 0.17, 0.02, this.M.chrome);
      sp.position.set(Math.cos(a) * 0.09, Math.sin(a) * 0.09, 0);
      sp.rotation.z = a - Math.PI / 2;
      this.steerWheel.add(sp);
    }
    const badge = new THREE.Mesh(new THREE.CircleGeometry(0.035, 12), emissive('#f2c26b', 0.6));
    badge.position.z = 0.028;
    this.steerWheel.add(badge);
    // 转向柱
    const col = cyl(0.03, 0.03, 0.3, this.M.trim, 8);
    col.position.set(-0.45, 0.8, 0.66);
    col.rotation.x = -0.42;
    I.add(col);

    // 座椅
    const mkSeat = (x, z) => {
      const s = new THREE.Group();
      const base = roundedBox(0.52, 0.16, 0.52, 0.08, this.M.interior, 0.03);
      base.position.set(0, 0.52, 0);
      s.add(base);
      const back = roundedBox(0.5, 0.72, 0.16, 0.08, this.M.interior, 0.03);
      back.position.set(0, 0.92, -0.2);
      back.rotation.x = -0.16;
      s.add(back);
      const head = roundedBox(0.3, 0.2, 0.13, 0.06, this.M.interior2, 0.03);
      head.position.set(0, 1.3, -0.28);
      s.add(head);
      for (const sx of [-1, 1]) {
        const bol = roundedBox(0.1, 0.5, 0.14, 0.05, this.M.interior2, 0.02);
        bol.position.set(sx * 0.22, 0.86, -0.18);
        bol.rotation.x = -0.16;
        s.add(bol);
      }
      s.position.set(x, 0, z);
      return s;
    };
    this.seatL = mkSeat(-0.45, -0.28);
    this.seatR = mkSeat(0.45, -0.28);
    I.add(this.seatL, this.seatR);

    // 中控 / 换挡杆 / 手刹
    const console3 = roundedBox(0.3, 0.18, 1.0, 0.05, this.M.trim, 0.02);
    console3.position.set(0, 0.6, -0.05);
    I.add(console3);
    this.shifter = new THREE.Group();
    this.shifter.position.set(0, 0.7, 0.12);
    I.add(this.shifter);
    const stick = cyl(0.018, 0.024, 0.26, this.M.chrome, 8);
    stick.position.y = 0.13;
    this.shifter.add(stick);
    const knob = sphere(0.05, this.M.interior2, 12, 10);
    knob.position.y = 0.28;
    this.shifter.add(knob);
    const hb = cyl(0.016, 0.016, 0.3, this.M.chrome, 8);
    hb.rotation.x = -0.5;
    hb.position.set(0.16, 0.72, -0.4);
    I.add(hb);

    // 后视镜
    const mirror = roundedBox(0.26, 0.09, 0.03, 0.02, this.M.trim, 0.01);
    mirror.position.set(0, 1.16, 0.5);
    I.add(mirror);
    // 顶灯
    const dome = sphere(0.05, emissive('#ffeccc', 0.7), 10, 8);
    dome.position.set(0, 1.2, 0.25);
    I.add(dome);
  }

  /* ---------------- 灯光 ---------------- */
  _buildLights() {
    // 大灯
    this.headMat = emissive('#fff6d8', 0.55);
    this.tailMat = emissive('#ff2222', 0.6);
    for (const s of [-1, 1]) {
      const hl = roundedBox(0.42, 0.16, 0.12, 0.06, this.headMat, 0.02);
      hl.position.set(s * 0.58, 0.74, 2.28);
      this.lights.add(hl);
      const tl = roundedBox(0.46, 0.14, 0.1, 0.05, this.tailMat, 0.02);
      tl.position.set(s * 0.62, 0.78, -2.32);
      this.lights.add(tl);
    }
    // 光束
    this.beams = [];
    for (const s of [-1, 1]) {
      const cone = new THREE.Mesh(new THREE.ConeGeometry(1.5, 22, 14, 1, true), new THREE.MeshBasicMaterial({
        color: '#ffeec4', transparent: true, opacity: 0.0, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      cone.rotation.x = Math.PI / 2;
      cone.position.set(s * 0.58, 0.72, 2.3 + 11);
      this.lights.add(cone);
      this.beams.push(cone);
    }
    this.spot = new THREE.SpotLight(0xfff0d0, 0, 60, 0.42, 0.45, 1.4);
    this.spot.position.set(0, 0.8, 2.2);
    this.root.add(this.spot);
    this.spotTarget = new THREE.Object3D();
    this.spotTarget.position.set(0, 0.2, 30);
    this.root.add(this.spotTarget);
    this.spot.target = this.spotTarget;
  }

  setLights(on) {
    this.lightsOn = on;
    this.headMat.emissiveIntensity = on ? 3.2 : 0.45;
    this.spot.intensity = on ? 140 : 0;
    for (const b of this.beams) b.material.opacity = on ? 0.055 : 0;
  }
  setBrake(on) {
    this.brakeOn = on;
    this.tailMat.emissiveIntensity = on ? 3.4 : (this.lightsOn ? 1.2 : 0.4);
  }

  setDoor(t) {
    this.doorT = t;
    this.doorHinge.rotation.y = t * 1.05;
  }

  /** 车内机位锚点：越过驾驶席肩位（同时框住鹈鹕与前方公路） */
  getCockpitAnchor() {
    if (!this._cockpit) {
      this._cockpit = new THREE.Object3D();
      this._cockpit.position.set(-0.52, 1.76, -1.42);
      this.interior.add(this._cockpit);
    }
    return this._cockpit;
  }
  getWheelAnchor() {
    if (!this._wheelAnchor) {
      this._wheelAnchor = new THREE.Object3D();
      this._wheelAnchor.position.set(-0.98, 0.36, -0.2);
      this.root.add(this._wheelAnchor);
    }
    return this._wheelAnchor;
  }

  update(dt, st) {
    // 轮子
    this.wheelSpin += (st.speed / this.wheelR) * dt;
    for (const w of this.wheels) w.rotation.x = this.wheelSpin;
    // 前轮转向
    this.steerFront.rotation.y = -(st.steer || 0);
    // 方向盘
    this.steerWheel.rotation.z = -(st.steer || 0) * 3.4;
    // 换挡杆动画
    if (this.shifter) {
      const g = st.gear === 'R' ? 0.35 : st.gear === 'N' ? 0 : clamp((st.gearIndex || 0) * 0.06, 0, 0.42);
      this.shifter.rotation.x = damp(this.shifter.rotation.x, g, 8, dt);
    }
    // 车身姿态
    this.body.rotation.z = damp(this.body.rotation.z, clamp(-(st.lateralG || 0) * 0.06, -0.09, 0.09), 6, dt);
    this.body.rotation.x = damp(this.body.rotation.x, clamp((st.pitch || 0) * 0.02, -0.05, 0.05), 6, dt);
    this.interior.position.y = damp(this.interior.position.y, (st.suspension || 0) * 0.04, 10, dt);
    this.interior.rotation.z = damp(this.interior.rotation.z, clamp((st.lateralG || 0) * 0.03, -0.05, 0.05), 7, dt);
  }
}
