// =====================================================================
//  Liquid-glass background — full WebGL2 pipeline, no libraries.
//
//  1. scene    : ray-marched twisted glass ribbons (SDF), real refraction
//                through the glass, 8-sample spectral dispersion, Fresnel
//                reflections of an animated studio, thin-film iridescence,
//                inner blue body glow, volumetric halo.
//  2. accum    : temporal accumulation -> silky motion blur / smoothing.
//  3. bloom    : 6-level dual-filter bloom pyramid.
//  4. composite: depth of field, chromatic aberration, anamorphic flare,
//                floating bokeh particles, slide-change shockwave ripple,
//                ACES tone mapping, vignette, film grain.
//
//  URL params:  ?q=0.4..1 (fixed render scale)  ?speed=1  ?t=0 (start time)
// =====================================================================
(() => {
  const canvas = document.getElementById('bg');
  const qs = new URLSearchParams(location.search);
  const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, depth: false, stencil: false, powerPreference: 'high-performance', preserveDrawingBuffer: false });
  if (!gl) {
    // very old browser: fall back to the lightweight 2D version
    const s = document.createElement('script'); s.src = 'bg-lite.js'; document.body.appendChild(s); return;
  }
  const hasFloat = !!gl.getExtension('EXT_color_buffer_float');
  gl.getExtension('OES_texture_float_linear');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ------------------------------------------------------------------ shaders
  const VERT = `#version 300 es
in vec2 a; out vec2 vUv;
void main(){ vUv = a * 0.5 + 0.5; gl_Position = vec4(a, 0.0, 1.0); }`;

  const SCENE = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 o;
uniform vec2  uRes;
uniform float uTime;
uniform vec3  uCamPos, uCamTgt;
uniform float uRoll, uFocal;
uniform float uTwist, uWave, uDisp, uHue, uGlow, uSweep, uFocus, uMorph;
uniform vec2  uPtr;
uniform vec2  uJitter;

#define PI 3.14159265

mat2 rot(float a){ float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
float smin(float a, float b, float k){ float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0); return mix(b, a, h) - k * h * (1.0 - h); }

// palette
vec3 deepBlue(){ return mix(vec3(0.06, 0.10, 1.00), vec3(0.30, 0.10, 1.00), uHue); }
vec3 lavender(){ return mix(vec3(0.78, 0.80, 1.00), vec3(0.92, 0.78, 1.00), uHue); }

// ---------------------------------------------------------------- the studio
// Analytic HDR environment the glass reflects / refracts. Lights slowly orbit
// (uSweep) so highlights keep running along the ribbons.
vec3 env(vec3 d){
  vec3 c = vec3(0.002, 0.003, 0.012) * (0.6 + 0.4 * d.y);
  vec3 dd = d; dd.xz = rot(uSweep) * dd.xz;
  // big blue softbox behind-left
  c += deepBlue() * 0.22 * smoothstep(-0.1, 0.9, dd.y) * smoothstep(0.0, 1.0, -dd.z);
  c += deepBlue() * 2.6 * smoothstep(0.84, 0.995, dot(dd, normalize(vec3(-0.6, 0.25, -0.75))));
  // violet softbox behind-right
  c += vec3(0.45, 0.30, 1.9) * 1.4 * smoothstep(0.88, 0.995, dot(dd, normalize(vec3(0.75, 0.35, -0.55))));
  // big soft lavender panel above the camera (for reflections)
  c += lavender() * 1.1 * smoothstep(0.75, 0.99, dot(dd, normalize(vec3(0.1, 0.85, 0.5))));
  // crisp horizontal strip -> long white specular lines
  c += vec3(3.2, 3.2, 4.0) * smoothstep(0.03, 0.0, abs(dd.y - 0.42)) * smoothstep(-0.3, 0.4, -dd.z + 0.2);
  // vertical light bar that sweeps around (the moving highlight)
  float az = atan(dd.x, -dd.z);
  c += vec3(2.6, 2.7, 4.2) * smoothstep(0.07, 0.0, abs(az - 0.9 * sin(uTime * 0.21))) * smoothstep(-0.4, 0.3, dd.y);
  // warm orange / red strip low -> the orange edges from the reference
  c += vec3(3.4, 0.95, 0.22) * smoothstep(0.025, 0.0, abs(dd.y + 0.18)) * smoothstep(0.1, 0.8, dot(normalize(dd.xz + 1e-4), normalize(vec2(-0.8, 0.6))));
  c += vec3(2.2, 0.35, 0.45) * smoothstep(0.03, 0.0, abs(az + 2.2)) * smoothstep(0.0, 0.6, dd.y + 0.2) * 0.6;
  // light that follows the cursor
  vec3 pd = normalize(vec3(uPtr.x * 1.6, -uPtr.y * 1.2 + 0.2, 1.0));
  c += vec3(0.55, 0.6, 2.4) * pow(max(dot(d, pd), 0.0), 40.0) * 2.2;
  return c;
}

