import React, { useEffect, useState, useSyncExternalStore } from "react";
import {
  Download,
  FolderOpen,
  Globe,
  Upload,
  Palette,
  Library,
  Globe2,
  FileText,
  Keyboard,
  BarChart3,
  HardDrive,
  Info,
  ChevronLeft,
  ChevronRight,
  Sun,
  Moon,
  Check,
  Sparkles,
  Pipette,
  RotateCcw,
  Heart,
} from "lucide-react";
import { Select } from "../common";
import { MusicPreferences } from "../common/MusicLanguagePicker";
import { SoftwareLicencesSection } from "./SoftwareLicencesSection";
import { UpdaterCard } from "./UpdaterCard";
import { GeminiKeySettings } from "../lyrics/GeminiKeySettings";
import { getUpdateState, subscribeToUpdates } from "../../adapters/updater";
import { SupportSection } from "./SupportSection";
import type { Preferences, Session, Track } from "../../domain/types";
import { mobile } from "../../adapters/native";
import { EngineSetupCard, type EngineSetupProps } from "../common/EngineSetupCard";
import {
  ACCENT_PALETTES,
  DEFAULT_ACCENT,
  getRandomAccent,
  normalizeHexColor,
} from "../../theme";

export interface SettingsViewProps extends EngineSetupProps {
  session: Session;
  tracks: Track[];
  downloads: Record<string, string>;
  busy: boolean;
  mobile: boolean;
  ytdlpAvailable: boolean;
  onRefreshYoutubeEngine: () => Promise<void>;
  onExportLibrary: () => void;
  onImportBackup: () => void;
  onSetting: <K extends keyof Preferences>(
    key: K,
    value: Preferences[K],
  ) => void;
  onClearHistory: () => void;
  onClearLyricCache: () => void;
  onCancelDownload: (id: string) => void;
  onRetryDownload: (track: Track) => void;
  onDeleteOffline: (track: Track) => void;
}

type Category =
  | "music"
  | "appearance"
  | "library"
  | "sources"
  | "lyrics"
  | "shortcuts"
  | "history"
  | "storage"
  | "support"
  | "about";

interface CategoryDef {
  id: Category;
  label: string;
  icon: React.FC<{ size?: number }>;
}

const categories: CategoryDef[] = [
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "music", label: "Music preferences", icon: Globe },
  { id: "library", label: "Library", icon: Library },
  { id: "sources", label: "Online Sources", icon: Globe2 },
  { id: "lyrics", label: "Lyrics", icon: FileText },
  { id: "shortcuts", label: "Keyboard Shortcuts", icon: Keyboard },
  { id: "history", label: "History", icon: BarChart3 },
  { id: "storage", label: "Storage", icon: HardDrive },
  { id: "support", label: "Support", icon: Heart },
  { id: "about", label: "About", icon: Info },
];

