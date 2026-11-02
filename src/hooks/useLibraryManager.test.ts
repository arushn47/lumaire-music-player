import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CatalogTrack } from "../adapters/native";
import type { Track } from "../domain/types";

// Exercise the hook's action handlers with synchronous state; lifecycle I/O is outside these tests.
const state = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0 }));
vi.mock("react", async importOriginal => ({
  ...await importOriginal<typeof import("react")>(),
  useEffect: () => {},
  useCallback: (callback: unknown) => callback,
  useRef: (initial: unknown) => {
    const slot = state.cursor++;
    if (!(slot in state.slots)) state.slots[slot] = { current: initial };
    return state.slots[slot];
  },
  useState: (initial: unknown) => {
    const slot = state.cursor++;
    if (!(slot in state.slots)) state.slots[slot] = typeof initial === "function" ? initial() : initial;
    return [state.slots[slot], (value: unknown) => {
      state.slots[slot] = typeof value === "function" ? value(state.slots[slot]) : value;
    }];
  },
}));
const bridge = vi.hoisted(() => ({
  resolve: vi.fn(), saveOnline: vi.fn(), lookupCatalog: vi.fn(),
  getVerifiedSource: vi.fn(), setVerifiedSource: vi.fn(), deleteVerifiedSource: vi.fn(),
  player: { state: { trackId: "current", status: "playing", time: 60 }, load: vi.fn(), pause: vi.fn(), stop: vi.fn(), beginLoading: vi.fn() },
}));
vi.mock("../adapters/native", () => ({
  library: {
    saveOnline: bridge.saveOnline,
    lookupCatalog: bridge.lookupCatalog,
    getVerifiedSource: bridge.getVerifiedSource,
    setVerifiedSource: bridge.setVerifiedSource,
    deleteVerifiedSource: bridge.deleteVerifiedSource,
  },
  desktop: false,
  mobile: false,
}));
vi.mock("../player/service", () => ({
  player: bridge.player, playbackTracks: new Map(), offlineTracks: new Set(), resolvedMusic: new Map(), musicResolved: new EventTarget(), prepareCatalogCandidate: vi.fn(),
}));
vi.mock("../domain/catalog-track", async importOriginal => ({
  ...await importOriginal<typeof import("../domain/catalog-track")>(), resolveCatalogSource: bridge.resolve,
}));
import { useLibraryManager } from "./useLibraryManager";
import { playCollection, playbackQueue } from "../domain/queue";
import { catalogQueueTrack } from '../domain/catalog-track';
import { prepareCatalogCandidate } from '../player/service';
const catalog: CatalogTrack = { id: "itunes:42", title: "Pal Pal", artist: "Afusic, Talwiinder", artists: [], album: "Pal Pal", duration: 208 };
const current: Track = { id: "current", title: "Current", artist: "Artist", album: "Album", duration: 200, format: "WAV", fileName: "Current.wav", missing: false };
const candidate = { id: "abcdefghijk", title: catalog.title, channel: catalog.artist, duration: 208, thumbnail: null };
const render = () => { state.cursor = 0; return useLibraryManager(); };
const settle = async () => { for (let index = 0; index < 8; index++) await Promise.resolve(); };
beforeEach(() => {
  state.slots = []; state.cursor = 0; vi.clearAllMocks();
  vi.stubGlobal("window", { setTimeout: vi.fn(() => 1), clearTimeout: vi.fn() });
  const manager = render();
  manager.setSession(playCollection(manager.session, [current], 0));
});
afterEach(() => vi.unstubAllGlobals());

