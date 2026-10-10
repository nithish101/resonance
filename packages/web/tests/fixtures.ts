import { test as base } from "@playwright/test";

/**
 * Most tests start past the photosensitivity notice (AX-1). Tests that exercise the notice use
 * `test.use({ acceptWarning: false })`. Applied to the context so every page in a test (e.g. the
 * second tab in the tab-capture test) gets it.
 */
export const test = base.extend<{ acceptWarning: boolean }>({
  acceptWarning: [true, { option: true }],
  context: async ({ context, acceptWarning }, use) => {
    if (acceptWarning) {
      await context.addInitScript(() => {
        try {
          localStorage.setItem("resonance.photosensitivity-ack.v1", "1");
        } catch {
          // ignore
        }
      });
    }
    await use(context);
  },
});

export { expect } from "@playwright/test";
