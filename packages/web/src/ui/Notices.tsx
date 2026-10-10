import { dismissError, startTab } from "../app/controller";
import { useApp } from "../app/store";

export function ErrorNotice() {
  const error = useApp((s) => s.error);
  if (!error) return null;
  return (
    <div className="notice" role="alert" data-testid="error" data-code={error.code}>
      <strong>{error.title}</strong>
      <p>{error.message}</p>
      <div className="actions">
        {error.retryable && error.code.startsWith("tab-") && (
          <button className="btn" onClick={() => void startTab()}>
            Try again
          </button>
        )}
        {error.code === "wasm-failed" && (
          <button className="btn" onClick={() => location.reload()}>
            Reload
          </button>
        )}
        <button className="btn" onClick={dismissError} aria-label="Dismiss">
          Dismiss
        </button>
      </div>
    </div>
  );
}

/** IN-8: a live source that stays silent gets an explanation instead of a dead screen. */
export function SilentHint() {
  const show = useApp((s) => s.silentHint);
  const source = useApp((s) => s.source);
  if (!show || !source) return null;
  return (
    <div className="notice info" role="status" data-testid="silent-hint">
      <strong>No sound is coming through</strong>
      <p>
        {source.kind === "tab"
          ? 'Check that the shared tab is playing and that "Share tab audio" was on. Some protected content is captured as silence.'
          : "Check that the right input device is selected and isn't muted."}
      </p>
    </div>
  );
}
