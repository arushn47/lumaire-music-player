import { expect, it, vi } from 'vitest';
import { isActiveArtistResolution, resolvedArtists, rememberArtistResolution } from './artist-resolution';
import { invalidateArtistLookups } from './native';
import { toggleArtistFavorite } from '../domain/session';
import { capturePlaylistEdits } from '../domain/device-sync';
import { defaults } from '../domain/types';

vi.mock('./native', () => ({ desktop: false, invalidateArtistLookups: vi.fn() }));
const artist = { id: 'saavn:artist:455663', name: 'Anirudh Ravichander', artworkUrl: 'portrait' };
const apple = { ...artist, id: 'itunes:480976476', artworkUrl: 'album' };
const unrelated = { id: 'saavn:artist:9', name: artist.name };
const resolution = { query: artist.name, requestId: 'second', artist, verifiedIds: [artist.id, apple.id] };

it('expires confirmed frontend aliases with the ten-minute provider cache', () => {
  vi.useFakeTimers();
  try {
    vi.mocked(invalidateArtistLookups).mockClear();
    rememberArtistResolution(resolution);
    expect(invalidateArtistLookups).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(600_000);
    expect(invalidateArtistLookups).toHaveBeenCalledTimes(2);
  } finally { vi.useRealTimers(); }
});

it('maps either or both confirmed favorite aliases to one portrait while retaining unrelated namesakes', () => {
  for (const saved of [[artist], [apple], [artist, apple]]) {
    expect(resolvedArtists([...saved, unrelated], [resolution])).toEqual([artist, unrelated]);
    expect(toggleArtistFavorite([...saved, unrelated], artist, resolution.verifiedIds)).toEqual([unrelated]);
  }
  expect(toggleArtistFavorite([unrelated], artist, resolution.verifiedIds)).toEqual([unrelated, artist]);
});

it('rejects a late event from an older query or repeated search of the same query', () => {
  expect(isActiveArtistResolution(resolution, artist.name, 'second')).toBe(true);
  expect(isActiveArtistResolution(resolution, artist.name, 'first')).toBe(false);
  expect(isActiveArtistResolution(resolution, 'Gini', 'second')).toBe(false);
  expect(isActiveArtistResolution(resolution, artist.name, undefined)).toBe(false);
});

it('tombstones both removed aliases while preserving unrelated favorites and prior sync deletions', () => {
  const initial = { ...defaults(), replica: { deviceId: 'test', clock: 0, cells: {}, favoritesInitialized: true } };
  const before = capturePlaylistEdits(initial, { ...initial, favoriteArtists: [artist, apple, unrelated] }, []);
  const removed = capturePlaylistEdits(before, { ...before, favoriteArtists: [artist, apple] }, []);
  const tombstone = removed.replica!.cells[JSON.stringify(['fav-artist', unrelated.id])];
  const after = capturePlaylistEdits(removed, { ...removed, favoriteArtists: toggleArtistFavorite(removed.favoriteArtists, artist, resolution.verifiedIds) }, []);
  for (const id of resolution.verifiedIds) expect(after.replica!.cells[JSON.stringify(['fav-artist', id])].value).toBe(false);
  expect(after.replica!.cells[tombstone.key]).toEqual(tombstone);
});
