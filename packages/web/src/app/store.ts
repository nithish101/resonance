import { create } from "zustand";
import type { AppError } from "../audio/errors";
import type { Capabilities } from "../audio/capabilities";
import type { EngineInfo, SourceKind } from "../audio/engine";
import type { DspStats } from "../lib/protocol";
import type { RenderStats } from "../render/core";
import { DEFAULT_SETTINGS, type RenderSettings } from "../render/types";
import type { RendererInfo } from "./renderHost";

export type EngineState = "off" | "starting" | "ready" | "failed";

export interface SourceInfo {
  kind: SourceKind;
  label: string;
  /** Bundled track id when kind === "track". */
  trackId?: string;
}

export interface Playback {
  playing: boolean;
  time: number;
  duration: number;
  volume: number;
  loop: boolean;
}

export interface AppState {
  caps: Capabilities | null;
  engine: EngineState;
  engineInfo: EngineInfo | null;
  source: SourceInfo | null;
  /** True while a source is being opened (file loading, permission prompt open). */
  busy: boolean;
  error: AppError | null;
  /** A live source has been silent long enough to show a hint (IN-8). */
  silentHint: boolean;
  playback: Playback;
  dsp: DspStats | null;
  render: RenderStats | null;
  renderer: RendererInfo | null;
  settings: Settings;
  ui: UiState;
}

export interface UiState {
  settingsOpen: boolean;
  debugOpen: boolean;
  /** Controls faded out during playback (UI-1). */
  chromeHidden: boolean;
  /** The photosensitivity warning has been acknowledged (AX-1). */
  warningAccepted: boolean;
  /** The capability notice has been dismissed for this session. */
  bannerDismissed: boolean;
}

/** Everything user-adjustable (UI-2). Analysis params go to the DSP worker, the rest to the renderer. */
export interface Settings extends RenderSettings {
  sensitivity: number;
  smoothing: number;
}

export const DEFAULT_APP_SETTINGS: Settings = {
  ...DEFAULT_SETTINGS,
  sensitivity: 1,
  smoothing: 0.5,
};

export const initialState: AppState = {
  caps: null,
  engine: "off",
  engineInfo: null,
  source: null,
  busy: false,
  error: null,
  silentHint: false,
  playback: { playing: false, time: 0, duration: 0, volume: 0.9, loop: false },
  dsp: null,
  render: null,
  renderer: null,
  settings: DEFAULT_APP_SETTINGS,
  ui: {
    settingsOpen: false,
    debugOpen: false,
    chromeHidden: false,
    warningAccepted: false,
    bannerDismissed: false,
  },
};

export const useApp = create<AppState>()(() => initialState);

export const setApp = (patch: Partial<AppState>) => useApp.setState(patch);
export const setPlayback = (patch: Partial<Playback>) =>
  useApp.setState((s) => ({ playback: { ...s.playback, ...patch } }));

export const setUi = (patch: Partial<UiState>) =>
  useApp.setState((s) => ({ ui: { ...s.ui, ...patch } }));
