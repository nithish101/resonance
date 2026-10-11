// WebGL2 backend (RD-1). Works on an HTMLCanvasElement (main thread) or an OffscreenCanvas
// (render worker). Rebuilds its GPU resources if the context is lost and restored (RD-12).

import { F, MEL_BANDS } from "../../lib/frames";
import { CALIBRATE_FS } from "../modes/calibrate.glsl";
import { CHROMA_FS } from "../modes/chroma.glsl";
import { NEBULA_BG_FS, NEBULA_FS, NEBULA_VS } from "../modes/nebula.glsl";
import { BLUR_FS, BRIGHT_FS, COMPOSITE_FS, POST_VS } from "../modes/postfx.glsl";
import { TUNNEL_FS } from "../modes/tunnel.glsl";
import {
  probeBytes,
  type AnyCanvas,
  type Backend,
  type FrameProbe,
  type ModeId,
  type VisualState,
} from "../types";
import { FULLSCREEN_VS, program, uniforms } from "./gl";

interface ModeProgram {
  program: WebGLProgram;
  u: Record<string, WebGLUniformLocation>;
}

/** Fullscreen fragment-shader programs. */
const FULLSCREEN: Record<string, string> = {
  tunnel: TUNNEL_FS,
  calibrate: CALIBRATE_FS,
  "nebula-bg": NEBULA_BG_FS,
  bloom: CHROMA_FS,
};

/** WebGL2 has no compute; the stateless nebula is capped well below the WebGPU count. */
export const WEBGL2_MAX_PARTICLES = 150_000;

/** An offscreen colour target. */
interface Target {
  fb: WebGLFramebuffer;
  tex: WebGLTexture;
  w: number;
  h: number;
}

export class WebGL2Backend implements Backend {
  readonly kind = "webgl2" as const;
  private gl: WebGL2RenderingContext;
  private modes = new Map<string, ModeProgram>();
  private vao: WebGLVertexArrayObject | null = null;
  private _lost = false;
  private readonly mel = new Float32Array(MEL_BANDS);
  private readonly bands = new Float32Array(6);
  private readonly chroma = new Float32Array(12);
  private probeWaiters: ((p: FrameProbe) => void)[] = [];
  /** scene[0] = current mode, scene[1] = mode being faded out; bloom[0/1] ping-pong. */
  private scene: Target[] = [];
  private bloom: Target[] = [];

  constructor(
    private readonly canvas: AnyCanvas,
    opts: { preserveDrawingBuffer?: boolean } = {},
  ) {
    const gl = canvas.getContext("webgl2", {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      powerPreference: "high-performance",
      preserveDrawingBuffer: opts.preserveDrawingBuffer ?? false,
    }) as WebGL2RenderingContext | null;
    if (!gl) throw new Error("WebGL2 is not available");
    this.gl = gl;
    const target = canvas as EventTarget;
    target.addEventListener("webglcontextlost", (e) => {
      e.preventDefault();
      this._lost = true;
    });
    target.addEventListener("webglcontextrestored", () => {
      this._lost = false;
      this.build();
    });
    this.build();
  }

  get lost(): boolean {
    return this._lost;
  }

  private build(): void {
    const gl = this.gl;
    this.modes.clear();
    this.vao = gl.createVertexArray();
    for (const [id, fs] of Object.entries(FULLSCREEN)) {
      const p = program(gl, FULLSCREEN_VS, fs);
      this.modes.set(id, { program: p, u: uniforms(gl, p) });
    }
    const np = program(gl, NEBULA_VS, NEBULA_FS);
    this.modes.set("nebula", { program: np, u: uniforms(gl, np) });
    for (const [id, fs] of Object.entries({
      bright: BRIGHT_FS,
      blur: BLUR_FS,
      composite: COMPOSITE_FS,
    })) {
      const p = program(gl, POST_VS, fs);
      this.modes.set(id, { program: p, u: uniforms(gl, p) });
    }
    // Targets are (re)created lazily at the current size.
    this.scene = [];
    this.bloom = [];
  }

  private target(w: number, h: number): Target {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fb = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { fb, tex, w, h };
  }

