/// <reference types="vitest/config" />
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { defineConfig, type Plugin } from "vite";

import securityHeaders from "./security-headers.json" with { type: "json" };

// SharedArrayBuffer needs cross-origin isolation (PRD 6.4, ER-3). Production sets the same
// headers through the CloudFront response headers policy in infra/, from the same JSON file.
const { "//": _comment, ...productionHeaders } = securityHeaders;
void _comment;
export const isolationHeaders = {
  "Cross-Origin-Opener-Policy": productionHeaders["Cross-Origin-Opener-Policy"],
  "Cross-Origin-Embedder-Policy": productionHeaders["Cross-Origin-Embedder-Policy"],
  "Cross-Origin-Resource-Policy": productionHeaders["Cross-Origin-Resource-Policy"],
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

/**
 * GitHub Pages can't send response headers, so its build ships a service worker that adds them
 * (src/coi/). Generated from security-headers.json so the header set is defined once.
 */
function coiServiceWorker(): Plugin {
  return {
    name: "resonance-coi-service-worker",
    apply: "build",
    generateBundle() {
      if (!process.env.VITE_COI_SW) return;
      const template = readFileSync(new URL("./src/coi/sw-template.js", import.meta.url), "utf8");
      this.emitFile({
        type: "asset",
        fileName: "coi-sw.js",
        source: template.replace("__HEADERS__", JSON.stringify(productionHeaders, null, 2)),
      });
    },
  };
}

export default defineConfig({
  // "/" locally and on CloudFront; "/resonance/" for GitHub Pages (set by its workflow).
  base: process.env.RESONANCE_BASE ?? "/",
  plugins: [isolationToggle(), coiServiceWorker(), react()],
  server: { headers: isolationHeaders, port: 5173, strictPort: true },
  // The dev server can't use the CSP (HMR relies on inline scripts and eval); preview serves the
  // production build with the full production header set.
  preview: { headers: productionHeaders, port: 4173, strictPort: true },
  worker: { format: "es" },
  build: {
    target: "es2022",
    // Lists every emitted file; the smoke test and bundle budget read it.
    manifest: true,
    sourcemap: true,
    assetsInlineLimit: 0,
    rollupOptions: {
      // Test-only pages (concurrency stress harness) are built only for e2e runs.
      input: process.env.RESONANCE_TEST_PAGES
        ? {
            main: "index.html",
            stress: "stress.html",
            capture: "capture.html",
            bench: "bench.html",
            annotate: "annotate.html",
          }
        : { main: "index.html" },
    },
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
