import { listeningStore } from "../adapters/listening";
import { ListeningTracker, type ListeningRecord } from "../domain/listening";
import type { Track } from "../domain/types";
import { player } from "./service";
import { mobile } from "../adapters/native";

export const historyChanged = new EventTarget();
let chain: Promise<void> = Promise.resolve();
let tracker: ListeningTracker | null = null;
let generation = 0;
let report: (error: unknown) => void = () => {};
let pendingFailure: unknown = null;
let resample = () => {};
const unsaved = new Map<string, { generation: number; record: ListeningRecord }>();
export function refreshListening() { resample(); }
export function nativeListeningHandoff(fresh = false) {
  if (!fresh) resample();
  return { generation, record: fresh || !tracker?.record ? null : structuredClone(tracker.record),
    nativeCount: fresh ? 0 : player.state.nativeListenedMs ?? 0 };
}
function queued(operation: () => Promise<void>) {
  chain = chain.then(operation).catch(error => { pendingFailure = error; report(error); });
}
export async function flushListening() {
  tracker?.flush();
  retryWrites();
  await chain;
  if (pendingFailure) throw pendingFailure;
}
export async function clearListening() {
  tracker?.reset();
  unsaved.clear();
  queued(async () => {
    generation = await listeningStore.clear();
    pendingFailure = null;
    historyChanged.dispatchEvent(new Event("change"));
  });
  await chain;
  if (pendingFailure) throw pendingFailure;
}

export async function reloadSyncedListening() {
  queued(async () => {
    const snapshot = await listeningStore.load();
    if (generation !== snapshot.generation) {
      tracker?.reset(); unsaved.clear(); generation = snapshot.generation;
      resample();
    }
    historyChanged.dispatchEvent(new Event('change'));
  });
  await chain;
}

function retryWrites() {
  // Work is serialized with clear and captures the generation at enqueue time.
  for (const [id, snapshot] of unsaved) queued(async () => {
    const accepted = await listeningStore.checkpoint(snapshot.generation, snapshot.record);
    if (unsaved.get(id) === snapshot) unsaved.delete(id);
    pendingFailure = null;
    if (accepted) historyChanged.dispatchEvent(new Event("change"));
  });
}

export async function startListening(
  getTrack: (id: string) => Track | undefined,
  enabled: () => boolean,
  onError: (error: unknown) => void,
) {
  report = onError;
  generation = (await listeningStore.load()).generation;
  const own = new ListeningTracker(record => {
    unsaved.set(record.id, { generation, record });
    retryWrites();
  });
  tracker = own;
  let nativeHistoryRevision = -1;
  let nativeHistoryEpoch: string | undefined;
  const sample = () => {
    const state = player.state;
    if (state.nativeQueueEpoch !== nativeHistoryEpoch) { nativeHistoryEpoch = state.nativeQueueEpoch; nativeHistoryRevision = -1; }
    if (mobile && state.nativeQueue && (state.nativeHistoryRevision ?? -1) > nativeHistoryRevision) {
      nativeHistoryRevision = state.nativeHistoryRevision!;
      historyChanged.dispatchEvent(new Event('change'));
    }
    const time = "audio" in player ? player.audio.currentTime : state.time;
    own.sample({ ...state, time }, state.trackId ? getTrack(state.trackId) : undefined, enabled() && !(mobile && state.nativeQueue), performance.now(), Date.now());
  };
  const unsubscribe = player.subscribe(sample);
  resample = sample;
  let tick = 0;
  const timer = window.setInterval(() => { sample(); if (++tick % 5 === 0) { own.flush(); retryWrites(); } }, 1000);
  const visible = () => { sample(); own.flush(); };
  window.addEventListener("pagehide", visible);
  document.addEventListener("visibilitychange", visible);
  return () => {
    own.flush(); unsubscribe(); clearInterval(timer);
    window.removeEventListener("pagehide", visible);
    document.removeEventListener("visibilitychange", visible);
    if (tracker === own) { tracker = null; resample = () => {}; }
  };
}
