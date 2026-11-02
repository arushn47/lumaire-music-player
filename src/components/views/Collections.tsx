import React from "react";
import { Download, FolderOpen, Heart, ListMusic, Play } from "lucide-react";
import type { Collection } from "../../domain/collections";
import { Artwork } from "../common/Artwork";
import { DownloadedBadge } from "../common/DownloadedBadge";

export interface CollectionsProps {
  collections: Collection[];
  query: string;
  open: (id: string) => void;
  onPlayCollection?: (collection: Collection) => void;
  likedSongs?: {
    count: number;
    onOpen: () => void;
    onPlay?: () => void;
  };
  artists?: {
    items: { id: string; name: string; artworkUrl?: string | null }[];
    onOpen: (id: string) => void;
  };
  albums?: {
    items: { id?: string; title: string; artist: string; artworkUrl?: string | null }[];
    onOpen: (id?: string, title?: string) => void;
  };
}

export function Collections({
  collections,
  query,
  open,
  onPlayCollection,
  likedSongs,
  artists,
  albums,
}: CollectionsProps) {
  const visible = collections.filter((collection) =>
    `${collection.name} ${collection.tracks.map((track) => `${track.title} ${track.artist}`).join(" ")}`
      .toLocaleLowerCase()
      .includes(query.toLocaleLowerCase()),
  );

  const showLiked = Boolean(
    likedSongs && (!query || "liked songs liked music favorites".includes(query.toLocaleLowerCase()))
  );

  const visibleArtists = artists?.items.filter(
    (artist) => !query || artist.name.toLowerCase().includes(query.toLowerCase())
  ) || [];

  const visibleAlbums = albums?.items.filter(
    (album) => !query || `${album.title} ${album.artist}`.toLowerCase().includes(query.toLowerCase())
  ) || [];

  return (
    <section className="collection-grid" aria-label="Your collections">
      {likedSongs && showLiked && (
        <button
          className="collection-card"
          key="liked-songs-auto-playlist"
          aria-label="Open Liked songs"
          onClick={likedSongs.onOpen}
        >
          <div className="collection-art-wrap">
            <span
              className="collection-art liked-songs-art"
              style={{
                background: "linear-gradient(135deg, #4c1d95 0%, #7c3aed 50%, #c084fc 100%)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Heart size={28} fill="#ffffff" color="#ffffff" />
            </span>
            {likedSongs.count > 0 && likedSongs.onPlay && (
              <div
                className="album-hover-play"
                aria-label="Play Liked songs"
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  e.stopPropagation();
                  likedSongs.onPlay?.();
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    e.stopPropagation();
                    likedSongs.onPlay?.();
                  }
                }}
              >
                <Play size={18} fill="currentColor" color="currentColor" />
              </div>
            )}
          </div>
          <div className="collection-info">
            <div className="collection-title-row">
              <span className="collection-title" title="Liked songs">
                <span className="collection-name">Liked songs</span>
              </span>
            </div>
            <span className="collection-description">
              Auto playlist · {likedSongs.count} {likedSongs.count === 1 ? "track" : "tracks"}
            </span>
          </div>
        </button>
      )}
      {visible.map((collection) => {
        const tracksWithArt = collection.tracks.filter((track) =>
          Boolean(track.artworkUrl),
        );
        const hasArt = tracksWithArt.length > 0;

        return (
          <button
            className="collection-card"
            key={collection.id}
            aria-label={`Open ${collection.name}`}
            onClick={() => open(collection.id)}
          >
            <div className="collection-art-wrap">
              <span className={`collection-art ${hasArt ? "with-covers" : "placeholder"}`}>
                {hasArt ? (
                  (() => {
                    const arts = tracksWithArt.slice(0, 4);
                    // Match YouTube Music:
                    // 1 track: 1 full cover (handled by :only-child)
                    // 2 tracks: repeat diagonally/cyclically [A, B, B, A] to form a full 2x2 grid
                    // 3 tracks: repeat 1st track in 4th slot [A, B, C, A] to form a full 2x2 grid
                    // 4+ tracks: [A, B, C, D]
                    const resolvedArts =
                      arts.length === 2
                        ? [arts[0], arts[1], arts[1], arts[0]]
                        : arts.length === 3
                          ? [arts[0], arts[1], arts[2], arts[0]]
                          : arts;

                    return resolvedArts.map((track, index) => (
                      <Artwork
                        url={track.artworkUrl}
                        key={`${track.id}-${index}`}
                      />
                    ));
                  })()
                ) : (
                  <div className="collection-art-placeholder">
                    {collection.id === "collection:local" ? (
                      <FolderOpen size={36} strokeWidth={1.5} />
                    ) : collection.id === "collection:downloads" ? (
                      <Download size={36} strokeWidth={1.5} />
                    ) : (
                      <ListMusic size={36} strokeWidth={1.5} />
                    )}
                  </div>
                )}
              </span>
              {collection.tracks.length > 0 && onPlayCollection && (
                <div
                  className="album-hover-play"
                  aria-label={`Play ${collection.name}`}
                  role="button"
                  tabIndex={0}
                  onClick={(e) => {
                    e.stopPropagation();
                    onPlayCollection(collection);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      e.stopPropagation();
                      onPlayCollection(collection);
                    }
                  }}
                >
                  <Play size={18} fill="currentColor" color="currentColor" />
                </div>
              )}
            </div>
            <div className="collection-info">
              <div className="collection-title-row">
                <span className="collection-title" title={collection.name}>
                  <span className="collection-name">{collection.name}</span>
                  {collection.tracks.length > 0 &&
                    collection.tracks.length === (collection.playlist?.items.length ?? collection.tracks.length) &&
                    collection.tracks.every((track) => track.offline && !track.missing) && (
                      <DownloadedBadge track={collection.tracks[0]} />
                    )}
                </span>
              </div>
              <span className="collection-description">
                {collection.tracks.length} {collection.tracks.length === 1 ? "track" : "tracks"}
                {collection.description &&
                collection.description !== "Your playlist" &&
                collection.description !== "Playlist"
                  ? ` · ${collection.description}`
                  : ""}
              </span>
            </div>
          </button>
        );
      })}
      {visibleArtists.map((artist) => (
        <button
          className="collection-card collection-card-artist"
          key={`artist-${artist.id}`}
          aria-label={`Open artist ${artist.name}`}
          onClick={() => artists?.onOpen(artist.id)}
        >
          <div className="collection-art-wrap is-artist" style={{ borderRadius: "50%", background: "transparent" }}>
            <span className="collection-art" style={{ borderRadius: "50%", overflow: "hidden" }}>
              <Artwork url={artist.artworkUrl} className="collection-art-cover" />
            </span>
          </div>
          <div className="collection-info">
            <div className="collection-title-row">
              <span className="collection-title" title={artist.name}>
                <span className="collection-name">{artist.name}</span>
              </span>
            </div>
            <span className="collection-description">Artist</span>
          </div>
        </button>
      ))}
      {visibleAlbums.map((album) => (
        <button
          className="collection-card"
          key={`album-${album.id || album.title}`}
          aria-label={`Open album ${album.title}`}
          onClick={() => albums?.onOpen(album.id, album.title)}
        >
          <div className="collection-art-wrap">
            <span className="collection-art">
              <Artwork url={album.artworkUrl} className="collection-art-cover" />
            </span>
          </div>
          <div className="collection-info">
            <div className="collection-title-row">
              <span className="collection-title" title={album.title}>
                <span className="collection-name">{album.title}</span>
              </span>
            </div>
            <span className="collection-description">Album · {album.artist}</span>
          </div>
        </button>
      ))}
      {!visible.length && !showLiked && !visibleArtists.length && !visibleAlbums.length && (
        <p className="muted">
          No matching collections. Add music or create a playlist to begin.
        </p>
      )}
    </section>
  );
}
