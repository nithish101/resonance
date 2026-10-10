import { create } from "zustand";
import type { AppError } from "../audio/errors";
import type { Capabilities } from "../audio/capabilities";
import type { EngineInfo, SourceKind } from "../audio/engine";
import type { DspStats } from "../lib/protocol";

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
}

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
};

export const useApp = create<AppState>()(() => initialState);

export const setApp = (patch: Partial<AppState>) => useApp.setState(patch);
export const setPlayback = (patch: Partial<Playback>) =>
  useApp.setState((s) => ({ playback: { ...s.playback, ...patch } }));
