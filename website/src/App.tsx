import React, { useState, useEffect, useRef } from "react";
import {
  MicVocal,
  Sparkles,
  ArrowUpRight,
  Check,
  ChevronDown,
  Download,
  Github,
  Headphones,
  LockKeyhole,
  Menu,
  Pause,
  Play,
  Radio,
  ShieldCheck,
  Volume2,
  VolumeX,
  X,
  Zap,
} from "lucide-react";
import "./App.css";

const WINDOWS_URL =
  "https://github.com/arushn47/lumaire-music-player/releases/latest/download/Lumaire_1.0.8_x64-setup.exe";
const ANDROID_URL =
  "https://github.com/arushn47/lumaire-music-player/releases/latest/download/Lumaire-1.0.8-Android-arm64.apk";
const GITHUB_URL = "https://github.com/arushn47/lumaire-music-player";

interface Feature {
  icon: React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;
  number: string;
  tag: string;
  title: string;
  text: string;
  specs: string[];
  className?: string;
}

const features: Feature[] = [
  {
    icon: Zap,
    number: "01",
    tag: "ZERO ONBOARDING FRICTION",
    title: "Zero Signup Required",
    text: "No accounts, emails, or passwords. Download the installer, open your local music folder, and enjoy zero subscriptions.",
    specs: ["Direct launch without login gates", "No third-party tracking servers", "100% anonymous listening"],
    className: "feature-wide",
  },
  {
    icon: Radio,
    number: "02",
    tag: "UNIFIED AUDIO QUEUE",
    title: "Local Library + Streaming",
    text: "Play offline lossless FLAC, MP3, and AAC alongside online audio in a single seamless queue.",
    specs: ["Full lossless codec support", "Unified offline & online playlists", "Automatic embedded tag extraction"],
  },
  {
    icon: MicVocal,
    number: "03",
    tag: "REAL-TIME KARAOKE FOLLOWING",
    title: "Synced Word-by-Word Lyrics",
    text: "Auto-scrolling lyrics with syllable-precision following and offline multi-script transliteration.",
    specs: ["Karaoke syllable tracking", "Offline Tamil, Devanagari & Romaji", "Manual timing offset adjuster"],
    className: "feature-lyrics",
  },
  {
    icon: Headphones,
    number: "04",
    tag: "DEEP OS TRANSPORT",
    title: "Native Background Audio",
    text: "Deep OS integration with media key transport, volume overlays, and persistent lock-screen controls.",
    specs: ["Media3 ExoPlayer engine", "Windows SMTC & media keys", "Saves exact playback position on exit"],
  },
  {
    icon: LockKeyhole,
    number: "05",
    tag: "HARDWARE SOVEREIGNTY",
    title: "Private & Local-First",
    text: "Embedded SQLite storage keeps your library, playlists, and listening tracker strictly on your drive.",
    specs: ["Local encrypted SQLite database", "Zero telemetry or analytics", "Local Wi-Fi device sync"],
  },
  {
    icon: ShieldCheck,
    number: "06",
    tag: "GPL-3.0 OPEN SOURCE",
    title: "100% Free Forever",
    text: "No ads, audio paywalls, or subscription tiers. Built for music listeners, not ad brokers.",
    specs: ["Zero banner or audio commercials", "Public repository on GitHub", "Free forever with no tiers"],
    className: "feature-wide feature-free",
  },
];

interface WordItem {
  native: string;
  rom: string;
  start: number;
  end: number;
}

interface DemoLyricLine {
  id: number;
  timeStart: number;
  timeEnd: number;
  native: string;
  romanized: string;
  english: string;
  words: WordItem[];
}

const DEMO_DURATION = 22.0;

