import { expect, it } from 'vitest';
import type { CatalogTrack } from '../adapters/native';
import type { Track } from './types';
import { equivalentRecording, groupRecordings } from './recording-groups';

const code = 'USABC2412345';
function row(id: string, changes: Partial<CatalogTrack> = {}): CatalogTrack {
  return { id, title: 'Evening Song', artist: 'Gini, Guest', artists: [{ name: 'Gini', id: `${id.split(':')[0]}:artist:1` }, { name: 'Guest' }], album: 'Release', duration: 180,
    recordingMetadata: { sourceId: id, isrcs: [code], releaseDate: null, artistAliases: {} }, ...changes };
}
it('groups cross-provider recordings reversibly without changing any provider object', () => {
  const rows = [row('saavn:abcdefgh'), row('itunes:42', { artworkUrl: 'cover.jpg' }), row('musicbrainz:recording:42dfbd2f-cecb-4715-9072-a6f614c5469e')];
  const snapshot = JSON.stringify(rows);
  const groups = groupRecordings(rows);
  expect(groups).toHaveLength(1); expect(groups[0].primary).toBe(rows[1]);
  expect(groups[0].records).toEqual(rows);
  groups[0].records.forEach((record, index) => expect(record).toBe(rows[index]));
  expect(JSON.stringify(rows)).toBe(snapshot);
});
it('keeps missing and conflicting evidence separate even when names and duration match', () => {
  const a = row('saavn:abcdefgh');
  for (const changes of [
    { recordingMetadata: null }, { artists: [] }, { artists: [{ name: 'Other artist' }] },
    { artists: [{ name: 'Gini' }] }, { duration: 0 }, { duration: NaN }, { duration: 183 },
    { recordingMetadata: { sourceId: 'itunes:42', isrcs: ['USABC2499999'], releaseDate: null, artistAliases: {} } },
    { recordingMetadata: { sourceId: 'itunes:99', isrcs: [code], releaseDate: null, artistAliases: {} } },
  ]) expect(equivalentRecording(a, row('itunes:42', changes))).toBe(false);
  expect(equivalentRecording({ ...a, recordingMetadata: null }, row('itunes:42', { recordingMetadata: null }))).toBe(false);
});
it('preserves collaborators, language, and every distinct recording version', () => {
  const a = row('saavn:abcdefgh');
  for (const version of ['Studio', 'Acoustic', 'Live', 'Remix', 'Instrumental', 'Cover', 'Female Version', 'Slowed', 'Remastered'])
    expect(groupRecordings([a, row('itunes:42', { title: `Evening Song (${version})` })])).toHaveLength(2);
  expect(equivalentRecording({ ...a, language: 'hindi' }, row('itunes:42', { language: 'tamil' }))).toBe(false);
  expect(equivalentRecording(a, row('itunes:42', { artists: [{ name: 'Guest' }, { name: 'Gini', id: 'itunes:artist:2' }] }))).toBe(true);
});
it('does not equate same-name Gini identities or use artist equivalence as recording evidence', () => {
  const a = row('saavn:abcdefgh', { artists: [{ name: 'Gini', id: 'saavn:artist:1249318' }] });
  const b = row('saavn:ijklmnop', { artists: [{ name: 'Gini', id: 'saavn:artist:20043211' }] });
  expect(equivalentRecording(a,b)).toBe(false);
  expect(equivalentRecording({ ...a, recordingMetadata: null }, row('itunes:42', { artists: a.artists, recordingMetadata: null }))).toBe(false);
});
it('never bridges conflicting ISRCs through a third record', () => {
  const a = row('saavn:abcdefgh'), b = row('itunes:42'), c = row('itunes:43');
  b.recordingMetadata!.isrcs.push('USABC2499999'); c.recordingMetadata!.isrcs = ['USABC2499999'];
  const groups = groupRecordings([a,b,c]);
  expect(groups.map(group => group.records.length)).toEqual([2,1]);
});
it('prefers a confirmed offline copy and preserves the exact clicked provider ID', () => {
  const a = row('saavn:abcdefgh', { artworkUrl: 'cover.jpg' }), b = row('itunes:42');
  const saved = { id: 'youtube:abcdefghijk', metadataSourceId: b.id, offline: true, missing: false } as Track;
  expect(groupRecordings([a,b], [saved])[0].primary).toBe(b);
  expect(groupRecordings([a,b], [{ ...saved, missing: true }])[0].primary).toBe(a);
  expect(groupRecordings([a,b], [{ ...saved, offline: false }], [saved.id])[0].primary.id).toBe(b.id);
});
