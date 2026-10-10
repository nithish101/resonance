import { useEffect, useRef } from "react";
import { updateSettings } from "../app/controller";
import { saveWarningAccepted } from "../app/persist";
import { setUi, useApp } from "../app/store";

/** AX-1: shown on first load, before any visuals react to audio. Remembered locally. */
export function PhotosensitivityGate() {
  const accepted = useApp((s) => s.ui.warningAccepted);
  const reduced = useApp((s) => s.settings.reducedMotion);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!accepted) button.current?.focus();
  }, [accepted]);

  if (accepted) return null;
  const accept = (reduce: boolean) => {
    if (reduce) updateSettings({ reducedMotion: true });
    saveWarningAccepted();
    setUi({ warningAccepted: true });
  };

  return (
    <div
      className="gate"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="ps-title"
      aria-describedby="ps-body"
    >
      <div className="gate-card">
        <p className="label">Before you start</p>
        <h1 id="ps-title">Photosensitivity notice</h1>
        <div id="ps-body">
          <p>
            Resonance shows moving patterns and brightness changes that follow the music. A small
            number of people can have seizures triggered by flashing light or patterns.
          </p>
          <p>
            Brightness flashes are limited to three per second (WCAG 2.3.1), and saturated red
            flashes are suppressed. Reduced motion lowers intensity further and turns off shockwaves
            and camera movement. You can change this any time in Settings.
          </p>
        </div>
        <div className="row">
          <button
            ref={button}
            className="btn primary"
            onClick={() => accept(false)}
            data-testid="ps-continue"
          >
            Continue
          </button>
          <button className="btn" onClick={() => accept(true)} data-testid="ps-reduced">
            Continue with reduced motion
          </button>
        </div>
        {reduced && (
          <p className="hint">Your system asks for reduced motion, so it's already on.</p>
        )}
      </div>
    </div>
  );
}
