import * as THREE from 'three';
import { clamp } from './util.js';

const SKY_VERT = /* glsl */`
varying vec3 vDir;
void main(){
  vDir = normalize(position);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
}`;

const SKY_FRAG = /* glsl */`
uniform vec3 uZenith, uHorizon, uGround, uSunCol, uSunDir, uCloudCol, uCloudDark;
uniform float uSunSize, uSunGlow, uStars, uCloud, uTime, uHaze, uCloudSpeed;
varying vec3 vDir;

float hash(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f*f*(3.0-2.0*f);
  float a = hash(i), b = hash(i+vec2(1,0)), c = hash(i+vec2(0,1)), d = hash(i+vec2(1,1));
  return mix(mix(a,b,f.x), mix(c,d,f.x), f.y);
}
float fbm(vec2 p){
  float s = 0.0, a = 0.5;
  for(int i=0;i<5;i++){ s += noise(p)*a; p = p*2.03 + 7.1; a *= 0.5; }
  return s;
}

void main(){
  vec3 d = normalize(vDir);
  float h = d.y;

  // 基础渐变
  float t = pow(clamp(h, 0.0, 1.0), 0.42);
  vec3 col = mix(uHorizon, uZenith, t);
  col = mix(col, uGround, smoothstep(0.0, -0.16, h));

  // 地平线雾霭
  float horizonBand = exp(-abs(h)*13.0);
  col = mix(col, uHorizon*1.08, horizonBand*uHaze);

  // 太阳
  float sd = max(dot(d, normalize(uSunDir)), 0.0);
  float disc = smoothstep(1.0 - uSunSize, 1.0 - uSunSize*0.55, sd);
  float glow = pow(sd, 90.0)*0.85 + pow(sd, 8.0)*0.30 + pow(sd, 2.0)*0.06;
  col += uSunCol * (disc*2.4 + glow*uSunGlow);

  // 云层
  if(uCloud > 0.001 && h > -0.02){
    vec2 cp = d.xz / max(h + 0.12, 0.10);
    cp *= 0.55;
    cp += vec2(uTime*uCloudSpeed, uTime*uCloudSpeed*0.35);
    float n = fbm(cp);
    float n2 = fbm(cp*1.9 + 13.0);
    float dens = smoothstep(0.46, 0.86, n*0.75 + n2*0.35);
    dens *= smoothstep(-0.02, 0.16, h);
    float lit = smoothstep(0.4, 0.95, n2);
    vec3 cc = mix(uCloudDark, uCloudCol, lit);
    // 靠近太阳的云被镶边
    cc += uSunCol * pow(sd, 6.0) * 0.55 * dens;
    col = mix(col, cc, dens*uCloud);
  }

  // 星空
  if(uStars > 0.001){
    vec2 sp = floor(d.xz / max(abs(d.y)+0.15, 0.2) * 90.0);
    float s = hash(sp);
    float star = step(0.9955, s) * smoothstep(0.0, 0.25, h);
    float tw = 0.6 + 0.4*sin(uTime*2.4 + s*60.0);
    col += vec3(star*tw*uStars*1.4);
  }

  gl_FragColor = vec4(col, 1.0);
}`;

export class Sky {
  constructor(scene) {
    this.uniforms = {
      uZenith: { value: new THREE.Color('#1d3a6b') },
      uHorizon: { value: new THREE.Color('#ffb15c') },
      uGround: { value: new THREE.Color('#241a12') },
      uSunCol: { value: new THREE.Color('#ffd9a0') },
      uSunDir: { value: new THREE.Vector3(0.4, 0.18, -1).normalize() },
      uCloudCol: { value: new THREE.Color('#ffcf9a') },
      uCloudDark: { value: new THREE.Color('#4a3550') },
      uSunSize: { value: 0.006 },
      uSunGlow: { value: 1.0 },
      uStars: { value: 0.0 },
      uCloud: { value: 0.72 },
      uHaze: { value: 0.45 },
      uCloudSpeed: { value: 0.004 },
      uTime: { value: 0 },
    };
    this.mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: SKY_VERT, fragmentShader: SKY_FRAG,
      side: THREE.BackSide, depthWrite: false, fog: false,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(700, 48, 32), this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1000;
    scene.add(this.mesh);
    this.time = 0;
  }

  set(p) {
    const u = this.uniforms;
    if (p.zenith) u.uZenith.value.set(p.zenith);
    if (p.horizon) u.uHorizon.value.set(p.horizon);
    if (p.ground) u.uGround.value.set(p.ground);
    if (p.sunColor) u.uSunCol.value.set(p.sunColor);
    if (p.cloudColor) u.uCloudCol.value.set(p.cloudColor);
    if (p.cloudDark) u.uCloudDark.value.set(p.cloudDark);
    if (p.sunDir) u.uSunDir.value.copy(p.sunDir).normalize();
    if (p.sunSize !== undefined) u.uSunSize.value = p.sunSize;
    if (p.sunGlow !== undefined) u.uSunGlow.value = p.sunGlow;
    if (p.stars !== undefined) u.uStars.value = p.stars;
    if (p.cloud !== undefined) u.uCloud.value = p.cloud;
    if (p.haze !== undefined) u.uHaze.value = p.haze;
    if (p.cloudSpeed !== undefined) u.uCloudSpeed.value = p.cloudSpeed;
  }

  update(dt, camPos) {
    this.time += dt;
    this.uniforms.uTime.value = this.time;
    if (camPos) this.mesh.position.copy(camPos);
  }
}

/* 太阳位置：t=0 日出（地平线），t=0.5 正午（头顶），t=1 日落 */
export function sunDirection(t, azimuth = 0.55) {
  const ang = clamp(t, 0, 1) * Math.PI;
  const elev = Math.sin(ang) * 0.88;
  const horiz = Math.cos(ang);
  return new THREE.Vector3(
    Math.cos(azimuth) * horiz,
    elev,
    Math.sin(azimuth) * horiz,
  ).normalize();
}
