import { clamp, lerp, damp } from './util.js';

const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));

export class UI {
  constructor(handlers = {}) {
    this.h = handlers;
    this.el = {
      loader: $('#loader'), loaderText: $('#loaderText'),
      gate: $('#gate'), gateBar: $('#gateBar'), start: $('#btnStart'),
      bar: $('#barTop'), barBot: $('#barBot'),
      title: $('#titleCard'),
      chipMode: $('#chipMode'), chipScene: $('#chipScene'), chipCam: $('#chipCam'), chipFps: $('#chipFps'),
      speedo: $('#speedo'), hud: $('#hud'),
      valSpeed: $('#valSpeed'), valGear: $('#valGear'), valRpm: $('#valRpm'),
      subtitle: $('#subtitle'),
      panel: $('#panel'), panelBody: $('#panelBody'), collapse: $('#btnCollapse'),
      btnRide: $('#btnRide'), btnScene: $('#btnScene'), btnCam: $('#btnCam'),
      btnAuto: $('#btnAuto'), btnHorn: $('#btnHorn'), btnSwap: $('#btnSwap'),
      grainLayer: $('#grainLayer'), flareLayer: $('#flareLayer'),
    };
    this.speedoCtx = this.el.speedo.getContext('2d');
    this.subtitleTimer = 0;
    this.dispSpeed = 0;
    this.dispRpm = 0;
    this.hornOn = false;
    this._bind();
  }

  _bind() {
    const h = this.h;
    this.el.start.addEventListener('click', () => h.onStart?.());
    window.addEventListener('keydown', e => {
      // 放映前空格也可开始；开始后空格留给手刹漂移
      if (e.code === 'Space' && !this._started) {
        if (e.target.tagName === 'INPUT') return;
        e.preventDefault();
        window.__startRequested = true;
        h.onStart?.();
      }
    });

    this.el.collapse.addEventListener('click', () => {
      this.el.panel.classList.toggle('collapsed');
      this.el.collapse.textContent = this.el.panel.classList.contains('collapsed') ? '+' : '−';
    });
    this.el.btnRide.addEventListener('click', () => h.onRide?.());
    this.el.btnScene.addEventListener('click', () => {
      this.el.panel.classList.remove('collapsed');
      this.el.collapse.textContent = '−';
      this._scrollTo('segScene');
    });
    this.el.btnCam.addEventListener('click', () => {
      this.el.panel.classList.remove('collapsed');
      this.el.collapse.textContent = '−';
      this._scrollTo('segCamBike');
    });
    this.el.btnAuto.addEventListener('click', () => h.onToggleAuto?.());
    this.el.btnHorn.addEventListener('click', () => { this.hornOn = !this.hornOn; h.onHorn?.(this.hornOn); this.el.btnHorn.classList.toggle('on', this.hornOn); });
    this.el.btnSwap.addEventListener('click', () => h.onSwap?.());

    // 分段按钮
    const seg = (id, cb) => {
      $$(`#${id} button`).forEach(b => b.addEventListener('click', () => {
        $$(`#${id} button`).forEach(x => x.classList.remove('on'));
        b.classList.add('on');
        cb(b.dataset);
      }));
    };
    seg('segScene', d => h.onScene?.(d.scene));
    seg('segAction', d => h.onAction?.(d.act));
    seg('segCamBike', d => h.onCamera?.(d.cam, 'bike'));
    seg('segCamCar', d => h.onCamera?.(d.cam, 'car'));
    seg('segDrive', d => h.onDrive?.(d.drive));

    // 滑块
    const slider = (id, cb, fmt) => {
      const el = $(`#${id}`); const lbl = $(`#lbl${id.slice(3)}`);
      const apply = () => { const v = +el.value; if (lbl) lbl.textContent = fmt ? fmt(v) : v; cb(v); };
      el.addEventListener('input', apply);
      return { el, apply };
    };
    this.sTime = slider('rngTime', v => h.onTime?.(v / 100),
      v => v < 10 ? '日出' : v < 38 ? '上午' : v < 62 ? '正午' : v < 88 ? '黄昏' : '日落');
    this.sFog = slider('rngFog', v => h.onFog?.(v / 100));
    this.sGrain = slider('rngGrain', v => h.onGrain?.(v / 100));
    this.sBloom = slider('rngBloom', v => h.onBloom?.(v / 100));
    this.sSpeed = slider('rngSpeed', v => h.onBikeSpeed?.(v / 100));
    this.sLean = slider('rngLean', v => h.onLean?.(v / 100));
    this.sThrottle = slider('rngThrottle', v => h.onThrottle?.(v / 100));
    this.sSteer = slider('rngSteer', v => h.onSteerSens?.(v / 100));
    this.sFov = slider('rngFov', v => h.onFov?.(v / 100));

    // 勾选
    const chk = (id, cb) => $(`#${id}`).addEventListener('change', e => cb(e.target.checked));
    chk('chkLights', v => h.onLights?.(v));
    chk('chkAuto', v => h.onToggleAuto?.(v));
    chk('chkSlow', v => h.onSlow?.(v));
    chk('chkShake', v => h.onShake?.(v));
    chk('chkAudio', v => h.onAudio?.(v));
    chk('chkHud', v => this.el.hud.classList.toggle('off', !v));

    // 默认选中
    $$('#segScene button')[0]?.classList.add('on');
    $$('#segAction button')[0]?.classList.add('on');
    $$('#segCamBike button')[0]?.classList.add('on');
    $$('#segDrive button')[0]?.classList.add('on');

    // 引擎就绪后才允许点击开始
    this.el.start.disabled = false;
    this.el.start.textContent = '按 空格 开始放映';
  }

