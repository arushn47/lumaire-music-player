import { ArtistLinks } from "../common/ArtistLinks";
import { CloseTrackMenu } from "../common/CloseTrackMenu";
import { usePlayerSwipe } from "../../hooks/usePlayerSwipe";
import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Ellipsis,
  Shuffle,
  SkipBack,
  Play,
  Pause,
  SkipForward,
  Repeat,
  Repeat1,
  FileText,
  Volume2,
  VolumeX,
  Heart,
  Maximize2,
  Minimize2,
  PictureInPicture2,
  Infinity as InfinityIcon,
} from "lucide-react";
import { Artwork } from "../common/Artwork";
import { IconButton } from "../common/IconButton";
import type { Track, Session, Preferences } from "../../domain/types";
import type { Playback } from "../../player/controller";

export interface PlayerBarProps {
  onWrongVersion?: () => void;
  titleCharacterLimit?: number;
  autoplayLoading?: boolean;
  onFloatingLyrics?: () => void;
  floatingLyricsOpen?: boolean;
  floatingLyricsLocked?: boolean;
  floatingLyricsBusy?: boolean;
  onExpand?: () => void;
  expanded?: boolean;
  noLyrics?: boolean;
  isFullscreen?: boolean;
  onToggleFullscreen?: () => void;
  onNavigateArtist?: (id: string) => void;
  track?: Track | null;
  tracks: Track[];
  playback: Playback;
  session: Session;
  downloads: Record<string, string>;
  busy: boolean;
  view: string;
  setView: (view: any) => void;
  mobile?: boolean;
  queueOpen?: boolean;
  onToggleQueue?: () => void;
  onSeek: (seconds: number) => void;
  onTogglePlay: () => void;
  onSkip: (direction: 1 | -1) => void;
  onFavorite: (trackId: string) => void;
  onChoosePlaylist: (track: Track) => void;
  onDownloadTrack: (track: Track) => void;
  onDeleteOffline: (track: Track) => void;
  onSaveOnline: (track: Track) => void;
  onCancelDownload: (trackId: string) => void;
  onSetting: <K extends keyof Preferences>(key: K, value: Preferences[K]) => void;
}