  private freeTargets(ts: Target[]): void {
    for (const t of ts) {
      this.gl.deleteFramebuffer(t.fb);
      this.gl.deleteTexture(t.tex);
    }
  }

  private ensureTargets(): void {
    const w = this.canvas.width;
    const h = this.canvas.height;
    if (this.scene[0]?.w === w && this.scene[0]?.h === h) return;
    this.freeTargets(this.scene);
    this.freeTargets(this.bloom);
    this.scene = [this.target(w, h), this.target(w, h)];
    const bw = Math.max(1, w >> 2);
    const bh = Math.max(1, h >> 2);
    this.bloom = [this.target(bw, bh), this.target(bw, bh)];
  }

  resize(width: number, height: number): void {
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
  }

  draw(s: VisualState): void {
    if (this._lost) return;
    this.drawFrame(s);
    if (this.probeWaiters.length) {
      // Read back right after drawing, before the buffer is presented and cleared.
      const gl = this.gl;
      const w = this.canvas.width;
      const h = this.canvas.height;
      const px = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
      const p = probeBytes(px, false);
      this.probeWaiters.splice(0).forEach((r) => r(p));
    }
  }

  probe(): Promise<FrameProbe> {
    return new Promise((resolve) => this.probeWaiters.push(resolve));
  }

