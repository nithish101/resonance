// Bundled demo tracks (IN-2). Licences and sources are in ATTRIBUTION.md.

export interface Track {
  id: string;
  title: string;
  artist: string;
  url: string;
  license: string;
  source: string;
}

export const TRACKS: readonly Track[] = [
  {
    id: "deep-house-soul",
    title: "Deep House Soul",
    artist: "Play House",
    url: "/audio/tracks/deep-house-soul.mp3",
    license: "CC0 1.0",
    source: "https://freemusicarchive.org/music/play-house/single/deep-house-soul/",
  },
  {
    id: "morning-assembly",
    title: "Morning Assembly",
    artist: "Play House",
    url: "/audio/tracks/morning-assembly.mp3",
    license: "CC0 1.0",
    source: "https://freemusicarchive.org/music/play-house/single/morning-assembly/",
  },
  {
    id: "play-house-free",
    title: "Play House (FREE)",
    artist: "Play House",
    url: "/audio/tracks/play-house-free.mp3",
    license: "CC0 1.0",
    source: "https://freemusicarchive.org/music/play-house/single/play-house-free/",
  },
];

/** The camera calibration track (docs/latency.md): a click every 0.5 s. */
export const CALIBRATION_TRACK: Track = {
  id: "calibration",
  title: "Calibration clicks (120 BPM)",
  artist: "Resonance fixture",
  url: "/audio/fixtures/click-120.wav",
  license: "MIT",
  source: "crates/fixtures",
};
