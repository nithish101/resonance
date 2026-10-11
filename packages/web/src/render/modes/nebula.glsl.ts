// Particle Nebula for WebGL2 (RD-5, reduced count). A spiral galaxy of particles whose positions
// are computed statelessly in the vertex shader from the particle index and audio-integrated time.
// No buffers, no CPU work per particle, and deterministic for capture mode. The WebGPU backend
// runs the same look as a real compute-shader simulation with up to 500k+ particles.
//
// Audio mapping (PRD RD-5): bass = radial impulse, treble = shimmer, onset = shockwave ring,
// mids = swirl strength, centroid = palette position.

export const NEBULA_VS = `#version 300 es
precision highp float;
precision highp int;

uniform float uTime;
uniform float uTravel;
uniform float uBass;
uniform float uMid;
uniform float uTreble;
uniform float uLoud;
uniform float uShockAge;
uniform float uShockOn;
uniform float uIntensity;
uniform float uAspect;
uniform float uPointScale;
uniform float uCentroid;
uniform float uZoom;
uniform float uRoll;
uniform vec3 uPa;
uniform vec3 uPb;
uniform vec3 uPc;
uniform vec3 uPd;

out vec3 vColor;
out float vAlpha;

uint hash(uint x) {
  x ^= x >> 16; x *= 0x7feb352du;
  x ^= x >> 15; x *= 0x846ca68bu;
  x ^= x >> 16;
  return x;
}
float h01(uint x) { return float(hash(x)) * (1.0 / 4294967295.0); }

vec3 palette(float t) { return uPa + uPb * cos(6.2831853 * (uPc * t + uPd)); }

// Divergence-free swirl from a stream function psi: v = (dpsi/dy, -dpsi/dx).
vec2 swirl(vec2 p, float t) {
  float a = 1.7 * p.x + 0.31 * t;
  float b = 1.3 * p.y - 0.23 * t;
  float c = 3.1 * p.x - 2.3 * p.y + 0.7 * t;
  float dpsidx = 1.7 * cos(a) * cos(b) + 0.5 * 3.1 * cos(c);
  float dpsidy = -1.3 * sin(a) * sin(b) - 0.5 * 2.3 * cos(c);
  return vec2(dpsidy, -dpsidx);
}

void main() {
  uint id = uint(gl_VertexID);
  float r1 = h01(id * 3u + 1u);
  float r2 = h01(id * 3u + 2u);
  float r3 = h01(id * 3u + 3u);
  float k = uIntensity;

  // Three spiral arms with a dense core.
  float arm = floor(r3 * 3.0);
  float r = pow(r1, 0.7) * 1.1;
  float theta = arm * 2.0943951 + r * 2.6 + (r2 - 0.5) * (0.35 + 0.6 * r);
  // Differential rotation: inner orbits faster, so the arms wind as the music travels.
  theta += uTravel * (0.25 + 0.35 / (0.25 + r));
  vec3 p = vec3(r * cos(theta), r * sin(theta), (h01(id ^ 0x9e3779b9u) - 0.5) * 0.08 * (1.0 - r));

  p.xy += swirl(p.xy * 1.4, uTravel * 0.8) * (0.025 + 0.06 * uMid * k);
  // Bass breathes the galaxy outward from the core.
  p.xy *= 1.0 + 0.22 * uBass * k * (1.0 - 0.5 * r);
  // Onset shockwave: a ring expanding from the centre pushes particles as it passes.
  float ringR = uShockAge * 1.6;
  float d = length(p.xy) - ringR;
  float wave = exp(-d * d * 90.0) * max(0.0, 1.0 - uShockAge / 0.9) * uShockOn;
  p.xy += normalize(p.xy + 1e-5) * wave * 0.09 * k;

  // Camera: tilt the disk toward the viewer and yaw slowly.
  float yaw = 0.07 * uTime + uRoll * 2.0;
  p.xy = mat2(cos(yaw), -sin(yaw), sin(yaw), cos(yaw)) * p.xy;
  float tilt = 1.05;
  p = vec3(p.x, p.y * cos(tilt) - p.z * sin(tilt), p.y * sin(tilt) + p.z * cos(tilt));
  float depth = 2.4 + p.z;
  vec2 screen = p.xy / depth * 2.1 * uZoom;
  gl_Position = vec4(screen.x / uAspect, screen.y, 0.0, 1.0);

  // Treble shimmer: per-particle flicker that changes 24 times a second.
  float shimmer = h01(id ^ uint(uTime * 24.0) * 2654435761u) - 0.5;
  float bright = (0.35 + 0.65 * (1.0 - r)) * (0.55 + 0.6 * uLoud) * (1.0 + shimmer * uTreble * 1.6 * k);
  bright *= 1.0 + wave * 2.5;
  vAlpha = clamp(bright, 0.0, 2.0);
  vColor = palette(0.55 * r + 0.3 * uCentroid + 0.12 * r2);
  gl_PointSize = uPointScale * (1.2 + 1.8 * (1.0 - r)) * (2.4 / depth);
}`;

export const NEBULA_FS = `#version 300 es
precision highp float;
in vec3 vColor;
in float vAlpha;
out vec4 outColor;
void main() {
  vec2 q = gl_PointCoord - 0.5;
  float a = exp(-dot(q, q) * 18.0) * vAlpha * 0.16;
  outColor = vec4(vColor * a, 1.0);
}`;

/** Dark radial backdrop with a soft core glow, drawn before the particles. */
export const NEBULA_BG_FS = `#version 300 es
precision highp float;
uniform vec2 uRes;
uniform float uBass;
uniform float uIntensity;
uniform float uCentroid;
uniform vec3 uPa;
uniform vec3 uPb;
uniform vec3 uPc;
uniform vec3 uPd;
out vec4 outColor;
vec3 palette(float t) { return uPa + uPb * cos(6.2831853 * (uPc * t + uPd)); }
void main() {
  vec2 p = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
  float core = exp(-dot(p, p) * 9.0);
  vec3 c = palette(0.1 + 0.3 * uCentroid) * core * (0.05 + 0.18 * uBass * uIntensity);
  outColor = vec4(c, 1.0);
}`;