  private drawFrame(s: VisualState): void {
    const gl = this.gl;
    const d = s.features.data;
    this.mel.set(d.subarray(F.mel, F.mel + MEL_BANDS));
    this.bands.set(d.subarray(F.bands, F.bands + 6));
    this.chroma.set(d.subarray(F.chroma, F.chroma + 12));
    gl.bindVertexArray(this.vao);
    const w = this.canvas.width;
    const h = this.canvas.height;
    const fading = s.prevMode !== null && s.mix < 1;
    // Chromatic aberration is beat-triggered (RD-8): strongest on the beat, fading after it.
    const aberration =
      s.settings.aberration && !s.settings.reducedMotion
        ? 0.012 * s.beatPulse * s.settings.intensity
        : 0;
    const post =
      (s.settings.bloom && s.postAllowed) || aberration > 0 || s.settings.grain || fading;

    if (!post) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, w, h);
      this.drawMode(s.settings.mode, s);
      return;
    }

    this.ensureTargets();
    const [cur, prev] = this.scene as [Target, Target];
    gl.viewport(0, 0, w, h);
    gl.bindFramebuffer(gl.FRAMEBUFFER, cur.fb);
    this.drawMode(s.settings.mode, s);
    if (fading) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, prev.fb);
      this.drawMode(s.prevMode!, s);
    }
    // In the shaders, uA is the outgoing mode and uB the incoming one; uMix runs 0 -> 1.
    const a = fading ? prev : cur;
    const mix = fading ? s.mix : 1;

    const [b0, b1] = this.bloom as [Target, Target];
    if (s.settings.bloom && s.postAllowed) {
      gl.viewport(0, 0, b0.w, b0.h);
      gl.bindFramebuffer(gl.FRAMEBUFFER, b0.fb);
      this.post("bright", { uA: a.tex, uB: cur.tex }, { uMix: mix }, [1 / w, 1 / h]);
      gl.bindFramebuffer(gl.FRAMEBUFFER, b1.fb);
      this.post("blur", { uSrc: b0.tex }, {}, undefined, [1 / b0.w, 0]);
      gl.bindFramebuffer(gl.FRAMEBUFFER, b0.fb);
      this.post("blur", { uSrc: b1.tex }, {}, undefined, [0, 1 / b0.h]);
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, w, h);
    this.post(
      "composite",
      { uA: a.tex, uB: cur.tex, uBloom: b0.tex },
      {
        uMix: mix,
        uBloomAmt: s.settings.bloom && s.postAllowed ? 0.9 : 0,
        uAberration: aberration,
        uGrain: s.settings.grain ? 1 : 0,
        uTime: s.time,
        uSeed: s.settings.seed,
      },
    );
  }

  /** Draws one mode into the bound framebuffer. */
  private drawMode(mode: ModeId, s: VisualState): void {
    const gl = this.gl;
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (mode === "nebula") {
      this.use("nebula-bg", s);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      const count = Math.round(
        Math.min(WEBGL2_MAX_PARTICLES, s.settings.particles) * s.particleFraction,
      );
      this.use("nebula", s);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.drawArrays(gl.POINTS, 0, count);
      gl.disable(gl.BLEND);
      return;
    }
    this.use(this.modes.has(mode) ? mode : "tunnel", s);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /** Runs one post-processing pass into the bound framebuffer. */
  private post(
    id: string,
    textures: Record<string, WebGLTexture>,
    floats: Record<string, number>,
    texel?: [number, number],
    dir?: [number, number],
  ): void {
    const gl = this.gl;
    const m = this.modes.get(id)!;
    gl.useProgram(m.program);
    let unit = 0;
    for (const [name, tex] of Object.entries(textures)) {
      const l = m.u[name];
      if (!l) continue;
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1i(l, unit++);
    }
    for (const [name, v] of Object.entries(floats)) {
      const l = m.u[name];
      if (l) gl.uniform1f(l, v);
    }
    if (texel && m.u.uTexel) gl.uniform2f(m.u.uTexel, texel[0], texel[1]);
    if (dir && m.u.uDir) gl.uniform2f(m.u.uDir, dir[0], dir[1]);
    if (m.u.uRes) gl.uniform2f(m.u.uRes, this.canvas.width, this.canvas.height);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /** Binds a program and sets every uniform it uses (the compiler drops unused ones). */
  private use(id: string, s: VisualState): void {
    const gl = this.gl;
    const mode = this.modes.get(id)!;
    const { u } = mode;
    const d = s.features.data;
    gl.useProgram(mode.program);
    const f1 = (name: string, v: number) => {
      const l = u[name];
      if (l) gl.uniform1f(l, v);
    };
    const f3 = (name: string, v: readonly [number, number, number]) => {
      const l = u[name];
      if (l) gl.uniform3f(l, v[0], v[1], v[2]);
    };
    const w = this.canvas.width;
    const h = this.canvas.height;
    if (u.uRes) gl.uniform2f(u.uRes, w, h);
    if (u.uMel) gl.uniform1fv(u.uMel, this.mel);
    if (u.uBands) gl.uniform1fv(u.uBands, this.bands);
    if (u.uChroma) gl.uniform1fv(u.uChroma, this.chroma);
    f1("uKey", d[F.key]!);
    f1("uTime", s.time);
    f1("uTravel", s.travel);
    f1("uLoud", d[F.loudness]!);
    f1("uPulse", s.pulse);
    f1("uFlash", s.flash);
    f1("uBass", s.bass);
    f1("uMid", 0.5 * (d[F.bands + 2]! + d[F.bands + 3]!));
    f1("uTreble", 0.5 * (d[F.bands + 4]! + d[F.bands + 5]!));
    f1("uCentroid", d[F.centroidNorm]!);
    f1("uIntensity", s.settings.intensity * (s.settings.reducedMotion ? 0.35 : 1));
    // Grain is applied in the composite pass, once, for every mode.
    f1("uGrain", 0);
    f1("uSeed", s.settings.seed);
    f1("uZoom", s.camZoom);
    f1("uRoll", s.camRoll);
    f1("uShockAge", s.onsetAge);
    f1("uShockOn", s.settings.reducedMotion ? 0 : 1);
    f1("uAspect", w / h);
    // Point sizes scale with resolution so the look is the same at any size.
    f1("uPointScale", Math.max(1, h / 720) * 2.2);
    f3("uPa", s.palette.a);
    f3("uPb", s.palette.b);
    f3("uPc", s.palette.c);
    f3("uPd", s.palette.d);
  }

  simulateLoss(): void {
    const ext = this.gl.getExtension("WEBGL_lose_context");
    if (!ext) return;
    ext.loseContext();
    setTimeout(() => ext.restoreContext(), 300);
  }

  dispose(): void {
    const gl = this.gl;
    for (const m of this.modes.values()) gl.deleteProgram(m.program);
    this.freeTargets(this.scene);
    this.freeTargets(this.bloom);
    if (this.vao) gl.deleteVertexArray(this.vao);
    this.modes.clear();
  }
}
