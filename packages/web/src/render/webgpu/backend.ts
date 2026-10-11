// WebGPU backend (RD-2): the Spectral Tunnel as a WGSL fragment shader, and the Particle Nebula
// as a compute-shader simulation drawn as instanced quads into an HDR target. Recovers from
// device loss by rebuilding everything on a new device (RD-12).

import { F, MEL_BANDS } from "../../lib/frames";
import { probeBytes, type Backend, type FrameProbe, type VisualState } from "../types";
import {
  NEBULA_COMPOSITE_WGSL,
  NEBULA_DRAW_WGSL,
  NEBULA_SIM_WGSL,
  TUNNEL_WGSL,
} from "./shaders.wgsl";

/** Storage for this many particles is allocated once (32 bytes each: 32 MB). */
export const WEBGPU_MAX_PARTICLES = 1 << 20;
const UNIFORM_FLOATS = 100; // 400 bytes, mirrors `struct U` in shaders.wgsl.ts
const HDR_FORMAT: GPUTextureFormat = "rgba16float";

interface Gpu {
  device: GPUDevice;
  context: GPUCanvasContext;
  format: GPUTextureFormat;
  uniforms: GPUBuffer;
  particles: GPUBuffer;
  tunnel: GPURenderPipeline;
  calibrate: GPURenderPipeline;
  simulate: GPUComputePipeline;
  draw: GPURenderPipeline;
  composite: GPURenderPipeline;
  tunnelGroup: GPUBindGroup;
  calibrateGroup: GPUBindGroup;
  simGroup: GPUBindGroup;
  drawGroup: GPUBindGroup;
  hdr: GPUTexture | null;
  compositeGroup: GPUBindGroup | null;
}

/** WebGPU is first in the fallback chain only for the render worker (PRD 6.4). */
type WebGPUCanvas = OffscreenCanvas;

export class WebGPUBackend implements Backend {
  readonly kind = "webgpu" as const;
  private gpu: Gpu | null = null;
  /**
   * Held for the backend's lifetime. If nothing references the adapter, Chromium can
   * garbage-collect it and the device is lost ("A valid external Instance reference no longer
   * exists").
   */
  private adapter: GPUAdapter | null = null;
  private _lost = false;
  private disposed = false;
  private readonly u = new Float32Array(UNIFORM_FLOATS);
  private probeWaiters: ((p: FrameProbe) => void)[] = [];
  /** Called after a lost device has been replaced (for the debug overlay / tests). */
  onRecovered: (() => void) | null = null;
  /** Called if a lost device can't be replaced; the host then falls back to WebGL2. */
  onFatal: ((message: string) => void) | null = null;

  private constructor(private readonly canvas: WebGPUCanvas) {}

  /**
   * Resolves to a backend, or null if WebGPU isn't usable here (no API, no adapter). Requests
   * the adapter before touching the canvas, so on failure the caller can still use WebGL2 on the
   * same canvas.
   */
  static async create(canvas: WebGPUCanvas): Promise<WebGPUBackend | null> {
    const nav = (globalThis as { navigator?: { gpu?: GPU } }).navigator;
    if (!nav?.gpu) return null;
    const adapter = await nav.gpu.requestAdapter({ powerPreference: "high-performance" });
    if (!adapter) return null;
    const b = new WebGPUBackend(canvas);
    await b.build(adapter);
    return b;
  }

  /** "vendor architecture" of the adapter in use, for the capability banner. */
  get adapterName(): string {
    const info = this.adapter?.info;
    return info ? [info.vendor, info.architecture].filter(Boolean).join(" ") : "unknown";
  }

  get lost(): boolean {
    return this._lost;
  }

