import { useEffect, useRef, useState } from "react";
import { AudioEngine } from "../audio/engine";
import { LISTEN_ALONG, youtubeTarget, youtubeUrl } from "../audio/listenAlong";
import { CALIBRATION_TRACK, TRACKS } from "../audio/tracks";
import { flags, playFile, playTrack, startMic, startTab } from "../app/controller";
import { useApp } from "../app/store";
import { FileIcon, MicIcon, TabIcon } from "./Icons";

const ACCEPT = "audio/*,.mp3,.wav,.ogg,.oga,.opus,.m4a,.aac,.flac,.webm";

/** The start prompt (ER-1): every option here is a user gesture that can start audio. */
export function SourcePicker() {
  const caps = useApp((s) => s.caps);
  const busy = useApp((s) => s.busy);
  const fileInput = useRef<HTMLInputElement>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState("");

  useEffect(() => {
    if (!caps?.mic) return;
    const refresh = () =>
      AudioEngine.inputDevices()
        .then(setDevices)
        .catch(() => setDevices([]));
    void refresh();
    navigator.mediaDevices.addEventListener("devicechange", refresh);
    return () => navigator.mediaDevices.removeEventListener("devicechange", refresh);
  }, [caps?.mic]);

  const labelled = devices.filter((d) => d.label);
  // Listen along: the YouTube tab we just opened, waiting for the user to share it.
  const [opened, setOpened] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const openYoutube = (url: string, label: string) => {
    window.open(url, "_blank", "noopener");
    setOpened(label);
  };

  return (
    <div className="picker" role="dialog" aria-labelledby="picker-title">
      <h1 id="picker-title">Pick something to listen to</h1>
      <p className="lede">Audio is analysed in your browser and never leaves it.</p>

      <section aria-labelledby="tracks-label">
        <p className="label" id="tracks-label">
          Bundled tracks
        </p>
        <ul className="tracks">
          {(flags.calibrate ? [CALIBRATION_TRACK] : TRACKS).map((t) => (
            <li key={t.id}>
              <button
                className="track"
                disabled={busy}
                onClick={() => void playTrack(t.id)}
                data-testid={`track-${t.id}`}
              >
                <span>
                  <span className="title">{t.title}</span>
                  <span className="artist">{t.artist}</span>
                </span>
                <span className="meta">{t.license}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="yt-label" data-testid="listen-along">
        <p className="label" id="yt-label">
          House on YouTube · {LISTEN_ALONG.length} tracks
        </p>
        {opened ? (
          <div className="step" role="status">
            <p>
              <strong>{opened}</strong> is open in a new tab. Start it playing, come back here, and
              share that tab:{" "}
              {caps?.tabAudio
                ? 'pick it under "Chrome Tab" and turn on "Share tab audio".'
                : "this browser can't capture tabs, so route it through a loopback input and pick that as the microphone."}
            </p>
            <div className="row">
              {caps?.tabAudio && (
                <button
                  className="btn primary"
                  onClick={() => void startTab(`${opened} (YouTube)`)}
                  data-testid="capture-youtube"
                >
                  <TabIcon /> Capture that tab
                </button>
              )}
              <button className="btn" onClick={() => setOpened(null)}>
                Back to the list
              </button>
            </div>
          </div>
        ) : (
          <>
            <ul className="tracks scroll">
              {LISTEN_ALONG.map((t) => (
                <li key={t.videoId}>
                  <button
                    className="track"
                    onClick={() => openYoutube(youtubeUrl(t.videoId), `${t.title} by ${t.artist}`)}
                    data-testid={`yt-${t.videoId}`}
                  >
                    <span>
                      <span className="title">{t.title}</span>
                      <span className="artist">{t.artist}</span>
                    </span>
                    <span className="meta">YouTube ↗</span>
                  </button>
                </li>
              ))}
            </ul>
            <form
              className="row yt-form"
              onSubmit={(e) => {
                e.preventDefault();
                const url = youtubeTarget(query);
                if (url)
                  openYoutube(
                    url,
                    query.trim().startsWith("http") ? "Your YouTube link" : `"${query.trim()}"`,
                  );
              }}
            >
              <input
                className="device"
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Paste a YouTube link or search"
                aria-label="YouTube link or search"
                data-testid="yt-query"
              />
              <button className="btn" type="submit" disabled={!youtubeTarget(query)}>
                Open
              </button>
            </form>
            <p className="hint">
              Opens the official upload in a new tab; Resonance never loads YouTube itself, it only
              listens to the tab you share.
            </p>
          </>
        )}
      </section>

      <section aria-labelledby="own-label">
        <p className="label" id="own-label">
          Your own audio
        </p>
        <div className="row">
          <button className="btn" disabled={busy} onClick={() => fileInput.current?.click()}>
            <FileIcon /> Open a file
          </button>
          <input
            ref={fileInput}
            type="file"
            accept={ACCEPT}
            hidden
            data-testid="file-input"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void playFile(f);
              e.target.value = "";
            }}
          />
          {caps?.tabAudio && (
            <button
              className="btn"
              disabled={busy}
              onClick={() => void startTab()}
              data-testid="tab-button"
            >
              <TabIcon /> Listen to another tab
            </button>
          )}
          {caps?.mic && (
            <button
              className="btn"
              disabled={busy}
              onClick={() => {
                const d = labelled.find((x) => x.deviceId === deviceId);
                void startMic(deviceId || undefined, d?.label || "Microphone").then(() =>
                  AudioEngine.inputDevices().then(setDevices),
                );
              }}
              data-testid="mic-button"
            >
              <MicIcon /> Microphone
            </button>
          )}
          {labelled.length > 1 && (
            <select
              className="device"
              aria-label="Input device"
              value={deviceId}
              onChange={(e) => setDeviceId(e.target.value)}
            >
              <option value="">Default input</option>
              {labelled.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label}
                </option>
              ))}
            </select>
          )}
        </div>
        <p className="hint">
          {caps?.tabAudio
            ? 'Playing music in another tab, like YouTube Music? Choose "Listen to another tab", pick it, and turn on "Share tab audio".'
            : "This browser can't capture other tabs. To visualize what your computer is playing, route it through a loopback input (BlackHole on macOS, VB-Cable on Windows) and pick it as the microphone."}{" "}
          Or drop a file anywhere.
        </p>
      </section>
    </div>
  );
}
