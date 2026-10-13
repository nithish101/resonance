import { expect, test } from "./fixtures";
import { state } from "./helpers";

test.describe("listen along on YouTube", () => {
  test.beforeEach(async ({ context }) => {
    // Never contact YouTube from tests: answer locally and just check which URL was opened.
    await context.route(/youtube\.com/, (route) =>
      route.fulfill({ contentType: "text/html", body: "<title>stub</title>" }),
    );
  });

  test("a track opens its official upload in a new tab, then the tab can be captured", async ({
    page,
    context,
  }) => {
    await page.addInitScript(() => {
      navigator.mediaDevices.getDisplayMedia = async () => {
        const ctx = new AudioContext();
        const osc = ctx.createOscillator();
        const dest = ctx.createMediaStreamDestination();
        osc.connect(dest);
        osc.start();
        return dest.stream;
      };
    });
    await page.goto("/");
    const list = page.getByTestId("listen-along");
    await expect(list.getByRole("button", { name: /Delilah/ })).toBeVisible();
    const popup = context.waitForEvent("page");
    await page.getByTestId("yt-Cl6Rz1Uvi2M").click();
    expect((await popup).url()).toBe("https://www.youtube.com/watch?v=Cl6Rz1Uvi2M");
    await expect(list.getByRole("status")).toContainText("Delilah (pull me out of this)");
    await page.getByTestId("capture-youtube").click();
    await expect(page.getByTestId("now-playing")).toHaveText(
      "Delilah (pull me out of this) by Fred again.. (YouTube)",
    );
    expect((await state(page)).source?.kind).toBe("tab");
  });

  test("the box opens pasted links and searches for anything else", async ({ page, context }) => {
    await page.goto("/");
    let popup = context.waitForEvent("page");
    await page.getByTestId("yt-query").fill("https://youtu.be/5BqjhUmldDc?si=abc");
    await page.getByRole("button", { name: "Open", exact: true }).click();
    expect((await popup).url()).toBe("https://www.youtube.com/watch?v=5BqjhUmldDc");
    await page.getByRole("button", { name: "Back to the list" }).click();
    popup = context.waitForEvent("page");
    await page.getByTestId("yt-query").fill("kettama it gets better");
    await page.getByRole("button", { name: "Open", exact: true }).click();
    expect((await popup).url()).toBe(
      "https://www.youtube.com/results?search_query=kettama%20it%20gets%20better",
    );
  });
});

test("the default theme follows the tempo", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("s");
  await expect(page.getByRole("radio", { name: "Follow the tempo" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
});
