import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PlayerBar, TrackActionMenuItems, formatWordTruncatedTitle, type PlayerBarProps } from "./PlayerBar";
import { defaults } from "../../domain/types";
it('offers optional correction inside song actions and excludes local or offline recordings',()=>{
  const noop=()=>{};
  const props={track:{id:'youtube:g12hFFO6KCI',metadataSourceId:'saavn:M4t__2Pc',title:'Hola Amigo',artist:'KR$NA',album:'',format:'webm',fileName:'',duration:226,missing:false},tracks:[],downloads:{},session:defaults(),onSaveOnline:noop,onChoosePlaylist:noop,onFavorite:noop,onCancelDownload:noop,onDownloadTrack:noop,onDeleteOffline:noop};
  expect(renderToStaticMarkup(<TrackActionMenuItems {...props} onWrongVersion={noop}/>)).toContain('Wrong version playing?');
  expect(renderToStaticMarkup(<TrackActionMenuItems {...props}/>)).not.toContain('Wrong version playing?');
  expect(renderToStaticMarkup(<TrackActionMenuItems {...props} track={{...props.track,offline:true}} onWrongVersion={noop}/>)).not.toContain('Wrong version playing?');
  expect(renderToStaticMarkup(<TrackActionMenuItems {...props} track={{...props.track,id:'local-file',format:'mp3'}} onWrongVersion={noop}/>)).not.toContain('Wrong version playing?');
  expect(renderToStaticMarkup(<TrackActionMenuItems {...props} track={{...props.track,id:'saavn:M4t__2Pc',format:'catalog'}} onWrongVersion={noop}/>)).toContain('Wrong version playing?');
});
it("truncates song titles with clean, word-aware ellipsis avoiding awkward cuts", () => {
  expect(formatWordTruncatedTitle('Alaakaa Loova Unplugged (From "Devara Part 1") [Hindi]', 28))
    .toBe("Alaakaa Loova Unplugged…");
  expect(formatWordTruncatedTitle("Short Song Title", 28))
    .toBe("Short Song Title");
  expect(formatWordTruncatedTitle("A Long Title Without Parentheses Here", 24))
    .toBe("A Long Title Without…");
});

it("caps immersive titles while keeping the full title available on hover", () => {
  const title = 'Alaakaa Loova Unplugged (From "Devara Part 1") [Hindi]';
  const props = { tracks: [], session: defaults(), playback: {status: "paused", time: 0, duration: 200}, downloads: {}, track: {id: "fixture", title, artist: "Artist"} } as unknown as PlayerBarProps;
  const html = renderToStaticMarkup(<PlayerBar {...props} expanded titleCharacterLimit={28}/>);
  expect(html).toContain("Alaakaa Loova Unplugged…");
  expect(html).not.toContain('<strong dir="auto" title=');
  expect(html).toContain(title.replaceAll('"', '&quot;'));
});
it("offers expansion only on PC while keeping the mobile mini-player", () => {
  const noop = () => {};
  const props: PlayerBarProps = { tracks: [], session: defaults(), playback: { status: "idle", trackId: null, time: 0, duration: 0, error: null }, downloads: {}, busy: false, view: "discover", setView: noop, onSeek: noop, onTogglePlay: noop, onSkip: noop, onFavorite: noop, onChoosePlaylist: noop, onDownloadTrack: noop, onDeleteOffline: noop, onSaveOnline: noop, onCancelDownload: noop, onSetting: noop, onExpand: noop };
  expect(renderToStaticMarkup(<PlayerBar {...props} onFloatingLyrics={noop} />)).toContain('aria-label="Open floating lyrics"');
  expect(renderToStaticMarkup(<PlayerBar {...props} />)).toContain('aria-label="Open expanded player"');
  const phone = renderToStaticMarkup(<PlayerBar {...props} mobile onFloatingLyrics={noop} />);
  expect(phone).not.toContain('aria-label="Open floating lyrics"');
  expect(phone).not.toContain('aria-label="Next track"');
  expect(phone).not.toContain('aria-label="Previous track"');
  expect(phone).not.toContain('aria-label="Open expanded player"'); expect(phone).toContain('aria-label="Playback controls"');
});

it("omits right-side transport clutter when expanded in cover mode", () => {
  const noop = () => {};
  const props: PlayerBarProps = {
    tracks: [],
    session: defaults(),
    playback: { status: "idle", trackId: null, time: 0, duration: 0, error: null },
    downloads: {},
    busy: false,
    view: "discover",
    setView: noop,
    onSeek: noop,
    onTogglePlay: noop,
    onSkip: noop,
    onFavorite: noop,
    onChoosePlaylist: noop,
    onDownloadTrack: noop,
    onDeleteOffline: noop,
    onSaveOnline: noop,
    onCancelDownload: noop,
    onSetting: noop,
    onExpand: noop,
    expanded: true,
  };
  for (const expanded of [false, true]) {
    const loading = renderToStaticMarkup(<PlayerBar {...props} expanded={expanded} autoplayLoading />);
    expect(loading).toContain('aria-label="Loading song"');
    expect(loading).toContain('aria-busy="true"');
    expect(loading).toContain('class="player-spinner"');
    expect(loading).not.toContain('class="spin"');
  }
  for (const status of ["loading", "buffering"] as const) {
    for (const expanded of [false, true]) {
      const html = renderToStaticMarkup(<PlayerBar {...props} expanded={expanded} playback={{ ...props.playback, status }} />);
      expect(html).toContain(`aria-label="${status === "loading" ? "Loading" : "Buffering"} song"`);
      expect(html).toContain('aria-busy="true"');
      expect(html).toContain('class="player-spinner"');
    }
  }
  const html = renderToStaticMarkup(<PlayerBar {...props} onFloatingLyrics={noop} onToggleQueue={noop} />);
  expect(html).not.toContain('class="player-right"');
  expect(html).not.toContain('data-testid="playback-state"');
  expect(html).not.toContain('aria-label="Volume"');
  expect(html).not.toContain('aria-label="Open lyrics"');
  expect(html).not.toContain('aria-label="Show queue"');
  expect(html).toContain('class="player-center"');
});

