import { seek, setLoop, setVolume, stopSource, togglePlay } from "../app/controller";
import { useApp } from "../app/store";
import { formatTime } from "./format";
import { CloseIcon, LoopIcon, PauseIcon, PlayIcon, VolumeIcon } from "./Icons";

export function Transport() {
  const source = useApp((s) => s.source);
  const pb = useApp((s) => s.playback);
  if (!source) return null;
  const live = source.kind === "mic" || source.kind === "tab";

  return (
    <div className="transport" role="group" aria-label="Playback">
      {live ? (
        <span className="live-pill">Live</span>
      ) : (
        <button
          className="icon-btn"
          onClick={togglePlay}
          aria-label={pb.playing ? "Pause" : "Play"}
          data-testid="play-toggle"
        >
          {pb.playing ? <PauseIcon /> : <PlayIcon />}
        </button>
      )}

      <div className="now">
        <span className="title" data-testid="now-playing">
          {source.label}
        </span>
        {!live && (
          <div className="seek">
            <span className="num">{formatTime(pb.time)}</span>
            <input
              type="range"
              min={0}
              max={pb.duration || 0}
              step={0.1}
              value={Math.min(pb.time, pb.duration || 0)}
              onChange={(e) => seek(Number(e.target.value))}
              aria-label="Seek"
              aria-valuetext={`${formatTime(pb.time)} of ${formatTime(pb.duration)}`}
            />
            <span className="num">{formatTime(pb.duration)}</span>
          </div>
        )}
      </div>

      <div className="row">
        {!live && (
          <>
            <button
              className="icon-btn"
              aria-label="Loop"
              aria-pressed={pb.loop}
              onClick={() => setLoop(!pb.loop)}
            >
              <LoopIcon />
            </button>
            <VolumeIcon />
            <input
              className="volume"
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={pb.volume}
              onChange={(e) => setVolume(Number(e.target.value))}
              aria-label="Volume"
            />
          </>
        )}
        <button
          className="icon-btn"
          onClick={stopSource}
          aria-label="Stop and choose another source"
        >
          <CloseIcon />
        </button>
      </div>
    </div>
  );
}