describe("instant catalog queue actions", () => {
  it('preserves corrections made while enrichment is awaiting catalogue data', async () => {
    const original={...current,id:'youtube:abcdefghijk',metadataSourceId:catalog.id,album:''};
    render().setTracks([original]);
    let finish!: (value: CatalogTrack)=>void;
    bridge.lookupCatalog.mockImplementation(()=>new Promise<CatalogTrack>(resolve=>{finish=resolve;}));
    const pending=render().enrichOnline(original);
    const corrected={...original,title:'தமிழ் user correction',artist:'Singer & Guest',album:'Correct album'};
    render().setTracks([corrected]); render();
    bridge.saveOnline.mockImplementation(async track=>track);
    finish(catalog); await pending;
    expect(bridge.saveOnline).toHaveBeenCalledWith(expect.objectContaining(corrected),true,corrected);
    expect(render().tracks[0]).toMatchObject(corrected);
    expect(bridge.lookupCatalog).toHaveBeenCalledTimes(1);
  });
  it('captures all favorite types through the shared update path', () => {
    let manager = render();
    manager.setTracks([catalogQueueTrack(catalog)]);
    manager.setSession({ ...manager.session, replica: { deviceId: 'local', clock: 3, cells: {}, favoritesInitialized: true } });
    render().favorite(catalog.id);
    manager = render();
    expect(manager.session.replica!.cells[JSON.stringify(['fav-track', catalog.id])].value).toMatchObject({ id: catalog.id });
    manager.update(s => ({ ...s, favoriteArtists: [{ id: 'itunes:12', name: 'Artist' }], favoriteAlbums: [{ id: 'itunes:34', title: 'Album', artist: 'Artist' }] }));
    manager = render();
    expect(Object.keys(manager.session.replica!.cells)).toHaveLength(3);
    manager.update(s => ({ ...s, favorites: [], favoriteArtists: [], favoriteAlbums: [], playlists: [{ id: 'mix', name: 'Mix', items: [] }] }));
    manager = render();
    expect(manager.session.replica!.cells[JSON.stringify(['name','mix'])].value).toBe('Mix');
    for (const cell of Object.values(manager.session.replica!.cells).filter(c=>c.key.startsWith('["fav-'))) expect(cell.value).toBe(false);
  });
  it("keeps errors while a notification is shown and expires that notification after four seconds", () => {
    render().setError('An existing error');
    render().notify('Saved to library');
    expect(render().error).toBe('An existing error');
    expect(render().message).toBe('Saved to library');
    const [expire, delay] = vi.mocked(window.setTimeout).mock.calls.at(-1)!;
    expect(delay).toBe(4000);
    (expire as () => void)();
    expect(render().message).toBe('');
  });
  it("favorites a streamed queue song without locking playback, then supports unliking", async () => {
    const streamed: Track = { ...current, id: 'youtube:streamed', title: 'Streamed song', format: 'YouTube', source: { providerId: 'youtube', sourceId: 'streamed', pageUrl: 'https://www.youtube.com/watch?v=streamed', license: '', licenseUrl: '', attribution: 'Artist' } };
    let manager = render();
    manager.setSession({ ...manager.session, queueTracks: { [streamed.id]: streamed } });
    bridge.saveOnline.mockResolvedValue(streamed);
    render().favorite(streamed.id);
    await settle(); manager = render();
    expect(bridge.saveOnline).toHaveBeenCalledWith(streamed);
    expect(manager.session.favorites).toContain(streamed.id);
    expect(manager.busy).toBe(false);
    manager.favorite(streamed.id);
    expect(render().session.favorites).not.toContain(streamed.id);
    expect(bridge.player.pause).not.toHaveBeenCalled();
    expect(bridge.player.load).not.toHaveBeenCalled();
  });
  it("favorites a Home recommendation that is absent from both library and queue", async () => {
    const recommendation: Track = { ...current, id: 'youtube:recommendation', title: 'Home recommendation', format: 'YouTube' };
    bridge.saveOnline.mockResolvedValue(recommendation);
    render().favorite(recommendation.id, recommendation);
    await settle();
    const manager = render();
    expect(bridge.saveOnline).toHaveBeenCalledWith(recommendation);
    expect(manager.tracks).toContainEqual(recommendation);
    expect(manager.session.favorites).toContain(recommendation.id);
    expect(bridge.player.load).not.toHaveBeenCalled();
    expect(bridge.player.pause).not.toHaveBeenCalled();
  });
  it("inserts next/queue requests before verification finishes, preserves click order and never locks or changes playback", async () => {
    let resolve!: (value: typeof candidate) => void;
    bridge.resolve.mockImplementation(() => new Promise(done => { resolve = done; }));
    const onPlay = vi.fn();
    await render().saveDiscovery(catalog, "queue", onPlay);
    const second = { ...catalog, id: "itunes:43", title: "Wishes" };
    await render().saveDiscovery(second, "next", onPlay);
    let manager = render();
    expect(manager.busy).toBe(false);
    expect(playbackQueue(manager.session).map(entry => entry.trackId)).toEqual([current.id, second.id, catalog.id]);
    expect(manager.message).toContain("Added to play next");
    // Complete the second request first: asynchronous results cannot reorder the queue.
    resolve(candidate);
    await settle(); manager = render();
    expect(playbackQueue(manager.session).map(entry => entry.trackId)).toEqual([current.id, "youtube:abcdefghijk", catalog.id]);
    expect(manager.session.currentId).toBe(manager.session.queue[0].id);
    expect(onPlay).not.toHaveBeenCalled();
    expect(bridge.player.load).not.toHaveBeenCalled();
    expect(bridge.player.pause).not.toHaveBeenCalled();
    expect(bridge.player.stop).not.toHaveBeenCalled();
    expect(bridge.player.beginLoading).not.toHaveBeenCalled();
    expect(bridge.saveOnline).not.toHaveBeenCalled();
  });

  it("keeps failed entries retryable without disabling the page or leaving an unhandled rejection", async () => {
    let reject!: (reason: Error) => void;
    bridge.resolve.mockImplementation(() => new Promise((_, fail) => { reject = fail; }));
    await render().saveDiscovery(catalog, "queue", vi.fn());
    render(); reject(Error("Provider timed out"));
    await settle(); const manager = render();
    expect(manager.busy).toBe(false);
    expect(manager.session.queue.at(-1)?.trackId).toBe(catalog.id);
    expect(manager.message).toContain("Playback will retry");
    expect(manager.error).toBe("");
  });

  it("queues a downloaded copy without making source verification requests", async () => {
    const offline = { ...current, id: "youtube:abcdefghijk", metadataSourceId: catalog.id, offline: true };
    render().setTracks([offline]);
    await render().saveDiscovery(catalog, "next", vi.fn());
    expect(render().session.queue[1].trackId).toBe(offline.id);
    expect(bridge.resolve).not.toHaveBeenCalled();
  });

  it("ignores a late verification response after the queued song is removed", async () => {
    let resolve!: (value: typeof candidate) => void;
    bridge.resolve.mockImplementation(() => new Promise(done => { resolve = done; }));
    await render().saveDiscovery(catalog, "queue", vi.fn());
    render().update(session => ({ ...session, queue: session.queue.slice(0, 1) }));
    render(); resolve(candidate); await settle();
    expect(render().session.queue.map(entry => entry.trackId)).toEqual([current.id]);
  });

  it("supports notification actions with extended expiry and records last playlist in localStorage", async () => {
    const storage = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    });
    const onClick = vi.fn();
    const manager = render();
    manager.notify("Added to Telugu", { label: "Change", onClick });
    expect(render().message).toBe("Added to Telugu");
    expect(render().messageAction).toEqual({ label: "Change", onClick });
    const [expire, delay] = vi.mocked(window.setTimeout).mock.calls.at(-1)!;
    expect(delay).toBe(6000);
    (expire as () => void)();
    expect(render().message).toBe("");
    expect(render().messageAction).toBeNull();

    // Adding track to playlist
    render().update(s => ({ ...s, playlists: [{ id: "p1", name: "Telugu", items: [] }] }));
    await render().addOnlineToPlaylist(current, "p1", undefined, { action: { label: "Change", onClick } });
    await settle();
    expect(storage.get("lumaire:last-playlist-id")).toBe("p1");
    expect(render().message).toBe("Added to Telugu");
    expect(render().messageAction?.label).toBe("Change");
  });
  it.each(["Online lookup was cancelled.", "Playback selection changed.", "AbortError"])("preserves cancellation during cached-source verification: %s", async message => {
    bridge.getVerifiedSource.mockResolvedValueOnce({ sourceId: candidate.id, sourceProvider: "youtube", title: candidate.title, artist: candidate.channel, duration: candidate.duration });
    const cancelled = Error(message);
    vi.mocked(prepareCatalogCandidate).mockRejectedValueOnce(cancelled);
    await expect(render().resolveDiscovery(catalog)).rejects.toBe(cancelled);
    expect(bridge.resolve).not.toHaveBeenCalled();
    expect(bridge.deleteVerifiedSource).not.toHaveBeenCalled();
    expect(bridge.setVerifiedSource).not.toHaveBeenCalled();
  });

  it("preserves cancellation while verifying a known online recording", async () => {
    render().setTracks([{ ...current, id: `youtube:${candidate.id}`, metadataSourceId: catalog.id,
      source: { providerId: "youtube", sourceId: candidate.id, pageUrl: "https://www.youtube.com/watch?v=abcdefghijk", license: "", licenseUrl: "", attribution: "" } }]);
    const cancelled = Error("Playback selection changed.");
    vi.mocked(prepareCatalogCandidate).mockRejectedValueOnce(cancelled);
    await expect(render().resolveDiscovery(catalog)).rejects.toBe(cancelled);
    expect(bridge.getVerifiedSource).not.toHaveBeenCalled();
    expect(bridge.resolve).not.toHaveBeenCalled();
  });

  it("evicts an unavailable cached recording and falls back to search", async () => {
    bridge.getVerifiedSource.mockResolvedValueOnce({ sourceId: candidate.id, sourceProvider: "youtube", title: candidate.title, artist: candidate.channel, duration: candidate.duration });
    vi.mocked(prepareCatalogCandidate).mockRejectedValueOnce(Error("Recording is private"));
    bridge.resolve.mockResolvedValueOnce(candidate);
    await expect(render().resolveDiscovery(catalog)).resolves.toHaveProperty("id", `youtube:${candidate.id}`);
    expect(bridge.deleteVerifiedSource).toHaveBeenCalledWith(catalog.id);
    expect(bridge.resolve).toHaveBeenCalledTimes(1);
  });

  it("reuses a durable verified source from cache without searching, and stores new resolutions", async () => {
    bridge.getVerifiedSource.mockResolvedValueOnce({
      catalogId: catalog.id,
      sourceId: "abcdefghijk",
      sourceProvider: "youtube",
      title: `${catalog.title} - ${catalog.artist}`,
      artist: catalog.artist,
      duration: catalog.duration,
    });
    const manager = render();
    const resolved = await manager.resolveDiscovery(catalog);
    expect(resolved.id).toBe("youtube:abcdefghijk");
    expect(bridge.resolve).not.toHaveBeenCalled();

    // Now test cache invalidation on mismatch
    bridge.getVerifiedSource.mockResolvedValueOnce({
      catalogId: "itunes:42-stale",
      sourceId: "12345678901",
      sourceProvider: "youtube",
      title: "Completely Different Song",
      artist: "Other Person",
      duration: 999,
    });
    bridge.resolve.mockResolvedValueOnce(candidate);
    const resolvedAfterMismatch = await manager.resolveDiscovery({ ...catalog, id: "itunes:42-stale" });
    expect(bridge.deleteVerifiedSource).toHaveBeenCalledWith("itunes:42-stale");
    expect(bridge.resolve).toHaveBeenCalledTimes(1);
    expect(bridge.setVerifiedSource).toHaveBeenCalledWith("itunes:42-stale", expect.objectContaining({
      sourceId: candidate.id,
      sourceProvider: "youtube",
    }));
    expect(resolvedAfterMismatch.id).toBe(`youtube:${candidate.id}`);
  });
});
