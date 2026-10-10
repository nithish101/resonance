import { useEffect } from "react";
import { togglePlay } from "../app/controller";
import { setUi, useApp } from "../app/store";

const HIDE_AFTER_MS = 3000;

function isTyping(t: EventTarget | null): boolean {
  return (
    t instanceof HTMLInputElement ||
    t instanceof HTMLSelectElement ||
    t instanceof HTMLTextAreaElement ||
    (t instanceof HTMLElement && t.isContentEditable)
  );
}

/**
 * UI-1: controls fade out after a few idle seconds of playback and come back on any pointer
 * movement, touch, key press, or focus change. Also the keyboard shortcuts (D, S, Space).
 */
export function useChrome(): void {
  useEffect(() => {
    let timer = 0;
    const schedule = () => {
      clearTimeout(timer);
      if (useApp.getState().ui.chromeHidden) setUi({ chromeHidden: false });
      timer = window.setTimeout(() => {
        const s = useApp.getState();
        const playing =
          s.source && (s.playback.playing || s.source.kind === "mic" || s.source.kind === "tab");
        const busy = s.ui.settingsOpen || s.error || !s.ui.warningAccepted;
        if (playing && !busy) setUi({ chromeHidden: true });
      }, HIDE_AFTER_MS);
    };
    const onKey = (e: KeyboardEvent) => {
      schedule();
      const ui = useApp.getState().ui;
      if (e.key === "Escape") {
        setUi({ settingsOpen: false });
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      if (!ui.warningAccepted) return;
      if (e.key === "d" || e.key === "D") setUi({ debugOpen: !ui.debugOpen });
      else if (e.key === "s" || e.key === "S") setUi({ settingsOpen: !ui.settingsOpen });
      else if (e.key === " " && !(e.target instanceof HTMLButtonElement)) {
        e.preventDefault();
        togglePlay();
      }
    };
    const events = ["pointermove", "pointerdown", "focusin", "wheel"] as const;
    events.forEach((ev) => window.addEventListener(ev, schedule, { passive: true }));
    window.addEventListener("keydown", onKey);
    schedule();
    return () => {
      clearTimeout(timer);
      events.forEach((ev) => window.removeEventListener(ev, schedule));
      window.removeEventListener("keydown", onKey);
    };
  }, []);
}
