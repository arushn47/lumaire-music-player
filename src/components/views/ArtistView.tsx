import { rememberArtistResolution, useArtistResolutions } from '../../adapters/artist-resolution';
import { groupRecordings } from '../../domain/recording-groups';
import React, { useEffect, useState } from "react";
import { library } from "../../adapters/native";
import type { DiscoveryViewProps } from "./DiscoveryView";
import { ChevronLeft, CircleAlert, Loader2, Heart, Play } from "lucide-react";
import { Artwork } from "../common";
import { CatalogTrackList } from "../common/CatalogTrackList";
import type { CatalogActionHandlers } from "../common/CatalogTrackActions";
import { artistLookupName } from "../../domain/catalog-links";
import type { CatalogArtist } from "../../adapters/native";

interface ArtistViewProps extends CatalogActionHandlers {
  artistId: string;
  favoriteArtists: import("../../domain/types").Session["favoriteArtists"];
  onFavoriteArtist: (artist: import("../../adapters/native").CatalogArtist, verifiedIds?: string[]) => void;
  onNavigateAlbum: (albumId: string) => void;
  onNavigateArtist: (artistId: string) => void;
  onSaveDiscovery: DiscoveryViewProps["onSaveDiscovery"];
  busy: boolean;
  downloads: Record<string, string>;
  onBack: () => void;
  onPlayAlbum?: (albumId: string) => void;
}

type ArtistData = Awaited<ReturnType<typeof library.lookupArtist>>;