// ---------------------------------------------------------------- geometry
// A flat glass band (stadium cross-section) bent around a ring of radius R
// (ring axis = z). It twists k half-turns per loop, the twist travels along it,
// and the ring itself undulates -> flowing waves.
float ribbon(vec3 p, float R, float w, float th, float k, float ph, float wave, float spd){
  float wv = wave * uWave;
  // cheap bound first: skip the expensive part when far away
  vec2 qb = vec2(length(p.xy) - R, p.z);
  float bound = length(qb) - (w + th + wv * 2.2 + 0.08);
  if (bound > 0.35) return bound;
  float a  = atan(p.y, p.x);
  float rr = R + wv * (sin(3.0 * a + uTime * 0.55 + ph) + 0.55 * sin(5.0 * a - uTime * 0.42 + ph * 1.7) + 0.3 * sin(9.0 * a + uTime * 0.8));
  float zz = p.z + wv * 0.9 * sin(2.0 * a + uTime * 0.47 + ph * 2.1);
  vec2 q = vec2(length(p.xy) - rr, zz);
  float tw = a * k * 0.5 + uTime * spd * uTwist + ph + uMorph * 1.3;
  q = rot(tw) * q;
  vec2 d = abs(q) - vec2(w, 0.0);
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - th;
}

float map(vec3 p){
  vec3 q; float d = 1e9;
  float b = 0.08 * sin(uTime * 0.3);                         // global breathing
  p.xy = rot(0.04 * sin(uTime * 0.17)) * p.xy;

  // main wide wave across the top
  q = p - vec3(0.0, -4.3, 0.0); q.yz = rot(0.18 + b) * q.yz;
  d = smin(d, ribbon(q, 5.65, 0.34, 0.07, 3.0, 0.0, 0.16, 0.45), 0.25);
  // second thinner top wave
  q = p - vec3(0.8, -5.3, -0.6); q.yz = rot(0.30 - b) * q.yz;
  d = smin(d, ribbon(q, 7.0, 0.16, 0.045, 4.0, 1.7, 0.14, -0.35), 0.25);
  // big dome on the right, receding in depth
  q = p - vec3(6.4, 0.5, -1.4); q.xz = rot(0.55) * q.xz;
  d = smin(d, ribbon(q, 3.9, 1.10, 0.16, 2.0, 0.4, 0.10, 0.22), 0.35);
  // bright streaks bottom-left
  q = p - vec3(3.5, -3.9, 0.6); q.yz = rot(-0.12) * q.yz;
  d = smin(d, ribbon(q, 6.2, 0.20, 0.05, 4.0, 2.1, 0.10, 0.5), 0.2);
  q = p - vec3(3.1, -4.3, 0.3);
  d = smin(d, ribbon(q, 6.7, 0.07, 0.03, 6.0, 4.0, 0.08, -0.4), 0.15);
  // fine lines
  q = p - vec3(-0.4, 4.9, -0.3);
  d = min(d, ribbon(q, 6.3, 0.0, 0.02, 0.0, 1.0, 0.06, 0.0));
  q = p - vec3(5.1, 1.8, -0.8); q.xz = rot(0.4) * q.xz;
  d = min(d, ribbon(q, 4.05, 0.0, 0.02, 0.0, 0.7, 0.06, 0.0));
  return d;
}

vec3 normalAt(vec3 p){
  const vec2 e = vec2(0.0008, -0.0008);
  return normalize(e.xyy * map(p + e.xyy) + e.yyx * map(p + e.yyx) + e.yxy * map(p + e.yxy) + e.xxx * map(p + e.xxx));
}

vec3 spectral(float x){   // x: 0 = violet ... 1 = red
  return vec3(exp(-pow((x - 0.82) / 0.17, 2.0)), exp(-pow((x - 0.52) / 0.16, 2.0)), exp(-pow((x - 0.16) / 0.17, 2.0)));
}

