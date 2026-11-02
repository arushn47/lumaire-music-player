import { QueueDragHandle } from "../common/QueueDragHandle";
import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  ChevronDown,
  Disc3,
  ListMusic,
  Shuffle,
  SkipBack,
  Play,
  Pause,
  SkipForward,
  Repeat,
  Repeat1,
  Heart,
  X,
  Ellipsis,
  Loader2,
  Volume2,
  VolumeX,
} from "lucide-react";
import { AmbientBackground } from "../common/AmbientBackground";
import { Artwork } from "../common/Artwork";
import { ArtistLinks } from "../common/ArtistLinks";
import { DownloadedBadge } from "../common/DownloadedBadge";
import { CloseTrackMenu } from '../common/CloseTrackMenu';
import { TrackActionMenuItems } from "./PlayerBar";
import { usePlayerSwipe } from "../../hooks/usePlayerSwipe";
import type { Track, Session, Preferences, LyricDocument } from "../../domain/types";
import type { Playback } from "../../player/controller";
import { playbackQueue } from "../../domain/queue";
import "./mobile-now-playing.css";

export interface MobileNowPlayingProps {
  onWrongVersion?: () => void;
  manageHistory?: boolean;
  initialTab?: "player" | "queue";
  track?: Track | null;
  tracks: Track[];
  session: Session;
  playback: Playback;
  downloads?: Record<string, string>;
  busy?: boolean;
  onClose: () => void;
  onTogglePlay: () => void;
  onSkip: (delta: 1 | -1) => void;
  onSeek: (seconds: number) => void;
  onFavorite: (trackId: string) => void;
  onSetting: <K extends keyof Preferences>(key: K, value: Preferences[K]) => void;
  onNavigateArtist: (artistId: string) => void;
  onChoosePlaylist?: (track: Track) => void;
  onDownloadTrack?: (track: Track) => void;
  onDeleteOffline?: (track: Track) => void;
  onSaveOnline?: (track: Track) => void;
  onCancelDownload?: (trackId: string) => void;
  onSelectQueue: (entryId: string, play: boolean) => void;
  onReorderUpcoming: (entryId: string, delta: number) => void;
  onRemoveQueue: (entryId: string) => void;
  onClearQueue: () => void;
  onUndoRemoval?: () => void;
  undo?: Session["queue"] | null;
  doc?: LyricDocument | null;
  sessionVolume?: number;
}

const clock = (s: number) => {
  const safe = Number.isFinite(s) ? Math.max(0, s) : 0;
  const mins = Math.floor(safe / 60);
  const secs = Math.floor(safe % 60);
  return `${mins}:${String(secs).padStart(2, "0")}`;
};

