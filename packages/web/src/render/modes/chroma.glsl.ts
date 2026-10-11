// Chroma Bloom (RD-6): twelve petals, one per pitch class, arranged around the circle of fifths so
// harmonically related notes sit side by side. Each petal's length follows its chroma value; the
// tonic of the detected key glows brighter; a ring expands from the centre on every beat; the
// whole flower turns slowly with the music. Colours come from the active palette (with the
// "Follow the key" theme, the palette itself follows the key).

export const CHROMA_FS = `#version 300 es
precision highp float;

uniform vec2 uRes;
uniform float uTime;
uniform float uTravel;
uniform float uChroma[12];
uniform float uKey;
uniform float uBass;
uniform float uLoud;
uniform float uCentroid;
uniform float uIntensity;
uniform float uShockAge;
uniform float uShockOn;
uniform float uFlash;
uniform float uZoom;
uniform float uRoll;
uniform vec3 uPa;
uniform vec3 uPb;
uniform vec3 uPc;
uniform vec3 uPd;
out vec4 outColor;

const float TAU = 6.2831853;

vec3 palette(float t) { return uPa + uPb * cos(TAU * (uPc * t + uPd)); }

void main() {
  vec2 p = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
  p = mat2(cos(uRoll), -sin(uRoll), sin(uRoll), cos(uRoll)) * p / uZoom;
  float k = uIntensity;
  float spin = 0.06 * uTravel;
  float r = length(p);
  int tonic = uKey >= 0.0 ? int(mod(uKey, 12.0)) : -1;

  vec3 col = vec3(0.0);
  for (int i = 0; i < 12; i++) {
    int pc = (i * 7) % 12;                       // circle of fifths: C G D A E B ...
    float c = uChroma[pc];
    float theta = float(i) / 12.0 * TAU + spin + 1.5707963;
    vec2 dir = vec2(cos(theta), sin(theta));
    // Along / across the petal, starting at an inner radius so petals don't pile up at the centre.
    vec2 q = vec2(dot(p, dir) - 0.07, dot(p, vec2(-dir.y, dir.x)));
    float len = 0.08 + 0.32 * c * (0.5 + 0.5 * k);
    float t = clamp(q.x / len, 0.0, 1.0);
    float half_w = (0.016 + 0.04 * c) * pow(sin(3.14159 * t), 0.7);
    float inside = step(0.0, q.x) * step(q.x, len);
    float edge = abs(q.y) - half_w;
    float body = inside * smoothstep(0.012, -0.004, edge);
    // Glow fades past the tip too; cutting it at the petal length made a hard-edged disc.
    float along = smoothstep(-0.02, 0.0, q.x) * smoothstep(len + 0.04, len - 0.01, q.x);
    float glow = along * exp(-max(edge, 0.0) * 40.0) * 0.35;
    float lift = pc == tonic ? 1.6 : 1.0;
    vec3 tint = palette(float(i) / 12.0 * 0.85 + 0.25 * uCentroid);
    col += tint * (body * (0.12 + 0.55 * c) + glow * 0.6 * c) * lift;
  }

  // Core and the beat ring.
  float core = exp(-r * r * 900.0) * (0.15 + 0.5 * uBass * k);
  col += palette(0.05 + 0.3 * uCentroid) * core;
  float ringR = 0.07 + uShockAge * 0.55;
  float ring = exp(-pow(r - ringR, 2.0) * 900.0) * max(0.0, 1.0 - uShockAge / 0.8) * uShockOn;
  col += palette(0.5) * ring * 0.6 * k;

  col *= 1.0 + 0.5 * uFlash;
  col *= smoothstep(1.2, 0.3, r);
  col = 1.0 - exp(-col * 1.4);
  outColor = vec4(col, 1.0);
}`;
