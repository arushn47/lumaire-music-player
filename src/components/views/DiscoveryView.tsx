import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  Clock,
  Loader2,
  Play,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import { library, type CatalogTrack, type CatalogArtist, type CatalogAlbum } from "../../adapters/native";
import type { Track } from "../../domain/types";
import type { ListeningRecord } from "../../domain/listening";
import { clearDiscoverySearches, discoveryPreferences, rememberDiscoverySearch, removeDiscoverySearch } from "../../adapters/discovery-home";
import { Artwork, IconButton } from "../common";
import type { EngineSetupProps } from "../common/EngineSetupCard";
import { CatalogTrackActions, type CatalogActionHandlers } from "../common/CatalogTrackActions";
import { DiscoverShelves } from "./DiscoverShelves";
import type { CommonsDiscoveryState } from "./CommonsDiscovery";

export type SearchCategoryFilter = "songs" | "albums" | "artists";

export interface DiscoveryViewState {
  query: string;
  results: CatalogTrack[];
  artists: CatalogArtist[];
  albums: CatalogAlbum[];
  searchedQuery: string;
  entityError: string;
  searching: boolean;
  error: string;
  scrollTop: number;
  commons: CommonsDiscoveryState;
  filter?: SearchCategoryFilter;
}

export const initialDiscoveryViewState = (): DiscoveryViewState => ({
  query: "",
  results: [],
  artists: [],
  albums: [],
  searchedQuery: "",
  entityError: "",
  searching: false,
  error: "",
  scrollTop: 0,
  commons: { query: "", results: [], loading: false, error: "" },
  filter: "songs",
});

export interface DiscoveryViewProps extends CatalogActionHandlers, EngineSetupProps {
  onPlayCollection: (tracks: CatalogTrack[], shuffle: boolean) => void;
  onPlayAlbum: (id: string) => Promise<void>;
  state: DiscoveryViewState;
  onStateChange: (
    update: (current: DiscoveryViewState) => DiscoveryViewState,
  ) => void;
  ytdlpAvailable: boolean;
  mobile: boolean;
  busy: boolean;
  downloads: Record<string, string>;
  onSaveDiscovery: (
    result: CatalogTrack,
    mode: "play" | "save" | "next" | "queue",
  ) => void;
  onChoosePlaylist: (track: Track) => void;
  onDownloadTrack: (track: Track) => void;
  onSaveCommons: (track: Track, play: boolean) => void;
  onQueueRemote: (track: Track, next: boolean) => void;
  onNavigateArtist?: (artistId: string) => void;
  onNavigateAlbum?: (albumId: string) => void;
  onNavigateChart?: (chartId: string) => void;
  recentRecords: ListeningRecord[];
  historyEnabled: boolean;
  onReplay: (record: ListeningRecord) => void;
  onImportMusic: () => void;
  onOpenLibrary: () => void;
}

const clock = (s: number) =>
  `${Math.floor((Number.isFinite(s) ? s : 0) / 60)}:${String(Math.floor((Number.isFinite(s) ? s : 0) % 60)).padStart(2, "0")}`;

interface ExploreCategory {
  name: string;
  image: string;
  color: string;
}

const MOODS_MOMENTS: ExploreCategory[] = [
  {
    name: "Chill",
    image: "https://images.unsplash.com/photo-1518495973542-4542c06a5843?w=500&auto=format&fit=crop&q=80",
    color: "#3d5a80",
  },
  {
    name: "Commute",
    image: "https://images.unsplash.com/photo-1509749837427-ac94a2553d0e?w=500&auto=format&fit=crop&q=80",
    color: "#725b44",
  },
  {
    name: "Energize",
    image: "https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=500&auto=format&fit=crop&q=80",
    color: "#8338ec",
  },
  {
    name: "Feel good",
    image: "https://images.unsplash.com/photo-1492684223066-81342ee5ff30?w=500&auto=format&fit=crop&q=80",
    color: "#2a9d8f",
  },
  {
    name: "Focus",
    image: "https://images.unsplash.com/photo-1499750310107-5fef28a66643?w=500&auto=format&fit=crop&q=80",
    color: "#264653",
  },
  {
    name: "Gaming",
    image: "https://images.unsplash.com/photo-1542751371-adc38448a05e?w=500&auto=format&fit=crop&q=80",
    color: "#5e503f",
  },
  {
    name: "Party",
    image: "https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?w=500&auto=format&fit=crop&q=80",
    color: "#9d0208",
  },
  {
    name: "Romance",
    image: "https://images.unsplash.com/photo-1518199266791-5375a83190b7?w=500&auto=format&fit=crop&q=80",
    color: "#932f6d",
  },
  {
    name: "Sad",
    image: "https://images.unsplash.com/photo-1515694346937-94d85e41e6f0?w=500&auto=format&fit=crop&q=80",
    color: "#34495e",
  },
  {
    name: "Sleep",
    image: "https://images.unsplash.com/photo-1519681393784-d120267933ba?w=500&auto=format&fit=crop&q=80",
    color: "#1c2541",
  },
  {
    name: "Workout",
    image: "https://images.unsplash.com/photo-1517838277536-f5f99be501cd?w=500&auto=format&fit=crop&q=80",
    color: "#b0572e",
  },
];

