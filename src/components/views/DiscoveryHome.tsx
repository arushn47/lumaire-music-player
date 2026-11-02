import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Play } from 'lucide-react';
import { DISCOVERY_PREFERENCES_CHANGED, discoveryPreferences } from '../../adapters/discovery-home';
import { loadQuickPickPool, quickPickTracks } from '../../adapters/quick-picks';
import { quickPickSeeds, sameRecommendation, type QuickPickCandidate } from '../../domain/quick-picks';
import { homeHistory } from '../../domain/home-listening';
import type { ListeningRecord } from '../../domain/listening';
import type { ListeningResume, Track } from '../../domain/types';
import type { CatalogTrack } from '../../adapters/native';
import { Artwork, ArtistLinks, DownloadedBadge } from '../common';
import { CloseTrackMenu } from '../common/CloseTrackMenu';
export interface DiscoveryHomeProps {
  mobile?: boolean;
  onPlayAlbum: (id: string) => Promise<void>;
  onPlayQuickPick: (track: Track) => void;
  searches: string[];
  records: ListeningRecord[];
  resumes?: ListeningResume[];
  onResume?: (id: string) => void;
  savedTracks: Track[];
  busy: boolean;
  onlineAvailable: boolean;
  onSearch: (query: string) => void;
  onClearSearches: () => void;
  onReplay: (record: ListeningRecord) => void;
  onImportMusic?: () => void;
  onOpenLibrary?: () => void;
  onOpenTracker?: () => void;
  onNavigateAlbum?: (id: string) => void;
  onNavigateArtist?: (id: string) => void;
  onSaveDiscovery?: (track: CatalogTrack, mode: "play" | "save" | "next" | "queue") => void;
  favorites?: string[];
  favoriteArtists?: string[];
  favoriteAlbums?: string[];
  downloads?: Record<string, string>;
  onCatalogAction?: (track: CatalogTrack, action: any) => void;
  onFavorite?: (track: Track) => void;
  onQueueTrack?: (track: Track, next?: boolean) => void;
  onSaveOnline?: (track: Track) => void;
  onChoosePlaylist?: (track: Track) => void;
}


function emptyShelf(title: string, message: string) {
  return <section aria-label={title} className="discover-home-section home-shelf-empty"><h2>{title}</h2><p className="subtitle">{message}</p></section>;
}
function TrackContextMenu({
  track,
  isFavorite,
  isSaved,
  onQueueTrack,
  onFavorite,
  onChoosePlaylist,
  onSaveOnline,
}: {
  track: Track;
  isFavorite: boolean;
  isSaved: boolean;
  onQueueTrack?: (track: Track, next?: boolean) => void;
  onFavorite?: (track: Track) => void;
  onChoosePlaylist?: (track: Track) => void;
  onSaveOnline?: (track: Track) => void;
}) {
  return (
    <details className="track-menu context-track-menu" onClick={(e) => { e.stopPropagation(); if ((e.target as Element).closest(".menu-popover button")) e.currentTarget.open = false; }}>
      <summary tabIndex={-1} aria-hidden="true" style={{ display: "none" }} />
      <div className="menu-popover">
        <CloseTrackMenu />
        {onQueueTrack && (
          <>
            <button type="button" onClick={() => onQueueTrack(track, true)}>Play next</button>
            <button type="button" onClick={() => onQueueTrack(track)}>Add to queue</button>
          </>
        )}
        {onFavorite && (
          <button type="button" onClick={() => onFavorite(track)}>
            {isFavorite ? "Remove from favorites" : "Add to favorites"}
          </button>
        )}
        {onChoosePlaylist && (
          <button type="button" onClick={() => onChoosePlaylist(track)}>Save to playlist</button>
        )}
        {onSaveOnline && !isSaved && (
          <button type="button" onClick={() => onSaveOnline(track)}>Save to library</button>
        )}
      </div>
    </details>
  );
}

