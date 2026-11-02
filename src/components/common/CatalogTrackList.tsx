import { Play } from "lucide-react";
import type { JSX } from "react";
import type { CatalogTrack } from "../../adapters/native";
import { ArtistLinks } from "./ArtistLinks";
import { Artwork } from "./Artwork";
import { DownloadedBadge } from "./DownloadedBadge";
import { CatalogTrackActions, type CatalogActionHandlers } from "./CatalogTrackActions";

interface CatalogTrackListProps extends CatalogActionHandlers {
  tracks: CatalogTrack[];
  busy: boolean;
  downloads: Record<string, string>;
  onSaveDiscovery: (track: CatalogTrack, mode: "play" | "queue") => void;
  onNavigateArtist?: (id: string) => void;
  onNavigateAlbum?: (id: string) => void;
}

export function CatalogTrackList({ tracks, busy, downloads, onSaveDiscovery, onNavigateArtist, onNavigateAlbum, savedTracks, favorites, onCatalogAction }: CatalogTrackListProps): JSX.Element {
  return (
    <div className={`catalog-tracks ${onNavigateAlbum ? "" : "catalog-album-tracks"}`}>
      <div className="track-header" aria-hidden="true">
        <span>#</span><span>Track / artist</span>
        {onNavigateAlbum && <span>Album</span>}
        <span>Time</span><span />
      </div>
      <div className="track-list" role="list" aria-label="Tracks">
        {tracks.map((track, index) => {
          const saved = savedTracks.find(saved => saved.id === track.id || saved.metadataSourceId === track.id);
          const downloading = downloads[track.id] === "downloading" || Boolean(saved && downloads[saved.id] === "downloading");
          const disabled = busy;
          const seconds = Number.isFinite(track.duration) ? Math.max(0, Math.floor(track.duration)) : 0;
          return (
            <div
              className="track-row"
              role="listitem"
              key={track.id}
              onClick={(e) => {
                if (disabled || (e.target as HTMLElement).closest("button, a, summary, details, input, .track-actions, .menu-popover")) return;
                onSaveDiscovery(track, "play");
              }}
            >
              <button className="track-play" aria-label={`Play ${track.title}`} disabled={disabled} onClick={() => onSaveDiscovery(track, "play")}>
                {<>
                  <span className="track-index">{String(index + 1).padStart(2, "0")}</span>
                  <Play size={15} className="row-play" />
                </>}
              </button>
              <div className="track-meta">
                <div className="track-cover-container">
                  <Artwork url={track.artworkUrl} />
                  {downloading && (
                    <div className="track-cover-download-overlay" title="Downloading…" role="img" aria-label="Downloading">
                      <div className="track-cover-spinner spin" />
                    </div>
                  )}
                </div>
                <span className="track-meta-text">
                  <button className="track-title-button" disabled={disabled} aria-label={`Listen to ${track.title}`} onClick={() => onSaveDiscovery(track, "play")}>
                    <strong dir="auto" title={track.title}>{track.title}</strong>
                  </button>
                  <small dir="auto"><DownloadedBadge track={saved} /><ArtistLinks artists={track.artists} artistString={track.artist} catalogId={track.id} onNavigateArtist={onNavigateArtist} /></small>
                </span>
              </div>
              {onNavigateAlbum && <span className="album ellipsis" title={track.album}>
                {track.albumId ? <button className="link-button" onClick={() => onNavigateAlbum(track.albumId!)}>{track.album}</button> : track.album || "—"}
              </span>}
              <span className="duration">{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}</span>
              <div className="track-actions">
                <CatalogTrackActions track={track} savedTracks={savedTracks} favorites={favorites} onCatalogAction={onCatalogAction} disabled={disabled} downloading={downloading} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
