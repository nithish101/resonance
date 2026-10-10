import { useEffect, useState } from "react";
import { detectCapabilities } from "../audio/capabilities";
import { playFile } from "../app/controller";
import { setApp, useApp } from "../app/store";
import { ErrorNotice, SilentHint } from "./Notices";
import { SourcePicker } from "./SourcePicker";
import { Stage } from "./Stage";
import { Transport } from "./Transport";

export function App() {
  const source = useApp((s) => s.source);
  const engine = useApp((s) => s.engine);
  const info = useApp((s) => s.engineInfo);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    setApp({ caps: detectCapabilities() });
  }, []);

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
      <div className="chrome">
        <header className="topbar">
          <span className="wordmark">Resonance</span>
          <span className="num" data-testid="engine-state" data-transport={info?.transport ?? ""}>
            {engine === "ready" && info
              ? `${info.sampleRate} Hz · ${info.transport} · ${info.simd ? "SIMD" : "scalar"}`
              : ""}
          </span>
        </header>
        {!source && <SourcePicker />}
        <ErrorNotice />
        <SilentHint />
        <Transport />
      </div>
    </div>
  );
}
