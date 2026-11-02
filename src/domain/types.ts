export interface Track {
  recordingMetadata?: RecordingMetadata | null;
  id: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
  fileName: string;
  missing: boolean;
  format: string;
  /** Stable provider identity only. Expiring stream URLs are never persisted. */
  source?: RemoteSource;
  artworkUrl?: string | null;
  /** Catalogue identity; audio-provider credits cannot replace these details. */
  metadataSourceId?: string | null;
  /** Backend-owned offline copy, never a renderer-provided filesystem path. */
  offline?: boolean;
}
export interface RecordingMetadata {
  sourceId: string;
  isrcs: string[];
  releaseDate: string | null;
  artistAliases: Record<string, string[]>;
}
export interface RemoteSource {
  providerId: string;
  sourceId: string;
  pageUrl: string;
  license: string;
  licenseUrl: string;
  attribution: string;
}
export interface QueueItem {
  id: string;
  trackId: string;
  requested?: boolean;
}
export interface Playlist {
  updatedAt?: number;
  importSources?: string[];
  syncSource?: string;
  syncFingerprint?: string;
  syncLocalFingerprint?: string;
  id: string;
  name: string;
  items: QueueItem[];
}
export interface LyricLine {
  id: string;
  time: number | null;
  text: string;
  words?: { time: number; end?: number; text: string }[];
}
export interface LyricDocument {
  origin?: "provider" | "imported";
  id: string;
  raw: string;
  fileName: string;
  lines: LyricLine[];
  fileOffset: number;
  userOffset: number;
  warnings: string[];
  romanisation: Record<string, string>;
  translation: Record<string, string>;
  romanisationSource?: "local" | "gemini" | "google" | "imported";
  localRomanisation?: Record<string, string>;
  translationSource?: "gemini" | "google" | "imported";
  processedModel?: string;
  lineLanguages?: Record<string, string[]>;
  languageSource?: "local" | "gemini" | "google";
  englishOnly?: boolean;
  instrumental?: boolean;
  timingMode?: "synced" | "unsynced";
  source?: {
    provider: "lrclib" | "lrc.red";
    recordId: number | string;
    title: string;
    artist: string;
    duration: number;
  };
}
export interface Preferences {
  fullscreenLayout?: "immersive" | "minimal";
  themeMode: "dark" | "light";
  accentColor: string;
  volume: number;
  repeat: "off" | "all" | "one";
  shuffle: boolean;
  romanisation: boolean;
  translation: boolean;
  originalScript: boolean;
  originalFirst: boolean;
  autoOpenLyrics: boolean;
  autoplay: boolean;
  estimatedScroll: boolean;
  geminiModel: string;
  lyricSize: number;
  historyEnabled: boolean;
  autoGemini: boolean;
}
export interface ListeningResume {
  id: string;
  kind: 'album' | 'playlist' | 'queue';
  title: string;
  queue: QueueItem[];
  queueTracks: Record<string, Track>;
  currentId: string;
  position: number;
  shuffleOrder: string[];
  shuffle: boolean;
  updatedAt: number;
}
export interface Session {
    nativeQueueRevision?: number;
    nativeQueueEpoch?: string;
    nativePositionAt?: number;
  replica?: import('./device-sync').PlaylistReplica;
  listeningResumes?: ListeningResume[];
  favoriteArtists: { id: string; name: string; artworkUrl?: string | null }[];
  favoriteAlbums: { id: string; title: string; artist: string; artworkUrl?: string | null; year?: number | null }[];
  queue: QueueItem[];
  shuffleOrder: string[];
  /** Remote metadata needed for this listening session, never library membership. */
  queueTracks: Record<string, Track>;
  currentId: string | null;
  position: number;
  favorites: string[];
  playlists: Playlist[];
  lyrics: Record<string, LyricDocument>;
  settings: Preferences;
  history: { trackId: string; at: string }[];
}
export interface Snapshot {
  tracks: Track[];
  session: Session | null;
}
export const defaults = (): Session => ({
  favoriteArtists: [],
  favoriteAlbums: [],
  queue: [],
  shuffleOrder: [],
  queueTracks: {},
  currentId: null,
  position: 0,
  favorites: [],
  playlists: [],
  lyrics: {},
  history: [],
  settings: {
    themeMode: "dark",
    accentColor: "#c4dca3",
    volume: 0.75,
    repeat: "off",
    shuffle: false,
    romanisation: true,
    translation: true,
    originalScript: true,
    originalFirst: true,
    autoOpenLyrics: false,
    autoplay: false,
    estimatedScroll: true,
    geminiModel: "gemini-3.5-flash-lite",
    lyricSize: 32,
    historyEnabled: true,
    autoGemini: true,
  },
});
export const item = (trackId: string): QueueItem => ({
  id: crypto.randomUUID(),
  trackId,
});
export type EngineInstallState = "checking" | "missing" | "installing" | "installed" | "error";
export interface EngineInstallProgress {
  stage: "connecting" | "retrying" | "downloading" | "verifying" | "testing" | "activating";
  component: string;
  received: number;
  total: number | null;
  attempt: number;
}