export function formatWordTruncatedTitle(rawTitle: string, limit: number = 28): string {
  if (!rawTitle || limit <= 0 || rawTitle.length <= limit) return rawTitle;

  const sliced = rawTitle.slice(0, limit);
  const lastSpace = sliced.lastIndexOf(" ");
  let candidate = lastSpace > 0 ? sliced.slice(0, lastSpace) : sliced;

  const openParen = candidate.lastIndexOf("(");
  const closeParen = candidate.lastIndexOf(")");
  if (openParen !== -1 && openParen > closeParen) {
    candidate = candidate.slice(0, openParen);
  }

  const openBracket = candidate.lastIndexOf("[");
  const closeBracket = candidate.lastIndexOf("]");
  if (openBracket !== -1 && openBracket > closeBracket) {
    candidate = candidate.slice(0, openBracket);
  }

  candidate = candidate.replace(/[\s([{\-–—,:;./\\|~]+$/, "").trimEnd();

  if (!candidate) {
    candidate = sliced.trimEnd();
  }

  return `${candidate}…`;
}

const clock = (s: number) =>
  `${Math.floor((Number.isFinite(s) ? s : 0) / 60)}:${String(Math.floor((Number.isFinite(s) ? s : 0) % 60)).padStart(2, "0")}`;

export interface TrackActionMenuItemsProps {
  onWrongVersion?: () => void;
  track: Track | null | undefined;
  tracks: Track[];
  busy?: boolean;
  session: Session;
  downloads: Record<string, string>;
  onSaveOnline: (track: Track) => void;
  onChoosePlaylist: (track: Track) => void;
  onFavorite: (trackId: string) => void;
  onCancelDownload: (trackId: string) => void;
  onDownloadTrack: (track: Track) => void;
  onDeleteOffline: (track: Track) => void;
  onAction?: () => void;
}

export function TrackActionMenuItems({
  onWrongVersion,
  track,
  tracks,
  busy = false,
  session,
  downloads,
  onSaveOnline,
  onChoosePlaylist,
  onFavorite,
  onCancelDownload,
  onDownloadTrack,
  onDeleteOffline,
  onAction,
}: TrackActionMenuItemsProps) {
  if (!track) return null;
  const correction=onWrongVersion&&!track.offline&&(track.metadataSourceId||track.format==='catalog'||track.format==='online')&&(track.format==='catalog'||track.format==='online'||track.id.startsWith('youtube:'))
    ? <button type="button" onClick={event=>{const menu=event.currentTarget.closest('details');if(menu)menu.open=false;onAction?.();onWrongVersion();}}>Wrong version playing?</button> : null;
  return (
    <>
      {correction}
      {!tracks.some((saved) => saved.id === track.id) && (
        <button
          disabled={busy}
          aria-label="Save"
          onClick={() => {
            onAction?.();
            onSaveOnline(track);
          }}
        >
          Save to library
        </button>
      )}
      <button
        disabled={busy}
        aria-label="Add to playlist"
        onClick={() => {
          onAction?.();
          onChoosePlaylist(track);
        }}
      >
        Save to playlist
      </button>
      <button
        onClick={() => {
          onAction?.();
          onFavorite(track.id);
        }}
      >
        {session.favorites.includes(track.id)
          ? "Remove from favorites"
          : "Add to favorites"}
      </button>
      {track.source &&
        !track.offline &&
        (downloads[track.id] === "downloading" ? (
          <button
            onClick={() => {
              onAction?.();
              onCancelDownload(track.id);
            }}
          >
            Cancel download
          </button>
        ) : (
          <button
            aria-label="Download current track for offline"
            onClick={() => {
              onAction?.();
              onDownloadTrack(track);
            }}
          >
            Download for offline
          </button>
        ))}
      {track.offline && (
        <button
          onClick={() => {
            onAction?.();
            onDeleteOffline(track);
          }}
        >
          Delete offline copy
        </button>
      )}
    </>
  );
}

export function PlayerBar({
  onWrongVersion,
  titleCharacterLimit,
  autoplayLoading = false,
  onFloatingLyrics,
  floatingLyricsOpen,
  floatingLyricsLocked,
  floatingLyricsBusy,
  onExpand,
  expanded = false,
  noLyrics = false,
  isFullscreen = false,
  onToggleFullscreen,
  onNavigateArtist,
  track,
  tracks,
  playback,
  session,
  downloads,
  busy,
  view,
  setView,
  mobile = false,
  queueOpen = false,
  onToggleQueue,
  onSeek,
  onTogglePlay,
  onSkip,
  onFavorite,
  onChoosePlaylist,
  onDownloadTrack,
  onDeleteOffline,
  onSaveOnline,
  onCancelDownload,
  onSetting,
}: PlayerBarProps) {
  const [seekHover, setSeekHover] = useState<{ time: number; x: number } | null>(null);
  const [scrubbingTime, setScrubbingTime] = useState<number | null>(null);
  const [showRemaining, setShowRemaining] = useState(false);
  const lastVolume = useRef<number>(
    session.settings.volume > 0 ? session.settings.volume : 0.72,
  );
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const isVolumeDragging = useRef(false);
  const volumeContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handlePointerUp = () => {
      if (isVolumeDragging.current) {
        isVolumeDragging.current = false;
        if (!volumeContainerRef.current?.matches(":hover")) {
          if (volumeContainerRef.current?.contains(document.activeElement)) {
            (document.activeElement as HTMLElement)?.blur();
          }
        }
      }
    };
    window.addEventListener("pointerup", handlePointerUp);
    return () => window.removeEventListener("pointerup", handlePointerUp);
  }, []);

  useEffect(() => {
    setContextMenu(null);
  }, [track?.id]);

  useLayoutEffect(() => {
    if (!contextMenu || !contextMenuRef.current) return;
    const el = contextMenuRef.current;
    const rect = el.getBoundingClientRect();
    const pad = 8;
    let x = contextMenu.x;
    let y = contextMenu.y;

    if (x + rect.width > window.innerWidth - pad) {
      x = Math.max(pad, window.innerWidth - rect.width - pad);
    }
    const opensUp = y + rect.height > window.innerHeight - pad;
    if (opensUp) {
      y = Math.max(pad, contextMenu.y - rect.height);
      el.classList.add("opens-up");
    } else {
      el.classList.remove("opens-up");
    }

    el.style.left = `${Math.round(x)}px`;
    el.style.top = `${Math.round(y)}px`;
  }, [contextMenu]);

  useEffect(() => {
    if (!contextMenu) return;
    const handlePointerDown = (e: PointerEvent) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
        setContextMenu(null);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setContextMenu(null);
      }
    };
    const handleResize = () => {
      setContextMenu(null);
    };
    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", handleResize);
    };
  }, [contextMenu]);

  const renderTrackMenuItems = (onAction?: () => void) => (
    <TrackActionMenuItems
      onWrongVersion={onWrongVersion}
      track={track}
      tracks={tracks}
      busy={busy}
      session={session}
      downloads={downloads}
      onSaveOnline={onSaveOnline}
      onChoosePlaylist={onChoosePlaylist}
      onFavorite={onFavorite}
      onCancelDownload={onCancelDownload}
      onDownloadTrack={onDownloadTrack}
      onDeleteOffline={onDeleteOffline}
      onAction={onAction}
    />
  );

  const activeTime = scrubbingTime ?? Math.min(playback.time, playback.duration || 1);
  const titleLimit =
    titleCharacterLimit ?? (mobile ? 48 : expanded ? (noLyrics ? 42 : 28) : 28);
  const rawTitle =
    (track?.title && track.title.trim()) ||
    (track?.fileName && track.fileName.trim()) ||
    "Room for a little music";
  const displayTitle = formatWordTruncatedTitle(rawTitle, titleLimit);




  const rawArtist =
    (track?.artist && track.artist.trim()) ||
    (track?.source?.attribution && track.source.attribution.trim()) ||
    "Choose a track to begin";


  const swipes = usePlayerSwipe({ up: onExpand, left: () => { if (track) onSkip(1); }, right: () => { if (track) onSkip(-1); } });
  return (
    <footer className={`transport ${expanded ? "expanded-transport" : ""}`} aria-label="Playback controls"
      {...(mobile ? swipes : {})}
      onClick={event => { if (!expanded && track && !(event.target as Element).closest("button, input, a, summary, details, .menu-popover, .seek-bar-top")) onExpand?.(); }}
      onContextMenu={(event) => {
        if (!track || track.format === "catalog") return;
        event.preventDefault();
        setContextMenu({ x: event.clientX, y: event.clientY });
      }}>
      <div
        className="seek-bar-top"
        onMouseMove={(e) => {
          if (!playback.duration) return;
          const rect = e.currentTarget.getBoundingClientRect();
          const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
          const ratio = rect.width > 0 ? x / rect.width : 0;
          const hoverTime = ratio * playback.duration;
          setSeekHover({ time: hoverTime, x });
        }}
        onMouseLeave={() => setSeekHover(null)}
      >
        {seekHover && playback.duration > 0 && (
          <div
            className="seek-hover-tooltip"
            style={{ left: `${seekHover.x}px` }}
          >
            {clock(seekHover.time)}
          </div>
        )}
        <input
          aria-label="Seek playback"
          type="range"
          min={0}
          max={playback.duration || 1}
          step={0.1}
          disabled={!playback.duration}
          value={activeTime}
          style={
            {
              "--seek-percent": `${Math.min(100, Math.max(0, (activeTime / (playback.duration || 1)) * 100))}%`,
            } as React.CSSProperties
          }
          onPointerDown={(e) => setScrubbingTime(Number(e.currentTarget.value))}
          onInput={(e) => setScrubbingTime(Number((e.target as HTMLInputElement).value))}
          onChange={(e) => {
            const time = Number(e.target.value);
            setScrubbingTime(null);
            onSeek(time);
          }}
          onPointerUp={(e) => {
            if (scrubbingTime !== null) {
              const time = Number((e.target as HTMLInputElement).value);
              setScrubbingTime(null);
              onSeek(time);
            }
          }}
        />
      </div>

      {expanded && (
        <div className="expanded-times">
          <span>{clock(activeTime)}</span>
          <button
            type="button"
            className="expanded-time-toggle"
            aria-label={showRemaining ? "Show total duration" : "Show remaining time"}
            title={showRemaining ? "Click to show total duration" : "Click to show remaining time"}
            onClick={() => setShowRemaining((s) => !s)}
          >
            {showRemaining
              ? `−${clock(Math.max(0, playback.duration - activeTime))}`
              : clock(playback.duration)}
          </button>
        </div>
      )}
      <div className="now-playing">
        {!expanded && (
          onExpand && !mobile ? (
            <button className="cover-expand" disabled={!track} aria-label="Open expanded player" onClick={onExpand}>
              <Artwork url={track?.artworkUrl} className="transport-cover" />
              <Maximize2 size={18} />
            </button>
          ) : (
            <button
              type="button"
              className="mobile-cover-expand"
              disabled={!track}
              aria-label="Open now playing"
              onClick={mobile && onExpand ? onExpand : undefined}
            >
              <Artwork url={track?.artworkUrl} className="transport-cover" />
            </button>
          )
        )}
        <div
          className="track-meta now-playing-meta"
          style={mobile && onExpand ? { cursor: "pointer" } : undefined}
        >
          <span className="now-playing-title-wrap">
            <strong dir="auto">
              {displayTitle}
            </strong>
            {Boolean(track?.title) && (
              <span className="title-hover-tooltip" role="tooltip">
                {rawTitle}
              </span>
            )}
          </span>
          <div className="track-subtitle-row">
            <span className="now-playing-artist-wrap">
              <small dir="auto" className="now-playing-artist">
                {track ? (
                  <ArtistLinks
                    catalogId={track.metadataSourceId}
                    artistString={rawArtist}
                    onNavigateArtist={mobile ? undefined : onNavigateArtist}
                    maxArtists={mobile ? 3 : 2}
                  />
                ) : (
                  rawArtist
                )}
              </small>
              {Boolean(track?.artist) && (
                <span className="artist-hover-tooltip" role="tooltip">
                  {rawArtist}
                </span>
              )}
            </span>
          </div>
        </div>

        <span className="now-playing-separator" aria-hidden="true" />

        <div className="track-time-inline">
          <span data-testid="elapsed">{clock(activeTime)}</span>
          <span className="time-sep">/</span>
          <span>{clock(playback.duration)}</span>
        </div>

        {track && !expanded && (
          <IconButton
            label="Favorite current track"
            active={session.favorites.includes(track.id)}
            onClick={() => onFavorite(track.id)}
          >
            <Heart
              size={17}
              fill={session.favorites.includes(track.id) ? "currentColor" : "none"}
            />
          </IconButton>
        )}

        {track && !expanded && (track.format !== "catalog" || onWrongVersion) && (
          <details className="track-menu current-track-menu">
            <summary aria-label="Current song actions" title="Song actions"><Ellipsis size={20} aria-hidden="true" /></summary>
            <div className="menu-popover">
              <CloseTrackMenu />
              {renderTrackMenuItems()}
            </div>
          </details>
        )}
      </div>

      <div className="player-center">
        <div className="player-buttons">
          <IconButton
            label="Shuffle"
            active={session.settings.shuffle}
            onClick={() => onSetting("shuffle", !session.settings.shuffle)}
          >
            <Shuffle size={17} />
          </IconButton>
          {(!mobile || expanded) && <IconButton
            label="Previous track"
            disabled={!track}
            onClick={() => onSkip(-1)}
          >
            <SkipBack size={19} fill="currentColor" />
          </IconButton>}
          <button
            className={`play-button ${(autoplayLoading || playback.status === "loading") ? "is-loading" : ""} ${playback.status === "buffering" ? "is-buffering" : ""}`}
            aria-label={
              autoplayLoading || playback.status === "loading"
                ? "Loading song"
                : playback.status === "buffering"
                  ? "Buffering song"
                  : playback.status === "playing"
                    ? "Pause"
                    : "Play"
            }
            disabled={autoplayLoading || (!track && !tracks.length)}
            aria-busy={autoplayLoading || playback.status === "loading" || playback.status === "buffering"}
            onClick={onTogglePlay}
          >
            {autoplayLoading || playback.status === "loading" || playback.status === "buffering" ? (
              <div className="player-spinner" aria-hidden="true" />
            ) : playback.status === "playing" ? (
              <Pause size={21} fill="currentColor" />
            ) : (
              <Play size={21} fill="currentColor" />
            )}
          </button>
          {(!mobile || expanded) && <IconButton
            label="Next track"
            disabled={!track}
            onClick={() => onSkip(1)}
          >
            <SkipForward size={19} fill="currentColor" />
          </IconButton>}
          <IconButton
            label={`Repeat: ${session.settings.repeat}`}
            active={session.settings.repeat !== "off"}
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
            {session.settings.repeat === "one" ? (
              <Repeat1 size={17} />
            ) : (
              <Repeat size={17} />
            )}
          </IconButton>
        </div>
      </div>

      {!expanded && (
        <div className="player-right">
          <IconButton label={session.settings.autoplay ? 'Turn off Autoplay' : 'Turn on Autoplay'} active={session.settings.autoplay} onClick={() => onSetting('autoplay', !session.settings.autoplay)}>
            <InfinityIcon size={18} />
          </IconButton>
          {onFloatingLyrics && !mobile && <IconButton
            label={floatingLyricsLocked ? 'Unlock floating lyrics' : floatingLyricsOpen ? 'Close floating lyrics' : 'Open floating lyrics'}
            active={floatingLyricsOpen} disabled={floatingLyricsBusy} onClick={onFloatingLyrics}
          ><PictureInPicture2 size={18} /></IconButton>}
          <span
            className={`playback-state ${(autoplayLoading || playback.status === "loading") ? "is-loading" : ""} ${playback.status === "buffering" ? "is-buffering" : ""}`}
            data-testid="playback-state"
          >
            {playback.status === "idle"
              ? "Ready"
              : autoplayLoading || playback.status === "loading" || playback.status === "buffering"
                ? "Buffering…"
                : playback.status}
          </span>
          <IconButton
            label="Open lyrics"
            className="player-btn-lyrics"
            active={view === "lyrics"}
            onClick={() => setView("lyrics")}
          >
            <FileText size={18} />
          </IconButton>
          {!mobile && (
            <div
              ref={volumeContainerRef}
              className="player-volume-container"
              onMouseLeave={() => {
                if (!isVolumeDragging.current) {
                  if (volumeContainerRef.current?.contains(document.activeElement)) {
                    (document.activeElement as HTMLElement)?.blur();
                  }
                }
              }}
            >
              <IconButton
                label={session.settings.volume === 0 ? "Unmute" : "Mute"}
                className="volume-icon-btn"
                onClick={() => {
                  if (session.settings.volume > 0) {
                    lastVolume.current = session.settings.volume;
                    onSetting("volume", 0);
                  } else {
                    onSetting("volume", lastVolume.current || 0.72);
                  }
                }}
              >
                {session.settings.volume === 0 ? (
                  <VolumeX size={18} />
                ) : (
                  <Volume2 size={18} />
                )}
              </IconButton>
              <input
                aria-label="Volume"
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={session.settings.volume}
                style={
                  {
                    "--volume-percent": `${Math.min(100, Math.max(0, session.settings.volume * 100))}%`,
                  } as React.CSSProperties
                }
                onPointerDown={() => {
                  isVolumeDragging.current = true;
                }}
                onPointerUp={(e) => {
                  isVolumeDragging.current = false;
                  if (!volumeContainerRef.current?.matches(":hover")) {
                    e.currentTarget.blur();
                  }
                }}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  if (val > 0) lastVolume.current = val;
                  onSetting("volume", val);
                }}
              />
            </div>
          )}
          {!mobile && onToggleFullscreen && (
            <IconButton
              label={isFullscreen ? "Exit full screen (F11)" : "Full screen (F11)"}
              className="player-btn-fullscreen"
              active={isFullscreen}
              onClick={onToggleFullscreen}
            >
              {isFullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
            </IconButton>
          )}
        </div>
      )}
      {contextMenu && track && track.format !== "catalog" && (
        typeof document === "undefined" ? null : createPortal(
          <div
            ref={contextMenuRef}
            className="menu-popover transport-context-menu"
            style={{
              left: `${contextMenu.x}px`,
              top: `${contextMenu.y}px`,
            }}
            role="menu"
            aria-label="Track options context menu"
            onContextMenu={(e) => e.preventDefault()}
          >
            {renderTrackMenuItems(() => setContextMenu(null))}
          </div>,
          document.body
        )
      )}
    </footer>
  );
}
