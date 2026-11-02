import { afterEach, expect, it, vi } from "vitest";
import { measurePlayback, playbackEvent } from "./diagnostics";

afterEach(() => vi.restoreAllMocks());

it("times an operation without changing its result or recording its payload", async () => {
  const log = vi.spyOn(console, "debug").mockImplementation(() => {});
  vi.spyOn(performance, "now").mockReturnValueOnce(100).mockReturnValueOnce(145);
  const value = { streamUrl: "https://private.example/audio?token=secret" };
  expect(await measurePlayback({ trackId: "song", stage: "extraction" }, async () => value)).toBe(value);
  const [start, end] = log.mock.calls.map(call => JSON.parse(call[1]));
  expect(start.stage).toBe("extraction-start");
  expect(end).toMatchObject({ stage: "extraction-end", durationMs: 45, operationId: start.operationId });
  expect(JSON.stringify(log.mock.calls)).not.toContain("secret");
});

it("preserves the original rejection without logging provider error text", async () => {
  const log = vi.spyOn(console, "debug").mockImplementation(() => {});
  const error = Error("private URL and credentials");
  await expect(measurePlayback({ trackId: "song", stage: "search-request" }, async () => { throw error; })).rejects.toBe(error);
  expect(JSON.parse(log.mock.calls[1][1]).stage).toBe("search-request-failed");
  expect(JSON.stringify(log.mock.calls)).not.toContain(error.message);
});

it("gives overlapping operations distinct IDs even when the same song is requested", async () => {
  const log = vi.spyOn(console, "debug").mockImplementation(() => {});
  let finish!: () => void;
  const first = measurePlayback({ trackId: "song", stage: "extraction" }, () => new Promise<void>(resolve => { finish = resolve; }));
  await measurePlayback({ trackId: "song", stage: "extraction" }, async () => {});
  finish(); await first;
  const events = log.mock.calls.map(call => JSON.parse(call[1]));
  expect(events[0].operationId).not.toBe(events[1].operationId);
  expect(events[2].operationId).toBe(events[1].operationId);
  expect(events[3].operationId).toBe(events[0].operationId);
});

it("a broken diagnostics sink cannot stop a playback operation", async () => {
  vi.spyOn(console, "debug").mockImplementation(() => { throw Error("logger failed"); });
  expect(() => playbackEvent({ trackId: "song", stage: "playing" })).not.toThrow();
  expect(await measurePlayback({ trackId: "song", stage: "extraction" }, async () => 42)).toBe(42);
});
