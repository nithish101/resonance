import { useId } from "react";
import { updateSettings } from "../app/controller";
import { setUi, useApp, type Settings } from "../app/store";
import { PALETTES } from "../render/palettes";
import type { ModeId } from "../render/types";
import { CloseIcon } from "./Icons";

const MODES: { id: ModeId; name: string; available: boolean }[] = [
  { id: "tunnel", name: "Spectral Tunnel", available: true },
];

function Slider(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
  hint?: string;
}) {
  const id = useId();
  return (
    <div className="field">
      <div className="field-head">
        <label htmlFor={id}>{props.label}</label>
        <span className="num">{props.format(props.value)}</span>
      </div>
      <input
        id={id}
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        aria-valuetext={props.format(props.value)}
        onChange={(e) => props.onChange(Number(e.target.value))}
      />
      {props.hint && <p className="hint">{props.hint}</p>}
    </div>
  );
}

function Toggle(props: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  hint?: string;
  testid?: string;
}) {
  const id = useId();
  return (
    <div className="field toggle">
      <label htmlFor={id}>{props.label}</label>
      <input
        id={id}
        type="checkbox"
        role="switch"
        checked={props.checked}
        onChange={(e) => props.onChange(e.target.checked)}
        data-testid={props.testid}
      />
      {props.hint && <p className="hint">{props.hint}</p>}
    </div>
  );
}

/** UI-2: every adjustable parameter. Changes apply immediately. */
export function SettingsPanel() {
  const open = useApp((s) => s.ui.settingsOpen);
  const s = useApp((st) => st.settings);
  if (!open) return null;
  const set = (patch: Partial<Settings>) => updateSettings(patch);

  return (
    <aside className="panel" aria-labelledby="settings-title" data-testid="settings">
      <header className="panel-head">
        <h2 id="settings-title">Settings</h2>
        <button
          className="icon-btn"
          aria-label="Close settings"
          onClick={() => setUi({ settingsOpen: false })}
        >
          <CloseIcon />
        </button>
      </header>

      <fieldset>
        <legend className="label">Visual</legend>
        <div className="field">
          <label htmlFor="mode">Mode</label>
          <select
            id="mode"
            className="device"
            value={s.mode}
            onChange={(e) => set({ mode: e.target.value as ModeId })}
          >
            {MODES.filter((m) => m.available).map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field" role="radiogroup" aria-label="Colour theme">
          <span className="field-label">Colour theme</span>
          <div className="swatches">
            {PALETTES.map((p) => (
              <button
                key={p.id}
                role="radio"
                aria-checked={s.theme === p.id}
                className="swatch"
                onClick={() => set({ theme: p.id })}
                style={{
                  background: `linear-gradient(90deg, ${[0, 0.33, 0.66, 1]
                    .map((t) => {
                      const c = [0, 1, 2].map((i) =>
                        Math.round(
                          255 *
                            Math.min(
                              1,
                              Math.max(
                                0,
                                p.a[i]! + p.b[i]! * Math.cos(2 * Math.PI * (p.c[i]! * t + p.d[i]!)),
                              ),
                            ),
                        ),
                      );
                      return `rgb(${c.join(",")})`;
                    })
                    .join(",")})`,
                }}
              >
                <span className="sr-only">{p.name}</span>
              </button>
            ))}
          </div>
        </div>
        <Slider
          label="Intensity"
          value={s.intensity}
          min={0.2}
          max={1}
          step={0.05}
          format={(v) => `${Math.round(v * 100)}%`}
          onChange={(v) => set({ intensity: v })}
        />
        <Slider
          label="Particle count"
          value={s.particles}
          min={50_000}
          max={1_000_000}
          step={50_000}
          format={(v) => `${Math.round(v / 1000)}k`}
          onChange={(v) => set({ particles: v })}
          hint="Used by particle modes. Adaptive quality lowers it if frames run long."
        />
      </fieldset>

      <fieldset>
        <legend className="label">Analysis</legend>
        <Slider
          label="Sensitivity"
          value={s.sensitivity}
          min={0.5}
          max={2}
          step={0.05}
          format={(v) => `${v.toFixed(2)}×`}
          onChange={(v) => set({ sensitivity: v })}
          hint="Higher reacts to quieter detail and fires more onsets."
        />
        <Slider
          label="Smoothing"
          value={s.smoothing}
          min={0}
          max={1}
          step={0.05}
          format={(v) => `${Math.round(v * 100)}%`}
          onChange={(v) => set({ smoothing: v })}
        />
      </fieldset>

      <fieldset>
        <legend className="label">Effects and comfort</legend>
        <Toggle label="Film grain" checked={s.grain} onChange={(v) => set({ grain: v })} />
        <Toggle
          label="Reduced motion"
          checked={s.reducedMotion}
          onChange={(v) => set({ reducedMotion: v })}
          hint="Lower intensity, no flashes or shockwaves, no camera movement."
          testid="reduced-motion"
        />
      </fieldset>
    </aside>
  );
}
