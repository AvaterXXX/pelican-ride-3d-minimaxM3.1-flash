import { clamp } from './util.js';

/**
 * 全程序化音效：无任何外部音频素材，全部由 WebAudio 合成。
 * 引擎声 / 风噪 / 自行车链条 / 喇叭 / 铃声 / 过场 whoosh / 环境垫音
 */
export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.started = false;
    this.master = null;
  }

  start() {
    if (this.started) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    const ctx = this.ctx;

    this.master = ctx.createGain();
    this.master.gain.value = 0.0;
    this.master.connect(ctx.destination);

    // 噪声源
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;

    /* ---- 风噪 ---- */
    const wind = ctx.createBufferSource();
    wind.buffer = buf; wind.loop = true;
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.frequency.value = 700;
    this.windFilter.Q.value = 0.7;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0.0;
    wind.connect(this.windFilter).connect(this.windGain).connect(this.master);
    wind.start();

    /* ---- 引擎 ---- */
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0.0;
    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 900;
    this.engineFilter.Q.value = 3.5;
    this.engineFilter.connect(this.engineGain).connect(this.master);

    this.osc1 = ctx.createOscillator(); this.osc1.type = 'sawtooth'; this.osc1.frequency.value = 60;
    this.osc2 = ctx.createOscillator(); this.osc2.type = 'square'; this.osc2.frequency.value = 30;
    this.osc3 = ctx.createOscillator(); this.osc3.type = 'sawtooth'; this.osc3.frequency.value = 90;
    const g1 = ctx.createGain(); g1.gain.value = 0.5;
    const g2 = ctx.createGain(); g2.gain.value = 0.4;
    const g3 = ctx.createGain(); g3.gain.value = 0.18;
    this.osc1.connect(g1).connect(this.engineFilter);
    this.osc2.connect(g2).connect(this.engineFilter);
    this.osc3.connect(g3).connect(this.engineFilter);
    this.osc1.start(); this.osc2.start(); this.osc3.start();

    /* ---- 自行车链条/滚动 ---- */
    const bike = ctx.createBufferSource();
    bike.buffer = buf; bike.loop = true;
    this.bikeFilter = ctx.createBiquadFilter();
    this.bikeFilter.type = 'bandpass';
    this.bikeFilter.frequency.value = 1800;
    this.bikeFilter.Q.value = 5;
    this.bikeGain = ctx.createGain();
    this.bikeGain.gain.value = 0.0;
    bike.connect(this.bikeFilter).connect(this.bikeGain).connect(this.master);
    bike.start();

    /* ---- 环境垫音 ---- */
    this.padGain = ctx.createGain();
    this.padGain.gain.value = 0.05;
    this.padGain.connect(this.master);
    for (const f of [110, 164.8, 220]) {
      const o = ctx.createOscillator();
      o.type = 'sine'; o.frequency.value = f;
      const g = ctx.createGain(); g.gain.value = 0.25;
      const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07 + Math.random() * 0.09;
      const lg = ctx.createGain(); lg.gain.value = 0.12;
      lfo.connect(lg).connect(g.gain); lfo.start();
      o.connect(g).connect(this.padGain); o.start();
    }

    this.started = true;
    this.master.gain.linearRampToValueAtTime(0.85, ctx.currentTime + 1.4);
  }

  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }
  setEnabled(v) {
    this.enabled = v;
    if (this.master) this.master.gain.setTargetAtTime(v ? 0.85 : 0.0, this.ctx.currentTime, 0.12);
  }

  /** 每帧更新持续音 */
  update(dt, st) {
    if (!this.started || !this.enabled) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const carActive = st.carActive ? 1 : 0;
    const bikeActive = st.bikeActive ? 1 : 0;

    // 引擎
    const rpm = st.rpm || 0;
    const f = 32 + rpm * 0.11;
    this.osc1.frequency.setTargetAtTime(f * 2, t, 0.06);
    this.osc2.frequency.setTargetAtTime(f, t, 0.06);
    this.osc3.frequency.setTargetAtTime(f * 3.02, t, 0.06);
    this.engineFilter.frequency.setTargetAtTime(320 + rpm * 0.5, t, 0.08);
    this.engineGain.gain.setTargetAtTime(carActive * (0.05 + (st.throttle || 0) * 0.11), t, 0.1);

    // 风
    this.windGain.gain.setTargetAtTime(clamp((st.speed || 0) / 60, 0, 1) * 0.16, t, 0.2);
    this.windFilter.frequency.setTargetAtTime(420 + (st.speed || 0) * 22, t, 0.2);

    // 自行车
    this.bikeGain.gain.setTargetAtTime(bikeActive * clamp((st.bikeSpeed || 0) / 26, 0, 1) * 0.05, t, 0.12);
    this.bikeFilter.frequency.setTargetAtTime(900 + (st.bikeSpeed || 0) * 130, t, 0.12);
  }

  _env(node, gain, attack, decay) {
    const t = this.ctx.currentTime;
    node.gain.cancelScheduledValues(t);
    node.gain.setValueAtTime(0.0001, t);
    node.gain.exponentialRampToValueAtTime(Math.max(gain, 0.0002), t + attack);
    node.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  /** 喇叭 */
  horn(on = true) {
    if (!this.started) return;
    const ctx = this.ctx;
    if (!this._horn) {
      const g = ctx.createGain(); g.gain.value = 0;
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 2200;
      const o1 = ctx.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = 320;
      const o2 = ctx.createOscillator(); o2.type = 'square'; o2.frequency.value = 404;
      o1.connect(f); o2.connect(f); f.connect(g).connect(this.master);
      o1.start(); o2.start();
      this._horn = { g, o1, o2 };
    }
    this._horn.g.gain.setTargetAtTime(on ? 0.12 : 0, ctx.currentTime, 0.02);
  }

  /** 自行车铃 */
  bell() {
    if (!this.started) return;
    const ctx = this.ctx, t = ctx.currentTime;
    for (const [f, d, delay] of [[1180, 0.5, 0], [940, 0.7, 0.09]]) {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
      const g = ctx.createGain(); g.gain.value = 0;
      o.connect(g).connect(this.master);
      o.start(t + delay);
      g.gain.setValueAtTime(0.0001, t + delay);
      g.gain.exponentialRampToValueAtTime(0.12, t + delay + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + delay + d);
      o.stop(t + delay + d + 0.05);
    }
  }

  /** 过场 whoosh */
  whoosh(intensity = 1) {
    if (!this.started) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const s = ctx.createBufferSource(); s.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 1.4;
    f.frequency.setValueAtTime(280, t);
    f.frequency.exponentialRampToValueAtTime(2600 * intensity, t + 0.28);
    f.frequency.exponentialRampToValueAtTime(320, t + 0.62);
    const g = ctx.createGain(); g.gain.value = 0;
    s.connect(f).connect(g).connect(this.master);
    s.start(t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.14 * intensity, t + 0.12);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
    s.stop(t + 0.8);
  }

  /** 撞击 / 落地 */
  thud(power = 1) {
    if (!this.started) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(120 * power, t);
    o.frequency.exponentialRampToValueAtTime(36, t + 0.3);
    const g = ctx.createGain(); g.gain.value = 0;
    o.connect(g).connect(this.master);
    o.start(t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.3 * power, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
    o.stop(t + 0.5);
  }

  /** 门 / 机械声 */
  clunk() {
    if (!this.started) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const s = ctx.createBufferSource(); s.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 2200; f.Q.value = 6;
    const g = ctx.createGain(); g.gain.value = 0;
    s.connect(f).connect(g).connect(this.master);
    s.start(t);
    g.gain.setValueAtTime(0.08, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    s.stop(t + 0.2);
  }

  /** 引擎启动 */
  startEngine() {
    if (!this.started) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const s = ctx.createBufferSource(); s.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass';
    f.frequency.setValueAtTime(200, t);
    f.frequency.exponentialRampToValueAtTime(1400, t + 0.5);
    f.frequency.exponentialRampToValueAtTime(300, t + 1.2);
    const g = ctx.createGain(); g.gain.value = 0;
    s.connect(f).connect(g).connect(this.master);
    s.start(t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.22, t + 0.12);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.3);
    s.stop(t + 1.4);
  }
}