const DEMO_LYRIC_LINES: DemoLyricLine[] = [
  {
    id: 0,
    timeStart: 0,
    timeEnd: 5.0,
    native: "もしもこの想いが",
    romanized: "moshimo kono omoi ga",
    english: "If these feelings of mine",
    words: [
      { native: "もしも", rom: "moshimo", start: 0.0, end: 1.8 },
      { native: "この", rom: "kono", start: 1.8, end: 2.6 },
      { native: "想いが", rom: "omoi ga", start: 2.6, end: 5.0 },
    ],
  },
  {
    id: 1,
    timeStart: 5.0,
    timeEnd: 10.8,
    native: "虹色の空を駆けるなら",
    romanized: "nijiiro no sora wo kakeru nara",
    english: "Could soar across the rainbow sky",
    words: [
      { native: "虹色の", rom: "nijiiro no", start: 5.0, end: 7.2 },
      { native: "空を", rom: "sora wo", start: 7.2, end: 8.2 },
      { native: "駆けるなら", rom: "kakeru nara", start: 8.2, end: 10.8 },
    ],
  },
  {
    id: 2,
    timeStart: 10.8,
    timeEnd: 16.6,
    native: "笑顔に乗せて届けよう",
    romanized: "egao ni nosete todokeyou",
    english: "Carried on a smile, I will deliver them",
    words: [
      { native: "笑顔に", rom: "egao ni", start: 10.8, end: 12.4 },
      { native: "乗せて", rom: "nosete", start: 12.4, end: 14.0 },
      { native: "届けよう", rom: "todokeyou", start: 14.0, end: 16.6 },
    ],
  },
  {
    id: 3,
    timeStart: 16.6,
    timeEnd: 22.0,
    native: "私だけの宝物を",
    romanized: "watashi dake no takaramono wo",
    english: "My very own precious treasure",
    words: [
      { native: "私の", rom: "watashi no", start: 16.6, end: 18.2 },
      { native: "私だけの", rom: "watashi dake no", start: 18.2, end: 20.0 },
      { native: "宝物を", rom: "takaramono wo", start: 20.0, end: 22.0 },
    ],
  },
];

function Brand({
  compact = false,
  testId = "brand-home-link",
}: {
  compact?: boolean;
  testId?: string;
}) {
  return (
    <a
      className={`brand ${compact ? "brand-compact" : ""}`}
      href="#top"
      data-testid={testId}
      aria-label="Lumaire home"
    >
      <span className="brand-mark" aria-hidden="true">
        <svg
          viewBox="0 0 128 128"
          width={compact ? 17 : 20}
          height={compact ? 17 : 20}
          fill="currentColor"
        >
          <path
            d="M31 74V61a33 33 0 0 1 66 0v13"
            fill="none"
            stroke="currentColor"
            strokeWidth="8"
            strokeLinecap="round"
          />
          <rect x="27" y="64" width="18" height="31" rx="8" fill="currentColor" />
          <rect x="83" y="64" width="18" height="31" rx="8" fill="currentColor" />
          <circle cx="64" cy="91" r="5" fill="currentColor" />
        </svg>
      </span>
      <span>Lumaire</span>
    </a>
  );
}

function DownloadButtons({
  location = "hero",
}: {
  location?: string;
}) {
  return (
    <div className={`download-buttons download-buttons-${location}`}>
      <a
        className="download-btn download-windows"
        href={WINDOWS_URL}
        data-testid={`${location}-windows-download`}
        download
      >
        <span className="platform-icon">&#x25A3;</span>
        <span>
          <b>Download for Windows</b>
          <small>Windows x64 · .exe installer (~18 MB)</small>
        </span>
        <ArrowUpRight size={17} />
      </a>
      <a
        className="download-btn download-android"
        href={ANDROID_URL}
        data-testid={`${location}-android-download`}
        download
      >
        <span className="platform-icon">&#x25C8;</span>
        <span>
          <b>Download for Android</b>
          <small>Android ARM64 · signed APK (~24 MB)</small>
        </span>
        <ArrowUpRight size={17} />
      </a>
    </div>
  );
}

