import { describe, expect, it } from "vitest";
import { aggregateListening, historyArtwork, historyTrack, ListeningTracker, localDay, rangeStart, type ListeningRecord } from "./listening";
import type { Playback } from "../player/controller";
import type { Track } from "./types";

const track: Track = { id: "youtube:abcdefghijk", title: "Song", artist: "A, B", album: "Album", duration: 180, format: "YouTube", fileName: "Song", missing: false };
const state = (time: number, status: Playback["status"] = "playing", seekVersion = 0, playbackId = "one"): Playback => ({ time, status, duration: 180, error: null, trackId: track.id, playbackId, seekVersion });
const wall = new Date(2026, 9, 19, 12).getTime();
function fixture() {
  const writes: ListeningRecord[] = [];
  const tracker = new ListeningTracker(record => writes.push(record));
  const sample = (seconds: number, time = seconds, status: Playback["status"] = "playing", seek = 0, instance = "one", enabled = true) => tracker.sample(state(time, status, seek, instance), track, enabled, seconds * 1000, wall + seconds * 1000);
  return { tracker, writes, sample };
}
describe("real listening accounting", () => {
  it('keeps an identified artist recording available when legacy rows supply the artwork', () => {
    const { tracker, sample } = fixture();
    for (let second = 0; second <= 20; second++) sample(second);
    const legacy = { ...tracker.record!, id: 'legacy', artworkUrl: 'https://c.saavncdn.com/cover.jpg', metadataSourceId: null };
    const identified = { ...tracker.record!, id: 'identified', artworkUrl: null, metadataSourceId: 'itunes:42' };
    for (const records of [[legacy, identified], [identified, legacy]]) {
      const stats = aggregateListening(records, 'all', wall + 30000);
      expect(stats.artists[0].record.metadataSourceId).toBe('itunes:42');
      expect(stats.totalMs).toBe(legacy.listenedMs + identified.listenedMs);
    }
  });
  it('recovers ranking artwork from later records without changing listening totals', () => {
    const { tracker, sample } = fixture();
    for (let second = 0; second <= 20; second++) sample(second);
    const original = tracker.record!;
    const missing = { ...original, id: 'missing', artworkUrl: null };
    const covered = { ...original, id: 'covered', artworkUrl: 'https://c.saavncdn.com/album.jpg' };
    for (const rows of [[missing, covered], [covered, missing]]) {
      const stats = aggregateListening(rows, 'all', wall + 30000);
      expect(stats.albums[0].artworkUrl).toBe(covered.artworkUrl);
      expect(stats.tracks[0].artworkUrl).toBe(covered.artworkUrl);
      expect(stats.totalMs).toBe(original.listenedMs * 2);
    }
  });
  it("keeps catalogue covers and recovers old missing artwork only from verified video identity", () => {
    const { tracker, sample } = fixture();
    sample(0);
    const record = { ...tracker.record!, providerId: "youtube", sourceId: "abcdefghijk" };
    expect(historyArtwork(record)).toBe("https://i.ytimg.com/vi/abcdefghijk/mqdefault.jpg");
    expect(historyTrack(record).artworkUrl).toBe(historyArtwork(record));
    const cover = "https://c.saavncdn.com/517/cover.jpg";
    expect(historyArtwork({ ...record, artworkUrl: cover })).toBe(cover);
    expect(historyArtwork({ ...record, sourceId: "wrong" })).toBeNull();
    expect(historyArtwork({ ...record, trackId: "youtube:other-id000" })).toBeNull();
    expect(historyArtwork({ ...record, providerId: null })).toBeNull();
  });
  it("retains catalogue provenance through checkpoints and history replay without changing audio identity", () => {
    const { tracker } = fixture();
    const catalogued = { ...track, metadataSourceId: "itunes:123", source: {
      providerId: "youtube", sourceId: "abcdefghijk", pageUrl: "https://www.youtube.com/watch?v=abcdefghijk",
      license: "", licenseUrl: "", attribution: "Uploader",
    } };
    tracker.sample(state(0), catalogued, true, 0, wall);
    tracker.sample(state(1), catalogued, true, 1000, wall + 1000);
    const replay = historyTrack(JSON.parse(JSON.stringify(tracker.record)));
    expect(replay).toMatchObject({ id: track.id, title: track.title, artist: track.artist,
      album: track.album, metadataSourceId: "itunes:123", source: { providerId: "youtube", sourceId: "abcdefghijk" } });
  });
  it("keeps legacy history replayable and records catalogue provenance added during a play", () => {
    const { tracker, sample } = fixture();
    sample(0);
    expect(historyTrack(tracker.record!)).not.toHaveProperty("metadataSourceId");
    tracker.sample(state(1), { ...track, metadataSourceId: "itunes:123" }, true, 1000, wall + 1000);
    expect(historyTrack(tracker.record!).metadataSourceId).toBe("itunes:123");
  });
  it("ignores clicks, loading and a clock that does not advance", () => {
    const { tracker, sample, writes } = fixture();
    sample(0, 0, "loading"); sample(1, 0); sample(2, 0); tracker.flush();
    expect(writes).toEqual([]);
  });
  it("counts playback, freezes on pause/buffer/error and keeps pauses one play", () => {
    const { tracker, sample } = fixture();
    sample(0); sample(1); sample(2, 2, "paused");
    const id = tracker.record?.id;
    sample(10, 2, "paused"); sample(11, 2); sample(12, 3);
    sample(13, 3, "buffering"); sample(20, 3, "buffering"); sample(21, 3); sample(22, 4);
    expect(tracker.record?.listenedMs).toBe(4000); expect(tracker.record?.id).toBe(id);
    sample(23, 4, "error"); expect(tracker.record).toBeNull();
  });
  it("does not credit forward/back seeks or unexplained position jumps", () => {
    const { tracker, sample } = fixture();
    sample(0); sample(1); sample(2, 80, "playing", 1); sample(3, 81, "playing", 1);
    sample(4, 5, "playing", 2); sample(5, 6, "playing", 2); sample(6, 90, "playing", 2);
    expect(tracker.record?.listenedMs).toBe(3000);
  });
  it("caps credited progress by monotonic elapsed and discards suspension gaps", () => {
    const { tracker, sample } = fixture();
    sample(0); sample(1, 1.4); sample(20, 20); sample(21, 21);
    expect(tracker.record?.listenedMs).toBe(2000);
  });
  it("flushes transitions and treats same-track repeat as a distinct play", () => {
    const { tracker, sample, writes } = fixture();
    sample(0); sample(1); const first = tracker.record?.id;
    sample(2, 0, "loading", 0, "two"); sample(3, 0, "playing", 0, "two"); sample(4, 1, "playing", 0, "two");
    expect(writes[0].listenedMs).toBe(1000); expect(tracker.record?.id).not.toBe(first);
    expect(tracker.record?.listenedMs).toBe(1000);
  });
  it("disabling and clearing discard baselines without crediting disabled time", () => {
    const { tracker, sample, writes } = fixture();
    sample(0); sample(1); sample(2, 2, "playing", 0, "one", false);
    expect(writes[0].listenedMs).toBe(1000);
    sample(20, 20); sample(21, 21); expect(tracker.record?.listenedMs).toBe(1000);
    tracker.reset(); sample(22, 22); expect(tracker.record?.listenedMs).toBe(0);
  });
  it("splits listening across local midnight instead of attributing all time to start", () => {
    const output: ListeningRecord[] = [];
    const tracker = new ListeningTracker(record => output.push(record));
    const midnight = new Date(2026, 9, 20).getTime();
    tracker.sample(state(0), track, true, 0, midnight - 500);
    tracker.sample(state(1), track, true, 1000, midnight + 500);
    tracker.flush();
    expect(output[0].days).toEqual({ "2026-10-19": 500, "2026-10-20": 500 });
  });
});
const record = (id: string, days: Record<string, number>): ListeningRecord => ({ id, trackId: id, title: id, artist: "A, B", album: "Album", artworkUrl: null, providerId: null, sourceId: null, startedAt: wall, updatedAt: wall, listenedMs: Object.values(days).reduce((a, b) => a + b, 0), days });
describe("listening recap aggregation", () => {
  it("applies threshold then ranks by filtered day time with full collaborator credit", () => {
    const result = aggregateListening([record("one", {"2026-10-19": 30000}), record("two", {"2026-10-19": 15000}), record("short", {"2026-10-19": 9000})], "30", wall);
    expect(result.totalMs).toBe(45000); expect(result.artists.map(a => a.ms)).toEqual([45000, 45000]);
    expect(result.artists[0].subtitle).toBe("2 songs · 2 plays");
    expect(result.tracks.map(t => t.key)).toEqual(["one", "two"]); expect(result.albums[0].ms).toBe(45000);
    expect(result.tracks[0].plays).toBe(1);
    const repeated = aggregateListening([record("one", {"2026-10-19": 30000}), { ...record("one", {"2026-10-19": 15000}), id: "second" }], "30", wall);
    expect(repeated.tracks[0].plays).toBe(2);
  });
  it("filters per-day segments, uses inclusive local-calendar ranges and excludes future dates", () => {
    const result = aggregateListening([record("one", {"2026-10-12": 20000, "2026-10-13": 1000, "2026-10-19": 20000, "2026-10-20": 20000})], "7", wall);
    expect(result.totalMs).toBe(21000); expect(localDay(rangeStart("7", wall))).toBe("2026-10-13");
    expect(localDay(rangeStart("year", wall))).toBe("2026-01-01");
  });
  it("computes actual active days, streaks, busiest day, months and unique counts", () => {
    const result = aggregateListening([record("one", {"2026-09-30": 10000, "2026-10-01": 30000, "2026-10-02": 20000, "2026-10-05": 10000})], "year", wall);
    expect(result.insights).toMatchObject({ uniqueTracks: 1, uniqueArtists: 2, uniqueAlbums: 1, activeDays: 4, longestStreak: 3, busiestDay: "2026-10-01" });
    expect(result.insights.monthly).toEqual([{month:"2026-09",ms:10000},{month:"2026-10",ms:60000}]);
  });
  it("does not split band names containing and, duplicate artist credits or infer missing albums", () => {
    const rec = { ...record("one", {"2026-10-19":10000}), artist: "Earth Wind and Fire, Earth Wind and Fire", album: "" };
    const result = aggregateListening([rec], "all", wall);
    expect(result.artists).toHaveLength(1); expect(result.albums[0].title).toBe("Unknown album");
    expect(result.insights.uniqueAlbums).toBe(0);
  });
});
