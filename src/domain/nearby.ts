import type { Track } from "./types";
import { catalogQueueTrack } from "./catalog-track";
import { isQueuedCatalog } from "./queue";
import {recordingMetadata} from './metadata-enrichment';


export interface SharedPlaylist { id: string; name: string; tracks: Track[] }
export interface SharedState { playlists: SharedPlaylist[]; now: { track: Track; position: number; playing: boolean } | null }

export function portableTrack(track?: Track | null): Track | null {
  if (!track || ![track.id, track.title, track.artist, track.album, track.format].every(v => typeof v === 'string') || !Number.isFinite(track.duration) || track.duration < 0 || track.duration > 86400 || track.metadataSourceId != null && typeof track.metadataSourceId !== 'string' || track.artworkUrl != null && typeof track.artworkUrl !== 'string') return null;
  const metadata = recordingMetadata(track.recordingMetadata);
  const catalog = track.metadataSourceId && catalogQueueTrack({ id: track.metadataSourceId, recordingMetadata: metadata, title: track.title, artist: track.artist, album: track.album, duration: track.duration, artworkUrl: track.artworkUrl, artists: [] });
  if (catalog && isQueuedCatalog(catalog)) return catalog;
  const source = track.source;
  if (!source || typeof source.sourceId !== 'string' || ![source.pageUrl,source.license,source.licenseUrl,source.attribution].every(v=>typeof v==='string')) return null;
  const valid = source.providerId === 'youtube' ? /^[A-Za-z0-9_-]{11}$/.test(source.sourceId) : source.providerId === 'wikimedia-commons' && /^[1-9]\d{0,19}$/.test(source.sourceId);
  if (!valid || track.id !== `${source.providerId}:${source.sourceId}`) return null;
  return { ...track, recordingMetadata: metadata, fileName: "", offline: false, missing: false, artworkUrl: track.artworkUrl?.startsWith("https://") ? track.artworkUrl : null };
}
