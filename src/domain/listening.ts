import type { Playback } from "../player/controller";
import type { Track } from "./types";

export const MIN_LISTEN_MS = 10_000;
export interface ListeningRecord {
  id: string;
  trackId: string;
  title: string;
  artist: string;
  album: string;
  artworkUrl: string | null;
  providerId: string | null;
  sourceId: string | null;
  metadataSourceId?: string | null;
  startedAt: number;
  updatedAt: number;
  listenedMs: number;
  days: Record<string, number>;
}
export type HistoryRange = "7" | "30" | "90" | "year" | "all";
export function localDay(timestamp: number) {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function rangeStart(range: HistoryRange, now = Date.now()) {
  if (range === "all") return 0;
  if (range === "year") return new Date(new Date(now).getFullYear(), 0, 1).getTime();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - Number(range) + 1);
  return start.getTime();
}
export function formatListening(ms: number) {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}
export function historyArtwork(record: ListeningRecord): string | null {
  if (record.artworkUrl) return record.artworkUrl;
  return record.providerId === "youtube" && /^[A-Za-z0-9_-]{11}$/.test(record.sourceId ?? "") && record.trackId === `youtube:${record.sourceId}`
    ? `https://i.ytimg.com/vi/${record.sourceId}/mqdefault.jpg` : null;
}
export function historyTrack(record: ListeningRecord): Track {
  return {
    id: record.trackId, title: record.title, artist: record.artist,
    album: record.album, artworkUrl: historyArtwork(record),
    ...(record.metadataSourceId ? { metadataSourceId: record.metadataSourceId } : {}),
    duration: 0, fileName: record.title, missing: false,
    format: record.providerId === "youtube" ? "YouTube" : "Local",
    ...(record.providerId === "youtube" && record.sourceId ? { source: {
      providerId: "youtube", sourceId: record.sourceId,
      pageUrl: `https://www.youtube.com/watch?v=${record.sourceId}`,
      license: "", licenseUrl: "", attribution: record.artist,
    } } : {}),
  };
}
const normalized = (value: string) => value.normalize("NFKC").trim().toLocaleLowerCase().replace(/\s+/g, " ");
export interface ListeningRank {
  key: string; title: string; subtitle: string;
  artworkUrl: string | null; ms: number; plays: number; record: ListeningRecord;
}
export function aggregateListening(records: ListeningRecord[], range: HistoryRange, now = Date.now()) {
  const startDay = localDay(rangeStart(range, now));
  const endDay = localDay(now);
  const groups = { artists: new Map<string, ListeningRank>(), albums: new Map<string, ListeningRank>(), tracks: new Map<string, ListeningRank>() };
  let totalMs = 0;
  const included: ListeningRecord[] = [];
  const add = (group: Map<string, ListeningRank>, key: string, title: string, subtitle: string, ms: number, record: ListeningRecord) => {
    const old = group.get(key);
    if (old) {
      old.ms += ms;
      old.plays += 1;
      if (!old.artworkUrl && record.artworkUrl) {
        old.artworkUrl = record.artworkUrl;
        if (group !== groups.artists || !old.record.metadataSourceId || record.metadataSourceId) old.record = record;
      }
      if (group === groups.artists && !old.record.metadataSourceId && record.metadataSourceId) old.record = record;
    }
    else group.set(key, { key, title, subtitle, ms, plays: 1, artworkUrl: record.artworkUrl, record });
  };
  const artistMeta = new Map<string, { songs: Set<string>; plays: number }>();
  for (const record of records) {
    if (record.listenedMs < MIN_LISTEN_MS) continue;
    const ms = Object.entries(record.days).reduce((sum, [day, time]) => sum + ((range === "all" || day >= startDay) && day <= endDay ? time : 0), 0);
    if (!ms) continue;
    totalMs += ms;
    included.push({ ...record, listenedMs: ms });
    const artist = record.artist.trim() || "Unknown artist";
    // Explicit collaboration delimiters only; do not split the word 'and' in band names.
    const artists = new Map(artist.split(/\s*[,;&]\s*/u).filter(Boolean).map(name => [normalized(name), name]));
    // Use metadataSourceId as the canonical track key when available: two catalog songs that
    // resolve to the same YouTube video share a trackId but must stay separate in rankings.
    const trackKey = record.metadataSourceId || record.trackId;
    for (const [key, name] of artists) {
      add(groups.artists, key, name, "", ms, record);
      const meta = artistMeta.get(key) || { songs: new Set<string>(), plays: 0 };
      meta.songs.add(trackKey || record.title);
      meta.plays++;
      artistMeta.set(key, meta);
    }
    const rawAlbum = record.album.trim();
    const album = !rawAlbum || ["youtube", "local collection", "unknown", "unknown album"].includes(normalized(rawAlbum)) ? "Unknown album" : rawAlbum;
    add(groups.albums, `${normalized(artist)}\0${normalized(album)}`, album, artist, ms, record);
    add(groups.tracks, trackKey, record.title || "Unknown track", artist, ms, record);
  }
  for (const [key, rank] of groups.artists) {
    const meta = artistMeta.get(key);
    if (meta) {
      const songCount = meta.songs.size;
      const playCount = meta.plays;
      rank.plays = playCount;
      rank.subtitle = `${songCount} ${songCount === 1 ? "song" : "songs"} · ${playCount} ${playCount === 1 ? "play" : "plays"}`;
    }
  }
  const sorted = (group: Map<string, ListeningRank>) => [...group.values()].sort((a, b) => b.ms - a.ms || a.title.localeCompare(b.title));
  const daily = new Map<string, number>();
  for (const record of included) for (const [day, ms] of Object.entries(record.days)) {
    if ((range === "all" || day >= startDay) && day <= endDay) daily.set(day, (daily.get(day) || 0) + ms);
  }
  const days = [...daily.keys()].sort();
  let longestStreak = 0, streak = 0, prior = "";
  for (const day of days) {
    const yesterday = new Date(`${day}T12:00:00`);
    yesterday.setDate(yesterday.getDate() - 1);
    streak = localDay(yesterday.getTime()) === prior ? streak + 1 : 1;
    longestStreak = Math.max(longestStreak, streak); prior = day;
  }
  const months = new Map<string, number>();
  for (const [day, ms] of daily) months.set(day.slice(0, 7), (months.get(day.slice(0, 7)) || 0) + ms);
  const artists = sorted(groups.artists), albums = sorted(groups.albums), tracks = sorted(groups.tracks);
  return {
    artists, albums, tracks, totalMs, records: included.sort((a, b) => b.startedAt - a.startedAt),
    insights: {
      uniqueTracks: tracks.length, uniqueArtists: artists.filter(row => row.title !== "Unknown artist").length,
      uniqueAlbums: albums.filter(row => row.title !== "Unknown album").length,
      activeDays: days.length, longestStreak,
      busiestDay: [...daily].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null,
      monthly: [...months].sort(([a], [b]) => a.localeCompare(b)).map(([month, ms]) => ({ month, ms })),
    },
  };
}