export function App() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  // Interactive Lyric Studio state
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [nativeFirst, setNativeFirst] = useState(true);
  const [showNative, setShowNative] = useState(true);
  const [focusedDevice, setFocusedDevice] = useState<"desktop" | "phone" | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const audio = new Audio("/demo-audio.mp3");
    audio.preload = "auto";
    audio.volume = isMuted ? 0 : 0.85;

    audio.ontimeupdate = () => {
      setCurrentTime(audio.currentTime);
    };

    audio.onended = () => {
      setIsPlaying(false);
      setCurrentTime(0);
    };

    audioRef.current = audio;

    return () => {
      audio.pause();
      audio.src = "";
      audioRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = isMuted ? 0 : 0.85;
    }
  }, [isMuted]);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;

    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
    } else {
      if (audio.currentTime >= 15.8) {
        audio.currentTime = 0;
        setCurrentTime(0);
      }
      audio.play().then(() => {
        setIsPlaying(true);
      }).catch(() => {
        setIsPlaying(true);
      });
    }
  };

  const toggleMute = () => {
    setIsMuted((prev) => !prev);
  };

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const newTime = ratio * DEMO_DURATION;
    setCurrentTime(newTime);
    if (audioRef.current) {
      audioRef.current.currentTime = newTime;
      if (!isPlaying) {
        audioRef.current.play().then(() => setIsPlaying(true)).catch(() => {});
      }
    }
  };

  const handleLineClick = (lineTime: number) => {
    setCurrentTime(lineTime);
    if (audioRef.current) {
      audioRef.current.currentTime = lineTime;
      if (!isPlaying) {
        audioRef.current.play().then(() => setIsPlaying(true)).catch(() => {});
      }
    }
  };

  const foundIndex = DEMO_LYRIC_LINES.findIndex(
    (line) => currentTime >= line.timeStart && currentTime < line.timeEnd
  );
  const activeLineIndex = foundIndex === -1 ? (currentTime >= DEMO_DURATION ? 3 : 0) : foundIndex;
  const closeMenu = () => setMenuOpen(false);

  return (
    <main id="top" data-testid="lumaire-landing-page">
      <nav
        className={`site-nav ${scrolled ? "nav-scrolled" : ""}`}
        data-testid="site-navigation"
      >
        <div className="nav-inner">
          <Brand />
          <div className={`nav-links ${menuOpen ? "nav-links-open" : ""}`}>
            <a href="#features" onClick={closeMenu} data-testid="nav-features-link">
              Features
            </a>
            <a href="#screenshots" onClick={closeMenu} data-testid="nav-screenshots-link">
              Screenshots
            </a>
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noreferrer"
              onClick={closeMenu}
              data-testid="nav-github-link"
            >
              GitHub <ArrowUpRight size={13} />
            </a>
            <a
              className="nav-download"
              href="#download"
              onClick={closeMenu}
              data-testid="nav-download-link"
            >
              <Download size={14} /> Download
            </a>
          </div>
          <button
            className="menu-trigger"
            type="button"
            onClick={() => setMenuOpen(!menuOpen)}
            aria-expanded={menuOpen}
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            data-testid="mobile-menu-button"
          >
            {menuOpen ? <X /> : <Menu />}
          </button>
        </div>
      </nav>

      <section className="hero section-pad" aria-labelledby="hero-heading">
        <div className="hero-noise" />
        <div className="orb orb-cyan" />
        <div className="orb orb-red" />
        <div className="hero-grid layout-container">
          <div className="hero-copy reveal-up">
            <div className="eyebrow">
              <span className="pulse-dot" /> Free & Open Source{" "}
              <span className="eyebrow-divider">·</span> Version 1.0.8
            </div>
            <h1 id="hero-heading" data-testid="hero-headline">
              <span className="hero-line">No accounts.</span>
              <span className="hero-line">No subscriptions.</span>
              <span className="hero-line">Just <em>music.</em></span>
            </h1>
            <p className="hero-description" data-testid="hero-description">
              100% free music player for Windows and Android. Built for listeners who
              want an honest offline library, streaming, and synchronized lyrics with zero paywalls.
            </p>
            <DownloadButtons />
            <a
              className="github-action"
              href={GITHUB_URL}
              target="_blank"
              rel="noreferrer"
              data-testid="hero-github-link"
            >
              <Github size={17} /> <span>Star on GitHub</span> <ArrowUpRight size={14} />
            </a>
          </div>
          <div className="hero-visual reveal-up reveal-delay-2" data-testid="hero-product-showcase">
            <div className="visual-caption">
              <span>01</span>
              <span>THE PLAYER / DESKTOP</span>
            </div>
            <div className="hero-image-wrap">
              <div className="image-glow" />
              <img
                src="/desktop.png"
                alt="Lumaire desktop music player showing a local library and playback controls"
              />
            </div>
            <div className="visual-note">
              <Play size={12} fill="currentColor" /> Your music, with room for the words.
            </div>
          </div>
        </div>
        <a href="#features" className="scroll-cue" data-testid="hero-scroll-link">
          <span>Scroll to explore</span>
          <ChevronDown size={16} />
        </a>
      </section>

      <section className="manifesto section-pad" aria-labelledby="manifesto-heading">
        <div className="layout-container manifesto-grid">
          <div>
            <span className="section-kicker">● 02 // THE LISTENING MANIFESTO</span>
            <div className="manifesto-subkicker">
              WHY WE BUILT LUMAIRE WITH TAURI 2, RUST & SQLITE.
            </div>
          </div>
          <div>
            <h2 id="manifesto-heading" data-testid="manifesto-heading">
              Music was meant to be listened to, <em>not rented.</em>
            </h2>
            <div className="manifesto-copy" data-testid="manifesto-copy">
              <p>
                Mainstream apps have turned into bloated platforms — pushing podcasts, yearly price
                hikes, and tracking your listening habits to sell to data brokers.
              </p>
              <p>
                Lumaire strips away the noise. Your offline FLAC, MP3, and WAV files stay completely
                on your device. When you stream or sing along, you get synced lyrics with
                multi-script transliteration — zero accounts, zero paywalls.
              </p>
            </div>
            <div className="metrics-row" data-testid="manifesto-metrics">
              <span>
                <b>0 KB</b>Telemetry data sent
              </span>
              <span>
                <b>~45 MB</b>RAM · Rust + Tauri
              </span>
              <span>
                <b>100%</b>Free & Open Source
              </span>
            </div>
          </div>
        </div>
      </section>

      <section
        id="features"
        className="features-section section-pad"
        aria-labelledby="features-heading"
      >
        <div className="layout-container">
          <div className="section-heading-row">
            <div>
              <span className="section-kicker">/ ARCHITECTURE & CAPABILITIES</span>
              <h2 id="features-heading" data-testid="features-heading">
                Everything your player needs.
                <br />
                <em>Nothing in your way.</em>
              </h2>
            </div>
            <p className="section-intro" data-testid="features-intro">
              ENGINEERED WITH TAURI 2, RUST, AND EMBEDDED SQLITE FOR SUB-10MS RESPONSE TIMES.
            </p>
          </div>
          <div className="feature-grid">
            {features.map(({ icon: Icon, number, tag, title, text, specs, className = "" }) => (
              <article
                className={`feature-item ${className}`}
                data-testid={`feature-${number}`}
                key={number}
              >
                <div className="feature-top">
                  <span className="feature-number">{number}</span>
                  <Icon size={22} strokeWidth={1.5} />
                </div>
                <span className="feature-tag">{tag}</span>
                <h3>{title}</h3>
                <p>{text}</p>
                <ul>
                  {specs.map((spec) => (
                    <li key={spec}>
                      <Check size={12} />
                      {spec}
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="lyric-room section-pad" aria-labelledby="lyrics-heading">
        <div className="layout-container">
          <div className="lyric-heading">
            <div>
              <span className="section-kicker">03 // INTERACTIVE STUDIO DEMO</span>
              <h2 id="lyrics-heading" data-testid="lyrics-heading">
                The Lyric Room.
                <br />
                <em>Word-by-word synchronized.</em>
              </h2>
            </div>
            <p>
              Offline multi-script transliteration (Tamil, Devanagari, Romaji, Hangul) with zero
              cloud dependencies and zero paywalls.
            </p>
          </div>
          <div className="lyric-console" data-testid="lyric-demo">
            <div className="lyric-console-top">
              <div>
                <span className="live-dot" /> LUMAIRE AUDIOPHILE DEMO MASTER · OFFLINE
                TRANSLITERATION
              </div>
              <span>24-BIT / 96KHZ FLAC</span>
            </div>

            <div className="track-heading">
              <div className="track-art">
                <Sparkles size={25} />
              </div>
              <div>
                <h3>
                  milk crown <span>(ミルククラウン)</span>
                </h3>
                <p>THE LUMAIRE SESSIONS · JUN KURODA · 24-BIT MASTER</p>
              </div>
              <button
                className={`track-play ${isPlaying ? "is-playing" : ""}`}
                type="button"
                onClick={togglePlay}
                aria-label={isPlaying ? "Pause track" : "Play track"}
                data-testid="lyric-demo-play"
                title={isPlaying ? "Pause demo" : "Play demo with live studio audio"}
              >
                {isPlaying ? (
                  <Pause size={17} fill="currentColor" />
                ) : (
                  <Play size={17} fill="currentColor" />
                )}
              </button>
              <button
                className="track-sound-toggle"
                type="button"
                onClick={toggleMute}
                aria-label={isMuted ? "Unmute audio" : "Mute audio"}
                title={isMuted ? "Enable studio audio" : "Mute studio audio"}
              >
                {isMuted ? <VolumeX size={15} /> : <Volume2 size={15} />}
              </button>
            </div>

            {/* Script Order & Visibility Controls */}
            <div className="lyric-toolbar">
              <div className="lyric-pills">
                <button
                  type="button"
                  className={`lyric-pill ${showNative && nativeFirst ? "is-active" : ""}`}
                  onClick={() => {
                    setShowNative(true);
                    setNativeFirst(true);
                  }}
                >
                  Native first
                </button>
                <button
                  type="button"
                  className={`lyric-pill ${showNative && !nativeFirst ? "is-active" : ""}`}
                  onClick={() => {
                    setShowNative(true);
                    setNativeFirst(false);
                  }}
                >
                  Romanised first
                </button>
                <button
                  type="button"
                  className={`lyric-pill ${!showNative ? "is-active" : ""}`}
                  onClick={() => setShowNative((prev) => !prev)}
                >
                  Off native
                </button>
              </div>
            </div>

            <div className="lyrics-list">
              {DEMO_LYRIC_LINES.map((line, index) => {
                const isActive = activeLineIndex === index;
                const isPrimaryNative = showNative && nativeFirst;
                return (
                  <button
                    className={`lyric-line ${isActive ? "is-active" : ""}`}
                    onClick={() => handleLineClick(line.timeStart)}
                    data-testid={`lyric-line-${index}`}
                    key={line.id}
                    type="button"
                  >
                    <strong>
                      {line.words.map((w, wIdx) => {
                        const isWordSung = isActive && isPlaying && currentTime >= w.start;
                        const displayText = isPrimaryNative ? w.native : w.rom;
                        return (
                          <span
                            key={wIdx}
                            className={`word ${isWordSung ? "is-sung" : ""}`}
                          >
                            {displayText}
                          </span>
                        );
                      })}
                    </strong>
                    {showNative && (
                      <span>
                        {nativeFirst ? line.romanized : line.native}
                      </span>
                    )}
                    <small>{line.english}</small>
                  </button>
                );
              })}
            </div>

            <div className="lyric-progress">
              <span>00:{Math.floor(currentTime).toString().padStart(2, "0")}</span>
              <div
                className="lyric-progress-bar"
                onClick={handleSeek}
                role="slider"
                aria-valuenow={currentTime}
                aria-valuemin={0}
                aria-valuemax={DEMO_DURATION}
                title="Click anywhere to seek"
              >
                <i
                  style={{
                    width: `${((currentTime / DEMO_DURATION) * 100).toFixed(1)}%`,
                  }}
                />
              </div>
              <span>00:{Math.floor(DEMO_DURATION).toString().padStart(2, "0")}</span>
            </div>
          </div>
        </div>
      </section>

      <section
        id="screenshots"
        className="screenshots-section section-pad"
        aria-labelledby="screenshots-heading"
      >
        <div className="layout-container screenshot-layout">
          <div className="screenshot-copy">
            <span className="section-kicker">/ A CLOSER LOOK</span>
            <h2 id="screenshots-heading" data-testid="screenshots-heading">
              Quietly <em>powerful.</em>
            </h2>
            <p data-testid="screenshots-copy">
              A clear, focused interface that keeps your library close and the controls right where
              you expect them.
            </p>
            <div className="screenshot-meta">
              <button
                type="button"
                className={`meta-tab ${focusedDevice === "desktop" ? "is-active" : ""}`}
                onMouseEnter={() => setFocusedDevice("desktop")}
                onMouseLeave={() => setFocusedDevice(null)}
                onClick={() => setFocusedDevice(focusedDevice === "desktop" ? null : "desktop")}
              >
                <b>01</b> Desktop player
              </button>
              <button
                type="button"
                className={`meta-tab ${focusedDevice === "phone" ? "is-active" : ""}`}
                onMouseEnter={() => setFocusedDevice("phone")}
                onMouseLeave={() => setFocusedDevice(null)}
                onClick={() => setFocusedDevice(focusedDevice === "phone" ? null : "phone")}
              >
                <b>02</b> Android companion
              </button>
            </div>
          </div>
          <div
            className={`screenshot-stack ${
              focusedDevice === "desktop"
                ? "focus-desktop"
                : focusedDevice === "phone"
                ? "focus-phone"
                : ""
            }`}
            data-testid="screenshot-gallery"
          >
            <div
              className="screenshot-back"
              onMouseEnter={() => setFocusedDevice("phone")}
              onMouseLeave={() => setFocusedDevice(null)}
              onClick={() => setFocusedDevice(focusedDevice === "phone" ? null : "phone")}
              title="Click or hover to focus Android"
            >
              <img
                src="/android.png"
                alt="Lumaire Android player interface"
                loading="lazy"
              />
            </div>
            <div
              className="screenshot-front"
              onMouseEnter={() => setFocusedDevice("desktop")}
              onMouseLeave={() => setFocusedDevice(null)}
              onClick={() => setFocusedDevice(focusedDevice === "desktop" ? null : "desktop")}
              title="Click or hover to focus Desktop"
            >
              <img
                src="/desktop.png"
                alt="Lumaire desktop interface with music library"
                loading="lazy"
              />
            </div>
          </div>
        </div>
      </section>

      <section className="install-section section-pad" aria-labelledby="install-heading">
        <div className="layout-container">
          <div className="section-heading-row install-heading">
            <div>
              <span className="section-kicker">/ INSTALLATION & VERIFICATION</span>
              <h2 id="install-heading" data-testid="install-heading">
                Simple,
                <br />
                <em>transparent install.</em>
              </h2>
            </div>
            <p className="section-intro">NO ADS. NO TRACKERS. 100% TRANSPARENT.</p>
          </div>
          <div className="install-grid">
            <article className="install-card" data-testid="windows-install-guide">
              <div className="install-number">01 / WINDOWS X64 · .EXE INSTALLER</div>
              <div className="install-title">
                <span className="platform-badge">&#x25A3;</span>
                <h3>Windows</h3>
              </div>
              <ol>
                <li>
                  <Check size={14} /> Run setup file
                </li>
                <li>
                  <Check size={14} /> SmartScreen: <b>“More info” → “Run anyway”</b>
                </li>
                <li>
                  <Check size={14} /> Ready — media keys integrate automatically
                </li>
              </ol>
              <span className="reassurance">Automatic updates included</span>
            </article>
            <article className="install-card" data-testid="android-install-guide">
              <div className="install-number">02 / ANDROID ARM64 · SIGNED APK</div>
              <div className="install-title">
                <span className="platform-badge">&#x25C8;</span>
                <h3>Android</h3>
              </div>
              <ol>
                <li>
                  <Check size={14} /> Download the signed APK
                </li>
                <li>
                  <Check size={14} /> Allow installs from this source
                </li>
                <li>
                  <Check size={14} /> Install & play — library preserved
                </li>
              </ol>
              <span className="reassurance">Signed with official release key</span>
            </article>
          </div>
          <div className="checksum-panel" data-testid="checksum-panel">
            <div>
              <span className="section-kicker">CRYPTOGRAPHIC CHECKSUM VERIFICATION · SHA-256</span>
              <p>Verify your download with PowerShell:</p>
              <code>Get-FileHash .\Lumaire_1.0.8_x64-setup.exe -Algorithm SHA256</code>
            </div>
            <div className="hashes">
              <span>
                <b>Windows EXE</b> a47d2056ecdb1aba0a37e036f4a0de791510287ac55d6375b8ee6f21682aec86
              </span>
              <span>
                <b>Android APK</b> 7c55e966670f34ae1ec52613e4d3c84c0da4d66ce42d4f4064c8014a717cef2e
              </span>
            </div>
            <a
              href="https://github.com/arushn47/lumaire-music-player/releases/download/v1.0.8/SHA256SUMS.txt"
              target="_blank"
              rel="noreferrer"
              data-testid="checksum-source-link"
            >
              Official SHA-256 source <ArrowUpRight size={13} />
            </a>
          </div>
        </div>
      </section>

      <section id="download" className="final-cta section-pad" aria-labelledby="cta-heading">
        <div className="cta-glow" />
        <div className="layout-container cta-inner">
          <span className="section-kicker">/ YOUR MUSIC AWAITS</span>
          <h2 id="cta-heading" data-testid="final-cta-heading">
            Make room for
            <br />
            <em>the good stuff.</em>
          </h2>
          <p data-testid="final-cta-copy">Free, open-source, and made to disappear into the music.</p>
          <DownloadButtons location="final" />
        </div>
      </section>

      <footer className="site-footer">
        <div className="layout-container footer-top">
          <div>
            <Brand compact testId="footer-brand-home-link" />
            <p data-testid="footer-attribution">
              Built with Tauri 2, Rust & React by Arush Nandakumar Menon.
            </p>
          </div>
          <div className="footer-links">
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noreferrer"
              data-testid="footer-repository-link"
            >
              Repository <ArrowUpRight size={13} />
            </a>
            <a
              href="https://github.com/arushn47/lumaire-music-player/releases"
              target="_blank"
              rel="noreferrer"
              data-testid="footer-releases-link"
            >
              Releases <ArrowUpRight size={13} />
            </a>
            <a
              href="https://arush.vercel.app"
              target="_blank"
              rel="noreferrer"
              data-testid="footer-developer-link"
            >
              Developer <ArrowUpRight size={13} />
            </a>
            <a
              href="https://github.com/arushn47/lumaire-music-player/issues"
              target="_blank"
              rel="noreferrer"
              data-testid="footer-issues-link"
            >
              Issues <ArrowUpRight size={13} />
            </a>
          </div>
        </div>
        <div className="layout-container footer-bottom">
          <span>&copy; {new Date().getFullYear()} Lumaire</span>
          <span>Open source · Built for listeners</span>
          <a href="#top" data-testid="footer-back-top-link">
            Back to top &uarr;
          </a>
        </div>
      </footer>
    </main>
  );
}

export default App;
