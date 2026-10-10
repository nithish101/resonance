import { setUi, useApp } from "../app/store";

/** UI-5: which renderer and transport are active, and why, whenever something fell back. */
export function CapabilityPill() {
  const r = useApp((s) => s.renderer);
  const info = useApp((s) => s.engineInfo);
  if (!r) return null;
  const parts = [
    r.backend ? `${r.backend === "webgl2" ? "WebGL2" : "WebGPU"} · ${r.location}` : "No renderer",
  ];
  if (info) parts.push(info.transport === "shared-memory" ? "shared memory" : "postMessage");
  return (
    <span className="pill num" title={r.reason} data-testid="capability-pill">
      {parts.join(" · ")}
    </span>
  );
}

export function CapabilityNotice() {
  const r = useApp((s) => s.renderer);
  const caps = useApp((s) => s.caps);
  const dismissed = useApp((s) => s.ui.bannerDismissed);
  const accepted = useApp((s) => s.ui.warningAccepted);
  if (!r || !caps || dismissed || !accepted) return null;
  const notes: string[] = [];
  if (!caps.webgpu) notes.push("WebGPU isn't available here, so Resonance uses WebGL2.");
  if (r.location === "main") notes.push(r.reason);
  if (!r.backend) notes.push(r.reason);
  if (!caps.sharedArrayBuffer)
    notes.push(
      "This page isn't cross-origin isolated, so audio reaches the analyser by message passing instead of shared memory. It works, with slightly more latency.",
    );
  if (!notes.length) return null;
  return (
    <div className="notice info banner" role="status" data-testid="capability-banner">
      <strong>{r.backend ? "Running in compatibility mode" : "Visuals unavailable"}</strong>
      <p>{notes.join(" ")}</p>
      <div className="actions">
        <button className="btn" onClick={() => setUi({ bannerDismissed: true })}>
          OK
        </button>
      </div>
    </div>
  );
}
