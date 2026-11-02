import { AppleCountryChart } from "./AppleCountryChart";
import { JioSaavnCharts } from "./JioSaavnCharts";
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2, Play } from "lucide-react";
import { DISCOVERY_PREFERENCES_CHANGED, discoveryPreferences, discoveryTrendingItems, loadDiscoverPage, mergeNewReleases, sortChartsByPreferences } from "../../adapters/discovery-home";
import type { DiscoverPage } from "../../adapters/native";
import type { DiscoveryViewProps } from "./DiscoveryView";
import { Artwork } from "../common";
import {featuredAlbum} from '../../adapters/discovery-home';

type Props = Pick<
  DiscoveryViewProps,
  | "busy"
  | "ytdlpAvailable"
  | "downloads"
  | "onSaveDiscovery"
  | "onNavigateAlbum"
  | "onNavigateArtist"
  | "savedTracks"
  | "favorites"
  | "onCatalogAction"
  | "onPlayCollection"
> & {
  onPlayAlbum?: (id: string) => Promise<void>;
  onNavigateChart?: (id: string) => void;
  revision?: number;
  onLoadingChange?: (loading: boolean) => void;
};

export function DiscoverShelves(props: Props) {
  const [spotlightDate,setSpotlightDate] = useState(()=>new Date());
  useEffect(()=>{
    const update=()=>setSpotlightDate(previous=>{const now=new Date();return previous.toDateString()===now.toDateString()?previous:now;});
    const timer=window.setInterval(update,60000);
    window.addEventListener('focus',update);
    return ()=>{window.clearInterval(timer);window.removeEventListener('focus',update);};
  },[]);
  const [feed, setFeed] = useState<DiscoverPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [playingAlbum, setPlayingAlbum] = useState<string | null>(null);
  const [languages, setLanguages] = useState(() => discoveryPreferences().languages);
  const languageKey = languages.join(",");
  useEffect(() => {
    const changed = () => setLanguages(discoveryPreferences().languages);
    window.addEventListener(DISCOVERY_PREFERENCES_CHANGED, changed);
    return () => window.removeEventListener(DISCOVERY_PREFERENCES_CHANGED, changed);
  }, []);

  const releasesScrollRef = useRef<HTMLDivElement>(null);
  const trendingScrollRef = useRef<HTMLDivElement>(null);

  const activeRevision = props.revision ?? 0;

  useEffect(() => {
    let active = true;
    setLoading(true);
    props.onLoadingChange?.(true);
    setError("");
    void loadDiscoverPage(languages, activeRevision > 0)
      .then((value) => {
        if (active) setFeed(value);
      })
      .catch(() => {
        if (active)
          setError(
            "Discovery couldn't refresh. You can still search or browse moods and genres below.",
          );
      })
      .finally(() => {
        if (active) {
          setLoading(false);
          props.onLoadingChange?.(false);
        }
      });
    return () => {
      active = false;
    };
  }, [activeRevision, languageKey]);

  const scrollRow = (
    ref: React.RefObject<HTMLDivElement | null>,
    direction: "left" | "right",
  ) => {
    if (!ref.current) return;
    const distance = Math.min(ref.current.clientWidth * 0.8, 540);
    ref.current.scrollBy({
      left: direction === "left" ? -distance : distance,
      behavior: "smooth",
    });
  };

  const renderShelfHeader = (
    title: string,
    ref: React.RefObject<HTMLDivElement | null>,
    subtitle?: string,
  ) => (
    <div className="discover-editorial-header">
      <div>
        <h2>{title}</h2>
        {subtitle && <p className="subtitle">{subtitle}</p>}
      </div>
      <div className="discover-section-nav">
        <button
          type="button"
          className="discover-nav-arrow"
          aria-label={`Previous ${title}`}
          onClick={() => scrollRow(ref, "left")}
        >
          <ChevronLeft size={14} />
        </button>
        <button
          type="button"
          className="discover-nav-arrow"
          aria-label={`Next ${title}`}
          onClick={() => scrollRow(ref, "right")}
        >
          <ChevronRight size={14} />
        </button>
      </div>
    </div>
  );

  const trendingItems = feed ? discoveryTrendingItems(feed) : [];
  const sortedCharts = useMemo(
    () => sortChartsByPreferences(feed?.charts || [], languages),
    [feed?.charts, languages],
  );

  return (
    <div className="discover-editorial">
      {loading && !feed && <p role="status">Loading new releases and charts…</p>}
      {error && (
        <p role="status" className="subtitle">
          {error}
        </p>
      )}
      {feed && (
        <>
          {feed.warnings.map((warning) => (
            <p className="subtitle" role="status" key={warning}>
              {warning}
            </p>
          ))}

          {/* Featured Spotlight Hero Banner (Sonora / Apple Music Style) */}
          {feed.newAlbums.length > 0 && (() => {
            const spotlightAlbum = featuredAlbum(feed.newAlbums,spotlightDate)!;
            return (
              <section aria-label="Featured album" className="discover-editorial-section discover-spotlight-section">
                <div
                  className="discover-spotlight-card"
                  onClick={() => props.onNavigateAlbum?.(spotlightAlbum.id)}
                  role="button"
                  tabIndex={0}
                  aria-label={`Open album ${spotlightAlbum.title}`}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      props.onNavigateAlbum?.(spotlightAlbum.id);
                    }
                  }}
                >
                  <div
                    className="discover-spotlight-backdrop"
                    style={{
                      backgroundImage: spotlightAlbum.artworkUrl
                        ? `url(${spotlightAlbum.artworkUrl})`
                        : `url(/featured-hero.jpg)`,
                    }}
                  />
                  <div className="discover-spotlight-overlay" />
                  <div className="discover-spotlight-content">
                    <div className="discover-spotlight-details">
                      <span className="discover-spotlight-badge">FEATURED ALBUM</span>
                      <h2 className="discover-spotlight-title" title={spotlightAlbum.title}>
                        {spotlightAlbum.title}
                      </h2>
                      <p className="discover-spotlight-artist">
                        {spotlightAlbum.artist}{" "}
                        {spotlightAlbum.year ? `· ${spotlightAlbum.year}` : ""}
                      </p>
                      <p className="discover-spotlight-desc">
                        A standout release from today's freshest sounds and featured artists.
                      </p>
                      <div className="discover-spotlight-actions">
                        <button
                          type="button"
                          className="primary discover-spotlight-play-btn"
                          disabled={props.busy || !props.ytdlpAvailable || playingAlbum === spotlightAlbum.id}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (props.onPlayAlbum) {
                              setPlayingAlbum(spotlightAlbum.id);
                              void props.onPlayAlbum(spotlightAlbum.id).finally(() => setPlayingAlbum(null));
                            } else {
                              props.onNavigateAlbum?.(spotlightAlbum.id);
                            }
                          }}
                        >
                          {playingAlbum === spotlightAlbum.id ? (
                            <Loader2 size={16} className="spin" />
                          ) : (
                            <Play size={16} fill="currentColor" />
                          )}
                          Play Album
                        </button>
                        <button
                          type="button"
                          className="subtle discover-spotlight-explore-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            props.onNavigateAlbum?.(spotlightAlbum.id);
                          }}
                        >
                          View Details
                        </button>
                      </div>
                    </div>
                    <div className="discover-spotlight-hero-branding" aria-hidden="true">
                      <span className="discover-spotlight-script-title">{spotlightAlbum.title}</span>
                      <span className="discover-spotlight-script-artist">{(spotlightAlbum.artist || "FEATURED").toUpperCase()}</span>
                    </div>
                  </div>
                </div>
              </section>
            );
          })()}

          <section aria-label="New releases" className="discover-editorial-section">
            {renderShelfHeader("New releases", releasesScrollRef)}
            {feed.newAlbums.length || feed.newSingles.length ? (
              <div className="discover-release-row" ref={releasesScrollRef}>
                {mergeNewReleases(feed.newAlbums, feed.newSingles).map(release => (
                  <button type="button" className="album-card discover-album-card" key={release.id}
                    disabled={release.kind === "single" && (props.busy || !props.ytdlpAvailable)}
                    aria-label={`${release.kind === "album" ? "Open album" : "Play"} ${release.item.title}`}
                    onClick={() => {
                      if (release.kind === "album") props.onNavigateAlbum?.(release.item.id);
                      else props.onSaveDiscovery(release.item, "play");
                    }}>
                    <div className="album-card-cover-wrap">
                      <Artwork url={release.item.artworkUrl} className="album-card-cover" />
                      <span className="discover-release-badge">{release.kind === "album" ? "Album" : "Single"}</span>
                      <div className="album-hover-play" aria-hidden="true"><Play size={18} fill="currentColor" color="currentColor" /></div>
                    </div>
                    <div className="album-card-info">
                      <div className="album-title" title={release.item.title}>{release.item.title}</div>
                      <div className="album-year" title={`${release.item.artist} · ${release.kind === "album" ? "Album" : "Single"}`}>{release.item.artist}</div>
                    </div>
                  </button>
                ))}
              </div>
            ) : <p className="subtitle">No new releases available right now.</p>}
          </section>

          {/* Trending now */}
          <section aria-label="Trending now in India" className="discover-editorial-section">
            {renderShelfHeader("Trending now in India", trendingScrollRef)}
            {trendingItems.length ? (
              <div className="discover-release-row" ref={trendingScrollRef}>
                {trendingItems.map(entry => {
                  const { item } = entry;
                  const subtitle = entry.item.artist;
                  const content = <>
                    <div className="album-card-cover-wrap">
                      <Artwork url={item.artworkUrl} className="album-card-cover" />
                      <span className="album-hover-play" aria-hidden="true"><Play size={18} fill="currentColor" /></span>
                    </div>
                    <div className="album-card-info">
                      <div className="album-title" title={item.title}>{item.title}</div>
                      <div className="album-year" title={subtitle}>{subtitle}</div>
                    </div>
                  </>;
                  return <button type="button" className="album-card discover-album-card" key={item.id}
                    disabled={entry.kind === "song" && (props.busy || !props.ytdlpAvailable)}
                    aria-label={`${entry.kind === "album" ? "Open album" : "Play"} ${item.title}`}
                    onClick={() => entry.kind === "album" ? props.onNavigateAlbum?.(entry.item.id) : props.onSaveDiscovery(entry.item, "play")}>{content}</button>;
                })}
              </div>
            ) : (
              <p className="subtitle">No trending tracks available right now.</p>
            )}
          </section>
        </>
      )}
      <AppleCountryChart disabled={props.busy || !props.ytdlpAvailable} onPlay={track => props.onSaveDiscovery(track, "play")} />
      <JioSaavnCharts charts={sortedCharts} loading={loading} onNavigateChart={props.onNavigateChart} />
    </div>
  );
}
