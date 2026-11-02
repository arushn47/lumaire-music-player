import React, { useEffect, useState } from "react";
import { ChevronLeft, Loader2, Play, RefreshCw, Shuffle } from "lucide-react";
import { loadJioChart } from "../../adapters/jiosaavn-charts";
import { library, type CatalogTrack, type ChartDetails } from "../../adapters/native";
import type { DiscoveryViewProps } from "./DiscoveryView";
import { Artwork } from "../common";
import { CatalogTrackList } from "../common/CatalogTrackList";

interface ChartViewProps extends Pick<
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
  chartId: string;
  onBack: () => void;
  onlineAvailable: boolean;
}

export function ChartView({
  chartId,
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
}: ChartViewProps) {
  const [data, setData] = useState<ChartDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    loadJioChart(chartId, revision > 0)
      .then((value) => {
        if (active) setData(value);
      })
      .catch((err) => {
        if (active) {
          setData(null);
          setError(err instanceof Error ? err.message : "This chart couldn't load right now. Retry or choose another chart.");
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [chartId, revision]);


  const offline = data?.tracks.every((track) =>
    savedTracks.some((saved) => saved.metadataSourceId === track.id && saved.offline && !saved.missing)
  );
  const disabled = busy || (!onlineAvailable && !offline);

  if (loading) {
    return (
      <div className="empty page-loading" role="status">
        <Loader2 size={32} className="spin" />
        <p>Loading chart…</p>
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
        <p>{error || "Chart unavailable"}</p>
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
          <p className="eyebrow">CHART</p>
          <h1>{data.info.title}</h1>
          <p className="subtitle">
            {data.tracks.length} tracks{data.info.subtitle ? ` · ${data.info.subtitle}` : ""}
          </p>
          <div className="album-actions">
            <button
              className="primary"
              disabled={disabled || !data.tracks.length}
              onClick={() => onPlayCollection(data.tracks, false)}
            >
              <Play size={17} fill="currentColor" />Play chart
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
              <RefreshCw size={17} />Refresh chart
            </button>
          </div>
        </div>
      </div>

      {data.warning && <p role="status" className="subtitle">{data.warning}</p>}
      {data.partial && (
        <p role="status" className="subtitle">
          Some tracks were unavailable. Showing the available tracks in chart order.
        </p>
      )}

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
    </div>
  );
}
