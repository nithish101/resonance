// WGSL for the WebGPU backend (RD-2). One uniform block is shared by every pipeline; its layout is
// mirrored by `writeUniforms` in backend.ts (400 bytes).

export const UNIFORMS = /* wgsl */ `
struct U {
  res: vec2f, time: f32, travel: f32,
  bass: f32, mid: f32, treble: f32, loud: f32,
  pulse: f32, flash: f32, centroid: f32, intensity: f32,
  grain: f32, seed: f32, shockAge: f32, shockOn: f32,
  dt: f32, count: f32, pointScale: f32, aspect: f32,
  pa: vec4f, pb: vec4f, pc: vec4f, pd: vec4f,
  mel: array<vec4f, 16>,
}
@group(0) @binding(0) var<uniform> u: U;

fn palette(t: f32) -> vec3f {
  return u.pa.xyz + u.pb.xyz * cos(6.2831853 * (u.pc.xyz * t + u.pd.xyz));
}

fn hashu(v: u32) -> u32 {
  var x = v;
  x ^= x >> 16u; x *= 0x7feb352du;
  x ^= x >> 15u; x *= 0x846ca68bu;
  x ^= x >> 16u;
  return x;
}
fn h01(v: u32) -> f32 { return f32(hashu(v)) * (1.0 / 4294967295.0); }

struct VOut { @builtin(position) pos: vec4f, @location(0) uv: vec2f }

// Fullscreen triangle.
@vertex fn fullscreen(@builtin(vertex_index) i: u32) -> VOut {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  var o: VOut;
  o.pos = vec4f(p * 2.0 - 1.0, 0.0, 1.0);
  o.uv = p;
  return o;
}
`;

/** Spectral Tunnel, a line-for-line port of the GLSL version in modes/tunnel.glsl.ts. */
export const TUNNEL_WGSL = /* wgsl */ `
${UNIFORMS}

fn melAt(x: f32) -> f32 {
  let f = clamp(x, 0.0, 1.0) * 63.0;
  let i = u32(floor(f));
  let j = min(i + 1u, 63u);
  let a = u.mel[i / 4u][i % 4u];
  let b = u.mel[j / 4u][j % 4u];
  return mix(a, b, fract(f));
}

fn hash2(p: vec2f) -> f32 {
  return fract(sin(dot(p, vec2f(127.1, 311.7)) + u.seed * 17.0) * 43758.5453);
}

@fragment fn tunnel(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let PI = 3.14159265;
  // WebGPU's framebuffer origin is top-left; flip to match the GLSL version.
  let frag = vec2f(fc.x, u.res.y - fc.y);
  var p = (frag - 0.5 * u.res) / u.res.y;
  let k = u.intensity;
  p += 0.035 * k * vec2f(sin(u.time * 0.21), cos(u.time * 0.17));

  let r = length(p);
  let th = atan2(p.x, -p.y);
  let uu = abs(th) / PI;
  let m = melAt(uu);

  let rr = r * (1.0 + (0.6 * m + 0.25 * u.bass) * k);
  let z = 0.32 / max(rr, 1e-3);
  let zz = z + u.travel;

  let rf = fract(zz * 1.6);
  let ring = smoothstep(0.0, 0.03, rf) * (1.0 - smoothstep(0.03, 0.22, rf));

  let ribCoord = th / PI * 12.0 + 0.15 * zz;
  let rib = abs(fract(ribCoord) - 0.5);
  let ribW = fwidth(ribCoord) * 1.2;
  let ribs = smoothstep(0.5 - ribW, 0.5, rib);

  let fog = exp(-z * 0.5);
  let near = mix(0.12, 1.0, smoothstep(0.15, 0.9, z));
  let energy = 0.35 + 1.6 * m;
  let wall = (ring * energy + ribs * (0.18 + 0.7 * m)) * fog * near;

  var col = palette(0.62 * uu + 0.04 * zz + 0.3 * u.centroid) * wall;
  let core = exp(-r * r * (22.0 - 10.0 * u.loud));
  col += palette(0.08 + 0.25 * u.centroid) * core * (0.06 + 0.7 * u.bass * k);
  col *= 1.0 + 0.8 * u.pulse * k * ring;
  col *= 1.0 + 0.6 * u.flash;
  col *= 1.0 - smoothstep(0.25, 1.3, r);
  col = 1.0 - exp(-col * 1.5);
  col = pow(col, vec3f(0.92));
  col += u.grain * (hash2(frag + floor(u.time * 60.0)) - 0.5) * 0.03;
  return vec4f(clamp(col, vec3f(0.0), vec3f(1.0)), 1.0);
}

@fragment fn calibrate(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let p = vec2f(fc.x, u.res.y - fc.y) / u.res;
  let marker = step(p.x, 0.02) * step(p.y, 0.02) * 0.3;
  return vec4f(vec3f(max(u.flash, marker)), 1.0);
}
`;

