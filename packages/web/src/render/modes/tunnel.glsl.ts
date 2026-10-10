// Spectral Tunnel (RD-4): a raymarch-free tunnel in polar coordinates. The 64 mel bands wrap the
// circumference, mirrored left/right with bass at the bottom and treble at the top; each band
// pushes its stretch of wall inward. Depth rings travel toward the viewer at a speed integrated
// from loudness (so motion is a pure function of audio time), and the bass lights the core.

export const TUNNEL_FS = `#version 300 es
precision highp float;

uniform vec2 uRes;
uniform float uTime;
uniform float uTravel;
uniform float uMel[64];
uniform float uBands[6];
uniform float uLoud;
uniform float uPulse;
uniform float uFlash;
uniform float uBass;
uniform float uCentroid;
uniform float uIntensity;
uniform float uGrain;
uniform float uSeed;
uniform vec3 uPa;
uniform vec3 uPb;
uniform vec3 uPc;
uniform vec3 uPd;

out vec4 outColor;

const float PI = 3.14159265;

vec3 palette(float t) {
  return uPa + uPb * cos(6.2831853 * (uPc * t + uPd));
}

float mel(float x) {
  float f = clamp(x, 0.0, 1.0) * 63.0;
  int i = int(floor(f));
  int j = min(i + 1, 63);
  return mix(uMel[i], uMel[j], fract(f));
}

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7)) + uSeed * 17.0) * 43758.5453);
}

void main() {
  vec2 p = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
  float k = uIntensity;

  // A slow drift of the vanishing point, scaled down under reduced motion.
  p += 0.035 * k * vec2(sin(uTime * 0.21), cos(uTime * 0.17));

  float r = length(p);
  float th = atan(p.x, -p.y);          // 0 at the bottom, +-PI at the top
  float u = abs(th) / PI;              // mirrored: bass at the bottom, treble at the top
  float m = mel(u);

  // The spectrum pushes the walls in; bass breathes the whole tunnel.
  float rr = r * (1.0 + (0.6 * m + 0.25 * uBass) * k);
  float z = 0.32 / max(rr, 1e-3);
  float zz = z + uTravel;

  // Depth rings: thin bright bands with a soft trailing edge.
  float rf = fract(zz * 1.6);
  float ring = smoothstep(0.0, 0.03, rf) * smoothstep(0.22, 0.03, rf);

  // Longitudinal ribs: 24 around the circumference, twisting gently with depth. Antialiased
  // with fwidth so they stay hairlines at any resolution.
  float ribCoord = th / PI * 12.0 + 0.15 * zz;
  float rib = abs(fract(ribCoord) - 0.5);
  float ribW = fwidth(ribCoord) * 1.2;
  float ribs = smoothstep(0.5 - ribW, 0.5, rib);

  // Depth shaping: fog far away, and the walls right next to the camera fade out so the eye is
  // drawn down the tunnel instead of to smeared near-field rings.
  float fog = exp(-z * 0.5);
  float near = mix(0.12, 1.0, smoothstep(0.15, 0.9, z));
  float energy = 0.35 + 1.6 * m;
  float wall = (ring * energy + ribs * (0.18 + 0.7 * m)) * fog * near;

  vec3 col = palette(0.62 * u + 0.04 * zz + 0.3 * uCentroid) * wall;

  // Core glow from the bass, widening with loudness.
  float core = exp(-r * r * (22.0 - 10.0 * uLoud));
  col += palette(0.08 + 0.25 * uCentroid) * core * (0.06 + 0.7 * uBass * k);

  // Onset pulse sharpens the rings; the limited flash lifts everything a little.
  col *= 1.0 + 0.8 * uPulse * k * ring;
  col *= 1.0 + 0.6 * uFlash;

  // Vignette, filmic tone map, then grain after tone mapping so it stays subtle.
  col *= smoothstep(1.3, 0.25, r);
  col = 1.0 - exp(-col * 1.5);
  col = pow(col, vec3(0.92));
  col += uGrain * (hash(gl_FragCoord.xy + floor(uTime * 60.0)) - 0.5) * 0.03;
  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;
