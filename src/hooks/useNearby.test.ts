import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { defaults } from '../domain/types';

const hooks = vi.hoisted(() => ({ cursor: 0, slots: [] as unknown[], pending: [] as (() => void)[], dirty: false }));
vi.mock('react', async original => ({
  ...await original<typeof import('react')>(),
  useState: (initial: unknown) => {
    const n = hooks.cursor++; if (!(n in hooks.slots)) hooks.slots[n] = initial;
    return [hooks.slots[n], (value: unknown) => { const next = typeof value === 'function' ? value(hooks.slots[n]) : value; if (!Object.is(next, hooks.slots[n])) { hooks.slots[n] = next; hooks.dirty = true; } }];
  },
  useRef: (value: unknown) => { const n = hooks.cursor++; if (!(n in hooks.slots)) hooks.slots[n] = { current: value }; return hooks.slots[n]; },
  useEffect: (run: () => unknown, dependencies: unknown[]) => {
    const n = hooks.cursor++, old = hooks.slots[n] as unknown[] | undefined;
    if (!old || dependencies.some((d,i)=>!Object.is(d,old[i]))) { hooks.slots[n] = dependencies; hooks.pending.push(run); }
  },
}));
const bridge = vi.hoisted(() => ({ exchange: vi.fn(), syncState: vi.fn(), favoritesSync: vi.fn(), fetch: vi.fn(), rediscover: vi.fn(), stopSharing: vi.fn(), flush: vi.fn(), pause: vi.fn(), stop: vi.fn(), load: vi.fn(), tick: () => {}, online: () => {} }));
vi.mock('../adapters/collections', () => ({ collections: bridge }));
vi.mock('../adapters/native', () => ({ desktop: true }));
vi.mock('../player/listening-service', () => ({ flushListening: async () => {}, reloadSyncedListening: async () => {} }));
vi.mock('../player/service', () => ({ player: { pause: bridge.pause, stop: bridge.stop, load: bridge.load }, playbackTracks: new Map() }));
import { useNearby } from './useNearby';

let api: ReturnType<typeof useNearby>;
const session = { ...defaults(), replica: { deviceId: 'local', clock: 0, cells: {} } };
function render() {
  for(let n=0;n<10;n++) {
    hooks.cursor=0; hooks.dirty=false;
    api=useNearby({ready:true,session,tracks:[],playback:{ status:'idle',time:0,duration:0,trackId:null,error:null },update:vi.fn(),resolve:async t=>t,applyReplica:async()=>{},flush:bridge.flush});
    hooks.pending.splice(0).forEach(run=>run()); if(!hooks.dirty)break;
  }
}
async function settle() { for(let n=0;n<35;n++){await Promise.resolve();render();} }
beforeEach(() => {
  vi.clearAllMocks(); hooks.cursor=0; hooks.slots=[]; hooks.pending=[];
  vi.spyOn(Date,'now').mockReturnValue(100000);
  vi.stubGlobal('window',{setInterval:(fn:()=>void)=>{bridge.tick=fn;return 1;},addEventListener:(name:string,fn:()=>void)=>{if(name==='online')bridge.online=fn;},removeEventListener:vi.fn()});
  vi.stubGlobal('localStorage',{getItem:(key:string)=>key==='lumaire-paired-link'?'paired-link':null,removeItem:vi.fn()});
  bridge.syncState.mockResolvedValue({deviceId:'local',clock:0,revision:0,cells:[],historyEnabled:false});
  bridge.fetch.mockResolvedValue({playlists:[],now:null});bridge.rediscover.mockRejectedValue('device unavailable');bridge.flush.mockResolvedValue(undefined);bridge.stopSharing.mockResolvedValue(undefined);
});
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});
it('backs off repeated background failures, recovers once, and never changes playback', async () => {
  bridge.exchange.mockRejectedValueOnce('Cannot reach paired device').mockRejectedValueOnce('Sync interrupted').mockResolvedValue(false);
  render();await settle();expect(bridge.exchange).toHaveBeenCalledTimes(1);
  vi.mocked(Date.now).mockReturnValue(105000);bridge.tick();await settle();expect(bridge.exchange).toHaveBeenCalledTimes(2);
  vi.mocked(Date.now).mockReturnValue(110000);bridge.tick();await settle();expect(bridge.exchange).toHaveBeenCalledTimes(2);
  vi.mocked(Date.now).mockReturnValue(115000);bridge.tick();await settle();expect(bridge.exchange).toHaveBeenCalledTimes(3);
  expect(api.error).toBe('');expect(api.lastSyncedAt).toBe(115000);
  expect(bridge.pause).not.toHaveBeenCalled();expect(bridge.stop).not.toHaveBeenCalled();expect(bridge.load).not.toHaveBeenCalled();
});
it('rediscovers and persists the paired host after an authenticated sync connection fails', async () => {
  bridge.exchange.mockRejectedValueOnce('Cannot reach paired device');
  bridge.rediscover.mockResolvedValue('http://192.168.1.20:4321/#credential');
  render(); await settle();
  expect(bridge.rediscover).toHaveBeenCalledWith('paired-link');
  expect(api.guestLink).toBe('http://192.168.1.20:4321/#credential');
});
it('lets manual retries bypass backoff and clears the old error on success', async () => {
  bridge.exchange.mockRejectedValueOnce('Cannot reach paired device').mockResolvedValue(false);
  render();await settle();expect(api.error).toBe('Cannot reach paired device');
  await api.sync();await settle();expect(bridge.exchange).toHaveBeenCalledTimes(2);expect(api.error).toBe('');
});
it('does not restore an obsolete error when an in-flight request fails after disconnect', async () => {
  let reject!: (e: unknown)=>void;
  bridge.exchange.mockImplementationOnce(()=>new Promise((_,r)=>{reject=r;}));
  render();await settle();await api.stop();reject('Old connection failed');await settle();
  expect(api.error).toBe('');expect(api.guestLink).toBe('');expect(api.lastSyncedAt).toBeNull();
});
it('loads the default-on favorites toggle, flushes offline edits, and rereads from zero on changes', async () => {
  bridge.exchange.mockResolvedValue(false);
  bridge.syncState.mockResolvedValue({deviceId:'local',clock:5,revision:5,cells:[],historyEnabled:false,favoritesEnabled:true});
  render(); await settle(); expect(api.favoritesEnabled).toBe(true);
  bridge.favoritesSync.mockImplementation(async enabled => {
    expect(bridge.flush).toHaveBeenCalled();
    bridge.syncState.mockResolvedValue({deviceId:'local',clock:5,revision:5,cells:[],historyEnabled:false,favoritesEnabled:enabled});
    return {favoritesEnabled:enabled};
  });
  bridge.syncState.mockClear(); await api.setFavoritesSync(false); await settle();
  expect(api.favoritesEnabled).toBe(false); expect(bridge.syncState).toHaveBeenNthCalledWith(1,0);
  bridge.syncState.mockClear(); await api.setFavoritesSync(true); await settle();
  expect(api.favoritesEnabled).toBe(true); expect(bridge.syncState).toHaveBeenNthCalledWith(1,0);
  expect(bridge.pause).not.toHaveBeenCalled(); expect(bridge.load).not.toHaveBeenCalled();
});