  private async build(adapter?: GPUAdapter): Promise<void> {
    const nav = (globalThis as { navigator?: { gpu?: GPU } }).navigator!;
    const a = adapter ?? (await nav.gpu!.requestAdapter({ powerPreference: "high-performance" }));
    if (!a) throw new Error("WebGPU adapter unavailable after device loss");
    this.adapter = a;
    const device = await a.requestDevice({
      requiredLimits: {
        maxStorageBufferBindingSize: Math.min(
          a.limits.maxStorageBufferBindingSize,
          WEBGPU_MAX_PARTICLES * 32,
        ),
      },
    });
    // Validation errors would otherwise fail silently (a black canvas).
    device.addEventListener("uncapturederror", (e) =>
      console.error(`WebGPU error: ${(e as GPUUncapturedErrorEvent).error.message}`),
    );
    void device.lost.then((info) => {
      if (this.disposed) return;
      // RD-12: rebuild on a fresh device instead of reloading the page.
      this._lost = true;
      console.warn(`WebGPU device lost (${info.reason}): ${info.message}; rebuilding`);
      this.build()
        .then(() => {
          this._lost = false;
          this.onRecovered?.();
        })
        .catch((e: unknown) => {
          console.error("WebGPU rebuild failed", e);
          this.onFatal?.(e instanceof Error ? e.message : String(e));
        });
    });

    const context = this.canvas.getContext("webgpu") as GPUCanvasContext;
    const format = nav.gpu!.getPreferredCanvasFormat();
    // COPY_SRC lets the test probe read the presented frame back.
    context.configure({
      device,
      format,
      alphaMode: "opaque",
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });

    const uniforms = device.createBuffer({
      size: UNIFORM_FLOATS * 4,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const particles = device.createBuffer({
      size: WEBGPU_MAX_PARTICLES * 32,
      usage: GPUBufferUsage.STORAGE,
    });

    const tunnelModule = device.createShaderModule({ code: TUNNEL_WGSL });
    const fullscreen = (entryPoint: string, mod: GPUShaderModule, targetFormat: GPUTextureFormat) =>
      device.createRenderPipeline({
        layout: "auto",
        vertex: { module: mod, entryPoint: "fullscreen" },
        fragment: { module: mod, entryPoint, targets: [{ format: targetFormat }] },
        primitive: { topology: "triangle-list" },
      });
    const tunnel = fullscreen("tunnel", tunnelModule, format);
    const calibrate = fullscreen("calibrate", tunnelModule, format);

    const simModule = device.createShaderModule({ code: NEBULA_SIM_WGSL });
    const simulate = device.createComputePipeline({
      layout: "auto",
      compute: { module: simModule, entryPoint: "simulate" },
    });
    const drawModule = device.createShaderModule({ code: NEBULA_DRAW_WGSL });
    const additive: GPUBlendComponent = { srcFactor: "one", dstFactor: "one", operation: "add" };
    const draw = device.createRenderPipeline({
      layout: "auto",
      vertex: { module: drawModule, entryPoint: "particleVs" },
      fragment: {
        module: drawModule,
        entryPoint: "particleFs",
        targets: [{ format: HDR_FORMAT, blend: { color: additive, alpha: additive } }],
      },
      primitive: { topology: "triangle-list" },
    });
    const composite = fullscreen(
      "composite",
      device.createShaderModule({ code: NEBULA_COMPOSITE_WGSL }),
      format,
    );

    const group = (p: GPURenderPipeline | GPUComputePipeline, entries: GPUBindGroupEntry[]) =>
      device.createBindGroup({ layout: p.getBindGroupLayout(0), entries });
    const uBinding = { binding: 0, resource: { buffer: uniforms } };
    this.gpu = {
      device,
      context,
      format,
      uniforms,
      particles,
      tunnel,
      calibrate,
      simulate,
      draw,
      composite,
      tunnelGroup: group(tunnel, [uBinding]),
      calibrateGroup: group(calibrate, [uBinding]),
      simGroup: group(simulate, [uBinding, { binding: 1, resource: { buffer: particles } }]),
      drawGroup: group(draw, [uBinding, { binding: 1, resource: { buffer: particles } }]),
      hdr: null,
      compositeGroup: null,
    };
  }

  resize(width: number, height: number): void {
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
  }

  private ensureHdr(g: Gpu): GPUTexture {
    const { width, height } = this.canvas;
    if (!g.hdr || g.hdr.width !== width || g.hdr.height !== height) {
      g.hdr?.destroy();
      g.hdr = g.device.createTexture({
        size: [width, height],
        format: HDR_FORMAT,
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      });
      g.compositeGroup = g.device.createBindGroup({
        layout: g.composite.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: g.uniforms } },
          { binding: 1, resource: g.hdr.createView() },
        ],
      });
    }
    return g.hdr;
  }

  private writeUniforms(g: Gpu, s: VisualState, count: number): void {
    const u = this.u;
    const d = s.features.data;
    const w = this.canvas.width;
    const h = this.canvas.height;
    u[0] = w;
    u[1] = h;
    u[2] = s.time;
    u[3] = s.travel;
    u[4] = s.bass;
    u[5] = 0.5 * (d[F.bands + 2]! + d[F.bands + 3]!);
    u[6] = 0.5 * (d[F.bands + 4]! + d[F.bands + 5]!);
    u[7] = d[F.loudness]!;
    u[8] = s.pulse;
    u[9] = s.flash;
    u[10] = d[F.centroidNorm]!;
    u[11] = s.settings.intensity * (s.settings.reducedMotion ? 0.35 : 1);
    u[12] = s.settings.grain ? 1 : 0;
    u[13] = s.settings.seed;
    u[14] = s.onsetAge;
    u[15] = s.settings.reducedMotion ? 0 : 1;
    u[16] = s.dt;
    u[17] = count;
    u[18] = Math.max(1, h / 720) * 2.2;
    u[19] = w / h;
    u.set([...s.palette.a, 0], 20);
    u.set([...s.palette.b, 0], 24);
    u.set([...s.palette.c, 0], 28);
    u.set([...s.palette.d, 0], 32);
    u.set(d.subarray(F.mel, F.mel + MEL_BANDS), 36);
    g.device.queue.writeBuffer(g.uniforms, 0, u);
  }

  draw(s: VisualState): void {
    const g = this.gpu;
    if (!g || this._lost) return;
    const nebula = s.settings.mode === "nebula";
    const count = nebula
      ? Math.max(
          1,
          Math.round(Math.min(WEBGPU_MAX_PARTICLES, s.settings.particles) * s.particleFraction),
        )
      : 0;
    this.writeUniforms(g, s, count);
    const enc = g.device.createCommandEncoder();
    const texture = g.context.getCurrentTexture();
    const view = texture.createView();
    const pass = (target: GPUTextureView) =>
      enc.beginRenderPass({
        colorAttachments: [
          {
            view: target,
            loadOp: "clear",
            storeOp: "store",
            clearValue: { r: 0, g: 0, b: 0, a: 1 },
          },
        ],
      });

    if (nebula) {
      const cp = enc.beginComputePass();
      cp.setPipeline(g.simulate);
      cp.setBindGroup(0, g.simGroup);
      cp.dispatchWorkgroups(Math.ceil(count / 256));
      cp.end();
      const hdr = this.ensureHdr(g);
      const rp = pass(hdr.createView());
      rp.setPipeline(g.draw);
      rp.setBindGroup(0, g.drawGroup);
      rp.draw(6, count);
      rp.end();
      const cp2 = pass(view);
      cp2.setPipeline(g.composite);
      cp2.setBindGroup(0, g.compositeGroup!);
      cp2.draw(3);
      cp2.end();
    } else {
      const rp = pass(view);
      rp.setPipeline(s.settings.mode === "calibrate" ? g.calibrate : g.tunnel);
      rp.setBindGroup(0, s.settings.mode === "calibrate" ? g.calibrateGroup : g.tunnelGroup);
      rp.draw(3);
      rp.end();
    }
    let readback: GPUBuffer | null = null;
    const bytesPerRow = Math.ceil((texture.width * 4) / 256) * 256;
    if (this.probeWaiters.length) {
      readback = g.device.createBuffer({
        size: bytesPerRow * texture.height,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      });
      enc.copyTextureToBuffer({ texture }, { buffer: readback, bytesPerRow }, [
        texture.width,
        texture.height,
      ]);
    }
    g.device.queue.submit([enc.finish()]);
    if (readback) {
      const waiters = this.probeWaiters.splice(0);
      const bgra = g.format.startsWith("bgra");
      const width = texture.width;
      readback
        .mapAsync(GPUMapMode.READ)
        .then(() => {
          const px = new Uint8Array(readback.getMappedRange());
          const p = probeBytes(px, bgra, 4, bytesPerRow, width);
          readback.destroy();
          waiters.forEach((r) => r(p));
        })
        .catch((e: unknown) => console.error("WebGPU probe readback failed", e));
    }
  }

  probe(): Promise<FrameProbe> {
    return new Promise((resolve) => this.probeWaiters.push(resolve));
  }

  /** Test hook for RD-12: destroys the device as a stand-in for a real loss. */
  simulateLoss(): void {
    this.gpu?.device.destroy();
  }

  dispose(): void {
    this.disposed = true;
    this.gpu?.hdr?.destroy();
    this.gpu?.particles.destroy();
    this.gpu?.uniforms.destroy();
    this.gpu?.device.destroy();
    this.gpu = null;
  }
}
