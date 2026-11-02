import { measurePlayback, playbackEvent } from "./diagnostics";
import { registerAudioElement } from "./audio-analyser";

export type Playback = {
  nativeQueueRevision?: number;
  nativeQueueEpoch?: string;
  nativeStateAt?: number;
  nativeHistoryRevision?: number;
  nativeQueue?: { epoch?: string; revision: number; session: Pick<import('../domain/types').Session, 'queue' | 'queueTracks' | 'currentId' | 'position' | 'shuffleOrder'> };
  autoplay?: boolean;
  /** Stable media identity for observers; never a resolved stream URL. */
  trackId?: string | null;
  playbackId?: string | null;
  seekVersion?: number;
  /** Actual media progress counted by Android's playback service while the UI sleeps. */
  nativeListenedMs?: number;
  status:
    "idle" | "loading" | "playing" | "paused" | "buffering" | "ended" | "error";
  time: number;
  duration: number;
  error: string | null;
};

type Resolver = (id: string, retry?: boolean, alternative?: boolean) => Promise<string>;

export class PlaybackController {
  readonly audio: HTMLAudioElement =
    typeof Audio !== "undefined"
      ? new Audio()
      : (null as unknown as HTMLAudioElement);
  private generation = 0;
  private endedHandled = false;
  private preciseClock = false;
  private frame: number | null = null;
  private loadTimer: ReturnType<typeof setTimeout> | null = null;
  private retries = 0;
  private recovering = false;
  private sourceGeneration = 0;
  private listeners = new Set<(state: Playback) => void>();
  state: Playback = { status: "idle", time: 0, duration: 0, error: null };
  onEnded: () => void = () => {};
  constructor(private resolve: Resolver) {
    if (!this.audio || typeof this.audio.addEventListener !== "function") return;
    registerAudioElement(this.audio);
    this.audio.preload = "metadata";
    this.audio.addEventListener("timeupdate", () =>
      this.update({ time: this.audio.currentTime }),
    );
    this.audio.addEventListener("durationchange", () =>
      this.update({
        duration: Number.isFinite(this.audio.duration)
          ? this.audio.duration
          : 0,
      }),
    );
    this.audio.addEventListener("playing", () => {
      this.clearLoadTimer();
      playbackEvent({ trackId: this.state.trackId || "", stage: "playing", playbackId: this.state.playbackId });
      this.update({ status: "playing", error: null });
      this.startClock();
    });
    this.audio.addEventListener("waiting", () => {
      if (!this.audio.paused) this.update({ status: "buffering" });
    });
    this.audio.addEventListener("pause", () => {
      this.stopClock();
      if (
        !this.audio.ended &&
        this.state.status !== "loading" &&
        this.state.status !== "error"
      )
        this.update({ status: "paused", time: this.audio.currentTime });
    });
    this.audio.addEventListener("ended", () => {
      this.stopClock();
      if (this.endedHandled) return;
      this.endedHandled = true;
      this.update({ status: "ended", time: this.audio.duration });
      this.onEnded();
    });
    this.audio.addEventListener("error", () => {
      if (this.state.status === "idle") return;
      void this.recoverSource(this.audio.error?.code === 4 ? "Audio decoding or format failed" : "Audio transport failed");
    });
    this.audio.addEventListener("seeking", () =>
      this.update({ seekVersion: (this.state.seekVersion ?? 0) + 1, time: this.audio.currentTime }),
    );
  }
  // A visible lyric reader samples the actual media clock at <=50 ms intervals.
  // No elapsed-time accumulation; normal transport uses native timeupdate events.
  precise(enabled: boolean) {
    this.preciseClock = enabled;
    this.stopClock();
    if (enabled && !this.audio.paused) this.startClock();
  }
  private startClock() {
    if (
      !this.preciseClock ||
      typeof requestAnimationFrame === "undefined" ||
      this.frame !== null
    )
      return;
    let last = 0;
    const tick = (now: number) => {
      if (this.audio.paused || !this.preciseClock) {
        this.frame = null;
        return;
      }
      if (now - last >= 50) {
        last = now;
        this.update({ time: this.audio.currentTime });
      }
      this.frame = requestAnimationFrame(tick);
    };
    this.frame = requestAnimationFrame(tick);
  }
  private stopClock() {
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
  }
  subscribe(fn: (s: Playback) => void) {
    this.listeners.add(fn);
    fn(this.state);
    return () => {
      this.listeners.delete(fn);
    };
  }
  private update(patch: Partial<Playback>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((fn) => fn(this.state));
  }
  private clearLoadTimer() {
    if (this.loadTimer !== null) clearTimeout(this.loadTimer);
    this.loadTimer = null;
  }
  private async recoverSource(reason: string) {
    if (this.recovering) return;
    this.clearLoadTimer();
    if (this.retries >= 2 || !this.state.trackId?.startsWith("youtube:")) {
      this.update({ status: "error", error: `${reason}. Retry playback, check your connection, or choose another source.` });
      playbackEvent({ trackId: this.state.trackId || "", stage: "engine-failed", reason });
      return;
    }
    this.retries++;
    this.recovering = true;
    playbackEvent({ trackId: this.state.trackId, stage: "engine-retry", reason });
    const generation = this.generation;
    try { await this.attachSource(this.state.trackId, generation, true, this.state.autoplay || false, this.state.time, this.retries === 2); }
    finally { if (generation === this.generation) this.recovering = false; }
  }
  private async attachSource(id: string, generation: number, retry: boolean, autoplay: boolean, position: number, alternative = false) {
    const sourceGeneration = ++this.sourceGeneration;
    this.update({ status: "loading", error: null });
    try {
      const url = await measurePlayback({ trackId: id, stage: "source-request", playbackId: this.state.playbackId }, () => alternative ? this.resolve(id, true, true) : this.resolve(id, retry));
      if (generation !== this.generation || sourceGeneration !== this.sourceGeneration) return;
      const attachedAt = performance.now();
      this.audio.onloadedmetadata = () => {
        if (generation !== this.generation || sourceGeneration !== this.sourceGeneration) return;
        this.clearLoadTimer();
        this.audio.currentTime = Math.min(position, Number.isFinite(this.audio.duration) ? this.audio.duration : position);
        this.update({ status: "paused", duration: this.audio.duration });
        playbackEvent({ trackId: id, stage: "audio-loaded", playbackId: this.state.playbackId, durationMs: performance.now() - attachedAt });
        if (autoplay) void this.play();
      };
      this.audio.src = url;
      this.clearLoadTimer();
      this.loadTimer = setTimeout(() => { void this.recoverSource("Audio loading timed out"); }, 20000);
      this.audio.load();
    } catch (error) {
      if (generation === this.generation && sourceGeneration === this.sourceGeneration) {
        this.clearLoadTimer();
        this.update({ status: "error", error: error instanceof Error ? error.message : String(error) });
        playbackEvent({ trackId: id, stage: "resolution-failed", playbackId: this.state.playbackId });
      }
    }
  }
  beginLoading(id: string, autoplay = false, position = 0) {
    ++this.generation;
    this.clearLoadTimer();
    this.retries = 0;
    this.recovering = false;
    this.audio.onloadedmetadata = null;
    this.audio.pause();
    this.audio.removeAttribute("src");
    this.audio.load();
    this.endedHandled = false;
    this.update({
      status: "loading",
      autoplay,
      trackId: id,
      playbackId: crypto.randomUUID(),
      seekVersion: 0,
      time: position,
      duration: 0,
      error: null,
    });
    playbackEvent({ trackId: id, stage: "selection", playbackId: this.state.playbackId });
    return this.state.playbackId!;
  }
  failLoading(playbackId: string, error: string, autoplay = false) {
    if (this.state.playbackId === playbackId)
      this.update({ status: "error", error, autoplay });
  }
  async load(id: string, autoplay = false, position = 0) {
    if (this.state.trackId === id && this.state.status === "loading" && (!autoplay || this.state.autoplay)) return;
    this.beginLoading(id, autoplay, position);
    const generation = this.generation;
    await this.attachSource(id, generation, false, autoplay, position);
  }
  async play() {
    const generation = this.generation;
    if (!this.audio.src) return;
    if (this.state.status === "ended")
      this.update({ playbackId: crypto.randomUUID(), time: this.audio.currentTime });
    this.endedHandled = false;
    try {
      await this.audio.play();
    } catch (e) {
      if (
        generation === this.generation &&
        !(e instanceof DOMException && e.name === "AbortError")
      )
        this.update({
          status: "error",
          error:
            "Playback could not start. Press Play to retry or relink this file.",
        });
    }
  }
  pause() {
    this.audio.pause();
  }
  seek(time: number) {
    if (Number.isFinite(this.audio.duration)) {
      this.update({ seekVersion: (this.state.seekVersion ?? 0) + 1 });
      this.endedHandled = false;
      this.audio.currentTime = Math.min(this.audio.duration, Math.max(0, time));
      this.update({ time: this.audio.currentTime });
    }
  }
  volume(value: number) {
    this.audio.volume = Math.min(1, Math.max(0, value));
  }
  stop() {
    ++this.generation;
    this.clearLoadTimer();
    this.audio.onloadedmetadata = null;
    this.audio.pause();
    this.audio.removeAttribute("src");
    this.audio.load();
    this.update({ status: "idle", trackId: null, playbackId: null, time: 0, duration: 0, error: null });
  }
}
