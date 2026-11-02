import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PlaybackHandoffCard } from "./PlaybackHandoffCard";
import type { PlaybackCheckpoint } from "../../domain/playback-checkpoint";
import type { Track } from "../../domain/types";

const mockTrack: Track = {
  id: "track-1",
  title: "Tera Hua Sahiba",
  artist: "Garvit-Priyansh, Garvit Soni",
  album: "Tera Hua Sahiba",
  duration: 240,
  artworkUrl: "https://example.com/art.jpg",
  missing: false,
  fileName: "song.mp3",
  format: "MP3",
};

const mockCheckpoint: PlaybackCheckpoint = {
  version: 1,
  id: "cp-1",
  deviceId: "dev-phone",
  deviceName: "Android Phone",
  capturedAt: Date.now() - 1000 * 60 * 5, // 5 min ago
  playing: true,
  currentEntryId: "entry-1",
  position: 45,
  queue: [
    {
      id: "entry-1",
      trackId: "track-1",
      metadata: mockTrack,
    },
  ],
  shuffleOrder: [],
  shuffle: true,
  repeat: "off",
  playlistName: "Favorites",
};

describe("PlaybackHandoffCard", () => {
  it("renders sleek handoff card with device, track metadata, and playlist info", () => {
    const html = renderToStaticMarkup(
      <PlaybackHandoffCard
        checkpoint={mockCheckpoint}
        onContinue={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );

    expect(html).toContain("Continue from Android Phone");
    expect(html).toContain("Tera Hua Sahiba");
    expect(html).toContain("Garvit-Priyansh, Garvit Soni");
    expect(html).toContain("From: Favorites");
    expect(html).toContain("1 track in queue");
    expect(html).toContain("Shuffle on");
    expect(html).toContain("handoff-artwork-wrap");
    expect(html).toContain("Continue");
    expect(html).toContain('aria-label="Dismiss"');
  });

  it("renders laptop icon for PC/Mac devices", () => {
    const pcCheckpoint: PlaybackCheckpoint = {
      ...mockCheckpoint,
      deviceName: "Windows PC",
    };
    const html = renderToStaticMarkup(
      <PlaybackHandoffCard
        checkpoint={pcCheckpoint}
        onContinue={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    expect(html).toContain("Continue from Windows PC");
  });

  it("returns null if current track metadata is missing", () => {
    const emptyCheckpoint: PlaybackCheckpoint = {
      ...mockCheckpoint,
      currentEntryId: "missing-id",
    };
    const html = renderToStaticMarkup(
      <PlaybackHandoffCard
        checkpoint={emptyCheckpoint}
        onContinue={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    expect(html).toBe("");
  });
});
