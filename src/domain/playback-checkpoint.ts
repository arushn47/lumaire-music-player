import type { QueueItem, Session, Track } from './types';
import { portableTrack } from './nearby';
import { playbackQueue } from './queue';

const CHECKPOINT_VERSION = 1;
const MAX_QUEUE_SIZE = 200;
const MAX_SERIALIZED_SIZE = 500_000; // ~500KB conservative limit
export const CHECKPOINT_TTL_MS = 60 * 60 * 1000; // 1 hour handoff window

export function isCheckpointExpired(checkpoint: PlaybackCheckpoint, nowMs: number = Date.now()): boolean {
  return (nowMs - checkpoint.capturedAt) > CHECKPOINT_TTL_MS;
}

export interface PlaybackCheckpoint {
  version: number;
  id: string;
  deviceId: string;
  deviceName?: string;
  capturedAt: number;
  playing: boolean;
  currentEntryId: string | null;
  position: number;
  queue: Array<{ id: string; trackId: string; metadata: Track; requested?: boolean }>;
  shuffleOrder: string[];
  shuffle: boolean;
  repeat: 'off' | 'all' | 'one';
  playlistId?: string;
  playlistName?: string;
}

export interface CheckpointValidation {
  valid: boolean;
  error?: string;
}

/**
 * Capture playback state snapshot from current session.
 * Excludes local-only tracks and limits queue size.
 */
export function captureCheckpoint(
  session: Session,
  tracks: Track[],
  currentTime: number,
  playing: boolean,
  deviceId: string,
  deviceName?: string,
): PlaybackCheckpoint | null {
  if (!session.currentId || !session.queue.length) return null;

  const saved = new Map(tracks.map(t => [t.id, t]));
  const order = playbackQueue(session);
  const currentIndex = order.findIndex(e => e.id === session.currentId);
  if (currentIndex === -1) return null;

  // Include current + upcoming tracks up to limit
  const relevantEntries = order.slice(currentIndex, currentIndex + MAX_QUEUE_SIZE);
  
  const queueWithMetadata = relevantEntries.flatMap(entry => {
    const track = session.queueTracks[entry.trackId] || saved.get(entry.trackId);
    if (!track) return [];
    const portable = portableTrack(track);
    if (!portable) return []; // Skip local-only files
    return [{ 
      id: entry.id, 
      trackId: portable.id, 
      metadata: portable,
      ...(entry.requested ? { requested: true } : {})
    }];
  });

  if (!queueWithMetadata.length) return null;

  // Determine playlist context if queue matches a playlist
  let playlistContext: { playlistId: string; playlistName: string } | undefined;
  const currentPlaylist = session.playlists.find(p => {
    if (p.items.length !== session.queue.length) return false;
    return p.items.every((item, i) => item.id === session.queue[i].id && item.trackId === session.queue[i].trackId);
  });
  if (currentPlaylist) {
    playlistContext = { playlistId: currentPlaylist.id, playlistName: currentPlaylist.name };
  }

  const checkpoint: PlaybackCheckpoint = {
    version: CHECKPOINT_VERSION,
    id: crypto.randomUUID(),
    deviceId,
    ...(deviceName ? { deviceName } : {}),
    capturedAt: Date.now(),
    playing,
    currentEntryId: session.currentId,
    position: Math.max(0, currentTime),
    queue: queueWithMetadata,
    shuffleOrder: session.shuffleOrder.filter(id => queueWithMetadata.some(e => e.id === id)),
    shuffle: session.settings.shuffle,
    repeat: session.settings.repeat,
    ...(playlistContext ? playlistContext : {}),
  };

  return checkpoint;
}

/**
 * Validate checkpoint structure and size limits.
 */