function TrackShelf({
  title,
  tracks,
  savedTracks = [],
  favorites = [],
  onPlay,
  onOpen,
  emptyMessage,
  onFavorite,
  onQueueTrack,
  onSaveOnline,
  onChoosePlaylist,
  onNavigateArtist,
}: {
  title: string;
  tracks: Track[];
  savedTracks?: Track[];
  favorites?: string[];
  onPlay: (track: Track) => void;
  onOpen?: () => void;
  emptyMessage?: string;
  onFavorite?: (track: Track) => void;
  onQueueTrack?: (track: Track, next?: boolean) => void;
  onSaveOnline?: (track: Track) => void;
  onChoosePlaylist?: (track: Track) => void;
  onNavigateArtist?: (id: string) => void;
}) {
  const scroll = useRef<HTMLDivElement>(null);
  if (!tracks.length) return emptyMessage ? emptyShelf(title, emptyMessage) : null;
  return <section aria-label={title} className="discover-home-section recent-played-section">
    <div className="recent-section-heading">{onOpen ? <button type="button" className="recent-heading-btn" onClick={onOpen}><h2>{title}</h2><ChevronRight size={18} /></button> : <h2>{title}</h2>}<div className="recent-section-nav">{[-1, 1].map(direction => <button type="button" className="discover-nav-arrow" key={direction} aria-label={(direction < 0 ? 'Previous ' : 'Next ') + title} onClick={() => scroll.current?.scrollBy({ left: direction * scroll.current.clientWidth * .85, behavior: 'smooth' })}>{direction < 0 ? <ChevronLeft size={14} /> : <ChevronRight size={14} />}</button>)}</div></div>
    <div className="recent-tracks-grid" ref={scroll} style={{ gridTemplateRows: `repeat(${Math.min(4, tracks.length)}, var(--recent-row-height, 52px))` }}>{tracks.map(track => {
      const isFav = favorites.includes(track.id);
      const isSaved = savedTracks.some(s => s.id === track.id || (track.metadataSourceId && s.metadataSourceId === track.metadataSourceId));
      return (
        <div role="button" tabIndex={0} key={track.id} className="recent-track-item" aria-label={'Play ' + track.title} title={'Play ' + track.title} onClick={() => onPlay(track)} onKeyDown={(e) => { if (e.target !== e.currentTarget) return; if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPlay(track); } }}>
          <div className="recent-track-art-wrap"><Artwork url={track.artworkUrl} className="recent-track-art" /><div className="recent-track-play-badge" aria-hidden="true"><Play size={14} fill="currentColor" /></div></div>
          <div className="recent-track-details"><div className="recent-track-title">{track.title}</div><div className="recent-track-artist"><DownloadedBadge track={track} /><ArtistLinks artistString={track.artist} catalogId={track.metadataSourceId || track.id} onNavigateArtist={onNavigateArtist} /></div></div>
          <TrackContextMenu track={track} isFavorite={isFav} isSaved={isSaved} onQueueTrack={onQueueTrack} onFavorite={onFavorite} onChoosePlaylist={onChoosePlaylist} onSaveOnline={onSaveOnline} />
        </div>
      );
    })}</div></section>;
}

