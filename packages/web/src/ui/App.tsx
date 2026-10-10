import { useEffect, useState } from "react";

type Status =
  | { kind: "loading" }
  | { kind: "ready"; schemaVersion: number; simd: boolean }
  | { kind: "error"; message: string };

export function App() {
  const [status, setStatus] = useState<Status>({ kind: "loading" });

  useEffect(() => {
    const worker = new Worker(new URL("../workers/dsp.worker.ts", import.meta.url), {
      type: "module",
    });
    worker.onmessage = (
      e: MessageEvent<
        { type: "ready"; schemaVersion: number; simd: boolean } | { type: "error"; message: string }
      >,
    ) => {
      const m = e.data;
      setStatus(
        m.type === "ready"
          ? { kind: "ready", schemaVersion: m.schemaVersion, simd: m.simd }
          : { kind: "error", message: m.message },
      );
    };
    worker.postMessage({ type: "init" });
    return () => worker.terminate();
  }, []);

  return (
    <main>
      <h1>Resonance</h1>
      <dl data-testid="status">
        <dt>Cross-origin isolated</dt>
        <dd data-testid="coi">{String(globalThis.crossOriginIsolated)}</dd>
        <dt>DSP</dt>
        <dd data-testid="dsp">
          {status.kind === "ready"
            ? `schema v${status.schemaVersion} (${status.simd ? "SIMD" : "scalar"})`
            : status.kind === "error"
              ? `error: ${status.message}`
              : "loading"}
        </dd>
      </dl>
    </main>
  );
}