/**
 * Particle Nebula as a GPU simulation. Each particle keeps position and velocity in a storage
 * buffer. Every frame its velocity relaxes toward a goal field made of:
 * - orbital motion, faster near the core, so the spiral arms wind;
 * - a divergence-free swirl (curl of a stream function), stronger with the mids;
 * - a spring back toward the particle's home radius, which keeps the galaxy's shape;
 * - a radial push from the bass, and an outward kick from the onset shockwave ring.
 * Treble drives a per-particle shimmer at draw time.
 */
export const NEBULA_SIM_WGSL = /* wgsl */ `
${UNIFORMS}
struct Particle { pos: vec4f, vel: vec4f }  // pos.w = orbit radius, vel.w = orbit phase
@group(0) @binding(1) var<storage, read_write> parts: array<Particle>;

fn swirl(p: vec2f, t: f32) -> vec2f {
  let a = 1.7 * p.x + 0.31 * t;
  let b = 1.3 * p.y - 0.23 * t;
  let c = 3.1 * p.x - 2.3 * p.y + 0.7 * t;
  let dpsidx = 1.7 * cos(a) * cos(b) + 0.5 * 3.1 * cos(c);
  let dpsidy = -1.3 * sin(a) * sin(b) - 0.5 * 2.3 * cos(c);
  return vec2f(dpsidy, -dpsidx);
}

fn spawn(i: u32) -> Particle {
  let r1 = h01(i * 3u + 1u);
  let r2 = h01(i * 3u + 2u);
  let r3 = h01(i * 3u + 3u);
  let arm = floor(r3 * 3.0);
  let r = pow(r1, 0.7) * 1.1;
  let theta0 = arm * 2.0943951 + r * 2.6 + (r2 - 0.5) * (0.35 + 0.6 * r);
  let z = (h01(i ^ 0x9e3779b9u) - 0.5) * 0.08 * (1.0 - r);
  var p: Particle;
  p.pos = vec4f(r * cos(theta0), r * sin(theta0), z, r);
  p.vel = vec4f(0.0, 0.0, 0.0, theta0);  // vel.w: orbit phase at spawn
  return p;
}

// Where the particle "wants" to be: its orbit in the same spiral the WebGL2 version draws
// statelessly, plus the mid-driven swirl displacement.
fn home(p: Particle) -> vec3f {
  let r = p.pos.w;
  let theta = p.vel.w + u.travel * (0.25 + 0.35 / (0.25 + r));
  var h = vec2f(r * cos(theta), r * sin(theta));
  h += swirl(h * 1.4, u.travel * 0.8) * (0.025 + 0.06 * u.mid * u.intensity);
  return vec3f(h, 0.0);
}

@compute @workgroup_size(256) fn simulate(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (f32(i) >= u.count) { return; }
  var p = parts[i];
  if (p.pos.w <= 0.0) { p = spawn(i); }
  let k = u.intensity;
  let xy = p.pos.xy;
  let r = max(length(xy), 1e-4);
  let radial = xy / r;

  // A damped spring toward the particle's orbit keeps the galaxy's shape; audio forces push
  // it off that orbit and it springs back, so impulses read as physical motion.
  let h = home(p);
  var accel = (h.xy - xy) * 60.0 - p.vel.xy * 9.0;
  // Bass: a radial push that grows toward the core.
  accel += radial * u.bass * k * 9.0 * (1.0 - 0.5 * r);
  // Onset shockwave: an expanding ring kicks particles outward as it passes.
  let d = r - u.shockAge * 1.6;
  let wave = exp(-d * d * 90.0) * max(0.0, 1.0 - u.shockAge / 0.9) * u.shockOn;
  accel += radial * wave * 40.0 * k;
  // Treble adds a little turbulence, different for every particle and frame.
  let frame = u32(u.time * 60.0);
  let n = vec2f(h01(i ^ (frame * 747796405u)), h01((i * 7u) ^ frame)) - 0.5;
  accel += n * u.treble * k * 6.0;

  let dt = min(u.dt, 1.0 / 30.0);
  let vxy = p.vel.xy + accel * dt;
  // Heights stay where they spawned; motion is in the disk plane.
  p.pos = vec4f(xy + vxy * dt, p.pos.z, p.pos.w);
  p.vel = vec4f(vxy, p.vel.z, p.vel.w);
  parts[i] = p;
}
`;

