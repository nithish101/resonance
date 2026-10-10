// Every user-facing error state (PRD 5.6 ER-2, ER-5, IN-6, IN-8) with the copy shown for it.

export type ErrorCode =
  | "mic-denied"
  | "mic-not-found"
  | "mic-in-use"
  | "tab-cancelled"
  | "tab-no-audio"
  | "tab-unsupported"
  | "file-too-large"
  | "file-too-long"
  | "unsupported-format"
  | "decode-failed"
  | "wasm-failed"
  | "audio-unavailable";

export interface AppError {
  code: ErrorCode;
  title: string;
  message: string;
  /** True when trying the same action again can succeed. */
  retryable: boolean;
}

export const MAX_FILE_BYTES = 100 * 1024 * 1024;
export const MAX_DURATION_SECS = 15 * 60;

const COPY: Record<ErrorCode, Omit<AppError, "code">> = {
  "mic-denied": {
    title: "Microphone access was blocked",
    message: "Allow microphone access for this site in your browser's address bar, then try again.",
    retryable: true,
  },
  "mic-not-found": {
    title: "No microphone found",
    message: "Connect a microphone or select a different input device.",
    retryable: true,
  },
  "mic-in-use": {
    title: "The microphone is busy",
    message: "Another app is using the input device. Close it or pick a different device.",
    retryable: true,
  },
  "tab-cancelled": {
    title: "Sharing was cancelled",
    message: "Pick the tab that's playing music in the share dialog to visualize it.",
    retryable: true,
  },
  "tab-no-audio": {
    title: "That tab was shared without its audio",
    message:
      'In the share dialog, pick the tab and turn on "Share tab audio" (or "Share system audio" for a whole screen).',
    retryable: true,
  },
  "tab-unsupported": {
    title: "This browser can't share tab audio",
    message:
      "Tab and system audio capture works in Chrome, Edge, and other Chromium browsers on desktop. Here you can use the microphone, or a loopback input device.",
    retryable: false,
  },
  "file-too-large": {
    title: "That file is too large",
    message: "Files up to 100 MB are supported.",
    retryable: false,
  },
  "file-too-long": {
    title: "That track is too long",
    message: "Tracks up to 15 minutes are supported.",
    retryable: false,
  },
  "unsupported-format": {
    title: "Unsupported audio format",
    message: "Try MP3, WAV, OGG, or M4A/AAC. FLAC works where your browser can decode it.",
    retryable: false,
  },
  "decode-failed": {
    title: "This file couldn't be decoded",
    message: "The file may be damaged or use an unusual codec. Try a different file.",
    retryable: false,
  },
  "wasm-failed": {
    title: "The audio engine failed to load",
    message:
      "Resonance's analysis engine (WebAssembly) didn't start. Reload the page; if it keeps happening, your browser may block WebAssembly.",
    retryable: true,
  },
  "audio-unavailable": {
    title: "Audio isn't available",
    message: "This browser doesn't support the Web Audio features Resonance needs.",
    retryable: false,
  },
};

export function appError(code: ErrorCode, detail?: string): AppError {
  const c = COPY[code];
  return { code, ...c, message: detail ? `${c.message} (${detail})` : c.message };
}

export class AppErrorException extends Error {
  constructor(readonly error: AppError) {
    super(error.title);
  }
}

export function toAppError(err: unknown, fallback: ErrorCode): AppError {
  if (err instanceof AppErrorException) return err.error;
  return appError(fallback, err instanceof Error ? err.message : String(err));
}

/** Maps getUserMedia failures (DOMException names) to error states. */
export function micError(err: unknown): AppError {
  const name = err instanceof DOMException ? err.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") return appError("mic-denied");
  if (name === "NotFoundError" || name === "OverconstrainedError") return appError("mic-not-found");
  if (name === "NotReadableError" || name === "AbortError") return appError("mic-in-use");
  return toAppError(err, "mic-not-found");
}

/** Maps getDisplayMedia failures to error states. */
export function tabError(err: unknown): AppError {
  const name = err instanceof DOMException ? err.name : "";
  if (name === "NotAllowedError" || name === "AbortError") return appError("tab-cancelled");
  if (name === "TypeError" || name === "NotSupportedError") return appError("tab-unsupported");
  return toAppError(err, "tab-cancelled");
}
