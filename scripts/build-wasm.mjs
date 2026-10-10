// Builds the DSP crate to WebAssembly twice: once with SIMD128 enabled and once scalar.
// The DSP worker picks the SIMD build when the browser validates a SIMD module (PRD 7).
import { execFileSync } from "node:child_process";
import { mkdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outBase = join(root, "packages/web/src/wasm");
const dev = process.argv.includes("--dev");

const variants = [
  { name: "simd", rustflags: "-C target-feature=+simd128" },
  { name: "scalar", rustflags: "" },
];

mkdirSync(outBase, { recursive: true });
for (const v of variants) {
  const outDir = join(outBase, `pkg-${v.name}`);
  execFileSync(
    "wasm-pack",
    [
      "build",
      "crates/dsp-wasm",
      "--target",
      "web",
      dev ? "--dev" : "--release",
      "--no-pack",
      "--out-dir",
      outDir,
      "--out-name",
      "dsp",
    ],
    {
      cwd: root,
      stdio: ["ignore", "inherit", "inherit"],
      env: {
        ...process.env,
        RUSTFLAGS: v.rustflags,
        // Separate target dirs so switching RUSTFLAGS doesn't invalidate the other build.
        CARGO_TARGET_DIR: join(root, "target", `wasm-${v.name}`),
      },
    },
  );
  const size = statSync(join(outDir, "dsp_bg.wasm")).size;
  console.log(`wasm ${v.name}: ${(size / 1024).toFixed(1)} KiB`);
}
