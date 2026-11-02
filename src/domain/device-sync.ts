import type { Playlist, Session, Track } from './types';
import { portableTrack } from './nearby';

export interface SyncCell { key: string; clock: number; device: string; value: unknown }
export interface SyncPeer { deviceId: string; name: string; lastSeen: number }
export interface PlaylistReplica { deviceId: string; clock: number; cells: Record<string, SyncCell>; favoritesInitialized?: boolean }
export interface SyncState { deviceId: string; clock: number; revision: number; cells: SyncCell[]; historyEnabled: boolean; favoritesEnabled?: boolean }
const key = (...parts: string[]) => JSON.stringify(parts);
const newer = (a: SyncCell, b?: SyncCell) => !b || a.clock > b.clock || a.clock === b.clock && a.device > b.device;
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
export function restoreReplica(value: unknown): PlaylistReplica | undefined {
  const r = value as PlaylistReplica;
  if (!r || typeof r.deviceId !== 'string' || !Number.isSafeInteger(r.clock) || r.clock < 0 || !r.cells || typeof r.cells !== 'object' || Array.isArray(r.cells)) return;
  const cells: Record<string, SyncCell> = {};
  for (const cell of Object.values(r.cells)) {
    if (!cell || typeof cell.key !== 'string' || cell.key.length > (cell.key.startsWith('["fav-') ? 12000 : 2000) || typeof cell.device !== 'string' || !Number.isSafeInteger(cell.clock) || cell.clock <= 0) return;
    let parts: string[];
    try { parts = JSON.parse(cell.key); } catch { return; }
    if (!Array.isArray(parts) || !parts.every(p => typeof p === 'string' && p.length > 0 && p.length <= (parts[0]?.startsWith('fav-') ? 10000 : 700)) || !['name', 'entry', 'removed', 'deleted', 'fav-track', 'fav-artist', 'fav-album'].includes(parts[0]) || JSON.stringify(parts) !== cell.key) return;
    if (parts[0].startsWith('fav-') && (parts.length !== 2 || !validFavorite(parts[0], parts[1], cell.value))) return;
    if (parts[0] === 'name' && (parts.length !== 2 || typeof cell.value !== 'string' || !cell.value || cell.value.length > 400)) return;
    if (['removed', 'deleted'].includes(parts[0]) && (cell.value !== true || parts.length !== (parts[0] === 'removed' ? 3 : 2))) return;
    if (parts[0] === 'entry') {
      const v = cell.value as { track: Track; position: number };
      if (parts.length !== 3 || !v || !Number.isFinite(v.position) || v.position < 0 || v.position > 50000 || !v.track || !portableTrack(v.track)) return;
    }
    cells[cell.key] = cell;
  }
  return { deviceId: r.deviceId, clock: Object.values(cells).reduce((clock,c)=>Math.max(clock,c.clock),r.clock), cells, ...(r.favoritesInitialized ? { favoritesInitialized: true } : {}) };
}

function validFavorite(kind: string, id: string, value: unknown): boolean {
  if (value === false) return true;
  if (!value || typeof value !== 'object') return false;
  if (kind === 'fav-track') return portableTrack(value as Track)?.id === id;
  const v = value as Record<string, unknown>;
  const identity = kind === 'fav-artist'
    ? /^(?:musicbrainz:artist:[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}|saavn:artist:[1-9]\d{0,19}|itunes:[1-9]\d{0,19}|(?:saavn:)?artist:name:[^:]{1,1200})$/
    : /^(?:musicbrainz:release:[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}|saavn:album:[1-9]\d{0,19}|itunes:[1-9]\d{0,19}|saavn:album:search:[^:]{1,1200}:[^:]{1,1200})$/;
  return v.id === id && identity.test(id) && (kind === 'fav-artist' ? ['name'] : ['title', 'artist']).every(field => typeof v[field] === 'string' && (v[field] as string).length <= 4000 && (field !== 'name' || (v[field] as string).trim().length > 0));
}

