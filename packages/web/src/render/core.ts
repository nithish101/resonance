// Render core: turns feature frames into a visual state and drives a backend. Shared by the
// render worker and the main-thread fallback, and by capture mode (RD-11), so all three draw
// identical pixels for the same audio.

import { beatPhaseAt } from "../lib/beats";
import { audibleMediaTime, inputLatencyEstimate, type ClockSample } from "../lib/clock";
import { F } from "../lib/frames";
import { FlashLimiter } from "./flash";
import { type FrameReader, type Features, createFeatures } from "./features";
import { keyPalette, paletteById } from "./palettes";
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
  /** 0 idle, 1 file (synced to output), 2 live. */
  mode: number;
  /**
   * File mode: target time minus the time of the features shown, ms. Positive means the
   * visuals trail the audio. Median and 95th percentile of the absolute value.
   */
  syncErrorMs: number;
  syncErrorP95: number;
  /** File mode: how far the newest analysed frame is ahead of the target, ms. */
  leadMs: number;
  /** Live mode: estimated capture-to-photon latency, ms (median). */
  inputLatencyMs: number;
  flashesSuppressed: number;
  /** Raw frame intervals (ms) in this window, for benchmarks that need exact percentiles. */
  intervals: number[];
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
  private leads: number[] = [];
  private latencies: number[] = [];
  private mode = 0;
  private lastSync: [number, number] = [0, 0];
  private lastLead = 0;
  private lastLatency = 0;
  /** Offline beat grid (media seconds) for the current file, when analysed (DSP-9). */
  private beats: number[] | null = null;
  private lastGridBeat = -1;
  private gridBeat = false;
  private haveBeats = false;
  private onsetPulse = 0;
  private paletteKey = -2;
  private fadeStart = -1;
  private camKick = 0;
  private beatsSeen = 0;

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
      onsetAge: 99,
      beatPulse: 0,
      beatPhase: 0,
      postAllowed: true,
      camZoom: 1,
      camRoll: 0,
      prevMode: null,
      mix: 1,
      palette: paletteById(settings.theme),
      settings,
      scale: 1,
      particleFraction: 1,
    };
  }

  /** Offline beat grid for the playing file (media seconds), or null. */
  setBeats(beats: number[] | null): void {
    this.beats = beats && beats.length > 1 ? beats : null;
    this.lastGridBeat = -1;
  }

  get settings(): RenderSettings {
    return this.state.settings;
  }

  setSettings(s: RenderSettings): void {
    // A mode change starts a crossfade, timed in audio time so capture mode stays deterministic.
    if (s.mode !== this.state.settings.mode) {
      this.state.prevMode = this.state.settings.mode;
      this.fadeStart = this.lastTime;
    }
    this.state.settings = s;
    this.state.palette = paletteById(s.theme);
    this.paletteKey = -2;
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
    this.state.postAllowed = q.post;
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
    // Beats come from the offline grid (file mode, anticipating) or the live tracker's flags.
    const beat = this.gridBeat || f.beat;
    this.gridBeat = false;
    if (beat) this.haveBeats = true;
    s.beatPulse = beat ? 1 : s.beatPulse * Math.exp(-dt / 0.2);
    s.beatPhase = d[F.beatPhase]!;
    if (s.settings.theme === "key") {
      const key = Math.round(d[F.key]!);
      if (key !== this.paletteKey) {
        this.paletteKey = key;
        s.palette = keyPalette(key);
      }
    }
    this.onsetPulse = f.onset ? 1 : this.onsetPulse * Math.exp(-dt / 0.16);
    s.pulse = Math.max(this.onsetPulse, 0.8 * s.beatPulse);
    // Beat camera (RD-9): a small push-in on each beat and a slow roll that swings with the
    // beat phase. Disabled under reduced motion (AX-3).
    if (beat) this.camKick = 1;
    this.camKick *= Math.exp(-dt / 0.12);
    const cam = s.settings.reducedMotion ? 0 : s.settings.intensity;
    s.camZoom = 1 + 0.045 * this.camKick * cam;
    s.camRoll =
      cam *
      (0.035 * Math.sin(time * 0.37) +
        0.012 * Math.sin((2 * Math.PI * (s.beatPhase + this.beatsSeen)) / 2));
    if (beat) this.beatsSeen = (this.beatsSeen + 1) % 2;

    // Crossfade progress (RD-7).
    if (s.prevMode) {
      const p = this.fadeStart < 0 ? 1 : (time - this.fadeStart) / 0.8;
      s.mix = Math.min(1, Math.max(0, p));
      if (s.mix >= 1) s.prevMode = null;
    } else s.mix = 1;

    // The shockwave follows the beat once beats are known, onsets before that.
    const kick = this.haveBeats ? beat : f.onset;
    s.onsetAge = kick ? 0 : s.onsetAge + dt;
    if (s.settings.mode === "calibrate") {
      // Camera check: a plain on/off square wave, exempt from intensity scaling. Clicks are 2 per
      // second, inside the 3-per-second flash limit, so the limiter never alters it.
      s.flash = this.limiter.apply(this.onsetPulse > 0.5 ? 1 : 0, time);
      s.time = time;
      s.dt = dt;
      return s;
    }
    // Shockwave-style flashes are disabled under reduced motion (AX-3).
    const wanted = s.settings.reducedMotion ? 0 : s.pulse * 0.6 * s.settings.intensity;
    s.flash = this.limiter.apply(wanted, time);
    s.time = time;
    s.dt = dt;
    return s;
  }

  /**
   * One interactive frame at absolute time `nowAbs` (ms). `target` is the audio-context sample
   * position to show, or null for the newest frame (live).
   */
  frame(nowAbs: number, intervalMs: number, target: number | null, clock?: ClockSample): void {
    const t0 = performance.now();
    if (this.reader) this.reader.sample(target, this.features);
    const sr = this.reader?.sampleRate || 48_000;
    const time = this.features.valid ? this.features.time / sr : Math.max(0, this.lastTime);
    this.mode = clock?.mode ?? 0;
    if (this.beats && clock && clock.mode === 1 && clock.mediaRate > 0) {
      const bp = beatPhaseAt(this.beats, audibleMediaTime(clock, nowAbs));
      if (bp) {
        this.features.data[F.beatPhase] = bp.phase;
        if (bp.index !== this.lastGridBeat) {
          this.gridBeat = this.lastGridBeat >= 0; // not on the first lookup after a seek
          this.lastGridBeat = bp.index;
        }
      }
    }
    if (this.features.valid && clock) {
      if (target !== null) {
        this.syncErrors.push(((target - this.features.time) / sr) * 1000);
        this.leads.push((this.features.lead / sr) * 1000);
      } else if (clock.mode === 2) {
        this.latencies.push(
          inputLatencyEstimate(clock, nowAbs, this.features.time, this.refresh.intervalMs) * 1000,
        );
      }
    }
    this.backend.draw(this.step(time));
    const work = performance.now() - t0;

    this.refresh.push(intervalMs);
    this.quality.setBudget(this.refresh.intervalMs);
    if (intervalMs > 0 && this.quality.update(intervalMs, work)) this.applySize();
    this.intervals.push(intervalMs);
    this.works.push(work);
  }

  /**
   * Capture mode (RD-11): shows audio time `time` (seconds) with no wall clock involved. Call
   * with monotonically increasing times at a fixed step; `draw` false advances the visual state
   * without rendering (used to fast-forward to a start time).
   */
  renderAt(time: number, draw: boolean): void {
    const sr = this.reader?.sampleRate || 48_000;
    if (this.reader) this.reader.sample(time * sr, this.features);
    const s = this.step(time);
    if (draw) this.backend.draw(s);
  }

  /** Fixed render size for capture mode (no adaptive quality). */
  setFixedSize(width: number, height: number): void {
    this.backend.resize(width, height);
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
    // A window with no frames (very slow or software rendering) keeps the last timing readings
    // instead of reporting zeros that look like measurements.
    if (this.syncErrors.length) {
      this.lastSync = [med(this.syncErrors.map(Math.abs)), p95(this.syncErrors.map(Math.abs))];
    }
    if (this.leads.length) this.lastLead = med(this.leads);
    if (this.latencies.length) this.lastLatency = med(this.latencies);
    const stats: RenderStats = {
      fps: total > 0 ? (this.intervals.length * 1000) / total : 0,
      frameMs: med(this.works),
      intervalP95: p95(this.intervals),
      quality: this.quality.level,
      scale: this.quality.current.scale,
      mode: this.mode,
      syncErrorMs: this.lastSync[0],
      syncErrorP95: this.lastSync[1],
      leadMs: this.lastLead,
      inputLatencyMs: this.lastLatency,
      flashesSuppressed: this.limiter.suppressed,
      intervals: this.intervals.filter((x) => x > 0),
    };
    this.intervals = [];
    this.works = [];
    this.syncErrors = [];
    this.leads = [];
    this.latencies = [];
    return stats;
  }

  resetTimeline(): void {
    this.lastTime = -1;
    this.haveBeats = false;
    this.limiter.reset();
    this.reader?.resetEvents();
  }

  dispose(): void {
    this.backend.dispose();
  }
}
