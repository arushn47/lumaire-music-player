import { describe, it, expect, vi } from "vitest";

const state = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0, effects: [] as Array<() => void>, events: [] as string[] }));
vi.mock("react", async importOriginal => ({
  ...await importOriginal<typeof import("react")>(),
  useEffect: (effect: () => void) => { state.effects.push(effect); },
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

const mockEntries = [
  { trackId: "t1", collectionId: "album:1", title: "Track One", status: "completed", addedAt: 100 },
  { trackId: "t2", collectionId: "album:1", title: "Track Two", status: "pending", addedAt: 101 },
  { trackId: "t3", collectionId: "album:1", title: "Track Three", status: "failed", addedAt: 102 },
];
const recoveryTrack: CatalogTrack = { id: "t2", title: "Track Two", artist: "Artist", album: "Album", artists: [], duration: 60 };

vi.mock("../adapters/native", () => ({
  library: {
    getDownloadQueue: vi.fn().mockImplementation(() => Promise.resolve(mockEntries)),
    saveDownloadQueue: vi.fn().mockImplementation(async () => { state.events.push("queue-saved"); }),
    updateDownloadQueueStatus: vi.fn().mockImplementation(async (trackId: string, status: string) => { state.events.push(`${trackId}:${status}`); }),
    clearDownloadQueue: vi.fn().mockResolvedValue(undefined),
    downloadNotification: vi.fn().mockResolvedValue(undefined),
  },
}));

import { useAlbumDownloads } from "./useAlbumDownloads";
import type { CatalogTrack } from "../adapters/native";

describe("useAlbumDownloads", () => {
  it("restores pending download queue state from persistent store on mount", async () => {
    state.cursor = 0;
    state.slots = [];
    state.effects = [];
    state.events = [];

    const downloadMock = vi.fn().mockResolvedValue(true);
    const hook = useAlbumDownloads(downloadMock);

    // Run the mount effect
    for (const eff of state.effects) eff();

    await new Promise(r => setTimeout(r, 10));

    // After effect runs, check the updated progress slot (slot 0)
    const progress = state.slots[0] as Record<string, { total: number; done: number; failed: string[]; paused: boolean }>;
    expect(progress["album:1"]).toBeDefined();
    expect(progress["album:1"].total).toBe(3);
    expect(progress["album:1"].done).toBe(2);
    expect(progress["album:1"].failed).toEqual(["Track Three"]);
    expect(progress["album:1"].paused).toBe(true);
  });

  it("automatically resumes persisted pending tracks when the app opens", async () => {
    state.cursor = 0;
    state.slots = [];
    state.effects = [];
    state.events = [];
    Object.assign(mockEntries[1], { track: recoveryTrack });

    const downloadMock = vi.fn().mockResolvedValue(true);
    const hook = useAlbumDownloads(downloadMock);
    for (const eff of state.effects) eff();
    await new Promise(r => setTimeout(r, 10));

    expect(downloadMock).toHaveBeenCalledWith(recoveryTrack, expect.any(Function), expect.any(AbortSignal));
    expect(state.events).toContain("t2:downloading");
    expect(state.events).toContain("t2:completed");
    delete (mockEntries[1] as typeof mockEntries[number] & { track?: CatalogTrack }).track;
  });

  it("persists a queue and each state transition before starting the next download", async () => {
    state.cursor = 0;
    state.slots = [];
    state.effects = [];
    state.events = [];
    const track: CatalogTrack = { id: "track-1", title: "Track One", artist: "Artist", album: "Album", artists: [], duration: 60 };
    const hook = useAlbumDownloads(async () => { state.events.push("download-started"); return true; });
    await hook.start("album:1", [track]);
    expect(state.events).toEqual(["queue-saved", "track-1:downloading", "download-started", "track-1:completed"]);
  });

  it("does not cancel an active native download when the app UI unmounts", async () => {
    state.cursor = 0;
    state.slots = [];
    state.effects = [];
    state.events = [];
    let finish!: (success: boolean) => void;
    let signal: AbortSignal | undefined;
    const hook = useAlbumDownloads((_track, _onStage, activeSignal) => {
      signal = activeSignal;
      return new Promise<boolean>(resolve => { finish = resolve; });
    });
    const running = hook.start("album:1", [{ id: "track-1", title: "Track One", artist: "Artist", album: "Album", artists: [], duration: 60 }]);
    await new Promise(r => setTimeout(r, 0));
    state.effects[0]?.();
    expect(signal?.aborted).toBe(false);
    finish(true);
    await running;
  });
});
