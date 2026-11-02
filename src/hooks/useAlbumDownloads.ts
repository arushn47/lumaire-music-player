import { useEffect, useRef, useState } from "react";
import { library, type CatalogTrack } from "../adapters/native";

export interface AlbumDownloadProgress {
  done: number;
  total: number;
  failed: string[];
  active: boolean;
  paused: boolean;
  cancelled: boolean;
  title: string;
  stage: string;
  percent?: number;
}

type Download = (track: CatalogTrack, onStage?: (stage: string, percent?: number) => void, signal?: AbortSignal) => Promise<boolean>;
type Job = { controller: AbortController; progress: AlbumDownloadProgress; wake?: () => void };

// Owned by App so page navigation never abandons an album job.
export function useAlbumDownloads(download: Download) {
  const [progress, setProgress] = useState<Record<string, AlbumDownloadProgress>>({});
  const jobs = useRef(new Map<string, Job>());
  const publish = (id: string, job: Job) => setProgress(previous => ({ ...previous, [id]: { ...job.progress } }));

  useEffect(() => {
    let mounted = true;
    void library.getDownloadQueue?.().then(entries => {
      if (!mounted || !entries || !entries.length) return;
      const groups: Record<string, typeof entries> = {};
      for (const e of entries) {
        groups[e.collectionId] = groups[e.collectionId] || [];
        groups[e.collectionId].push(e);
      }
      const restored: Record<string, AlbumDownloadProgress> = {};
      for (const [colId, items] of Object.entries(groups)) {
        const done = items.filter(i => i.status === "completed" || i.status === "failed").length;
        const failed = items.filter(i => i.status === "failed").map(i => i.title);
        const hasPending = items.some(i => i.status === "pending" || i.status === "paused");
        restored[colId] = {
          done,
          total: items.length,
          failed,
          active: false,
          paused: hasPending,
          cancelled: false,
          title: items.find(i => i.status === "pending" || i.status === "paused")?.title || items[0]?.title || "",
          stage: hasPending ? "Paused" : "Completed",
        };
      }
      setProgress(prev => ({ ...restored, ...prev }));
      for (const [colId, items] of Object.entries(groups)) {
        const recoverable = items.filter(i => (i.status === "pending" || i.status === "paused") && i.track);
        if (recoverable.length) void start(colId, recoverable.map(i => i.track!));
      }
    }).catch(() => {});

    return () => {
      mounted = false;
    };
  }, []);

  async function start(id: string, tracks: CatalogTrack[]) {
    if (!tracks.length || jobs.current.has(id)) return;
    const job: Job = { controller: new AbortController(), progress: {
      done: 0, total: tracks.length, failed: [], active: true, paused: false,
      cancelled: false, title: "", stage: "Preparing",
    } };
    jobs.current.set(id, job);
    const state = job.progress;
    publish(id, job);
    void library.downloadNotification?.({ active: true, title: "Preparing downloads…", done: 0, total: tracks.length });
    await library.saveDownloadQueue?.(tracks.map(t => ({
      trackId: t.id,
      collectionId: id,
      title: t.title,
      status: "pending",
      addedAt: Date.now(),
      track: t,
    })));
    try {
      for (const track of tracks) {
        if (state.paused && !job.controller.signal.aborted) {
          void library.downloadNotification?.({ active: false, title: "Paused", done: state.done, total: state.total });
          await new Promise<void>(resolve => { job.wake = resolve; });
        }
        job.wake = undefined;
        if (job.controller.signal.aborted) break;
        state.percent = undefined;
        state.title = track.title;
        state.stage = "Finding audio source";
        publish(id, job);
        void library.downloadNotification?.({ active: true, title: track.title, done: state.done, total: state.total });
        await library.updateDownloadQueueStatus?.(track.id, "downloading");

        let success = false;
        // Bounded retry with backoff for transient network errors
        for (let attempt = 0; attempt < 3; attempt++) {
          if (job.controller.signal.aborted) break;
          try {
            if (attempt > 0) {
              state.stage = `Retrying (${attempt}/2)`;
              publish(id, job);
              await new Promise(r => setTimeout(r, 1200 * attempt));
            }
            success = await download(
              track,
              (stage, percent) => {
                state.stage = stage;
                state.percent = percent;
                publish(id, job);
              },
              job.controller.signal
            );
            if (success) break;
          } catch {
            /* Retry transient failures */
          }
        }

        if (job.controller.signal.aborted && !success) break;
        await library.updateDownloadQueueStatus?.(track.id, success ? "completed" : "failed");
        if (!success) state.failed = [...state.failed, track.title];
        state.done++;
        state.percent = undefined;
        state.stage = "Waiting";
        publish(id, job);
        void library.downloadNotification?.({ active: true, title: track.title, done: state.done, total: state.total });
      }
    } finally {
      state.active = false;
      state.paused = false;
      state.cancelled = job.controller.signal.aborted;
      jobs.current.delete(id);
      publish(id, job);
      void library.downloadNotification?.({ active: false, title: "", done: state.done, total: state.total });
    }
  }

  function pause(id: string) {
    const job = jobs.current.get(id);
    if (!job || job.controller.signal.aborted) return;
    job.progress.paused = !job.progress.paused;
    if (!job.progress.paused) {
      void library.downloadNotification?.({ active: true, title: job.progress.title, done: job.progress.done, total: job.progress.total });
      job.wake?.();
    } else {
      void library.downloadNotification?.({ active: false, title: "Paused", done: job.progress.done, total: job.progress.total });
    }
    publish(id, job);
  }

  function cancel(id: string) {
    const job = jobs.current.get(id);
    if (!job) return;
    job.controller.abort();
    job.progress.cancelled = true;
    job.wake?.();
    void library.clearDownloadQueue?.(id);
    publish(id, job);
    void library.downloadNotification?.({ active: false, title: "", done: job.progress.done, total: job.progress.total });
  }

  return { progress, start, pause, cancel };
}
