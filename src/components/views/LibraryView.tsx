import { resolvedArtists, useArtistResolutions } from '../../adapters/artist-resolution';
import React, { useMemo, useState } from "react";
import {
  Activity,
  Check,
  Download,
  Ellipsis,
  FolderInput,
  FolderOpen,
  Heart,
  Link2,
  Loader2,
  Music2,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Search,
  Shuffle,
  X,
} from "lucide-react";
import type { AlbumDownloadProgress } from "../../hooks/useAlbumDownloads";
import type { Collection } from "../../domain/collections";
import type { Playlist, Session, Track } from "../../domain/types";
import type { Playback } from "../../player/controller";
import { Artwork, DownloadedBadge, IconButton } from "../common";
import { Collections } from "./Collections";
import { ArtistLinks } from "../common/ArtistLinks";
import { AlbumLink } from "../common/AlbumLink";
import { CloseTrackMenu } from "../common/CloseTrackMenu";

export interface LibraryViewProps {
  onNavigateArtist?: (id: string) => void;
  onNavigateAlbum?: (id: string) => void;
  onCreatePlaylist?: () => void;
  onOpenImport?: () => void;
  view: string;
  heading: string;
  playlist?: Playlist;
  tracks: Track[];
  visible: Track[];
  rows: { t: Track; entryId: string }[];
  currentTrack?: Track | null;
  playbackDuration?: number;
  playbackStatus: Playback["status"];
  session: Session;
  downloads: Record<string, string>;
  collections: Collection[];
  query: string;
  busy: boolean;
  mobile: boolean;
  desktop: boolean;
  onSetQuery: (q: string) => void;
  onSelectView: (view: string) => void;
  onPlayAll: () => void;
  onShufflePlay?: () => void;
  onPlayTrackInList: (track: Track, index: number) => void;
  onImportMusic: (folder: boolean) => void;
  onRenamePlaylist?: (playlist: Playlist) => void;
  onDeletePlaylist?: (playlist: Playlist) => void;
  onDownloadPlaylist?: () => void;
  downloadProgress?: AlbumDownloadProgress;
  onPauseDownload?: () => void;
  onCancelDownload?: () => void;
  onFavorite: (trackId: string) => void;
  onRemoveTrack: (track: Track) => void;
  onDownloadTrack: (track: Track) => void;
  onDeleteOffline: (track: Track) => void;
  onQueueTrack: (trackId: string, next?: boolean) => void;
  onEnrichOnline?: (track: Track) => void;
  onRelinkTrack: (track: Track) => void;
  onChoosePlaylist: (track: Track) => void;
  onRemoveFromPlaylist?: (playlistId: string, entryId: string) => void;
  onOpenAddMusic?: (playlist: Playlist) => void;
  onPlayCollection?: (collection: Collection) => void;
}

const clock = (s: number) =>
  `${Math.floor((Number.isFinite(s) ? s : 0) / 60)}:${String(Math.floor((Number.isFinite(s) ? s : 0) % 60)).padStart(2, "0")}`;

