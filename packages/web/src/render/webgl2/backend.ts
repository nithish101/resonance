// WebGL2 backend (RD-1). Works on an HTMLCanvasElement (main thread) or an OffscreenCanvas
// (render worker). Rebuilds its GPU resources if the context is lost and restored (RD-12).

import { F, MEL_BANDS } from "../../lib/frames";
import { TUNNEL_FS } from "../modes/tunnel.glsl";
import type { AnyCanvas, Backend, ModeId, VisualState } from "../types";
import { FULLSCREEN_VS, program, uniforms } from "./gl";

interface ModeProgram {
  program: WebGLProgram;
  u: Record<string, WebGLUniformLocation>;
}

const SOURCES: Partial<Record<ModeId, string>> = { tunnel: TUNNEL_FS };

export class WebGL2Backend implements Backend {
  readonly kind = "webgl2" as const;
  private gl: WebGL2RenderingContext;
  private modes = new Map<ModeId, ModeProgram>();
  private vao: WebGLVertexArrayObject | null = null;
  private _lost = false;
  private readonly mel = new Float32Array(MEL_BANDS);
  private readonly bands = new Float32Array(6);

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
    for (const [id, fs] of Object.entries(SOURCES) as [ModeId, string][]) {
      const p = program(gl, FULLSCREEN_VS, fs);
      this.modes.set(id, { program: p, u: uniforms(gl, p) });
    }
  }

  resize(width: number, height: number): void {
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
  }

  draw(s: VisualState): void {
    if (this._lost) return;
    const gl = this.gl;
    const mode = this.modes.get(s.settings.mode) ?? this.modes.get("tunnel")!;
    const { u } = mode;
    const d = s.features.data;
    this.mel.set(d.subarray(F.mel, F.mel + MEL_BANDS));
    this.bands.set(d.subarray(F.bands, F.bands + 6));

    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.useProgram(mode.program);
    gl.bindVertexArray(this.vao);
    // Uniforms the GLSL compiler optimised away have no location; skip those.
    const f1 = (name: string, v: number) => {
      const l = u[name];
      if (l) gl.uniform1f(l, v);
    };
    const f3 = (name: string, v: readonly [number, number, number]) => {
      const l = u[name];
      if (l) gl.uniform3f(l, v[0], v[1], v[2]);
    };
    if (u.uRes) gl.uniform2f(u.uRes, this.canvas.width, this.canvas.height);
    if (u.uMel) gl.uniform1fv(u.uMel, this.mel);
    if (u.uBands) gl.uniform1fv(u.uBands, this.bands);
    f1("uTime", s.time);
    f1("uTravel", s.travel);
    f1("uLoud", d[F.loudness]!);
    f1("uPulse", s.pulse);
    f1("uFlash", s.flash);
    f1("uBass", s.bass);
    f1("uCentroid", d[F.centroidNorm]!);
    f1("uIntensity", s.settings.intensity);
    f1("uGrain", s.settings.grain ? 1 : 0);
    f1("uSeed", s.settings.seed);
    f3("uPa", s.palette.a);
    f3("uPb", s.palette.b);
    f3("uPc", s.palette.c);
    f3("uPd", s.palette.d);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  dispose(): void {
    const gl = this.gl;
    for (const m of this.modes.values()) gl.deleteProgram(m.program);
    if (this.vao) gl.deleteVertexArray(this.vao);
    this.modes.clear();
  }
}