export function ArtistView({
  favoriteArtists,
  onFavoriteArtist,
  artistId,
  onNavigateAlbum,
  onNavigateArtist,
  onSaveDiscovery,
  busy,
  downloads,
  onBack,
  savedTracks,
  favorites,
  onCatalogAction,
  onPlayAlbum,
}: ArtistViewProps) {
  const [data, setData] = useState<ArtistData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [choices, setChoices] = useState<(CatalogArtist & { tracks?: string[] })[]>([]);
  const lookupName = artistLookupName(artistId);
  const resolutions = useArtistResolutions();
  const resolvedId = resolutions.find(value => value.verifiedIds.includes(artistId))?.artist.id;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    setData(null);
    setChoices([]);
    const request = lookupName
      ? library.searchCatalogEntities(lookupName).then(async result => {
        const options = await Promise.all(result.artists.map(async artist => {
          try { const profile = await library.lookupArtist(artist.id); return { ...profile.info, tracks: profile.topTracks.slice(0, 2).map(track => track.title) }; }
          catch { return artist; }
        }));
        if (!cancelled) setChoices([...new Map(options.map(artist => [artist.id, artist])).values()]);
      })
      : library.lookupArtist(artistId).then(result => {
        if (!cancelled) {
          setData(result);
          if (result.verifiedIds?.length && !resolvedId) rememberArtistResolution({ query: result.info.name, verifiedIds: result.verifiedIds, artist: result.info });
        }
      });
    request
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : String(err)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [artistId, attempt, lookupName, resolvedId]);

  if (loading) {
    return (
      <div className="empty page-loading" role="status">
        <Loader2 size={32} className="spin" />
        <p>Loading artist...</p>
      </div>
    );
  }

  if (lookupName && !error) {
    return <section className="artist-choices" aria-label="Choose artist identity">
      <button onClick={onBack} className="subtle"><ChevronLeft size={16} />Back</button>
      <h1>Choose an artist for “{lookupName}”</h1>
      <p>Choose an artist to explore their songs and releases.</p>
      <div className="search-artists-grid">{choices.map(artist => <button key={artist.id} className="search-artist-card" onClick={() => onNavigateArtist(artist.id)}>
        <Artwork url={artist.artworkUrl} kind="artist" />
        <span className="search-artist-name">{artist.name}</span>
        {artist.tracks?.length ? <span className="artist-choice-tracks">{artist.tracks.map((title, index) => <span className="artist-choice-track" key={index} title={title}>{title}</span>)}</span> : null}
      </button>)}</div>
      {!choices.length && <p>No artists are available.</p>}
    </section>;
  }

  if (error || !data) {
    return (
      <div className="empty page-error" role="alert">
        <CircleAlert size={32} />
        <h2>Artist unavailable</h2>
        <p>{error || "Failed to load artist"}</p>
        <div className="heading-actions">
          <button onClick={() => setAttempt(value => value + 1)} className="primary">Retry</button>
          <button onClick={onBack} className="subtle">Go Back</button>
        </div>
      </div>
    );
  }

  const savedFavorite = favoriteArtists.find(artist => artist.id === data.info.id || data.verifiedIds?.includes(artist.id));
  const isFavorite = Boolean(savedFavorite);

  return (
    <div className="artist-page" data-artist-id={data.info.id}>
      <div className="catalog-toolbar">
        <button onClick={onBack} className="subtle"><ChevronLeft size={16} />Back</button>
      </div>
      <div className="page-heading catalog-hero artist-header">
        <div className="artist-cover-wrap">
          <Artwork url={data.info.artworkUrl} className="artist-cover" kind="artist" />
        </div>
        <div className="artist-info">
          <p className="eyebrow">ARTIST</p>
          <h1 className="artist-name">{data.info.name}</h1>
          <p className="subtitle artist-subtitle">Popular tracks and available releases</p>
          <div className="artist-actions">
            <button
              type="button"
              className={`subtle artist-favorite-btn ${isFavorite ? "is-active" : ""}`}
              aria-pressed={isFavorite}
              title={isFavorite ? "Remove from favorite artists" : "Add to favorite artists"}
              onClick={() => onFavoriteArtist(data.info, data.verifiedIds)}
            >
              <Heart size={16} fill={isFavorite ? "currentColor" : "none"} />
              <span>{isFavorite ? "Favorited" : "Favorite artist"}</span>
            </button>
          </div>
        </div>
      </div>

      {data.topTracks.length > 0 && (
        <section className="catalog-section artist-section">
          <h2>Popular tracks</h2>
          <CatalogTrackList savedTracks={savedTracks} favorites={favorites} onCatalogAction={onCatalogAction} tracks={groupRecordings(data.topTracks, savedTracks, favorites).map(group => group.primary)} onNavigateAlbum={onNavigateAlbum} busy={busy} downloads={downloads} onSaveDiscovery={onSaveDiscovery} onNavigateArtist={onNavigateArtist} />
        </section>
      )}
      {data.topTracks.length === 0 && <p className="subtitle catalog-empty">No popular tracks are available for this artist.</p>}

      {data.albums.length > 0 && (
        <section className="catalog-section artist-section">
          <h2>Albums &amp; releases</h2>
          <div className="albums-grid artist-albums-grid">
            {data.albums.map((album) => (
              <button
                key={album.id}
                type="button"
                className="album-card discover-album-card"
                onClick={() => onNavigateAlbum(album.id)}
                aria-label={`Open album ${album.title}`}
              >
                <div className="album-card-cover-wrap">
                  <Artwork url={album.artworkUrl} className="album-card-cover" />
                  <div
                    className="album-hover-play"
                    aria-label={`Play ${album.title}`}
                    role="button"
                    tabIndex={0}
                    onClick={(e) => {
                      if (onPlayAlbum) {
                        e.stopPropagation();
                        onPlayAlbum(album.id);
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        if (onPlayAlbum) {
                          e.stopPropagation();
                          onPlayAlbum(album.id);
                        }
                      }
                    }}
                  >
                    <Play size={18} fill="currentColor" color="currentColor" />
                  </div>
                </div>
                <div className="album-card-info">
                  <div className="album-title" title={album.title}>
                    {album.title}
                  </div>
                  <div
                    className="album-year"
                    title={`${album.year ?? "Release"}${album.trackCount != null ? ` · ${album.trackCount} tracks` : ""}`}
                  >
                    {album.year ?? "Release"}{album.trackCount != null ? ` · ${album.trackCount} tracks` : ""}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </section>
      )}
      {data.albums.length === 0 && <p className="subtitle catalog-empty">No releases are available for this artist.</p>}

    </div>
  );
}