export function LibraryView({
  onNavigateArtist, onNavigateAlbum, onCreatePlaylist, onOpenImport,
  view,
  heading,
  playlist,
  tracks,
  visible,
  rows,
  currentTrack,
  playbackDuration,
  playbackStatus,
  session,
  downloads,
  collections,
  query,
  busy,
  mobile,
  desktop,
  onSetQuery,
  onSelectView,
  onPlayAll,
  onShufflePlay,
  onPlayTrackInList,
  onImportMusic,
  onRenamePlaylist,
  onDeletePlaylist,
  onDownloadPlaylist,
  downloadProgress,
  onPauseDownload,
  onCancelDownload,
  onFavorite,
  onRemoveTrack,
  onDownloadTrack,
  onDeleteOffline,
  onQueueTrack,
  onEnrichOnline,
  onRelinkTrack,
  onChoosePlaylist,
  onRemoveFromPlaylist,
  onOpenAddMusic,
  onPlayCollection,
}: LibraryViewProps) {
  const [filter, setFilter] = useState<"playlists" | "songs" | "albums" | "artists" | null>(null);
  const activeFilter = filter ?? (view === "favorites" ? "songs" : view === "albums" ? "albums" : view === "artists" ? "artists" : null);
  const isMobile = Boolean(mobile) || (typeof window !== "undefined" && window.innerWidth <= 768);

  const favoriteTracks = useMemo(
    () => tracks.filter((t) => session.favorites.includes(t.id)),
    [tracks, session.favorites],
  );
  const favoriteRows = useMemo(() => {
    const filtered = query
      ? favoriteTracks.filter((t) => `${t.title} ${t.artist} ${t.album || ""}`.toLowerCase().includes(query.toLowerCase()))
      : favoriteTracks;
    return filtered.map((t) => ({ t, entryId: t.id }));
  }, [favoriteTracks, query]);

  const displayRows = (filter === "songs" ? favoriteRows : rows).map(row => {
    const current = currentTrack && (row.t.id === currentTrack.id || row.t.id === currentTrack.metadataSourceId || (row.t.metadataSourceId && row.t.metadataSourceId === currentTrack.metadataSourceId));
    const duration = current ? playbackDuration || currentTrack.duration : 0;
    return !row.t.duration && duration && Number.isFinite(duration) && duration > 0
      ? { ...row, t: { ...row.t, duration } } : row;
  });

  const isPlaylistOrFavorites = Boolean(playlist) || view === "favorites";
  const totalSeconds = displayRows.reduce((acc, { t }) => acc + (t.duration || 0), 0);
  const totalMinutes = Math.floor(totalSeconds / 60);
  const remainingSeconds = Math.floor(totalSeconds % 60);
  const durationFormatted =
    totalMinutes >= 60
      ? `${Math.floor(totalMinutes / 60)} hr ${totalMinutes % 60} min`
      : `${totalMinutes} min ${remainingSeconds} sec`;

  const coverArtworks = Array.from(
    new Set(
      displayRows
        .map(({ t }) => t.artworkUrl)
        .filter((url): url is string => typeof url === "string" && url.trim().length > 0)
    )
  ).slice(0, 4);

  const libraryAlbums = session.favoriteAlbums.filter(album =>
    `${album.title} ${album.artist}`.toLowerCase().includes(query.toLowerCase()));
  const confirmedArtists = useArtistResolutions();
  const favoriteArtistCards = resolvedArtists(session.favoriteArtists, confirmedArtists);
  const libraryArtists = favoriteArtistCards.filter(artist =>
    artist.name.toLowerCase().includes(query.toLowerCase()));
  const libraryRoot = ["library", "favorites", "albums", "artists"].includes(view);

  const visibleCollections = useMemo(() => {
    const list = filter === "playlists"
      ? collections.filter((c) => c.playlist)
      : collections;
    return list.filter((collection) =>
      !query ||
      `${collection.name} ${collection.tracks.map((track) => `${track.title} ${track.artist}`).join(" ")}`
        .toLocaleLowerCase()
        .includes(query.toLocaleLowerCase())
    );
  }, [collections, filter, query]);

  const showLikedCard = Boolean(
    !query || "liked songs liked music favorites".includes(query.toLocaleLowerCase())
  );
  const totalPlaylistsCount = visibleCollections.length + (showLikedCard ? 1 : 0);

  const handleFilterClick = (key: string) => {
    onSetQuery("");
    if (activeFilter === key) {
      setFilter(null);
      if (view !== "library") onSelectView("library");
    } else if (key === "songs") {
      setFilter(null);
      onSelectView("favorites");
    } else if (key === "albums") {
      setFilter(null);
      onSelectView("albums");
    } else if (key === "artists") {
      setFilter(null);
      onSelectView("artists");
    } else if (key === "playlists") {
      setFilter("playlists");
      if (view !== "library") onSelectView("library");
    }
  };

  return (
    <>
      {libraryRoot && (
        <div className="mobile-library-navigation">
          <div className="mobile-library-heading">
            <h1>Library<span className="heading-dot">.</span></h1>
            <IconButton label="Listening history" onClick={() => onSelectView("history")}><Activity size={21} /></IconButton>
          </div>
          <nav className="mobile-library-filters" aria-label="Library sections">
            {[["playlists", "Playlists"], ["songs", "Songs"], ["albums", "Albums"], ["artists", "Artists"]].map(([key, label]) => (
              <button
                type="button"
                key={key}
                className={activeFilter === key ? "active" : undefined}
                aria-pressed={activeFilter === key}
                aria-current={activeFilter === key ? "page" : undefined}
                onClick={() => handleFilterClick(key)}
              >
                {label}
              </button>
            ))}
          </nav>
          <div className="mobile-library-shortcuts">
            <button type="button" onClick={() => onSelectView("collection:local")}><FolderOpen size={16} />On this device</button>
            <button type="button" onClick={() => onSelectView("collection:downloads")}><Download size={16} />Downloads</button>
            {onOpenImport && <button type="button" onClick={onOpenImport}><FolderInput size={16} />Sync & import</button>}
          </div>
        </div>
      )}
      {isPlaylistOrFavorites ? (
        <div className={`page-heading catalog-hero collection-header ${view === "favorites" ? "mobile-library-songs" : ""}`}>
          <div className={`collection-cover album-cover ${view === "favorites" ? "is-liked-songs" : ""}`}>
            {view === "favorites" ? (
              <div className="liked-songs-cover">
                <Heart size={44} fill="#ffffff" color="#ffffff" />
              </div>
            ) : coverArtworks.length >= 4 ? (
              <div className="playlist-mosaic-grid">
                {coverArtworks.map((url, i) => (
                  <Artwork key={i} url={url} />
                ))}
              </div>
            ) : coverArtworks.length >= 1 ? (
              <Artwork url={coverArtworks[0]} className="playlist-cover-single" />
            ) : (
              <div className="playlist-cover-empty">
                <Music2 size={44} />
              </div>
            )}
          </div>

          <div className="album-info">
            <p className="eyebrow">
              {view === "favorites" ? "PLAYLIST" : "PLAYLIST"}
            </p>
            <h1>
              {view === "favorites" ? "Liked Songs" : heading}
            </h1>
            <div className="subtitle album-meta">
              <span>{rows.length} {rows.length === 1 ? "track" : "tracks"}</span>
              {totalSeconds > 0 && <span>{durationFormatted}</span>}
            </div>

            <div className="album-actions">
              {rows.length > 0 && (
                <button className="primary" onClick={onPlayAll}>
                  <Play size={16} fill="currentColor" />
                  Play
                </button>
              )}
              {rows.length > 0 && onShufflePlay && (
                <button
                  className="subtle icon-only"
                  onClick={onShufflePlay}
                  aria-label="Shuffle"
                  title="Shuffle"
                >
                  <Shuffle size={17} />
                </button>
              )}
              <button
                className="subtle"
                disabled={busy}
                onClick={() => {
                  if (playlist && onOpenAddMusic) {
                    onOpenAddMusic(playlist);
                  } else if (view === "favorites" && onOpenAddMusic) {
                    onOpenAddMusic({
                      id: "favorites",
                      name: "Your favorites",
                      items: rows.map((r) => ({ id: r.entryId, trackId: r.t.id })),
                    });
                  } else {
                    onImportMusic(false);
                  }
                }}
              >
                <Plus size={16} />
                Add music
              </button>
              {playlist && onDownloadPlaylist && rows.length > 0 && (
                <button
                  type="button"
                  className={`subtle download-btn ${downloadProgress?.active ? "is-downloading" : rows.every(r => r.t.offline && !r.t.missing) ? "is-downloaded" : downloadProgress?.failed.length ? "has-errors" : ""}`}
                  onClick={downloadProgress?.active ? (onPauseDownload || (() => {})) : onDownloadPlaylist}
                  title={downloadProgress?.active ? (downloadProgress.paused ? "Resume download" : "Pause download") : rows.every(r => r.t.offline && !r.t.missing) ? "Downloaded" : "Download playlist"}
                >
                  {downloadProgress?.active ? (
                    <Loader2 size={16} className="spin" />
                  ) : rows.every(r => r.t.offline && !r.t.missing) ? (
                    <Check size={16} />
                  ) : downloadProgress?.failed.length ? (
                    <RefreshCw size={16} />
                  ) : (
                    <Download size={16} />
                  )}
                  <span>
                    {downloadProgress?.active
                      ? `${downloadProgress.paused ? "Paused" : "Downloading"} ${downloadProgress.done}/${downloadProgress.total}`
                      : rows.every(r => r.t.offline && !r.t.missing)
                      ? "Downloaded"
                      : downloadProgress?.failed.length
                      ? `Retry (${downloadProgress.failed.length})`
                      : "Download"}
                  </span>
                </button>
              )}
              {downloadProgress?.active && onCancelDownload && (
                <button
                  type="button"
                  className="subtle download-cancel-btn"
                  onClick={onCancelDownload}
                  title="Cancel download"
                  aria-label="Cancel download"
                >
                  <X size={15} />
                </button>
              )}
              {(playlist || view === "favorites") && (
                <details className="track-menu collection-menu">
                  <summary aria-label="Collection options" title="Collection options">
                    <Ellipsis size={18} aria-hidden="true" />
                  </summary>
                  <div className="menu-popover">
                    <CloseTrackMenu />
                    <button type="button" onClick={() => onImportMusic(false)}>
                      <FolderOpen size={14} /> Import local files
                    </button>
                    {playlist && onRenamePlaylist && (
                      <button type="button" onClick={() => onRenamePlaylist(playlist)}>
                        Rename playlist
                      </button>
                    )}
                    {playlist && onDownloadPlaylist && rows.length > 0 && (
                      <button type="button" disabled={downloadProgress?.active} onClick={onDownloadPlaylist}>
                        <Download size={14} />
                        {downloadProgress?.active ? "Downloading…" : downloadProgress && !downloadProgress.active ? "Retry download" : "Download playlist"}
                      </button>
                    )}
                    {playlist && onDeletePlaylist && (
                      <button type="button" onClick={() => onDeletePlaylist(playlist)}>
                        Delete playlist
                      </button>
                    )}
                  </div>
                </details>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className={`page-heading ${libraryRoot ? "library-root-heading" : ""}`}>
          <div>
            <p className="eyebrow">YOUR LIBRARY</p>
            <h1>
              {view === "library"
                ? mobile
                  ? filter === "playlists"
                    ? "Playlists"
                    : filter === "artists"
                      ? "Artists"
                      : filter === "albums"
                        ? "Albums"
                        : filter === "songs"
                          ? "Songs"
                          : "Library"
                  : "Playlists"
                : heading}
              <span className="heading-dot">.</span>
            </h1>
            <p className="subtitle">
              {view === "library"
                ? mobile
                  ? filter === "playlists"
                    ? "Your playlists, mixes, and custom collections."
                    : filter === "artists"
                      ? "Favorite and saved artists."
                      : filter === "albums"
                        ? "Albums saved in your library."
                        : filter === "songs"
                          ? "Songs saved in your library."
                          : "All your music, playlists, albums, and artists in one place."
                  : "Your playlists, mixes, and custom collections."
                : view === "artists"
                  ? "Favorite and saved artists."
                  : view === "albums"
                    ? "Albums saved in your library."
                    : "Your music. Your words. A little closer."}
            </p>
          </div>
          <div className="heading-actions">
            {view === "library" && (
              <>
                {onOpenImport && (
                  <button
                    type="button"
                    className="subtle"
                    disabled={busy}
                    onClick={onOpenImport}
                    title="Import playlists from Spotify, YouTube, Apple Music or files"
                  >
                    <FolderInput size={15} />
                    Import
                  </button>
                )}
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() => (onCreatePlaylist ? onCreatePlaylist() : onImportMusic(false))}
                >
                  <Plus size={16} />
                  New playlist
                </button>
              </>
            )}
            {view !== "library" && view !== "artists" && view !== "albums" && rows.length > 0 && (
              <button className="subtle" onClick={onPlayAll}>
                <Play size={16} />
                Play collection
              </button>
            )}
            {view !== "library" && view !== "artists" && view !== "albums" && (
              <button
                className="primary"
                disabled={busy}
                onClick={() => onImportMusic(false)}
              >
                <Plus size={17} />
                {busy ? "Working…" : "Add music"}
              </button>
            )}
          </div>
        </div>
      )}

      {mobile && view === "library" && (
        <div className="library-filter-chips" role="toolbar" aria-label="Library filters">
          {[["playlists", "Playlists"], ["songs", "Songs"], ["albums", "Albums"], ["artists", "Artists"]].map(([key, label]) => (
            <button
              type="button"
              key={key}
              className={`library-filter-chip ${activeFilter === key ? "active" : ""}`}
              aria-pressed={activeFilter === key}
              onClick={() => handleFilterClick(key)}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      <section className="library-tools">
        <label className="search">
          <Search size={17} />
          <input
            aria-label="Search local library"
            placeholder={
              view === "artists" || filter === "artists"
                ? "Search artists…"
                : view === "albums" || filter === "albums"
                  ? "Search albums…"
                  : view === "library" && (filter === "playlists" || !mobile)
                    ? "Search playlists…"
                    : view === "library" && filter === "songs"
                      ? "Search favorite songs…"
                      : view === "favorites"
                        ? "Find in Liked Songs…"
                        : playlist
                          ? `Find in ${heading}…`
                          : "Find in your library…"
            }
            value={query}
            onChange={(e) => onSetQuery(e.target.value)}
          />
          {query && (
            <button
              type="button"
              className="search-clear-button"
              aria-label="Clear search"
              onClick={() => onSetQuery("")}
            >
              <X size={15} />
            </button>
          )}
        </label>
        <span className="muted">
          {view === "artists" || filter === "artists"
            ? `${libraryArtists.length} ${libraryArtists.length === 1 ? "artist" : "artists"}`
            : view === "albums" || filter === "albums"
              ? `${libraryAlbums.length} ${libraryAlbums.length === 1 ? "album" : "albums"}`
              : view === "library" && filter === "songs"
                ? `${favoriteTracks.length} ${favoriteTracks.length === 1 ? "song" : "songs"}`
                : view === "library" && (filter === "playlists" || !isMobile)
                  ? `${totalPlaylistsCount} ${totalPlaylistsCount === 1 ? "playlist" : "playlists"}`
                  : view === "library"
                    ? `${totalPlaylistsCount + libraryArtists.length + libraryAlbums.length} items`
                    : `${visible.length} ${visible.length === 1 ? "track" : "tracks"}`}
        </span>
        {!mobile && view !== "artists" && view !== "albums" && view !== "library" && !isPlaylistOrFavorites && (
          <button
            className="subtle"
            disabled={busy}
            onClick={() => onImportMusic(true)}
          >
            <FolderOpen size={16} />
            Add folder
          </button>
        )}
      </section>

      {view === "albums" || (view === "library" && filter === "albums") ? (
        <section aria-label="Albums in your library" className="albums-grid discover-albums">
          {libraryAlbums.length ? (
            libraryAlbums.map((album) => (
              <div
                className="album-card discover-album-card"
                key={album.title + album.artist}
                onClick={() => {
                  if (album.id) {
                    onNavigateAlbum?.(album.id);
                  } else {
                    onSetQuery(album.title);
                  }
                }}
                role="button"
                onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
                tabIndex={0}
                aria-label={`Open album ${album.title}`}
              >
                <div className="album-card-cover-wrap">
                  <Artwork url={album.artworkUrl} className="album-card-cover" />
                </div>
                <div className="album-card-info">
                  <div className="album-title" title={album.title}>{album.title}</div>
                  <div className="album-year" title={album.artist}>{album.artist}</div>
                </div>
              </div>
            ))
          ) : (
            <p className="subtitle" style={{ padding: "20px 0" }}>No albums found in your library.</p>
          )}
        </section>
      ) : view === "artists" || (view === "library" && filter === "artists") ? (
        <section aria-label="Artists in your library" className="discover-portrait-grid">
          {libraryArtists.length ? (
            libraryArtists.map((artist) => (
              <div
                className="portrait-card"
                key={artist.id}
                data-artist-id={artist.id}
                onClick={() => onNavigateArtist?.(artist.id)}
                role="button"
                onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
                tabIndex={0}
                aria-label={`Open artist ${artist.name}`}
              >
                <div className="portrait-card-cover-wrap" style={{ borderRadius: "50%" }}>
                  <Artwork url={artist.artworkUrl} className="portrait-card-cover" />
                </div>
                <div className="portrait-card-info" style={{ textAlign: "center" }}>
                  <div className="portrait-card-title" title={artist.name}>{artist.name}</div>
                  <div className="portrait-card-artist">Artist</div>
                </div>
              </div>
            ))
          ) : (
            <p className="subtitle" style={{ padding: "20px 0" }}>No artists found in your library.</p>
          )}
        </section>
      ) : view === "library" && filter !== "songs" ? (
        <Collections
          collections={filter === "playlists" ? collections.filter(collection => collection.playlist) : collections}
          query={query}
          open={(id) => {
            onSelectView(id);
            onSetQuery("");
          }}
          onPlayCollection={onPlayCollection}
          likedSongs={{
            count: session.favorites.length,
            onOpen: () => onSelectView("favorites"),
            onPlay: onPlayAll,
          }}
          artists={(isMobile || mobile) && filter === null ? {
            items: favoriteArtistCards,
            onOpen: (id) => { onNavigateArtist?.(id); },
          } : undefined}
          albums={(isMobile || mobile) && filter === null ? {
            items: session.favoriteAlbums,
            onOpen: (id, title) => { if (id) onNavigateAlbum?.(id); else onSetQuery(title || ""); },
          } : undefined}
        />
      ) : !tracks.length ? (
        <section className="welcome">
          <div className="record-art">
            <div className="record">
              <div className="record-center">
                <Music2 size={30} />
              </div>
            </div>
            <span className="art-spark">✦</span>
          </div>
          <p className="eyebrow">A SPACE FOR YOUR SOUND</p>
          <h2>Make yourself at home.</h2>
          <p>
            Bring your music into Lumaire.
            <br />
            Listen, collect, and find the meaning between the lines.
          </p>
          <button
            className="primary"
            disabled={busy}
            onClick={() => onImportMusic(false)}
          >
            <Plus size={18} />
            Choose your music
          </button>
          <span className="welcome-note">
            Local files · No account · No subscription
          </span>
          {!desktop && (
            <p className="desktop-note">
              Desktop library access requires <code>npm run desktop</code>.
            </p>
          )}
        </section>
      ) : !displayRows.length ? (
        <div className={`empty ${isPlaylistOrFavorites || filter === "songs" ? "playlist-empty-card" : ""}`}>
          <Search size={30} />
          <h2>
            {query
              ? "No matching music"
              : view === "favorites" || filter === "songs"
                ? "Your favorites start here"
                : "An empty playlist"}
          </h2>
          <p>
            {query
              ? "Try a different title, artist, or album."
              : view === "favorites" || filter === "songs"
                ? "Tap a heart beside a track to save it here."
                : "Add tracks from Discover or your library to build this playlist."}
          </p>
          {!query && (isPlaylistOrFavorites || filter === "songs") && (
            <div className="playlist-empty-actions">
              <button
                className="primary"
                onClick={() => {
                  if (playlist && onOpenAddMusic) {
                    onOpenAddMusic(playlist);
                  } else if ((view === "favorites" || filter === "songs") && onOpenAddMusic) {
                    onOpenAddMusic({
                      id: "favorites",
                      name: "Your favorites",
                      items: [],
                    });
                  } else {
                    onSelectView("discover");
                  }
                }}
              >
                <Plus size={16} />
                Add online music
              </button>
              <button
                className="subtle"
                disabled={busy}
                onClick={() => onImportMusic(false)}
              >
                <FolderOpen size={15} />
                Import local files
              </button>
            </div>
          )}
        </div>
      ) : (
        <>
          <div className="track-header">
            <span>#</span>
            <span>TRACK / ARTIST</span>
            <span>ALBUM</span>
            <span>TIME</span>
            <span />
          </div>
          <div className="track-list">
            {displayRows.map(({ t, entryId }, index) => (
              <div
                className={`track-row ${currentTrack?.id === t.id ? "current" : ""}`}
                key={entryId}
                onClick={(e) => {
                  if ((e.target as HTMLElement).closest("button, a, summary, details, input, .track-actions, .menu-popover")) return;
                  if (filter === "songs" && onPlayCollection) {
                    onPlayCollection({ id: "favorites", name: "Liked Songs", description: "", tracks: displayRows.map(r => r.t) });
                  } else {
                    onPlayTrackInList(t, index);
                  }
                }}
              >
                <button
                  className="track-play"
                  aria-label={`Play ${t.title}`}
                  onClick={() => onPlayTrackInList(t, index)}
                >
                  {currentTrack?.id === t.id &&
                  playbackStatus === "playing" ? (
                    <span className="equalizer">▥</span>
                  ) : (
                    <>
                      <span className="track-index">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <Play className="row-play" size={15} />
                    </>
                  )}
                </button>
                <div className="track-meta">
                  <div className="track-cover-container">
                    <Artwork
                      url={t.artworkUrl}
                      className={`color-${index % 5}`}
                    />
                    {(downloads[t.id] === "downloading" || (t.metadataSourceId ? downloads[t.metadataSourceId] === "downloading" : false)) && (
                      <div className="track-cover-download-overlay" title="Downloading…" role="img" aria-label="Downloading">
                        <div className="track-cover-spinner spin" />
                      </div>
                    )}
                  </div>
                  <span className="track-meta-text">
                    <button className="track-title-button" aria-label={`Listen to ${t.title}`} onClick={() => onPlayTrackInList(t, index)}><strong dir="auto" title={t.title}>{t.title}</strong></button>
                    <small dir="auto">
                      <DownloadedBadge track={t} />
                      <ArtistLinks artistString={t.artist} catalogId={t.metadataSourceId} onNavigateArtist={onNavigateArtist} />
                      {` · ${t.offline ? "Offline" : t.format === "catalog" ? "Imported · resolves when played" : t.source ? "Online" : "Local file"}${t.format === "catalog" ? "" : ` · ${t.format}`}`}
                      {t.missing ? " · File missing" : ""}
                    </small>
                  </span>
                </div>
                <span
                  className="album ellipsis"
                  title={t.album?.trim() || "Unknown"}
                >
                  <AlbumLink title={t.album} artist={t.artist} onNavigateAlbum={onNavigateAlbum} />
                </span>
                <span className="duration">
                  {t.duration ? clock(t.duration) : "—"}
                </span>
                <div className="track-actions">
                  <IconButton
                    label={`${session.favorites.includes(t.id) ? "Unfavorite" : "Favorite"} ${t.title}`}
                    active={session.favorites.includes(t.id)}
                    onClick={() => onFavorite(t.id)}
                  >
                    <Heart
                      size={17}
                      fill={
                        session.favorites.includes(t.id)
                          ? "currentColor"
                          : "none"
                      }
                    />
                  </IconButton>
                  <details className="track-menu">
                    <summary aria-label={`Actions for ${t.title}`} title="Track actions">
                      <Ellipsis size={18} aria-hidden="true" />
                    </summary>
                    <div className="menu-popover">
                      <CloseTrackMenu />
                      <button type="button" className="mobile-track-favorite" onClick={() => onFavorite(t.id)}>{session.favorites.includes(t.id) ? "Remove from liked songs" : "Add to liked songs"}</button>
                      <button
                        disabled={
                          busy ||
                          t.offline ||
                          downloads[t.id] === "downloading"
                        }
                        onClick={() => onRemoveTrack(t)}
                      >
                        Remove from library
                      </button>
                      {(t.source || t.format === "catalog") && !t.offline && (
                        <button
                          disabled={downloads[t.id] === "downloading"}
                          onClick={() => onDownloadTrack(t)}
                        >
                          Download for offline
                        </button>
                      )}
                      {t.offline && (
                        <button onClick={() => onDeleteOffline(t)}>
                          Delete offline copy
                        </button>
                      )}
                      <button onClick={() => onQueueTrack(t.id, true)}>
                        Play next
                      </button>
                      <button onClick={() => onQueueTrack(t.id)}>
                        Add to queue
                      </button>
                      {t.source?.providerId === "youtube" && onEnrichOnline && (
                        <button
                          disabled={busy}
                          onClick={() => onEnrichOnline(t)}
                        >
                          Refresh metadata
                        </button>
                      )}
                      {!t.source && (
                        <button
                          disabled={mobile}
                          title={
                            mobile
                              ? "Re-import this file with Add music in the Android prototype."
                              : undefined
                          }
                          onClick={() => onRelinkTrack(t)}
                        >
                          <Link2 size={14} />
                          Relink file
                        </button>
                      )}
                      {t.source?.providerId === "wikimedia-commons" && (
                        <a
                          className="source-credits"
                          href={t.source.pageUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {t.source.attribution} · {t.source.license}
                        </a>
                      )}
                      <button onClick={() => onChoosePlaylist(t)}>
                        Save to playlist
                      </button>
                      {playlist && onRemoveFromPlaylist && (
                        <button
                          onClick={() => onRemoveFromPlaylist(playlist.id, entryId)}
                        >
                          Remove from this playlist
                        </button>
                      )}
                    </div>
                  </details>
                </div>
              </div>
            ))}
          </div>
          {isPlaylistOrFavorites ? (
            <p className="library-footer playlist-footer">
              <span className="small-dot" /> {rows.length} {rows.length === 1 ? "track" : "tracks"}
              {totalSeconds > 0 && ` · ${durationFormatted}`}
            </p>
          ) : (
            <p className="library-footer">
              <span className="small-dot" /> Your saved sources and
              files, organized here.
            </p>
          )}
        </>
      )}
    </>
  );
}
