import { useEffect, useRef } from "react";
import { setUi, useApp } from "../app/store";
import { CloseIcon } from "./Icons";

const SHORTCUTS: [string, string][] = [
  ["Space", "Play / pause"],
  ["← →", "Seek 5 seconds"],
  ["↑ ↓", "Volume"],
  ["M", "Next mode"],
  ["T", "Next colour theme"],
  ["R", "Reduced motion on / off"],
  ["S", "Settings"],
  ["D", "Debug overlay"],
  ["F", "Fullscreen"],
  ["?", "This list"],
  ["Esc", "Close panels"],
];

/** UI-4: the keyboard shortcut sheet, toggled with ?. */
export function HelpSheet() {
  const open = useApp((s) => s.ui.helpOpen);
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (open) close.current?.focus();
  }, [open]);
  if (!open) return null;
  return (
    <div
      className="gate"
      role="dialog"
      aria-modal="true"
      aria-labelledby="help-title"
      data-testid="help"
    >
      <div className="gate-card">
        <div className="panel-head">
          <h1 id="help-title">Keyboard shortcuts</h1>
          <button
            ref={close}
            className="icon-btn"
            aria-label="Close"
            onClick={() => setUi({ helpOpen: false })}
          >
            <CloseIcon />
          </button>
        </div>
        <dl className="shortcuts">
          {SHORTCUTS.map(([k, v]) => (
            <div key={k}>
              <dt>
                <kbd>{k}</kbd>
              </dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
