// Builds the web app (with test/capture pages) and serves it with `vite preview` for scripts.
import { spawn, execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
export const web = join(root, "packages/web");
/** Resolve packages installed in the web workspace (Playwright lives there). */
export const requireWeb = createRequire(join(web, "package.json"));

export async function buildAndServe(port = 4179) {
  execFileSync("pnpm", ["exec", "vite", "build"], {
    cwd: web,
    stdio: ["ignore", "ignore", "inherit"],
    env: { ...process.env, RESONANCE_TEST_PAGES: "1" },
  });
  const server = spawn(
    "pnpm",
    ["exec", "vite", "preview", "--port", String(port), "--strictPort"],
    {
      cwd: web,
      stdio: "ignore",
    },
  );
  const url = `http://localhost:${port}`;
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(url)).ok) return { url, close: () => server.kill() };
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  server.kill();
  throw new Error("preview server didn't start");
}

export function launchChromium(extraArgs = []) {
  const { chromium } = requireWeb("@playwright/test");
  return chromium.launch({
    args: [
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
      "--ignore-gpu-blocklist",
      // Fake audio output: silent, and independent of the hardware device's state.
      "--disable-audio-output",
      ...extraArgs,
    ],
  });
}
