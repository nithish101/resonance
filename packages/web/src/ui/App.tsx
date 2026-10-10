import { useEffect, useState } from "react";
import { detectCapabilities } from "../audio/capabilities";
import { playFile } from "../app/controller";
import { loadWarningAccepted } from "../app/persist";
import { DEFAULT_APP_SETTINGS, setApp, setUi, useApp } from "../app/store";
import { CapabilityNotice, CapabilityPill } from "./CapabilityBanner";
import { DebugOverlay } from "./DebugOverlay";
import { ChartIcon, ExpandIcon, SlidersIcon } from "./Icons";
import { ErrorNotice, SilentHint } from "./Notices";
import { PhotosensitivityGate } from "./PhotosensitivityGate";
import { SettingsPanel } from "./SettingsPanel";
import { SourcePicker } from "./SourcePicker";
import { Stage } from "./Stage";
import { Transport } from "./Transport";
import { useChrome } from "./useChrome";

function init() {
  const caps = detectCapabilities();
  setApp({
    caps,
    settings: { ...DEFAULT_APP_SETTINGS, reducedMotion: caps.reducedMotion },
  });
  setUi({ warningAccepted: loadWarningAccepted() });
}

export function App() {
  const source = useApp((s) => s.source);
  const ui = useApp((s) => s.ui);
  const [dragging, setDragging] = useState(false);
  useEffect(init, []);
  useChrome();

  const fullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen?.();
  };

  return (
    <div
      className="dropzone"
      data-active={dragging}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const f = e.dataTransfer.files[0];
        if (f) void playFile(f);
      }}
    >
      <Stage />
      <div className="chrome" data-hidden={ui.chromeHidden} data-testid="chrome">
        <header className="topbar">
          <span className="wordmark">Resonance</span>
          <div className="toolbar">
            <CapabilityPill />
            <button
              className="icon-btn"
              aria-label="Debug overlay (D)"
              aria-pressed={ui.debugOpen}
              onClick={() => setUi({ debugOpen: !ui.debugOpen })}
            >
              <ChartIcon />
            </button>
            <button
              className="icon-btn"
              aria-label="Settings (S)"
              aria-pressed={ui.settingsOpen}
              aria-expanded={ui.settingsOpen}
              onClick={() => setUi({ settingsOpen: !ui.settingsOpen })}
              data-testid="settings-button"
            >
              <SlidersIcon />
            </button>
            <button className="icon-btn" aria-label="Fullscreen" onClick={fullscreen}>
              <ExpandIcon />
            </button>
          </div>
        </header>
        {ui.warningAccepted && !source && <SourcePicker />}
        <ErrorNotice />
        <SilentHint />
        <CapabilityNotice />
        <DebugOverlay />
        <SettingsPanel />
        <Transport />
      </div>
      <PhotosensitivityGate />
    </div>
  );
}
