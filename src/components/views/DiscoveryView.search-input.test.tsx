import { afterEach, expect, it, vi } from 'vitest';
import type { ReactElement, ReactNode } from 'react';

const mock = vi.hoisted(() => ({
  effects: [] as { run: () => void | (() => void); deps?: unknown[] }[],
  search: vi.fn(async () => []),
  entities: vi.fn(async () => ({ artists: [], albums: [] })),
}));
vi.mock('react', async original => ({ ...await original<typeof import('react')>(),
  useEffect: (run: () => void | (() => void), deps?: unknown[]) => mock.effects.push({ run, deps }),
  useLayoutEffect: () => {}, useRef: (current: unknown) => ({ current }),
  useState: (initial: unknown) => [typeof initial === 'function' ? initial() : initial, vi.fn()],
}));
vi.mock('../../adapters/native', () => ({ library: { searchCatalogEntities: mock.entities }, desktop: false, mobile: false }));
vi.mock('../../domain/search-retrieval', () => ({ searchRetrieval: mock.search }));
import { DiscoveryView, initialDiscoveryViewState, type DiscoveryViewProps } from './DiscoveryView';

function nodes(node: ReactNode): ReactElement<any>[] {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!node || typeof node !== 'object') return [];
  const element = node as ReactElement<any>;
  return [element, ...nodes(element.props.children)];
}

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); mock.effects = []; });

it('keeps the space between typed words after debounce while trimming only the provider query', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('window', { setTimeout, clearTimeout });
  let state = { ...initialDiscoveryViewState(), query: 'Anirudh ' };
  const noop = vi.fn();
  const props: DiscoveryViewProps = {
    state, onStateChange: update => { state = update(state); }, mobile: true, busy: false,
    savedTracks: [], favorites: [], downloads: {}, ytdlpAvailable: true, engineState: 'installed',
    engineError: '', engineProgress: null, engineCancelling: false,
    onInstallYoutubeEngine: async () => {}, onCancelYoutubeEngineInstall: async () => {},
    onCatalogAction: noop, onPlayCollection: noop, onPlayAlbum: async () => {}, onSaveDiscovery: noop,
    onChoosePlaylist: noop, onDownloadTrack: noop, onSaveCommons: noop, onQueueRemote: noop,
    recentRecords: [], historyEnabled: false, onReplay: noop, onImportMusic: noop, onOpenLibrary: noop,
  };
  const tree = DiscoveryView(props);
  const effect = mock.effects.find(effect => effect.deps?.length === 1 && effect.deps[0] === 'Anirudh ');
  expect(effect).toBeDefined();
  const cleanup = effect!.run();
  await vi.advanceTimersByTimeAsync(351);
  expect(mock.entities).toHaveBeenCalledWith('Anirudh', expect.any(String));
  expect(state.query).toBe('Anirudh ');
  const input = nodes(tree).find(node => node.type === 'input')!;
  input.props.onChange({ target: { value: state.query + 'Ravichander' } });
  expect(state.query).toBe('Anirudh Ravichander');
  cleanup?.();
});
