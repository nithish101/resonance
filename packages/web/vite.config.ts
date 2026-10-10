/// <reference types="vitest/config" />
import react from "@vitejs/plugin-react";
import type { IncomingMessage, ServerResponse } from "node:http";
import { defineConfig, type Plugin } from "vite";

// SharedArrayBuffer needs cross-origin isolation (PRD 6.4, ER-3). Production sets the same
// headers through the CloudFront response headers policy in infra/.
export const isolationHeaders = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
  "Cross-Origin-Resource-Policy": "same-origin",
};

/**
 * Test hook: `?coi=0` serves the document without COOP/COEP so e2e tests can exercise the
 * postMessage fallback transport (ER-3). Only affects the dev and preview servers.
 */
function isolationToggle(): Plugin {
  const strip = (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    if (req.url && /[?&]coi=0\b/.test(req.url)) {
      const setHeader = res.setHeader.bind(res);
      res.setHeader = (name: string, value: number | string | readonly string[]) =>
        /^cross-origin-(opener|embedder)-policy$/i.test(name) ? res : setHeader(name, value);
    }
    next();
  };
  return {
    name: "resonance-isolation-toggle",
    configureServer: (server) => void server.middlewares.use(strip),
    configurePreviewServer: (server) => void server.middlewares.use(strip),
  };
}

export default defineConfig({
  plugins: [isolationToggle(), react()],
  server: { headers: isolationHeaders, port: 5173, strictPort: true },
  preview: { headers: isolationHeaders, port: 4173, strictPort: true },
  worker: { format: "es" },
  build: {
    target: "es2022",
    sourcemap: true,
    assetsInlineLimit: 0,
    rollupOptions: {
      // Test-only pages (concurrency stress harness) are built only for e2e runs.
      input: process.env.RESONANCE_TEST_PAGES
        ? { main: "index.html", stress: "stress.html" }
        : { main: "index.html" },
    },
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
