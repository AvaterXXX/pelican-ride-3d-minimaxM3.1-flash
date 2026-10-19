import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { clamp } from './util.js';

/* 电影调色 + 颗粒 + 变形镜头色散 + 速度径向模糊 + 闪电闪白 */
const CinematicShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uGrain: { value: 0.45 },
    uVignette: { value: 0.85 },
    uAberration: { value: 0.9 },
    uSpeed: { value: 0 },
    uGrade: { value: 1 },
    uFlash: { value: 0 },
    uWarm: { value: new THREE.Color(1.0, 0.93, 0.82) },
    uCool: { value: new THREE.Color(0.72, 0.86, 1.12) },
    uSat: { value: 1.08 },
    uLift: { value: 0.008 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uTime, uGrain, uVignette, uAberration, uSpeed, uGrade, uFlash, uSat, uLift;
    uniform vec3 uWarm, uCool;
    varying vec2 vUv;

    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }

    void main(){
      vec2 uv = vUv;
      vec2 c  = uv - 0.5;
      float r2 = dot(c,c);

      // ---- 径向速度模糊 ----
      vec3 col = vec3(0.0);
      float amt = uSpeed * 0.055;
      if(amt > 0.0005){
        float w = 0.0;
        for(int i=0;i<8;i++){
          float t = float(i)/7.0;
          float s = 1.0 - t*amt*(0.25+r2*1.6);
          vec2 suv = c*s + 0.5;
          float wi = 1.0 - t*0.75;
          col += texture2D(tDiffuse, suv).rgb * wi;
          w += wi;
        }
        col /= w;
      } else {
        col = texture2D(tDiffuse, uv).rgb;
      }

      // ---- 镜头色散（边缘更强）----
      float ab = (0.0012 * uAberration) * (0.25 + r2*3.2);
      vec2 dir = normalize(c + 1e-5);
      float cr = texture2D(tDiffuse, uv + dir*ab).r;
      float cb = texture2D(tDiffuse, uv - dir*ab).b;
      col.r = mix(col.r, cr, 0.85);
      col.b = mix(col.b, cb, 0.85);

      // ---- teal / orange 电影调色 ----
      float lum = dot(col, vec3(0.2126,0.7152,0.0722));
      vec3 tint = mix(uCool, uWarm, smoothstep(0.18, 0.78, lum));
      col = mix(col, col * tint, uGrade);

      // ---- 饱和度 / 提黑 ----
      lum = dot(col, vec3(0.2126,0.7152,0.0722));
      col = mix(vec3(lum), col, uSat);
      col += uLift * (1.0 - lum);

      // ---- 暗角 ----
      float vig = smoothstep(0.92, 0.22, r2 * (1.0 + uVignette*0.9));
      col *= mix(1.0, vig, uVignette*0.9);

      // ---- 闪电闪白 ----
      col += uFlash * vec3(0.9, 0.95, 1.0);

      // ---- 胶片颗粒 ----
      float g = hash(uv * vec2(1920.0, 1080.0) + fract(uTime)*137.0) - 0.5;
      col += g * uGrain * 0.085 * (1.25 - lum);

      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }
  `,
};

export class Cinematic {
  constructor(renderer, scene, camera) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;

    const size = renderer.getSize(new THREE.Vector2());
    this.composer = new EffectComposer(renderer);
    this.composer.setPixelRatio(renderer.getPixelRatio());
    this.composer.setSize(size.x, size.y);

    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);

    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.62, 0.72, 0.82);
    this.composer.addPass(this.bloom);

    this.grade = new ShaderPass(CinematicShader);
    this.composer.addPass(this.grade);

    this.output = new OutputPass();
    this.composer.addPass(this.output);

    this.time = 0;
    this._flash = 0;
  }

  setSize(w, h) {
    this.composer.setSize(w, h);
    this.bloom.setSize(w, h);
  }

  /** 闪电 / 曝光冲击 */
  flash(power = 1) { this._flash = Math.min(1.6, this._flash + power); }

  update(dt, state) {
    this.time += dt;
    const u = this.grade.uniforms;
    u.uTime.value = this.time;
    u.uGrain.value = state.grain;
    u.uSpeed.value = clamp(state.speedBlur, 0, 1);
    u.uVignette.value = state.vignette;
    u.uAberration.value = state.aberration;
    u.uGrade.value = state.grade;
    u.uSat.value = state.saturation;
    this._flash = Math.max(0, this._flash - dt * 4.2);
    u.uFlash.value = this._flash;
    this.bloom.strength = state.bloom;
    if (state.warm) u.uWarm.value.set(...state.warm);
    if (state.cool) u.uCool.value.set(...state.cool);
  }

  render() { this.composer.render(); }
}
