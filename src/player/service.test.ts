import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const bridge = vi.hoisted(() => ({ resolve: null as null | ((id: string, retry?: boolean, alternative?: boolean) => Promise<string>), library: { media: vi.fn(), resolveCommons: vi.fn(), lookupCatalog: vi.fn(), ytdlpGetStream: vi.fn(), ytdlpSearch: vi.fn(),getVerifiedSource:vi.fn(),setVerifiedSource:vi.fn() } }));
vi.mock("../adapters/native", () => ({ library: bridge.library, mobile: false }));
vi.mock("./controller", () => ({ PlaybackController: class { state={trackId:'',playbackId:'test'}; constructor(resolve: (id: string, retry?: boolean, alternative?:boolean) => Promise<string>) { bridge.resolve = (id,retry,alternative)=>{this.state.trackId=id;return resolve(id,retry,alternative);}; } } }));
const song = { id: "itunes:42", title: "Evening Sky", artist: "Artist", artists: [], album: "Album", duration: 210 };
const candidate = { id: "abcdefghijk", title: "Artist - Evening Sky", duration: 210, channel: "Artist", thumbnail: null };
const stream = { streamUrl: "https://rr1.googlevideo.com/audio?expiring=secret", duration: 210, track: "Evening Sky", artist: "Artist" };
beforeEach(() => { vi.resetModules(); vi.resetAllMocks(); });
afterEach(() => vi.useRealTimers());

