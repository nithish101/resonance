import { useEffect, useRef } from "react";
import { getEngine } from "../app/controller";
import { useApp } from "../app/store";
import { F, FrameBus, MEL_BANDS, createFrame } from "../lib/frames";
import { keyName } from "./format";

const HISTORY = 360; // hops (~4 s)

function fmt(v: number | undefined, digits = 1, unit = ""): string {
  return v === undefined || !Number.isFinite(v) ? "—" : `${v.toFixed(digits)}${unit}`;
}

/** UI-3: live engineering readout. Toggle with D. */
export function DebugOverlay() {
  const open = useApp((s) => s.ui.debugOpen);
  const dsp = useApp((s) => s.dsp);
  const render = useApp((s) => s.render);
  const info = useApp((s) => s.engineInfo);
  const renderer = useApp((s) => s.renderer);
  const source = useApp((s) => s.source);
  const timeline = useApp((s) => s.timeline);
  const spectrum = useRef<HTMLCanvasElement>(null);
  const onsets = useRef<HTMLCanvasElement>(null);
  const flux = useRef(new Float32Array(HISTORY));
  const marks = useRef(new Uint8Array(HISTORY));
  const fallbackMel = useRef<number[]>([]);

  // Append each stats batch to the rolling onset history.
  useEffect(() => {
    if (!dsp) return;
    fallbackMel.current = dsp.mel;
    const n = dsp.fluxHistory.length;
    if (!n) return;
    const f = flux.current;
    const m = marks.current;
    f.copyWithin(0, Math.min(n, HISTORY));
    m.copyWithin(0, Math.min(n, HISTORY));
    for (let i = 0; i < Math.min(n, HISTORY); i++) {
      f[HISTORY - Math.min(n, HISTORY) + i] = dsp.fluxHistory[n - Math.min(n, HISTORY) + i]!;
      m[HISTORY - Math.min(n, HISTORY) + i] = dsp.onsetHistory[n - Math.min(n, HISTORY) + i]!;
    }
  }, [dsp]);

  useEffect(() => {
    if (!open) return;
    let raf = 0;
    const engine = getEngine();
    const bus = engine?.frames.kind === "shared-memory" ? new FrameBus(engine.frames.buffer) : null;
    const frame = createFrame();
    const draw = () => {
      const sc = spectrum.current?.getContext("2d");
      if (sc && spectrum.current) {
        const { width: w, height: h } = spectrum.current;
        sc.clearRect(0, 0, w, h);
        let mel: ArrayLike<number> = fallbackMel.current;
        if (bus && bus.read(bus.latest(), frame))
          mel = frame.data.subarray(F.mel, F.mel + MEL_BANDS);
        const bw = w / MEL_BANDS;
        sc.fillStyle = "#e9b872";
        for (let i = 0; i < mel.length; i++) {
          const v = mel[i]!;
          sc.fillRect(i * bw + 0.5, h - v * h, Math.max(1, bw - 1), v * h);
        }
      }
      const oc = onsets.current?.getContext("2d");
      if (oc && onsets.current) {
        const { width: w, height: h } = onsets.current;
        oc.clearRect(0, 0, w, h);
        oc.strokeStyle = "rgba(232,230,223,0.8)";
        oc.beginPath();
        const f = flux.current;
        for (let i = 0; i < HISTORY; i++) {
          const x = (i / (HISTORY - 1)) * w;
          const y = h - Math.min(1, f[i]! / 1.5) * (h - 4);
          if (i === 0) oc.moveTo(x, y);
          else oc.lineTo(x, y);
        }
        oc.stroke();
        oc.fillStyle = "#e9b872";
        const m = marks.current;
        for (let i = 0; i < HISTORY; i++) {
          if (m[i]) oc.fillRect((i / (HISTORY - 1)) * w - 1, 0, 2, 5);
        }
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [open]);

  if (!open) return null;
  const live = source?.kind === "mic" || source?.kind === "tab";
  const rows: [string, string, string?][] = [
    ["FPS", fmt(render?.fps, 0)],
    ["Frame time (CPU)", fmt(render?.frameMs, 2, " ms")],
    ["Frame interval p95", fmt(render?.intervalP95, 1, " ms")],
    ["DSP per hop p50·p95", dsp ? `${fmt(dsp.dspP50, 0)} · ${fmt(dsp.dspP95, 0)} µs` : "—"],
    live
      ? [
          "Input latency (est.)",
          render?.inputLatencyMs ? fmt(render.inputLatencyMs, 1, " ms") : "—",
          "sync",
        ]
      : [
          "A/V sync error p50·p95",
          render && render.mode === 1
            ? `${fmt(render.syncErrorMs, 1)} · ${fmt(render.syncErrorP95, 1)} ms`
            : "—",
          "sync",
        ],
    ["Analysis lead", render && render.mode === 1 ? fmt(render.leadMs, 0, " ms") : "—", "lead"],
    ["Ring overruns", dsp ? `${dsp.overrunSamples} samples` : "—", "overruns"],
    [
      "Renderer",
      renderer?.backend ? `${renderer.backend} · ${renderer.location}` : "—",
      "renderer",
    ],
    [
      "Quality level",
      render ? `${render.quality} (${Math.round(render.scale * 100)}% res)` : "—",
      "quality",
    ],
    ["Transport", info ? `${info.transport}${info.simd ? " · SIMD" : ""}` : "—", "transport"],
    ["Sample rate", info ? `${info.sampleRate} Hz` : "—"],
    ["BPM", dsp?.bpm ? fmt(dsp.bpm, 1) : "—", "bpm"],
    ["Key", dsp ? keyName(dsp.key) : "—", "key"],
    [
      "Beat grid (offline)",
      !timeline
        ? "—"
        : timeline.status === "ready"
          ? `${timeline.beats.length} beats · ${Math.round(timeline.ms)} ms`
          : timeline.status,
      "grid",
    ],
    ["Key (whole track)", timeline?.status === "ready" ? keyName(timeline.key) : "—", "grid-key"],
    ["Flashes limited", render ? String(render.flashesSuppressed) : "—"],
  ];

  return (
    <section className="debug" aria-label="Debug overlay" data-testid="debug">
      <table>
        <tbody>
          {rows.map(([k, v, id]) => (
            <tr key={k}>
              <th scope="row">{k}</th>
              <td className="num" data-testid={id ? `debug-${id}` : undefined}>
                {v}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="label">Mel spectrum</p>
      <canvas ref={spectrum} width={256} height={56} aria-hidden="true" />
      <p className="label">Onset strength</p>
      <canvas ref={onsets} width={256} height={44} aria-hidden="true" />
    </section>
  );
}