export function validateCheckpoint(checkpoint: unknown): CheckpointValidation {
  if (!checkpoint || typeof checkpoint !== 'object') {
    return { valid: false, error: 'Invalid checkpoint format' };
  }

  const cp = checkpoint as PlaybackCheckpoint;

  if (cp.version !== CHECKPOINT_VERSION) {
    return { valid: false, error: `Unsupported checkpoint version: ${cp.version}` };
  }

  if (typeof cp.id !== 'string' || typeof cp.deviceId !== 'string' || 
      typeof cp.capturedAt !== 'number' || typeof cp.playing !== 'boolean' ||
      typeof cp.position !== 'number' || typeof cp.shuffle !== 'boolean' ||
      !['off', 'all', 'one'].includes(cp.repeat)) {
    return { valid: false, error: 'Missing or invalid checkpoint fields' };
  }

  if (cp.position < 0 || cp.position > 86400) {
    return { valid: false, error: 'Invalid position' };
  }

  if (!Array.isArray(cp.queue) || cp.queue.length === 0 || cp.queue.length > MAX_QUEUE_SIZE) {
    return { valid: false, error: 'Invalid queue size' };
  }

  if (!Array.isArray(cp.shuffleOrder)) {
    return { valid: false, error: 'Invalid shuffleOrder' };
  }

  // Validate each queue entry has portable track
  for (const entry of cp.queue) {
    if (!entry.id || !entry.trackId || !entry.metadata) {
      return { valid: false, error: 'Invalid queue entry' };
    }
    const portable = portableTrack(entry.metadata);
    if (!portable || portable.id !== entry.trackId) {
      return { valid: false, error: 'Queue entry contains local-only or invalid track' };
    }
  }

  // Check serialized size
  try {
    const serialized = JSON.stringify(cp);
    if (serialized.length > MAX_SERIALIZED_SIZE) {
      return { valid: false, error: 'Checkpoint exceeds size limit' };
    }
  } catch {
    return { valid: false, error: 'Checkpoint serialization failed' };
  }

  return { valid: true };
}

/**
 * Restore session from checkpoint.
 * Returns new session with restored queue, position, and settings.
 */
export function restoreFromCheckpoint(
  checkpoint: PlaybackCheckpoint,
  currentSession: Session,
): Session {
  const validation = validateCheckpoint(checkpoint);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  const queue: QueueItem[] = checkpoint.queue.map(e => ({
    id: e.id,
    trackId: e.trackId,
    ...(e.requested ? { requested: true } : {})
  }));

  const queueTracks: Record<string, Track> = {};
  checkpoint.queue.forEach(e => {
    queueTracks[e.trackId] = e.metadata;
  });

  return {
    ...currentSession,
    queue,
    queueTracks: { ...currentSession.queueTracks, ...queueTracks },
    currentId: checkpoint.currentEntryId,
    position: checkpoint.position,
    shuffleOrder: checkpoint.shuffleOrder,
    settings: {
      ...currentSession.settings,
      shuffle: checkpoint.shuffle,
      repeat: checkpoint.repeat,
    },
  };
}

/**
 * Calculate adjusted position based on elapsed time since capture.
 * Only advances if checkpoint was playing; clamps to reasonable bounds.
 */
export function estimatePosition(
  checkpoint: PlaybackCheckpoint,
  nowMs: number = Date.now(),
): number {
  const currentEntry = checkpoint.queue.find(e => e.id === checkpoint.currentEntryId);
  const trackDuration = currentEntry?.metadata.duration || Number.POSITIVE_INFINITY;
  if (!checkpoint.playing) return Math.min(Math.max(0, checkpoint.position), trackDuration);

  const elapsedSeconds = Math.max(0, nowMs - checkpoint.capturedAt) / 1000;
  
  // Don't advance beyond track duration or by more than reasonable clock drift (30 min)
  const maxAdvance = Math.min(trackDuration - checkpoint.position, 1800);
  const adjustment = Math.min(elapsedSeconds, maxAdvance);
  
  return Math.min(trackDuration, Math.max(0, checkpoint.position + adjustment));
}

export function handoffPlaybackState(checkpoint: PlaybackCheckpoint, nowMs: number = Date.now()): { autoplay: boolean; position: number } {
  return { autoplay: checkpoint.playing, position: estimatePosition(checkpoint, nowMs) };
}

/**
 * Format relative time string for checkpoint age.
 */
export function formatCheckpointAge(capturedAt: number, nowMs: number = Date.now()): string {
  const seconds = Math.floor((nowMs - capturedAt) / 1000);
  
  if (seconds < 60) return 'Just now';
  if (seconds < 3600) {
    const minutes = Math.floor(seconds / 60);
    return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'} ago`;
  }
  if (seconds < 86400) {
    const hours = Math.floor(seconds / 3600);
    return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  }
  const days = Math.floor(seconds / 86400);
  return `${days} ${days === 1 ? 'day' : 'days'} ago`;
}