/** Pure media-progress accounting. Never extrapolates across gaps or seeks. */
export class ListeningTracker {
  record: ListeningRecord | null = null;
  private previous: { mono: number; position: number; status: Playback["status"]; seek: number; native?: number; nativeMono: number } | null = null;
  private instance: string | null = null;
  private flushedMs = -1;
  constructor(private checkpoint: (record: ListeningRecord) => void) {}
  sample(state: Playback, track: Track | undefined, enabled: boolean, mono: number, wall: number) {
    const instance = state.playbackId ?? null;
    if (instance !== this.instance) {
      this.flush(); this.record = null; this.previous = null; this.instance = instance; this.flushedMs = -1;
    }
    if (!enabled || !track || track.id !== state.trackId || !instance) {
      this.flush(); this.reset();
      return;
    }
    if (state.status === "playing" && !this.record) {
      this.record = {
        id: crypto.randomUUID(), trackId: track.id, title: track.title || "Unknown track",
        artist: track.artist || "Unknown artist", album: track.album || "", artworkUrl: track.artworkUrl || null,
        providerId: track.source?.providerId ?? null, sourceId: track.source?.sourceId ?? null,
        metadataSourceId: track.metadataSourceId ?? null,
        startedAt: wall, updatedAt: wall, listenedMs: 0, days: {},
      };
    }
    const prev = this.previous;
    if (this.record) {
      this.record.title = track.title || this.record.title;
      this.record.artist = track.artist || this.record.artist;
      this.record.album = track.album || this.record.album;
      this.record.artworkUrl = track.artworkUrl || this.record.artworkUrl;
      this.record.metadataSourceId = track.metadataSourceId || this.record.metadataSourceId;
    }
    const elapsed = prev ? mono - prev.mono : 0;
    const progress = prev ? (state.time - prev.position) * 1000 : 0;
    const nativeProgress = prev?.native !== undefined && state.nativeListenedMs !== undefined ? state.nativeListenedMs - prev.native : null;
    const nativeElapsed = prev ? mono - prev.nativeMono : 0;
    // Native service counters exclude pauses, buffering and seeks; timestamps alone cannot bridge UI suspension.
    if (this.record && nativeProgress !== null && Number.isFinite(nativeProgress) && nativeProgress > 0 && nativeElapsed > 0 && nativeProgress <= nativeElapsed + 1500) {
      this.addTime(Math.floor(nativeProgress), wall);
    } else if (nativeProgress === null && this.record && prev?.status === "playing" && elapsed > 0 && elapsed <= 5000 && progress > 0 && progress <= elapsed + 500 && prev.seek === (state.seekVersion ?? 0)) {
      const credited = Math.floor(Math.min(progress, elapsed));
      this.addTime(credited, wall);
    }
    this.previous = { mono, position: state.time, status: state.status, seek: state.seekVersion ?? 0, native: state.nativeListenedMs, nativeMono: nativeProgress === 0 && prev ? prev.nativeMono : mono };
    if (state.status !== "playing") this.flush();
    if (["ended", "idle", "error"].includes(state.status)) { this.record = null; this.previous = null; }
  }
  private addTime(ms: number, wall: number) {
    if (!this.record || ms <= 0) return;
    let cursor = wall - ms;
    while (cursor < wall) {
      const boundary = new Date(cursor);
      boundary.setHours(24, 0, 0, 0);
      const end = Math.min(wall, boundary.getTime());
      const key = localDay(cursor);
      this.record.days[key] = (this.record.days[key] || 0) + end - cursor;
      cursor = end;
    }
    this.record.listenedMs += ms;
    this.record.updatedAt = wall;
  }
  flush() {
    if (this.record?.listenedMs && this.flushedMs !== this.record.listenedMs) {
      this.checkpoint(structuredClone(this.record));
      this.flushedMs = this.record.listenedMs;
    }
  }
  reset() { this.record = null; this.previous = null; this.flushedMs = -1; }
}