describe("audio provider dispatch and source recovery", () => {
  it('honors a saved user recording while preserving the library identity',async()=>{
    const {playbackTracks}=await import('./service');
    playbackTracks.set('youtube:abcdefghijk',{id:'youtube:abcdefghijk',title:song.title,artist:song.artist,album:song.album,duration:210,fileName:'',format:'webm',missing:false,metadataSourceId:song.id});
    bridge.library.getVerifiedSource.mockResolvedValue({sourceId:'lmnopqrstuv',sourceProvider:'youtube',title:candidate.title,artist:'Artist',duration:210,userSelected:true});
    bridge.library.lookupCatalog.mockResolvedValue(song);bridge.library.ytdlpGetStream.mockImplementation(async(id:string)=>({...stream,streamUrl:`https://rr1.googlevideo.com/${id}`}));
    expect(await bridge.resolve!('youtube:abcdefghijk')).toContain('lmnopqrstuv');
    expect(playbackTracks.has('youtube:abcdefghijk')).toBe(true);expect(bridge.library.ytdlpSearch).not.toHaveBeenCalled();
  });
  it('falls back when a preferred recording is unavailable and never relaxes matching',async()=>{
    const {playbackTracks}=await import('./service');
    playbackTracks.set('youtube:abcdefghijk',{id:'youtube:abcdefghijk',title:song.title,artist:song.artist,album:song.album,duration:210,fileName:'',format:'webm',missing:false,metadataSourceId:song.id});
    bridge.library.getVerifiedSource.mockResolvedValue({sourceId:'lmnopqrstuv',sourceProvider:'youtube',title:candidate.title,artist:'Artist',duration:210,userSelected:true});
    bridge.library.lookupCatalog.mockResolvedValue(song);bridge.library.ytdlpGetStream.mockImplementation(async(id:string)=>{if(id==='lmnopqrstuv')throw Error('Recording unavailable');return stream;});
    expect(await bridge.resolve!('youtube:abcdefghijk')).toBe(stream.streamUrl);
    expect(bridge.library.setVerifiedSource).not.toHaveBeenCalled();
  });
  it("keeps local, offline and Commons sources on their own resolvers", async () => {
    const { offlineTracks } = await import("./service");
    bridge.library.media.mockResolvedValue("asset:local");
    bridge.library.resolveCommons.mockResolvedValue({ url: "https://upload.wikimedia.org/audio.ogg" });
    expect(await bridge.resolve!("local-id")).toBe("asset:local");
    expect(await bridge.resolve!("wikimedia-commons:42")).toContain("wikimedia.org");
    expect(bridge.library.resolveCommons).toHaveBeenCalledWith("42");
    offlineTracks.add("youtube:abcdefghijk");
    expect(await bridge.resolve!("youtube:abcdefghijk")).toBe("asset:local");
    expect(await bridge.resolve!("youtube:abcdefghijk", true, true)).toBe("asset:local");
    expect(bridge.library.ytdlpGetStream).not.toHaveBeenCalled();
  });
  it("uses a short-lived preflight stream without persisting the URL or resolving twice", async () => {
    const { prepareCatalogCandidate } = await import("./service");
    bridge.library.ytdlpGetStream.mockResolvedValue(stream);
    await prepareCatalogCandidate(candidate);
    expect(await bridge.resolve!("youtube:abcdefghijk")).toBe(stream.streamUrl);
    expect(bridge.library.ytdlpGetStream).toHaveBeenCalledTimes(1);
  });
  it("falls through failed candidates and excludes previously used sources on engine retry", async () => {
    const { playbackTracks } = await import("./service");
    playbackTracks.set("youtube:abcdefghijk", { id: "youtube:abcdefghijk", title: song.title, artist: song.artist, album: song.album, duration: 210, fileName: "Song", format: "YouTube", missing: false, metadataSourceId: song.id });
    bridge.library.lookupCatalog.mockResolvedValue(song);
    const second = { ...candidate, id: "lmnopqrstuv" }, third = { ...candidate, id: "01234567890" };
    bridge.library.ytdlpSearch.mockResolvedValue([candidate, second, third]);
    let secondLoads = 0;
    bridge.library.ytdlpGetStream.mockImplementation(async (id: string) => {
      if (id === candidate.id || (id === second.id && secondLoads++ > 0)) throw Error("Recording is private");
      return { ...stream, streamUrl: `https://rr1.googlevideo.com/${id}` };
    });
    expect(await bridge.resolve!("youtube:abcdefghijk")).toContain(second.id);
    expect(await bridge.resolve!("youtube:abcdefghijk", true)).toContain(third.id);
    expect(bridge.library.lookupCatalog).toHaveBeenCalledWith("itunes:42");
    expect(bridge.library.ytdlpGetStream.mock.calls.map(([id]) => id)).toEqual([candidate.id, second.id, second.id, third.id]);
  });

  it("refreshes the same catalog recording before searching for a replacement", async () => {
    const { playbackTracks } = await import("./service");
    const track = { id: `youtube:${candidate.id}`, title: song.title, artist: song.artist, album: song.album, duration: 210, fileName: "Song", format: "YouTube", missing: false, metadataSourceId: song.id };
    playbackTracks.set(track.id, track);
    bridge.library.lookupCatalog.mockResolvedValue(song);
    bridge.library.ytdlpGetStream.mockResolvedValueOnce(stream).mockResolvedValueOnce({ ...stream, streamUrl: "https://rr1.googlevideo.com/fresh" });
    await bridge.resolve!(track.id);
    expect(await bridge.resolve!(track.id, true)).toBe("https://rr1.googlevideo.com/fresh");
    expect(bridge.library.ytdlpGetStream.mock.calls.map(([id]) => id)).toEqual([candidate.id, candidate.id]);
    expect(bridge.library.lookupCatalog).toHaveBeenCalledWith(song.id);
    expect(bridge.library.ytdlpSearch).not.toHaveBeenCalled();
    expect(playbackTracks.get(track.id)).toBe(track);
  });
  it('rejects a cached Hola Amigo overdub before attaching audio and finds the original recording',async()=>{
    const {playbackTracks,prepareCatalogCandidate}=await import('./service');
    const catalog={...song,id:'saavn:M4t__2Pc',title:'Hola Amigo',artist:'Umair, KR$NA, Seedhe Maut',duration:226};
    const bad='wEnj5LfAS_0',good='g12hFFO6KCI';
    playbackTracks.set(`youtube:${bad}`,{id:`youtube:${bad}`,metadataSourceId:catalog.id,title:catalog.title,artist:catalog.artist,album:'Album',duration:226,fileName:'',format:'webm',missing:false});
    bridge.library.lookupCatalog.mockResolvedValue(catalog);
    bridge.library.ytdlpGetStream.mockImplementation(async(id:string)=>({...stream,streamUrl:`https://rr1.googlevideo.com/${id}`,title:id===bad?'Hola Amigo - BAN$AL X Seedhe Maut X KR$NA':'Hola Amigo',track:id===bad?null:'Hola Amigo',artist:id===bad?null:catalog.artist,duration:226}));
    bridge.library.ytdlpSearch.mockResolvedValue([{id:good,title:'Hola Amigo',channel:'KR$NA',artist:catalog.artist,duration:226,thumbnail:null}]);
    expect(await bridge.resolve!(`youtube:${bad}`)).toContain(good);
    expect((await prepareCatalogCandidate({id:bad,title:'Hola Amigo',channel:catalog.artist,duration:226,thumbnail:null})).title).toContain('BAN$AL');
  });

  it("refreshes the actual fallback recording rather than returning to the original failed source", async () => {
    const { playbackTracks } = await import("./service");
    const id = `youtube:${candidate.id}`, second = { ...candidate, id: "lmnopqrstuv" };
    playbackTracks.set(id, { id, title: song.title, artist: song.artist, album: song.album, duration: 210, fileName: "Song", format: "YouTube", missing: false, metadataSourceId: song.id });
    bridge.library.lookupCatalog.mockResolvedValue(song);
    bridge.library.ytdlpSearch.mockResolvedValue([candidate, second]);
    bridge.library.ytdlpGetStream.mockRejectedValueOnce(Error("Private"))
      .mockResolvedValueOnce({ ...stream, streamUrl: "https://rr1.googlevideo.com/fallback" })
      .mockResolvedValueOnce({ ...stream, streamUrl: "https://rr1.googlevideo.com/refreshed-fallback" });
    expect(await bridge.resolve!(id)).toContain("/fallback");
    const searches = bridge.library.ytdlpSearch.mock.calls.length;
    expect(await bridge.resolve!(id, true)).toContain("/refreshed-fallback");
    expect(bridge.library.ytdlpGetStream.mock.calls.map(([source]) => source)).toEqual([candidate.id, second.id, second.id]);
    expect(bridge.library.ytdlpSearch).toHaveBeenCalledTimes(searches);
  });

  it("chooses another verified recording when the refreshed URL also fails during playback", async () => {
    const { playbackTracks } = await import("./service");
    const id = `youtube:${candidate.id}`, second = { ...candidate, id: "lmnopqrstuv" };
    playbackTracks.set(id, { id, title: song.title, artist: song.artist, album: song.album, duration: 210, fileName: "Song", format: "YouTube", missing: false, metadataSourceId: song.id });
    bridge.library.ytdlpGetStream.mockResolvedValue(stream);
    bridge.library.lookupCatalog.mockResolvedValue(song);
    bridge.library.ytdlpSearch.mockResolvedValue([candidate, second]);
    await bridge.resolve!(id);
    await bridge.resolve!(id, true);
    await bridge.resolve!(id, true, true);
    expect(bridge.library.ytdlpGetStream.mock.calls.map(([source]) => source)).toEqual([candidate.id, candidate.id, second.id]);
  });

  it.each([false, true])("does not search after source extraction is explicitly cancelled (retry=%s)", async retry => {
    const { playbackTracks } = await import("./service");
    const id = `youtube:${candidate.id}`;
    playbackTracks.set(id, { id, title: song.title, artist: song.artist, album: song.album, duration: 210, fileName: "Song", format: "YouTube", missing: false, metadataSourceId: song.id });
    const cancelled = Error("Playback selection changed.");
    bridge.library.ytdlpGetStream.mockRejectedValueOnce(cancelled);
    await expect(bridge.resolve!(id, retry)).rejects.toBe(cancelled);
    expect(bridge.library.lookupCatalog).not.toHaveBeenCalled();
    expect(bridge.library.ytdlpSearch).not.toHaveBeenCalled();
  });

  it("fails cleanly when URL refresh and every untried matching recording are unavailable", async () => {
    const { playbackTracks } = await import("./service");
    const id = `youtube:${candidate.id}`, second = { ...candidate, id: "lmnopqrstuv" };
    playbackTracks.set(id, { id, title: song.title, artist: song.artist, album: song.album, duration: 210, fileName: "Song", format: "YouTube", missing: false, metadataSourceId: song.id });
    bridge.library.ytdlpGetStream.mockResolvedValueOnce(stream).mockRejectedValue(Error("Recording is private"));
    bridge.library.lookupCatalog.mockResolvedValue(song);
    bridge.library.ytdlpSearch.mockResolvedValue([candidate, second]);
    await bridge.resolve!(id);
    await expect(bridge.resolve!(id, true)).rejects.toThrow("stream extraction failed");
    expect(bridge.library.ytdlpGetStream.mock.calls.map(([source]) => source)).toEqual([candidate.id, candidate.id, second.id]);
  });
});


