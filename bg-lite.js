// Animated background: smooth flowing glass waves (single full-screen WebGL shader).
// No libraries, works from file:// by double-click.
(() => {
  const canvas = document.getElementById('bg');
  const gl = canvas.getContext('webgl', { antialias: false, alpha: false, premultipliedAlpha: false, powerPreference: 'high-performance' });
  if (!gl) { canvas.style.background = 'radial-gradient(ellipse at 70% 20%, #1b1f6b, #000 60%)'; return; }

  const qs = new URLSearchParams(location.search);
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const VERT = `attribute vec2 a; void main(){ gl_Position = vec4(a, 0.0, 1.0); }`;

  const FRAG = `
precision highp float;
uniform vec2  uRes;
uniform float uTime;
uniform vec2  uOffset;
uniform float uRot;
uniform float uZoom;

const vec3 DEEP  = vec3(0.10, 0.12, 0.95);   // saturated ultramarine body
const vec3 VIOL  = vec3(0.36, 0.30, 1.00);   // violet
const vec3 LAV   = vec3(0.80, 0.80, 1.00);   // lavender / white highlight
const vec3 WARM  = vec3(1.00, 0.42, 0.16);   // orange edge

float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

// One glass ribbon bent along a circle of radius R around C.
// The ribbon twists along its length (phi): where it faces us it is wide and glowing,
// where it turns edge-on it collapses into a thin bright line - like the reference.
// Returns rgb (premultiplied) in .rgb and coverage in .a ; glow is accumulated separately.
vec4 ribbon(vec2 p, vec2 C, float R, float W, float twK, float twS, float ph,
            float wave, float soft, float bright, vec3 tint, float t, inout vec3 glow) {
  vec2  d  = p - C;
  float r  = length(d);
  vec2  u  = -normalize(C + vec2(1e-4));            // direction towards the screen
  float th = atan(dot(d, vec2(-u.y, u.x)), dot(d, u)); // 0 = facing screen, seam (+-pi) off-screen

  // flowing waves along the ribbon
  float Rw = R + wave * sin(th * 3.0 + t * 0.55 + ph)
               + wave * 0.45 * sin(th * 6.0 - t * 0.8 + ph * 2.3);

  float phi = th * twK + t * twS + ph;
  float c   = cos(phi);
  float ac  = sqrt(c * c + 0.004);                 // smooth |cos| -> no kinks
  float w   = W * (0.07 + 0.93 * ac);          // apparent width from the twist
  float s   = (r - Rw) / w;                          // -1..1 across the ribbon

  // chromatic split: red sits a bit outward, blue inward -> orange / blue fringes
  float ca = min((0.004 + 0.010 * (1.0 - ac)) / w, 0.3); // fringe width in screen units
  vec3 sc = vec3(s - ca, s, s + ca * 0.6);
  vec3 cov = 1.0 - smoothstep(vec3(1.0 - soft), vec3(1.0 + soft), abs(sc));

  // light sliding along the surface as it twists
  float facing = ac;
  float hl  = pow(max(0.0, cos(phi * 1.0 + s * 1.3 - 0.5)), 10.0);
  float hl2 = pow(max(0.0, cos(phi * 1.0 - s * 0.9 + 2.2)), 18.0);
  // sections of the ribbon fade into the black environment
  float env = smoothstep(0.05, 0.95, sin(th * 2.3 + t * 0.35 + ph * 1.9));
  float body = (0.18 + 0.82 * (1.0 - s * s)) * mix(0.35, 1.0, facing);
  float rim  = pow(clamp(abs(s), 0.0, 1.0), 7.0);

  vec3 col = tint * body * (0.06 + 0.9 * env)
           + LAV * hl * env * 1.15
           + VIOL * hl2 * 0.7
           + LAV * rim * 0.55 * env
           + WARM * smoothstep(0.55, 1.0, sc.x) * (1.0 - smoothstep(1.0, 1.0 + soft, sc.x)) * (1.0 - facing) * 0.55;
  col *= bright;

  // soft blue bloom around the ribbon
  float dist = max(abs(r - Rw) - w, 0.0);
  glow += tint * exp(-dist * 16.0) * 0.06 * bright * env;

  float a = max(cov.g, 0.0);
  return vec4(col * cov, a);
}

void main() {
  vec2 p = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
  // per-slide composition (lerped from JS)
  float cr = cos(uRot), sr = sin(uRot);
  p = mat2(cr, -sr, sr, cr) * p;
  p = p / uZoom + uOffset;

  float t = uTime;
  // gentle global breathing so everything feels liquid
  p += 0.012 * vec2(sin(t * 0.4 + p.y * 3.0), cos(t * 0.33 + p.x * 2.5));

  vec3 col  = vec3(0.0);
  vec3 glow = vec3(0.0);
  vec4 b;

  // back -> front. (centre, radius, width, twist k, twist speed, phase, wave, softness, brightness, tint)
  // huge soft dome on the right
  b = ribbon(p, vec2(1.62, 0.10), 1.00, 0.40, 1.0, 0.22, 0.4, 0.03, 0.6, 1.0, mix(DEEP, VIOL, 0.35), t, glow);
  col = col * (1.0 - b.a * 0.75) + b.rgb;
  // thin bright line along the dome
  b = ribbon(p, vec2(1.30, 0.45), 1.02, 0.005, 0.0, 0.0, 0.7, 0.02, 0.9, 0.6, LAV, t, glow);
  col = col * (1.0 - b.a * 0.5) + b.rgb;
  // bottom-left blue streaks
  b = ribbon(p, vec2(0.90, -1.00), 1.60, 0.065, 2.0, 0.5, 2.1, 0.025, 0.7, 1.9, DEEP, t, glow);
  col = col * (1.0 - b.a * 0.6) + b.rgb;
  b = ribbon(p, vec2(0.80, -1.10), 1.72, 0.022, 3.0, -0.4, 4.0, 0.02, 0.8, 1.1, mix(DEEP, LAV, 0.3), t, glow);
  col = col * (1.0 - b.a * 0.5) + b.rgb;
  // fine line crossing the lower half
  b = ribbon(p, vec2(-0.10, 1.25), 1.62, 0.003, 0.0, 0.0, 1.0, 0.015, 0.9, 0.3, mix(VIOL, LAV, 0.5), t, glow);
  col = col * (1.0 - b.a * 0.4) + b.rgb;
  // main wide wave across the top
  b = ribbon(p, vec2(0.00, -1.10), 1.45, 0.13, 1.5, 0.45, 0.0, 0.035, 0.4, 1.25, mix(DEEP, VIOL, 0.25), t, glow);
  col = col * (1.0 - b.a * 0.8) + b.rgb;
  // second, thinner top wave
  b = ribbon(p, vec2(0.20, -1.35), 1.80, 0.04, 2.0, -0.35, 1.7, 0.03, 0.45, 0.95, VIOL, t, glow);
  col = col * (1.0 - b.a * 0.7) + b.rgb;

  col += glow;

  // filmic tone + vignette + grain
  col = 1.0 - exp(-col * 1.2);
  vec2 q = gl_FragCoord.xy / uRes;
  col *= 1.0 - 0.45 * pow(length((q - 0.5) * vec2(1.1, 1.3)), 2.2);
  col += (hash(gl_FragCoord.xy + fract(t) * 91.0) - 0.5) * 0.018;
  gl_FragColor = vec4(max(col, 0.0), 1.0);
}`;

  function compile(type, src) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
    return sh;
  }
  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
  gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  gl.useProgram(prog);

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'a');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

  const U = {};
  ['uRes', 'uTime', 'uOffset', 'uRot', 'uZoom'].forEach((n) => { U[n] = gl.getUniformLocation(prog, n); });

  // ---------- per-slide compositions ----------
  // off: where the camera looks, rot: roll (rad), zoom: >1 = closer
  const PRESETS = {
    hero:    { off: [0.00, 0.00],  rot: 0.00,  zoom: 1.00 },
    section: { off: [0.10, -0.05], rot: -0.18, zoom: 1.12 },
    right:   { off: [-0.30, 0.02], rot: 0.10,  zoom: 1.00 },
    left:    { off: [0.35, 0.05],  rot: -0.10, zoom: 1.05 },
    top:     { off: [0.05, -0.12], rot: 0.06,  zoom: 1.08 },
    bottom:  { off: [0.00, 0.14],  rot: Math.PI, zoom: 1.00 },
    corner:  { off: [-0.20, -0.10], rot: 0.35, zoom: 1.15 },
    wide:    { off: [0.05, 0.00],  rot: -0.05, zoom: 0.80 },
  };
  const cur = { x: 0, y: 0, rot: 0, zoom: 1 };
  const tgt = { x: 0, y: 0, rot: 0, zoom: 1 };
  function setPreset(name, instant = false) {
    const p = PRESETS[name] || PRESETS.hero;
    tgt.x = p.off[0]; tgt.y = p.off[1]; tgt.rot = p.rot; tgt.zoom = p.zoom;
    if (instant) Object.assign(cur, tgt);
  }

  // subtle pointer parallax
  const ptr = { x: 0, y: 0 }, ptrS = { x: 0, y: 0 };
  window.addEventListener('pointermove', (e) => {
    ptr.x = e.clientX / window.innerWidth - 0.5;
    ptr.y = e.clientY / window.innerHeight - 0.5;
  });

  // Internal resolution is capped (the picture is soft anyway) and lowered automatically
  // if the GPU can't hold ~60 fps - smoothness matters more than pixels here.
  let maxW = Number(qs.get('res') || 1280);
  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    const k = Math.min(1, maxW / w);
    canvas.width = Math.round(w * k);
    canvas.height = Math.round(h * k);
    gl.viewport(0, 0, canvas.width, canvas.height);
  }
  window.addEventListener('resize', resize);
  resize();

  const SPEED = Number(qs.get('speed') || 1);
  let t = Number(qs.get('t') || 0);
  let last = performance.now();
  let acc = 0, frames = 0;
  function frame(now) {
    const raw = (now - last) / 1000;
    const dt = Math.min(raw, 0.05);
    last = now;
    // adaptive quality: average frame time over ~1.5 s windows
    if (raw < 0.25 && !document.hidden) {
      acc += raw; frames++;
      if (acc > 1.5) {
        const avg = acc / frames;
        if (avg > 1 / 50 && maxW > 720) { maxW = Math.round(maxW * 0.8); resize(); }
        acc = 0; frames = 0;
      }
    }
    if (!reduceMotion) t += dt * SPEED;

    // critically-damped-ish easing towards the slide's composition (~1.4 s)
    const k = 1 - Math.exp(-dt * 3.2);
    cur.x += (tgt.x - cur.x) * k; cur.y += (tgt.y - cur.y) * k;
    cur.rot += (tgt.rot - cur.rot) * k; cur.zoom += (tgt.zoom - cur.zoom) * k;
    ptrS.x += (ptr.x - ptrS.x) * k * 0.6; ptrS.y += (ptr.y - ptrS.y) * k * 0.6;

    gl.uniform2f(U.uRes, canvas.width, canvas.height);
    gl.uniform1f(U.uTime, t);
    gl.uniform2f(U.uOffset, cur.x + ptrS.x * 0.03, cur.y - ptrS.y * 0.02);
    gl.uniform1f(U.uRot, cur.rot);
    gl.uniform1f(U.uZoom, cur.zoom);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  window.BG = { setPreset, presets: Object.keys(PRESETS) };
})();
