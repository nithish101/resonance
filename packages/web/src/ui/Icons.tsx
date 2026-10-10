// Minimal 16px stroke icons. Decorative: buttons carry their own accessible names.

const base = {
  className: "icon",
  viewBox: "0 0 16 16",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

export const PlayIcon = () => (
  <svg {...base}>
    <path d="M5 3.5v9l7-4.5z" fill="currentColor" stroke="none" />
  </svg>
);
export const PauseIcon = () => (
  <svg {...base}>
    <path d="M5.5 3.5v9M10.5 3.5v9" strokeWidth={2} />
  </svg>
);
export const LoopIcon = () => (
  <svg {...base}>
    <path d="M3 7V6a2 2 0 0 1 2-2h7.5M10.5 2l2 2-2 2M13 9v1a2 2 0 0 1-2 2H3.5M5.5 14l-2-2 2-2" />
  </svg>
);
export const VolumeIcon = () => (
  <svg {...base}>
    <path d="M2.5 6h2.5l3.5-3v10L5 10H2.5zM11 5.5a3.5 3.5 0 0 1 0 5" />
  </svg>
);
export const MicIcon = () => (
  <svg {...base}>
    <rect x="5.75" y="1.75" width="4.5" height="8" rx="2.25" />
    <path d="M3.5 7.5a4.5 4.5 0 0 0 9 0M8 12v2.5" />
  </svg>
);
export const TabIcon = () => (
  <svg {...base}>
    <rect x="1.75" y="2.75" width="12.5" height="10.5" rx="1.5" />
    <path d="M1.75 5.75h12.5M4 4.25h.01M6 4.25h.01" />
  </svg>
);
export const FileIcon = () => (
  <svg {...base}>
    <path d="M9 1.75H4.25a1.5 1.5 0 0 0-1.5 1.5v9.5a1.5 1.5 0 0 0 1.5 1.5h7.5a1.5 1.5 0 0 0 1.5-1.5V6z" />
    <path d="M9 1.75V6h4.25" />
  </svg>
);
export const CloseIcon = () => (
  <svg {...base}>
    <path d="M4 4l8 8M12 4l-8 8" />
  </svg>
);
export const SlidersIcon = () => (
  <svg {...base}>
    <path d="M2.5 4.5h6M11.5 4.5h2M2.5 11.5h2M7.5 11.5h6" />
    <circle cx="10" cy="4.5" r="1.5" />
    <circle cx="6" cy="11.5" r="1.5" />
  </svg>
);
export const ChartIcon = () => (
  <svg {...base}>
    <path d="M2.5 13.5h11M4.5 11V8M8 11V4.5M11.5 11V6.5" />
  </svg>
);
export const ExpandIcon = () => (
  <svg {...base}>
    <path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10" />
  </svg>
);
