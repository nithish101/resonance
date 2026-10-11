// Post-processing for WebGL2 (RD-7, RD-8): crossfade between two scene textures, bloom
// (bright-pass + separable Gaussian blur at quarter resolution), beat-triggered chromatic
// aberration, and film grain. Each effect can be toggled; with all of them off and no transition
// running, the backend skips this path entirely and draws straight to the canvas.

/** Downsample to quarter resolution and keep what's above the bloom threshold. */
export const BRIGHT_FS = `#version 300 es
precision highp float;
uniform sampler2D uA;
uniform sampler2D uB;
uniform float uMix;
uniform vec2 uTexel;  // 1 / source size
out vec4 outColor;
in vec2 vUv;
vec3 scene(vec2 uv) { return mix(texture(uA, uv).rgb, texture(uB, uv).rgb, uMix); }
void main() {
  vec2 o = uTexel;
  vec3 c = 0.25 * (scene(vUv + vec2(-o.x, -o.y)) + scene(vUv + vec2(o.x, -o.y))
                 + scene(vUv + vec2(-o.x, o.y)) + scene(vUv + vec2(o.x, o.y)));
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  outColor = vec4(c * smoothstep(0.35, 0.8, l), 1.0);
}`;

/** 9-tap Gaussian blur along uDir (one axis per pass). */
export const BLUR_FS = `#version 300 es
precision highp float;
uniform sampler2D uSrc;
uniform vec2 uDir;  // texel step along the blur axis
in vec2 vUv;
out vec4 outColor;
void main() {
  const float w[5] = float[](0.227027, 0.1945946, 0.1216216, 0.054054, 0.016216);
  vec3 c = texture(uSrc, vUv).rgb * w[0];
  for (int i = 1; i < 5; i++) {
    c += texture(uSrc, vUv + uDir * float(i)).rgb * w[i];
    c += texture(uSrc, vUv - uDir * float(i)).rgb * w[i];
  }
  outColor = vec4(c, 1.0);
}`;

/** Final pass: crossfade, bloom, chromatic aberration, grain. */
export const COMPOSITE_FS = `#version 300 es
precision highp float;
uniform sampler2D uA;
uniform sampler2D uB;
uniform sampler2D uBloom;
uniform float uMix;
uniform float uBloomAmt;
uniform float uAberration;
uniform float uGrain;
uniform float uTime;
uniform float uSeed;
uniform vec2 uRes;
in vec2 vUv;
out vec4 outColor;
vec3 scene(vec2 uv) { return mix(texture(uA, uv).rgb, texture(uB, uv).rgb, uMix); }
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7)) + uSeed * 17.0) * 43758.5453); }
void main() {
  // Chromatic aberration: red and blue sampled slightly outward/inward along the radius.
  vec2 dir = vUv - 0.5;
  vec2 off = dir * uAberration;
  vec3 c = vec3(scene(vUv + off).r, scene(vUv).g, scene(vUv - off).b);
  c += texture(uBloom, vUv).rgb * uBloomAmt;
  c += uGrain * (hash(gl_FragCoord.xy + floor(uTime * 60.0)) - 0.5) * 0.03;
  outColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

/** Fullscreen triangle with UVs for the post passes. */
export const POST_VS = `#version 300 es
out vec2 vUv;
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;
