import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlaybackController } from "./controller";
class FakeAudio extends EventTarget {
  src = "";
  preload = "";
  currentTime = 0;
  duration = 36;
  volume = 1;
  paused = true;
  ended = false;
  error: null | { code: number } = null;
  onloadedmetadata: (() => void) | null = null;
  pause() {
    this.paused = true;
    this.dispatchEvent(new Event("pause"));
  }
  play() {
    this.paused = false;
    this.dispatchEvent(new Event("playing"));
    return Promise.resolve();
  }
  removeAttribute() {
    this.src = "";
  }
  load() {}
  loaded() {
    this.onloadedmetadata?.();
  }
}
beforeEach(() => vi.stubGlobal("Audio", FakeAudio));
afterEach(() => vi.unstubAllGlobals());
describe("single-owner playback lifecycle", () => {
  it("upgrades a paused preload when Play album is requested before metadata loads", async () => {
    const resolve = vi.fn(async () => "asset:one");
    const controller = new PlaybackController(resolve);
    await controller.load("one", false);
    await controller.load("one", true);
    (controller.audio as unknown as FakeAudio).loaded();
    expect(controller.state.autoplay).toBe(true);
    expect(controller.state.status).toBe("playing");
    expect(resolve).toHaveBeenCalledTimes(2);
    controller.stop();
  });
  it("stops the old song immediately while a catalog selection resolves and ignores stale failures", async () => {
    const controller = new PlaybackController(async () => "asset:one");
    await controller.load("one", true);
    const audio = controller.audio as unknown as FakeAudio;
    audio.loaded();
    expect(audio.paused).toBe(false);
    const pending = controller.beginLoading("saavn:12345678");
    expect(audio.paused).toBe(true);
    expect(audio.src).toBe("");
    expect(controller.state).toMatchObject({ status: "loading", trackId: "saavn:12345678", time: 0 });
    await controller.load("two", true);
    controller.failLoading(pending, "Late error");
    expect(controller.state.trackId).toBe("two");
    expect(controller.state.error).toBeNull();
    controller.stop();
  });
  it("does not restart an in-flight load on repeated Play clicks", async () => {
    let finish!: (url: string) => void;
    const resolve = vi.fn(() => new Promise<string>(r => { finish = r; }));
    const controller = new PlaybackController(resolve);
    const first = controller.load("one", true);
    await controller.load("one", true);
    expect(resolve).toHaveBeenCalledTimes(1);
    finish("asset:one");
    await first;
    controller.stop();
  });
  it("bounds recovery to one URL refresh and one alternative, preserving position and ignoring duplicate errors", async () => {
    const resolve = vi.fn(async (_id: string, retry?: boolean, alternative?: boolean) => alternative ? "https://audio.example/third" : retry ? "https://audio.example/second" : "https://audio.example/first");
    const controller = new PlaybackController(resolve);
    await controller.load("youtube:abcdefghijk", true);
    const audio = controller.audio as unknown as FakeAudio;
    audio.loaded(); audio.currentTime = 12; audio.dispatchEvent(new Event("timeupdate"));
    const playbackId = controller.state.playbackId;
    audio.dispatchEvent(new Event("error"));
    audio.dispatchEvent(new Event("error"));
    await vi.waitFor(() => expect(resolve).toHaveBeenCalledWith("youtube:abcdefghijk", true));
    await vi.waitFor(() => expect(audio.src).toContain("second"));
    audio.loaded();
    expect(audio.currentTime).toBe(12);
    expect(controller.state.playbackId).toBe(playbackId);
    audio.dispatchEvent(new Event("error"));
    await vi.waitFor(() => expect(resolve).toHaveBeenCalledWith("youtube:abcdefghijk", true, true));
    await vi.waitFor(() => expect(audio.src).toContain("third"));
    audio.dispatchEvent(new Event("error"));
    expect(controller.state.status).toBe("error");
    expect(resolve).toHaveBeenCalledTimes(3);
    controller.stop();
  });
  it("times out a stalled load and cancels the timer on stop", async () => {
    vi.useFakeTimers();
    try {
      const controller = new PlaybackController(async () => "asset:stalled");
      await controller.load("local", true);
      await vi.advanceTimersByTimeAsync(20000);
      expect(controller.state.error).toContain("timed out");
      controller.stop();
      await vi.advanceTimersByTimeAsync(20000);
      expect(controller.state.status).toBe("idle");
    } finally { vi.useRealTimers(); }
  });
  it("discards a late native resolution after a rapid track switch", async () => {
    let resolveFirst!: (s: string) => void;
    const controller = new PlaybackController((id) =>
      id === "first"
        ? new Promise((r) => {
            resolveFirst = r;
          })
        : Promise.resolve("asset:second"),
    );
    const first = controller.load("first", true),
      second = controller.load("second", false, 8);
    await second;
    const audio = controller.audio as unknown as FakeAudio;
    audio.loaded();
    expect(audio.src).toBe("asset:second");
    expect(audio.currentTime).toBe(8);
    expect(audio.paused).toBe(true);
    resolveFirst("asset:first");
    await first;
    expect(audio.src).toBe("asset:second");
    expect(controller.state.status).toBe("paused");
  });
  it("handles ended once and permits it again after an explicit seek", async () => {
    const controller = new PlaybackController(async () => "asset:one");
    await controller.load("one");
    const audio = controller.audio as unknown as FakeAudio;
    audio.loaded();
    const ended = vi.fn();
    controller.onEnded = ended;
    audio.dispatchEvent(new Event("ended"));
    audio.dispatchEvent(new Event("ended"));
    expect(ended).toHaveBeenCalledTimes(1);
    controller.seek(0);
    audio.dispatchEvent(new Event("ended"));
    expect(ended).toHaveBeenCalledTimes(2);
  });
  it("exposes missing-file errors without another source and cancels in-flight resolution on stop", async () => {
    const controller = new PlaybackController(async () => {
      throw Error("File missing");
    });
    await controller.load("missing");
    expect(controller.state.status).toBe("error");
    expect(controller.state.error).toContain("File missing");
    controller.stop();
    expect(controller.state.status).toBe("idle");
    expect(controller.audio.src).toBe("");
  });
});
