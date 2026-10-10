// Render core: turns feature frames into a visual state and drives a backend. Shared by the
// render worker and the main-thread fallback, and by capture mode (RD-11), so all three draw
// identical pixels for the same audio.

import { F } from "../lib/frames";
import { FlashLimiter } from "./flash";
import { type FrameReader, type Features, createFeatures } from "./features";
import { paletteById } from "./palettes";
import { QualityController, RefreshEstimator } from "./quality";
import type { Backend, RenderSettings, VisualState } from "./types";

export interface RenderStats {
  fps: number;
  /** Median CPU time per frame, ms. */
  frameMs: number;
  /** 95th percentile interval between presented frames, ms. */
  intervalP95: number;
  quality: number;
  scale: number;
  /** Target time minus the time of the frame shown, ms (A/V sync error; M7). */
  syncErrorMs: number;
  flashesSuppressed: number;
}

export class RenderCore {
  readonly features: Features = createFeatures();
  readonly quality: QualityController;
  private readonly refresh = new RefreshEstimator();
  private readonly limiter = new FlashLimiter();
  private state: VisualState;
  private lastTime = -1;
  private cssW = 1;
  private cssH = 1;
  private dpr = 1;
  private intervals: number[] = [];
  private works: number[] = [];
  private syncErrors: number[] = [];

  constructor(
    private readonly backend: Backend,
    private readonly reader: FrameReader | null,
    settings: RenderSettings,
  ) {
    this.quality = new QualityController(1000 / 60);
    this.state = {
      time: 0,
      dt: 0,
      features: this.features,
      travel: 0,
      pulse: 0,
      flash: 0,
      bass: 0,
      palette: paletteById(settings.theme),
      settings,
      scale: 1,
      particleFraction: 1,
    };
  }

  get settings(): RenderSettings {
    return this.state.settings;
  }

  setSettings(s: RenderSettings): void {
    this.state.settings = s;
    this.state.palette = paletteById(s.theme);
  }

  resize(cssW: number, cssH: number, dpr: number): void {
    this.cssW = cssW;
    this.cssH = cssH;
    this.dpr = Math.min(dpr, 2);
    this.applySize();
  }

  private applySize(): void {
    const q = this.quality.current;
    this.state.scale = q.scale;
    this.state.particleFraction = q.particles;
    const w = Math.max(1, Math.round(this.cssW * this.dpr * q.scale));
    const h = Math.max(1, Math.round(this.cssH * this.dpr * q.scale));
    this.backend.resize(w, h);
  }

  /**
   * Advances the visual state to `time` (audio seconds) using `features`, without touching the
   * clock. Pure function of the sequence of (time, features): capture mode calls this directly.
   */
  step(time: number): VisualState {
    const s = this.state;
    const f = this.features;
    const d = f.data;
    const dt = this.lastTime < 0 ? 0 : Math.min(0.1, Math.max(0, time - this.lastTime));
    this.lastTime = time;
    const k = s.settings.reducedMotion ? 0.35 : 1;
    const intensity = s.settings.intensity * k;
    const bassNow = 0.6 * d[F.bands]! + 0.4 * d[F.bands + 1]!;
    s.bass += (bassNow - s.bass) * (1 - Math.exp(-dt / 0.06));
    s.travel += dt * (0.12 + 0.55 * d[F.loudness]! + 0.45 * s.bass) * (0.4 + 0.6 * intensity);
    s.pulse = f.onset ? 1 : s.pulse * Math.exp(-dt / 0.16);
    // Shockwave-style flashes are disabled under reduced motion (AX-3).
    const wanted = s.settings.reducedMotion ? 0 : s.pulse * 0.6 * s.settings.intensity;
    s.flash = this.limiter.apply(wanted, time);
    s.time = time;
    s.dt = dt;
    return s;
  }

  /** One interactive frame. `target` is an audio-context sample position, or null for live. */
  frame(nowMs: number, intervalMs: number, target: number | null): void {
    const t0 = performance.now();
    if (this.reader) this.reader.sample(target, this.features);
    const sr = this.reader?.sampleRate || 48_000;
    const time = this.features.valid ? this.features.time / sr : Math.max(0, this.lastTime);
    if (target !== null && this.features.valid) {
      this.syncErrors.push(((target - this.features.time) / sr) * 1000);
    }
    this.backend.draw(this.step(time));
    const work = performance.now() - t0;

    this.refresh.push(intervalMs);
    this.quality.setBudget(this.refresh.intervalMs);
    if (intervalMs > 0 && this.quality.update(intervalMs, work)) this.applySize();
    this.intervals.push(intervalMs);
    this.works.push(work);
    void nowMs;
  }

  /** Summarizes and clears the stats window. */
  takeStats(): RenderStats {
    const med = (a: number[]) => {
      if (!a.length) return 0;
      const s = [...a].sort((x, y) => x - y);
      return s[Math.floor(s.length / 2)]!;
    };
    const p95 = (a: number[]) => {
      if (!a.length) return 0;
      const s = [...a].sort((x, y) => x - y);
      return s[Math.min(s.length - 1, Math.floor(s.length * 0.95))]!;
    };
    const total = this.intervals.reduce((x, y) => x + y, 0);
    const stats: RenderStats = {
      fps: total > 0 ? (this.intervals.length * 1000) / total : 0,
      frameMs: med(this.works),
      intervalP95: p95(this.intervals),
      quality: this.quality.level,
      scale: this.quality.current.scale,
      syncErrorMs: med(this.syncErrors),
      flashesSuppressed: this.limiter.suppressed,
    };
    this.intervals = [];
    this.works = [];
    this.syncErrors = [];
    return stats;
  }

  resetTimeline(): void {
    this.lastTime = -1;
    this.limiter.reset();
    this.reader?.resetEvents();
  }

  dispose(): void {
    this.backend.dispose();
  }
}
