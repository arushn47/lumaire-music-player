import { library, mobile, type YtdlpSearchResult, type YtdlpStreamInfo } from "../adapters/native";
import { PlaybackController } from "./controller";
import { AndroidPlaybackController } from "./android";
import type { Track } from "../domain/types";
import { failureKind, resolveCatalogSource } from "../domain/catalog-track";
import { measurePlayback, playbackEvent } from "./diagnostics";
import { matchSource } from '../domain/source-matching';

const preparedStreams = new Map<string, { stream: YtdlpStreamInfo; expires: number }>();
const attemptedSources = new Map<string, Set<string>>();
const streamRequests = new Map<string, Promise<YtdlpStreamInfo>>();


function streamLifetime(streamUrl: string): number {
  try {
    const raw = new URL(streamUrl).searchParams.get("expire");
    if (raw === null) return 120000;
    const seconds = Number(raw);
    if (!Number.isFinite(seconds) || seconds <= 0) return 0;
    return Math.max(0, Math.min(seconds * 1000 - Date.now() - 30000, 1800000));
  } catch { return 0; }
}
async function preparedStream(id: string): Promise<YtdlpStreamInfo> {
  const cached = preparedStreams.get(id);
  if (cached && cached.expires > Date.now()) {
    playbackEvent({ trackId: `youtube:${id}`, stage: "stream-cache", cache: "hit" });
    return cached.stream;
  }
  const pending = streamRequests.get(id);
  if (pending) {
    playbackEvent({ trackId: `youtube:${id}`, stage: "stream-cache", cache: "shared" });
    return pending;
  }
  playbackEvent({ trackId: `youtube:${id}`, stage: "stream-cache", cache: "miss" });
  const request = measurePlayback({ trackId: `youtube:${id}`, stage: "extraction" }, () => library.ytdlpGetStream(id)).then(stream => {
    if (preparedStreams.size >= 128) preparedStreams.delete(preparedStreams.keys().next().value!);
    preparedStreams.set(id, { stream, expires: Date.now() + streamLifetime(stream.streamUrl) });
    return stream;
  }).finally(() => streamRequests.delete(id));
  streamRequests.set(id, request);
  return request;
}
export async function prepareCatalogCandidate(candidate: YtdlpSearchResult): Promise<Partial<YtdlpSearchResult>> {
  const stream = await preparedStream(candidate.id);
  return { title:stream.title || candidate.title, duration: stream.duration || candidate.duration, track: stream.track || candidate.track, artist: stream.artist || candidate.artist };
}

// Structured music credits from the existing stream resolution request. Never
// retain its expiring URL, and never turn an uploader name into a performer.
export const resolvedMusic = new Map<
  string,
  { title: string; artist: string; album: string }
>();

export const musicResolved = new EventTarget();
export const offlineTracks = new Set<string>();
export const playbackTracks = new Map<string, Track>();

export const player = mobile
  ? new AndroidPlaybackController((id) => playbackTracks.get(id))
  : new PlaybackController(async (id, retry = false, alternative = false) => {
    const request = player.state.playbackId;
    const active = () => player.state.playbackId === request && player.state.trackId === id;
    const checkActive = () => { if (!active()) throw Error('Playback selection changed.'); };
    if (offlineTracks.has(id)) return library.media(id);
    // Check if this is a YouTube track (format: youtube:videoId)
    if (id.startsWith("youtube:")) {
      const videoId = id.slice(id.indexOf(":") + 1);
      if (!retry || !attemptedSources.has(id)) {
        if (attemptedSources.size >= 128) attemptedSources.delete(attemptedSources.keys().next().value!);
        attemptedSources.set(id, new Set([videoId]));
      }
      const attempted = attemptedSources.get(id)!;
      let stream: YtdlpStreamInfo;
      try {
        let preferredId = videoId;
        const track = playbackTracks.get(id);
        if (!retry && track?.metadataSourceId) {
          const preferred = await library.getVerifiedSource?.(track.metadataSourceId);
          checkActive();
          if (preferred?.userSelected && preferred.sourceProvider === 'youtube') {
            const candidate = {id:preferred.sourceId,title:preferred.title,channel:preferred.artist || '',duration:preferred.duration,thumbnail:null};
            attempted.add(candidate.id);
            try {
              const catalog = await library.lookupCatalog(track.metadataSourceId);
              checkActive();
              const details = await prepareCatalogCandidate(candidate);
              checkActive();
              if ((await matchSource(catalog,{...candidate,...details})).accepted) preferredId = candidate.id;
            } catch(error) { if (failureKind(error) === 'cancelled') throw error; }
            attempted.delete(preferredId); attempted.add(preferredId);
          }
        }
        if (retry) {
          for (const sourceId of attempted) preparedStreams.delete(sourceId);
          if (alternative) throw new Error("The refreshed audio URL failed. Choose another verified recording.");
        }
        const sourceId = retry ? [...attempted].at(-1)! : preferredId;
        stream = await preparedStream(sourceId);
        if (track?.metadataSourceId) {
          checkActive();
          const catalog = await library.lookupCatalog(track.metadataSourceId);
          checkActive();
          if (!(await matchSource(catalog,{id:sourceId,title:stream.title || stream.track || '',channel:null,thumbnail:null,duration:stream.duration,track:stream.track,artist:stream.artist})).accepted)
            throw Error('The selected upload is not the verified recording. Trying another source.');
        }
      } catch (error) {
        if (failureKind(error) === "cancelled") throw error;
        checkActive();
        const track = playbackTracks.get(id);
        if (!track?.metadataSourceId) throw error;
        const catalog = await library.lookupCatalog(track.metadataSourceId);
        const candidate = await resolveCatalogSource(catalog, library.ytdlpSearch, { exclude: attempted, verify: prepareCatalogCandidate, active });
        attempted.add(candidate.id);
        stream = preparedStreams.get(candidate.id)!.stream;
        void library.setVerifiedSource?.(catalog.id, {
          sourceId: candidate.id,
          sourceProvider: "youtube",
          title: candidate.title,
          artist: candidate.channel || null,
          duration: candidate.duration || null,
        })?.catch?.(() => {});
      }
      playbackEvent({ trackId: id, stage: "stream-ready", candidateId: [...attempted].at(-1) });
      if (stream.track?.trim() && stream.artist?.trim()) {
        if (resolvedMusic.size >= 128)
          resolvedMusic.delete(resolvedMusic.keys().next().value!);
        resolvedMusic.set(id, {
          title: stream.track.trim(),
          artist: stream.artist.trim(),
          album: stream.album?.trim() || "",
        });
        musicResolved.dispatchEvent(
          new CustomEvent("resolved", { detail: id }),
        );
      }
      return stream.streamUrl;
    }
    // Check if this is a Commons track (format: wikimedia-commons:sourceId)
    if (id.startsWith("wikimedia-commons:")) {
      const sourceId = id.slice(id.indexOf(":") + 1);
      const resolved = await library.resolveCommons(sourceId);
      return resolved.url;
    }
    // Default to local file resolution
    return library.media(id);
  });
