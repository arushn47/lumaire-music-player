import { afterEach, expect, it, vi } from 'vitest';
import { defaults } from '../../domain/types';
import type { LyricsViewProps } from './LyricsView';

const hooks = vi.hoisted(() => ({ effects: [] as (() => void | (() => void))[] }));
vi.mock('react', async original => ({ ...await original<typeof import('react')>(),
  useEffect: (run: () => void | (() => void)) => hooks.effects.push(run),
  useLayoutEffect: () => {},
  useState: (value: unknown) => [typeof value === 'function' ? value() : value, vi.fn()],
}));
import { LyricsView } from './LyricsView';

afterEach(() => { hooks.effects = []; vi.useRealTimers(); vi.unstubAllGlobals(); });

it.each([false, true])('keeps following through delayed automatic scrolls, but permits manual browsing (embedded=%s)', embedded => {
  vi.useFakeTimers();
  vi.stubGlobal("window", { setTimeout, clearTimeout });
  const listeners = new Map<string, EventListener>();
  const container = {
    scrollTo: vi.fn(),
    addEventListener: (name: string, callback: EventListener) => listeners.set(name, callback),
    removeEventListener: (name: string) => listeners.delete(name),
  };
  vi.stubGlobal('document', { getElementById: (id: string) => id === "main" ? container : null, querySelector: () => container });
  const setFollow = vi.fn();
  const noop = vi.fn();
  const props: LyricsViewProps = {
    embedded, doc: undefined, lyricSynced: false, lyricLookup: { status: 'idle' }, follow: true,
    setFollow, followTarget: null, active: null, activeRef: { current: null }, busy: false,
    session: defaults(), setting: noop, onUpdateOffset: noop, clearCache: noop, regenerate: noop,
    processingState: { status: 'idle' }, translateLyrics: async () => {}, onRetryLookup: noop,
    onMarkInstrumental: noop, onSeek: noop,
  };
  LyricsView(props);
  const cleanups = hooks.effects.map(run => run());
  setFollow.mockClear();
  vi.advanceTimersByTime(2000);
  for (let line = 0; line < 200; line++) {
    listeners.get('scrollend')?.(new Event('scrollend'));
    listeners.get('scroll')?.(new Event('scroll'));
  }
  expect(setFollow).not.toHaveBeenCalled();
  const target = { closest: () => null };
  for (const type of ['wheel', 'touchmove', 'pointerdown']) {
    listeners.get(type)!({ target } as unknown as Event);
    expect(setFollow).toHaveBeenLastCalledWith(false);
  }
  setFollow.mockClear();
  listeners.get('keydown')!({ key: 'PageDown', target } as unknown as Event);
  expect(setFollow).toHaveBeenCalledWith(false);
  setFollow.mockClear();
  listeners.get('wheel')!({ target: { closest: () => ({}) } } as unknown as Event);
  expect(setFollow).not.toHaveBeenCalled();
  cleanups.forEach(cleanup => cleanup?.());
  expect(listeners.size).toBe(0);
});
