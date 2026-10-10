// Small local preferences. Storage can be unavailable (private windows, blocked site data), so
// every access is guarded and the app works without it.

const WARNING_KEY = "resonance.photosensitivity-ack.v1";

export function loadWarningAccepted(): boolean {
  try {
    return localStorage.getItem(WARNING_KEY) === "1";
  } catch {
    return false;
  }
}

export function saveWarningAccepted(): void {
  try {
    localStorage.setItem(WARNING_KEY, "1");
  } catch {
    // Not persisted; the warning shows again next visit.
  }
}
