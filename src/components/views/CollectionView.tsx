import React, { useEffect, useState } from "react";
import { ChevronLeft, Loader2, Play, RefreshCw, Shuffle } from "lucide-react";
import { library, type ChartDetails, type CatalogTrack } from "../../adapters/native";
import type { DiscoveryViewProps } from "./DiscoveryView";
import { Artwork } from "../common";
import { CatalogTrackList } from "../common/CatalogTrackList";
import { discoveryPreferences, recommendationLanguages } from "../../adapters/discovery-home";

interface CollectionViewProps extends Pick<
  DiscoveryViewProps,
  | "busy"
  | "downloads"
  | "savedTracks"
  | "favorites"
  | "onCatalogAction"
  | "onSaveDiscovery"
  | "onNavigateAlbum"
  | "onNavigateArtist"
  | "onPlayCollection"
> {
  type: "mood" | "genre";
  name: string;
  onBack: () => void;
  onlineAvailable: boolean;
}

export function CollectionView({
  type,
  name,
  onBack,
  busy,
  onlineAvailable,
  downloads,
  savedTracks,
  favorites,
  onCatalogAction,
  onSaveDiscovery,
  onNavigateAlbum,
  onNavigateArtist,
  onPlayCollection,
}: CollectionViewProps) {
  const [data, setData] = useState<ChartDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    const fetchLanguages = recommendationLanguages(discoveryPreferences().languages);
    
    const promise = type === "mood"
      ? library.searchMoodCollection(name, fetchLanguages)
      : library.searchGenreCollection(name, fetchLanguages);
    
    promise
      .then((value) => {
        if (active) {
          setData(value);
          setError("");
        }
      })
      .catch((err) => {
        if (active) {
          setData(null);
          setError(err instanceof Error ? err.message : `This ${type} collection couldn't load right now. Try another ${type} or retry later.`);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    
    return () => {
      active = false;
    };
  }, [type, name, revision]);


  const offline = data?.tracks.every((track) =>
    savedTracks.some((saved) => saved.metadataSourceId === track.id && saved.offline && !saved.missing)
  );
  const disabled = busy || (!onlineAvailable && !offline);

  if (loading) {
    return (
      <div className="empty page-loading" role="status">
        <Loader2 size={32} className="spin" />
        <p>Loading {type} collection…</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="empty page-error" role="alert">
        <div className="catalog-toolbar">
          <button className="subtle" onClick={onBack}>
            <ChevronLeft size={16} />Back
          </button>
        </div>
        <p>{error || `${type} collection unavailable`}</p>
        <button className="subtle" onClick={() => setRevision((v) => v + 1)}>
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="album-page chart-page">
      <div className="catalog-toolbar">
        <button className="subtle" onClick={onBack}>
          <ChevronLeft size={16} />Back
        </button>
      </div>

      <div className="page-heading catalog-hero album-header">
        <Artwork url={data.info.artworkUrl} className="album-cover" />
        <div className="album-info">
          <p className="eyebrow">{type.toUpperCase()}</p>
          <h1>{name}</h1>
          <p className="subtitle">
            {data.tracks.length} tracks · {data.info.subtitle}
          </p>
          <div className="album-actions">
            <button
              className="primary"
              disabled={disabled || !data.tracks.length}
              onClick={() => onPlayCollection(data.tracks, false)}
            >
              <Play size={17} fill="currentColor" />Play collection
            </button>
            <button
              className="subtle"
              disabled={disabled || data.tracks.length < 2}
              onClick={() => onPlayCollection(data.tracks, true)}
            >
              <Shuffle size={17} />Shuffle
            </button>
            <button
              className="subtle"
              disabled={loading}
              onClick={() => setRevision((v) => v + 1)}
            >
              <RefreshCw size={17} />Refresh
            </button>
          </div>
        </div>
      </div>

      {data.warning && <p role="status" className="subtitle">{data.warning}</p>}

      {data.tracks.length > 0 ? (
        <CatalogTrackList
          tracks={data.tracks}
          busy={busy}
          downloads={downloads}
          savedTracks={savedTracks}
          favorites={favorites}
          onCatalogAction={onCatalogAction}
          onSaveDiscovery={onSaveDiscovery}
          onNavigateAlbum={onNavigateAlbum}
          onNavigateArtist={onNavigateArtist}
        />
      ) : (
        <p className="empty" role="status">
          No tracks with matching {type} metadata were found in your selected languages.
        </p>
      )}
    </div>
  );
}