void main(){
  vec2 uv = (gl_FragCoord.xy + uJitter - 0.5 * uRes) / uRes.y;   // sub-pixel jitter -> temporal anti-aliasing
  uv = rot(uRoll) * uv;
  vec3 ro = uCamPos;
  vec3 fw = normalize(uCamTgt - ro);
  vec3 rt = normalize(cross(fw, vec3(0.0, 1.0, 0.0)));
  vec3 up = cross(rt, fw);
  vec3 rd = normalize(fw * uFocal + uv.x * rt + uv.y * up);

  // ---- primary march with volumetric halo accumulation
  float t = 0.0, halo = 0.0; bool hit = false; vec3 p = ro;
  for (int i = 0; i < 160; i++){
    p = ro + rd * t;
    float d = map(p);
    halo += exp(-max(d, 0.0) * 14.0) * min(d, 0.2);
    if (d < 0.00035 * t){ hit = true; break; }
    t += d * 0.7;
    if (t > 22.0) break;
  }

  vec3 col = deepBlue() * halo * 0.03 * uGlow;
  float depth = 30.0;

  if (hit){
    depth = t;
    vec3 n = normalAt(p);
    float cosi = clamp(dot(-rd, n), 0.0, 1.0);
    float F = 0.04 + 0.96 * pow(1.0 - cosi, 5.0);
    vec3 R = reflect(rd, n);
    vec3 refl = env(R);

    // ---- march through the glass
    vec3 rdi = refract(rd, n, 1.0 / 1.5);
    vec3 pi = p - n * 0.004;
    float ti = 0.02;
    for (int i = 0; i < 56; i++){
      float d = -map(pi + rdi * ti);
      if (d < 0.0008) break;
      ti += max(d * 0.8, 0.004);
      if (ti > 3.5) break;
    }
    vec3 pe = pi + rdi * ti;
    vec3 ne = -normalAt(pe);

    // ---- spectral dispersion on exit (8 wavelengths)
    vec3 trans = vec3(0.0), wsum = vec3(0.0);
    for (int i = 0; i < 16; i++){
      float x = (float(i) + 0.5) / 16.0;
      float ior = 1.5 + (0.5 - x) * 0.11 * uDisp;
      vec3 ro2 = refract(rdi, ne, ior);
      if (dot(ro2, ro2) < 1e-4) ro2 = reflect(rdi, ne);       // total internal reflection
      vec3 w = spectral(x);
      trans += env(ro2) * w; wsum += w;
    }
    trans /= wsum;
    // coloured absorption (Beer) -> deep saturated blue body
    trans *= exp(-ti * vec3(1.7, 1.25, 0.35));
    // glow inside the glass body
    float lit = dot(env(rdi), vec3(0.3, 0.4, 0.3));                 // light reaching the inside
    vec3 body = deepBlue() * (1.0 - exp(-ti * 2.0)) * (0.02 + 0.75 * clamp(lit, 0.0, 2.5)) * (0.4 + 0.6 * smoothstep(-0.3, 0.7, n.y + n.x * 0.4));

    col += mix(trans + body, refl, F);

    // specular highlights from the key lights
    vec3 k1 = normalize(vec3(0.3, 0.9, 0.4));
    col += lavender() * pow(max(dot(R, k1), 0.0), 90.0) * 3.5;
    vec3 k2 = normalize(vec3(-0.7, 0.2, 0.7)); k2.xz = rot(-uSweep) * k2.xz;
    col += vec3(1.0, 0.95, 1.0) * pow(max(dot(R, k2), 0.0), 220.0) * 6.0;

    // thin-film iridescence on grazing edges
    vec3 irid = 0.5 + 0.5 * cos(2.0 * PI * (F * 2.6 + vec3(0.0, 0.33, 0.67) + uTime * 0.03));
    col += irid * pow(1.0 - cosi, 3.0) * 0.35 * (0.3 + dot(refl, vec3(0.3)));
  }

  // circle of confusion for the DOF pass (stored in alpha)
  float coc = clamp(abs(depth - uFocus) / (uFocus * 0.9), 0.0, 1.0);
  o = vec4(col, coc);
}`;

  const ACCUM = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 o;
uniform sampler2D uPrev, uCur; uniform float uBlend;
void main(){ o = mix(texture(uPrev, vUv), texture(uCur, vUv), uBlend); }`;

  const PREFILTER = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 o;
