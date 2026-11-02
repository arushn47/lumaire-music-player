import { expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { LibraryView, type LibraryViewProps } from "./LibraryView";
import { defaults } from "../../domain/types";

it("keeps favorite songs, albums and artists in separate library views", () => {
  const noop = () => {};
  const session = defaults();
  session.favoriteAlbums = [{ id: "itunes:42", title: "Saved Album", artist: "Album Artist" }];
  session.favoriteArtists = [{ id: "itunes:43", name: "Saved Artist" }];
  const track = { id: "local", title: "Song", album: "Unsaved Album", artist: "Unsaved Artist", duration: 10, fileName: "song.wav", format: "WAV", missing: false };
  const props: LibraryViewProps = { view: "favorites", heading: "Liked songs", tracks: [track], visible: [], rows: [], playbackStatus: "idle", session, downloads: {}, collections: [], query: "", busy: false, mobile: false, desktop: true, onSetQuery: noop, onSelectView: noop, onPlayAll: noop, onPlayTrackInList: noop, onImportMusic: noop, onFavorite: noop, onRemoveTrack: noop, onDownloadTrack: noop, onDeleteOffline: noop, onQueueTrack: noop, onRelinkTrack: noop, onChoosePlaylist: noop };
  const songs = renderToStaticMarkup(<LibraryView {...props} />);
  expect(songs).toContain('aria-label="Library sections"');
  expect(songs).toContain('aria-current="page">Songs</button>');
  expect(songs).toContain('aria-label="Listening history"');
  expect(songs).not.toContain("Saved Album");
  expect(songs).not.toContain("Saved Artist");
  const imported = { ...track, id: 'itunes:42', duration: 0 };
  const durationProps = { ...props, view: 'playlist', rows: [{ t: imported, entryId: 'occurrence' }], currentTrack: { ...track, id: 'youtube:abcdefghijk', metadataSourceId: imported.id }, playbackDuration: 177 };
  expect(renderToStaticMarkup(<LibraryView {...durationProps} />)).toContain('2:57');
  expect(renderToStaticMarkup(<LibraryView {...durationProps} currentTrack={{ ...track, id: 'different' }} />)).not.toContain('2:57');
  const albums = renderToStaticMarkup(<LibraryView {...props} view="albums" />);
  expect(albums).toContain('aria-current="page">Albums</button>');
  expect(albums).toContain("Saved Album");
  expect(albums).not.toContain("Unsaved Album");
  const artists = renderToStaticMarkup(<LibraryView {...props} view="artists" />);
  expect(artists).toContain("Saved Artist");
  expect(artists).not.toContain("Unsaved Artist");
  expect(renderToStaticMarkup(<LibraryView {...props} view="artists" query="nothing" />)).not.toContain("Saved Artist");
});

it("renders Import button beside New playlist in playlists view when onOpenImport is provided", () => {
  const noop = () => {};
  const session = defaults();
  const props: LibraryViewProps = {
    view: "library",
    heading: "Playlists",
    tracks: [],
    visible: [],
    rows: [],
    playbackStatus: "idle",
    session,
    downloads: {},
    collections: [],
    query: "",
    busy: false,
    mobile: false,
    desktop: true,
    onSetQuery: noop,
    onSelectView: noop,
    onPlayAll: noop,
    onPlayTrackInList: noop,
    onImportMusic: noop,
    onFavorite: noop,
    onRemoveTrack: noop,
    onDownloadTrack: noop,
    onDeleteOffline: noop,
    onQueueTrack: noop,
    onRelinkTrack: noop,
    onChoosePlaylist: noop,
    onCreatePlaylist: noop,
    onOpenImport: noop,
  };
  const html = renderToStaticMarkup(<LibraryView {...props} />);
  expect(html).toContain("New playlist");
  expect(html).toContain("Import");
  expect(html).toContain('title="Import playlists from Spotify, YouTube, Apple Music or files"');
});

it("renders Download playlist action and progress display when viewing a playlist", () => {
  const noop = () => {};
  const session = defaults();
  const playlist = { id: "p1", name: "Road Trip", createdAt: 1, items: [{ id: "i1", trackId: "t1" }] };
  const track = { id: "t1", title: "Highway", album: "Drive", artist: "Driver", duration: 120, fileName: "h.mp3", format: "MP3", missing: false };
  const props: LibraryViewProps = {
    view: "library",
    heading: "Road Trip",
    playlist,
    tracks: [track],
    visible: [track],
    rows: [{ t: track, entryId: "i1" }],
    playbackStatus: "idle",
    session,
    downloads: {},
    collections: [],
    query: "",
    busy: false,
    mobile: false,
    desktop: true,
    onSetQuery: noop,
    onSelectView: noop,
    onPlayAll: noop,
    onPlayTrackInList: noop,
    onImportMusic: noop,
    onFavorite: noop,
    onRemoveTrack: noop,
    onDownloadTrack: noop,
    onDeleteOffline: noop,
    onQueueTrack: noop,
    onRelinkTrack: noop,
    onChoosePlaylist: noop,
    onDownloadPlaylist: noop,
    downloadProgress: {
      active: true,
      done: 1,
      total: 3,
      stage: "Downloading",
      title: "Highway",
      percent: 45,
      failed: [],
      paused: false,
      cancelled: false,
    },
  };
  const html = renderToStaticMarkup(<LibraryView {...props} />);
  expect(html).toContain("Downloading 1/3");
  expect(html).toContain("download-btn");
});

it("renders unified library feed with Liked songs auto-playlist, playlists, artists and albums", () => {
  const noop = () => {};
  const session = defaults();
  session.favorites = ["f1", "f2"];
  session.favoriteAlbums = [{ id: "alb:1", title: "Test Album", artist: "Test Artist" }];
  session.favoriteArtists = [{ id: "art:1", name: "Test Artist" }];
  const playlist = { id: "p1", name: "Custom Mix", items: [] };
  session.playlists = [playlist];
  const props: LibraryViewProps = {
    view: "library",
    heading: "Playlists",
    tracks: [],
    visible: [],
    rows: [],
    playbackStatus: "idle",
    session,
    downloads: {},
    collections: [{ id: "p1", name: "Custom Mix", description: "Custom playlist", tracks: [], playlist }],
    query: "",
    busy: false,
    mobile: true,
    desktop: false,
    onSetQuery: noop,
    onSelectView: noop,
    onPlayAll: noop,
    onPlayTrackInList: noop,
    onImportMusic: noop,
    onFavorite: noop,
    onRemoveTrack: noop,
    onDownloadTrack: noop,
    onDeleteOffline: noop,
    onQueueTrack: noop,
    onRelinkTrack: noop,
    onChoosePlaylist: noop,
  };
  const html = renderToStaticMarkup(<LibraryView {...props} />);
  expect(html).toContain("Liked songs");
  expect(html).toContain("Auto playlist · 2 tracks");
  expect(html).toContain("Custom Mix");
  expect(html).toContain("Test Artist");
  expect(html).toContain("Test Album");
  expect(html).toContain("library-filter-chips");

  const desktopHtml = renderToStaticMarkup(<LibraryView {...props} mobile={false} desktop={true} />);
  expect(desktopHtml).toContain("Playlists");
  expect(desktopHtml).toContain("Custom Mix");
  expect(desktopHtml).toContain("2 playlists");
  expect(desktopHtml).not.toContain("4 items");
  expect(desktopHtml).not.toContain("library-filter-chips");
});

it("renders track rows in songs view with full-row click capability", () => {
  const track = { id: "t1", title: "Song 1", album: "Album", artist: "Artist", duration: 100, fileName: "s.mp3", format: "MP3", missing: false };
  const props: LibraryViewProps = {
    view: "songs",
    heading: "Songs",
    tracks: [track],
    visible: [track],
    rows: [{ t: track, entryId: "e1" }],
    playbackStatus: "idle",
    session: defaults(),
    downloads: {},
    collections: [],
    query: "",
    busy: false,
    mobile: false,
    desktop: true,
    onSetQuery: () => {},
    onSelectView: () => {},
    onPlayAll: () => {},
    onPlayTrackInList: () => {},
    onImportMusic: () => {},
    onFavorite: () => {},
    onRemoveTrack: () => {},
    onDownloadTrack: () => {},
    onDeleteOffline: () => {},
    onQueueTrack: () => {},
    onRelinkTrack: () => {},
    onChoosePlaylist: () => {},
  };
  const html = renderToStaticMarkup(<LibraryView {...props} />);
  expect(html).toContain('class="track-row');
  expect(html).toContain("Song 1");
  expect(html).toContain('class="cover');
});

it("ensures songs filter in library view only shows favorite tracks rather than all playlist tracks", () => {
  const session = defaults();
  session.favorites = ["fav-track"];
  const favTrack = { id: "fav-track", title: "Liked Hit", album: "Album A", artist: "Artist A", duration: 120, fileName: "f.mp3", format: "MP3", missing: false };
  const otherTrack = { id: "playlist-track", title: "Playlist Extra", album: "Album B", artist: "Artist B", duration: 140, fileName: "p.mp3", format: "MP3", missing: false };

  const props: LibraryViewProps = {
    view: "favorites",
    heading: "Liked Songs",
    tracks: [favTrack, otherTrack],
    visible: [favTrack],
    rows: [{ t: favTrack, entryId: "e-fav" }],
    playbackStatus: "idle",
    session,
    downloads: {},
    collections: [],
    query: "",
    busy: false,
    mobile: true,
    desktop: false,
    onSetQuery: () => {},
    onSelectView: () => {},
    onPlayAll: () => {},
    onPlayTrackInList: () => {},
    onImportMusic: () => {},
    onFavorite: () => {},
    onRemoveTrack: () => {},
    onDownloadTrack: () => {},
    onDeleteOffline: () => {},
    onQueueTrack: () => {},
    onRelinkTrack: () => {},
    onChoosePlaylist: () => {},
  };

  const html = renderToStaticMarkup(<LibraryView {...props} />);
  expect(html).toContain("Liked Hit");
  expect(html).not.toContain("Playlist Extra");
});


