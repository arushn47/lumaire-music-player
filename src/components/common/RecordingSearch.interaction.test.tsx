import { expect, it, vi } from 'vitest';
import type { ReactElement, ReactNode } from 'react';
import type { CatalogTrack } from '../../adapters/native';
const hooks = vi.hoisted(() => ({ values: [] as unknown[] }));
vi.mock('react', async original => ({ ...await original<typeof import('react')>(),
  useEffect: () => {}, useLayoutEffect: () => {}, useRef: (current: unknown) => ({ current }), useId: () => 'search-test',
  useState: (initial: unknown) => [hooks.values.length ? hooks.values.shift() : typeof initial === 'function' ? initial() : initial, vi.fn()],
}));
import { DiscoveryView, initialDiscoveryViewState, type DiscoveryViewProps } from '../views/DiscoveryView';
import { TopBarSearch } from './TopBarSearch';

function nodes(node: ReactNode): ReactElement<any>[] {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!node || typeof node !== 'object') return [];
  const element = node as ReactElement<any>;
  return [element, ...nodes(element.props.children)];
}
const rows: CatalogTrack[] = ['saavn:abcdefgh', 'itunes:42'].map((id, index) => ({
  id, title: 'Evening Song', artist: 'Singer', artists: [{ name: 'Singer' }], album: 'Release', duration: 180,
  artworkUrl: index ? 'cover.jpg' : null,
  recordingMetadata: { sourceId: id, isrcs: ['USABC2412345'], releaseDate: null, artistAliases: {} },
}));
it('Discover and top-bar clicks dispatch the exact same original primary record', () => {
  hooks.values = [];
  const play = vi.fn(), noop = vi.fn();
  const props: DiscoveryViewProps = {
    state: { ...initialDiscoveryViewState(), query: 'Evening Song', searchedQuery: 'Evening Song', results: rows },
    onStateChange: noop, mobile: false, busy: false, savedTracks: [], favorites: [], downloads: {},
    ytdlpAvailable: true, engineState: 'installed', engineError: '', engineProgress: null, engineCancelling: false,
    onInstallYoutubeEngine: async () => {}, onCancelYoutubeEngineInstall: async () => {}, onCatalogAction: noop,
    onPlayCollection: noop, onPlayAlbum: async () => {}, onSaveDiscovery: play, onChoosePlaylist: noop,
    onDownloadTrack: noop, onSaveCommons: noop, onQueueRemote: noop, recentRecords: [], historyEnabled: true,
    onReplay: noop, onImportMusic: noop, onOpenLibrary: noop,
  };
  const buttons = nodes(DiscoveryView(props)).filter(node => node.props['aria-label'] === 'Listen to Evening Song');
  expect(buttons).toHaveLength(1);
  buttons[0].props.onClick();
  expect(play).toHaveBeenCalledWith(rows[1], 'play');
  expect(play.mock.calls[0][0]).toBe(rows[1]);
  hooks.values = [true, -1, { query: 'Evening Song', tracks: rows, artists: [], albums: [], error: '', warning: '' }];
  const select = vi.fn();
  const options = nodes(TopBarSearch({ query: 'Evening Song', onSelectTrack: select })).filter(node => node.props.role === 'option');
  expect(options).toHaveLength(2);
  options[1].props.onClick({ target: { closest: () => null } });
  expect(select.mock.calls[0][0]).toBe(rows[1]);
  expect(rows.map(row => row.id)).toEqual(['saavn:abcdefgh', 'itunes:42']);
});