function favoriteValues(session: Session, tracks: Track[]): Map<string, unknown> {
  const values = new Map<string, unknown>();
  const saved = new Map(tracks.map(t => [t.id, t]));
  for (const id of session.favorites) {
    const track = portableTrack(saved.get(id));
    if (track) values.set(key('fav-track', track.id), track);
  }
  for (const artist of session.favoriteArtists) values.set(key('fav-artist', artist.id), artist);
  for (const album of session.favoriteAlbums) values.set(key('fav-album', album.id), album);
  return values;
}

function captureFavoriteEdits(before: Session, after: Session, tracks: Track[]): Session {
  if (!before.replica || before.replica !== after.replica) return after;
  const seed = !before.replica.favoritesInitialized;
  if (!seed && before.favorites === after.favorites && before.favoriteArtists === after.favoriteArtists && before.favoriteAlbums === after.favoriteAlbums) return after;
  const replica = { ...before.replica, cells: { ...before.replica.cells }, favoritesInitialized: true };
  const previous = favoriteValues(before, tracks), current = favoriteValues(after, tracks);
  const clock = replica.clock + 1;
  for (const k of new Set([...previous.keys(), ...current.keys()])) {
    if (!seed && previous.has(k) === current.has(k)) continue;
    // Seed only existing likes; absence on a newly paired device is never an unlike.
    if (seed && replica.cells[k] && previous.has(k) === current.has(k)) continue;
    replica.cells[k] = { key: k, clock, device: replica.deviceId, value: current.get(k) ?? false };
  }
  replica.clock = clock;
  return { ...after, replica };
}

/** Capture user intent at the edit, before asynchronous persistence or networking. */
export function capturePlaylistEdits(before: Session, after: Session, tracks: Track[]): Session {
  if (!before.replica || before.replica !== after.replica || before.playlists === after.playlists) return captureFavoriteEdits(before, after, tracks);
  const replica = { ...before.replica, cells: { ...before.replica.cells } };
  const clock = replica.clock + 1;
  const put = (parts: string[], value: unknown) => {
    const k = key(...parts);
    replica.cells[k] = { key: k, clock, device: replica.deviceId, value };
  };
  const saved = new Map(tracks.map(t => [t.id, t]));
  const previous = new Map(before.playlists.map(p => [p.id, p]));
  for (const p of after.playlists) {
    if (replica.cells[key('deleted', p.id)]) continue;
    const old = previous.get(p.id);
    if (!old || old.name !== p.name) put(['name', p.id], p.name);
    const prior = new Map(old?.items.map((e, position) => [e.id, { ...e, position }]) || []);
    p.items.forEach((entry, position) => {
      const track = portableTrack(saved.get(entry.trackId));
      const oldEntry = prior.get(entry.id);
      if (track && (!oldEntry || oldEntry.trackId !== entry.trackId || oldEntry.position !== position)) put(['entry', p.id, entry.id], { track, position });
    });
    const present = new Set(p.items.map(e => e.id));
    for (const e of old?.items || []) if (!present.has(e.id)) put(['removed', p.id, e.id], true);
  }
  const present = new Set(after.playlists.map(p => p.id));
  for (const p of before.playlists) if (!present.has(p.id)) put(['deleted', p.id], true);
  replica.clock = clock;
  return captureFavoriteEdits({ ...before, replica }, { ...after, replica }, tracks);
}

export function replicaTracks(cells: SyncCell[]): Track[] {
  const merged: Record<string, SyncCell> = {};
  for (const cell of cells) if (newer(cell, merged[cell.key])) merged[cell.key] = cell;
  const tracks = Object.values(merged).flatMap(cell => {
    const [kind, playlist, entry] = JSON.parse(cell.key) as string[];
    if (kind === 'fav-track' && cell.value !== false) return [cell.value as Track];
    return kind === 'entry' && !merged[key('deleted', playlist)] && !merged[key('removed', playlist, entry)] ? [(cell.value as { track: Track }).track] : [];
  });
  return [...new Map(tracks.map(track => [track.id, track])).values()];
}

