import { MusicMetadataDetails } from "../common/MusicMetadataDetails";
import React, { useEffect, useState } from "react";
import { library } from "../../adapters/native";
import type { DiscoveryViewProps } from "./DiscoveryView";
import { Check, ChevronLeft, CircleAlert, Download, Heart, Loader2, Pause, Play, RefreshCw, Shuffle, X } from "lucide-react";
import type { CatalogAlbum, CatalogTrack } from "../../adapters/native";
import { Artwork, ArtistLinks, DownloadedBadge, IconButton } from "../common";
import type { AlbumDownloadProgress } from "../../hooks/useAlbumDownloads";
import { CatalogTrackList } from "../common/CatalogTrackList";
import type { CatalogActionHandlers } from "../common/CatalogTrackActions";

interface AlbumViewProps extends CatalogActionHandlers {
  onPlayCollection: (tracks: CatalogTrack[], shuffle: boolean) => void;
  onDownloadAlbum: (tracks: CatalogTrack[]) => void;
  downloadProgress?: AlbumDownloadProgress;
  onPauseDownload: () => void;
  onCancelDownload: () => void;
  onlineAvailable: boolean;
  favoriteAlbums: { id: string }[];
  onFavoriteAlbum: (album: CatalogAlbum) => void;
  albumId: string;
  onSaveDiscovery: DiscoveryViewProps["onSaveDiscovery"];
  busy: boolean;
  downloads: Record<string, string>;
  onBack: () => void;
  onNavigateArtist?: (artistId: string) => void;
}

type AlbumData = Awaited<ReturnType<typeof library.lookupAlbum>>;

export function AlbumView({ albumId, onSaveDiscovery, busy, downloads, onBack, onNavigateArtist, savedTracks, favorites, onCatalogAction, onPlayCollection, onDownloadAlbum, downloadProgress, onPauseDownload, onCancelDownload, onlineAvailable, favoriteAlbums, onFavoriteAlbum }: AlbumViewProps) {
  const [data, setData] = useState<AlbumData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    library
      .lookupAlbum(albumId)
      .then(result => { if (!cancelled) setData(result); })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : String(err)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [albumId, attempt]);

  if (loading) {
    return (
      <div className="empty page-loading" role="status">
        <Loader2 size={32} className="spin" />
        <p>Loading album...</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="empty page-error" role="alert">
        <CircleAlert size={32} />
        <h2>Album unavailable</h2>
        <p>{error || "Failed to load album"}</p>
        <div className="heading-actions">
          <button onClick={() => setAttempt(value => value + 1)} className="primary">Retry</button>
          <button onClick={onBack} className="subtle">Go Back</button>
        </div>
      </div>
    );
  }

  const favorited = favoriteAlbums.some(album => album.id === data.info.id);
  const offline = data.tracks.length > 0 && data.tracks.every(track => savedTracks.some(saved => saved.metadataSourceId === track.id && saved.offline && !saved.missing));

  return (
    <div className="album-page">
      <div className="catalog-toolbar">
        <button onClick={onBack} className="subtle"><ChevronLeft size={16} />Back</button>
      </div>
      <div className="page-heading catalog-hero album-header">
        <Artwork url={data.info.artworkUrl} className="album-cover" />
        <div className="album-info">
          <p className="eyebrow">ALBUM</p>
          <h1>{data.info.title}</h1>
          <p className="subtitle album-by">
            by{" "}
            <ArtistLinks
              artists={data.info.artists}
              artistString={data.info.artist}
              catalogId={data.tracks[0]?.id}
              onNavigateArtist={onNavigateArtist}
            />
          </p>
          <div className="subtitle album-meta">
            {data.info.year != null && <span>{data.info.year}</span>}
            <span>{data.tracks.length} tracks</span>
            {offline && !data.partial && <DownloadedBadge track={savedTracks.find(saved => saved.metadataSourceId === data.tracks[0].id)} />}
          </div>
          <div className="album-actions">
            <button className="primary" disabled={busy || (!onlineAvailable && !offline) || !data.tracks.length} onClick={() => onPlayCollection(data.tracks, false)}><Play size={17} fill="currentColor" />Play album</button>
            <button className="subtle" disabled={busy || (!onlineAvailable && !offline) || data.tracks.length < 2} onClick={() => onPlayCollection(data.tracks, true)}><Shuffle size={17} />Shuffle</button>
            <button
              className={`subtle download-btn ${downloadProgress?.active ? "is-downloading" : offline ? "is-downloaded" : downloadProgress?.failed.length ? "has-errors" : ""}`}
              disabled={(!offline && !onlineAvailable) || !data.tracks.length}
              onClick={downloadProgress?.active ? onPauseDownload : () => onDownloadAlbum(data.tracks)}
              title={downloadProgress?.active ? (downloadProgress.paused ? "Resume download" : "Pause download") : offline ? "Downloaded" : "Download album"}
            >
              {downloadProgress?.active ? (
                <Loader2 size={17} className="spin" />
              ) : offline ? (
                <Check size={17} />
              ) : downloadProgress?.failed.length ? (
                <RefreshCw size={16} />
              ) : (
                <Download size={17} />
              )}
              <span>
                {downloadProgress?.active
                  ? `${downloadProgress.paused ? "Paused" : "Downloading"} ${downloadProgress.done}/${downloadProgress.total}`
                  : offline
                  ? "Downloaded"
                  : downloadProgress?.failed.length
                  ? `Retry (${downloadProgress.failed.length})`
                  : "Download"}
              </span>
            </button>
            {downloadProgress?.active && (
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
            <button className={`subtle ${favorited ? "is-active" : ""}`} aria-pressed={favorited} onClick={() => onFavoriteAlbum(data.info)}>
              <Heart size={17} fill={favorited ? "currentColor" : "none"} />{favorited ? "Favorited" : "Favorite album"}
            </button>
          </div>
        </div>
      </div>
      {data.partial && <p className="subtitle">Tracks found in catalog search. This may be an incomplete album.</p>}
      {data.tracks.length === 0 && <p className="subtitle catalog-empty">No tracks are currently available for this album.</p>}

      {data.tracks.length > 0 && (
        <section className="album-tracks">
          <CatalogTrackList savedTracks={savedTracks} favorites={favorites} onCatalogAction={onCatalogAction} tracks={data.tracks} busy={busy} downloads={downloads} onSaveDiscovery={onSaveDiscovery} onNavigateArtist={onNavigateArtist} />
        </section>
      )}

      <MusicMetadataDetails key={data.info.id} kind="album" title={data.info.title} artist={data.info.artist} />
    </div>
  );
}