uniform sampler2D uSrc; uniform float uThreshold;
void main(){
  vec3 c = texture(uSrc, vUv).rgb;
  float br = max(c.r, max(c.g, c.b));
  float knee = uThreshold * 0.6;
  float soft = clamp(br - uThreshold + knee, 0.0, 2.0 * knee);
  soft = soft * soft / (4.0 * knee + 1e-4);
  float contrib = max(soft, br - uThreshold) / max(br, 1e-4);
  o = vec4(c * contrib, 1.0);
}`;

  const DOWN = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 o;
uniform sampler2D uSrc; uniform vec2 uTexel;
void main(){
  vec2 h = uTexel * 0.5;
  vec3 s = texture(uSrc, vUv).rgb * 4.0;
  s += texture(uSrc, vUv - h).rgb;
  s += texture(uSrc, vUv + h).rgb;
  s += texture(uSrc, vUv + vec2(h.x, -h.y)).rgb;
  s += texture(uSrc, vUv - vec2(h.x, -h.y)).rgb;
  o = vec4(s / 8.0, 1.0);
}`;

  const UP = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 o;
uniform sampler2D uSrc, uAdd; uniform vec2 uTexel;
void main(){
  vec2 h = uTexel * 0.5;
  vec3 s = texture(uSrc, vUv + vec2(-h.x * 2.0, 0.0)).rgb;
  s += texture(uSrc, vUv + vec2(-h.x, h.y)).rgb * 2.0;
  s += texture(uSrc, vUv + vec2(0.0, h.y * 2.0)).rgb;
  s += texture(uSrc, vUv + vec2(h.x, h.y)).rgb * 2.0;
  s += texture(uSrc, vUv + vec2(h.x * 2.0, 0.0)).rgb;
  s += texture(uSrc, vUv + vec2(h.x, -h.y)).rgb * 2.0;
  s += texture(uSrc, vUv + vec2(0.0, -h.y * 2.0)).rgb;
  s += texture(uSrc, vUv + vec2(-h.x, -h.y)).rgb * 2.0;
  o = vec4(s / 12.0 + texture(uAdd, vUv).rgb, 1.0);
}`;

  const POST = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 o;
uniform sampler2D uScene;
uniform vec2  uRes, uSceneTexel;
uniform float uTime, uPulse, uAberr, uDof, uParticles;
uniform vec2  uPtr;

float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2  hash22(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }

// depth-of-field gather (golden-angle spiral, 32 taps)
vec3 dof(vec2 uv){
  vec4 c0 = texture(uScene, uv);
  float r = c0.a * uDof;
  if (r < 0.5) return c0.rgb;
  vec3 acc = c0.rgb; float wsum = 1.0;
  for (int i = 1; i < 32; i++){
    float fi = float(i);
    float rr = sqrt(fi / 32.0) * r;
    float a = fi * 2.39996;
    vec4 s = texture(uScene, uv + vec2(cos(a), sin(a)) * rr * uSceneTexel);
    float w = smoothstep(0.0, 1.0, s.a * uDof - rr * 0.5 + 0.5);
    acc += s.rgb * w; wsum += w;
  }
  return acc / wsum;
}

// floating out-of-focus particles (3 parallax layers)
vec3 bokeh(vec2 uv){
  vec3 acc = vec3(0.0);
  float asp = uRes.x / uRes.y;
  for (int L = 0; L < 3; L++){
    float fl = float(L);
    float scale = 5.0 + fl * 4.0;
    vec2 p = uv * vec2(asp, 1.0) * scale;
    p += vec2(uPtr.x * (0.6 + fl * 0.5), -uPtr.y * (0.4 + fl * 0.4));
    p.y -= uTime * (0.05 + fl * 0.035) * scale * 0.25;
    p.x += sin(uTime * 0.13 + fl) * 0.3;
    vec2 id = floor(p);
    for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++){
      vec2 cid = id + vec2(i, j);
      float h = hash12(cid + fl * 17.0);
      if (h > 0.09) continue;
      vec2 c = cid + 0.2 + 0.6 * hash22(cid + fl * 31.0);
      c += 0.25 * vec2(sin(uTime * 0.3 + h * 40.0), cos(uTime * 0.25 + h * 60.0));
      float rad = 0.12 + 0.28 * hash12(cid * 1.7 + fl);
      float d = length(p - c);
      float disc = smoothstep(rad, rad * 0.8, d);
      float ring = smoothstep(rad * 0.75, rad * 0.95, d) * disc;
      float tw = 0.55 + 0.45 * sin(uTime * (0.6 + h * 3.0) + h * 80.0);
      vec3 colr = mix(vec3(0.35, 0.42, 1.0), vec3(0.85, 0.75, 1.0), hash12(cid + 7.0));
      acc += colr * (disc * 0.10 + ring * 0.22) * tw * (0.6 - fl * 0.15);
    }
  }
  return acc;
}

void main(){
  vec2 uv = vUv;
  vec2 cen = uv - 0.5;
  float r = length(cen * vec2(uRes.x / uRes.y, 1.0));
  vec2 ab = cen * (uAberr * (0.35 + r * r * 2.5) + uPulse * 0.012);
  vec3 col = dof(uv);
  vec3 base = texture(uScene, uv).rgb;
  col += vec3(texture(uScene, uv + ab).r, base.g, texture(uScene, uv - ab).b) - base;   // fringe
  col = max(col, 0.0) + bokeh(uv) * uParticles;
  o = vec4(col, 1.0);
}`;

  const COMPOSITE = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 o;
