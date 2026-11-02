import { cleanVideoTitle } from "../../domain/online-track";
import React, { useState, useEffect, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { isTauri } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  FileText,
  Languages,
  Loader2,
  Music2,
  RefreshCw,
  Settings2,
  Subtitles,
  Type,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";
import type { LookupState } from "../../adapters/lrclib";
import { lyricLayers, isFetchedLyrics, lyricSourceLink } from "../../domain/lyric-display";
import { lyricLanguageNames } from "../../domain/lyric-languages";
import type {
  LyricDocument,
  Preferences,
  Session,
  Track,
} from "../../domain/types";
import { LyricsSettings } from "./LyricsSettings";
import { centerLyricLine } from "./scroll-lyric";
import { WordLyrics } from "./WordLyrics";
import { ArtistLinks } from "../common/ArtistLinks";
import {
  type LyricProcessingState,
} from "../../adapters/lyric-processing";

export interface LyricsViewProps {
  mediaTime?: number;
  embedded?: boolean;
  onNavigateArtist?: (id: string) => void;
  track?: Track | null;
  doc?: LyricDocument;
  lyricSynced: boolean;
  lyricLookup: LookupState;
  follow: boolean;
  setFollow: (follow: boolean) => void;
  followTarget: string | null;
  active: string | null;
  activeRef: React.RefObject<HTMLButtonElement | null>;
  busy: boolean;
  session: Session;
  setting: <K extends keyof Preferences>(key: K, value: Preferences[K]) => void;
  onUpdateOffset: (offset: number) => void;
  clearCache: () => void;
  regenerate: () => void;
  processingState: LyricProcessingState;
  translateLyrics: (language: string) => Promise<void>;
  romanizing?: boolean;
  onRetryLookup: () => void;
  onAlbumRecording?: () => void;
  audioDuration?: number;
  onMarkInstrumental: () => void;
  onSeek: (seconds: number) => void;
}

const clock = (s: number) =>
  `${Math.floor((Number.isFinite(s) ? s : 0) / 60)}:${String(Math.floor((Number.isFinite(s) ? s : 0) % 60)).padStart(2, "0")}`;

export function LyricsView({
  mediaTime = 0,
  embedded = false,
  onNavigateArtist,
  track,
  doc,
  lyricSynced,
  lyricLookup,
  follow,
  setFollow,
  followTarget,
  active,
  activeRef,
  busy,
  session,
  setting,
  onUpdateOffset,
  clearCache,
  regenerate,
  processingState,
  translateLyrics,
  romanizing = false,
  onRetryLookup,
  onAlbumRecording,
  audioDuration,
  onMarkInstrumental,
  onSeek,
}: LyricsViewProps) {
  const [lyricsMenuOpen, setLyricsMenuOpen] = useState(false);
  const [portalNode, setPortalNode] = useState<HTMLElement | null>(() =>
    typeof document !== "undefined" ? document.getElementById("expanded-lyrics-settings-slot") : null
  );

  useLayoutEffect(() => {
    if (embedded) {
      setPortalNode(document.getElementById("expanded-lyrics-settings-slot"));
    } else {
      setPortalNode(null);
    }
  }, [embedded]);

  const targetSlot = embedded
    ? (portalNode ?? (typeof document !== "undefined" ? document.getElementById("expanded-lyrics-settings-slot") : null))
    : null;

  useEffect(() => {
    setFollow(true);
    if (!embedded) {
      document.getElementById("main")?.scrollTo({ top: 0, behavior: "instant" });
    } else {
      const container = document.querySelector<HTMLElement>(".expanded-lyrics, .mobile-np-lyrics-scroll-wrap");
      if (activeRef.current) {
        centerLyricLine(activeRef.current, "instant");
      } else if (container) {
        container.scrollTo({ top: 0, behavior: "instant" });
      }
    }
  }, [track?.id, setFollow, embedded]);

  useEffect(() => {
    if (follow && followTarget && activeRef.current) {
      centerLyricLine(
        activeRef.current,
        matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
      );
    }
  }, [followTarget, follow]);

  useEffect(() => {
    const container = embedded
      ? document.querySelector<HTMLElement>(".expanded-lyrics, .mobile-np-lyrics-scroll-wrap")
      : document.getElementById("main");
    if (!container) return;

    const handleUserGesture = (e: Event) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest?.(".lyric-room-floating-bar, .lyric-settings, .lyric-float-btn, button, .icon-button")) {
        return;
      }
      if (follow) {
        setFollow(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.defaultPrevented || target?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
      if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(event.key)) handleUserGesture(event);
    };
    // Scroll events also come from smooth scrolling and layout anchoring; only input pauses follow.
    container.addEventListener("keydown", handleKeyDown);
    container.addEventListener("wheel", handleUserGesture, { passive: true });
    container.addEventListener("touchmove", handleUserGesture, { passive: true });
    container.addEventListener("pointerdown", handleUserGesture, { passive: true });

    return () => {
      container.removeEventListener("keydown", handleKeyDown);
      container.removeEventListener("wheel", handleUserGesture);
      container.removeEventListener("touchmove", handleUserGesture);
      container.removeEventListener("pointerdown", handleUserGesture);
    };
  }, [embedded, follow, setFollow]);

  const sourceLink = doc && lyricSourceLink(doc);
  const handleOpenExternal = (e: React.MouseEvent<HTMLAnchorElement>, url: string) => {
    if (isTauri()) {
      e.preventDefault();
      void openUrl(url).catch(() => {});
    }
  };

  useEffect(() => {
    if (!lyricsMenuOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setLyricsMenuOpen(false);
      }
    };
    const handlePointerDown = (e: MouseEvent) => {
      const menu = document.getElementById("lyrics-settings-menu");
      const trigger = document.querySelector(".lyric-settings-trigger");
      if (
        menu &&
        !menu.contains(e.target as Node) &&
        trigger &&
        !trigger.contains(e.target as Node)
      ) {
        setLyricsMenuOpen(false);
      }
    };
    window.addEventListener("keydown", handleKey);
    window.addEventListener("pointerdown", handlePointerDown);
    return () => {
      window.removeEventListener("keydown", handleKey);
      window.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [lyricsMenuOpen]);

  const settingsContent = (
    <div className="lyric-settings">
      <button
        type="button"
        className="icon-button lyric-settings-trigger"
        aria-label="Lyrics settings"
        title="Lyrics settings"
        aria-haspopup="true"
        aria-expanded={lyricsMenuOpen}
        aria-controls="lyrics-settings-menu"
        onClick={() => setLyricsMenuOpen((x) => !x)}
      >
        <Settings2 size={18} />
      </button>
      {lyricsMenuOpen && (
        <>
          <div
            className="lyric-settings-backdrop"
            aria-hidden="true"
            onClick={() => setLyricsMenuOpen(false)}
          />
          <div
            id="lyrics-settings-menu"
            className="lyric-settings-menu"
            role="dialog"
            aria-label="Lyrics settings"
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setLyricsMenuOpen(false);
                e.currentTarget.parentElement
                  ?.querySelector("button")
                  ?.focus();
              }
            }}
          >
            <LyricsSettings
              settings={session.settings}
              setting={setting}
              doc={doc}
              track={track || undefined}
              lyricSynced={lyricSynced}
              onUpdateOffset={onUpdateOffset}
              onClose={() => setLyricsMenuOpen(false)}
              cachedCount={
                Object.values(session.lyrics).filter(isFetchedLyrics).length
              }
              clearCache={clearCache}
              regenerate={regenerate}
              processingState={processingState}
            />
          </div>
        </>
      )}
    </div>
  );

  return (
    <section className="lyric-room" data-embedded={embedded}>
      {embedded && targetSlot ? createPortal(settingsContent, targetSlot) : null}
      {!embedded && (
        <div className="lyric-settings-fixed-anchor">
          {settingsContent}
        </div>
      )}

      <div className="page-heading lyric-room-heading">
        <div className="lyric-room-heading-main">
          <p className="eyebrow">BETWEEN THE LINES</p>
          <h1>
            Listen a little closer<span className="heading-dot">.</span>
          </h1>
          <div className="lyric-room-meta">
            <p className="subtitle lyric-track-info">
              {track ? (
                <>
                  <span className="lyric-track-title">{track.title}</span>
                  {" · "}
                  <ArtistLinks
                    artistString={track.artist}
                    catalogId={track.metadataSourceId}
                    onNavigateArtist={onNavigateArtist}
                  />
                </>
              ) : (
                "Choose a song to open its words."
              )}
            </p>
            {doc && (
              <div className="lyric-meta-pills">
                <span className="lyric-timing-badge" role="status">
                  {lyricSynced
                    ? doc.lines.some(line => line.words?.length) ? "Word-synced lyrics" : "Synced lyrics"
                    : session.settings.estimatedScroll
                      ? "Estimated autoscroll"
                      : "Manual scrolling"}
                </span>
                {sourceLink && (
                  <a
                    className="lyric-provenance-link"
                    href={sourceLink.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => handleOpenExternal(e, sourceLink.url)}
                    title={`Open on ${sourceLink.name}`}
                  >
                    {sourceLink.name} ↗
                  </a>
                )}
                {!doc.instrumental && (
                  <span className="lyric-language-badge" aria-label="Song languages">
                    {lyricLanguageNames(doc).join(", ") || (doc.languageSource ? "Not identified" : "Detecting…")}
                  </span>
                )}
              </div>
            )}
            {doc && isFetchedLyrics(doc) && !doc.instrumental && !lyricSynced && (
              <p className="subtitle lyric-sync-retry">
                <button
                  className="link-button"
                  disabled={lyricLookup.status === "loading"}
                  onClick={onRetryLookup}
                >
                  {lyricLookup.status === "loading"
                    ? "Checking synced lyrics…"
                    : "Check for synced lyrics"}
                </button>
                {track?.metadataSourceId &&
                onAlbumRecording &&
                audioDuration &&
                track.duration - audioDuration >
                  Math.max(5, track.duration * 0.02) ? (
                  <>
                    {" · This audio is shorter than the album recording. "}
                    <button
                      className="link-button"
                      disabled={busy}
                      onClick={onAlbumRecording}
                    >
                      Try album recording
                    </button>
                  </>
                ) : null}
              </p>
            )}
          </div>
        </div>
      </div>
      {doc &&
        processingState.status === "error" &&
        !embedded &&
        (typeof window === "undefined" || window.innerWidth > 768) && (
          <div className="listening-notice" role="status">
            {processingState.message}
            <button type="button" onClick={() => void translateLyrics("auto")}>
              Retry translation
            </button>
          </div>
        )}
      {!doc ? (
        <div className="empty lyric-empty">
          {lyricLookup.status === "loading" ? (
            <>
              <Loader2 size={36} className="spin" />
              <h2>Looking up lyrics…</h2>
              <p>Searching for lyrics to {track?.source?.providerId === "youtube" ? cleanVideoTitle(track.title) : track?.title}.</p>
            </>
          ) : lyricLookup.status === "error" ? (
            <>
              <WifiOff size={36} />
              <h2>Lookup failed</h2>
              <p>{lyricLookup.message}</p>
              <button
                className="primary"
                disabled={!track}
                onClick={onRetryLookup}
              >
                <RefreshCw size={16} />
                Retry
              </button>
            </>
          ) : lyricLookup.status === "not_found" ? (
            <>
              <Wifi size={36} />
              <h2>No lyrics found</h2>
              <p>No lyrics are available for this track yet.</p>
              <button
                className="primary"
                disabled={!track}
                onClick={onRetryLookup}
              >
                <RefreshCw size={16} />
                Retry lookup
              </button>
              <button
                className="subtle"
                disabled={!track}
                onClick={onMarkInstrumental}
              >
                Mark as instrumental
              </button>
            </>
          ) : (
            <>
              <FileText size={36} />
              <h2>The music has words. Bring them here.</h2>
              <p>Lyrics are looked up automatically when you play a track.</p>
              <button
                className="subtle"
                disabled={!track}
                onClick={onMarkInstrumental}
              >
                Mark as instrumental
              </button>
            </>
          )}
        </div>
      ) : doc.instrumental ? (
        <div className="lyric-empty-instrumental">
          <Music2 size={38} className="lyric-instrumental-icon" />
          <h2>Let the music speak.</h2>
          <p>This track is an instrumental.</p>
        </div>
      ) : (
        <>
          {doc.warnings
            .filter((w) => !w.startsWith("The selected lyric recording is "))
            .map((w, i) => (
              <p className="parser-warning" key={i}>
                {w}
              </p>
            ))}
          {(() => {
            const activeIndex = lyricSynced && active ? doc.lines.findIndex((l) => l.id === active) : -1;
            const isFollowing = lyricSynced && follow && activeIndex >= 0;
            return (
              <div
                className={`lyric-lines ${lyricSynced ? "" : "unsynced"} ${isFollowing ? "is-following" : "is-browsing"}`}
                data-has-active={isFollowing ? "true" : undefined}
                data-following={isFollowing ? "true" : "false"}
                style={
                  {
                    "--lyric-size": `${session.settings.lyricSize}px`,
                  } as React.CSSProperties
                }
                onWheel={() => setFollow(false)}
                onTouchMove={() => setFollow(false)}
              >
                {doc.lines.map((line, index) => {
                  const lyricClock = mediaTime * 1000 - doc.fileOffset - doc.userOffset;
                  const wordEnd = line.words?.at(-1)?.end;
                  const lineActive = active === line.id || (lyricSynced && line.time !== null && line.time <= lyricClock && wordEnd !== undefined && lyricClock < wordEnd);
                  const distance = isFollowing ? lineActive ? 0 : Math.abs(index - activeIndex) : null;
                  return (
                    <button
                      key={line.id}
                      ref={line.id === followTarget ? activeRef : undefined}
                      className={`lyric-line ${lineActive ? "is-active" : ""}`}
                      data-distance={distance !== null ? Math.min(distance, 4) : undefined}
                      disabled={!lyricSynced || line.time === null}
                      onClick={() => {
                        setFollow(true);
                        onSeek(
                          Math.max(
                            0,
                            (line.time! + doc.fileOffset + doc.userOffset) / 1000,
                          ),
                        );
                      }}
                      aria-label={
                        lyricSynced && line.time !== null
                          ? `Seek to ${clock((line.time + doc.fileOffset + doc.userOffset) / 1000)}: ${line.text}`
                          : line.text
                      }
                    >
                      {lyricLayers(doc, line, session.settings).map(
                        (layer, lIndex) => (
                          <span
                            key={layer.kind}
                            className={`lyric-${layer.kind} ${lIndex === 0 ? "lyric-primary" : ""}`}
                            lang={
                              layer.kind === "translation"
                                ? "en"
                                : layer.kind === "roman"
                                  ? "und-Latn"
                                  : /[\u0b80-\u0bff]/.test(line.text)
                                    ? "ta"
                                    : /[\u0900-\u097f]/.test(line.text)
                                      ? "und-Deva"
                                      : undefined
                            }
                            dir="auto"
                            spellCheck={layer.kind !== "roman"}
                            style={layer.kind === "roman" ? { textDecorationLine: "none" } : undefined}
                          >
                            {(layer.kind === "original" || layer.kind === "roman") && lyricSynced && lineActive && line.words?.length ? <WordLyrics line={line} clock={lyricClock} text={layer.text} /> : layer.text}
                          </span>
                        ),
                      )}
                    </button>
                  );
                })}
              </div>
            );
          })()}
          {(!embedded || (typeof window !== "undefined" && window.innerWidth <= 768)) && (
            <div
              className="lyric-room-floating-bar"
              onPointerDown={(e) => e.stopPropagation()}
              onTouchStart={(e) => e.stopPropagation()}
            >
              {doc && !doc.instrumental && (() => {
                const isTranslating = Boolean(session.settings.translation && processingState.status === "processing");
                const isRomanizing = Boolean(session.settings.romanisation && (romanizing || (processingState.status === "processing" && !Object.keys(doc.romanisation || {}).length)));
                return (
                  <>
                    <button
                      type="button"
                      className={`icon-button lyric-float-btn ${session.settings.romanisation ? "is-active" : ""}`}
                      aria-pressed={session.settings.romanisation}
                      title={isRomanizing ? "Romanizing lyrics…" : session.settings.romanisation ? "Turn off romanization" : "Turn on romanization"}
                      aria-label="Toggle romanization"
                      onClick={() => setting("romanisation", !session.settings.romanisation)}
                    >
                      {isRomanizing ? <Loader2 size={16} className="spin" /> : <Languages size={17} />}
                    </button>
                    <button
                      type="button"
                      className={`icon-button lyric-float-btn ${session.settings.translation ? "is-active" : ""}`}
                      aria-pressed={session.settings.translation}
                      title={isTranslating ? "Translating lyrics…" : session.settings.translation ? "Turn off translation" : "Turn on translation"}
                      aria-label="Toggle translation"
                      onClick={() => {
                        setting("translation", !session.settings.translation);
                        if (!session.settings.translation) void translateLyrics("auto");
                      }}
                    >
                      {isTranslating ? <Loader2 size={16} className="spin" /> : <Subtitles size={17} />}
                    </button>
                  </>
                );
              })()}
              {!follow && (lyricSynced || session.settings.estimatedScroll) && (
                <button
                  type="button"
                  className="icon-button lyric-float-btn lyric-float-sync"
                  onClick={() => setFollow(true)}
                  title="Back to sync"
                  aria-label="Back to sync"
                >
                  <RefreshCw size={16} />
                </button>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
