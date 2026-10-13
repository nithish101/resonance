// "Listen along": popular house tracks on YouTube that Resonance can visualize through tab
// capture (IN-4). Resonance never loads YouTube itself. A link opens the official upload in a
// new tab, and the user then shares that tab's audio.
//
// Every entry was checked against YouTube's oEmbed endpoint on 2026-10-12. Each is an upload on
// the artist's official channel, their VEVO channel, or YouTube's auto-generated artist
// ("Topic") channel; `channel` records which.

export interface ListenAlongTrack {
  artist: string;
  title: string;
  videoId: string;
  channel: string;
}

export const LISTEN_ALONG: readonly ListenAlongTrack[] = [
  {
    artist: "John Summit & Hayla",
    title: "Where You Are",
    videoId: "5BqjhUmldDc",
    channel: "John Summit",
  },
  {
    artist: "John Summit & Hayla",
    title: "Shiver",
    videoId: "LlTkluUkbLk",
    channel: "John Summit",
  },
  { artist: "John Summit", title: "La Danza", videoId: "9Mv4ogXpjCM", channel: "John Summit" },
  {
    artist: "Fred again..",
    title: "Delilah (pull me out of this)",
    videoId: "Cl6Rz1Uvi2M",
    channel: "Fred again . .",
  },
  {
    artist: "Fred again.. & The Blessed Madonna",
    title: "Marea (We've Lost Dancing)",
    videoId: "l4UkYBr1NnA",
    channel: "Fred again . .",
  },
  { artist: "Fred again..", title: "Jungle", videoId: "zBp7KBmgsdU", channel: "Fred again . ." },
  {
    artist: "Fred again.. x Swedish House Mafia",
    title: "Turn On The Lights again.. (feat. Future)",
    videoId: "Q22MCFC0CP0",
    channel: "Fred again . .",
  },
  {
    artist: "Skrillex, Fred again.. & Flowdan",
    title: "Rumble",
    videoId: "7z25ZZ3DHds",
    channel: "Skrillex",
  },
  {
    artist: "KETTAMA",
    title: "It Gets Better (Forever Mix)",
    videoId: "4wUv--haykg",
    channel: "KETTAMA",
  },
  {
    artist: "KETTAMA & Interplanetary Criminal",
    title: "Yosemite",
    videoId: "ZDJdynqu-i4",
    channel: "KETTAMA",
  },
  { artist: "KETTAMA", title: "Fly Away XTC", videoId: "Sv2u-IQExt4", channel: "KETTAMA - Topic" },
  { artist: "FISHER", title: "Losing It", videoId: "u31thuMehjM", channel: "FISHER" },
  { artist: "Dom Dolla", title: "Saving Up", videoId: "5sgc8RJezrE", channel: "DomDollaVEVO" },
  { artist: "Mau P", title: "Drugs From Amsterdam", videoId: "juuIhW8V1Xw", channel: "Mau P" },
  {
    artist: "Chris Lake, Sammy Virji & Nathan Nicholson",
    title: "Summertime Blues",
    videoId: "LmFfiXI0P84",
    channel: "Chris Lake",
  },
];

export const youtubeUrl = (videoId: string) => `https://www.youtube.com/watch?v=${videoId}`;

/**
 * Turns what the user typed into a YouTube URL: a youtube.com / youtu.be / music.youtube.com
 * link opens as given (normalized to a watch URL); anything else becomes a YouTube search.
 */
export function youtubeTarget(input: string): string | null {
  const q = input.trim();
  if (!q) return null;
  try {
    const u = new URL(q);
    const host = u.hostname.replace(/^www\./, "");
    if (host === "youtu.be") {
      const id = u.pathname.slice(1).split("/")[0];
      return id ? youtubeUrl(id) : null;
    }
    if (host === "youtube.com" || host === "m.youtube.com" || host === "music.youtube.com") {
      const id = u.searchParams.get("v");
      if (id) return host === "music.youtube.com" ? u.toString() : youtubeUrl(id);
      return u.toString();
    }
    return null; // some other site: not ours to open
  } catch {
    return `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`;
  }
}
