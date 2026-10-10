// WebGL2 backend (RD-1). Works on an HTMLCanvasElement (main thread) or an OffscreenCanvas
// (render worker). Rebuilds its GPU resources if the context is lost and restored (RD-12).

import { F, MEL_BANDS } from "../../lib/frames";
import { CALIBRATE_FS } from "../modes/calibrate.glsl";
import { NEBULA_BG_FS, NEBULA_FS, NEBULA_VS } from "../modes/nebula.glsl";
import { TUNNEL_FS } from "../modes/tunnel.glsl";
import {
  probeBytes,
  type AnyCanvas,
  type Backend,
  type FrameProbe,
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
};

/** WebGL2 has no compute; the stateless nebula is capped well below the WebGPU count. */
export const WEBGL2_MAX_PARTICLES = 150_000;

export class WebGL2Backend implements Backend {
  readonly kind = "webgl2" as const;
  private gl: WebGL2RenderingContext;
  private modes = new Map<string, ModeProgram>();
  private vao: WebGLVertexArrayObject | null = null;
  private _lost = false;
  private readonly mel = new Float32Array(MEL_BANDS);
  private readonly bands = new Float32Array(6);
  private probeWaiters: ((p: FrameProbe) => void)[] = [];

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
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.bindVertexArray(this.vao);

    if (s.settings.mode === "nebula") {
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
    this.use(this.modes.has(s.settings.mode) ? s.settings.mode : "tunnel", s);
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
    f1("uGrain", s.settings.grain ? 1 : 0);
    f1("uSeed", s.settings.seed);
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
    if (this.vao) gl.deleteVertexArray(this.vao);
    this.modes.clear();
  }
}