export function MobileNowPlaying({
  onWrongVersion,
  manageHistory = true,
  initialTab = "player",
  track,
  tracks,
  session,
  playback,
  downloads = {},
  busy = false,
  onClose,
  onTogglePlay,
  onSkip,
  onSeek,
  onFavorite,
  onSetting,
  onNavigateArtist,
  onChoosePlaylist,
  onDownloadTrack,
  onDeleteOffline,
  onSaveOnline,
  onCancelDownload,
  onSelectQueue,
  onReorderUpcoming,
  onRemoveQueue,
  onClearQueue,
  onUndoRemoval,
  undo,
  sessionVolume = 0.72,
}: MobileNowPlayingProps) {
  const [activeTab, setActiveTab] = useState(initialTab);
  useEffect(() => { setActiveTab(initialTab); }, [initialTab]);
  const [showRemaining, setShowRemaining] = useState(false);
  const [scrubbingTime, setScrubbingTime] = useState<number | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const artworkRef = useRef<HTMLDivElement>(null);
  const queueRef = useRef<HTMLElement>(null);
  const closingRef = useRef(false);
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Smooth dismiss handler that respects history stack
  const handleDismiss = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    onCloseRef.current();
  }, []);

  // Handle hardware / gesture Android back button via History API
  useEffect(() => {
    const marker = Date.now();
    if (manageHistory) window.history.pushState({ ...window.history.state, mobileNowPlaying: marker }, "");
    const onPopState = () => {
      handleDismiss();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.querySelector("dialog[open], details.track-menu[open]")) handleDismiss();
    };
    if (manageHistory) window.addEventListener("popstate", onPopState);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      clearTimeout(dismissTimer.current);
      window.removeEventListener("popstate", onPopState);
      window.removeEventListener("keydown", onKeyDown);
      if (manageHistory && window.history.state?.mobileNowPlaying === marker) window.history.back();
    };
  }, [handleDismiss, manageHistory]);

  const swipes = usePlayerSwipe({
    up: () => setActiveTab("queue"),
    down: () => {
      if (activeTab === "queue") { setActiveTab("player"); return; }
      if (containerRef.current) containerRef.current.style.transform = `translateY(${innerHeight}px)`;
      dismissTimer.current = setTimeout(handleDismiss, matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 220);
    },
    left: () => { if (activeTab === "player" && track) onSkip(1); },
    right: () => { if (activeTab === "player" && track) onSkip(-1); },
    drag: (x, y) => {
      clearTimeout(dismissTimer.current);
      if (activeTab === "player" && Math.abs(x) > Math.abs(y) * 1.2 && artworkRef.current) {
        artworkRef.current.style.transform = `translateX(${x}px)`;
        return;
      }
      if (Math.abs(y) <= Math.abs(x) * 1.2) return;
      if (activeTab === "player" && y > 0 && containerRef.current) {
        containerRef.current.style.transition = "none";
        containerRef.current.style.transform = `translateY(${y}px)`;
      } else if (queueRef.current && ((activeTab === "player" && y < 0) || (activeTab === "queue" && y > 0))) {
        const panel = queueRef.current;
        panel.style.transition = "none";
        panel.style.visibility = "visible";
        panel.style.transform = `translateY(${Math.max(0, activeTab === "queue" ? y : panel.clientHeight + y)}px)`;
      }
    },
    reset: () => {
      if (artworkRef.current) artworkRef.current.style.transform = "";
      if (containerRef.current) { containerRef.current.style.transition = ""; containerRef.current.style.transform = ""; }
      if (queueRef.current) { queueRef.current.style.transition = ""; queueRef.current.style.transform = ""; queueRef.current.style.visibility = ""; }
    },
  });

  const isFavorite = track ? session.favorites.includes(track.id) : false;
  const isPlaying = playback.status === "playing";
  const isLoading = playback.status === "loading" || playback.status === "buffering";
  const duration = playback.duration || 1;
  const currentTime = scrubbingTime !== null ? scrubbingTime : playback.time;
  const progressPercent = Math.min(100, Math.max(0, (currentTime / duration) * 100));

  // Compute queue items
  const queue = playbackQueue(session);
  const currentIndex = queue.findIndex((entry) => entry.id === session.currentId);
  const upcomingQueue = currentIndex >= 0 ? queue.slice(currentIndex + 1) : queue;

  return (
    <div
      ref={containerRef}
      className="mobile-now-playing"
      role="dialog"
      aria-modal="true"
      aria-label="Now Playing"
      {...swipes}
      data-theme={session.settings.themeMode}
      data-accent={session.settings.accentColor}
    >
      {/* Dynamic blurred ambient background layer */}
      <AmbientBackground artwork={track?.artworkUrl} />
      <div className="mobile-np-scrim" />

      {/* Top Drag Handle & Safe Area */}
      <div
        className="mobile-np-drag-zone"
      >
        <div className="mobile-np-drag-pill" />
      </div>

      {/* Header Bar: Chevron Collapse + Segmented Tab Switcher + Action Button */}
      <header className="mobile-np-header">
        <button
          type="button"
          className="mobile-np-icon-btn mobile-np-collapse-btn"
          aria-label="Collapse player"
          onClick={handleDismiss}
        >
          <ChevronDown size={26} />
        </button>

        <button type="button" className="mobile-np-context" onClick={() => setActiveTab("player")} aria-label={activeTab === "player" ? "Now playing" : "Back to song"}>
          <span>{activeTab === "queue" ? "Up next" : "Now playing"}</span>
          <small>{track?.album || "Your music"}</small>
        </button>

        {track ? (
          <details className="track-menu">
            <summary className="mobile-np-icon-btn" aria-label="Current song actions"><Ellipsis size={22}/></summary>
            <div className="menu-popover">
              <CloseTrackMenu />
              <TrackActionMenuItems
                onWrongVersion={onWrongVersion}
                track={track}
                tracks={tracks}
                busy={busy}
                session={session}
                downloads={downloads}
                onSaveOnline={onSaveOnline ?? (() => {})}
                onChoosePlaylist={onChoosePlaylist ?? (() => {})}
                onFavorite={onFavorite}
                onCancelDownload={onCancelDownload ?? (() => {})}
                onDownloadTrack={onDownloadTrack ?? (() => {})}
                onDeleteOffline={onDeleteOffline ?? (() => {})}
              />
            </div>
          </details>
        ) : (
          <div className="mobile-np-header-placeholder" />
        )}
      </header>

      {/* View 1: Main Song / Player View */}
      {activeTab === "player" && (
        <main className="mobile-np-main-view">
          {/* Centered Large Album Artwork */}
          <div className="mobile-np-artwork-container">
            <div ref={artworkRef} className={`mobile-np-artwork-card ${isPlaying ? "is-playing" : "is-paused"}`}>
              <Artwork url={track?.artworkUrl} className="mobile-np-artwork-img" />
            </div>
          </div>

          {/* Track Identity & Favorite Row */}
          <div className="mobile-np-identity-row">
            <div className="mobile-np-text-block">
              <strong className="mobile-np-title" dir="auto">
                {track?.title || "Choose a song to play"}
              </strong>
              <div className="mobile-np-artist-line">
                <DownloadedBadge track={track || undefined} />
                <ArtistLinks
                  catalogId={track?.metadataSourceId}
                  className="mobile-np-artist"
                  artistString={track?.artist || "Unknown artist"}
                  onNavigateArtist={(id) => {
                    handleDismiss();
                    onNavigateArtist(id);
                  }}
                  maxArtists={2}
                />
              </div>
            </div>

            <div className="mobile-np-identity-actions">
              <button
                type="button"
                className={`mobile-np-fav-btn ${isFavorite ? "is-favorite" : ""}`}
                aria-label={isFavorite ? "Remove favorite" : "Save to favorites"}
                aria-pressed={isFavorite}
                onClick={() => track && onFavorite(track.id)}
              >
                <Heart
                  size={24}
                  fill={isFavorite ? "var(--accent)" : "none"}
                  color={isFavorite ? "var(--accent)" : "currentColor"}
                />
              </button>
            </div>
          </div>

          {/* Seek Bar Scrubber & Time */}
          <div className="mobile-np-scrubber-section">
            <div className="mobile-np-slider-wrap">
              <input
                type="range"
                className="mobile-np-seek-slider"
                min={0}
                max={duration}
                step={0.1}
                disabled={!playback.duration}
                value={currentTime}
                style={{ "--seek-percent": `${progressPercent}%` } as React.CSSProperties}
                onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); setScrubbingTime(playback.time); }}
                onChange={(e) => setScrubbingTime(Number(e.target.value))}
                onPointerUp={(event) => { onSeek(Number(event.currentTarget.value)); setScrubbingTime(null); }}
                onPointerCancel={() => setScrubbingTime(null)}
                onKeyUp={(event) => { if (["ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown"].includes(event.key)) { onSeek(Number(event.currentTarget.value)); setScrubbingTime(null); } }}
                aria-label="Seek track position"
              />
            </div>

            <div className="mobile-np-time-row">
              <span className="mobile-np-time elapsed">{clock(currentTime)}</span>
              <button
                type="button"
                className="mobile-np-time duration-toggle"
                onClick={() => setShowRemaining((s) => !s)}
                aria-label={showRemaining ? "Show total duration" : "Show remaining time"}
              >
                {showRemaining
                  ? `−${clock(Math.max(0, duration - currentTime))}`
                  : clock(duration)}
              </button>
            </div>
          </div>

          {/* Transport Controls (YouTube Music + Apple Layout) */}
          <div className="mobile-np-transport-row">
            <button
              type="button"
              className={`mobile-np-ctrl-btn ${session.settings.shuffle ? "is-active" : ""}`}
              aria-label="Toggle shuffle"
              onClick={() => onSetting("shuffle", !session.settings.shuffle)}
            >
              <Shuffle size={20} />
              {session.settings.shuffle && <span className="mobile-np-dot-active" />}
            </button>

            <button
              type="button"
              className="mobile-np-ctrl-btn mobile-np-skip"
              disabled={!track}
              aria-label="Previous track"
              onClick={() => onSkip(-1)}
            >
              <SkipBack size={26} fill="currentColor" />
            </button>

            <button
              type="button"
              className={`mobile-np-play-button ${isLoading ? "is-loading" : ""}`}
              disabled={isLoading || (!track && !tracks.length)}
              aria-label={isLoading ? "Loading" : isPlaying ? "Pause" : "Play"}
              onClick={onTogglePlay}
            >
              {isLoading ? (
                <Loader2 size={32} className="spin" />
              ) : isPlaying ? (
                <Pause size={30} fill="currentColor" />
              ) : (
                <Play size={30} fill="currentColor" style={{ marginLeft: "3px" }} />
              )}
            </button>

            <button
              type="button"
              className="mobile-np-ctrl-btn mobile-np-skip"
              disabled={!track}
              aria-label="Next track"
              onClick={() => onSkip(1)}
            >
              <SkipForward size={26} fill="currentColor" />
            </button>

            <button
              type="button"
              className={`mobile-np-ctrl-btn ${session.settings.repeat !== "off" ? "is-active" : ""}`}
              aria-label={`Repeat mode: ${session.settings.repeat}`}
              onClick={() =>
                onSetting(
                  "repeat",
                  session.settings.repeat === "off"
                    ? "all"
                    : session.settings.repeat === "all"
                      ? "one"
                      : "off",
                )
              }
            >
              {session.settings.repeat === "one" ? <Repeat1 size={20} /> : <Repeat size={20} />}
              {session.settings.repeat !== "off" && <span className="mobile-np-dot-active" />}
            </button>
          </div>
        </main>
      )}

      {/* View 3: Queue View (Up Next) */}
        <section ref={queueRef} className={`mobile-np-queue-tab ${activeTab === "queue" ? "is-open" : ""}`} aria-hidden={activeTab !== "queue"} inert={activeTab !== "queue"} aria-label="Playback queue">
          <div className="mobile-np-queue-header">
            <div className="mobile-np-queue-title-wrap">
              <h2>Up next</h2>
              <span className="mobile-np-queue-badge">{upcomingQueue.length}</span>
            </div>
            {upcomingQueue.length > 0 && (
              <button
                type="button"
                className="mobile-np-clear-btn"
                onClick={onClearQueue}
              >
                Clear queue
              </button>
            )}
          </div>

          {/* Autoplay Row (YouTube Music Up Next pattern) */}
          <div className="mobile-np-autoplay-row">
            <div className="mobile-np-autoplay-info">
              <span className="mobile-np-autoplay-title">Auto-play</span>
              <span className="mobile-np-autoplay-desc">
                {session.settings.autoplay
                  ? "Auto-play is on · Add similar content to queue"
                  : "Add similar content to the end of the queue"}
              </span>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={session.settings.autoplay}
              className={`mobile-np-toggle-switch ${session.settings.autoplay ? "is-on" : ""}`}
              onClick={() => onSetting("autoplay", !session.settings.autoplay)}
              aria-label="Toggle autoplay"
            >
              <span className="mobile-np-switch-thumb" />
            </button>
          </div>

          {undo && onUndoRemoval && (
            <div className="mobile-np-undo-bar">
              <span>Track removed from queue</span>
              <button type="button" onClick={onUndoRemoval}>
                Undo
              </button>
            </div>
          )}

          <div className="mobile-np-queue-scroll" data-queue-list>
            {/* Current Song */}
            {track && (
              <div className="mobile-np-queue-item current">
                <Artwork url={track.artworkUrl} className="mobile-np-queue-thumb" />
                <div className="mobile-np-queue-info">
                  <strong dir="auto">{track.title}</strong>
                  <small>
                    <span className="mobile-np-now-playing-pill">Now playing</span>
                    {" · "}
                    <ArtistLinks
                      catalogId={track.metadataSourceId}
                      artistString={track.artist}
                      onNavigateArtist={(id) => {
                        handleDismiss();
                        onNavigateArtist(id);
                      }}
                      maxArtists={2}
                    />
                  </small>
                </div>
              </div>
            )}

            {/* Upcoming Songs */}
            {upcomingQueue.length === 0 ? (
              <div className="mobile-np-empty-queue">
                <ListMusic size={36} />
                <p>No upcoming tracks in queue</p>
                <small>Select any song or album to queue it up next.</small>
              </div>
            ) : (
              upcomingQueue.map((entry) => {
                const itemTrack = tracks.find((t) => t.id === entry.trackId) || session.queueTracks[entry.trackId];
                if (!itemTrack) return null;

                return (
                  <div key={entry.id} className="mobile-np-queue-item" data-queue-entry={entry.id}>
                    <button
                      type="button"
                      className="mobile-np-queue-item-main"
                      onClick={() => onSelectQueue(entry.id, true)}
                    >
                      <Artwork url={itemTrack.artworkUrl} className="mobile-np-queue-thumb" />
                      <div className="mobile-np-queue-info">
                        <strong dir="auto">{itemTrack.title}</strong>
                        <small>
                          <ArtistLinks
                            catalogId={itemTrack.metadataSourceId}
                            artistString={itemTrack.artist}
                            onNavigateArtist={(id) => {
                              handleDismiss();
                              onNavigateArtist(id);
                            }}
                            maxArtists={2}
                          />
                        </small>
                      </div>
                    </button>

                    <div className="mobile-np-queue-actions">
                      <QueueDragHandle id={entry.id} title={itemTrack.title} onMove={onReorderUpcoming} />
                      <button
                        type="button"
                        className="mobile-np-queue-action-btn remove"
                        aria-label="Remove from queue"
                        onClick={() => onRemoveQueue(entry.id)}
                      >
                        <X size={15} />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </section>
      <nav className="mobile-np-bottom-tabs" aria-label="Player views">
        <button type="button" aria-expanded={activeTab === "queue"} onClick={() => setActiveTab(activeTab === "queue" ? "player" : "queue")}><ListMusic size={18} />Up next</button>
      </nav>
    </div>
  );
}
