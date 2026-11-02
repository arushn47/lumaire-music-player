import { ArtistLinks } from "../common/ArtistLinks";
import React, { useEffect, useRef } from "react";
import {
  Heart,
  ListMusic,
  ListPlus,
  PanelRightClose,
  X,
} from "lucide-react";
import { Artwork, DownloadedBadge, IconButton } from "../common";
import { AudioWaveform } from "../common/AudioWaveform";
import type { Session, Track } from "../../domain/types";
import type { Playback } from "../../player/controller";
import { playbackQueue, isQueuedCatalog } from "../../domain/queue";

export interface QueuePanelProps {
  onNavigateArtist?: (id: string) => void;
  session: Session;
  listeningTracks: Track[];
  undo: Session["queue"] | null;
  onClose: () => void;
  onSelectQueue: (entryId: string, play: boolean) => void;
  onReorderUpcoming: (entryId: string, delta: number) => void;
  onRemoveQueue: (entryId: string) => void;
  onUndoRemoval: () => void;
  onClearQueue: () => void;
  currentTrack?: Track | null;
  playback?: Playback;
  onTogglePlay?: () => void;
  onFavorite?: (trackId: string) => void;
  isFavorite?: boolean;
  onChoosePlaylist?: (track: Track) => void;
  onResizeStart?: (e: React.PointerEvent<HTMLDivElement>) => void;
  onResizeReset?: () => void;
}

const clock = (s: number) =>
  `${Math.floor((Number.isFinite(s) ? s : 0) / 60)}:${String(Math.floor((Number.isFinite(s) ? s : 0) % 60)).padStart(2, "0")}`;