const GENRES: ExploreCategory[] = [
  {
    name: "Pop",
    image: "https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=500&auto=format&fit=crop&q=80",
    color: "#e01e5a",
  },
  {
    name: "Rock",
    image: "https://images.unsplash.com/photo-1498038432885-c6f3f1b912ee?w=500&auto=format&fit=crop&q=80",
    color: "#a01a1e",
  },
  {
    name: "Hip hop",
    image: "https://images.unsplash.com/photo-1509198397868-475647b2a1e5?w=500&auto=format&fit=crop&q=80",
    color: "#ca6702",
  },
  {
    name: "Jazz",
    image: "https://images.unsplash.com/photo-1511192336575-5a79af67a629?w=500&auto=format&fit=crop&q=80",
    color: "#bb3e03",
  },
  {
    name: "Classical",
    image: "https://images.unsplash.com/photo-1520523839898-507121c179cf?w=500&auto=format&fit=crop&q=80",
    color: "#4a4e69",
  },
  {
    name: "Electronic",
    image: "https://images.unsplash.com/photo-1508700115892-45ecd05ae2ad?w=500&auto=format&fit=crop&q=80",
    color: "#3a0ca3",
  },
  {
    name: "Indie",
    image: "https://images.unsplash.com/photo-1465847899084-d164df4dedc6?w=500&auto=format&fit=crop&q=80",
    color: "#2b9348",
  },
  {
    name: "Soul",
    image: "https://images.unsplash.com/photo-1485579149621-3123dd979885?w=500&auto=format&fit=crop&q=80",
    color: "#8a5027",
  },
  {
    name: "R&B",
    image: "https://images.unsplash.com/photo-1516280440614-37939bbacd81?w=500&auto=format&fit=crop&q=80",
    color: "#7209b7",
  },
  {
    name: "Folk",
    image: "https://images.unsplash.com/photo-1445307806294-bff7f67ff225?w=500&auto=format&fit=crop&q=80",
    color: "#588157",
  },
  {
    name: "Metal",
    image: "https://images.unsplash.com/photo-1501386761578-eac5c94b800a?w=500&auto=format&fit=crop&q=80",
    color: "#2b2d42",
  },
  {
    name: "Blues",
    image: "https://images.unsplash.com/photo-1514320291840-2e0a9bf2a9ae?w=500&auto=format&fit=crop&q=80",
    color: "#1d3557",
  },
];

