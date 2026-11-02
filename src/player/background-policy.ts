import type { CatalogTrack, YtdlpSearchResult } from '../adapters/native';
import type { Session, Track } from '../domain/types';
import type { ListeningRecord } from '../domain/listening';
import { advance, advanceAfterFailure, enqueue, isQueuedCatalog, playbackQueue, resolveQueueEntry } from '../domain/queue';
import { canonicalTrack, resolveCatalogSource } from '../domain/catalog-track';
import { matchSource } from '../domain/source-matching';
import { rankAutoplay, type RadioCandidate } from '../domain/autoplay-ranking';
import { sameRecommendation, catalogQuickPick } from '../domain/quick-picks';

// Runs in the native worker as well as tests; no Activity, WebView or filesystem access.
export interface BackgroundLibrary {
  select?(entryId: string): void;
  lookup(id: string): Promise<CatalogTrack>;
  autoplayPool(anchor: Track): Promise<{ candidates: RadioCandidate[]; metadata: CatalogTrack[] }>;
  search(query: string, maxResults: number): Promise<YtdlpSearchResult[]>;
  resolve(id: string): Promise<{ title?: string; duration?: number; track?: string; artist?: string }>;
  verified(id: string): Promise<(YtdlpSearchResult & {userSelected?: boolean}) | null>;
  remember(id: string, source: YtdlpSearchResult): Promise<void>;
}
export interface BackgroundQueue {
  session: Session;
  tracks: Track[];
  records: ListeningRecord[];
  languages: string[];
  anchor?: Track;
  recent?: CatalogTrack[];
  turn?: number;
  failedEntries?: string[];
  failedSources?: string[];
  listening?: { generation: number; record: ListeningRecord | null; nativeCount: number };
}
export interface BackgroundSelection {
  queue: BackgroundQueue;
  track: Track;
}

export async function backgroundNext(input: BackgroundQueue, library: BackgroundLibrary, direction: -1 | 0 | 1 = 1, ended = true): Promise<BackgroundSelection | null> {
  let session = input.session;
  const trackFor = (id: string) => input.tracks.find(track => track.id === id) || session.queueTracks[id];
  const current = session.queue.find(entry => entry.id === session.currentId);
  const seed = current && trackFor(current.trackId);
  const excludedSources = new Set(input.failedSources || []);
  const resolve = async (track: Track): Promise<Track> => {
    const replacing = !!track.metadataSourceId && excludedSources.has(track.source?.sourceId || track.id.replace(/^youtube:/, ''));
    if (track.offline || !track.metadataSourceId || (!isQueuedCatalog(track) && !track.id.startsWith('youtube:'))) return track;
    const offline = input.tracks.find(item => item.metadataSourceId === (track.metadataSourceId || track.id) && item.offline && !item.missing);
    if (offline) return offline;
    const known = await library.verified(track.metadataSourceId);
    const catalog = await library.lookup(track.metadataSourceId || track.id);
    const verify = async (candidate: YtdlpSearchResult) => library.resolve(candidate.id);
    if (!isQueuedCatalog(track) && !replacing && !known?.userSelected) {
      const id=track.source?.sourceId || track.id.replace(/^youtube:/,'');
      try {
        const details=await library.resolve(id);
        if ((await matchSource(catalog,{id,title:details.title || details.track || '',channel:null,thumbnail:null,duration:details.duration || null,...details})).accepted) return track;
      } catch { /* Cached catalogue labels are not evidence about the actual upload. */ }
      excludedSources.add(id);
    }
    if (known && !excludedSources.has(known.id)) {
      try {
        const candidate = { ...known, ...await verify(known) };
        if ((await matchSource(catalog, candidate)).accepted) return canonicalTrack(catalog, candidate);
      } catch { /* A saved mapping still needs a playable, matching recording. */ }
      excludedSources.add(known.id);
    }
    const source = await resolveCatalogSource(catalog, library.search, { verify, exclude: excludedSources });
    await library.remember(catalog.id, source);
    return canonicalTrack(catalog, source);
  };
  const failed = new Set(input.failedEntries || []);
  let lastFailure: unknown;
  let next = direction === 0 ? session.currentId : advance(session, direction, ended);
  if (next && failed.has(next) && direction !== -1) next = advanceAfterFailure(session, failed);
  // Each occurrence is attempted at most once, even with Repeat all enabled.
  while (next && !failed.has(next)) {
    const entry = session.queue.find(item => item.id === next);
    const track = entry && trackFor(entry.trackId);
    if (entry && track && !track.missing) {
      try {
        library.select?.(entry.id);
        const resolved = await resolve(track);
        session = { ...session, currentId: entry.id, position: direction === 0 ? input.session.position : 0 };
        session = resolveQueueEntry(session, entry.id, track.id, resolved);
        return { queue: { ...input, session }, track: resolved };
      } catch (error) { lastFailure = error; }
    }
    failed.add(next);
    session = { ...session, currentId: next };
    next = direction !== -1 ? advanceAfterFailure(session, failed) : advance(session, -1);
  }
  if (direction === -1 || !session.settings.autoplay || !seed) {
    if (failed.size) throw lastFailure || Error('No queued audio is available. Relink missing files or choose another recording.');
    return null;
  }
  const anchor = input.anchor || seed;
  const pool = await library.autoplayPool(anchor);
  const known = playbackQueue(session).flatMap(entry => trackFor(entry.trackId) || []);
  const recent = input.recent || [];
  const excluded = [...known, ...recent.map(item => catalogQuickPick(item).track)];
  const ranked = rankAutoplay(pool.candidates,
    { session, saved: input.tracks, records: input.records, languages: input.languages },
    { anchor, current: seed, metadata: pool.metadata, recent, excluded, skipped: [], turn: (input.turn || 0) + 1 });
  for (const candidate of ranked.slice(0, 8)) {
    try {
      const track = await resolve(catalogQuickPick(candidate.track).track);
      if (excluded.some(other => sameRecommendation({ track }, { track: other }))) continue;
      const queued = enqueue({ ...session, queueTracks: { ...session.queueTracks, [track.id]: track } }, track.id);
      const id = advance(queued, 1);
      if (!id) return null;
      return { track, queue: { ...input, anchor, recent: [...recent, candidate.track].slice(-80), turn: (input.turn || 0) + 1,
        session: { ...queued, currentId: id, position: 0 } } };
    } catch { /* Try another verified, language-compatible recommendation. */ }
  }
  return null;
}
