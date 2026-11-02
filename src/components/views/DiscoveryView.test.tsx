import { expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { DiscoveryView, initialDiscoveryViewState, type DiscoveryViewProps } from './DiscoveryView';

vi.mock('./DiscoverShelves', () => ({ DiscoverShelves: () => null }));

it('uses category-specific imagery rather than unrelated library or release covers', () => {
  const noop = vi.fn();
  const props: DiscoveryViewProps = {
    state: initialDiscoveryViewState(), onStateChange: noop, mobile: true, busy: false,
    savedTracks: [{ id: 'test', title: 'Unrelated soundtrack', artist: 'Artist', album: 'Album', artworkUrl: 'https://example.com/unrelated-album.jpg', duration: 100, fileName: '', format: 'MP3', missing: false }],
    favorites: [], downloads: {}, ytdlpAvailable: true, engineState: 'installed', engineError: '', engineProgress: null, engineCancelling: false,
    onInstallYoutubeEngine: async () => {}, onCancelYoutubeEngineInstall: async () => {},
    onCatalogAction: noop, onPlayCollection: noop, onPlayAlbum: async () => {}, onSaveDiscovery: noop,
    onChoosePlaylist: noop, onDownloadTrack: noop, onSaveCommons: noop, onQueueRemote: noop,
    recentRecords: [], historyEnabled: true, onReplay: noop, onImportMusic: noop, onOpenLibrary: noop,
  };
  const html = renderToStaticMarkup(<DiscoveryView {...props} />);
  expect(html).toContain('Moods &amp; moments');
  expect(html).toContain('Genres');
  expect(html).toContain('images.unsplash.com/photo-1518495973542-4542c06a5843');
  expect(html).not.toContain('unrelated-album.jpg');
  expect(html).not.toContain('featured-hero.jpg');
});


it('renders Nuclear-inspired search filter pills with songs first, and switches views cleanly', () => {
  const noop = vi.fn();
  const baseProps: DiscoveryViewProps = {
    state: {
      ...initialDiscoveryViewState(),
      searchedQuery: 'hola amigo',
      results: [
        { id: 'track-1', title: 'Hola Amigo Track', artist: 'KR$NA', artists: [], album: 'Far from Over', artworkUrl: 'https://example.com/t.jpg', duration: 180 },
      ],
      albums: [
        { id: 'album-1', title: 'Hola Amigo Album', artist: 'KR$NA', artists: [{ name: 'KR$NA' }], artworkUrl: 'https://example.com/a.jpg', year: 2021 },
      ],
      artists: [
        { id: 'artist-1', name: 'Hola Amigo Artist', artworkUrl: 'https://example.com/art.jpg' },
      ],
      filter: 'songs',
    },
    onStateChange: noop, mobile: false, busy: false,
    savedTracks: [], favorites: [], downloads: {}, ytdlpAvailable: true, engineState: 'installed', engineError: '', engineProgress: null, engineCancelling: false,
    onInstallYoutubeEngine: async () => {}, onCancelYoutubeEngineInstall: async () => {},
    onCatalogAction: noop, onPlayCollection: noop, onPlayAlbum: async () => {}, onSaveDiscovery: noop,
    onChoosePlaylist: noop, onDownloadTrack: noop, onSaveCommons: noop, onQueueRemote: noop,
    recentRecords: [], historyEnabled: true, onReplay: noop, onImportMusic: noop, onOpenLibrary: noop,
  };

  // 1. Default (songs): shows songs list, tabs, but not album or artist grids
  const songsHtml = renderToStaticMarkup(<DiscoveryView {...baseProps} />);
  expect(songsHtml).toContain('search-filter-pills');
  expect(songsHtml).toContain('id="search-filter-songs"');
  expect(songsHtml).toContain('aria-selected="true"');
  expect(songsHtml).toContain('Hola Amigo Track');
  expect(songsHtml).not.toContain('search-albums-grid');
  expect(songsHtml).not.toContain('search-artists-grid');

  // 2. Albums tab: shows album grid, not songs list
  const albumsHtml = renderToStaticMarkup(<DiscoveryView {...baseProps} state={{ ...baseProps.state, filter: 'albums' }} />);
  expect(albumsHtml).toContain('search-albums-grid');
  expect(albumsHtml).toContain('Hola Amigo Album');
  expect(albumsHtml).not.toContain('track-header');

  // 3. Artists tab: shows artist grid
  const artistsHtml = renderToStaticMarkup(<DiscoveryView {...baseProps} state={{ ...baseProps.state, filter: 'artists' }} />);
  expect(artistsHtml).toContain('search-artists-grid');
  expect(artistsHtml).toContain('Hola Amigo Artist');
  expect(artistsHtml).not.toContain('track-header');
  const identities = ['saavn:artist:1249318', 'saavn:artist:20043211', 'itunes:1629301422'];
  const homonymsHtml = renderToStaticMarkup(<DiscoveryView {...baseProps} state={{ ...baseProps.state, filter: 'artists', artists: identities.map(id => ({ id, name: 'Gini', artworkUrl: null })) }} />);
  expect(homonymsHtml.match(/class="search-artist-card"/g)).toHaveLength(3);
  for (const id of identities) expect(homonymsHtml).toContain(`data-artist-id="${id}"`);
  const visibleText = homonymsHtml.replace(/<[^>]*>/g, '');
  expect(visibleText).not.toMatch(/Apple|JioSaavn|1249318|20043211|1629301422/);
  const duplicates = ['saavn:abcdefgh', 'itunes:42'].map(id => ({ id, title: 'Same recording', artist: 'Gini', artists: [{ name: 'Gini' }], duration: 180, album: 'Release', recordingMetadata: { sourceId: id, isrcs: ['USABC2412345'], releaseDate: null, artistAliases: {} } }));
  const grouped = renderToStaticMarkup(<DiscoveryView {...baseProps} state={{ ...baseProps.state, filter: 'songs', results: duplicates }} />);
  expect(grouped.match(/aria-label="Listen to Same recording"/g)).toHaveLength(1);
  expect(duplicates).toHaveLength(2);
});