export function DiscoveryView({
  savedTracks, favorites, onCatalogAction,
  state,
  onStateChange,
  ytdlpAvailable,
  mobile,
  busy,
  downloads,
  onSaveDiscovery,
  onPlayAlbum,
  onPlayCollection,
  onChoosePlaylist,
  onDownloadTrack,
  onSaveCommons,
  onQueueRemote,
  onNavigateArtist,
  onNavigateAlbum,
  onNavigateChart,
  recentRecords,
  historyEnabled,
  onReplay,
  onImportMusic,
  onOpenLibrary,
  ...engineSetup
}: DiscoveryViewProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const searchWrapRef = useRef<HTMLDivElement>(null);
  const searchGeneration = useRef(0);
  const [recentSearches, setRecentSearches] = useState(() => discoveryPreferences().searches);
  const [searchFocused, setSearchFocused] = useState(false);
  const [discoverRevision, setDiscoverRevision] = useState(0);
  const [discoverLoading, setDiscoverLoading] = useState(false);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (searchWrapRef.current && !searchWrapRef.current.contains(e.target as Node)) {
        setSearchFocused(false);
        searchWrapRef.current?.querySelector("input")?.blur();
      }
    }
    document.addEventListener("mousedown", handleClickOutside, true);
    return () => document.removeEventListener("mousedown", handleClickOutside, true);
  }, []);

  useEffect(() => {
    if (!historyEnabled) { clearDiscoverySearches(); setRecentSearches([]); }
  }, [historyEnabled]);
  useEffect(() => () => {
    searchGeneration.current++;
    onStateChange(current => ({ ...current, searching: false }));
  }, []);
  const { query, results, artists, albums, searchedQuery, entityError, searching, error, filter } = state;
  const activeFilter: SearchCategoryFilter = filter || "songs";

  useLayoutEffect(() => {
    const main = rootRef.current?.closest("main");
    if (!main) return;
    main.scrollTop = state.scrollTop;

    return () => {
      onStateChange((current) => ({
        ...current,
        scrollTop: main.scrollTop,
      }));
    };
  }, []);

  const handleSearch = (requested = query) => {
    const trimmed = requested.trim().slice(0, 200);
    if (!trimmed) return;
    if (historyEnabled) setRecentSearches(rememberDiscoverySearch(trimmed));
    rootRef.current?.closest("main")?.scrollTo({ top: 0 });
    const generation = ++searchGeneration.current;
    onStateChange((current) => ({
      ...current,
      searching: true,
      query: trimmed,
      scrollTop: 0,
      results: [],
      artists: [],
      albums: [],
      searchedQuery: trimmed,
      entityError: "",
      error: "",
      filter: "songs",
    }));
    let pending = 2;
    const finish = () => {
      if (--pending === 0 && generation === searchGeneration.current)
        onStateChange(current => ({ ...current, searching: false }));
    };
    void library.searchCatalog(trimmed, 20).then(results => {
      if (generation === searchGeneration.current) onStateChange(current => ({ ...current, results }));
    }, error => {
      if (generation === searchGeneration.current) onStateChange(current => ({ ...current, error: String(error) }));
    }).finally(finish);
    void library.searchCatalogEntities(trimmed).then(entities => {
      if (generation === searchGeneration.current) onStateChange(current => ({ ...current, artists: entities.artists, albums: entities.albums, entityError: entities.warning || "" }));
    }, error => {
      if (generation === searchGeneration.current) onStateChange(current => ({ ...current, entityError: String(error) }));
    }).finally(finish);
  };

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      onStateChange(current => ({ ...current, searching: false, searchedQuery: "", results: [], artists: [], albums: [], error: "", entityError: "", filter: "songs" }));
      return;
    }
    onStateChange(current => ({ ...current, searching: true }));
    const timer = window.setTimeout(() => handleSearch(trimmed), 350);
    return () => { window.clearTimeout(timer); searchGeneration.current++; };
  }, [query]);

  return (
    <div
      ref={rootRef}
      className="discovery-view-state"
    >
      <section className="discover-page">
        <div className="page-heading discover-page-heading">
          <div>
            <p className="eyebrow">ONLINE & CURATED</p>
            <h1>
              Discover<span className="heading-dot">.</span>
            </h1>
            <p className="subtitle">
              Find your next favorite. Search music, explore new releases, or follow your mood.
            </p>
          </div>
        </div>

        <div className="discover-search-central" ref={searchWrapRef}>
          <div className="discover-search-row">
            <label className={`discover-search-bar ${searchFocused ? "is-focused" : ""}`}>
              <Search size={16} className="discover-search-icon" />
              <input
                aria-label="Search music"
                placeholder="Search songs, artists, albums…"
                maxLength={200}
                value={query}
                onFocus={() => setSearchFocused(true)}
                onChange={(e) =>
                  onStateChange((current) => ({
                    ...current,
                    query: e.target.value,
                  }))
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    setSearchFocused(false);
                    handleSearch();
                  } else if (e.key === "Escape") {
                    setSearchFocused(false);
                  }
                }}
              />
              {searching ? (
                <Loader2 size={15} className="spin" style={{ color: "var(--accent)" }} />
              ) : query ? (
                <button
                  type="button"
                  className="search-clear-button"
                  aria-label="Clear search"
                  onClick={() => {
                    searchGeneration.current++;
                    onStateChange((current) => ({
                      ...current,
                      query: "",
                      searching: false,
                      results: [],
                      artists: [],
                      albums: [],
                      searchedQuery: "",
                      entityError: "",
                      error: "",
                      filter: "songs",
                    }));
                  }}
                >
                  <X size={14} />
                </button>
              ) : null}
            </label>
            {!searchedQuery && (
              <button
                type="button"
                className="subtle discover-refresh-btn"
                disabled={discoverLoading}
                onClick={() => setDiscoverRevision((r) => r + 1)}
                title="Refresh Discover"
                aria-label="Refresh Discover"
              >
                {discoverLoading ? (
                  <Loader2 size={16} className="spin" />
                ) : (
                  <RefreshCw size={16} />
                )}
              </button>
            )}
          </div>

          {searchFocused && historyEnabled && recentSearches.length > 0 && !query.trim() && (
            <div className="discover-search-popover">
              <div className="discover-popover-header">
                <span>Recent searches</span>
                <button
                  type="button"
                  className="link-button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    clearDiscoverySearches();
                    setRecentSearches([]);
                  }}
                >
                  Clear all
                </button>
              </div>
              <div className="discover-popover-items">
                {recentSearches.map((item) => (
                  <div key={item} className="discover-popover-row">
                    <button
                      type="button"
                      className="discover-popover-item"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        setSearchFocused(false);
                        handleSearch(item);
                      }}
                    >
                      <Clock size={13} className="discover-popover-icon" />
                      <span className="discover-popover-text ellipsis">{item}</span>
                    </button>
                    <button
                      type="button"
                      className="discover-popover-remove"
                      title={`Remove "${item}"`}
                      aria-label={`Remove ${item} from recent searches`}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        const next = removeDiscoverySearch(item);
                        setRecentSearches(next);
                      }}
                    >
                      <X size={13} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {!ytdlpAvailable && mobile && engineSetup.engineState !== "checking" && <div className="banner error" role="alert">Online streaming could not start. Try restarting Lumaire; your local music remains available.</div>}

        {error && (
          <div className="banner error" role="alert">
            <span>{error}</span>
            <IconButton
              label="Dismiss error"
              onClick={() =>
                onStateChange((current) => ({ ...current, error: "" }))
              }
            >
              <X size={16} />
            </IconButton>
          </div>
        )}

        {!searchedQuery && !searching && !error && (
          <div className="explore-sections">
            <DiscoverShelves busy={busy} ytdlpAvailable={ytdlpAvailable} downloads={downloads} onSaveDiscovery={onSaveDiscovery} onNavigateAlbum={onNavigateAlbum} onNavigateArtist={onNavigateArtist} onNavigateChart={onNavigateChart} savedTracks={savedTracks} favorites={favorites} onCatalogAction={onCatalogAction} onPlayAlbum={onPlayAlbum} onPlayCollection={onPlayCollection} revision={discoverRevision} onLoadingChange={setDiscoverLoading} />
            {[
              { title: "Moods & moments", items: MOODS_MOMENTS },
              { title: "Genres", items: GENRES },
            ].map((section) => (
              <section key={section.title} aria-label={section.title} className="discover-editorial-section">
                <h2>{section.title}</h2>
                <div className="explore-grid">
                  {section.items.map((item) => (
                    <button
                      type="button"
                      className="explore-card"
                      key={item.name}
                      style={{ backgroundColor: item.color }}
                      onClick={() => onStateChange((current) => ({ ...current, query: item.name, filter: "songs" }))}
                    >
                      <img
                        src={item.image}
                        onError={event => { event.currentTarget.hidden = true; }}
                        alt=""
                        className="explore-card-img"
                        loading="lazy"
                        decoding="async"
                      />
                      <div className="explore-card-overlay" />
                      <span className="explore-card-title">{item.name}</span>
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}

        {searching && (
          <div className="empty">
            <Loader2 size={36} className="spin" />
            <h2>Searching...</h2>
          </div>
        )}

        {!searching && searchedQuery && (
          <div className="catalog-search-results">
            {entityError && <p className="subtitle" role="status">{entityError}</p>}

            <div className="search-filter-pills" role="tablist" aria-label="Search filter">
              <button
                type="button"
                role="tab"
                id="search-filter-songs"
                aria-controls="search-results-panel"
                aria-selected={activeFilter === "songs"}
                className={`search-filter-pill ${activeFilter === "songs" ? "is-active" : ""}`}
                onClick={() => onStateChange((current) => ({ ...current, filter: "songs" }))}
              >
                <span>Songs</span>
                {results.length > 0 && <span className="search-pill-count">{results.length}</span>}
              </button>
              <button
                type="button"
                role="tab"
                id="search-filter-albums"
                aria-controls="search-results-panel"
                aria-selected={activeFilter === "albums"}
                className={`search-filter-pill ${activeFilter === "albums" ? "is-active" : ""}`}
                onClick={() => onStateChange((current) => ({ ...current, filter: "albums" }))}
              >
                <span>Albums</span>
                {albums.length > 0 && <span className="search-pill-count">{albums.length}</span>}
              </button>
              <button
                type="button"
                role="tab"
                id="search-filter-artists"
                aria-controls="search-results-panel"
                aria-selected={activeFilter === "artists"}
                className={`search-filter-pill ${activeFilter === "artists" ? "is-active" : ""}`}
                onClick={() => onStateChange((current) => ({ ...current, filter: "artists" }))}
              >
                <span>Artists</span>
                {artists.length > 0 && <span className="search-pill-count">{artists.length}</span>}
              </button>
            </div>

            <div
              id="search-results-panel"
              role="tabpanel"
              aria-labelledby={`search-filter-${activeFilter}`}
            >
              {activeFilter === "songs" && (
                results.length > 0 ? (
                  <>
                    <div className="track-header">
                      <span>#</span>
                      <span>TRACK / ARTIST</span>
                      <span>ALBUM</span>
                      <span>TIME</span>
                      <span />
                    </div>
                    <div className="track-list">
                      {results.map((t, index) => {
                        const music = t;
                        return (
                          <div
                            className="track-row"
                            key={t.id}
                            onClick={(e) => {
                              if (busy || !ytdlpAvailable || (e.target as HTMLElement).closest("button, a, summary, details, input, .track-actions, .menu-popover")) return;
                              onSaveDiscovery(t, "play");
                            }}
                          >
                            <button
                              className="track-play"
                              aria-label={`Play ${music.title}`}
                              disabled={busy || !ytdlpAvailable}
                              onClick={() => onSaveDiscovery(t, "play")}
                            >
                              <span className="track-index">
                                {String(index + 1).padStart(2, "0")}
                              </span>
                              <Play className="row-play" size={15} />
                            </button>
                            <div className="track-meta">
                              <Artwork
                                url={t.artworkUrl}
                                className={`color-${index % 5}`}
                              />
                              <span className="track-meta-text">
                                <button className="track-title-button" aria-label={`Listen to ${music.title}`} disabled={busy || !ytdlpAvailable} onClick={() => onSaveDiscovery(t, "play")}>
                                  <strong dir="auto" title={t.title}>{music.title}</strong>
                                </button>
                                <small dir="auto">
                                  {t.artists && t.artists.length > 0 && onNavigateArtist ? (
                                    <>
                                      {t.artists.map((artist, idx) => (
                                        <span key={idx}>
                                          {idx > 0 && ", "}
                                          {artist.id ? (
                                            <button
                                              className="link-button"
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                onNavigateArtist(artist.id!);
                                              }}
                                            >
                                              {artist.name}
                                            </button>
                                          ) : (
                                            artist.name
                                          )}
                                        </span>
                                      ))}
                                    </>
                                  ) : (
                                    music.artist
                                  )}
                                </small>
                              </span>
                            </div>
                            <span className="album ellipsis" title={music.album}>
                              {t.albumId && onNavigateAlbum && music.album ? (
                                <button
                                  className="link-button"
                                  onClick={() => onNavigateAlbum(t.albumId!)}
                                >
                                  {music.album}
                                </button>
                              ) : (
                                music.album || "—"
                              )}
                            </span>
                            <span className="duration">
                              {t.duration ? clock(t.duration) : "—"}
                            </span>
                            <div className="track-actions">
                              <CatalogTrackActions track={t} savedTracks={savedTracks} favorites={favorites} onCatalogAction={onCatalogAction} disabled={busy || !ytdlpAvailable} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <p className="library-footer">
                      <span className="small-dot" /> Music catalogue · {results.length} tracks
                    </p>
                  </>
                ) : (
                  <p className="subtitle">No song results for this search.</p>
                )
              )}

              {activeFilter === "albums" && (
                albums.length > 0 ? (
                  <div className="search-albums-grid">
                    {albums.map((album) => (
                      <button
                        key={album.id}
                        type="button"
                        className="album-card"
                        aria-label={`Open album ${album.title}`}
                        onClick={() => onNavigateAlbum?.(album.id)}
                      >
                        <Artwork url={album.artworkUrl} className="album-card-cover" />
                        <div className="album-card-info">
                          <div className="album-title" title={album.title}>{album.title}</div>
                          <div className="album-year" title={`${album.artist}${album.year != null ? ` · ${album.year}` : ""}`}>
                            {album.artist}{album.year != null ? ` · ${album.year}` : ""}
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="subtitle">No album results for this search.</p>
                )
              )}

              {activeFilter === "artists" && (
                artists.length > 0 ? (
                  <div className="search-artists-grid">
                    {artists.map((artist) => (
                      <button
                        key={artist.id}
                        type="button"
                        className="search-artist-card"
                        aria-label={`Open artist ${artist.name}`}
                        onClick={() => onNavigateArtist?.(artist.id)}
                      >
                        <Artwork url={artist.artworkUrl} kind="artist" />
                        <span className="search-artist-name" title={artist.name}>{artist.name}</span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="subtitle">No artist results for this search.</p>
                )
              )}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
