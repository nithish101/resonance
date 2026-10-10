// Bundle-size budget (PRD 8): JS + CSS + WASM, gzipped, must stay under 350 KB. Measures the
// production build (no test pages). Both WASM variants ship but a browser loads one, so only the
// larger counts. Writes a summary line for docs/benchmarks.md via --json.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { root } from "./lib/serve.mjs";

const BUDGET = 350 * 1024;
const dir = join(root, "packages/web/dist/assets");
const files = readdirSync(dir).filter((f) => /\.(js|css|wasm)$/.test(f));
if (files.some((f) => /^(stress|capture)/.test(f))) {
  throw new Error(
    "dist contains test pages; run a production build (without RESONANCE_TEST_PAGES)",
  );
}
const gz = (f) => gzipSync(readFileSync(join(dir, f)), { level: 9 }).length;
let js = 0;
let css = 0;
const wasm = [];
for (const f of files) {
  if (f.endsWith(".js")) js += gz(f);
  else if (f.endsWith(".css")) css += gz(f);
  else wasm.push(gz(f));
}
const total = js + css + Math.max(0, ...wasm);
const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
const summary = { js, css, wasm: Math.max(0, ...wasm), total, budget: BUDGET };
if (process.argv.includes("--json")) console.log(JSON.stringify(summary));
else {
  console.log(
    `JS ${kb(js)} + CSS ${kb(css)} + WASM ${kb(summary.wasm)} = ${kb(total)} gzipped (budget ${kb(BUDGET)})`,
  );
}
if (total > BUDGET) {
  console.error(`over budget by ${kb(total - BUDGET)}`);
  process.exit(1);
}
