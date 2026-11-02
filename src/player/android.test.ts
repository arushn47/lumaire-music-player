import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Playback } from './controller';
import { AndroidPlaybackController } from './android';
import { defaults } from '../domain/types';

const native = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn(), unregister: vi.fn(), event: (_state: Playback & { id: string }) => {} }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: native.invoke, addPluginListener: native.listen }));
let documentEvents: EventTarget;
let unsubscribe: (() => void) | undefined;
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks();
  documentEvents = new EventTarget();
  vi.stubGlobal('document', Object.assign(documentEvents, { hidden: true }));
  native.listen.mockImplementation(async (_plugin, _event, callback) => { native.event = callback; return { unregister: native.unregister }; });
  native.invoke.mockImplementation(async (_command, args) => ({ id: args.id || 'first', status: 'playing', time: 0, duration: 180, error: null, autoplay: true }));
});
afterEach(() => { unsubscribe?.(); unsubscribe = undefined; vi.useRealTimers(); vi.unstubAllGlobals(); });
const ended = (id: string): Playback & { id: string } => ({ id, status: 'ended', time: 180, duration: 180, error: null, autoplay: true });

it('adopts service-owned transitions without issuing a second Next from React', async () => {
  const player = new AndroidPlaybackController(); unsubscribe = player.subscribe(() => {});
  await player.load('first', true); player.onEnded = vi.fn();
  const session = { ...defaults(), currentId: 'next', queue: [{id:'next',trackId:'second'}] };
  native.event({ ...ended('second'), status:'playing', nativeQueueRevision:4, nativeStateAt:100, nativeQueue:{revision:4,session} });
  expect(player.state.trackId).toBe('second');
  native.event({ ...ended('second'), nativeQueueRevision:4, nativeStateAt:101, nativeQueue:{revision:4,session} });
  expect(player.onEnded).not.toHaveBeenCalled();
  native.event({ ...ended('first'), nativeQueueRevision:3, nativeStateAt:99, nativeQueue:{revision:3,session} });
  expect(player.state.trackId).toBe('second');
});

it('does not let a queued native snapshot override a deliberate new catalogue selection', async () => {
  const player = new AndroidPlaybackController(); unsubscribe = player.subscribe(() => {});
  await player.load('first', true); player.beginLoading('itunes:42',true);
  native.event({...ended('old'),nativeQueueRevision:2,nativeQueue:{revision:2,session:defaults()}});
  expect(player.state.trackId).toBe('itunes:42');
});

it('delegates the initial queue selection immediately without waiting for JavaScript source resolution', async()=>{
  const player=new AndroidPlaybackController();unsubscribe=player.subscribe(()=>{});
  const session={...defaults(),queue:[{id:'selected',trackId:'itunes:42'}],currentId:'selected'};
  await player.startQueue({session,tracks:[],records:[],languages:['english']},true,0);
  expect(native.invoke).toHaveBeenCalledWith('android_background_start',expect.objectContaining({queue:expect.objectContaining({session}),autoplay:true,position:0}));
  expect(native.invoke.mock.calls.some(([command])=>command==='android_source')).toBe(false);
});

it('preserves local-file playback in runtime-disabled prototype builds', async()=>{
  native.invoke.mockImplementation(async(command,args)=>{
    if(command==='android_background_start')throw Error('Native queue runtime unavailable.');
    return {id:args.id||'first',status:'playing',time:0,duration:180,error:null};
  });
  const player=new AndroidPlaybackController();unsubscribe=player.subscribe(()=>{});
  const session={...defaults(),queue:[{id:'selected',trackId:'first'}],currentId:'selected'};
  await player.startQueue({session,tracks:[],records:[],languages:[]},true,0);
  expect(native.invoke).toHaveBeenCalledWith('android_playback',expect.objectContaining({action:'load',id:'first'}));
  expect(player.state.status).toBe('playing');
});

it('advances consecutive songs while hidden without polling, and handles completion only once', async () => {
  const player = new AndroidPlaybackController();
  unsubscribe = player.subscribe(() => {});
  await player.load('first', true);
  player.onEnded = vi.fn(() => { void player.load('second', true); });
  native.event(ended('first'));
  await Promise.resolve(); await Promise.resolve();
  expect(player.onEnded).toHaveBeenCalledTimes(1);
  expect(player.state.trackId).toBe('second');
  player.onEnded = vi.fn();
  native.event(ended('first'));
  native.event(ended('second'));
  native.event(ended('second'));
  expect(player.onEnded).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(native.invoke.mock.calls.filter(([, args]) => args.action === 'state')).toHaveLength(0);
});

it('ignores old native events during catalog resolution and forwards genuine playback errors', async () => {
  const player = new AndroidPlaybackController();
  unsubscribe = player.subscribe(() => {});
  await player.load('first', true);
  player.onEnded = vi.fn();
  player.beginLoading('catalog:next', true);
  native.event(ended('first'));
  expect(player.state.status).toBe('loading');
  expect(player.onEnded).not.toHaveBeenCalled();
  await player.load('second', true);
  native.event({ ...ended('second'), status: 'error', error: 'HTTP 403' });
  expect(player.state).toMatchObject({ status: 'error', autoplay: true, error: 'HTTP 403' });
});

it('reconciles on foreground return without replaying an already handled completion', async () => {
  const player = new AndroidPlaybackController();
  unsubscribe = player.subscribe(() => {});
  await player.load('first', true);
  player.onEnded = vi.fn();
  native.event(ended('first'));
  native.invoke.mockResolvedValue(ended('first'));
  Object.assign(document, { hidden: false });
  documentEvents.dispatchEvent(new Event('visibilitychange'));
  await Promise.resolve(); await Promise.resolve();
  expect(player.onEnded).toHaveBeenCalledTimes(1);
  unsubscribe(); unsubscribe = undefined;
  await Promise.resolve();
  expect(native.unregister).toHaveBeenCalledTimes(1);
});