  /** 引擎就绪：解锁开始按钮 */
  ready() {
    this.el.start.disabled = false;
    this.el.start.textContent = '按 空格 开始放映';
  }

  _scrollTo(id) {
    const t = document.getElementById(id);
    if (t) t.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  setLoading(p, text) {
    if (text) this.el.loaderText.textContent = text;
    this.el.gateBar.style.width = `${clamp(p, 0, 1) * 100}%`;
  }
  hideLoader() {
    this.el.loader.classList.add('off');
    setTimeout(() => { this.el.loader.style.display = 'none'; }, 800);
  }
  hideGate() {
    this._started = true;
    this.el.gate.classList.add('off');
    setTimeout(() => { this.el.gate.style.display = 'none'; }, 900);
  }

  setLetterbox(px) {
    document.documentElement.style.setProperty('--bar', `${px}px`);
  }

  showTitle(on) { this.el.title.classList.toggle('on', on); }

  subtitle(text, dur = 3.2) {
    const el = this.el.subtitle;
    el.querySelector('span').textContent = text;
    el.classList.add('on');
    this.subtitleTimer = dur;
  }

  setMode(label, live) {
    this.el.chipMode.querySelector('b').textContent = label;
    this.el.chipMode.classList.toggle('live', !!live);
  }
  setScene(label) { this.el.chipScene.querySelector('b').textContent = label; }

  /** 同步场景分段按钮的选中态（供深链参数调用） */
  setSceneActive(name) {
    $$('#segScene button').forEach(b => b.classList.toggle('on', b.dataset.scene === name));
  }
  setCamActive(name) {
    $$('#segCamBike button').forEach(b => b.classList.toggle('on', b.dataset.cam === name));
    $$('#segCamCar button').forEach(b => b.classList.toggle('on', b.dataset.cam === name));
  }
  setActionActive(name) {
    $$('#segAction button').forEach(b => b.classList.toggle('on', b.dataset.act === name));
  }
  setCam(label) { this.el.chipCam.querySelector('b').textContent = label; }
  setFps(v) { this.el.chipFps.querySelector('b').textContent = v; }

  setRideButton(state) {
    const b = this.el.btnRide;
    b.classList.remove('busy', 'done');
    if (state === 'busy') {
      b.classList.add('busy');
      b.querySelector('.pk').textContent = '进行中';
      b.querySelector('.p1').textContent = '换车中…';
      b.querySelector('.p2').textContent = 'SEQUENCE';
    } else if (state === 'done') {
      b.classList.add('done');
      b.querySelector('.pk').textContent = '重播';
      b.querySelector('.p1').textContent = '再来一次';
      b.querySelector('.p2').textContent = 'REPLAY';
    } else {
      b.querySelector('.pk').textContent = '开始';
      b.querySelector('.p1').textContent = '骑车出发';
      b.querySelector('.p2').textContent = 'RIDE & DRIVE';
    }
  }

  setCamStage(stage) {
    const bike = document.getElementById('segCamBike');
    const car = document.getElementById('segCamCar');
    bike.style.opacity = stage === 'car' ? '0.34' : '1';
    bike.style.pointerEvents = stage === 'car' ? 'none' : 'auto';
    car.classList.toggle('on-stage', stage === 'car');
  }

  setDriveMode(mode) {
    $$('#segDrive button').forEach(b => b.classList.toggle('on', b.dataset.drive === mode));
    this.el.btnAuto.classList.toggle('on', mode === 'auto');
    const chk = $('#chkAuto'); if (chk) chk.checked = mode === 'auto';
  }

  setAction(name) {
    $$('#segAction button').forEach(b => b.classList.toggle('on', b.dataset.act === name));
  }

  update(dt, st) {
    // 字幕计时
    if (this.subtitleTimer > 0) {
      this.subtitleTimer -= dt;
      if (this.subtitleTimer <= 0) this.el.subtitle.classList.remove('on');
    }
    // 数值平滑
    this.dispSpeed = damp(this.dispSpeed, st.speed * 3.6, 6, dt);
    this.dispRpm = damp(this.dispRpm, st.rpm, 6, dt);
    this.el.valSpeed.textContent = Math.round(this.dispSpeed);
    this.el.valGear.textContent = st.gear;
    this.el.valRpm.textContent = Math.round(this.dispRpm);
    this._drawSpeedo(st);
  }

  _drawSpeedo(st) {
    const c = this.speedoCtx;
    const W = 320, H = 320, cx = 160, cy = 160, R = 128;
    c.clearRect(0, 0, W, H);

    // 外圈
    c.save();
    c.translate(cx, cy);
    // 背板
    const g = c.createRadialGradient(0, 0, 10, 0, 0, R + 16);
    g.addColorStop(0, 'rgba(8,10,14,0.78)');
    g.addColorStop(1, 'rgba(8,10,14,0)');
    c.fillStyle = g;
    c.beginPath(); c.arc(0, 0, R + 16, 0, Math.PI * 2); c.fill();

    const A0 = Math.PI * 0.75, A1 = Math.PI * 2.25;
    // 刻度弧
    c.lineWidth = 2;
    c.strokeStyle = 'rgba(255,255,255,0.10)';
    c.beginPath(); c.arc(0, 0, R, A0, A1); c.stroke();

    const max = 260;
    const frac = clamp(this.dispSpeed / max, 0, 1);
    // 速度弧
    const grad = c.createLinearGradient(-R, R, R, -R);
    grad.addColorStop(0, '#5ad7ff');
    grad.addColorStop(0.55, '#f2c26b');
    grad.addColorStop(1, '#ff5b5b');
    c.lineWidth = 9;
    c.strokeStyle = grad;
    c.lineCap = 'round';
    c.beginPath(); c.arc(0, 0, R, A0, A0 + (A1 - A0) * frac); c.stroke();
    // 红区
    c.lineWidth = 3;
    c.strokeStyle = 'rgba(255,80,80,0.6)';
    c.beginPath(); c.arc(0, 0, R + 11, A0 + (A1 - A0) * 0.78, A1); c.stroke();

    // 刻度
    for (let i = 0; i <= 13; i++) {
      const a = A0 + (A1 - A0) * (i / 13);
      const big = i % 2 === 0;
      const r0 = R - (big ? 22 : 13), r1 = R - 6;
      c.strokeStyle = big ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.22)';
      c.lineWidth = big ? 2.4 : 1.2;
      c.beginPath();
      c.moveTo(Math.cos(a) * r0, Math.sin(a) * r0);
      c.lineTo(Math.cos(a) * r1, Math.sin(a) * r1);
      c.stroke();
      if (big) {
        c.fillStyle = 'rgba(255,255,255,0.5)';
        c.font = '600 17px "Bebas Neue", Impact, sans-serif';
        c.textAlign = 'center'; c.textBaseline = 'middle';
        c.fillText(String(i * 20), Math.cos(a) * (R - 40), Math.sin(a) * (R - 40));
      }
    }

    // 指针
    const na = A0 + (A1 - A0) * frac;
    c.save();
    c.rotate(na);
    c.fillStyle = '#ff5b5b';
    c.beginPath();
    c.moveTo(-6, -4); c.lineTo(R - 16, -1.6); c.lineTo(R - 16, 1.6); c.lineTo(-6, 4);
    c.closePath(); c.fill();
    c.restore();
    c.fillStyle = '#e6ecf3';
    c.beginPath(); c.arc(0, 0, 7, 0, Math.PI * 2); c.fill();

    // 数字
    c.textAlign = 'center';
    c.fillStyle = '#ffffff';
    c.font = '600 52px "Bebas Neue", Impact, sans-serif';
    c.fillText(String(Math.round(this.dispSpeed)), 0, 46);
    c.fillStyle = 'rgba(200,210,225,0.65)';
    c.font = '600 15px "Bebas Neue", Impact, sans-serif';
    c.fillText('KM/H', 0, 66);
    // 挡位
    c.fillStyle = '#f2c26b';
    c.font = '600 22px "Bebas Neue", Impact, sans-serif';
    c.fillText(st.gear, 0, 96);
    c.restore();
  }
}