/** Draws each particle as an instanced quad, read-only from the simulation buffer. */
export const NEBULA_DRAW_WGSL = /* wgsl */ `
${UNIFORMS}
struct Particle { pos: vec4f, vel: vec4f }  // pos.w = orbit radius, vel.w = orbit phase
@group(0) @binding(1) var<storage, read> parts: array<Particle>;

struct POut {
  @builtin(position) pos: vec4f,
  @location(0) q: vec2f,
  @location(1) color: vec3f,
  @location(2) alpha: f32,
}

@vertex fn particleVs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> POut {
  let part = parts[ii];
  var p = part.pos.xyz;
  let home = part.pos.w;
  let yaw = 0.07 * u.time;
  p = vec3f(cos(yaw) * p.x - sin(yaw) * p.y, sin(yaw) * p.x + cos(yaw) * p.y, p.z);
  let tilt = 1.05;
  p = vec3f(p.x, p.y * cos(tilt) - p.z * sin(tilt), p.y * sin(tilt) + p.z * cos(tilt));
  let depth = 2.4 + p.z;
  let center = p.xy / depth * 2.1;

  let corners = array<vec2f, 6>(vec2f(-1, -1), vec2f(1, -1), vec2f(-1, 1), vec2f(-1, 1), vec2f(1, -1), vec2f(1, 1));
  let c = corners[vi];
  let sizePx = u.pointScale * (1.2 + 1.8 * (1.0 - home)) * (2.4 / depth);
  let off = c * sizePx / u.res;  // half-size in NDC is size/res
  var o: POut;
  o.pos = vec4f(center.x / u.aspect + off.x, center.y + off.y, 0.0, 1.0);
  o.q = c * 0.5;

  let shimmer = h01(ii ^ (u32(u.time * 24.0) * 2654435761u)) - 0.5;
  let r = length(part.pos.xy);
  let dd = r - u.shockAge * 1.6;
  let wave = exp(-dd * dd * 90.0) * max(0.0, 1.0 - u.shockAge / 0.9) * u.shockOn;
  var bright = (0.35 + 0.65 * (1.0 - home)) * (0.55 + 0.6 * u.loud) * (1.0 + shimmer * u.treble * 1.6 * u.intensity);
  bright *= 1.0 + wave * 2.5;
  o.alpha = clamp(bright, 0.0, 2.0);
  o.color = palette(0.55 * home + 0.3 * u.centroid + 0.12 * h01(ii * 3u + 2u));
  return o;
}

@fragment fn particleFs(in: POut) -> @location(0) vec4f {
  // Additive blending accumulates light; the count-dependent gain keeps total exposure similar
  // whether 100k or 1M particles are drawn.
  let a = exp(-dot(in.q, in.q) * 18.0) * in.alpha * 0.16 * (150000.0 / max(u.count, 1.0));
  return vec4f(in.color * a, 1.0);
}

`;

/** Backdrop + accumulated particle light, tone-mapped to the canvas. */
export const NEBULA_COMPOSITE_WGSL = /* wgsl */ `
${UNIFORMS}
@group(0) @binding(1) var hdr: texture_2d<f32>;

@fragment fn composite(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let frag = vec2f(fc.x, u.res.y - fc.y);
  let p = (frag - 0.5 * u.res) / u.res.y;
  let core = exp(-dot(p, p) * 9.0);
  var c = palette(0.1 + 0.3 * u.centroid) * core * (0.05 + 0.18 * u.bass * u.intensity);
  c += textureLoad(hdr, vec2i(fc.xy), 0).rgb;
  c *= 1.0 + 0.6 * u.flash;
  c = 1.0 - exp(-c * 1.6);
  return vec4f(c, 1.0);
}
`;
