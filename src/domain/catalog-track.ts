import type { CatalogTrack, CatalogArtist, YtdlpSearchResult } from "../adapters/native";
import type { Track } from "./types";
import { youtubeTrack } from "./online-track";
import { canonicalArtistCredit } from "./catalog-links";
import { matchSource, searchRoman, sourceCoreTitle, sourceCredits, sourceTitle } from "./source-matching";
import { measurePlayback, playbackEvent } from "../player/diagnostics";
import { isCatalogId } from './queue';

export async function canonicalArtistNames(catalog: CatalogTrack, lookup: (id: string) => Promise<CatalogArtist>): Promise<string> {
  if (!catalog.artists.length) return canonicalArtistCredit(catalog.artist);
  const names = await Promise.all(catalog.artists.map(async credit => {
    if (!credit.id || !/^(?:saavn:artist:|itunes:)[1-9]\d*$/.test(credit.id) || credit.name.includes(",")) return credit.name;
    try {
      const artist = await lookup(credit.id);
      return artist.id === credit.id && artist.name.trim() ? artist.name : credit.name;
    } catch { return credit.name; }
  }));
  return canonicalArtistCredit(names.join(", "));
}

export function canonicalTrack(
  catalog: CatalogTrack,
  candidate: YtdlpSearchResult,
  existing?: Track,
): Track {
  const source = youtubeTrack(candidate);
  return {
    ...source,
    ...(existing?.id === source.id ? existing : {}),
    source: source.source,
    title: catalog.title,
    artist: canonicalArtistCredit(catalog.artist),
    album: catalog.album,
    duration: catalog.duration,
    artworkUrl: catalog.artworkUrl || null,
    metadataSourceId: catalog.id,
    recordingMetadata: (existing?.id === source.id && existing.metadataSourceId === catalog.id ? existing.recordingMetadata : undefined) || catalog.recordingMetadata,
  };
}

export function catalogQueueTrack(catalog: CatalogTrack): Track {
  return { id: catalog.id, metadataSourceId: catalog.id, recordingMetadata: catalog.recordingMetadata, title: catalog.title, artist: canonicalArtistCredit(catalog.artist),
    album: catalog.album, duration: catalog.duration, artworkUrl: catalog.artworkUrl, format: "catalog", fileName: "", missing: false };
}

export interface ResolutionOptions {
  verify?: (candidate: YtdlpSearchResult) => Promise<Partial<YtdlpSearchResult> | void>;
  exclude?: Set<string>;
  active?: () => boolean;
}

export function failureKind(error: unknown): string {
  const message = String(error);
  if (/\bOnline lookup (?:was )?cancel(?:led|ed)\b|\bPlayback selection changed\b|\bAbortError\b/i.test(message)) return "cancelled";
  if (/not installed|install.*engine|failed to execute|cannot find.*(?:file|engine)/i.test(message)) return "engine";
  if (/not a bot|sign in|verification|confirm you/i.test(message)) return "verification";
  if (/timed? out|timeout|network|offline|could not reach|connection|resolve host|HTTP (?:429|5\d\d)/i.test(message)) return "network";
  if (/private|removed|not available|unavailable|not exist|not found|geo.block|copyright/i.test(message)) return "unavailable";
  return "extraction";
}

export async function resolveCatalogSource(
  catalog: CatalogTrack,
  search: (query: string, maxResults: number, catalog?: boolean) => Promise<YtdlpSearchResult[]>,
  options: ResolutionOptions = {},
): Promise<YtdlpSearchResult> {
  return (await resolveCatalogSources(catalog, search, options, 1))[0];
}