it("respects URL expire parameter and retains streams beyond 2 minutes", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(1000000);
  const futureSec = Math.floor(Date.now() / 1000) + 1200;
  const longStream = { ...stream, streamUrl: `https://rr1.googlevideo.com/audio?expire=${futureSec}&other=param` };
  bridge.library.ytdlpGetStream.mockResolvedValue(longStream);
  const { prepareCatalogCandidate } = await import("./service");
  await prepareCatalogCandidate(candidate);
  vi.advanceTimersByTime(180000);
  expect(await bridge.resolve!("youtube:abcdefghijk")).toBe(longStream.streamUrl);
  expect(bridge.library.ytdlpGetStream).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(990001);
  await bridge.resolve!("youtube:abcdefghijk");
  expect(bridge.library.ytdlpGetStream).toHaveBeenCalledTimes(2);
});

it.each([
  ["?expire=4600", 1800000],
  ["?other=1&expire=1100", 70000],
  ["?other=1", 120000],
  ["?expire=invalid", 0],
  ["?expire=", 0],
  ["?expire=1000", 0],
])("expires a cached stream with %s after %i ms", async (query, lifetime) => {
  vi.useFakeTimers();
  vi.setSystemTime(1000000);
  const { prepareCatalogCandidate } = await import("./service");
  bridge.library.ytdlpGetStream.mockResolvedValue({ ...stream, streamUrl: `https://rr1.googlevideo.com/audio${query}` });
  await prepareCatalogCandidate(candidate);
  if (lifetime > 0) {
    vi.advanceTimersByTime(lifetime - 1);
    await bridge.resolve!("youtube:abcdefghijk");
    expect(bridge.library.ytdlpGetStream).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
  }
  await bridge.resolve!("youtube:abcdefghijk");
  expect(bridge.library.ytdlpGetStream).toHaveBeenCalledTimes(2);
});

