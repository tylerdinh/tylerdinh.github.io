/*
 * Homepage background: a Unitree G1 humanoid (wearing a nón lá) jogging along a
 * raised earthen path through rice paddies, with limestone karst towers rising
 * out of the mist and coconut palms along the dikes, in the spirit of Ninh Bình.
 *
 * Rendering (all custom shaders):
 *  - linear-light shading: sun + sky/ground ambient, GGX specular on the robot,
 *    light glowing through the rice blades, sky-reflecting paddy water with
 *    ripples and sun glints, and a sun shadow map for the robot;
 *  - aerial perspective: distance haze that warms toward the sun, plus low mist
 *    that pools around the bases of the karst towers;
 *  - painted surfaces: three-tone colour patches broken up by brushstroke noise;
 *  - final pass: the frame is rendered at reduced resolution into a float target,
 *    run through a Kuwahara (oil-paint) filter, then ACES tone-mapped.
 *
 * Loop: nothing ever "ends". The robot runs in place while the world slides past
 * (a treadmill); stride, wind, clouds, mist and camera drift are continuous
 * functions of time. The treadmill speed is measured from the robot's own gait,
 * so the planted foot doesn't skate.
 *
 * Assets: assets/models/g1/ (Unitree G1 URDF + simplified meshes, BSD-3-Clause).
 * Usage (see _layouts/about.liquid): an import map for "three" and "three/addons/", then
 *   <div class="home-scene" data-home-scene></div>
 *   <script type="module" src="/assets/js/three/home-scene.js"></script>
 * Reduced motion: one still frame. No WebGL: the CSS gradient on .home-scene stays.
 */
import * as THREE from "three";
import { STLLoader } from "three/addons/loaders/STLLoader.js";

THREE.ColorManagement.enabled = false; // colours are converted to linear in the shaders

const container = document.querySelector("[data-home-scene]");
const reducedMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const small = Math.min(window.innerWidth, window.innerHeight) < 700;
const MODEL_ROOT = new URL("../../models/g1/", import.meta.url);

const PAINT_SCALE = small ? 0.62 : 0.7; // internal resolution before the paint filter
const KUWAHARA_RADIUS = 3;

// ---------------------------------------------------------------------------
// GLSL building blocks
// ---------------------------------------------------------------------------
const COMMON = /* glsl */ `
  #define PI 3.14159265
  vec3 lin(vec3 c) { return pow(c, vec3(2.2)); }
  float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float a = 0.5, s = 0.0;
    for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = p * 2.03 + vec2(17.1, 9.2); a *= 0.5; }
    return s;
  }
  float strokes(vec2 p, float stretch) {
    vec2 w = vec2(fbm(p * 0.55), fbm(p * 0.55 + 7.3));
    vec2 q = p + (w - 0.5) * 2.6;
    return fbm(vec2(q.x * stretch, q.y));
  }
  // painted albedo: three tones broken into brushy patches
  vec3 paintTones(vec3 dark, vec3 mid, vec3 light, float n, float bias) {
    float t = n + bias;
    vec3 c = mix(dark, mid, smoothstep(0.34, 0.46, t));
    return mix(c, light, smoothstep(0.58, 0.68, t));
  }

  // ---- light & atmosphere (linear units) ----
  uniform vec3 uSunDir, uSunColor, uSkyAmb, uGroundAmb, uZenith, uHorizon, uHaze, uCam;
  uniform float uTime, uOffset;
  vec3 ambient(vec3 n) { return mix(uGroundAmb, uSkyAmb, n.y * 0.5 + 0.5); }
  vec3 skyColor(vec3 dir) {
    float y = dir.y;
    vec3 c = mix(uHorizon, uZenith, smoothstep(-0.03, 0.62, y));
    float s = max(dot(dir, uSunDir), 0.0);
    c += uSunColor * (pow(s, 6.0) * 0.12 + pow(s, 64.0) * 0.5 + smoothstep(0.9993, 0.9997, s) * 8.0);
    return c;
  }
  vec3 atmosphere(vec3 c, vec3 p) {
    vec3 v = p - uCam;
    float d = length(v);
    vec3 dir = v / d;
    float sunAmt = pow(max(dot(dir, uSunDir), 0.0), 6.0);
    vec3 haze = uHaze;
    float f = 1.0 - exp(-d * 0.0009);
    // low mist pooling in the valley, drifting slowly
    float mist = exp(-max(p.y, 0.0) / 9.0) * (1.0 - exp(-max(d - 260.0, 0.0) * 0.005));
    mist *= 0.65 + 0.35 * fbm(vec2(p.x + uOffset, p.z) * 0.012 + vec2(uTime * 0.01, 0.0));
    return mix(c, haze, clamp(f + mist * 0.3, 0.0, 0.88));
  }
  // GGX specular
  float ggx(vec3 n, vec3 v, vec3 l, float rough) {
    vec3 h = normalize(v + l);
    float a = rough * rough, a2 = a * a;
    float nh = max(dot(n, h), 0.0), nv = max(dot(n, v), 1e-3), nl = max(dot(n, l), 0.0);
    float d = a2 / (PI * pow(nh * nh * (a2 - 1.0) + 1.0, 2.0));
    float k = a * 0.5;
    float g = nv / (nv * (1.0 - k) + k) * nl / (nl * (1.0 - k) + k);
    return d * g / max(4.0 * nv * nl, 1e-3);
  }
`;

const SHADOW = /* glsl */ `
  uniform sampler2D uShadowMap; uniform mat4 uShadowMatrix; uniform float uShadowTexel;
  float sunShadow(vec3 p) {
    vec4 s = uShadowMatrix * vec4(p, 1.0);
    vec3 c = s.xyz / s.w * 0.5 + 0.5;
    if (c.x < 0.0 || c.x > 1.0 || c.y < 0.0 || c.y > 1.0 || c.z > 1.0) return 1.0;
    float lit = 0.0;
    for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
      float d = texture2D(uShadowMap, c.xy + vec2(float(i), float(j)) * uShadowTexel * 1.5).r;
      lit += c.z - 0.002 > d ? 0.0 : 1.0;
    }
    return mix(0.35, 1.0, lit / 9.0);
  }
`;

