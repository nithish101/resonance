# ADR 0008: Two particle implementations, stateless on WebGL2 and simulated on WebGPU

- Status: accepted
- Date: 2026-10-10

## Context

The Particle Nebula (RD-5) should show 500k+ particles on WebGPU and still work, at a reduced
count, on WebGL2, the P0 baseline. Bass should push particles outward, onsets should send a
shockwave through them, and treble should make them shimmer. It also has to work in
deterministic capture mode (RD-11) for screenshots and visual tests, which run on WebGL2.

WebGL2 has no compute shaders. A stateful simulation there means transform feedback or
ping-ponged float textures, both awkward and hard to keep deterministic. WebGPU has proper
compute and storage buffers.

## Decision

- **WebGL2: stateless.** A particle's position is an analytic function of its index and of
  audio-integrated time: three spiral arms, differential rotation, a divergence-free swirl,
  then bass, shockwave, and shimmer applied as displacements. Everything happens in the vertex
  shader of a buffer-less `drawArrays(POINTS)`. Capped at 150k particles.
- **WebGPU: simulated.** A compute pass integrates per-particle position and velocity in a
  storage buffer (up to about 1M). Each particle is a damped spring toward the same analytic
  orbit, and audio arrives as forces: bass as a radial push, the shockwave ring as an outward
  kick, treble as per-frame turbulence. Particles render as instanced quads with additive
  blending into an `rgba16float` target, then a tone-mapping composite pass.
- Both share the analytic orbit, so the two backends look like the same piece. The WebGPU one
  has real inertia: an impulse knocks particles off their orbit and they spring back.

The first WebGPU version relaxed every particle toward one shared velocity field. Particles
converged onto that field's attractor lines and the galaxy collapsed into a few thin streams.
Springing each particle toward its own orbit, with audio as perturbations, fixed it.

## Consequences

- Capture mode, the hero GIF, and visual regression tests use the deterministic WebGL2 version.
  The WebGPU simulation depends on the frame-time sequence, so it's verified by a GPU readback
  probe in e2e (SwiftShader's WebGPU adapter) and benchmarked on real hardware.
- Two shader implementations of one look must be kept in sync by hand (GLSL in
  `render/modes/nebula.glsl.ts`, WGSL in `render/webgpu/shaders.wgsl.ts`).