export function mergePlaylistReplica(session: Session, state: SyncState, tracks: Track[]): Session {
  let current = session;
  if (!session.replica) {
    // Old one-way imports used new item IDs. Canonicalize only the first migration.
    const playlists = session.playlists.map(p => {
      const id = p.syncSource || p.id, occurrences = new Map<string, number>();
      return { ...p, id, syncSource: undefined, syncFingerprint: undefined, syncLocalFingerprint: undefined,
        items: p.items.map(e => {
          const portable = portableTrack(tracks.find(t => t.id === e.trackId));
          if (!portable) return e;
          const n = occurrences.get(portable.id) || 0; occurrences.set(portable.id, n + 1);
          return { ...e, id: key('legacy', id, portable.id, String(n)) };
        }) };
    });
    const replica = { deviceId: state.deviceId, clock: state.clock, cells: {} };
    current = capturePlaylistEdits({ ...session, playlists: [], replica }, { ...session, playlists, replica }, tracks);
  }
  current = captureFavoriteEdits(current, current, tracks);
  const replica: PlaylistReplica = { ...current.replica!, deviceId: state.deviceId, clock: Math.max(current.replica!.clock, state.clock), cells: { ...current.replica!.cells } };
  for (const cell of state.cells) if (newer(cell, replica.cells[cell.key])) replica.cells[cell.key] = cell;
  const local = new Map(current.playlists.map(p => [p.id, p]));
  const aliases = new Map<string, string>(), favoriteAliases = new Map<string, string[]>();
  for (const track of tracks) {
    const portable = portableTrack(track);
    if (!portable) continue;
    aliases.set(portable.id, track.id);
    favoriteAliases.set(portable.id, [...(favoriteAliases.get(portable.id) || []), track.id]);
  }
  const playlists: Playlist[] = [];
  const byPlaylist = new Map<string, { id: string; trackId: string; position: number }[]>();
  for (const c of Object.values(replica.cells)) {
    const [kind, playlist, entry] = JSON.parse(c.key) as string[];
    if (kind !== 'entry' || replica.cells[key('removed', playlist, entry)]) continue;
    const v = c.value as { track: Track; position: number };
    const entries = byPlaylist.get(playlist) || [];
    entries.push({ id: entry, trackId: aliases.get(v.track.id) || v.track.id, position: v.position });
    byPlaylist.set(playlist, entries);
  }
  for (const cell of Object.values(replica.cells).sort((a, b) => compare(a.key, b.key))) {
    const [kind, id] = JSON.parse(cell.key) as string[];
    if (kind !== 'name' || replica.cells[key('deleted', id)]) continue;
    const entries = (byPlaylist.get(id) || []).sort((a, b) => a.position - b.position || compare(a.id, b.id));
    const p = local.get(id);
    const items = entries.map(({ id, trackId }) => ({ id, trackId }));
    p?.items.forEach((e, position) => { if (!portableTrack(tracks.find(t => t.id === e.trackId))) items.splice(Math.min(position, items.length), 0, e); });
    playlists.push({ ...p, id, name: cell.value as string, items });
  }
  let result = { ...current, replica, playlists };
  if (state.favoritesEnabled !== false) {
    const favorites = new Set(current.favorites);
    const artists = new Map(current.favoriteArtists.map(a => [a.id, a]));
    const albums = new Map(current.favoriteAlbums.map(a => [a.id, a]));
    for (const cell of Object.values(replica.cells)) {
      const [kind, id] = JSON.parse(cell.key) as string[];
      if (kind === 'fav-track') {
        const matching = favoriteAliases.get(id) || [];
        const localId = matching.find(trackId => favorites.has(trackId)) || aliases.get(id);
        for (const trackId of matching) favorites.delete(trackId);
        if (localId) { if (cell.value === false) favorites.delete(localId); else favorites.add(localId); }
      } else if (kind === 'fav-artist') {
        if (cell.value === false) artists.delete(id); else artists.set(id, cell.value as Session['favoriteArtists'][number]);
      } else if (kind === 'fav-album') {
        if (cell.value === false) albums.delete(id); else albums.set(id, cell.value as Session['favoriteAlbums'][number]);
      }
    }
    result = { ...result, favorites: [...favorites].sort(compare), favoriteArtists: [...artists.values()].sort((a,b) => compare(a.id,b.id)), favoriteAlbums: [...albums.values()].sort((a,b) => compare(a.id,b.id)) };
  }
  return result;
}