it("renders fullscreen button in player controls when supported on desktop", () => {
  const noop = () => {};
  const props: PlayerBarProps = {
    tracks: [],
    session: defaults(),
    playback: { status: "idle", trackId: null, time: 0, duration: 0, error: null },
    downloads: {},
    busy: false,
    view: "discover",
    setView: noop,
    onSeek: noop,
    onTogglePlay: noop,
    onSkip: noop,
    onFavorite: noop,
    onChoosePlaylist: noop,
    onDownloadTrack: noop,
    onDeleteOffline: noop,
    onSaveOnline: noop,
    onCancelDownload: noop,
    onSetting: noop,
    onExpand: noop,
    expanded: false,
    onToggleFullscreen: noop,
    isFullscreen: false,
  };
  const html = renderToStaticMarkup(<PlayerBar {...props} />);
  expect(html).toContain('player-btn-fullscreen');
  expect(html).toContain('aria-label="Full screen (F11)"');
});

it("renders track action items in current-track-menu for active tracks", () => {
  const noop = () => {};
  const mockTrack = {
    id: "track-1",
    title: "Test Song",
    artist: "Test Artist",
    album: "Test Album",
    duration: 180,
    fileName: "test.mp3",
    offline: false,
    missing: false,
    format: "online",
  };
  const props: PlayerBarProps = {
    tracks: [mockTrack],
    track: mockTrack,
    session: defaults(),
    playback: { status: "playing", trackId: "track-1", time: 10, duration: 180, error: null },
    downloads: {},
    busy: false,
    view: "discover",
    setView: noop,
    onSeek: noop,
    onTogglePlay: noop,
    onSkip: noop,
    onFavorite: noop,
    onChoosePlaylist: noop,
    onDownloadTrack: noop,
    onDeleteOffline: noop,
    onSaveOnline: noop,
    onCancelDownload: noop,
    onSetting: noop,
  };
  const html = renderToStaticMarkup(<PlayerBar {...props} />);
  expect(html).toContain('class="track-menu current-track-menu"');
  expect(html).toContain("Save to playlist");
  expect(html).toContain("Add to favorites");
  const streamed = renderToStaticMarkup(<PlayerBar {...props} tracks={[]} />);
  expect(streamed).toContain('aria-label="Favorite current track"');
  for (const expanded of [false, true]) {
    const artists = renderToStaticMarkup(<PlayerBar {...props} expanded={expanded} track={{ ...mockTrack, artist: "Hesham Abdul Wahab, Darshana Rajendran" }} onNavigateArtist={noop} />);
    expect(artists).toContain('>Darshana Rajendran</button>');
    expect(artists).not.toContain('>Darsh…</button>');
  }
});

it("preserves longer song titles and multiple artists on mobile playback controls without early cut off", () => {
  const noop = () => {};
  const mockTrack = {
    id: "track-1",
    title: "A Somewhat Longer Song Title For Testing",
    artist: "Artist One, Artist Two, Artist Three",
    album: "Test Album",
    duration: 180,
    fileName: "test.mp3",
    offline: false,
    missing: false,
    format: "online",
  };
  const props: PlayerBarProps = {
    tracks: [mockTrack],
    track: mockTrack,
    session: defaults(),
    playback: { status: "playing", trackId: "track-1", time: 10, duration: 180, error: null },
    downloads: {},
    busy: false,
    view: "discover",
    setView: noop,
    onSeek: noop,
    onTogglePlay: noop,
    onSkip: noop,
    onFavorite: noop,
    onChoosePlaylist: noop,
    onDownloadTrack: noop,
    onDeleteOffline: noop,
    onSaveOnline: noop,
    onCancelDownload: noop,
    onSetting: noop,
    mobile: true,
  };
  const html = renderToStaticMarkup(<PlayerBar {...props} onNavigateArtist={noop} />);
  expect(html).toContain("A Somewhat Longer Song Title For Testing");
  expect(html).not.toContain("A Somewhat Longer Song...");
  expect(html).toContain("Artist Three");
  expect(html).not.toContain(">Artist Three</button>");
  const desktopHtml = renderToStaticMarkup(<PlayerBar {...props} mobile={false} onNavigateArtist={noop} />);
  expect(desktopHtml).toContain(">Artist Two</button>");
});