const VERT_WORLD = /* glsl */ `
  varying vec3 vWorld; varying vec3 vNormal; varying vec3 vObj;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz; vObj = position;
    vNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

// Shared uniforms (objects are shared by reference across every material).
const U = {
  uTime: { value: 0 },
  uOffset: { value: 0 },
  uCam: { value: new THREE.Vector3() },
  uSunDir: { value: new THREE.Vector3(-0.55, 0.5, 0.67).normalize() }, // front-left, over the viewer's shoulder
  uSunColor: { value: new THREE.Vector3(3.1, 2.55, 1.85) }, // warm late-afternoon sun
  uSkyAmb: { value: new THREE.Vector3(0.3, 0.38, 0.5) },
  uGroundAmb: { value: new THREE.Vector3(0.16, 0.17, 0.1) },
  uZenith: { value: new THREE.Vector3(0.05, 0.15, 0.56) },
  uHorizon: { value: new THREE.Vector3(0.38, 0.5, 0.64) },
  uHaze: { value: new THREE.Vector3(0.44, 0.51, 0.55) },
  uShadowMap: { value: null },
  uShadowMatrix: { value: new THREE.Matrix4() },
  uShadowTexel: { value: 1 / 1024 },
};

const shaderMat = (opts) => new THREE.ShaderMaterial({ ...opts, uniforms: { ...U, ...(opts.uniforms || {}) } });

// Seeded random numbers (mulberry32), so the scene is laid out the same on every load.
let randState = 20240917;
const rand01 = () => {
  randState = (randState + 0x6d2b79f5) | 0;
  let t = randState;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

// ---------------------------------------------------------------------------
// Small JS value noise (for building geometry)
// ---------------------------------------------------------------------------
const jsHash = (x, y, z) => {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return s - Math.floor(s);
};
const jsNoise3 = (x, y, z) => {
  const xi = Math.floor(x),
    yi = Math.floor(y),
    zi = Math.floor(z);
  const xf = x - xi,
    yf = y - yi,
    zf = z - zi;
  const u = xf * xf * (3 - 2 * xf),
    v = yf * yf * (3 - 2 * yf),
    w = zf * zf * (3 - 2 * zf);
  let r = 0;
  for (let dz = 0; dz < 2; dz++)
    for (let dy = 0; dy < 2; dy++)
      for (let dx = 0; dx < 2; dx++) {
        const h = jsHash(xi + dx, yi + dy, zi + dz);
        r += h * (dx ? u : 1 - u) * (dy ? v : 1 - v) * (dz ? w : 1 - w);
      }
  return r;
};
const jsFbm3 = (x, y, z) => jsNoise3(x, y, z) * 0.55 + jsNoise3(x * 2.1, y * 2.1, z * 2.1) * 0.28 + jsNoise3(x * 4.3, y * 4.3, z * 4.3) * 0.17;

// ---------------------------------------------------------------------------
async function init() {
  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  const isWebGL2 = renderer.capabilities.isWebGL2;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 3000);
  camera.layers.enable(1);

  // Camera rest position, and where the landmark sits: rising in the left part of a
  // typical 16:10 frame, clear of the text column. Computed once; it never moves.
  const camBase = new THREE.Vector3(4.0, 1.75, 5.6);
  const camLook = new THREE.Vector3(-0.9, 0.95, -1.8);
  const LANDMARK_POS = (() => {
    const ref = camera.clone();
    ref.aspect = 1.6;
    ref.filmOffset = -Math.min(1, Math.max(0, (1.6 - 0.9) / 0.9)) * 17;
    ref.position.copy(camBase);
    ref.lookAt(camLook);
    ref.updateProjectionMatrix();
    ref.updateMatrixWorld(true);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(-0.72, -0.1), ref);
    const z = -110;
    const t = (z - ray.ray.origin.z) / ray.ray.direction.z;
    const hit = ray.ray.origin.clone().addScaledVector(ray.ray.direction, t);
    return new THREE.Vector3(hit.x, -2, z);
  })();

  // ---- Sky ---------------------------------------------------------------------
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(2400, 48, 24),
    shaderMat({
      side: THREE.BackSide,
      depthWrite: false,
      vertexShader: `varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        ${COMMON}
        varying vec3 vDir;
        void main() {
          vec3 dir = normalize(vDir);
          vec3 c = skyColor(dir);
          float az = atan(dir.x, dir.z);
          float cl = strokes(vec2(az * 4.0 + uTime * 0.008, dir.y * 11.0), 0.3);
          float band = smoothstep(0.03, 0.14, dir.y) * (1.0 - smoothstep(0.3, 0.55, dir.y));
          float m = smoothstep(0.47, 0.62, cl) * band;
          float sunLit = pow(max(dot(dir, uSunDir), 0.0), 3.0);
          vec3 cloud = mix(vec3(0.62, 0.66, 0.72), vec3(1.05, 0.98, 0.88), smoothstep(0.55, 0.72, cl)) * (0.9 + sunLit * 1.2);
          c = mix(c, cloud, m * 0.8);
          gl_FragColor = vec4(c, 1.0);
        }`,
    })
  );
  scene.add(sky);

  // ---- Mountains (Ninh Bình karst) -----------------------------------------------
  // Every mountain is a terrain mesh: an irregular footprint, cliff walls near the
  // edge (karst), ridged multi-octave noise for sub-peaks, ridges and gullies, and a
  // main summit. Heights are in the same units as R and H.
  const ridgedNoise = (x, z, seed, scale) => {
    let s = 0;
    let a = 0.5;
    let f = 1 / scale;
    for (let o = 0; o < 5; o++) {
      const n = jsNoise3(x * f + seed * 7, o * 13.1, z * f - seed * 3);
      const r = 1 - Math.abs(2 * n - 1);
      s += a * r * r;
      a *= 0.5;
      f *= 2.1;
    }
    return s;
  };
  const mountainHeight = (x, z, m) => {
    const a = Math.atan2(z, x);
    const Rw = m.R * (0.74 + 0.26 * jsNoise3(Math.cos(a) * 1.4 + m.seed, Math.sin(a) * 1.4, 2.0) + 0.08 * Math.sin(a * 3 + m.seed));
    const r = Math.hypot(x, z) / Rw;
    if (r >= 1) return -0.05 * m.H;
    const body = Math.pow(1 - Math.pow(r, 3), 0.5); // steep walls near the edge
    let h = m.H * body * (0.42 + 0.8 * ridgedNoise(x, z, m.seed, m.R * 0.43));
    const ds = Math.hypot(x - m.sx, z - m.sz);
    h += m.H * 0.55 * Math.exp(-(ds * ds) / (2 * (m.R * 0.37) ** 2)) * body; // the main summit
    return h;
  };
  // Shading: vegetation on gentle ground, dark rain-streaked limestone on cliffs,
  // shrubs clinging to ledges, darker gullies. vObj is in metres.
  const MOUNTAIN_FRAG = /* glsl */ `
    ${COMMON}
    varying vec3 vWorld; varying vec3 vNormal; varying vec3 vObj;
    void main() {
      vec3 n = normalize(vNormal);
      float slope = 1.0 - n.y;
      float s = strokes(vObj.xz * 0.12 + vObj.y * 0.05, 0.45);
      float veg = smoothstep(0.6, 0.38, slope + (s - 0.5) * 0.45);
      float streak = strokes(vec2((vObj.x + vObj.z) * 0.22, vObj.y * 0.035), 0.12);
      vec3 rock = paintTones(lin(vec3(0.1, 0.105, 0.1)), lin(vec3(0.22, 0.22, 0.2)), lin(vec3(0.47, 0.46, 0.42)), streak, 0.0);
      vec3 green = paintTones(lin(vec3(0.06, 0.15, 0.07)), lin(vec3(0.15, 0.32, 0.12)), lin(vec3(0.38, 0.56, 0.19)), s, 0.0);
      float clump = smoothstep(0.56, 0.7, strokes(vObj.xz * 0.35 + vObj.y * 0.25 + 3.0, 0.6));
      vec3 alb = mix(rock, green, clamp(veg + clump * 0.55, 0.0, 1.0));
      float ao = 0.7 + 0.3 * smoothstep(0.25, 0.65, fbm(vObj.xz * 0.07 + vObj.y * 0.02));
      float nl = max(dot(n, uSunDir), 0.0);
      vec3 c = alb * (uSunColor * nl * 0.95 + ambient(n)) * ao;
      gl_FragColor = vec4(atmosphere(c, vWorld), 1.0);
    }`;

  // Continuous mountain ranges: one connected massif per range (no isolated peaks).
  // An irregular front edge rises in karst cliffs; inside, domain-warped ridged noise
  // makes ridgelines, saddles and valleys, and steeper towers rise out of the mass.
  const LANDMARK_R = 44;
  const rangeHeight = (x, z, o) => {
    const edge = o.zFront - 22 * jsNoise3(x * 0.008 + o.seed, 0.5, 1.3) - 12 * jsNoise3(x * 0.035, 1.7, o.seed);
    const t = (edge - z) / o.rise;
    if (t <= 0) return -4;
    const lift = Math.pow(Math.min(1, t), 0.45); // steep walls at the front edge
    const wx = x + 45 * (jsNoise3(x * 0.006, z * 0.006, o.seed) - 0.5);
    const wz = z + 45 * (jsNoise3(x * 0.006 + 5.2, z * 0.006, o.seed) - 0.5);
    const ridges = ridgedNoise(wx, wz, o.seed, o.scale);
    const towers = Math.pow(jsNoise3(wx / (o.scale * 0.55), wz / (o.scale * 0.55), o.seed + 3), 2.4);
    return o.amp * (0.22 + 0.6 * ridges * ridges + 0.85 * towers) * lift;
  };
  for (const o of [
    { zFront: -150, zBack: -440, x0: -760, x1: 560, segX: 560, segZ: 130, amp: 62, rise: 38, scale: 52, seed: 4.2 },
    { zFront: -400, zBack: -800, x0: -900, x1: 700, segX: 380, segZ: 100, amp: 100, rise: 55, scale: 80, seed: 9.6 },
  ]) {
    const w = o.x1 - o.x0;
    const d = o.zFront - o.zBack + 40;
    const g = new THREE.PlaneGeometry(w, d, o.segX, o.segZ).rotateX(-Math.PI / 2);
    g.translate((o.x0 + o.x1) / 2, 0, o.zFront + 40 - d / 2);
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      // the landmark stands in front: keep the range low right behind it
      const dl = Math.hypot(x - LANDMARK_POS.x, z - LANDMARK_POS.z);
      const clear = THREE.MathUtils.smoothstep(dl, LANDMARK_R * 0.9, LANDMARK_R * 2.0);
      pos.setY(i, rangeHeight(x, z, o) * (0.35 + 0.65 * clear));
    }
    g.computeVertexNormals();
    const range = new THREE.Mesh(g, shaderMat({ vertexShader: VERT_WORLD, fragmentShader: MOUNTAIN_FRAG }));
    range.position.y = -2;
    scene.add(range);
  }
  // Layered ranges on the horizon, fading into the mist (static).
  for (const [z, base, amp, seed] of [
    [-600, 14, 34, 1.7],
    [-750, 22, 44, 4.1],
    [-920, 30, 52, 7.9],
  ]) {
    const g = new THREE.PlaneGeometry(3600, 1, 900, 1);
    g.translate(0, 0.5, 0);
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      if (pos.getY(i) < 0.5) continue;
      const x = pos.getX(i) * 0.01 + seed * 10;
      // rounded karst humps with notches between them
      const humps =
        Math.pow(Math.abs(Math.sin(x * 1.3)), 0.55) * 0.55 + Math.pow(Math.abs(Math.sin(x * 2.9 + 1.1)), 0.7) * 0.3 + jsFbm3(x * 3, seed, 0) * 0.25;
      pos.setY(i, base + amp * humps);
    }
    g.computeVertexNormals();
    const ridge = new THREE.Mesh(
      g,
      shaderMat({
        vertexShader: VERT_WORLD,
        fragmentShader: /* glsl */ `
          ${COMMON}
          varying vec3 vWorld; varying vec3 vNormal; varying vec3 vObj;
          void main() {
            float s = strokes(vec2(vWorld.x * 0.01, vWorld.y * 0.05), 0.4);
            vec3 alb = paintTones(lin(vec3(0.1, 0.18, 0.13)), lin(vec3(0.18, 0.3, 0.2)), lin(vec3(0.32, 0.44, 0.28)), s, 0.0);
            vec3 c = alb * (uSunColor * 0.35 + ambient(vec3(0.0, 1.0, 0.0)));
            gl_FragColor = vec4(atmosphere(c, vWorld), 1.0);
          }`,
      })
    );
    ridge.position.set(-200, -4, z);
    scene.add(ridge);
  }

  // ---- The landmark: a karst mountain with a stairway up to a pavilion on its summit --
  // A real terrain mesh (not a lathe): ridged multi-octave noise gives sub-peaks,
  // ridges and gullies; a cliff profile near the edge gives karst walls; the summit is
  // levelled into a small plateau for the pavilion.
  const landmark = new THREE.Group();
  const MT = { R: LANDMARK_R, H: 28, sx: -14, sz: 4, plateau: 7.5, seed: 3.3 };
  const rawHeight = (x, z) => mountainHeight(x, z, MT);
  const SUMMIT_H = rawHeight(MT.sx, MT.sz) + 1.5;
  const mtHeight = (x, z) => {
    let h = rawHeight(x, z);
    const ds = Math.hypot(x - MT.sx, z - MT.sz);
    // level a plateau for the pavilion, and keep nearby crags below it
    const flat = 1 - THREE.MathUtils.smoothstep(ds, MT.plateau * 0.55, MT.plateau);
    h = h + (SUMMIT_H - h) * flat;
    if (ds < MT.plateau * 1.4) h = Math.min(h, SUMMIT_H - 0.5 * (1 - flat) * Math.min(1, (ds - MT.plateau * 0.55) / MT.plateau));
    return h;
  };
  {
    const size = MT.R * 2.3;
    const geo = new THREE.PlaneGeometry(size, size, 220, 220).rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) pos.setY(i, mtHeight(pos.getX(i), pos.getZ(i)));
    geo.computeVertexNormals();
    const mountain = new THREE.Mesh(geo, shaderMat({ vertexShader: VERT_WORLD, fragmentShader: MOUNTAIN_FRAG }));
    landmark.add(mountain);

    // Stone stairway switching back up the camera-facing slope to the summit.
    const stairPts = [];
    const N = 240;
    const zStart = MT.sz + MT.R * 0.7;
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const z = zStart + (MT.sz + MT.plateau * 0.8 - zStart) * t;
      const x = MT.sx + 6 + 9 * Math.sin(t * Math.PI * 4.5) * (1 - t * 0.7);
      stairPts.push(new THREE.Vector3(x, Math.max(0.3, mtHeight(x, z)) + 0.45, z));
    }
    const verts = [];
    const tAttr = [];
    const idx = [];
    for (let i = 0; i <= N; i++) {
      const p = stairPts[i];
      const q = stairPts[Math.min(N, i + 1)].clone().sub(stairPts[Math.max(0, i - 1)]);
      q.y = 0;
      q.normalize();
      const side = new THREE.Vector3(-q.z, 0, q.x).multiplyScalar(0.85);
      verts.push(p.x - side.x, p.y, p.z - side.z, p.x + side.x, p.y, p.z + side.z);
      tAttr.push(i / N, i / N);
      if (i < N) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    }
    const stairGeo = new THREE.BufferGeometry();
    stairGeo.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
    stairGeo.setAttribute("aT", new THREE.Float32BufferAttribute(tAttr, 1));
    stairGeo.setIndex(idx);
    const stairs = new THREE.Mesh(
      stairGeo,
      shaderMat({
        side: THREE.DoubleSide,
        vertexShader: /* glsl */ `
          attribute float aT; varying float vT; varying vec3 vWorld;
          void main() { vT = aT; vec4 w = modelMatrix * vec4(position, 1.0); vWorld = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
        fragmentShader: /* glsl */ `
          ${COMMON}
          varying float vT; varying vec3 vWorld;
          void main() {
            float step = smoothstep(0.35, 0.5, abs(fract(vT * 300.0) - 0.5));
            vec3 alb = mix(lin(vec3(0.5, 0.48, 0.44)), lin(vec3(0.3, 0.29, 0.27)), step * 0.7);
            vec3 c = alb * (uSunColor * 0.55 + ambient(vec3(0.0, 1.0, 0.0)));
            gl_FragColor = vec4(atmosphere(c, vWorld), 1.0);
          }`,
      })
    );
    landmark.add(stairs);

    // ---- Water pavilion (thủy đình), after the Tràng An pavilion ----------------------
    // Stone platform in a green pond, a grid of wooden columns, and two tiers of dark
    // tiled roofs whose corners sweep up into curled points, edged with pale trim.
    const litMat = (dark, mid, light, { scale = 2, stripes = 0, side = THREE.FrontSide } = {}) =>
      shaderMat({
        side,
        uniforms: {
          uD: { value: new THREE.Vector3(...dark) },
          uM: { value: new THREE.Vector3(...mid) },
          uL: { value: new THREE.Vector3(...light) },
          uS: { value: scale },
          uStripes: { value: stripes },
        },
        vertexShader: /* glsl */ `
          attribute float aV;
          varying vec3 vWorld; varying vec3 vNormal; varying vec3 vObj; varying float vV;
          void main() {
            vec4 w = modelMatrix * vec4(position, 1.0);
            vWorld = w.xyz; vObj = position; vV = aV;
            vNormal = normalize(mat3(modelMatrix) * normal);
            gl_Position = projectionMatrix * viewMatrix * w;
          }`,
        fragmentShader: /* glsl */ `
          ${COMMON}
          uniform vec3 uD, uM, uL; uniform float uS, uStripes;
          varying vec3 vWorld; varying vec3 vNormal; varying vec3 vObj; varying float vV;
          void main() {
            vec3 n = normalize(vNormal);
            vec3 v = normalize(uCam - vWorld); if (dot(n, v) < 0.0) n = -n;
            float s = strokes(vObj.xz * uS + vObj.y * uS * 0.7, 0.45);
            vec3 alb = paintTones(lin(uD), lin(uM), lin(uL), s, 0.0);
            // tile courses running along the roof
            if (uStripes > 0.0) alb *= 0.78 + 0.22 * smoothstep(0.3, 0.5, abs(fract(vV * uStripes) - 0.5));
            float nl = max(dot(n, uSunDir), 0.0);
            vec3 c = alb * (uSunColor * nl + ambient(n));
            gl_FragColor = vec4(atmosphere(c, vWorld), 1.0);
          }`,
      });
    const matStone = litMat([0.34, 0.34, 0.32], [0.42, 0.42, 0.39], [0.5, 0.5, 0.47], { scale: 1.2 });
    const matWood = litMat([0.2, 0.18, 0.16], [0.27, 0.24, 0.21], [0.33, 0.3, 0.26], { scale: 3 });
    const matTile = litMat([0.18, 0.16, 0.15], [0.23, 0.21, 0.19], [0.29, 0.27, 0.25], { scale: 2, stripes: 16, side: THREE.DoubleSide });
    const matTrim = litMat([0.55, 0.58, 0.6], [0.74, 0.77, 0.79], [0.9, 0.92, 0.93], { scale: 4 });
    const matRail = litMat([0.42, 0.37, 0.31], [0.6, 0.54, 0.46], [0.76, 0.7, 0.6], { scale: 4 });

    // Rounded-rectangle point (superellipse) at angle th, half-size (w, d).
    const rr = (th, w, d) => {
      const c = Math.cos(th),
        s = Math.sin(th);
      return [w * Math.sign(c) * Math.pow(Math.abs(c), 0.22), d * Math.sign(s) * Math.pow(Math.abs(s), 0.22)];
    };
    // Corner weight: 1 at the four corners, 0 along the sides.
    const cornerW = (th) => Math.pow(Math.abs(Math.sin(2 * th)), 3.2);
    // Curved hip roof: eave ring (w, d, yEave) up to an inner ring (iw, id, yTop).
    const roofPoint = (o, th, v) => {
      const c = cornerW(th);
      const [ox, oz] = rr(th, o.w * (1 + o.flare * c), o.d * (1 + o.flare * c));
      const [ix, iz] = rr(th, o.iw, o.id);
      const eaveY = o.yEave + o.upturn * c;
      const y = eaveY + (o.yTop - eaveY) * v - o.sag * Math.sin(Math.PI * v) * (1 - 0.6 * c);
      return new THREE.Vector3(ox + (ix - ox) * v, y, oz + (iz - oz) * v);
    };
    const hipRoof = (o) => {
      const SEG = 192,
        RINGS = 10;
      const pos = [],
        vAttr = [],
        idx = [];
      for (let j = 0; j <= RINGS; j++) {
        const v = j / RINGS;
        for (let i = 0; i < SEG; i++) {
          const p = roofPoint(o, (i / SEG) * Math.PI * 2, v);
          pos.push(p.x, p.y, p.z);
          vAttr.push(v);
        }
      }
      for (let j = 0; j < RINGS; j++)
        for (let i = 0; i < SEG; i++) {
          const a = j * SEG + i,
            b = j * SEG + ((i + 1) % SEG);
          idx.push(a, b, a + SEG, b, b + SEG, a + SEG);
        }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute("aV", new THREE.Float32BufferAttribute(vAttr, 1));
      g.setIndex(idx);
      g.computeVertexNormals();
      return g;
    };
    const tube = (pts, r, closed = false) => new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, closed), closed ? 160 : 24, r, 6, closed);
    // Roof + trim: eave edge, hip ridges and a curled horn at each corner.
    const roofWithTrim = (o) => {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(hipRoof(o), matTile));
      const edge = [];
      for (let i = 0; i < 160; i++) edge.push(roofPoint(o, (i / 160) * Math.PI * 2, 0));
      g.add(new THREE.Mesh(tube(edge, 0.16, true), matTrim));
      for (const th of [Math.PI / 4, (3 * Math.PI) / 4, (5 * Math.PI) / 4, (7 * Math.PI) / 4]) {
        const ridge = [];
        for (let k = 0; k <= 10; k++) ridge.push(roofPoint(o, th, k / 10).add(new THREE.Vector3(0, 0.12, 0)));
        g.add(new THREE.Mesh(tube(ridge, 0.16), matTrim));
        // curled horn rising from the corner tip
        const tip = roofPoint(o, th, 0);
        const out = new THREE.Vector3(Math.cos(th), 0, Math.sin(th)).normalize();
        const curl = [];
        for (let k = 0; k <= 12; k++) {
          const a = (k / 12) * Math.PI * 1.3;
          const r = 0.9 * (1 - k / 16);
          curl.push(
            tip
              .clone()
              .addScaledVector(out, Math.sin(a) * r * 0.7)
              .add(new THREE.Vector3(0, (1 - Math.cos(a)) * r, 0))
          );
        }
        g.add(new THREE.Mesh(tube(curl, 0.13), matTrim));
      }
      return g;
    };

    const pav = new THREE.Group();
    const box = (w, h, d, mat, x, y, z) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(x, y, z);
      pav.add(m);
      return m;
    };
    box(19, 1.4, 13.5, matStone, 0, 0.7, 0); // platform
    box(19.6, 0.35, 14.1, matStone, 0, 1.4, 0); // coping
    for (const x of [-7.2, -3.6, 0, 3.6, 7.2])
      for (const z of [-4.9, -1.65, 1.65, 4.9]) {
        const col = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.36, 5.4, 10), matWood);
        col.position.set(x, 1.55 + 2.7, z);
        pav.add(col);
      }
    box(15.4, 0.5, 10.8, matWood, 0, 7.0, 0); // beams under the first roof
    pav.add(roofWithTrim({ w: 11.2, d: 8.6, iw: 5.4, id: 3.8, yEave: 6.7, yTop: 9.0, upturn: 2.0, flare: 0.12, sag: 0.7 }));
    // upper storey: wooden walls with a pale balustrade band, short posts at the corners
    box(7.6, 2.4, 5.0, matWood, 0, 10.25, 0); // recessed inner wall
    for (const x of [-4.4, -2.2, 0, 2.2, 4.4])
      for (const z of [-3.2, 3.2]) {
        const p2 = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 2.5, 8), matWood);
        p2.position.set(x, 10.3, z);
        pav.add(p2);
      }
    box(10.2, 0.6, 7.4, matRail, 0, 9.55, 0);
    for (const x of [-4.9, 4.9])
      for (const z of [-3.5, 3.5]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 2.8, 8), matWood);
        post.position.set(x, 10.3, z);
        pav.add(post);
      }
    const upper = { w: 8.8, d: 6.4, iw: 3.4, id: 0.16, yEave: 11.2, yTop: 14.6, upturn: 2.2, flare: 0.12, sag: 0.8 };
    pav.add(roofWithTrim(upper));
    // ridge beam with curled ends and a small central ornament
    box(2 * upper.iw + 0.6, 0.45, 0.45, matTrim, 0, upper.yTop + 0.15, 0);
    for (const sx of [-1, 1]) {
      const curl = [];
      for (let k = 0; k <= 12; k++) {
        const a = (k / 12) * Math.PI * 1.4;
        curl.push(new THREE.Vector3(sx * (upper.iw + 0.3 + Math.sin(a) * 0.6), upper.yTop + 0.2 + (1 - Math.cos(a)) * 0.6, 0));
      }
      pav.add(new THREE.Mesh(tube(curl, 0.18), matTrim));
    }
    const ornament = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.12, 6, 18), matTrim);
    ornament.position.set(0, upper.yTop + 1.0, 0);
    pav.add(ornament);

    // stand the pavilion on the levelled summit
    pav.scale.setScalar(0.8);
    pav.position.set(MT.sx, SUMMIT_H - 0.2, MT.sz);
    pav.rotation.y = -0.35;
    landmark.add(pav);

    landmark.position.copy(LANDMARK_POS);
    scene.add(landmark);
  }

  // ---- Ground: paddy water, dikes, the red-earth path ---------------------------------
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(1600, 800, 1, 1).rotateX(-Math.PI / 2).translate(0, 0, -390),
    shaderMat({
      vertexShader: VERT_WORLD,
      fragmentShader: /* glsl */ `
        ${COMMON}
        ${SHADOW}
        varying vec3 vWorld; varying vec3 vNormal; varying vec3 vObj;
        void main() {
          vec2 p = vec2(vWorld.x + uOffset, vWorld.z);
          float s = strokes(p * 0.4, 0.45);
          float s2 = strokes(p * 0.07 + 3.0, 0.5);
          float shadow = sunShadow(vWorld);
          vec3 v = normalize(uCam - vWorld);

          // paddy water: rippled normal, fresnel sky reflection, sun glints, muddy depth
          vec2 rp = p * 1.6 + vec2(uTime * 0.35, uTime * 0.2);
          vec3 wn = normalize(vec3((vnoise(rp) - 0.5) * 0.12, 1.0, (vnoise(rp + 9.1) - 0.5) * 0.12));
          float fres = 0.02 + 0.98 * pow(1.0 - max(dot(wn, v), 0.0), 5.0);
          vec3 refl = skyColor(reflect(-v, wn));
          vec3 mud = lin(vec3(0.24, 0.27, 0.2)) * (ambient(wn) + uSunColor * 0.25 * shadow);
          vec3 water = mix(mud, refl * 0.62, clamp(fres, 0.0, 1.0));
          water += uSunColor * ggx(wn, v, uSunDir, 0.12) * shadow * 0.6;

          // the far field reads as a continuous carpet of young rice
          float far = smoothstep(8.0, 40.0, -vWorld.z);
          vec3 riceAlb = paintTones(lin(vec3(0.14, 0.3, 0.12)), lin(vec3(0.32, 0.55, 0.18)), lin(vec3(0.62, 0.76, 0.28)), s2, 0.0);
          vec3 rice = riceAlb * (uSunColor * 0.55 + ambient(vec3(0.0, 1.0, 0.0))) * shadow;
          vec3 c = mix(water, rice, clamp(far * 1.25 + (s2 - 0.45) * 0.9, 0.0, 1.0));

          // grassy dikes between paddies
          float dx = abs(fract(p.x / 12.0) - 0.5) * 12.0;
          float dz = abs(fract((p.y - 1.1) / 9.0) - 0.5) * 9.0;
          float dike = max(1.0 - smoothstep(0.22, 0.36, dx), 1.0 - smoothstep(0.22, 0.36, dz)) * (1.0 - far * 0.85);
          vec3 dikeAlb = paintTones(lin(vec3(0.22, 0.3, 0.13)), lin(vec3(0.38, 0.47, 0.2)), lin(vec3(0.6, 0.62, 0.32)), s, 0.0);
          c = mix(c, dikeAlb * (uSunColor * 0.7 * shadow + ambient(vec3(0.0, 1.0, 0.0))), dike);

          // the raised path of red-brown Vietnamese earth
          float path = 1.0 - smoothstep(0.6, 0.82, abs(vWorld.z) + (s - 0.5) * 0.35);
          vec3 pathAlb = paintTones(lin(vec3(0.36, 0.22, 0.14)), lin(vec3(0.56, 0.37, 0.24)), lin(vec3(0.76, 0.58, 0.42)), strokes(p * 1.1, 0.3), 0.0);
          c = mix(c, pathAlb * (uSunColor * 0.75 * shadow + ambient(vec3(0.0, 1.0, 0.0))), path);

          gl_FragColor = vec4(atmosphere(c, vWorld), 1.0);
        }`,
    })
  );
  scene.add(ground);

  // ---- Rice: clumps planted in rows; wrap as the world slides past --------------------
  const FIELD_L = 64;
  const FIELD_C = -6;
  {
    const geo = new THREE.InstancedBufferGeometry();
    const segs = 4;
    const verts = [];
    const idx = [];
    for (let i = 0; i <= segs; i++) {
      const y = i / segs;
      const w = 0.5 * (1 - y * 0.9);
      verts.push(-w, y, 0, w, y, 0);
      if (i < segs) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    }
    geo.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
    geo.setIndex(idx);
    const data = [];
    const rand = [];
    const per = small ? 3 : 5;
    for (let z = 4.4; z > (small ? -16 : -24); z -= 0.36) {
      if (Math.abs(z) < 1.0) continue;
      for (let x = -FIELD_L / 2; x < FIELD_L / 2; x += 0.4) {
        const cx = x + (rand01() - 0.5) * 0.1;
        const cz = z + (rand01() - 0.5) * 0.08;
        const h = 0.5 + rand01() * 0.2;
        const lean = rand01() * Math.PI * 2;
        for (let b = 0; b < per; b++) {
          data.push(cx, cz, h * (0.78 + rand01() * 0.36), 0.04 + rand01() * 0.025);
          rand.push(lean + (b / per) * Math.PI * 2 + rand01() * 0.5, rand01());
        }
      }
    }
    geo.setAttribute("iData", new THREE.InstancedBufferAttribute(new Float32Array(data), 4));
    geo.setAttribute("iRand", new THREE.InstancedBufferAttribute(new Float32Array(rand), 2));
    geo.instanceCount = data.length / 4;
    const rice = new THREE.Mesh(
      geo,
      shaderMat({
        side: THREE.DoubleSide,
        uniforms: { uL: { value: FIELD_L }, uC: { value: FIELD_C } },
        vertexShader: /* glsl */ `
          attribute vec4 iData; attribute vec2 iRand;
          uniform float uTime, uOffset, uL, uC;
          varying vec3 vWorld; varying float vY; varying float vR; varying vec2 vField; varying vec3 vN;
          void main() {
            float x = mod(iData.x - uOffset - uC + uL * 0.5, uL) - uL * 0.5 + uC;
            vec3 base = vec3(x, 0.0, iData.y);
            float h = iData.z, y = position.y;
            vec3 dir = vec3(cos(iRand.x), 0.0, sin(iRand.x));
            vec3 side = vec3(-dir.z, 0.0, dir.x);
            vec3 p = base + side * position.x * iData.w + dir * y * y * h * 0.32 + vec3(0.0, y * h, 0.0);
            float gust = sin(uTime * 1.2 - base.x * 0.28 + base.z * 0.16) * 0.5 + 0.5;
            float wind = 0.12 + gust * 0.24 + sin(uTime * 3.0 + iRand.y * 6.28) * 0.05;
            float bend = y * y * h;
            p.x += wind * bend;
            p.z += sin(uTime * 2.1 + base.x * 0.7 + iRand.y * 3.0) * 0.05 * bend;
            p.y -= wind * wind * bend * 0.35;
            float wake = exp(-base.x * base.x * 0.9) * exp(-(abs(base.z) - 1.0) * 2.5);
            p.z += sign(base.z) * wake * 0.3 * bend;
            vWorld = p; vY = y; vR = iRand.y; vField = vec2(x + uOffset, base.z);
            vN = normalize(cross(side, normalize(dir * y * 0.6 + vec3(wind * y * 2.0, 1.0, 0.0))));
            gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
          }`,
        fragmentShader: /* glsl */ `
          ${COMMON}
          ${SHADOW}
          varying vec3 vWorld; varying float vY; varying float vR; varying vec2 vField; varying vec3 vN;
          void main() {
            float s = strokes(vField * 0.2, 0.5);
            vec3 baseC = mix(lin(vec3(0.08, 0.2, 0.08)), lin(vec3(0.16, 0.33, 0.12)), vR);
            vec3 tipC = mix(lin(vec3(0.42, 0.66, 0.2)), lin(vec3(0.78, 0.84, 0.36)), smoothstep(0.42, 0.68, s));
            vec3 alb = mix(baseC, tipC, smoothstep(0.05, 0.95, vY + (s - 0.5) * 0.5));
            vec3 v = normalize(uCam - vWorld);
            vec3 n = normalize(vN); if (dot(n, v) < 0.0) n = -n;
            float shadow = sunShadow(vWorld);
            float diff = max(dot(n, uSunDir), 0.0) * 0.6 + 0.25;
            // light passing through the blade when the sun is behind it
            float trans = pow(max(dot(-v, uSunDir), 0.0), 3.0) * (0.35 + 0.65 * vY);
            float ao = mix(0.35, 1.0, vY);
            vec3 c = alb * (uSunColor * (diff + trans * 1.1) * shadow + ambient(n) * ao);
            c += uSunColor * ggx(n, v, uSunDir, 0.45) * 0.08 * shadow;
            gl_FragColor = vec4(atmosphere(c, vWorld), 1.0);
          }`,
      })
    );
    rice.frustumCulled = false;
    scene.add(rice);
  }

  // ---- Coconut palms along the dikes (instanced, wrap) --------------------------------
  const PALM_PERIOD = 180;
  {
    const parts = []; // [x,y,z, part(0 trunk / 1 frond), t (0..1 along)]
    const tri = [];
    const push = (x, y, z, part, t) => parts.push(x, y, z, part, t) / 5 - 1;
    // trunk: tapered, gently curved
    const ringN = 7;
    const tSegs = 10;
    for (let i = 0; i <= tSegs; i++) {
      const t = i / tSegs;
      const r = 0.22 * (1 - t * 0.45);
      const bx = Math.sin(t * 1.3) * 0.9; // lean
      for (let k = 0; k < ringN; k++) {
        const a = (k / ringN) * Math.PI * 2;
        push(bx + Math.cos(a) * r, t * 9, Math.sin(a) * r, 0, t);
      }
    }
    for (let i = 0; i < tSegs; i++)
      for (let k = 0; k < ringN; k++) {
        const a = i * ringN + k,
          b = i * ringN + ((k + 1) % ringN);
        tri.push(a, a + ringN, b, b, a + ringN, b + ringN);
      }
    // fronds: arching strips with jagged leaflet edges
    const top = [Math.sin(1.3) * 0.9, 9, 0];
    const fronds = 11;
    for (let f = 0; f < fronds; f++) {
      const az = (f / fronds) * Math.PI * 2 + (f % 2) * 0.2;
      const len = 3.4 + (f % 3) * 0.4;
      const droop = 0.55 + (f % 4) * 0.15;
      const segN = 9;
      const startIdx = parts.length / 5;
      for (let i = 0; i <= segN; i++) {
        const t = i / segN;
        const d = len * t;
        const y = Math.sin(t * Math.PI * 0.55) * 1.2 - t * t * droop * 3.2;
        const cx = top[0] + Math.cos(az) * d,
          cz = top[2] + Math.sin(az) * d,
          cy = top[1] + y;
        const w = (0.55 * Math.sin(t * Math.PI) + 0.08) * (i % 2 ? 1 : 0.55); // jagged leaflets
        const sx = -Math.sin(az) * w,
          sz = Math.cos(az) * w;
        push(cx - sx, cy - 0.1 * t, cz - sz, 1, t);
        push(cx + sx, cy - 0.1 * t, cz + sz, 1, t);
      }
      for (let i = 0; i < segN; i++) {
        const a = startIdx + i * 2;
        tri.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    const arr = new Float32Array(parts);
    const geo = new THREE.InstancedBufferGeometry();
    const inter = new THREE.InterleavedBuffer(arr, 5);
    geo.setAttribute("position", new THREE.InterleavedBufferAttribute(inter, 3, 0));
    geo.setAttribute("aPart", new THREE.InterleavedBufferAttribute(inter, 1, 3));
    geo.setAttribute("aT", new THREE.InterleavedBufferAttribute(inter, 1, 4));
    geo.setIndex(tri);
    const inst = [];
    for (let i = 0; i < (small ? 8 : 12); i++) {
      const z = -16 - rand01() * 50;
      const zz = Math.round((z - 1.1) / 9) * 9 + 1.1 + (rand01() - 0.5) * 0.6; // on a dike
      inst.push((rand01() - 0.5) * PALM_PERIOD, zz, 0.6 + rand01() * 0.35, rand01() * Math.PI * 2);
    }
    geo.setAttribute("iPalm", new THREE.InstancedBufferAttribute(new Float32Array(inst), 4));
    geo.instanceCount = inst.length / 4;
    const palms = new THREE.Mesh(
      geo,
      shaderMat({
        side: THREE.DoubleSide,
        uniforms: { uPeriod: { value: PALM_PERIOD } },
        vertexShader: /* glsl */ `
          attribute vec4 iPalm; attribute float aPart, aT;
          uniform float uTime, uOffset, uPeriod;
          varying vec3 vWorld; varying float vPart; varying float vT; varying vec3 vLocal;
          void main() {
            float c = cos(iPalm.w), s = sin(iPalm.w);
            vec3 p = position * iPalm.z;
            // fronds sway in the wind, more toward their tips
            float sway = sin(uTime * 1.1 + iPalm.x * 0.3 + position.x) * 0.25 * aT * aT * aPart;
            p.x += sway; p.y += sway * 0.4;
            p = vec3(c * p.x - s * p.z, p.y, s * p.x + c * p.z);
            float x = mod(iPalm.x - uOffset + uPeriod * 0.5, uPeriod) - uPeriod * 0.5 - 6.0;
            vec3 w = p + vec3(x, 0.0, iPalm.y);
            vWorld = w; vPart = aPart; vT = aT; vLocal = position;
            gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
          }`,
        fragmentShader: /* glsl */ `
          ${COMMON}
          varying vec3 vWorld; varying float vPart; varying float vT; varying vec3 vLocal;
          void main() {
            float s = strokes(vLocal.xz * 2.0 + vLocal.y * 0.7, 0.5);
            vec3 trunk = paintTones(lin(vec3(0.24, 0.2, 0.15)), lin(vec3(0.42, 0.36, 0.27)), lin(vec3(0.6, 0.54, 0.42)), strokes(vec2(vLocal.y * 3.0, vLocal.x * 8.0), 0.4), 0.0);
            vec3 leaf = paintTones(lin(vec3(0.1, 0.22, 0.09)), lin(vec3(0.24, 0.42, 0.14)), lin(vec3(0.55, 0.66, 0.24)), s, (vT - 0.5) * 0.2);
            vec3 alb = mix(trunk, leaf, vPart);
            vec3 v = normalize(uCam - vWorld);
            float trans = pow(max(dot(-v, uSunDir), 0.0), 3.0) * vPart;
            vec3 c = alb * (uSunColor * (0.45 + trans) + ambient(vec3(0.0, 1.0, 0.0)));
            gl_FragColor = vec4(atmosphere(c, vWorld), 1.0);
          }`,
      })
    );
    palms.frustumCulled = false;
    scene.add(palms);
  }

  // ---- Floating motes ------------------------------------------------------------
  {
    const n = small ? 90 : 180;
    const g = new THREE.BufferGeometry();
    const p = new Float32Array(n * 3);
    const r = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      p.set([(rand01() - 0.5) * 40, 0.4 + rand01() * 5, -rand01() * 26 + 3], i * 3);
      r[i] = rand01();
    }
    g.setAttribute("position", new THREE.BufferAttribute(p, 3));
    g.setAttribute("aR", new THREE.BufferAttribute(r, 1));
    const motes = new THREE.Points(
      g,
      shaderMat({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        vertexShader: /* glsl */ `
          attribute float aR; uniform float uTime, uOffset; varying float vA;
          void main() {
            vec3 p = position;
            p.x = mod(p.x - uOffset * 0.6 + uTime * 0.3 + 20.0, 40.0) - 24.0;
            p.y += sin(uTime * 0.5 + aR * 20.0) * 0.35;
            p.z += cos(uTime * 0.4 + aR * 13.0) * 0.3;
            vec4 mv = modelViewMatrix * vec4(p, 1.0);
            gl_PointSize = (3.0 + aR * 6.0) * (8.0 / -mv.z);
            vA = 0.12 + 0.25 * (0.5 + 0.5 * sin(uTime * (0.6 + aR) + aR * 30.0));
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: `varying float vA; void main(){ float d = length(gl_PointCoord - 0.5); gl_FragColor = vec4(vec3(1.6, 1.45, 1.1), vA * smoothstep(0.5, 0.0, d)); }`,
      })
    );
    motes.frustumCulled = false;
    scene.add(motes);
  }

  // ---- The Unitree G1 -----------------------------------------------------------
  const robotMat = (albedo, rough, metal) =>
    shaderMat({
      uniforms: { uAlb: { value: new THREE.Vector3(...albedo) }, uRough: { value: rough }, uMetal: { value: metal } },
      vertexShader: VERT_WORLD,
      fragmentShader: /* glsl */ `
        ${COMMON}
        ${SHADOW}
        uniform vec3 uAlb; uniform float uRough, uMetal;
        varying vec3 vWorld; varying vec3 vNormal; varying vec3 vObj;
        void main() {
          vec3 n = normalize(vNormal);
          vec3 v = normalize(uCam - vWorld);
          float s = strokes(vObj.xz * 30.0 + vObj.y * 20.0, 0.5);
          vec3 alb = lin(uAlb) * (0.9 + (s - 0.5) * 0.25);
          float nl = max(dot(n, uSunDir), 0.0);
          float shadow = sunShadow(vWorld);
          vec3 f0 = mix(vec3(0.04), alb, uMetal);
          float fres = pow(1.0 - max(dot(n, v), 0.0), 5.0);
          vec3 F = f0 + (1.0 - f0) * fres;
          vec3 diff = alb * (1.0 - uMetal) * (uSunColor * nl * shadow + ambient(n));
          vec3 spec = F * uSunColor * ggx(n, v, uSunDir, uRough) * nl * shadow;
          vec3 env = F * skyColor(reflect(-v, n)) * mix(0.18, 0.6, 1.0 - uRough);
          gl_FragColor = vec4(atmosphere(diff + spec + env, vWorld), 1.0);
        }`,
    });
  const matLight = robotMat([0.84, 0.83, 0.8], 0.42, 0.12); // light grey-white shells
  const matDark = robotMat([0.09, 0.09, 0.1], 0.45, 0.1); // dark joints and covers

  const urdfText = await (await fetch(new URL("g1_29dof_rev_1_0.urdf", MODEL_ROOT))).text();
  const urdf = new DOMParser().parseFromString(urdfText, "application/xml");
  const parseVec = (s, d = [0, 0, 0]) => (s ? s.trim().split(/\s+/).map(Number) : d);
  const applyOrigin = (obj, el) => {
    if (!el) return;
    obj.position.fromArray(parseVec(el.getAttribute("xyz")));
    const [r, p, y] = parseVec(el.getAttribute("rpy"));
    obj.rotation.set(r, p, y, "ZYX");
  };
  const stl = new STLLoader();
  const links = new Map();
  const loads = [];
  for (const linkEl of urdf.querySelectorAll("robot > link")) {
    const name = linkEl.getAttribute("name");
    const group = new THREE.Group();
    links.set(name, group);
    for (const vis of linkEl.querySelectorAll(":scope > visual")) {
      const meshEl = vis.querySelector("geometry > mesh");
      if (!meshEl) continue;
      const holder = new THREE.Group();
      applyOrigin(holder, vis.querySelector(":scope > origin"));
      group.add(holder);
      const rgba = parseVec(vis.querySelector("material color")?.getAttribute("rgba"), [0.7, 0.7, 0.7, 1]);
      const mat = rgba[0] < 0.4 ? matDark : matLight;
      loads.push(
        stl.loadAsync(new URL(meshEl.getAttribute("filename"), MODEL_ROOT).href).then((geo) => {
          geo.computeVertexNormals();
          const m = new THREE.Mesh(geo, mat);
          m.layers.set(1);
          m.userData.link = name;
          holder.add(m);
        })
      );
    }
  }
  const joints = new Map();
  const children = new Set();
  for (const jEl of urdf.querySelectorAll("robot > joint")) {
    const type = jEl.getAttribute("type");
    const parent = links.get(jEl.querySelector("parent")?.getAttribute("link"));
    const childName = jEl.querySelector("child")?.getAttribute("link");
    const child = links.get(childName);
    if (!parent || !child || type === "floating") continue;
    children.add(childName);
    const origin = new THREE.Group();
    applyOrigin(origin, jEl.querySelector("origin"));
    const motion = new THREE.Group();
    origin.add(motion);
    motion.add(child);
    parent.add(origin);
    joints.set(jEl.getAttribute("name"), {
      motion,
      axis: new THREE.Vector3(...parseVec(jEl.querySelector("axis")?.getAttribute("xyz"), [1, 0, 0])).normalize(),
    });
  }
  await Promise.all(loads);
  const setJ = (name, v) => {
    const j = joints.get(name);
    if (j) j.motion.quaternion.setFromAxisAngle(j.axis, v);
  };

  const pelvisLink = links.get([...links.keys()].find((n) => !children.has(n) && links.get(n).children.length));
  const robotZUp = new THREE.Group(); // URDF frame: x forward, y left, z up
  robotZUp.add(pelvisLink);
  const robot = new THREE.Group();
  robot.rotation.x = -Math.PI / 2; // to three.js Y-up (facing +x stays +x)
  robot.add(robotZUp);
  scene.add(robot);

  // Nón lá (conical leaf hat) on the head
  {
    const head = links.get("head_link") || links.get("torso_link");
    const box = new THREE.Box3();
    head.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(head.matrixWorld).invert();
    head.traverse((o) => {
      if (o.isMesh) {
        o.geometry.computeBoundingBox();
        box.union(o.geometry.boundingBox.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld)));
      }
    });
    const hatMat = shaderMat({
      side: THREE.DoubleSide,
      vertexShader: VERT_WORLD,
      fragmentShader: /* glsl */ `
        ${COMMON}
        ${SHADOW}
        varying vec3 vWorld; varying vec3 vNormal; varying vec3 vObj;
        void main() {
          vec3 n = normalize(vNormal);
          vec3 v = normalize(uCam - vWorld); if (dot(n, v) < 0.0) n = -n;
          float r = length(vObj.xz);
          float rings = smoothstep(0.35, 0.5, abs(fract(r * 38.0) - 0.5));
          vec3 alb = mix(lin(vec3(0.8, 0.7, 0.48)), lin(vec3(0.62, 0.52, 0.32)), rings * 0.6);
          alb *= 0.92 + (strokes(vObj.xz * 40.0, 0.5) - 0.5) * 0.3;
          float nl = max(dot(n, uSunDir), 0.0);
          float trans = pow(max(dot(-v, uSunDir), 0.0), 2.0) * 0.4;
          vec3 c = alb * (uSunColor * (nl + trans) * sunShadow(vWorld) + ambient(n));
          gl_FragColor = vec4(atmosphere(c, vWorld), 1.0);
        }`,
    });
    const hat = new THREE.Mesh(new THREE.ConeGeometry(0.25, 0.15, 48, 1, true), hatMat);
    hat.rotation.x = Math.PI / 2; // cone axis → link z (up)
    hat.position.set((box.min.x + box.max.x) / 2 - 0.01, (box.min.y + box.max.y) / 2, box.max.z + 0.035);
    hat.layers.set(1);
    head.add(hat);
  }

  // Sole points: the four bottom corners of each foot, used to keep a foot on the ground.
  const soles = ["left_ankle_roll_link", "right_ankle_roll_link"].map((name) => {
    const link = links.get(name);
    const box = new THREE.Box3();
    link.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(link.matrixWorld).invert();
    link.traverse((o) => {
      if (o.isMesh && o.userData.link === name) {
        o.geometry.computeBoundingBox();
        box.union(o.geometry.boundingBox.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld)));
      }
    });
    const z = box.min.z;
    return {
      link,
      pts: [
        [box.min.x, box.min.y],
        [box.max.x, box.min.y],
        [box.min.x, box.max.y],
        [box.max.x, box.max.y],
      ].map(([x, y]) => new THREE.Vector3(x, y, z)),
    };
  });
  const tmp = new THREE.Vector3();
  const footLowest = (sole) => {
    let minY = Infinity;
    let x = 0;
    for (const p of sole.pts) {
      tmp.copy(p).applyMatrix4(sole.link.matrixWorld);
      if (tmp.y < minY) {
        minY = tmp.y;
        x = tmp.x;
      }
    }
    return { y: minY, x };
  };

  // ---- Running gait on the G1's joints ------------------------------------------------
  // A run, not a jog: long stride, high knee tuck on the swing leg, arms pumping at
  // about 90°, a strong forward lean and a real flight phase between steps.
  const STRIDE = 0.56; // seconds per full cycle (two steps)
  const tri = (phi) => (2 / Math.PI) * Math.asin(0.985 * Math.sin(phi)); // even hip speed through stance
  const swing = (phi) => Math.max(0, Math.cos(phi)); // >0 while the leg travels forward
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const setGait = (t) => {
    const phi = (t / STRIDE) * Math.PI * 2;
    const sides = [
      ["left", phi, 1],
      ["right", phi + Math.PI, -1],
    ];
    for (const [s, p, sign] of sides) {
      const hip = -0.62 * tri(p) - 0.32; // negative pitch drives the thigh forward
      const k = 0.5 + 1.75 * Math.pow(swing(p), 0.9); // heel tucks high under the hip in swing
      setJ(`${s}_hip_pitch_joint`, hip);
      setJ(`${s}_hip_roll_joint`, sign * 0.04);
      setJ(`${s}_knee_joint`, k);
      // keep the foot roughly level, pointing the toe at push-off
      setJ(`${s}_ankle_pitch_joint`, clamp(-(hip + k) * 0.8 + 0.25 * Math.sin(p), -0.85, 0.5));
      // arms pump opposite the legs, elbows bent near 90°
      setJ(`${s}_shoulder_pitch_joint`, 0.85 * tri(p) + 0.1);
      setJ(`${s}_shoulder_roll_joint`, sign * 0.1);
      setJ(`${s}_elbow_joint`, 0.05 + 0.22 * Math.sin(p)); // 0 = forearm forward (90° bend) on the G1
    }
    setJ("waist_yaw_joint", 0.22 * tri(phi));
    robotZUp.rotation.set(0, 0.22, 0); // lean into the run
    // put the lower foot on the ground, plus a flight phase where both feet are up
    robot.position.y = 0;
    robot.updateMatrixWorld(true);
    const l = footLowest(soles[0]);
    const r = footLowest(soles[1]);
    const flight = 0.07 * Math.pow(Math.max(0, Math.cos(2 * phi - 0.5)), 2);
    robot.position.y = -Math.min(l.y, r.y) + flight;
    return l.y < r.y ? l.x : r.x;
  };
  // Treadmill speed: how fast the planted foot travels backward, measured over a cycle.
  const GROUND_SPEED = (() => {
    const steps = 240;
    let dist = 0;
    let prev = null;
    let prevSide = null;
    for (let i = 0; i <= steps; i++) {
      const t = (i / steps) * STRIDE;
      setGait(t);
      const l = footLowest(soles[0]);
      const r = footLowest(soles[1]);
      const side = l.y < r.y ? 0 : 1;
      const x = side === 0 ? l.x : r.x;
      if (prev !== null && side === prevSide) dist += prev - x;
      prev = x;
      prevSide = side;
    }
    return Math.max(0.5, dist / STRIDE);
  })();

  // ---- Sun shadow map (robot only) ------------------------------------------------
  const shadowSize = small ? 1024 : 2048;
  const shadowTarget = new THREE.WebGLRenderTarget(shadowSize, shadowSize);
  shadowTarget.depthTexture = new THREE.DepthTexture(shadowSize, shadowSize);
  const sunCam = new THREE.OrthographicCamera(-1.6, 1.6, 1.6, -1.6, 0.1, 30);
  sunCam.layers.set(1);
  sunCam.position
    .copy(U.uSunDir.value)
    .multiplyScalar(12)
    .add(new THREE.Vector3(0, 0.7, 0));
  sunCam.lookAt(0, 0.7, 0);
  sunCam.updateMatrixWorld(true);
  const depthOnly = new THREE.MeshBasicMaterial({ colorWrite: false });
  U.uShadowMap.value = shadowTarget.depthTexture;
  U.uShadowTexel.value = 1 / shadowSize;
  U.uShadowMatrix.value.multiplyMatrices(sunCam.projectionMatrix, sunCam.matrixWorldInverse);

  // ---- Paint pass: float render → Kuwahara → ACES → screen ----------------------------
  const target = new THREE.WebGLRenderTarget(4, 4, {
    type: THREE.HalfFloatType,
    samples: isWebGL2 ? 4 : 0,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
  });
  const paint = new THREE.ShaderMaterial({
    depthTest: false,
    depthWrite: false,
    uniforms: { tScene: { value: target.texture }, uTexel: { value: new THREE.Vector2() } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D tScene; uniform vec2 uTexel; varying vec2 vUv;
      #define R ${KUWAHARA_RADIUS}
      float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
      vec3 aces(vec3 x) { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
      void main() {
        vec3 m0 = vec3(0.0), m1 = vec3(0.0), m2 = vec3(0.0), m3 = vec3(0.0);
        vec3 q0 = vec3(0.0), q1 = vec3(0.0), q2 = vec3(0.0), q3 = vec3(0.0);
        for (int j = -R; j <= R; j++) {
          for (int i = -R; i <= R; i++) {
            vec3 c = texture2D(tScene, vUv + vec2(float(i), float(j)) * uTexel).rgb;
            c = c / (1.0 + c); // compress highlights so a sun glint can't dominate a quadrant
            vec3 c2 = c * c;
            if (i <= 0 && j <= 0) { m0 += c; q0 += c2; }
            if (i >= 0 && j <= 0) { m1 += c; q1 += c2; }
            if (i <= 0 && j >= 0) { m2 += c; q2 += c2; }
            if (i >= 0 && j >= 0) { m3 += c; q3 += c2; }
          }
        }
        float n = float((R + 1) * (R + 1));
        m0 /= n; m1 /= n; m2 /= n; m3 /= n;
        vec3 v0 = abs(q0 / n - m0 * m0), v1 = abs(q1 / n - m1 * m1), v2 = abs(q2 / n - m2 * m2), v3 = abs(q3 / n - m3 * m3);
        float s0 = v0.r + v0.g + v0.b, s1 = v1.r + v1.g + v1.b, s2 = v2.r + v2.g + v2.b, s3 = v3.r + v3.g + v3.b;
        vec3 col = m0; float best = s0;
        if (s1 < best) { best = s1; col = m1; }
        if (s2 < best) { best = s2; col = m2; }
        if (s3 < best) { best = s3; col = m3; }
        col = col / max(1.0 - col, 1e-3); // undo the compression
        col = aces(col * 0.82);
        col = pow(col, vec3(1.0 / 2.2));
        float l = dot(col, vec3(0.299, 0.587, 0.114));
        col = mix(vec3(l), col, 1.08);
        col += (hash(gl_FragCoord.xy) - 0.5) * 0.02; // faint canvas grain
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const post = new THREE.Scene();
  post.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), paint));
  const postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  // ---- Framing ------------------------------------------------------------------
  const frame = () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h, false);
    target.setSize(Math.max(2, Math.round(w * PAINT_SCALE)), Math.max(2, Math.round(h * PAINT_SCALE)));
    paint.uniforms.uTexel.value.set(1 / target.width, 1 / target.height);
    camera.aspect = w / h;
    // wide screens: shift the image so the robot lands in the right third, clear of the text
    const wide = Math.min(1, Math.max(0, (camera.aspect - 0.9) / 0.9));
    camera.filmOffset = -wide * 17;
    camera.updateProjectionMatrix();
  };
  frame();
  window.addEventListener("resize", frame);

  const render = (t) => {
    U.uTime.value = t;
    U.uOffset.value = t * GROUND_SPEED;
    setGait(t);
    camera.position.set(camBase.x + Math.sin(t * 0.21) * 0.2, camBase.y + Math.sin(t * 0.37) * 0.04, camBase.z + Math.sin(t * 0.17) * 0.16);
    camera.lookAt(camLook);
    U.uCam.value.copy(camera.position);
    sky.position.copy(camera.position);

    renderer.setRenderTarget(shadowTarget);
    renderer.setClearColor(0xffffff, 1);
    renderer.clear();
    scene.overrideMaterial = depthOnly; // the robot's own shader reads this map, so don't use it here
    renderer.render(scene, sunCam);
    scene.overrideMaterial = null;
    renderer.setRenderTarget(target);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    renderer.render(post, postCam);
  };

  container.appendChild(renderer.domElement);
  container.classList.add("is-live");

  if (reducedMotion) {
    render(2.3);
    window.addEventListener("resize", () => render(2.3));
    return;
  }
  let start = null;
  let paused = 0;
  let hiddenAt = null;
  const loop = (now) => {
    if (start === null) start = now;
    render((now - start - paused) / 1000);
    requestAnimationFrame(loop);
  };
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) hiddenAt = performance.now();
    else if (hiddenAt !== null) {
      paused += performance.now() - hiddenAt;
      hiddenAt = null;
    }
  });
  requestAnimationFrame(loop);
}

if (container) {
  try {
    const probe = document.createElement("canvas");
    if (probe.getContext("webgl2") || probe.getContext("webgl")) {
      init().catch((e) => console.warn("Home scene could not start:", e));
    }
  } catch (e) {
    console.warn("Home scene could not start:", e);
  }
}
