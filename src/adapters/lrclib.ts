import { cleanVideoTitle } from "../domain/online-track";
/**
 * Native lyrics lookup: LRCLIB first, with lrc.red fallback.
 *
 * All network I/O happens inside the Rust `fetch_lyrics` Tauri command so the
 * WebView2 Content-Security-Policy is not involved. This module only shapes
 * the response into the existing LyricDocument format.
 *
 * Terms: LRCLIB is a free, open lyrics database with no API key requirement.
 * Caching is encouraged; we store results in the session `lyrics` map just
 * like manually attached docs.
 */

import { invoke, isTauri } from "@tauri-apps/api/core";
import { normalizeCachedLyrics, parseLyrics, lyricsVersionMatches } from "../domain/lyrics";
import type { LyricDocument, Track } from "../domain/types";

/** Shape returned by the Rust fetch_lyrics command. */
type LyricResult =
  | { kind: "synced"; lrc: string; matched?: LyricMatch | null }
  | { kind: "plain"; text: string; matched?: LyricMatch | null }
  | { kind: "instrumental" }
  | { kind: "not_found" };

interface LyricMatch {
  id: number | string;
  provider?: "lrclib" | "lrc.red";
  title: string;
  artist: string;
  album: string;
  duration: number;
}

export type LookupState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "found"; doc: LyricDocument }
  | { status: "not_found" }
  | { status: "error"; message: string };

const pending = new Map<string, Promise<LookupState>>();

/**
 * Fetch lyrics for a track from LRCLIB via the native command.
 * Returns a LookupState describing the outcome; never throws.
 *
 * Pass `cachedDoc` if the session already has lyrics for this track —
 * it will be returned immediately as `found` without a network round-trip.
 */
export async function lookupLyrics(
  track: Track,
  cachedDoc?: LyricDocument,
): Promise<LookupState> {
  if (cachedDoc && lyricsVersionMatches(cachedDoc,track.title))
    return {
      status: "found",
      doc: normalizeCachedLyrics(cachedDoc, track.duration),
    };
  const key = JSON.stringify([
    track.title,
    track.artist,
    track.album,
    track.duration,
  ]);
  const existing = pending.get(key);
  if (existing) return existing;
  const request = fetchLyrics(track).finally(() => pending.delete(key));
  pending.set(key, request);
  return request;
}

async function fetchLyrics(track: Track): Promise<LookupState> {
  // Not running inside Tauri — skip silently.
  if (!isTauri()) return { status: "idle" };

  try {
    const uploaderOnly = track.source?.providerId === "youtube" && !track.metadataSourceId
      && track.artist === track.source.attribution && /^(?:full|official)\s+(?:music\s+)?video\s*:/i.test(track.title)
      && !track.title.toLowerCase().includes(track.artist.toLowerCase());
    const result = await invoke<LyricResult>("fetch_lyrics", {
      title: track.source?.providerId === "youtube" ? cleanVideoTitle(track.title) : track.title,
      // Local imports use "Unknown artist", YouTube imports "Unknown Artist".
      // Treat both as "no artist" so the Rust side can fall back to the title.
      artist: uploaderOnly || /^unknown artist$/i.test(track.artist.trim()) ? "" : track.artist,
      album: /^(youtube|local collection|unknown album)$/i.test(
        track.album.trim(),
      )
        ? ""
        : track.album,
      duration: track.duration,
    });

    return shapeResult(result, track);
  } catch (e) {
    return lookupError(e);
  }
}

function lookupError(e: unknown): LookupState {
  return {
    status: "error",
    message: e instanceof Error ? e.message : String(e),
  };
}

function shapeResult(result: LyricResult, track: Track): LookupState {
  const provider = "matched" in result && result.matched?.provider === "lrc.red" ? "lrc.red" : "LRCLIB";
  switch (result.kind) {
    case "synced": {
      const doc = parseLyrics(result.lrc, `${track.title} · ${provider}`);
      addProvenance(doc, result.matched);
      return {
        status: "found",
        doc: normalizeCachedLyrics(doc, track.duration),
      };
    }
    case "plain": {
      const doc = parseLyrics(result.text, `${track.title} · ${provider} (plain)`);
      addProvenance(doc, result.matched);
      doc.timingMode = "unsynced";
      doc.lines = doc.lines.map((line) => ({ ...line, time: null }));
      return { status: "found", doc };
    }
    case "instrumental": {
      const doc: LyricDocument = {
        origin: "provider",
        id: crypto.randomUUID(),
        raw: "",
        fileName: "Instrumental · LRCLIB",
        lines: [],
        fileOffset: 0,
        userOffset: 0,
        warnings: [],
        romanisation: {},
        translation: {},
        instrumental: true,
      };
      return { status: "found", doc };
    }
    case "not_found":
      return { status: "not_found" };
  }
}

function addProvenance(
  doc: LyricDocument,
  matched: LyricMatch | null | undefined,
) {
  doc.origin = "provider";
  if (!matched) return;
  doc.source = {
    provider: matched.provider ?? "lrclib",
    recordId: matched.id,
    title: matched.title,
    artist: matched.artist,
    duration: matched.duration,
  };
}
