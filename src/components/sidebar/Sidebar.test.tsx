import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Sidebar } from './Sidebar';
import { libraryCollections } from '../../domain/collections';
import { item, type Track } from '../../domain/types';

it('matches playlist covers with a four-cover collage, single cover or empty fallback', () => {
  for (const count of [0, 1, 3, 4]) {
    const tracks = Array.from({ length: count }, (_, i) => ({ id: String(i), artworkUrl: `https://example.com/${i}.jpg` } as Track));
    const playlists = [{ id: 'mix', name: 'My mix', items: tracks.map(track => item(track.id)) }];
    const html = renderToStaticMarkup(<Sidebar view="mix" setView={()=>{}} onHome={()=>{}} collectionsCount={1} playlists={playlists} collections={libraryCollections(tracks, playlists)} hasLyricsDoc={false} onCreatePlaylist={()=>{}} />);
    expect(html).toContain('title="My mix"');
    expect(html).toContain('class="selected"');
    expect((html.match(/class="cover /g) || []).length).toBe(count >= 4 ? 4 : count ? 1 : 0);
    expect(html.includes('sidebar-playlist-cover is-mosaic')).toBe(count >= 4);
    if (!count) expect(html).toContain('lucide-list-music');
  }
});

it('renders draggable sidebar resizer with accessible separator role when onResizeStart is provided', () => {
  const html = renderToStaticMarkup(
    <Sidebar
      view="mix"
      setView={() => {}}
      onHome={() => {}}
      collectionsCount={1}
      playlists={[]}
      collections={[]}
      hasLyricsDoc={false}
      onCreatePlaylist={() => {}}
      onResizeStart={() => {}}
      onResizeReset={() => {}}
    />,
  );
  expect(html).toContain('class="sidebar-resizer"');
  expect(html).toContain('role="separator"');
  expect(html).toContain('aria-orientation="vertical"');
});


it('orders playlists by latest edit with stable legacy ordering without mutating the session', () => {
  const playlists = [
    { id: 'legacy-a', name: 'Legacy A', items: [] },
    { id: 'older', name: 'Older edit', items: [], updatedAt: 10 },
    { id: 'latest', name: 'Latest edit', items: [], updatedAt: 20 },
    { id: 'legacy-b', name: 'Legacy B', items: [] },
  ];
  const html = renderToStaticMarkup(<Sidebar view="home" setView={()=>{}} onHome={()=>{}} collectionsCount={4} playlists={playlists} collections={[]} hasLyricsDoc={false} onCreatePlaylist={()=>{}} />);
  const positions = ['Latest edit', 'Older edit', 'Legacy A', 'Legacy B'].map(name => html.indexOf(`title="${name}"`));
  expect(positions.every(position => position >= 0)).toBe(true);
  expect(positions).toEqual([...positions].sort((a, b) => a - b));
  expect(playlists[0].id).toBe('legacy-a');
});

it('renders search button in mobile header actions when onSearch is provided', () => {
  const html = renderToStaticMarkup(
    <Sidebar
      view="search"
      setView={() => {}}
      onHome={() => {}}
      collectionsCount={0}
      playlists={[]}
      collections={[]}
      hasLyricsDoc={false}
      onCreatePlaylist={() => {}}
      onSearch={() => {}}
    />,
  );
  expect(html).toContain('aria-label="Search"');
  expect(html).toContain('mobile-header-btn selected');
});
