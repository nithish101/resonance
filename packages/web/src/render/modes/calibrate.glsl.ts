// Calibration mode for the camera-based A/V sync check (docs/latency.md): black, with a white
// flash for each detected click. Film the screen and speaker together at a high frame rate and
// measure the offset between the click's waveform and the flash.

export const CALIBRATE_FS = `#version 300 es
precision highp float;
uniform vec2 uRes;
uniform float uFlash;
out vec4 outColor;
void main() {
  // A small always-on marker in the corner confirms the mode is running between flashes.
  vec2 p = gl_FragCoord.xy / uRes;
  float marker = step(p.x, 0.02) * step(p.y, 0.02) * 0.3;
  outColor = vec4(vec3(max(uFlash, marker)), 1.0);
}`;