export function QueuePanel({
  onNavigateArtist,
  session,
  listeningTracks,
  undo,
  onClose,
  onSelectQueue,
  onReorderUpcoming,
  onRemoveQueue,
  onUndoRemoval,
  onClearQueue,
  currentTrack,
  playback,
  onTogglePlay,
  onFavorite,
  isFavorite,
  onChoosePlaylist,
  onResizeStart,
  onResizeReset,
}: QueuePanelProps) {
  const queue = playbackQueue(session);
  const currentIndex = queue.findIndex(
    (entry) => entry.id === session.currentId,
  );
  const upNextCount = queue.slice(currentIndex + 1).length;

  const activeCleanupRef = useRef<(() => void) | null>(null);
  const didDragRef = useRef(false);

  useEffect(() => () => activeCleanupRef.current?.(), []);

  const handleRowPointerDown = (entry: { id: string }, event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !event.isPrimary) return;
    if ((event.target as HTMLElement).closest(".icon-button, a")) return;

    const row = event.currentTarget;
    const scroll = row.closest<HTMLElement>("[data-queue-list]");
    if (!scroll) return;

    const rows = [...scroll.querySelectorAll<HTMLElement>("[data-queue-entry]")];
    const from = rows.indexOf(row);
    if (from === -1) return;

    const startX = event.clientX;
    const startY = event.clientY;
    const startScrollTop = scroll.scrollTop;
    const centers = rows.map((item) => {
      const r = item.getBoundingClientRect();
      return r.y + r.height / 2;
    });

    let isDragging = false;
    let targetIndex = from;

    const onPointerMove = (moveEvent: PointerEvent) => {
      if (!isDragging) {
        const dist = Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY);
        if (dist < 4) return;
        isDragging = true;
        didDragRef.current = true;
        row.dataset.queueDragging = "true";
        document.body.style.cursor = "grabbing";
      }

      moveEvent.preventDefault();
      const bounds = scroll.getBoundingClientRect();
      if (moveEvent.clientY < bounds.top + 48) scroll.scrollTop -= 16;
      else if (moveEvent.clientY > bounds.bottom - 48) scroll.scrollTop += 16;

      const scrollDelta = scroll.scrollTop - startScrollTop;
      row.style.transform = `translateY(${moveEvent.clientY - startY + scrollDelta}px)`;

      const currentY = moveEvent.clientY + scrollDelta;
      const best = centers.reduce(
        (acc, center, idx) =>
          Math.abs(center - currentY) < Math.abs(centers[acc] - currentY) ? idx : acc,
        0
      );

      if (best !== targetIndex) {
        delete rows[targetIndex].dataset.queueDrop;
        targetIndex = best;
        if (targetIndex !== from) {
          rows[targetIndex].dataset.queueDrop = "true";
        }
      }
    };

    const cleanup = () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", cleanup);
      row.style.transform = "";
      delete row.dataset.queueDragging;
      rows.forEach((r) => delete r.dataset.queueDrop);
      document.body.style.cursor = "";
      activeCleanupRef.current = null;
    };

    const onPointerUp = (upEvent: PointerEvent) => {
      cleanup();
      if (isDragging) {
        upEvent.preventDefault();
        upEvent.stopPropagation();
        if (targetIndex !== from) {
          onReorderUpcoming(entry.id, targetIndex - from);
        }
        setTimeout(() => {
          didDragRef.current = false;
        }, 80);
      }
    };

    activeCleanupRef.current = cleanup;
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", cleanup);
  };

  return (
    <aside className="queue-pane now-playing-dock">
      {onResizeStart && (
        <div
          className="queue-resizer"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize queue"
          title="Drag to resize queue · Double-click to reset"
          onPointerDown={onResizeStart}
          onDoubleClick={onResizeReset}
        />
      )}
      <header className="now-playing-header">
        <h2>Now Playing</h2>
        <IconButton label="Collapse panel" onClick={onClose}>
          <PanelRightClose size={18} />
        </IconButton>
      </header>

      {/* Featured Current Track Card & Live Audio Waveform (Sonora Style) */}
      {currentTrack ? (
        <div className="now-playing-hero">
          <div
            className="now-playing-cover-wrap"
            onClick={onTogglePlay}
            role="button"
            tabIndex={0}
            aria-label={playback?.status === "playing" ? "Pause" : "Play"}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onTogglePlay?.();
              }
            }}
          >
            <Artwork url={currentTrack.artworkUrl} className="now-playing-art" />
          </div>
          <div className="now-playing-details">
            <div className="now-playing-meta">
              <strong className="now-playing-title" dir="auto" title={currentTrack.title}>
                {currentTrack.title}
              </strong>
              <ArtistLinks
                className="now-playing-artist"
                artistString={currentTrack.artist}
                catalogId={currentTrack.metadataSourceId}
                onNavigateArtist={onNavigateArtist}
                maxArtists={2}
              />
            </div>
            <div className="now-playing-actions">
              {onChoosePlaylist && (
                <button
                  type="button"
                  className="now-playing-action-btn"
                  onClick={() => onChoosePlaylist(currentTrack)}
                  aria-label="Save to playlist"
                  title="Save to playlist"
                >
                  <ListPlus size={18} />
                </button>
              )}
              {onFavorite && (
                <button
                  type="button"
                  className={`now-playing-action-btn now-playing-fav ${isFavorite ? "is-favorite" : ""}`}
                  onClick={() => onFavorite(currentTrack.id)}
                  aria-label={isFavorite ? "Remove from favorites" : "Add to favorites"}
                  title={isFavorite ? "Favorited" : "Favorite"}
                >
                  <Heart size={18} fill={isFavorite ? "currentColor" : "none"} />
                </button>
              )}
            </div>
          </div>
          <AudioWaveform
            isPlaying={playback?.status === "playing"}
            className="now-playing-waveform"
          />
        </div>
      ) : null}

      <div className="up-next-section">
        <div className="up-next-header">
          <h3>Up next</h3>
          {upNextCount > 0 && <span className="up-next-count">{upNextCount}</span>}
        </div>

        <div className="queue-items" data-queue-list>
          {session.queue.length ? (
            queue.map((entry, index) => {
              if (index < currentIndex) return null;
              const t = listeningTracks.find(
                (track) => track.id === entry.trackId,
              );
              if (!t) return null;

              const isUpcoming = entry.id !== session.currentId;

              return (
                <div
                  key={entry.id}
                  data-queue-entry={isUpcoming ? entry.id : undefined}
                  className={`queue-entry ${entry.id === session.currentId ? "current" : ""}`}
                  title={isUpcoming ? "Hold and drag anywhere to reorder · Click to play" : undefined}
                  onPointerDown={isUpcoming ? (e) => handleRowPointerDown(entry, e) : undefined}
                  onClick={(e) => {
                    if (didDragRef.current) {
                      e.preventDefault();
                      e.stopPropagation();
                      return;
                    }
                    if ((e.target as HTMLElement).closest(".icon-button, a, .track-title-button")) return;
                    onSelectQueue(entry.id, true);
                  }}
                  onKeyDown={(event) => {
                    if (isUpcoming && event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
                      event.preventDefault();
                      event.stopPropagation();
                      onReorderUpcoming(entry.id, event.key === "ArrowUp" ? -1 : 1);
                    }
                  }}
                >
                  <div className="queue-select">
                    <Artwork
                      url={t.artworkUrl}
                      className={`color-${index % 5}`}
                    />
                    <span className="queue-info">
                      <button
                        className="track-title-button"
                        aria-label={`Play queued ${t.title}`}
                        onClick={(e) => {
                          if (didDragRef.current) {
                            e.preventDefault();
                            e.stopPropagation();
                            return;
                          }
                          onSelectQueue(entry.id, true);
                        }}
                      >
                        <strong dir="auto">{t.title}</strong>
                      </button>
                      <small>
                        <DownloadedBadge track={t} />
                        <ArtistLinks
                          className="queue-artist"
                          artistString={t.artist}
                          catalogId={t.metadataSourceId}
                          onNavigateArtist={onNavigateArtist}
                          maxArtists={2}
                        />
                        {entry.id === session.currentId ? (
                          <span className="queue-now-playing"> · Now playing</span>
                        ) : isQueuedCatalog(t) ? <span> · Audio not verified yet</span> : null}
                      </small>
                    </span>
                  </div>
                  {t.duration ? (
                    <span className="queue-item-duration">{clock(t.duration)}</span>
                  ) : null}
                  <div className="queue-controls">
                    <IconButton
                      label={`Remove queued ${t.title}`}
                      onClick={() => onRemoveQueue(entry.id)}
                    >
                      <X size={14} />
                    </IconButton>
                  </div>
                </div>
              );
            })
          ) : (
            <div className="queue-empty">
              <ListMusic size={28} />
              <p>
                A good listening session
                <br />
                starts with one song.
              </p>
            </div>
          )}
        </div>
      </div>

      <footer>
        {undo && (
          <button className="subtle" onClick={onUndoRemoval}>
            Undo removal
          </button>
        )}
        <button
          className="subtle"
          disabled={!upNextCount}
          onClick={onClearQueue}
        >
          Clear queue
        </button>
      </footer>
    </aside>
  );
}
