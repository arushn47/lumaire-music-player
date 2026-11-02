import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { DiscoveryHome, type DiscoveryHomeProps } from './DiscoveryHome';
import { checkpointListening } from '../../domain/home-listening';
import { defaults, type Track } from '../../domain/types';
import type { ListeningRecord } from '../../domain/listening';

vi.mock('../../adapters/discovery-home', () => ({ DISCOVERY_PREFERENCES_CHANGED: 'preferences', discoveryPreferences: () => ({ languages: ['tamil'] }) }));
const noop = () => {};
const song = (id: string): Track => ({ id, title: id, artist: id, album: id, duration: 200, fileName: `${id}.mp3`, missing: false, format: 'MP3' });
const now = Date.now();
const record = (track: Track, age: number, id = track.id): ListeningRecord => ({ id, trackId: track.id, title: track.title, artist: track.artist, album: track.album, artworkUrl: null, providerId: null, sourceId: null, startedAt: now - age * 86400000, updatedAt: now - age * 86400000, listenedMs: 90000, days: {} });
const base: DiscoveryHomeProps = { onPlayAlbum: async () => {}, onPlayQuickPick: noop, searches: [], records: [], savedTracks: [], busy: false, onlineAvailable: false, onSearch: noop, onClearSearches: noop, onReplay: noop };

describe('Home shelves', () => {
  it('shows only Quick Picks for a new mobile listener', () => {
    const html = renderToStaticMarkup(<DiscoveryHome {...base} mobile />);
    expect([...html.matchAll(/<section aria-label="([^"]+)"/g)].map(match => match[1])).toEqual(['Quick Picks']);
    expect(html).not.toContain('on this device');
    expect(html).not.toContain('recent-track-item');
  });
  it.each([false, true])('renders populated shelves in order (mobile=%s)', mobile => {
    const [recent, rotation, forgotten, unheard, resumeA, resumeB] = ['Recent song', 'Rotation song', 'Old favorite', 'Unheard song', 'Continue A', 'Continue B'].map(song);
    const tracks = [recent, rotation, forgotten, unheard, resumeA, resumeB];
    const s = { ...defaults(), queue: [{ id: 'a', trackId: resumeA.id }, { id: 'b', trackId: resumeB.id }], currentId: 'a' };
    const resumes = checkpointListening(s, tracks, 38).listeningResumes;
    const html = renderToStaticMarkup(<DiscoveryHome {...base} mobile={mobile} savedTracks={tracks} favorites={[forgotten.id]} resumes={resumes} records={[record(recent, 1), ...[1, 2, 3].map((d, i) => record(rotation, d, `r${i}`)), record(forgotten, 60)]} />);
    const labels = [...html.matchAll(/<section aria-label="([^"]+)"/g)].map(match => match[1]);
    expect(labels).toEqual(['Recently Played', 'Continue Listening', 'Quick Picks', 'Your Rotation', 'Forgotten Favorites']);
    for (const track of [recent, unheard]) expect(html.match(new RegExp(`title="Play ${track.title}"`, 'g'))).toHaveLength(1);
    for (const track of [rotation, forgotten]) expect(html.match(new RegExp(`title="Play ${track.title}"`, 'g'))).toHaveLength(2);
    expect(html).toContain('0:38');
    expect(html).not.toContain('Made for You');
    const rotationHtml = html.slice(html.indexOf('<section aria-label="Your Rotation"'), html.indexOf('<section aria-label="Forgotten Favorites"'));
    expect(rotationHtml).toContain('album-card-cover-wrap');
    expect(rotationHtml).toContain('discover-rotation-carousel');
    expect(rotationHtml).not.toContain('recent-track-item');
  });
  it('does not hide the latest played song because its queue can be resumed', () => {
    const first = song('Latest listen'), second = song('Another song');
    const session = { ...defaults(), queue: [{ id: 'a', trackId: first.id }, { id: 'b', trackId: second.id }], currentId: 'a' };
    const resumes = checkpointListening(session, [first, second], 45).listeningResumes;
    const html = renderToStaticMarkup(<DiscoveryHome {...base} savedTracks={[first, second]} records={[record(first, 0)]} resumes={resumes} />);
    const recent = html.slice(html.indexOf('<section aria-label="Recently Played"'), html.indexOf('<section aria-label="Continue Listening"'));
    expect(recent).toContain('Latest listen');
  });
  it('does not fabricate recent, rotation, forgotten or resume sections from a saved library', () => {
    const html = renderToStaticMarkup(<DiscoveryHome {...base} savedTracks={[song('Unheard')]} />);
    expect(html).toContain('Quick Picks');
    for (const label of ['Recently Played', 'Continue Listening', 'Your Rotation', 'Forgotten Favorites']) expect(html).not.toContain(`aria-label="${label}"`);
    expect(renderToStaticMarkup(<DiscoveryHome {...base} />)).not.toContain('<section');
  });
  it('renders clickable artist links on desktop while keeping plain text on mobile', () => {
    const track = { ...song('Test Song'), artist: 'Featured Artist' };
    const desktopHtml = renderToStaticMarkup(<DiscoveryHome {...base} mobile={false} savedTracks={[track]} records={[record(track, 0)]} onNavigateArtist={noop} />);
    const desktopRecent = desktopHtml.slice(desktopHtml.indexOf('<section aria-label="Recently Played"'), desktopHtml.indexOf('</section>'));
    expect(desktopRecent).toContain('<button type="button" class="link-button">Featured Artist</button>');

    const mobileHtml = renderToStaticMarkup(<DiscoveryHome {...base} mobile={true} savedTracks={[track]} records={[record(track, 0)]} onNavigateArtist={noop} />);
    const mobileRecent = mobileHtml.slice(mobileHtml.indexOf('<section aria-label="Recently Played"'), mobileHtml.indexOf('</section>'));
    expect(mobileRecent).toContain('Featured Artist');
    expect(mobileRecent).not.toContain('<button type="button" class="link-button">Featured Artist</button>');
  });
});