it("refreshes a failed direct stream immediately and reuses the replacement on later plays", async () => {
  vi.useFakeTimers();
  const { prepareCatalogCandidate } = await import("./service");
  const original = { ...stream, streamUrl: `https://rr1.googlevideo.com/old?expire=${Math.floor(Date.now() / 1000) + 3600}` };
  const replacement = { ...stream, streamUrl: "https://rr1.googlevideo.com/fresh" };
  bridge.library.ytdlpGetStream.mockResolvedValueOnce(original).mockResolvedValue(replacement);
  await prepareCatalogCandidate(candidate);
  expect(await bridge.resolve!("youtube:abcdefghijk")).toBe(original.streamUrl);
  expect(await bridge.resolve!("youtube:abcdefghijk", true)).toBe(replacement.streamUrl);
  vi.advanceTimersByTime(60000);
  expect(await bridge.resolve!("youtube:abcdefghijk")).toBe(replacement.streamUrl);
  expect(bridge.library.ytdlpGetStream).toHaveBeenCalledTimes(2);
});

it("shares concurrent source preparation and reuses a recent stream on replay", async () => {
  const { prepareCatalogCandidate } = await import("./service");
  bridge.library.ytdlpGetStream.mockResolvedValue(stream);
  await Promise.all([prepareCatalogCandidate(candidate), prepareCatalogCandidate(candidate)]);
  await bridge.resolve!("youtube:abcdefghijk");
  await bridge.resolve!("youtube:abcdefghijk");
  expect(bridge.library.ytdlpGetStream).toHaveBeenCalledTimes(1);
});