uniform sampler2D uScene, uBloom, uFlare;
uniform vec2  uRes;
uniform float uTime, uPulse, uPulseAge, uBloomAmt, uExposure, uAberr;

float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec3 aces(vec3 x){ return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }

void main(){
  vec2 uv = vUv;
  vec2 cen = uv - 0.5;
  float r = length(cen * vec2(uRes.x / uRes.y, 1.0));

  // slide-change shockwave ripple
  float front = uPulseAge * 1.15;
  float ripple = sin((r - front) * 42.0) * exp(-pow((r - front) * 6.0, 2.0)) * uPulse;
  uv += normalize(cen + 1e-5) * ripple * 0.018;

  vec3 col = texture(uScene, uv).rgb;

  vec2 ab = cen * (uAberr * (0.35 + r * r * 2.5) + uPulse * 0.012) * 1.5;
  vec3 bl = vec3(texture(uBloom, uv + ab).r, texture(uBloom, uv).g, texture(uBloom, uv - ab).b);
  col += bl * uBloomAmt * 0.11 * (1.0 + uPulse * 1.4);

  // anamorphic horizontal flare from a mid bloom level
  vec3 fl = vec3(0.0);
  for (int i = -8; i <= 8; i++){
    float fi = float(i);
    fl += texture(uFlare, uv + vec2(fi * 0.022, 0.0)).rgb * exp(-abs(fi) * 0.28);
  }
  col += fl * vec3(0.35, 0.40, 1.0) * 0.012 * uBloomAmt;

  col *= uExposure;
  col = aces(col);
  col = pow(col, vec3(0.97));
  col *= 1.0 - 0.5 * pow(r * 0.85, 2.4);
  col += (hash12(gl_FragCoord.xy + fract(uTime * 7.13) * 400.0) - 0.5) * 0.028;
  o = vec4(max(col, 0.0), 1.0);
}`;

  // ------------------------------------------------------------------ helpers
  function compile(type, src) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src); gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) + '\n' + src.split('\n').slice(0, 3).join('\n'));
    return sh;
  }
  const vs = compile(gl.VERTEX_SHADER, VERT);
  function program(fs) {
    const p = gl.createProgram();
    gl.attachShader(p, vs); gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
    gl.bindAttribLocation(p, 0, 'a');
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const u = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) { const info = gl.getActiveUniform(p, i); u[info.name] = gl.getUniformLocation(p, info.name); }
    return { p, u };
  }
  const P = {
    scene: program(SCENE), accum: program(ACCUM), pre: program(PREFILTER),
    down: program(DOWN), up: program(UP), post: program(POST), comp: program(COMPOSITE),
  };

  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const vbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  function target(w, h) {
    w = Math.max(2, w | 0); h = Math.max(2, h | 0);
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    if (hasFloat) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
    return { tex, fbo, w, h };
  }
  function free(t) { if (t) { gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fbo); } }
  function bindTex(unit, t) { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t.tex); }
  function draw(prog, out) {
    gl.useProgram(prog.p);
    if (out) { gl.bindFramebuffer(gl.FRAMEBUFFER, out.fbo); gl.viewport(0, 0, out.w, out.h); }
    else { gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, canvas.width, canvas.height); }
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  // ------------------------------------------------------------------ targets
  // Quality: by default render at the display's native pixel resolution, up to 4K
  // (3840 px wide), no auto-downscaling.  ?q=0.5 renders lower, ?q=2 supersamples,
  // ?q=auto turns the adaptive (laptop-friendly) mode back on.
  const qParam = qs.get('q');
  const adaptive = qParam === 'auto';
  const MAX_W = Number(qs.get('maxw') || 3840);
  let scale = adaptive ? 0.7 : Math.min(2, Math.max(0.2, Number(qParam || 1)));
  let T = {};
  let LEVELS = 6, FLARE = 3;
  function allocate() {
    Object.values(T).flat().forEach(free);
    const dpr = window.devicePixelRatio || 1;
    // native device pixels, capped to 4K width
    let nw = window.innerWidth * dpr, nh = window.innerHeight * dpr;
    const cap = Math.min(1, MAX_W / nw);
    nw *= cap; nh *= cap;
    canvas.width = Math.round(nw);
    canvas.height = Math.round(nh);
    const maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    const sw = Math.min(maxTex, Math.round(nw * scale)), sh = Math.min(maxTex, Math.round(nh * scale));
    T = { scene: target(sw, sh), acc: [target(sw, sh), target(sw, sh)], post: target(sw, sh), down: [], up: [] };
    // bloom pyramid deep enough that the glow has the same size at any resolution
    LEVELS = 0;
    let w = sw >> 1, h = sh >> 1;
    while (LEVELS < 10 && (LEVELS < 4 || h >= 5)) { T.down.push(target(w, h)); T.up.push(target(w, h)); w = Math.max(2, w >> 1); h = Math.max(2, h >> 1); LEVELS++; }
    // flare taken from the level that is 1/16 of the frame height
    FLARE = Math.min(LEVELS - 1, 3);
  }
  allocate();
  let resizeTimer = 0;
  window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(allocate, 120); });

  // ------------------------------------------------------------------ slides
  // Each slide gets its own camera AND its own look: twist, waves, dispersion,
  // hue, glow, light orbit, depth of field...
  const PRESETS = {
    hero:    { cam: [0.0, 0.25, 6.2],  tgt: [0.0, 0.0, 0.0],  roll: 0.0,   focal: 1.6, twist: 1.0, wave: 1.0, disp: 1.0, hue: 0.0,  glow: 1.0, sweep: 0.0,  focus: 6.0, morph: 0.0, exposure: 0.95, bloom: 0.9 },
    section: { cam: [1.2, -0.8, 5.0],  tgt: [0.6, 0.4, 0.0],  roll: -0.25, focal: 1.4, twist: 1.6, wave: 1.6, disp: 1.6, hue: 0.5,  glow: 1.4, sweep: 1.2,  focus: 4.5, morph: 1.0, exposure: 1.15, bloom: 1.2 },
    right:   { cam: [-2.2, 0.4, 6.4],  tgt: [-1.0, 0.0, 0.0], roll: 0.12,  focal: 1.6, twist: 0.8, wave: 0.9, disp: 1.2, hue: 0.15, glow: 0.9, sweep: -0.8, focus: 6.5, morph: 2.0, exposure: 1.0,  bloom: 0.8 },
    left:    { cam: [2.4, 0.6, 6.6],   tgt: [1.2, 0.2, 0.0],  roll: -0.1,  focal: 1.6, twist: 1.2, wave: 1.1, disp: 1.3, hue: 0.3,  glow: 1.0, sweep: 0.7,  focus: 6.5, morph: 3.0, exposure: 1.0,  bloom: 0.85 },
    top:     { cam: [0.2, -1.2, 6.8],  tgt: [0.0, -0.9, 0.0], roll: 0.05,  focal: 1.7, twist: 1.0, wave: 1.3, disp: 1.0, hue: 0.1,  glow: 1.1, sweep: 2.0,  focus: 7.0, morph: 4.0, exposure: 1.0,  bloom: 0.9 },
    bottom:  { cam: [-0.2, 1.6, 6.6],  tgt: [0.0, 1.0, 0.0],  roll: Math.PI, focal: 1.6, twist: 0.9, wave: 1.0, disp: 1.5, hue: 0.4, glow: 1.0, sweep: -1.6, focus: 6.8, morph: 5.0, exposure: 1.0, bloom: 0.9 },
    corner:  { cam: [-1.8, -1.2, 5.6], tgt: [-1.2, -0.8, 0.0], roll: 0.4,  focal: 1.5, twist: 1.4, wave: 1.4, disp: 2.0, hue: 0.6,  glow: 1.2, sweep: 2.8,  focus: 5.2, morph: 6.0, exposure: 1.05, bloom: 1.0 },
    wide:    { cam: [0.0, 0.3, 9.5],   tgt: [0.5, 0.0, 0.0],  roll: -0.06, focal: 1.5, twist: 1.2, wave: 1.5, disp: 1.2, hue: 0.25, glow: 1.3, sweep: -2.4, focus: 9.0, morph: 7.0, exposure: 1.1,  bloom: 1.1 },
  };
  const KEYS = ['twist', 'wave', 'disp', 'hue', 'glow', 'sweep', 'focus', 'morph', 'exposure', 'bloom', 'roll', 'focal'];
  const cur = { cam: [...PRESETS.hero.cam], tgt: [...PRESETS.hero.tgt] };
  KEYS.forEach((k) => { cur[k] = PRESETS.hero[k]; });
  let goal = PRESETS.hero;
  let pulse = 0, pulseAge = 10;

  function setPreset(name, instant = false) {
    goal = PRESETS[name] || PRESETS.hero;
    if (instant) {
      cur.cam = [...goal.cam]; cur.tgt = [...goal.tgt];
      KEYS.forEach((k) => { cur[k] = goal[k]; });
    } else {
      pulse = 1; pulseAge = 0;           // shockwave + bloom flash + wave surge
    }
  }

  // pointer (smoothed)
  const ptr = [0, 0], ptrS = [0, 0];
  window.addEventListener('pointermove', (e) => {
    ptr[0] = e.clientX / window.innerWidth - 0.5;
    ptr[1] = e.clientY / window.innerHeight - 0.5;
  });

  // ------------------------------------------------------------------ loop
  const SPEED = Number(qs.get('speed') || 1);
  let time = Number(qs.get('t') || 0);
  let last = performance.now();
  let frameAcc = 0, frameCount = 0, ping = 0, warm = 0;

  function renderPasses() {
    // ---- 1. scene
    const S = P.scene; gl.useProgram(S.p);
    gl.uniform2f(S.u.uRes, T.scene.w, T.scene.h);
    gl.uniform1f(S.u.uTime, time);
    gl.uniform3f(S.u.uCamPos, cur.cam[0] + ptrS[0] * 0.5, cur.cam[1] - ptrS[1] * 0.35, cur.cam[2]);
    gl.uniform3f(S.u.uCamTgt, cur.tgt[0], cur.tgt[1], cur.tgt[2]);
    gl.uniform1f(S.u.uRoll, cur.roll);
    gl.uniform1f(S.u.uFocal, cur.focal);
    gl.uniform1f(S.u.uTwist, cur.twist);
    gl.uniform1f(S.u.uWave, cur.wave * (1 + pulse * 1.2));
    gl.uniform1f(S.u.uDisp, cur.disp * (1 + pulse * 1.5));
    gl.uniform1f(S.u.uHue, cur.hue);
    gl.uniform1f(S.u.uGlow, cur.glow * (1 + pulse));
    gl.uniform1f(S.u.uSweep, cur.sweep + time * 0.07);
    gl.uniform1f(S.u.uFocus, cur.focus);
    gl.uniform1f(S.u.uMorph, cur.morph);
    gl.uniform2f(S.u.uPtr, ptrS[0], ptrS[1]);
    gl.uniform2f(S.u.uJitter, Math.random() - 0.5, Math.random() - 0.5);
    draw(S, T.scene);

    // ---- 2. temporal accumulation (silky motion blur)
    const prev = T.acc[ping], out = T.acc[1 - ping];
    gl.useProgram(P.accum.p);
    bindTex(0, prev); bindTex(1, T.scene);
    gl.uniform1i(P.accum.u.uPrev, 0); gl.uniform1i(P.accum.u.uCur, 1);
    gl.uniform1f(P.accum.u.uBlend, warm < 3 ? 1.0 : 0.42);
    draw(P.accum, out);
    ping = 1 - ping; warm++;

    // ---- 3. bloom pyramid
    gl.useProgram(P.pre.p);
    bindTex(0, out); gl.uniform1i(P.pre.u.uSrc, 0); gl.uniform1f(P.pre.u.uThreshold, 0.55);
    draw(P.pre, T.down[0]);
    gl.useProgram(P.down.p); gl.uniform1i(P.down.u.uSrc, 0);
    for (let i = 1; i < LEVELS; i++) {
      bindTex(0, T.down[i - 1]);
      gl.uniform2f(P.down.u.uTexel, 1 / T.down[i - 1].w, 1 / T.down[i - 1].h);
      draw(P.down, T.down[i]);
    }
    gl.useProgram(P.up.p); gl.uniform1i(P.up.u.uSrc, 0); gl.uniform1i(P.up.u.uAdd, 1);
    let src = T.down[LEVELS - 1];
    for (let i = LEVELS - 2; i >= 0; i--) {
      bindTex(0, src); bindTex(1, T.down[i]);
      gl.uniform2f(P.up.u.uTexel, 1 / src.w, 1 / src.h);
      draw(P.up, T.up[i]);
      src = T.up[i];
    }

    // ---- 4. DOF + aberration + particles at scene resolution
    const Q = P.post; gl.useProgram(Q.p);
    bindTex(0, out); gl.uniform1i(Q.u.uScene, 0);
    gl.uniform2f(Q.u.uRes, out.w, out.h);
    gl.uniform2f(Q.u.uSceneTexel, 1 / out.w, 1 / out.h);
    gl.uniform1f(Q.u.uTime, time);
    gl.uniform1f(Q.u.uPulse, pulse);
    gl.uniform1f(Q.u.uAberr, 0.0045);
    gl.uniform1f(Q.u.uDof, out.h / 72);              // same blur size at any resolution
    gl.uniform1f(Q.u.uParticles, 1.0);
    gl.uniform2f(Q.u.uPtr, ptrS[0], ptrS[1]);
    draw(Q, T.post);

    // ---- 5. composite to screen
    const C = P.comp; gl.useProgram(C.p);
    bindTex(0, T.post); bindTex(1, T.up[0]); bindTex(2, T.down[FLARE]);
    gl.uniform1i(C.u.uScene, 0); gl.uniform1i(C.u.uBloom, 1); gl.uniform1i(C.u.uFlare, 2);
    gl.uniform2f(C.u.uRes, canvas.width, canvas.height);
    gl.uniform1f(C.u.uTime, time);
    gl.uniform1f(C.u.uPulse, pulse);
    gl.uniform1f(C.u.uPulseAge, pulseAge);
    gl.uniform1f(C.u.uBloomAmt, cur.bloom * 6 / LEVELS);
    gl.uniform1f(C.u.uExposure, cur.exposure);
    gl.uniform1f(C.u.uAberr, 0.0045);
    draw(C, null);
  }

  function frame(now) {
    const raw = (now - last) / 1000; last = now;
    const dt = Math.min(raw, 0.05);
    if (!reduceMotion) time += dt * SPEED;

    // adaptive render scale: keep it smooth, go as sharp as the GPU allows
    if (adaptive && raw < 0.3 && !document.hidden) {
      frameAcc += raw; frameCount++;
      if (frameAcc > 1.2) {
        const fps = frameCount / frameAcc;
        let next = scale;
        if (fps < 45 && scale > 0.3) next = Math.max(0.3, scale * 0.88);
        else if (fps > 57 && scale < 1.0) next = Math.min(1.0, scale * 1.1);
        if (Math.abs(next - scale) > 0.01) { scale = next; allocate(); }
        frameAcc = 0; frameCount = 0;
      }
    }

    update(dt);
    renderPasses();
    requestAnimationFrame(frame);
  }

  function update(dt) {
    // ease everything towards the slide's look (~1.6 s), pulse decays
    const k = 1 - Math.exp(-dt * 2.6);
    for (let i = 0; i < 3; i++) { cur.cam[i] += (goal.cam[i] - cur.cam[i]) * k; cur.tgt[i] += (goal.tgt[i] - cur.tgt[i]) * k; }
    KEYS.forEach((key) => { cur[key] += (goal[key] - cur[key]) * k; });
    pulse *= Math.exp(-dt * 1.6); pulseAge += dt;
    ptrS[0] += (ptr[0] - ptrS[0]) * (1 - Math.exp(-dt * 3)); ptrS[1] += (ptr[1] - ptrS[1]) * (1 - Math.exp(-dt * 3));
  }
  requestAnimationFrame(frame);

  // bench(n): render n frames synchronously, returns ms per frame (for tuning)
  function bench(n = 20) {
    const px = new Uint8Array(4);
    renderPasses(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const t0 = performance.now();
    for (let i = 0; i < n; i++) { renderPasses(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); }
    return (performance.now() - t0) / n;
  }
  window.BG = { setPreset, bench, step(dt) { time += dt; update(dt); }, presets: Object.keys(PRESETS), get scale() { return scale; }, setScale(v) { scale = v; allocate(); } };
})();
