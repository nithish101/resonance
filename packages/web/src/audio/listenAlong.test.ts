import { describe, expect, it } from "vitest";
import { LISTEN_ALONG, youtubeTarget } from "./listenAlong";

describe("listen along", () => {
  it("has unique, well-formed video ids", () => {
    const ids = LISTEN_ALONG.map((t) => t.videoId);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[A-Za-z0-9_-]{11}$/);
  });

  it("normalizes YouTube links and searches for anything else", () => {
    expect(youtubeTarget("https://youtu.be/Cl6Rz1Uvi2M?si=x")).toBe(
      "https://www.youtube.com/watch?v=Cl6Rz1Uvi2M",
    );
    expect(youtubeTarget("https://www.youtube.com/watch?v=Cl6Rz1Uvi2M&t=30")).toBe(
      "https://www.youtube.com/watch?v=Cl6Rz1Uvi2M",
    );
    expect(youtubeTarget("https://music.youtube.com/watch?v=Cl6Rz1Uvi2M")).toBe(
      "https://music.youtube.com/watch?v=Cl6Rz1Uvi2M",
    );
    expect(youtubeTarget("john summit human")).toBe(
      "https://www.youtube.com/results?search_query=john%20summit%20human",
    );
    expect(youtubeTarget("https://example.com/song")).toBeNull();
    expect(youtubeTarget("   ")).toBeNull();
  });
});
