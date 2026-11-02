import { useSyncExternalStore } from 'react';
import { listen } from '@tauri-apps/api/event';
import { desktop, invalidateArtistLookups, type CatalogArtist } from './native';

export interface ArtistResolution {
  query: string;
  requestId?: string;
  verifiedIds: string[];
  artist: CatalogArtist;
}

let resolutions: ArtistResolution[] = [];
const subscribers = new Set<() => void>();
const searches = new Set<(value: ArtistResolution) => void>();
let listening = false;

export function rememberArtistResolution(value: ArtistResolution): void {
  invalidateArtistLookups(value.verifiedIds);
  resolutions = [...resolutions.filter(old => !old.verifiedIds.some(id => value.verifiedIds.includes(id))), value].slice(-128);
  subscribers.forEach(callback => callback());
  setTimeout(() => {
    if (!resolutions.includes(value)) return;
    resolutions = resolutions.filter(old => old !== value);
    invalidateArtistLookups(value.verifiedIds);
    subscribers.forEach(callback => callback());
  }, 600_000);
}

function start(): void {
  if (listening || !desktop) return;
  listening = true;
  void listen<ArtistResolution>('artist-resolution', event => {
    rememberArtistResolution(event.payload);
    searches.forEach(callback => callback(event.payload));
  }).catch(() => { listening = false; });
}

export function onArtistResolution(callback: (value: ArtistResolution) => void): () => void {
  searches.add(callback);
  start();
  return () => { searches.delete(callback); };
}

export function useArtistResolutions(): ArtistResolution[] {
  return useSyncExternalStore(callback => {
    subscribers.add(callback);
    start();
    return () => { subscribers.delete(callback); };
  }, () => resolutions, () => resolutions);
}

export function resolvedArtists(artists: CatalogArtist[], confirmed: ArtistResolution[]): CatalogArtist[] {
  return [...new Map(artists.map(artist => {
    const resolved = confirmed.find(value => value.verifiedIds.includes(artist.id))?.artist || artist;
    return [resolved.id, resolved] as const;
  })).values()];
}

export function isActiveArtistResolution(value: ArtistResolution, query: string, requestId: string | undefined): boolean {
  return value.query === query && value.requestId === requestId;
}
