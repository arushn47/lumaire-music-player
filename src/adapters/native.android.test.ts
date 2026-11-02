import { afterEach, describe, expect, it, vi } from "vitest";
const bridge = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true, convertFileSrc: (s: string) => s, invoke: bridge.invoke, Channel: class { onmessage = () => {}; } }));
afterEach(() => { vi.resetModules(); vi.unstubAllGlobals(); bridge.invoke.mockReset(); });
describe("platform-specific online resolution", () => {
  it('canonicalizes imported and synced source credits at the shared save boundary', async () => {
    vi.stubGlobal('navigator', { userAgent: 'Android' });
    const { library } = await import('./native');
    const { youtubeTrack } = await import('../domain/online-track');
    const track = { ...youtubeTrack({ id: 'abcdefghijk', title: 'No Cap', channel: 'KRSNA', duration: 180, thumbnail: null }), artist: 'Krsna' };
    await library.saveOnline(track);
    expect(bridge.invoke).toHaveBeenCalledWith('save_online_track', { track: { ...track, artist: 'KR$NA' }, updateOnly: false });
  });
  it("forwards native download byte progress without changing the source identity", async () => {
    vi.stubGlobal("navigator", { userAgent: "Windows" });
    const { library } = await import("./native");
    const listener = vi.fn();
    await library.download("youtube:abcdefghijk", listener);
    const args = bridge.invoke.mock.calls[0][1];
    const update = { stage: "transferring", received: 1024, total: 4096, bytesPerSecond: 512 };
    args.onProgress.onmessage(update);
    expect(listener).toHaveBeenCalledWith(update);
    expect(args.id).toBe("youtube:abcdefghijk");
  });
  it("shares successful artist identities and allows retry after failure", async () => {
    vi.stubGlobal("navigator", { userAgent: "Windows" });
    const { library } = await import("./native");
    bridge.invoke.mockResolvedValue({ info: { id: "itunes:42", name: "Artist" } });
    await Promise.all([library.lookupArtist("itunes:42"), library.lookupArtist("itunes:42")]);
    expect(bridge.invoke).toHaveBeenCalledTimes(1);
    bridge.invoke.mockRejectedValueOnce(Error("Offline"));
    await expect(library.lookupArtist("itunes:99")).rejects.toThrow("Offline");
    bridge.invoke.mockResolvedValue({ info: { id: "itunes:99", name: "Artist" } });
    await library.lookupArtist("itunes:99");
    expect(bridge.invoke).toHaveBeenCalledTimes(3);
  });
  it("shares successful catalogue lookups and retries transport failures", async () => {
    vi.stubGlobal("navigator", { userAgent: "Windows" });
    const { library } = await import("./native");
    bridge.invoke.mockResolvedValue({ title: "Song", artist: "Artist", album: "Album" });
    await Promise.all([library.lookupMetadata("Song", "Artist", 180), library.lookupMetadata("Song", "Artist", 180)]);
    expect(bridge.invoke).toHaveBeenCalledTimes(1);
    bridge.invoke.mockRejectedValueOnce(Error("Offline"));
    await expect(library.lookupMetadata("Other", "Artist", 180)).rejects.toThrow("Offline");
    await library.lookupMetadata("Other", "Artist", 180);
    expect(bridge.invoke).toHaveBeenCalledTimes(3);
  });
  it("routes Android discovery to the bundled resolver", async () => {
    vi.stubGlobal("navigator", { userAgent: "Android" });
    bridge.invoke.mockResolvedValueOnce({ available: true }).mockResolvedValueOnce({ results: [{ id: "aqz-KE-bpKQ" }] });
    const { library } = await import("./native");
    expect(await library.ytdlpCheckAvailable()).toBe(true);
    expect(await library.ytdlpSearch("Blender", 10)).toEqual([{ id: "aqz-KE-bpKQ" }]);
    expect(bridge.invoke).toHaveBeenLastCalledWith("android_source", { operation: "search", query: "Blender", maxResults: 10 });
  });
  it("preserves the existing Windows commands", async () => {
    vi.stubGlobal("navigator", { userAgent: "Windows" });
    bridge.invoke.mockResolvedValue([]);
    const { library } = await import("./native");
    await library.ytdlpCheckAvailable(); await library.ytdlpSearch("test", 10); await library.ytdlpGetStream("aqz-KE-bpKQ");
    expect(bridge.invoke.mock.calls.map(c => c[0])).toEqual(["ytdlp_check_available", "ytdlp_search", "ytdlp_get_stream"]);
  });
  it("installs components only through the Windows native boundary", async () => {
    vi.stubGlobal("navigator", { userAgent: "Windows" });
    bridge.invoke.mockResolvedValue(undefined);
    const { library } = await import("./native");
    const progress = vi.fn();
    await library.ytdlpInstallEngine(progress);
    const channel = bridge.invoke.mock.calls[0][1].onProgress;
    const update = { stage: "downloading", component: "yt-dlp.exe", received: 1024, total: 4096, attempt: 1 };
    channel.onmessage(update);
    expect(progress).toHaveBeenCalledWith(update);
    await library.ytdlpCancelInstall();
    expect(bridge.invoke).toHaveBeenLastCalledWith("cancel_youtube_engine_install");
  });
  it("never downloads Windows components on Android", async () => {
    vi.stubGlobal("navigator", { userAgent: "Android" });
    const { library } = await import("./native");
    await expect(library.ytdlpInstallEngine()).rejects.toThrow("already includes");
    expect(bridge.invoke).not.toHaveBeenCalled();
  });
});
