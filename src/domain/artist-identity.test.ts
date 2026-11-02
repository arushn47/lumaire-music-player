import { describe, expect, it, vi } from 'vitest';
import type { CatalogTrack } from '../adapters/native';
import { artistLookupName, artistReference, isArtistId, resolveArtistCredit } from './catalog-links';
import { restoreSession } from './session';

const track: CatalogTrack = { id: 'itunes:1871378610', title: 'Feeka', artist: 'gini & NEVERSOBER', artistId: 'itunes:1629301422', artists: [{ name: 'gini' }, { name: 'NEVERSOBER' }], album: 'Feeka', duration: 163.5, artworkUrl: null };
const primary = vi.fn(async (id: string) => ({ info: { id, name: 'gini', artworkUrl: null } }));

describe('provider-scoped artist contract', () => {
  it('keeps all three Gini identities through search, song, album and favorite navigation', async () => {
    for (const id of ['saavn:artist:1249318', 'saavn:artist:20043211', 'itunes:1629301422']) {
      const lookup = vi.fn();
      expect(await resolveArtistCredit({ name: 'Gini', id }, track.id, lookup, primary)).toBe(id);
      expect(lookup).not.toHaveBeenCalled();
    }
  });
  it('binds an Apple primary collaboration ID only after looking up that exact identity', async () => {
    const lookup = vi.fn(async () => track);
    expect(await resolveArtistCredit({ name: 'gini' }, track.id, lookup, primary)).toBe('itunes:1629301422');
    expect(await resolveArtistCredit({ name: 'NEVERSOBER' }, track.id, lookup, primary)).toBe(artistReference('NEVERSOBER'));
    expect(await resolveArtistCredit({ name: 'Ginikachukwu' }, track.id, lookup, primary)).toBe(artistReference('Ginikachukwu'));
  });
  it('preserves ambiguous, conflicting, missing and unavailable recording evidence', async () => {
    const credit = { name: 'Gini' };
    for (const row of [
      { ...track, id: 'itunes:99' },
      { ...track, artists: [{ name: 'Gini', id: 'saavn:artist:1' }, { name: 'Gini', id: 'saavn:artist:2' }] },
      { ...track, artistId: null },
    ]) expect(await resolveArtistCredit(credit, track.id, async () => row, async id => ({ info: { id, name: 'Other artist', artworkUrl: null } }))).toBe(artistReference('Gini'));
    expect(await resolveArtistCredit(credit, track.id, async () => { throw Error('offline'); }, primary)).toBe(artistReference('Gini'));
    expect(await resolveArtistCredit(credit, null, async () => track, primary)).toBe(artistReference('Gini'));
  });
  it('uses aliases and capitalization only inside an already identified recording credit', async () => {
    const id = 'musicbrainz:artist:46579862-aa41-4574-b16c-05e6d0b6dbeb';
    expect(await resolveArtistCredit({ name: 'An alias', id }, null, vi.fn(), primary)).toBe(id);
    expect(await resolveArtistCredit({ name: 'GINI' }, track.id, async () => ({ ...track, artists: [{ name: 'gini', id: 'itunes:1629301422' }] }), primary)).toBe('itunes:1629301422');
    expect(artistReference('Emiway')).not.toBe(artistReference('Emiway Bantai'));
  });
  it('rejects synthetic and malformed identities, retaining legacy names as choices', () => {
    for (const id of ['artist:name:gini', 'saavn:artist:name:Gini', 'itunes:0', 'itunes:01', 'saavn:artist:unknown', 'musicbrainz:artist:invalid']) expect(isArtistId(id)).toBe(false);
    expect(artistLookupName('saavn:artist:name:Gini')).toBe('Gini');
    expect(artistLookupName('saavn:artist:Emiway')).toBe('Emiway');
    expect(artistLookupName('saavn:artist:20043211')).toBeNull();
    expect(artistLookupName('artist:name:%broken')).toBeNull();
  });
  it('preserves stored same-name and unresolved favorites without migration', () => {
    const favoriteArtists = ['saavn:artist:1249318', 'saavn:artist:20043211', 'itunes:1629301422', 'artist:name:Gini'].map(id => ({ id, name: 'Gini' }));
    expect(restoreSession({ favoriteArtists }, []).favoriteArtists.map(row => row.id)).toEqual(favoriteArtists.map(row => row.id));
  });
});
