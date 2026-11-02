
import { createPortal } from "react-dom";
import { cloneElement, useEffect, useRef, useState, type ReactNode, type ReactElement } from "react";
import { X, FileText, Volume2, VolumeX, RefreshCw, Maximize2, Minimize2, Ellipsis } from "lucide-react";
import { centerLyricLine } from "../lyrics/scroll-lyric";
import { Artwork } from "../common/Artwork";
import { CloseTrackMenu } from "../common/CloseTrackMenu";
import { type PlayerBarProps, TrackActionMenuItems } from "./PlayerBar";
import type { LyricDocument, Preferences, Session } from "../../domain/types";
import type { LyricProcessingState } from "../../adapters/lyric-processing";
import "./expanded.css";
import "./immersive.css";
import { ImmersiveBackground } from "./ImmersiveBackground";


export function ExpandedPlayer({
  controls,
  lyrics,
  onClose,
  doc,
  session: propSession,
  onSetting: propOnSetting,
  follow,
  setFollow,
  canFollow,
  translateLyrics,
  processingState,
  romanizing = false,
  isFullscreen: propIsFullscreen,
  onToggleFullscreen: propOnToggleFullscreen,
}: {
  controls: ReactElement<PlayerBarProps>;
  lyrics: ReactNode;
  onClose: () => void;
  doc?: LyricDocument | null;
  session?: Session;
  onSetting?: <K extends keyof Preferences>(key: K, value: Preferences[K]) => void;
  follow: boolean;
  setFollow: (follow: boolean) => void;
  canFollow: boolean;
  translateLyrics: (language: string) => Promise<void>;
  processingState?: LyricProcessingState;
  romanizing?: boolean;
  isFullscreen?: boolean;
  onToggleFullscreen?: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [showLyrics, setShowLyrics] = useState(true);
  const [progressIdle, setProgressIdle] = useState(false);
  const session = propSession ?? controls.props.session;
  const onSetting = propOnSetting ?? controls.props.onSetting;

  const visibleLyrics = showLyrics && Boolean(doc?.lines.some(line => line.text.trim()) && !doc.instrumental);
  const isFullscreen = propIsFullscreen ?? controls.props.isFullscreen;
  const onToggleFullscreen = propOnToggleFullscreen ?? controls.props.onToggleFullscreen;
  const sessionVolume = session?.settings?.volume ?? 0.72;
  const [hoverVolume, setHoverVolume] = useState(false);
  const lastVol = useRef(sessionVolume > 0 ? sessionVolume : 0.72);
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
    const element = dialog.current!;
    element.showModal();
    const frame = requestAnimationFrame(() => {
      const targetLine = element.querySelector<HTMLElement>(".lyric-line.is-active") || element.querySelector<HTMLElement>(".lyric-line");
      centerLyricLine(targetLine, "instant");
    });
    return () => { cancelAnimationFrame(frame); element.close(); };
  }, []);

  const isPlaying = controls.props.playback?.status === "playing";
  const track = controls.props.track;

  useEffect(() => {
    setProgressIdle(false);
    if (!isPlaying) return;
    const element = dialog.current!;
    let timer: ReturnType<typeof setTimeout>;
    let pressed = false;
    const wake = () => {
      setProgressIdle(false);
      clearTimeout(timer);
      timer = setTimeout(() => { if (!pressed) setProgressIdle(true); }, 3000);
    };
    const press = () => { pressed = true; wake(); };
    const release = () => { pressed = false; wake(); };
    element.addEventListener("pointermove", wake);
    element.addEventListener("pointerdown", press);
    element.addEventListener("keydown", wake);
    element.addEventListener("focusin", wake);
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", release);
    wake();
    return () => {
      clearTimeout(timer);
      element.removeEventListener("pointermove", wake);
      element.removeEventListener("pointerdown", press);
      element.removeEventListener("keydown", wake);
      element.removeEventListener("focusin", wake);
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointercancel", release);
    };
  }, [isPlaying]);

  const content = (
    <dialog
      ref={dialog}
      className={`expanded-player is-immersive${isPlaying && progressIdle ? " is-progress-idle" : ""}`}
      aria-label="Now playing"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <ImmersiveBackground track={track} />

      <header className="expanded-top-bar">
        <button
          autoFocus
          className="icon-button expanded-close"
          aria-label="Close expanded player"
          onClick={onClose}
        >
          <X size={17} />
        </button>

        <div className="expanded-top-actions">




          <div id="expanded-lyrics-settings-slot" />
        </div>
      </header>

      <div className={`expanded-layout ${visibleLyrics ? "has-lyrics" : "no-lyrics"}`}>
        <section className="expanded-record" aria-label="Current song">
          <div className={`expanded-cover-wrapper ${isPlaying ? "is-playing" : "is-paused"}`}>
            <Artwork url={track?.artworkUrl} className="expanded-cover" />
          </div>
          {cloneElement(controls, {
            expanded: true,
            titleCharacterLimit: visibleLyrics ? 28 : 42,
            onExpand: undefined,
            noLyrics: !visibleLyrics,
            onNavigateArtist: (id) => {
              onClose();
              controls.props.onNavigateArtist?.(id);
            },
          })}
        </section>

        {visibleLyrics && (
          <section className="expanded-lyrics" aria-label="Song lyrics" onWheel={() => setFollow(false)} onTouchMove={() => setFollow(false)}>
            {lyrics}
          </section>
        )}
      </div>

      <div className="expanded-bottom-left">
        <button
          className={`expanded-lyrics-toggle ${showLyrics ? "is-active" : ""}`}
          aria-label={showLyrics ? "Hide lyrics" : "Show lyrics"}
          aria-pressed={showLyrics}
          onClick={() => setShowLyrics((prev) => !prev)}
        >
          <FileText size={17} />
        </button>
      </div>

      <div className="expanded-bottom-right">
        {visibleLyrics && canFollow && !follow && <button
          type="button"
          className="expanded-action-btn"
          title="Back to sync"
          aria-label="Back to sync"
          onClick={() => setFollow(true)}
        ><RefreshCw size={15} /></button>}

        <div
          ref={volumeContainerRef}
          className={`expanded-volume-control ${hoverVolume ? "is-hovered" : ""}`}
          onMouseEnter={() => setHoverVolume(true)}
          onMouseLeave={() => {
            setHoverVolume(false);
            if (!isVolumeDragging.current) {
              if (volumeContainerRef.current?.contains(document.activeElement)) {
                (document.activeElement as HTMLElement)?.blur();
              }
            }
          }}
        >
          <button
            type="button"
            className="expanded-volume-btn"
            aria-label={sessionVolume === 0 ? "Unmute" : "Mute"}
            onClick={() => {
              if (sessionVolume > 0) {
                lastVol.current = sessionVolume;
                onSetting?.("volume", 0);
              } else {
                onSetting?.("volume", lastVol.current || 0.72);
              }
            }}
          >
            {sessionVolume === 0 ? <VolumeX size={17} /> : <Volume2 size={17} />}
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={sessionVolume}
            aria-label="Volume"
            style={{
              "--volume-percent": `${Math.min(100, Math.max(0, sessionVolume * 100))}%`,
            } as React.CSSProperties}
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
              if (val > 0) lastVol.current = val;
              onSetting?.("volume", val);
            }}
          />
        </div>

        {track && (track.format !== "catalog" || controls.props.onWrongVersion) && (
          <details className="track-menu expanded-track-menu">
            <summary
              className="expanded-action-btn"
              aria-label="Current song actions"
              title="Song actions"
            >
              <Ellipsis size={17} aria-hidden="true" />
            </summary>
            <div className="menu-popover">
              <CloseTrackMenu />
              <TrackActionMenuItems
                onWrongVersion={controls.props.onWrongVersion}
                track={track}
                tracks={controls.props.tracks || []}
                busy={controls.props.busy}
                session={session}
                downloads={controls.props.downloads || {}}
                onSaveOnline={controls.props.onSaveOnline}
                onChoosePlaylist={controls.props.onChoosePlaylist}
                onFavorite={controls.props.onFavorite}
                onCancelDownload={controls.props.onCancelDownload}
                onDownloadTrack={controls.props.onDownloadTrack}
                onDeleteOffline={controls.props.onDeleteOffline}
              />
            </div>
          </details>
        )}

        {onToggleFullscreen && (
          <button
            type="button"
            className={`expanded-action-btn ${isFullscreen ? "is-active" : ""}`}
            title={isFullscreen ? "Exit full screen (F11)" : "Full screen (F11)"}
            aria-label={isFullscreen ? "Exit full screen (F11)" : "Full screen (F11)"}
            onClick={onToggleFullscreen}
          >
            {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          </button>
        )}
      </div>
    </dialog>
  );
  return typeof document === "undefined" ? content : createPortal(content, document.body);
}

