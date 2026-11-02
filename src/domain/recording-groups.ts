import type { CatalogTrack } from '../adapters/native';
import type { Track } from './types';
import { isCatalogId } from './queue';

export interface RecordingGroup {
  primary: CatalogTrack;
  records: CatalogTrack[];
}

const text = (value: string): string => value.normalize('NFC').trim().toLocaleLowerCase().replace(/\s+/g, ' ');
const versions = /\b(?:studio|acoustic|live|remix|instrumental|cover|karaoke|demo|remaster(?:ed)?|reprise|female|male|radio edit|extended|sped up|slowed|nightcore|mashup)\b/gi;
const labels = (title: string): string => [...new Set(title.match(versions)?.map(text) || [])].sort().join('|');
const codes = (row: CatalogTrack): string[] => row.recordingMetadata?.sourceId === row.id
  ? row.recordingMetadata.isrcs.filter(code => /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/.test(code)) : [];

export function equivalentRecording(a: CatalogTrack, b: CatalogTrack): boolean {
  if (!isCatalogId(a.id) || !isCatalogId(b.id) || !text(a.title) || text(a.title) !== text(b.title)) return false;
  if (!Number.isFinite(a.duration) || !Number.isFinite(b.duration) || Math.min(a.duration, b.duration) <= 0 || Math.abs(a.duration-b.duration) > 2) return false;
  if (labels(a.title) !== labels(b.title) || (a.language && b.language && text(a.language) !== text(b.language))) return false;
  if (!a.artists.length || !b.artists.length || [...a.artists, ...b.artists].some(credit => !text(credit.name) || /^unknown(?: artist)?$/i.test(credit.name.trim()))) return false;
  const left = [...new Set(a.artists.map(credit => text(credit.name)))].sort();
  const right = [...new Set(b.artists.map(credit => text(credit.name)))].sort();
  if (left.join('\0') !== right.join('\0')) return false;
  // Even a shared ISRC cannot override conflicting artist IDs supplied by the same provider.
  for (const x of a.artists) for (const y of b.artists) {
    if (text(x.name) === text(y.name) && x.id && y.id && x.id.split(':')[0] === y.id.split(':')[0] && x.id !== y.id) return false;
  }
  const ac = codes(a), bc = codes(b);
  const overlap = ac.some(code => bc.includes(code));
  if (ac.length && bc.length && !overlap) return false;
  return a.id === b.id || overlap;
}

/** Presentation only: every member and the primary remain the original provider objects. */
export function groupRecordings(rows: readonly CatalogTrack[], saved: readonly Track[] = [], favorites: readonly string[] = []): RecordingGroup[] {
  const score = (row: CatalogTrack): number => {
    const known = saved.filter(track => track.id === row.id || track.metadataSourceId === row.id);
    // Only an actual available offline copy establishes playback availability here.
    const offline = known.some(track => track.offline && !track.missing);
    const favorite = known.some(track => favorites.includes(track.id)) || favorites.includes(row.id);
    return Number(offline)*100 + Number(favorite)*50 + Number(Boolean(row.artworkUrl))*8
      + Number(row.artists.every(credit => Boolean(credit.id)))*4 + Number(Boolean(row.album))*2
      + Number(Boolean(row.language)) + Number(Boolean(row.genre));
  };
  const groups: RecordingGroup[] = [];
  for (const row of rows) {
    // Complete-link matching prevents a multi-ISRC row from bridging conflicting recordings.
    const group = groups.find(candidate => candidate.records.every(member => equivalentRecording(member, row)));
    if (!group) groups.push({ primary: row, records: [row] });
    else {
      group.records.push(row);
      if (score(row) > score(group.primary)) group.primary = row;
    }
  }
  return groups;
}
