import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invoke(...args),
  isTauri: () => true,
}));

import { lookupLyrics } from "./lrclib";
import type { Track } from "../domain/types";
import { parseLyrics } from "../domain/lyrics";

const base: Track = {
  id: "t1",
  title: "Song",
  artist: "Unknown Artist",
  album: "Local collection",
  duration: 200,
} as Track;

describe("lookupLyrics artist placeholder", () => {
  it('refreshes a cached provider remix for a studio track even when durations match',async()=>{
    const doc=parseLyrics('[00:01]Old fixture');doc.source={provider:'lrclib',recordId:1,title:'Song (Remix)',artist:'Artist',duration:200};
    invoke.mockResolvedValueOnce({kind:'plain',text:'New fixture'});
    const result=await lookupLyrics({...base,id:'version-fixture'},doc);
    expect(result.status).toBe('found');if(result.status==='found')expect(result.doc.raw).toBe('New fixture');
    expect(doc.raw).toBe('[00:01]Old fixture');
  });
  it("connects provider word markers to the rendered document without retiming variants", async () => {
    invoke.mockResolvedValueOnce({kind: "synced", lrc: "[00:01]<00:01>Hello <00:02>உலகம்<00:03>", matched: {provider: "lrc.red", id: "IND292218474", title: "Song", artist: "Artist", duration: 200}});
    const result = await lookupLyrics({...base, id: "word-fixture"});
    expect(result.status).toBe("found");
    if (result.status === "found") {
      expect(result.doc.lines[0].words).toEqual([{time: 1000, end: 2000, text: "Hello "}, {time: 2000, end: 3000, text: "உலகம்"}]);
      expect(result.doc.lines[0].text).toBe("Hello உலகம்");
    }
  });
  it("preserves fallback attribution, timing and cache identity", async () => {
    invoke.mockResolvedValueOnce({ kind: "synced", lrc: "[00:01]வணக்கம்", matched: {
      provider: "lrc.red", id: "IND292218474", title: "Song", artist: "Artist", album: "Album", duration: 200,
    } });
    const result = await lookupLyrics(base);
    expect(result.status).toBe("found");
    if (result.status === "found") {
      expect(result.doc.source?.provider).toBe("lrc.red");
      expect(result.doc.source?.recordId).toBe("IND292218474");
      expect(result.doc.fileName).toBe("Song · lrc.red");
      expect(result.doc.lines[0].time).toBe(1000);
      expect(result.doc.lines[0].text).toBe("வணக்கம்");
    }
  });
  beforeEach(() => {
    invoke.mockReset();
    invoke.mockResolvedValue({ kind: "not_found" });
  });

  it.each(["Unknown Artist", "Unknown artist", "  unknown ARTIST "])(
    "sends an empty artist for placeholder %j",
    async (artist) => {
      await lookupLyrics({ ...base, artist });
      expect(invoke).toHaveBeenCalledWith(
        "fetch_lyrics",
        expect.objectContaining({ artist: "" }),
      );
    },
  );

  it("keeps a real artist name", async () => {
    await lookupLyrics({ ...base, artist: "Radiohead" });
    expect(invoke).toHaveBeenCalledWith(
      "fetch_lyrics",
      expect.objectContaining({ artist: "Radiohead" }),
    );
  });

  it.each(["YouTube", "Local collection", "Unknown album"])(
    "omits synthetic album %s",
    async (album) => {
      await lookupLyrics({ ...base, album });
      expect(invoke).toHaveBeenCalledWith(
        "fetch_lyrics",
        expect.objectContaining({ album: "" }),
      );
    },
  );

  it("shares concurrent requests for the same recording", async () => {
    let resolve!: (value: unknown) => void;
    invoke.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const first = lookupLyrics(base),
      second = lookupLyrics({ ...base });
    expect(invoke).toHaveBeenCalledTimes(1);
    resolve({ kind: "synced", lrc: "[00:01.00]Original test line" });
    const results = await Promise.all([first, second]);
    expect(results[0]).toEqual(results[1]);
    expect(results[0].status).toBe("found");
  });

  it("keeps temporary failures retryable", async () => {
    invoke.mockRejectedValueOnce("HTTP 503");
    expect(await lookupLyrics(base)).toEqual({
      status: "error",
      message: "HTTP 503",
    });
    await lookupLyrics(base);
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it("uses supplied cached documents without a request", async () => {
    const doc = parseLyrics("[00:01]Original fixture", "test.lrc");
    expect(await lookupLyrics(base, doc)).toEqual({ status: "found", doc });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("turns instrumental results into persistable documents", async () => {
    invoke.mockResolvedValueOnce({ kind: "instrumental" });
    const result = await lookupLyrics(base);
    expect(result.status).toBe("found");
    if (result.status === "found") expect(result.doc.instrumental).toBe(true);
  });
  it("automatically returns readable unsynced lyrics with provenance", async () => {
    invoke.mockResolvedValueOnce({
      kind: "plain",
      text: "पहली पंक्ति\nदूसरी पंक्ति",
      matched: {
        id: 35089772,
        title: "Aarzu",
        artist: "Noor",
        album: "Fixture",
        duration: 188,
      },
    });
    const result = await lookupLyrics({
      ...base,
      title: "Aarzu",
      artist: "Noor, Khan, Madhurxo",
      duration: 226,
    });
    expect(result.status).toBe("found");
    if (result.status === "found") {
      expect(result.doc.timingMode).toBe("unsynced");
      expect(result.doc.lines.every((line) => line.time === null)).toBe(true);
      expect(result.doc.source?.recordId).toBe(35089772);
      expect(result.doc.warnings).toHaveLength(0);
    }
    expect(invoke).toHaveBeenCalledTimes(1);
  });
  it("keeps automatically matched Tamil timestamps only for compatible audio duration", async () => {
    invoke.mockResolvedValueOnce({
      kind: "synced",
      lrc: "[00:01.00]முதல் வரி",
      matched: {
        id: 38509313,
        title: "Karuppa Kooda Va",
        artist: "Sai Abhyankkar",
        album: "Karuppu",
        duration: 258,
      },
    });
    const result = await lookupLyrics({ ...base, duration: 258 });
    expect(result.status).toBe("found");
    if (result.status === "found") {
      expect(result.doc.lines[0].text).toBe("முதல் வரி");
      expect(result.doc.lines[0].time).toBe(1000);
      expect(result.doc.timingMode).toBe("synced");
    }
  });
  it("corrects previously cached duration mismatches without a manual step", async () => {
    const doc = parseLyrics("[00:01]Original fixture", "old.lrc");
    doc.source = {
      provider: "lrclib",
      recordId: 1,
      title: "Song",
      artist: "Artist",
      duration: 188,
    };
    doc.warnings = [
      "The selected lyric recording is 188 seconds; this audio is 226 seconds. Adjust timing if needed.",
    ];
    const result = await lookupLyrics({ ...base, duration: 226 }, doc);
    expect(result.status).toBe("found");
    if (result.status === "found") {
      expect(result.doc.timingMode).toBe("unsynced");
      expect(result.doc.warnings).toHaveLength(0);
    }
    expect(invoke).not.toHaveBeenCalled();
  });
});


it("looks up the song title rather than video labels or an unverified uploader", async () => {
  const track = { ...base, title: "Full Video: Samayama Song | Hi Nanna | Nani", artist: "T-Series Telugu", source: { providerId: "youtube", sourceId: "abcdefghijk", attribution: "T-Series Telugu", pageUrl: "https://www.youtube.com/watch?v=abcdefghijk", license: "", licenseUrl: "" } };
  invoke.mockResolvedValue({ kind: "not_found" });
  await lookupLyrics(track);
  expect(invoke).toHaveBeenCalledWith("fetch_lyrics", expect.objectContaining({ title: "Samayama", artist: "" }));
});
