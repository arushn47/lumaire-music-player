import { expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MobileNowPlaying, type MobileNowPlayingProps } from "./MobileNowPlaying";
import { defaults, type Track } from "../../domain/types";

const mockTrack: Track = {
  id: "track-1",
  title: "Magale (From \"Baththa\")",
  artist: "Sai Abhyankkar, Harini, Karthik Netha",
  album: "Baththa",
  duration: 257,
  fileName: "magale.mp3",
  offline: false,
  missing: false,
  format: "online",
  artworkUrl: "https://example.com/art.jpg",
};

const baseProps: MobileNowPlayingProps = {
  track: mockTrack,
  tracks: [mockTrack],
  session: {
    ...defaults(),
    currentId: "queue-1",
    queue: [{ id: "queue-1", trackId: "track-1", requested: true }],
  },
  playback: {
    status: "playing",
    trackId: "track-1",
    time: 45,
    duration: 257,
    error: null,
  },
  onClose: vi.fn(),
  onTogglePlay: vi.fn(),
  onSkip: vi.fn(),
  onSeek: vi.fn(),
  onFavorite: vi.fn(),
  onSetting: vi.fn(),
  onNavigateArtist: vi.fn(),
  onSelectQueue: vi.fn(),
  onReorderUpcoming: vi.fn(),
  onRemoveQueue: vi.fn(),
  onClearQueue: vi.fn(),
};

it('keeps optional correction inside the song menu without a permanent verification prompt',()=>{
  const html=renderToStaticMarkup(<MobileNowPlaying {...baseProps} onWrongVersion={()=>{}}/>);
  expect(html).toContain('aria-label="Current song actions"');expect(html).toContain('Wrong version playing?');
  expect(html).not.toContain('Verify song');expect(html).not.toContain('Confirm correct recording');expect(html).not.toContain('source-chooser');
  expect(renderToStaticMarkup(<MobileNowPlaying {...baseProps}/>)).not.toContain('Wrong version playing?');
});

it("renders the mobile Now Playing screen with track metadata and transport controls", () => {
  const html = renderToStaticMarkup(<MobileNowPlaying {...baseProps} />);
  expect(html).toContain("Magale (From &quot;Baththa&quot;)");
  expect(html).toContain("Sai Abhyankkar");
  expect(html).toContain("0:45");
  expect(html).toContain("4:17");
  expect(html).toContain('aria-label="Add to playlist"');
  expect(html).toContain('aria-label="Save to favorites"');
  expect(html).toContain('aria-label="Pause"');
  expect(html).toContain('aria-label="Previous track"');
  expect(html).toContain('aria-label="Next track"');
  expect(html).toContain('aria-label="Toggle shuffle"');
  expect(html).toContain('aria-label="Repeat mode: off"');
});

it("keeps only Up next in the expanded mobile player", () => {
  const html = renderToStaticMarkup(<MobileNowPlaying {...baseProps} />);
  expect(html).toContain("Up next");
  expect(html).toContain('aria-label="Player views"');
  expect(html).not.toContain("Lyrics");
  expect(html).not.toContain("mobile-np-lyrics");
});

it("renders collapse button and drag handle for dismissal", () => {
  const html = renderToStaticMarkup(<MobileNowPlaying {...baseProps} />);
  expect(html).toContain('aria-label="Collapse player"');
  expect(html).toContain('class="mobile-np-drag-pill"');
});

it("adapts data-theme and data-accent attributes from session settings", () => {
  const customProps: MobileNowPlayingProps = {
    ...baseProps,
    session: {
      ...baseProps.session,
      settings: {
        ...baseProps.session.settings,
        themeMode: "light",
        accentColor: "#F59E0B",
        autoplay: true,
      },
    },
  };
  const html = renderToStaticMarkup(<MobileNowPlaying {...customProps} />);
  expect(html).toContain('data-theme="light"');
  expect(html).toContain('data-accent="#F59E0B"');
});

