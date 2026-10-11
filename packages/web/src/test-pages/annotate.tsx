// Beat annotation tool (PRD 9.2, eval/annotations/README.md). Not part of the app: served by the
// dev server at /annotate.html.
//
// 1. Calibrate: tap along with a 120 BPM click; the median offset is your tap latency.
// 2. Tap along with a song, twice.
// 3. Download: taps both passes agree on (within 100 ms) are averaged, latency-corrected, and
//    saved as eval/annotations/<track>.beats.
//
// Timing: audio plays through an AudioBufferSourceNode started at a known context time, and each
// keypress is mapped to the audible context time with getOutputTimestamp() and the event's own
// timestamp, so a tap's media time is what was being heard when the key went down.

import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { TRACKS } from "../audio/tracks";
import "../ui/global.css";
import { mergePasses, tapLatency, toBeatsFile } from "./annotate-core";

type Phase = "idle" | "calibrating" | "pass1" | "pass2";
const CLICK_URL = "/audio/fixtures/click-120.wav";
const clickTimes = Array.from({ length: 40 }, (_, k) => 0.5 + k * 0.5); // fixture ground truth

function Annotator() {
  const ctx = useRef<AudioContext | null>(null);
  const source = useRef<AudioBufferSourceNode | null>(null);
  const start = useRef(0);
  const taps = useRef<number[]>([]);
  const [phase, setPhase] = useState<Phase>("idle");
  const [trackId, setTrackId] = useState(TRACKS[0]!.id);
  const [latency, setLatency] = useState<number | null>(null);
  const [pass1, setPass1] = useState<number[]>([]);
  const [pass2, setPass2] = useState<number[]>([]);
  const [count, setCount] = useState(0);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Space" || !ctx.current || phase === "idle") return;
      e.preventDefault();
      const c = ctx.current;
      const ts = c.getOutputTimestamp();
      const audible = (ts.contextTime ?? 0) + (e.timeStamp - (ts.performanceTime ?? 0)) / 1000;
      taps.current.push(audible - start.current);
      setCount(taps.current.length);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase]);

  async function play(url: string, next: Phase) {
    ctx.current ??= new AudioContext();
    const c = ctx.current;
    await c.resume();
    const buf = await c.decodeAudioData(await (await fetch(url)).arrayBuffer());
    source.current?.stop();
    const s = c.createBufferSource();
    s.buffer = buf;
    s.connect(c.destination);
    start.current = c.currentTime + 0.3;
    s.start(start.current);
    source.current = s;
    taps.current = [];
    setCount(0);
    setPhase(next);
    s.onended = () => finish(next);
  }

  function finish(which: Phase) {
    const t = [...taps.current];
    source.current = null;
    setPhase("idle");
    if (which === "calibrating") {
      const l = tapLatency(t, clickTimes);
      setLatency(l);
      setMessage(
        l === null
          ? "Not enough taps near the clicks; try again."
          : `Your tap latency: ${(l * 1000).toFixed(0)} ms.`,
      );
    } else if (which === "pass1") setPass1(t);
    else if (which === "pass2") setPass2(t);
  }

  function stop() {
    const p = phase;
    source.current?.stop();
    if (p !== "idle") finish(p);
  }

  function download() {
    const beats = mergePasses(pass1, pass2, latency ?? 0);
    const blob = new Blob([toBeatsFile(beats)], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${trackId}.beats`;
    a.click();
    setMessage(
      `${beats.length} beats agreed on by both passes. Save the file to eval/annotations/.`,
    );
  }

  const track = TRACKS.find((t) => t.id === trackId)!;
  return (
    <main className="picker" style={{ position: "static", transform: "none", margin: "40px auto" }}>
      <h1>Beat annotation</h1>
      <p className="lede">
        Press <kbd>Space</kbd> on every beat. Use headphones or wired speakers (Bluetooth adds
        delay). Taps are timed against the audio output clock.
      </p>
      <section>
        <p className="label">1. Calibrate</p>
        <div className="row">
          <button
            className="btn"
            onClick={() => void play(CLICK_URL, "calibrating")}
            disabled={phase !== "idle"}
          >
            Tap along with clicks
          </button>
          <span className="num">
            {latency === null ? "not calibrated" : `${(latency * 1000).toFixed(0)} ms`}
          </span>
        </div>
      </section>
      <section>
        <p className="label">2. Tap a song twice</p>
        <div className="row">
          <select
            className="device"
            value={trackId}
            onChange={(e) => setTrackId(e.target.value)}
            aria-label="Track"
          >
            {TRACKS.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title}
              </option>
            ))}
          </select>
          <button
            className="btn"
            onClick={() => void play(track.url, "pass1")}
            disabled={phase !== "idle"}
          >
            Pass 1 {pass1.length ? `(${pass1.length})` : ""}
          </button>
          <button
            className="btn"
            onClick={() => void play(track.url, "pass2")}
            disabled={phase !== "idle"}
          >
            Pass 2 {pass2.length ? `(${pass2.length})` : ""}
          </button>
          {phase !== "idle" && (
            <button className="btn" onClick={stop}>
              Stop ({count} taps)
            </button>
          )}
        </div>
      </section>
      <section>
        <p className="label">3. Save</p>
        <button
          className="btn primary"
          onClick={download}
          disabled={!pass1.length || !pass2.length || latency === null}
        >
          Download {trackId}.beats
        </button>
        {message && <p className="hint">{message}</p>}
      </section>
    </main>
  );
}

const root = document.getElementById("root");
if (root) {
  document.body.style.overflow = "auto";
  createRoot(root).render(
    <StrictMode>
      <Annotator />
    </StrictMode>,
  );
}
