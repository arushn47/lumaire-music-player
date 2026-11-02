import { addPluginListener, invoke, type PluginListener } from "@tauri-apps/api/core";
import type { Track } from "../domain/types";
import type { Playback } from "./controller";
import { measurePlayback, playbackEvent } from "./diagnostics";

/** Poll the service's real media clock; never estimate elapsed playback time. */
export class AndroidPlaybackController {
  state: Playback = { status: "idle", time: 0, duration: 0, error: null };
  onEnded: () => void = () => {};
  onNext: () => void = () => {};
  onPrevious: () => void = () => {};
  private listeners = new Set<(state: Playback) => void>();
  private generation = 0;
  private ended = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private polling = false;
  private preciseClock = false;
  private failedLoad = false;
  private manualLoading = false;
  private handoffSequence = 0;
  private handoffs: Promise<void> = Promise.resolve();
  private events: Promise<PluginListener | null> | null = null;

  constructor(
    private readonly metadata: (
      id: string,
    ) => Pick<Track, "title" | "artist" | "artworkUrl"> | undefined = () => undefined,
  ) {
    document.addEventListener("visibilitychange", () => {
      this.schedule();
      if (!document.hidden) void this.poll();
    });
  }
  private update(rawState: Playback & { id?: string; pendingAction?: string }) {
    if ((rawState.nativeStateAt ?? Infinity) < (this.state.nativeStateAt ?? -Infinity)) return;
    const wasEnded = this.ended;
    const state: Playback = {
      ...rawState,
      trackId: rawState.trackId ?? (rawState.id ? rawState.id : this.state.trackId),
      playbackId: rawState.playbackId ?? this.state.playbackId,
      seekVersion: rawState.seekVersion ?? this.state.seekVersion,
    };
    if (rawState.nativeQueue && state.trackId !== this.state.trackId) state.playbackId = crypto.randomUUID();
    if (state.status === "loading" && state.playbackId !== this.state.playbackId)
      playbackEvent({ trackId: state.trackId || "", stage: "selection", playbackId: state.playbackId });
    if (state.status !== this.state.status && ["playing", "buffering", "error"].includes(state.status))
      playbackEvent({ trackId: state.trackId || "", stage: state.status === "error" ? "engine-failed" : state.status, playbackId: state.playbackId });
    this.state = state;
    this.ended = state.status === "ended";
    this.listeners.forEach((fn) => fn(state));
    if (this.ended && !wasEnded && !state.nativeQueue) this.onEnded();
    if (rawState.pendingAction === "next") this.onNext();
    else if (rawState.pendingAction === "prev") this.onPrevious();
  }
  private watch() {
    if (this.events) return;
    this.events = addPluginListener<Playback & { id?: string }>(
      "lumaire-android", "playback", state => {
        // A late service event must not replace a newer catalog/source selection.
        if (!this.listeners.size || !state.id || this.failedLoad || this.manualLoading
          || (state.nativeQueueEpoch === this.state.nativeQueueEpoch && (state.nativeQueueRevision ?? 0) < (this.state.nativeQueueRevision ?? 0))
          || (!state.nativeQueue && state.id !== this.state.trackId)) return;
        this.update(state);
      },
    ).catch(() => null);
  }
  private schedule() {
    if (this.timer) clearInterval(this.timer);
    this.timer =
      !document.hidden && this.listeners.size
        ? setInterval(() => void this.poll(), this.preciseClock ? 100 : 500)
        : null;
  }
  private async poll() {
    if (this.polling || (this.state.status === "loading" && !this.state.nativeQueue) || this.failedLoad) return;
    this.polling = true;
    const generation = this.generation;
    try {
      const state = await invoke<Playback>("android_playback", {
        action: "state",
      });
      if (generation === this.generation) this.update(state);
    } catch {
      /* A transient service reconnect must not erase the queue. */
    } finally {
      this.polling = false;
    }
  }
  private async command(action: string, args: Record<string, unknown> = {}) {
    const generation = this.generation;
    try {
      const load = () => invoke<Playback>("android_playback", { action, ...args });
      const state = action === "load"
        ? await measurePlayback({ trackId: this.state.trackId || "", stage: "native-load", playbackId: this.state.playbackId }, load)
        : await load();
      if (generation === this.generation) {
        if (action === 'load') this.manualLoading = false;
        this.update(state);
      }
    } catch (error) {
      if (generation === this.generation) {
        if (action === "load") this.failedLoad = true;
        this.update({ ...this.state, status: "error", error: String(error) });
      }
    }
  }
  subscribe(fn: (state: Playback) => void) {
    this.listeners.add(fn);
    this.watch();
    fn(this.state);
    this.schedule();
    return () => {
      this.listeners.delete(fn);
      this.schedule();
      if (!this.listeners.size) {
        const events = this.events;
        this.events = null;
        void events?.then(listener => listener?.unregister()).catch(() => {});
      }
    };
  }
  precise(enabled: boolean) {
    this.preciseClock = enabled;
    this.schedule();
  }
  async handoffQueue(queue: import('./background-policy').BackgroundQueue, revision: number) {
    const sequence = ++this.handoffSequence, generation = this.generation;
    this.handoffs = this.handoffs.catch(() => {}).then(async () => {
      if (sequence !== this.handoffSequence || generation !== this.generation) return;
      const state = await invoke<Playback>('android_background_queue', { queue, revision });
      if (sequence === this.handoffSequence && generation === this.generation && (state.trackId || (state as Playback & {id?:string}).id)) this.update(state);
    });
    return this.handoffs;
  }
  async startQueue(queue: import('./background-policy').BackgroundQueue, autoplay: boolean, position: number) {
    const entry = queue.session.queue.find(item => item.id === queue.session.currentId);
    if (!entry) return;
    const generation = ++this.generation;
    this.manualLoading = true; this.failedLoad = false; this.ended = false;
    this.update({ status:'loading', trackId:entry.trackId, playbackId:crypto.randomUUID(), autoplay, time:position, duration:0, error:null });
    try {
      const state = await invoke<Playback>('android_background_start',{queue,autoplay,position});
      if (generation === this.generation) { this.manualLoading = false; this.update(state); }
    } catch(error) {
      if (generation === this.generation) {
        // Runtime-disabled prototype builds keep their existing local-file controller.
        if (String(error).includes('Native queue runtime unavailable.')) { await this.load(entry.trackId,autoplay,position); return; }
        this.manualLoading = false; this.failedLoad = true; this.update({...this.state,status:'error',error:String(error)});
      }
    }
  }
  async load(id: string, autoplay = false, position = 0) {
    const generation = ++this.generation;
    this.failedLoad = false;
    this.manualLoading = true;
    this.ended = false;
    this.update({
      status: "loading",
      playbackId: crypto.randomUUID(),
      seekVersion: 0,
      trackId: id,
      time: position,
      duration: 0,
      error: null,
    });
    if (!autoplay) {
      try {
        const active = await invoke<Playback & { id?: string }>(
          "android_playback",
          { action: "state" },
        );
        if (generation !== this.generation) return;
        if (active.id === id && active.status === "playing") {
          this.manualLoading = false;
          this.update(active);
          return;
        }
      } catch {
        /* First launch creates the service when loading below. */
      }
    }
    if (generation !== this.generation) return;
    const metadata = this.metadata(id);
    await this.command("load", {
      id,
      autoplay,
      position,
      ...(metadata && {
        displayMetadata: {
          title: metadata.title,
          artist: metadata.artist,
          artwork_url: metadata.artworkUrl,
        },
      }),
    });
  }
  beginLoading(id: string, autoplay = false, position = 0): string {
    ++this.generation;
    this.failedLoad = false;
    this.manualLoading = true;
    this.ended = false;
    const playbackId = crypto.randomUUID();
    this.update({ status: "loading", trackId: id, playbackId, autoplay, time: position, duration: 0, error: null });
    void invoke("android_playback", { action: "stop" }).catch(() => {});
    return playbackId;
  }
  failLoading(playbackId: string, error: string, autoplay = false) {
    if (this.state.playbackId !== playbackId) return;
    this.failedLoad = true;
    this.update({ ...this.state, status: "error", error, autoplay });
  }
  play() {
    return this.command("play");
  }
  pause() {
    void this.command("pause");
  }
  seek(value: number) {
    if (Number.isFinite(value)) {
      this.ended = false;
      this.update({ ...this.state, seekVersion: (this.state.seekVersion ?? 0) + 1 });
      void this.command("seek", { value: Math.max(0, value) });
    }
  }
  volume(value: number) {
    if (Number.isFinite(value))
      void this.command("volume", { value: Math.max(0, Math.min(1, value)) });
  }
  stop() {
    ++this.generation;
    this.failedLoad = false;
    void this.command("stop");
  }
  setLyrics(trackId: string, lines: Array<{ time: number | null; text: string }>) {
    void invoke("android_set_lyrics", { trackId, lines }).catch(() => {});
  }
  setTheme(themeMode: string, accentColor: string) {
    void invoke("android_set_theme", { themeMode, accentColor }).catch(() => {});
  }
}
