// Generated into dist/coi-sw.js for static hosts that can't send headers (GitHub Pages).
//
// SharedArrayBuffer needs the page to be cross-origin isolated, which needs COOP/COEP response
// headers. This service worker adds them (plus the CSP and the rest of
// packages/web/security-headers.json) to every same-origin response it serves. The page reloads
// once after the worker first takes control, and from then on it's isolated.

const HEADERS = __HEADERS__;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (event) => {
  const request = event.request;
  // Chrome quirk: these requests can't be re-fetched from a worker.
  if (request.cache === "only-if-cached" && request.mode !== "same-origin") return;
  // Only our own files: cross-origin responses would be blocked by COEP anyway.
  if (new URL(request.url).origin !== location.origin) return;
  event.respondWith(
    fetch(request).then((response) => {
      if (response.status === 0) return response; // opaque
      const headers = new Headers(response.headers);
      for (const [name, value] of Object.entries(HEADERS)) headers.set(name, value);
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    }),
  );
});
