export interface PlaybackEvent {
  trackId: string; stage: string; candidateId?: string; reason?: string; count?: number; query?: string;
  operationId?: number; playbackId?: string | null; durationMs?: number;
  cache?: "hit" | "miss" | "shared" | "verified" | "known" | "memory";
}

let operationId = 0;

// Local, bounded diagnostics only. Stream URLs, credentials and native paths are never logged.
export function playbackEvent(event: PlaybackEvent): void {
  try { console.debug("[Lumaire playback]", JSON.stringify(event)); }
  catch { /* Diagnostics must never interrupt playback. */ }
}

export async function measurePlayback<T>(event: PlaybackEvent, work: () => Promise<T>): Promise<T> {
  const id = ++operationId, started = performance.now();
  playbackEvent({ ...event, stage: `${event.stage}-start`, operationId: id });
  try {
    const value = await work();
    playbackEvent({ ...event, stage: `${event.stage}-end`, operationId: id, durationMs: performance.now() - started });
    return value;
  } catch (error) {
    playbackEvent({ ...event, stage: `${event.stage}-failed`, operationId: id, durationMs: performance.now() - started });
    throw error;
  }
}
