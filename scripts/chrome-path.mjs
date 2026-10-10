// Prints the path of Playwright's Chromium, for tools that need a Chrome binary (Lighthouse CI).
import { requireWeb } from "./lib/serve.mjs";
console.log(requireWeb("@playwright/test").chromium.executablePath());
