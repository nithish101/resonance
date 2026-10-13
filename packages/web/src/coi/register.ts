// Cross-origin isolation for static hosts (GitHub Pages builds only; see sw-template.js).
// Registers the header-adding service worker and reloads once when it takes control. If the
// page still isn't isolated after that (service workers blocked, e.g. some private windows),
// Resonance runs on its postMessage fallback (ER-3) instead of looping.

const RELOAD_KEY = "resonance.coi-reloaded";

export async function ensureIsolation(): Promise<void> {
  if (!import.meta.env.VITE_COI_SW) return;
  if (globalThis.crossOriginIsolated || !("serviceWorker" in navigator)) return;
  try {
    if (sessionStorage.getItem(RELOAD_KEY) === "1") return; // tried once; run without isolation
  } catch {
    return; // storage unavailable: don't risk a reload loop
  }
  try {
    const base = import.meta.env.BASE_URL;
    await navigator.serviceWorker.register(`${base}coi-sw.js`, { scope: base });
    await navigator.serviceWorker.ready;
    sessionStorage.setItem(RELOAD_KEY, "1");
    location.reload();
    // Keep the old page from rendering while the reload happens.
    await new Promise(() => {});
  } catch {
    // Registration failed: fall back to postMessage.
  }
}