function RotationShelf({
  tracks,
  savedTracks = [],
  favorites = [],
  onPlay,
  onFavorite,
  onQueueTrack,
  onSaveOnline,
  onChoosePlaylist,
  onNavigateArtist,
}: {
  tracks: Track[];
  savedTracks?: Track[];
  favorites?: string[];
  onPlay: (track: Track) => void;
  onFavorite?: (track: Track) => void;
  onQueueTrack?: (track: Track, next?: boolean) => void;
  onSaveOnline?: (track: Track) => void;
  onChoosePlaylist?: (track: Track) => void;
  onNavigateArtist?: (id: string) => void;
}) {
  const scroll = useRef<HTMLDivElement>(null);
  if (!tracks.length) return null;
  return <section aria-label="Your Rotation" className="discover-home-section">
    <div className="discover-section-heading"><div><h2>Your Rotation</h2><p className="subtitle">The songs you keep coming back to.</p></div><div className="recent-section-nav">{[-1, 1].map(direction => <button type="button" className="discover-nav-arrow" key={direction} aria-label={(direction < 0 ? 'Previous ' : 'Next ') + 'Your Rotation'} onClick={() => scroll.current?.scrollBy({ left: direction * scroll.current.clientWidth * .85, behavior: 'smooth' })}>{direction < 0 ? <ChevronLeft size={14} /> : <ChevronRight size={14} />}</button>)}</div></div>
    <div className="discover-albums discover-rotation-carousel" ref={scroll}>{tracks.map(track => {
      const isFav = favorites.includes(track.id);
      const isSaved = savedTracks.some(s => s.id === track.id || (track.metadataSourceId && s.metadataSourceId === track.metadataSourceId));
      return (
        <div role="button" tabIndex={0} key={track.id} className="discover-album-card" aria-label={'Play ' + track.title} title={'Play ' + track.title} onClick={() => onPlay(track)} onKeyDown={(e) => { if (e.target !== e.currentTarget) return; if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPlay(track); } }}>
          <div className="album-card-cover-wrap"><Artwork url={track.artworkUrl} className="cover" /><div className="album-hover-play"><Play size={18} fill="currentColor" /></div></div><strong className="album-title">{track.title}</strong><span className="subtitle"><DownloadedBadge track={track} /><ArtistLinks artistString={track.artist} catalogId={track.metadataSourceId || track.id} onNavigateArtist={onNavigateArtist} /></span>
          <TrackContextMenu track={track} isFavorite={isFav} isSaved={isSaved} onQueueTrack={onQueueTrack} onFavorite={onFavorite} onChoosePlaylist={onChoosePlaylist} onSaveOnline={onSaveOnline} />
        </div>
      );
    })}</div>
  </section>;
}
function ContinueShelf({ resumes, savedTracks, onResume }: { resumes: ListeningResume[]; savedTracks: Track[]; onResume?: (id: string) => void }) {
  const scroll = useRef<HTMLDivElement>(null);
  if (!resumes.length) return null;
  return <section aria-label="Continue Listening" className="discover-home-section">
    <div className="discover-section-heading"><h2>Continue Listening</h2><div className="recent-section-nav">{[-1, 1].map(direction => <button type="button" className="discover-nav-arrow" key={direction} aria-label={(direction < 0 ? 'Previous ' : 'Next ') + 'Continue Listening'} onClick={() => scroll.current?.scrollBy({ left: direction * scroll.current.clientWidth * .85, behavior: 'smooth' })}>{direction < 0 ? <ChevronLeft size={14} /> : <ChevronRight size={14} />}</button>)}</div></div>
    <div className="discover-albums discover-rotation-carousel" ref={scroll}>{resumes.map(item => {
      const current = item.queue.find(entry => entry.id === item.currentId);
      const track = current && (savedTracks.find(track => track.id === current.trackId) || item.queueTracks[current.trackId]);
      return <button type="button" className="discover-album-card" key={item.id} onClick={() => onResume?.(item.id)} aria-label={'Resume ' + item.title}><div className="album-card-cover-wrap"><Artwork url={track?.artworkUrl} className="cover" /><div className="album-hover-play"><Play size={18} fill="currentColor" /></div></div><strong className="album-title">{item.title}</strong><span className="subtitle">{item.kind} · Track {item.queue.findIndex(entry => entry.id === item.currentId) + 1} of {item.queue.length} · {Math.floor(item.position / 60)}:{String(Math.floor(item.position % 60)).padStart(2, '0')}</span></button>;
    })}</div>
  </section>;
}
export function DiscoveryHome({ mobile = false, records, savedTracks, onlineAvailable, favorites = [], favoriteArtists = [], favoriteAlbums = [], resumes = [], onResume, onPlayQuickPick, onOpenTracker, onFavorite, onQueueTrack, onSaveOnline, onChoosePlaylist, onNavigateArtist }: DiscoveryHomeProps) {
  const [languages, setLanguages] = useState(() => discoveryPreferences().languages);
  const [pool, setPool] = useState<QuickPickCandidate[]>([]);
  const languageKey = languages.join(',');
  useEffect(() => {
    const changed = () => setLanguages(discoveryPreferences().languages);
    window.addEventListener(DISCOVERY_PREFERENCES_CHANGED, changed);
    return () => window.removeEventListener(DISCOVERY_PREFERENCES_CHANGED, changed);
  }, []);
  const historyKey = records.map(record => record.id + ':' + (record.listenedMs >= 10000) + ':' + Math.floor(record.listenedMs / 180000)).join(',');
  const activityKey = records.map(record => record.id + ':' + record.startedAt + ':' + record.updatedAt + ':' + record.listenedMs).join(',');
  const favoritesKey = JSON.stringify([favorites, favoriteArtists, favoriteAlbums]);
  const preferences = useMemo(() => ({ records, favorites, languages, favoriteArtists, favoriteAlbums }), [historyKey, favoritesKey, languageKey]);
  const seeds = useMemo(() => quickPickSeeds(savedTracks, preferences), [savedTracks, preferences]);
  const seedKey = seeds.map(track => track.metadataSourceId || track.id).join(',');
  useEffect(() => {
    let active = true;
    setPool([]);
    if (onlineAvailable) void loadQuickPickPool(languages, seeds, () => active).then(value => { if (active) setPool(value); }).catch(() => {});
    return () => { active = false; };
  }, [languageKey, seedKey, onlineAvailable]);
  const history = useMemo(() => homeHistory(records, savedTracks, favorites, onlineAvailable), [activityKey, savedTracks, favoritesKey, onlineAvailable]);
  const continuing = resumes.filter(item => item.queue.every(entry => {
    const track = savedTracks.find(track => track.id === entry.trackId) || item.queueTracks[entry.trackId];
    return track && !track.missing && (onlineAvailable || track.offline || (track.source?.providerId !== 'youtube' && track.format !== 'catalog'));
  }));
  const continuedTracks = continuing.map(item => {
    const entry = item.queue.find(entry => entry.id === item.currentId);
    return entry && (savedTracks.find(track => track.id === entry.trackId) || item.queueTracks[entry.trackId]);
  }).filter((track): track is Track => !!track);
  const exclusive = (tracks: Track[]) => tracks.filter(track => !continuedTracks.some(other => sameRecommendation({ track }, { track: other })));
  const reserved = [...history.recent, ...history.rotation, ...history.forgotten, ...continuedTracks];
  const picks = useMemo(() => quickPickTracks([...savedTracks.map(track => ({ track })), ...pool].filter(candidate => !reserved.some(track => sameRecommendation(candidate, { track }))), preferences, onlineAvailable), [savedTracks, pool, preferences, onlineAvailable, history, resumes]);
  const hour = new Date().getHours();
  const greeting = hour >= 5 && hour < 12 ? 'Good morning' : hour < 18 && hour >= 12 ? 'Good afternoon' : hour >= 18 && hour < 22 ? 'Good evening' : 'Good night';
  return <div className="discovery-home">
    <div className="discover-greeting-header"><h1 className="discover-greeting-title">{greeting}<span className="discover-greeting-dot">.</span></h1><p className="discover-greeting-subtitle">Music for a calmer, brighter you.</p></div>
    <TrackShelf title="Recently Played" tracks={history.recent} savedTracks={savedTracks} favorites={favorites} onPlay={onPlayQuickPick} onOpen={onOpenTracker} onFavorite={onFavorite} onQueueTrack={onQueueTrack} onSaveOnline={onSaveOnline} onChoosePlaylist={onChoosePlaylist} onNavigateArtist={!mobile ? onNavigateArtist : undefined} />
    <ContinueShelf resumes={continuing} savedTracks={savedTracks} onResume={onResume} />
    <TrackShelf title="Quick Picks" tracks={picks} savedTracks={savedTracks} favorites={favorites} onPlay={onPlayQuickPick} emptyMessage={mobile ? 'Save or play music to shape your recommendations.' : undefined} onFavorite={onFavorite} onQueueTrack={onQueueTrack} onSaveOnline={onSaveOnline} onChoosePlaylist={onChoosePlaylist} onNavigateArtist={!mobile ? onNavigateArtist : undefined} />
    <RotationShelf tracks={exclusive(history.rotation)} savedTracks={savedTracks} favorites={favorites} onPlay={onPlayQuickPick} onFavorite={onFavorite} onQueueTrack={onQueueTrack} onSaveOnline={onSaveOnline} onChoosePlaylist={onChoosePlaylist} onNavigateArtist={!mobile ? onNavigateArtist : undefined} />
    <TrackShelf title="Forgotten Favorites" tracks={exclusive(history.forgotten)} savedTracks={savedTracks} favorites={favorites} onPlay={onPlayQuickPick} onFavorite={onFavorite} onQueueTrack={onQueueTrack} onSaveOnline={onSaveOnline} onChoosePlaylist={onChoosePlaylist} onNavigateArtist={!mobile ? onNavigateArtist : undefined} />
  </div>;
}