export async function resolveCatalogSources(catalog: CatalogTrack,
  search: (query: string, maxResults: number, catalog?: boolean) => Promise<YtdlpSearchResult[]>,
  options: ResolutionOptions, limit = 3): Promise<YtdlpSearchResult[]> {
  const selected: YtdlpSearchResult[] = [];
  const checkActive = () => { if (options.active && !options.active()) throw Error('Playback selection changed.'); };
  const candidates = new Map<string, YtdlpSearchResult>();
  const credits = sourceCredits(catalog), title = sourceTitle(catalog.title);
  if (!title || !credits.length || !isCatalogId(catalog.id)) throw new Error("Invalid catalog track identity or credits. Refresh metadata and retry.");
  const primary = credits[0];
  const romanTitle = await searchRoman(title), romanArtist = await searchRoman(primary);
  const coreTitle = sourceCoreTitle(title);
  const phases = [
    [`"${title.replaceAll('"', '')}" ${primary}`, `${title} ${primary}`],
    [...credits.slice(1, 4).map(artist => `${title} ${artist}`), `${title} ${catalog.album}`, ...(romanTitle !== title || romanArtist !== primary ? [`${romanTitle} ${romanArtist}`] : [])],
    ...(coreTitle !== title ? [[...credits.slice(0, 4).map(artist => `${coreTitle} ${artist}`), `${coreTitle} ${catalog.album}`, `${await searchRoman(coreTitle)} ${romanArtist}`]] : []),
  ];
  const triedQueries = new Set<string>(), triedCandidates = new Set(options.exclude || []);
  let artistMetadataChecks = 0;
  let searches = 0, successfulSearches = 0, extractionFailures = 0;
  const searchFailures = new Set<string>(), streamFailures = new Set<string>();
  for (const phase of phases) {
    checkActive();
    const queries = [...new Set(phase.map(query => query.trim().slice(0, 200)))].filter(query => !triedQueries.has(query));
    const phaseAt = performance.now();
    const responses = await Promise.allSettled(queries.map(async query => {
      triedQueries.add(query); searches++;
      playbackEvent({ trackId: catalog.id, stage: "search", query });
      const values = await measurePlayback({ trackId: catalog.id, stage: "search-request" }, () => search(query, 15, true));
      successfulSearches++;
      playbackEvent({ trackId: catalog.id, stage: "discovered", query, count: values.length });
      return values;
    }));
    playbackEvent({ trackId: catalog.id, stage: "search-phase-end", durationMs: performance.now() - phaseAt, count: queries.length });
    responses.forEach(response => {
      if (response.status === "fulfilled") response.value.forEach(candidate => { if (!candidates.has(candidate.id)) candidates.set(candidate.id, candidate); });
      else {
        const reason = failureKind(response.reason);
        if (reason === "cancelled") throw response.reason;
        searchFailures.add(reason); playbackEvent({ trackId: catalog.id, stage: "search-failed", reason });
      }
    });
    checkActive();
    const matches: { candidate: YtdlpSearchResult; score: number }[] = [];
    const incomplete: { candidate: YtdlpSearchResult; reason: string }[] = [];
    for (const candidate of candidates.values()) {
      if (triedCandidates.has(candidate.id)) continue;
      triedCandidates.add(candidate.id);
      const match = await matchSource(catalog, candidate);
      if (options.verify && ["duration-missing", "artist-metadata-missing"].includes(match.reason)) incomplete.push({ candidate, reason: match.reason });
      // Exact title/version may be on a label/uploader channel; require extracted performer credits before acceptance.
      if (options.verify && match.reason === 'artist' && !candidate.artist?.trim()) incomplete.push({candidate,reason:'artist-details-required'});
      playbackEvent({ trackId: catalog.id, stage: match.accepted ? "matched" : "rejected", candidateId: candidate.id, reason: match.reason });
      if (match.accepted) matches.push({ candidate, score: match.score });
    }
    matches.sort((a, b) => a.score - b.score);
    // Verify credible complete matches before spending network calls filling metadata gaps.
    for (const { candidate, reason: missing } of [...matches.map(row => ({ ...row, reason: "" })), ...incomplete]) {
      checkActive();
      if (["artist-metadata-missing", "artist-details-required"].includes(missing) && artistMetadataChecks++ >= 3) continue;
      try {
        const details = options.verify ? await measurePlayback({ trackId: catalog.id, stage: "verification", candidateId: candidate.id }, () => options.verify!(candidate)) : undefined;
        if (details) Object.assign(candidate, details);
        checkActive();
        if (missing === 'artist-details-required' && !details?.artist?.trim()) {
          playbackEvent({trackId:catalog.id,stage:'rejected',candidateId:candidate.id,reason:'stream-artist-metadata-missing'});
          continue;
        }
        const verified = await matchSource(catalog, candidate);
        if (!verified.accepted) { playbackEvent({ trackId: catalog.id, stage: "rejected", candidateId: candidate.id, reason: `stream-${verified.reason}` }); continue; }
        playbackEvent({ trackId: catalog.id, stage: options.verify ? "source-resolved" : "candidate-selected", candidateId: candidate.id });
        selected.push(candidate);
        if (selected.length >= limit) return selected;
      } catch (error) {
        extractionFailures++;
        const reason = failureKind(error);
        if (reason === "cancelled") throw error;
        streamFailures.add(reason);
        playbackEvent({ trackId: catalog.id, stage: "extraction-failed", candidateId: candidate.id, reason });
      }
    }
  }
  if (selected.length) return selected;
  if (searchFailures.has("engine") || streamFailures.has("engine")) throw new Error("The streaming engine is unavailable. Open Settings, install or refresh the engine, and retry.");
  if (streamFailures.has("verification")) throw new Error("The audio provider requested sign-in or verification for the matching recordings. Retry later or choose another source.");
  if (extractionFailures && streamFailures.size === 1 && streamFailures.has("network")) throw new Error("Stream retrieval failed because the provider or network could not be reached. Check your connection and retry.");
  if (!successfulSearches && searches) throw new Error("Audio search failed: the source provider or network is unavailable. Check your connection and retry.");
  if (extractionFailures) throw new Error("Matching recordings were found, but stream extraction failed for all available candidates. Retry later or check the streaming engine in Settings.");
  if (successfulSearches < searches) throw new Error("Some audio searches failed. Source availability could not be confirmed; check your connection and retry.");
  throw new Error("No matching audio source could be verified for this catalog entry. Try searching the song directly in Discover, or retry.");
}