export function SettingsView({
  session,
  tracks,
  downloads,
  busy,
  mobile,
  ytdlpAvailable,
  onInstallYoutubeEngine,
  engineState,
  engineError,
  engineProgress,
  engineCancelling,
  onCancelYoutubeEngineInstall,
  onRefreshYoutubeEngine,
  onExportLibrary,
  onImportBackup,
  onSetting,
  onClearHistory,
  onClearLyricCache,
  onCancelDownload,
  onRetryDownload,
  onDeleteOffline,
}: SettingsViewProps) {
  const { currentVersion } = useSyncExternalStore(subscribeToUpdates, getUpdateState, getUpdateState);
  const [activeCategory, setActiveCategory] = useState<Category | null>(mobile ? null : "appearance");
  useEffect(() => {
    if (mobile) document.getElementById("main")?.scrollTo({ top: 0 });
  }, [mobile, activeCategory]);
  useEffect(() => {
    if (!mobile || activeCategory === null) return;
    const marker = Date.now();
    history.pushState({ ...history.state, mobileSettings: marker }, "");
    const back = (event: PopStateEvent) => { if (event.state?.mobileSettings !== marker) setActiveCategory(null); };
    window.addEventListener("popstate", back);
    return () => {
      window.removeEventListener("popstate", back);
      if (history.state?.mobileSettings === marker) history.back();
    };
  }, [mobile, activeCategory]);
  const [customHex, setCustomHex] = useState("");
  const [hexError, setHexError] = useState("");
  const [percentDraft, setPercentDraft] = useState<string | null>(null);
  useEffect(() => {
    if (activeCategory === "sources") void onRefreshYoutubeEngine();
  }, [activeCategory, onRefreshYoutubeEngine]);
  const engineInstalled = engineState === "installed";

  const activeAccent = (
    session.settings.accentColor || DEFAULT_ACCENT
  ).toUpperCase();
  const isCustomAccent = !ACCENT_PALETTES.some(
    (palette) => palette.color.toUpperCase() === activeAccent,
  );

  const FONT_SIZE_STEPS = [18, 20, 22, 24, 26, 28, 30, 32, 34, 38, 42, 46];
  const currentSize = session.settings.lyricSize;
  const currentPercent = Math.round((currentSize / 32) * 100);

  const handleStepSize = (direction: "up" | "down") => {
    if (direction === "up") {
      const next = FONT_SIZE_STEPS.find((s) => s > currentSize);
      if (next !== undefined) onSetting("lyricSize", next);
      else if (currentSize < 46) onSetting("lyricSize", 46);
    } else {
      const prev = [...FONT_SIZE_STEPS].reverse().find((s) => s < currentSize);
      if (prev !== undefined) onSetting("lyricSize", prev);
      else if (currentSize > 18) onSetting("lyricSize", 18);
    }
  };

  const handleManualPercentChange = (valStr: string) => {
    const parsed = parseInt(valStr.replace(/[^0-9]/g, ""), 10);
    if (!isNaN(parsed) && parsed >= 50 && parsed <= 200) {
      if (parsed === 100) {
        onSetting("lyricSize", 32);
      } else {
        const calculated = Math.round((parsed / 100) * 32);
        onSetting("lyricSize", Math.max(18, Math.min(46, calculated)));
      }
    }
  };

  const handleCustomColor = () => {
    const normalized = normalizeHexColor(customHex);
    if (normalized) {
      onSetting("accentColor", normalized);
      setHexError("");
      setCustomHex("");
    } else {
      setHexError("Use #RGB or #RRGGBB format.");
    }
  };

  const handleRandomColor = () => {
    const random = getRandomAccent(session.settings.accentColor);
    onSetting("accentColor", random);
    setHexError("");
  };

  const resetTheme = () => {
    onSetting("themeMode", "dark");
    onSetting("accentColor", DEFAULT_ACCENT);
    setHexError("");
    setCustomHex("");
  };

  const pendingDownloads = Object.entries(downloads).filter(
    ([, status]) => status !== "complete",
  );
  const offlineTracks = tracks.filter((track) => track.offline);

  return (
    <section className={`settings-redesign ${activeCategory === null ? "settings-index" : "settings-detail"}`}>
      <nav className="settings-sidebar" aria-label="Settings categories">
        <h1 className="settings-title">Settings</h1>
        {categories.map((cat) => {
          const Icon = cat.icon;
          return (
            <button
              key={cat.id}
              className={`settings-nav-btn ${activeCategory === cat.id ? "active" : ""}`}
              aria-current={activeCategory === cat.id ? "page" : undefined}
              onClick={() => setActiveCategory(cat.id)}
            >
              <Icon size={18} />
              <span>{cat.label}</span>
              <ChevronRight size={18} className="mobile-settings-chevron" />
            </button>
          );
        })}
      </nav>

      <div className="settings-content">
        <button type="button" className="mobile-settings-back" onClick={() => setActiveCategory(null)}><ChevronLeft size={20} />Settings</button>
        {activeCategory === "music" && <div className="settings-category"><h2>Music preferences</h2><MusicPreferences /></div>}
        {activeCategory === "support" && <SupportSection />}
        {activeCategory === "appearance" && (
          <div className="settings-category">
            <h2>Appearance</h2>
            <p className="category-subtitle">
              Customize theme mode and accent colors to match your style.
            </p>

            <div className="settings-section">
              <h3 className="section-label">Theme Mode</h3>
              <div className="theme-mode-toggle">
                <button
                  className={`theme-option ${session.settings.themeMode === "dark" ? "selected" : ""}`}
                  onClick={() => onSetting("themeMode", "dark")}
                  aria-label="Dark mode"
                  aria-pressed={session.settings.themeMode === "dark"}
                >
                  <Moon size={20} />
                  <span>Dark</span>
                  {session.settings.themeMode === "dark" && (
                    <Check size={16} className="check-mark" />
                  )}
                </button>
                <button
                  className={`theme-option ${session.settings.themeMode === "light" ? "selected" : ""}`}
                  onClick={() => onSetting("themeMode", "light")}
                  aria-label="Light mode"
                  aria-pressed={session.settings.themeMode === "light"}
                >
                  <Sun size={20} />
                  <span>Light</span>
                  {session.settings.themeMode === "light" && (
                    <Check size={16} className="check-mark" />
                  )}
                </button>
              </div>
            </div>



            <div className="settings-section">
              <h3 className="section-label">Accent Color</h3>
              <div className="accent-palette-grid">
                {ACCENT_PALETTES.map((palette) => {
                  const isSelected =
                    activeAccent === palette.color.toUpperCase();
                  return (
                    <button
                      key={palette.id}
                      className={`palette-option ${isSelected ? "selected" : ""}`}
                      onClick={() => onSetting("accentColor", palette.color)}
                      aria-label={palette.name}
                      aria-pressed={isSelected}
                      title={palette.description}
                    >
                      <div className="palette-swatches">
                        {palette.swatches.map((swatch, i) => (
                          <div
                            key={i}
                            className="palette-swatch"
                            style={{ background: swatch }}
                          />
                        ))}
                      </div>
                      <div className="palette-info">
                        <strong>{palette.name}</strong>
                        <small>{palette.description}</small>
                      </div>
                      {isSelected && (
                        <Check size={18} className="palette-check" />
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Dedicated Custom Accent Card on a new line */}
              <div
                className={`custom-accent-card ${isCustomAccent ? "selected" : ""}`}
              >
                <div className="custom-accent-main">
                  <div className="palette-swatches">
                    {isCustomAccent ? (
                      <>
                        <div
                          className="palette-swatch"
                          style={{ background: "rgba(var(--accent-rgb), 0.2)" }}
                        />
                        <div
                          className="palette-swatch"
                          style={{ background: activeAccent }}
                        />
                        <div
                          className="palette-swatch"
                          style={{ background: "var(--accent-active)" }}
                        />
                        <div
                          className="palette-swatch"
                          style={{
                            background: "rgba(var(--accent-rgb), 0.85)",
                          }}
                        />
                      </>
                    ) : (
                      <>
                        <div
                          className="palette-swatch"
                          style={{
                            background:
                              "linear-gradient(90deg, #ff6b6b, #4ecdc4)",
                          }}
                        />
                        <div
                          className="palette-swatch"
                          style={{
                            background:
                              "linear-gradient(90deg, #a855f7, #ec4899)",
                          }}
                        />
                        <div
                          className="palette-swatch"
                          style={{
                            background:
                              "linear-gradient(90deg, #38bdf8, #2dd4bf)",
                          }}
                        />
                        <div
                          className="palette-swatch"
                          style={{
                            background:
                              "linear-gradient(90deg, #f59e0b, #fb7185)",
                          }}
                        />
                      </>
                    )}
                  </div>

                  <div className="custom-accent-info">
                    <div className="custom-accent-title-row">
                      <strong>Custom Accent</strong>
                      {isCustomAccent && (
                        <span className="custom-active-tag">
                          <Check size={13} /> Active
                        </span>
                      )}
                    </div>
                    <small>
                      {isCustomAccent
                        ? `Custom tone: ${activeAccent}`
                        : "Pick any custom shade, roll random, or enter HEX"}
                    </small>
                  </div>
                </div>

                <div className="custom-accent-controls">
                  <label
                    className="custom-tool-button picker-label"
                    title="Open native color picker"
                  >
                    <Pipette size={14} />
                    <span>Pick</span>
                    <input
                      type="color"
                      className="native-color-input"
                      value={isCustomAccent ? activeAccent : "#75D9B0"}
                      onChange={(e) =>
                        onSetting("accentColor", e.target.value.toUpperCase())
                      }
                      aria-label="Pick custom color"
                    />
                  </label>

                  <button
                    type="button"
                    className="custom-tool-button"
                    onClick={handleRandomColor}
                    title="Roll a random aesthetic accent"
                  >
                    <Sparkles size={14} />
                    <span>Random</span>
                  </button>

                  <div className="custom-hex-mini-wrap">
                    <input
                      type="text"
                      className="custom-hex-mini"
                      placeholder="#HEX"
                      value={customHex}
                      maxLength={7}
                      onChange={(e) => {
                        setCustomHex(e.target.value);
                        setHexError("");
                      }}
                      onKeyDown={(e) =>
                        e.key === "Enter" && handleCustomColor()
                      }
                      aria-label="Hex color code"
                    />
                    <button
                      type="button"
                      className="custom-apply-btn"
                      disabled={!customHex.trim()}
                      onClick={handleCustomColor}
                      title="Apply HEX color"
                      aria-label="Apply HEX color"
                    >
                      Apply
                    </button>
                  </div>
                </div>
                {hexError && (
                  <small className="error-text custom-error-inline">
                    {hexError}
                  </small>
                )}
              </div>
            </div>

            <div className="settings-section">
              <h3 className="section-label">Live Preview</h3>
              <div className="theme-preview">
                <div className="preview-track">
                  <div className="preview-play-btn" aria-hidden="true">
                    ▶
                  </div>
                  <div className="preview-meta">
                    <strong>Morning Light</strong>
                    <small>Lumaire · Atmospheric Ambient</small>
                  </div>
                  <span className="preview-badge">Now Playing</span>
                </div>
                <div className="preview-actions">
                  <span className="preview-primary-btn">Play Collection</span>
                  <button className="subtle" onClick={resetTheme}>
                    <RotateCcw size={14} />
                    Reset to Default
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeCategory === "library" && (
          <div className="settings-category">
            <h2>Library & Portability</h2>
            <p className="category-subtitle">
              Your library, collections, queue, and preferences are stored
              locally in SQLite.
            </p>

            <div className="settings-card-group">
              <div className="settings-row">
                <div className="row-text">
                  <strong>Backup & Restore</strong>
                  <small>
                    Backups contain metadata and settings. Audio and lyric text
                    are excluded. Files imported on another device require
                    relink.
                  </small>
                </div>
                <div className="button-row">
                  <button
                    className="subtle"
                    disabled={busy || mobile}
                    onClick={onExportLibrary}
                  >
                    <Upload size={15} />
                    Export library
                  </button>
                  <button
                    className="subtle"
                    disabled={busy || mobile}
                    onClick={onImportBackup}
                  >
                    <Download size={15} />
                    Import backup
                  </button>
                </div>
              </div>
              {mobile && (
                <div className="settings-row footnote-row">
                  <small className="note">
                    Android backup import and export are not enabled in this
                    prototype yet.
                  </small>
                </div>
              )}
            </div>
          </div>
        )}

        {activeCategory === "sources" && (
          <div className="settings-category">
            <h2>Online Sources</h2>
            <p className="category-subtitle">
              Active streaming engines, metadata decoders, and lyric services.
            </p>

            <div className="settings-section">
              <h3 className="section-label">Audio Streaming & Storage</h3>
              <div className="settings-card-group">
                <div className="settings-row">
                  <span className="source-symbol" aria-hidden="true">
                    <FolderOpen size={20} />
                  </span>
                  <div className="row-text">
                    <strong>Local Filesystem</strong>
                    <small>
                      Selected files only · Offline playback · Zero telemetry
                    </small>
                  </div>
                  <span className="source-status enabled">Enabled</span>
                </div>

                <div className="settings-row">
                  <span className="source-symbol" aria-hidden="true">
                    <Globe size={20} />
                  </span>
                  <div className="row-text">
                    <strong>YouTube Engine (yt-dlp)</strong>
                    <small>
                      {mobile ? "Bundled with Android · No separate installation" : "Optional streaming component · Installed only when you choose"}
                    </small>
                  </div>
                  <span
                    className={`source-status ${ytdlpAvailable ? "enabled" : "disabled"}`}
                  >
                    {mobile && ytdlpAvailable ? "Included" : engineInstalled ? "Installed" : engineState === "installing" ? "Installing…" : engineState === "checking" ? "Checking…" : engineState === "error" ? "Needs attention" : "Not installed"}
                  </span>
                </div>

                {!mobile && !engineInstalled && (
                  <EngineSetupCard {...{ engineState, engineError, engineProgress, engineCancelling, onInstallYoutubeEngine, onCancelYoutubeEngineInstall }} />
                )}

                <div className="settings-row">
                  <span className="source-symbol" aria-hidden="true">
                    <Globe2 size={20} />
                  </span>
                  <div className="row-text">
                    <strong>Wikimedia Commons</strong>
                    <small>
                      Public domain & Creative Commons libre audio catalog
                    </small>
                  </div>
                  <span className="source-status enabled">Active</span>
                </div>
              </div>
            </div>

            <div className="settings-section">
              <h3 className="section-label">Metadata & Lyrics Providers</h3>
              <div className="settings-card-group">
                <div className="settings-row">
                  <span className="source-symbol" aria-hidden="true">
                    <FileText size={20} />
                  </span>
                  <div className="row-text">
                    <strong>Lyric providers</strong>
                    <small>
                      LRCLIB, with lrc.red as a fallback for matched synchronized lyrics
                    </small>
                  </div>
                  <span className="source-status enabled">Active</span>
                </div>

                <div className="settings-row">
                  <span className="source-symbol" aria-hidden="true">
                    <HardDrive size={20} />
                  </span>
                  <div className="row-text">
                    <strong>Native Tag Extractor</strong>
                    <small>
                      Embedded ID3v1/v2, FLAC, Vorbis, and MP4 cover & tag
                      parser
                    </small>
                  </div>
                  <span className="source-status enabled">Built-in</span>
                </div>

                <div className="settings-row">
                  <span className="source-symbol" aria-hidden="true">
                    <Info size={20} />
                  </span>
                  <div className="row-text">
                    <strong>Commons Registry API</strong>
                    <small>
                      Attribution, copyright provenance, and author metadata
                    </small>
                  </div>
                  <span className="source-status enabled">Active</span>
                </div>
              </div>
            </div>

            <p className="settings-footnote">
              YouTube uses Lumaire’s managed yt-dlp engine or an available
              system copy. Lyrics are cached locally. Audio is stored only when
              explicitly downloaded.
            </p>
          </div>
        )}

        {activeCategory === "lyrics" && (
          <div className="settings-category">
            <h2>Lyrics</h2>
            {!mobile && <div className="settings-section">
              <h3 className="section-label">Gemini API key</h3>
              <div className="settings-card-group gemini-key-settings"><GeminiKeySettings /></div>
            </div>}
            <p className="category-subtitle">
              Control lyric display, romanization, and translations.
            </p>

            <div className="settings-section">
              <h3 className="section-label">Display Options</h3>
              <div className="settings-card-group">
                <label className="apple-switch-row">
                  <div className="switch-text">
                    <strong>Romanization</strong>
                    <small>Show Roman script for non-Latin lyrics</small>
                  </div>
                  <div className="apple-switch">
                    <input
                      type="checkbox"
                      checked={session.settings.romanisation}
                      onChange={(e) =>
                        onSetting("romanisation", e.target.checked)
                      }
                    />
                    <span className="apple-switch-track" />
                  </div>
                </label>

                <label className="apple-switch-row">
                  <div className="switch-text">
                    <strong>Original script</strong>
                    <small>Show native lyrics in original writing system</small>
                  </div>
                  <div className="apple-switch">
                    <input
                      type="checkbox"
                      checked={session.settings.originalScript}
                      onChange={(e) =>
                        onSetting("originalScript", e.target.checked)
                      }
                    />
                    <span className="apple-switch-track" />
                  </div>
                </label>

                <label className="apple-switch-row">
                  <div className="switch-text">
                    <strong>Original first</strong>
                    <small>Display original script above romanization</small>
                  </div>
                  <div className="apple-switch">
                    <input
                      type="checkbox"
                      checked={session.settings.originalFirst}
                      disabled={
                        !session.settings.originalScript ||
                        !session.settings.romanisation
                      }
                      onChange={(e) =>
                        onSetting("originalFirst", e.target.checked)
                      }
                    />
                    <span className="apple-switch-track" />
                  </div>
                </label>

                <label className="apple-switch-row">
                  <div className="switch-text">
                    <strong>Translation</strong>
                    <small>Show English meaning when available</small>
                  </div>
                  <div className="apple-switch">
                    <input
                      type="checkbox"
                      checked={session.settings.translation}
                      onChange={(e) =>
                        onSetting("translation", e.target.checked)
                      }
                    />
                    <span className="apple-switch-track" />
                  </div>
                </label>
              </div>
            </div>

            <div className="settings-section">
              <h3 className="section-label">Behavior</h3>
              <div className="settings-card-group">
                {!mobile && (
                  <label className="apple-switch-row">
                    <div className="switch-text">
                      <strong>Automatic pronunciation & translation (Gemini)</strong>
                      <small>
                        With a saved Gemini key,
                        send each selected song’s lyrics for pronunciation and
                        English meaning. Cached results are reused.
                      </small>
                    </div>
                    <div className="apple-switch">
                      <input
                        type="checkbox"
                        checked={session.settings.autoGemini}
                        onChange={(event) =>
                          onSetting("autoGemini", event.target.checked)
                        }
                      />
                      <span className="apple-switch-track" />
                    </div>
                  </label>
                )}
                <label className="apple-switch-row">
                  <div className="switch-text">
                    <strong>Auto-open lyrics</strong>
                    <small>{mobile ? "Open player lyrics when playback begins" : "Open lyrics room when playback begins"}</small>
                  </div>
                  <div className="apple-switch">
                    <input
                      type="checkbox"
                      checked={session.settings.autoOpenLyrics}
                      onChange={(e) =>
                        onSetting("autoOpenLyrics", e.target.checked)
                      }
                    />
                    <span className="apple-switch-track" />
                  </div>
                </label>

                <label className="apple-switch-row">
                  <div className="switch-text">
                    <strong>Estimated scroll</strong>
                    <small>
                      Auto-scroll untimed lyrics based on track duration
                    </small>
                  </div>
                  <div className="apple-switch">
                    <input
                      type="checkbox"
                      checked={session.settings.estimatedScroll}
                      onChange={(e) =>
                        onSetting("estimatedScroll", e.target.checked)
                      }
                    />
                    <span className="apple-switch-track" />
                  </div>
                </label>
              </div>
            </div>

            <div className="settings-section">
              <h3 className="section-label">Lyric Text Size</h3>
              <div className="settings-card-group">
                <div className="settings-row">
                  <div className="row-text">
                    <strong>Scale font size</strong>
                    <small>
                      Adjust lyric font scale for comfortable reading
                    </small>
                  </div>
                  <div className="lyric-size-control-wrap">
                    <div className="lyric-size-control">
                      <button
                        className="subtle size-stepper-btn"
                        disabled={currentSize <= 18}
                        onClick={() => handleStepSize("down")}
                        aria-label="Decrease lyric text size"
                        title="Decrease text scale"
                      >
                        A−
                      </button>
                      <div className="size-input-wrap">
                        <input
                          type="text"
                          className="size-number-input"
                          value={
                            percentDraft !== null
                              ? percentDraft
                              : `${currentPercent}%`
                          }
                          onFocus={() =>
                            setPercentDraft(String(currentPercent))
                          }
                          onChange={(e) => setPercentDraft(e.target.value)}
                          onBlur={() => {
                            if (percentDraft !== null)
                              handleManualPercentChange(percentDraft);
                            setPercentDraft(null);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              if (percentDraft !== null)
                                handleManualPercentChange(percentDraft);
                              setPercentDraft(null);
                            }
                          }}
                          aria-label="Lyric scale percentage"
                          title="Type percentage and press Enter (e.g. 100)"
                        />
                      </div>
                      <button
                        className="subtle size-stepper-btn"
                        disabled={currentSize >= 46}
                        onClick={() => handleStepSize("up")}
                        aria-label="Increase lyric text size"
                        title="Increase text scale"
                      >
                        A+
                      </button>
                    </div>

                    {currentPercent !== 100 && (
                      <button
                        className="subtle size-reset-pill"
                        onClick={() => {
                          onSetting("lyricSize", 32);
                          setPercentDraft(null);
                        }}
                        title="Reset scale to exactly 100%"
                      >
                        Reset 100%
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeCategory === "shortcuts" && (
          <div className="settings-category">
            <h2>Keyboard Shortcuts</h2>
            <p className="category-subtitle">
              Quick keyboard controls for lightning-fast playback and
              navigation.
            </p>

            <div className="settings-section">
              <h3 className="section-label">Playback Controls</h3>
              <div className="settings-card-group">
                <div className="settings-row">
                  <div className="row-text">
                    <strong>Play / Pause</strong>
                    <small>Toggle playback for the active song</small>
                  </div>
                  <div className="kbd-combo">
                    <kbd className="apple-kbd">Space</kbd>
                  </div>
                </div>

                <div className="settings-row">
                  <div className="row-text">
                    <strong>Next track</strong>
                    <small>Skip forward to the next queued item</small>
                  </div>
                  <div className="kbd-combo">
                    <kbd className="apple-kbd">Ctrl</kbd>
                    <span>+</span>
                    <kbd className="apple-kbd">→</kbd>
                  </div>
                </div>

                <div className="settings-row">
                  <div className="row-text">
                    <strong>Previous track</strong>
                    <small>Restart song or skip back to previous item</small>
                  </div>
                  <div className="kbd-combo">
                    <kbd className="apple-kbd">Ctrl</kbd>
                    <span>+</span>
                    <kbd className="apple-kbd">←</kbd>
                  </div>
                </div>

                <div className="settings-row">
                  <div className="row-text">
                    <strong>Seek forward (+5s)</strong>
                    <small>Jump forward in current track</small>
                  </div>
                  <div className="kbd-combo">
                    <kbd className="apple-kbd">→</kbd>
                  </div>
                </div>

                <div className="settings-row">
                  <div className="row-text">
                    <strong>Seek backward (-5s)</strong>
                    <small>Jump back in current track</small>
                  </div>
                  <div className="kbd-combo">
                    <kbd className="apple-kbd">←</kbd>
                  </div>
                </div>

                <div className="settings-row">
                  <div className="row-text">
                    <strong>Volume up (+5%)</strong>
                    <small>Increase listening volume</small>
                  </div>
                  <div className="kbd-combo">
                    <kbd className="apple-kbd">Ctrl</kbd>
                    <span>+</span>
                    <kbd className="apple-kbd">↑</kbd>
                  </div>
                </div>

                <div className="settings-row">
                  <div className="row-text">
                    <strong>Volume down (-5%)</strong>
                    <small>Decrease listening volume</small>
                  </div>
                  <div className="kbd-combo">
                    <kbd className="apple-kbd">Ctrl</kbd>
                    <span>+</span>
                    <kbd className="apple-kbd">↓</kbd>
                  </div>
                </div>

                <div className="settings-row">
                  <div className="row-text">
                    <strong>Mute / Unmute</strong>
                    <small>
                      Silence audio or restore previous volume level
                    </small>
                  </div>
                  <div className="kbd-combo">
                    <kbd className="apple-kbd">Ctrl</kbd>
                    <span>+</span>
                    <kbd className="apple-kbd">M</kbd>
                  </div>
                </div>
              </div>
            </div>

            <div className="settings-section">
              <h3 className="section-label">General & Navigation</h3>
              <div className="settings-card-group">
                <div className="settings-row">
                  <div className="row-text">
                    <strong>Open Settings</strong>
                    <small>Toggle preferences overlay</small>
                  </div>
                  <div className="kbd-combo">
                    <kbd className="apple-kbd">Ctrl</kbd>
                    <span>+</span>
                    <kbd className="apple-kbd">,</kbd>
                  </div>
                </div>

                <div className="settings-row">
                  <div className="row-text">
                    <strong>Toggle Queue</strong>
                    <small>Open or collapse Up Next drawer</small>
                  </div>
                  <div className="kbd-combo">
                    <kbd className="apple-kbd">Ctrl</kbd>
                    <span>+</span>
                    <kbd className="apple-kbd">Q</kbd>
                  </div>
                </div>

                <div className="settings-row">
                  <div className="row-text">
                    <strong>Dismiss / Close</strong>
                    <small>Close drawers, menus, or blur active inputs</small>
                  </div>
                  <div className="kbd-combo">
                    <kbd className="apple-kbd">Esc</kbd>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeCategory === "history" && (
          <div className="settings-category">
            <h2>History & Privacy</h2>
            <p className="category-subtitle">
              Control listening history and cached data. History sync is optional in Sync → Devices.
            </p>

            <div className="settings-card-group">
              <label className="apple-switch-row">
                <div className="switch-text">
                  <strong>Record listening history</strong>
                  <small>
                    Nothing is sent to external services. History stays private
                    on your devices; paired history sharing is opt-in.
                  </small>
                </div>
                <div className="apple-switch">
                  <input
                    type="checkbox"
                    checked={session.settings.historyEnabled}
                    onChange={(e) =>
                      onSetting("historyEnabled", e.target.checked)
                    }
                  />
                  <span className="apple-switch-track" />
                </div>
              </label>

              <div className="settings-row">
                <div className="row-text">
                  <strong>Clear Data</strong>
                  <small>
                    Clear playback history or cached lyric records. History clears also propagate when both devices enable history sync.
                  </small>
                </div>
                <div className="button-row">
                  <button className="subtle" onClick={onClearHistory}>
                    Clear history
                  </button>
                  <button className="subtle" onClick={onClearLyricCache}>
                    Clear lyric cache
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeCategory === "storage" && (
          <div className="settings-category">
            <h2>Storage & Downloads</h2>
            <p className="category-subtitle">
              Manage offline audio downloads and cached storage.
            </p>

            <p className="settings-footnote" style={{ marginBottom: "20px" }}>
              Only explicitly downloaded, licensed audio is stored here.
              External local files are never deleted by these controls.
            </p>
            <p className="settings-footnote">
              Offline storage: <code>{mobile ? "/data/user/0/app.lumaire.player/downloads" : "%APPDATA%\\app.lumaire.player\\downloads"}</code>.
              {mobile ? " This is private app storage, not the public Downloads folder. Uninstalling or clearing app data removes these copies." : " These are app-managed files, separate from your original music folders."}
            </p>

            {pendingDownloads.length === 0 && offlineTracks.length === 0 ? (
              <div className="settings-card-group">
                <div className="settings-empty-state">
                  <HardDrive size={30} className="empty-icon" />
                  <strong>No offline downloads</strong>
                  <small>
                    Tracks saved for offline playback will appear here.
                  </small>
                </div>
              </div>
            ) : (
              <div className="settings-card-group">
                {pendingDownloads.map(([id, status]) => (
                  <div className="settings-row" key={id}>
                    <div className="row-text">
                      <strong>
                        {tracks.find((track) => track.id === id)?.title ||
                          "Audio download"}
                      </strong>
                      <small>
                        Status:{" "}
                        {status === "downloading" ? "Downloading…" : status}
                      </small>
                    </div>
                    {status === "downloading" ? (
                      <button
                        className="subtle"
                        onClick={() => onCancelDownload(id)}
                      >
                        Cancel
                      </button>
                    ) : (
                      <button
                        className="subtle"
                        onClick={() => {
                          const track = tracks.find((t) => t.id === id);
                          if (track) onRetryDownload(track);
                        }}
                      >
                        Retry
                      </button>
                    )}
                  </div>
                ))}

                {offlineTracks.map((track) => (
                  <div className="settings-row" key={track.id}>
                    <div className="row-text">
                      <strong>{track.title}</strong>
                      <small>
                        {track.artist || "Unknown artist"} · Available offline
                      </small>
                    </div>
                    <button
                      className="subtle danger-button"
                      onClick={() => onDeleteOffline(track)}
                    >
                      Delete offline copy
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeCategory === "about" && (
          <div className="settings-category">
            <h2>About Lumaire</h2>
            <p className="category-subtitle">
              Local-first desktop audio player designed with care.
            </p>

            <div className="settings-card-group">
              <div className="about-hero-row">
                <div className="about-brand-icon" aria-hidden="true">
                  <svg
                    viewBox="0 0 128 128"
                    width="44"
                    height="44"
                    fill="currentColor"
                  >
                    <rect
                      width="128"
                      height="128"
                      rx="28"
                      fill="currentColor"
                      opacity="0.16"
                    />
                    <path
                      d="M31 74V61a33 33 0 0 1 66 0v13"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="8"
                      strokeLinecap="round"
                    />
                    <rect
                      x="27"
                      y="64"
                      width="18"
                      height="31"
                      rx="8"
                      fill="currentColor"
                    />
                    <rect
                      x="83"
                      y="64"
                      width="18"
                      height="31"
                      rx="8"
                      fill="currentColor"
                    />
                    <circle cx="64" cy="91" r="5" fill="currentColor" />
                  </svg>
                </div>
                <div className="about-hero-text">
                  <h3>Lumaire {currentVersion}</h3>
                  <p>
                    Local-first audio player with private lyric synchronization.
                  </p>
                  <div className="about-tech-stack">
                    <span>React</span>
                    <span>TypeScript</span>
                    <span>Tauri 2</span>
                    <span>Rust</span>
                    <span>SQLite</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="settings-section" style={{ marginTop: "28px" }}>
              <h3 className="section-label">Keyboard Shortcuts</h3>
              <div className="settings-card-group">
                <div className="settings-row">
                  <div className="row-text">
                    <strong>Play or pause</strong>
                    <small>Toggle playback for the active track</small>
                  </div>
                  <kbd className="apple-kbd">Space</kbd>
                </div>
                <div className="settings-row">
                  <div className="row-text">
                    <strong>Next track</strong>
                    <small>Skip forward in current queue</small>
                  </div>
                  <div className="kbd-combo">
                    <kbd className="apple-kbd">Alt</kbd>
                    <span>+</span>
                    <kbd className="apple-kbd">→</kbd>
                  </div>
                </div>
                <div className="settings-row">
                  <div className="row-text">
                    <strong>Previous track</strong>
                    <small>Return to beginning or previous track</small>
                  </div>
                  <div className="kbd-combo">
                    <kbd className="apple-kbd">Alt</kbd>
                    <span>+</span>
                    <kbd className="apple-kbd">←</kbd>
                  </div>
                </div>
              </div>
            </div>

            <UpdaterCard />
            <SoftwareLicencesSection />
            <p className="settings-footnote">
              Format compatibility depends on system codecs. No required
              accounts or telemetry. Your library and listening history remain
              on your devices. Optional online services receive searches or
              lyrics when used.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
