import { describe, it, expect } from 'vitest';
import { captureCheckpoint, validateCheckpoint, restoreFromCheckpoint, estimatePosition, handoffPlaybackState, formatCheckpointAge, CHECKPOINT_TTL_MS, isCheckpointExpired } from './playback-checkpoint';
import type { Session, Track } from './types';
import { defaults } from './types';

const catalogTrack = (id: string, title: string): Track => ({
  id,
  title,
  artist: 'Artist',
  album: 'Album',
  duration: 180,
  fileName: '',
  missing: false,
  format: 'catalog',
  metadataSourceId: id,
});

const youtubeTrack = (sourceId: string, title: string): Track => ({
  id: `youtube:${sourceId}`,
  title,
  artist: 'Creator',
  album: 'Videos',
  duration: 210,
  fileName: '',
  missing: false,
  format: 'webm',
  source: {
    providerId: 'youtube',
    sourceId,
    pageUrl: `https://www.youtube.com/watch?v=${sourceId}`,
    license: 'CC-BY',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    attribution: 'Test Attribution',
  },
});

const localTrack = (fileName: string): Track => ({
  id: 'local-' + fileName,
  title: 'Local Song',
  artist: 'Local Artist',
  album: 'Local Album',
  duration: 195,
  fileName,
  missing: false,
  format: 'mp3',
});

describe('captureCheckpoint', () => {
  it('captures basic playback state', () => {
    const track = catalogTrack('saavn:abc12345', 'Test Song');
    const session: Session = {
      ...defaults(),
      queue: [{ id: 'q1', trackId: track.id }],
      queueTracks: { [track.id]: track },
      currentId: 'q1',
      position: 42,
    };

    const checkpoint = captureCheckpoint(session, [], 42.5, true, 'device-123', 'My Laptop');

    expect(checkpoint).not.toBeNull();
    expect(checkpoint!.version).toBe(1);
    expect(checkpoint!.deviceId).toBe('device-123');
    expect(checkpoint!.deviceName).toBe('My Laptop');
    expect(checkpoint!.playing).toBe(true);
    expect(checkpoint!.position).toBe(42.5);
    expect(checkpoint!.currentEntryId).toBe('q1');
    expect(checkpoint!.queue).toHaveLength(1);
    expect(checkpoint!.queue[0].trackId).toBe(track.id);
    expect(checkpoint!.queue[0].metadata.title).toBe('Test Song');
  });

  it('returns null when no current track', () => {
    const session: Session = {
      ...defaults(),
      queue: [],
      currentId: null,
    };

    const checkpoint = captureCheckpoint(session, [], 0, false, 'device-123');
    expect(checkpoint).toBeNull();
  });

  it('excludes local-only tracks from queue', () => {
    const catalog = catalogTrack('saavn:abc12345', 'Remote Song');
    const local = localTrack('/music/local.mp3');
    const youtube = youtubeTrack('dQw4w9WgXcQ', 'YouTube Song');

    const session: Session = {
      ...defaults(),
      queue: [
        { id: 'q1', trackId: catalog.id },
        { id: 'q2', trackId: local.id },
        { id: 'q3', trackId: youtube.id },
      ],
      queueTracks: {
        [catalog.id]: catalog,
        [local.id]: local,
        [youtube.id]: youtube,
      },
      currentId: 'q1',
    };

    const checkpoint = captureCheckpoint(session, [], 10, false, 'device-123');

    expect(checkpoint).not.toBeNull();
    expect(checkpoint!.queue).toHaveLength(2);
    expect(checkpoint!.queue.map(e => e.id)).toEqual(['q1', 'q3']);
    expect(checkpoint!.queue.every(e => e.metadata.fileName === '')).toBe(true);
  });

  it('limits queue to MAX_QUEUE_SIZE entries', () => {
    // Create valid 8-character catalog IDs
    const tracks: Track[] = Array.from({ length: 250 }, (_, i) => {
      const trackId = `tr${String(i).padStart(6, '0')}`;
      return catalogTrack(`saavn:${trackId}`, `Song ${i}`);
    });

    const session: Session = {
      ...defaults(),
      queue: tracks.map((t, i) => ({ id: `q${i}`, trackId: t.id })),
      queueTracks: Object.fromEntries(tracks.map(t => [t.id, t])),
      currentId: 'q0',
    };

    const checkpoint = captureCheckpoint(session, [], 0, false, 'device-123');

    expect(checkpoint).not.toBeNull();
    expect(checkpoint!.queue.length).toBeLessThanOrEqual(200);
    expect(checkpoint!.queue[0].id).toBe('q0'); // Current track included
  });

  it('captures shuffle state and order', () => {
    const t1 = catalogTrack('saavn:aaa11111', 'Song A');
    const t2 = catalogTrack('saavn:bbb22222', 'Song B');
    const t3 = catalogTrack('saavn:ccc33333', 'Song C');

    const session: Session = {
      ...defaults(),
      queue: [
        { id: 'q1', trackId: t1.id },
        { id: 'q2', trackId: t2.id },
        { id: 'q3', trackId: t3.id },
      ],
      queueTracks: { [t1.id]: t1, [t2.id]: t2, [t3.id]: t3 },
      currentId: 'q1',
      shuffleOrder: ['q1', 'q3', 'q2'],
      settings: {
        ...defaults().settings,
        shuffle: true,
        repeat: 'all',
      },
    };

    const checkpoint = captureCheckpoint(session, [], 0, false, 'device-123');

    expect(checkpoint).not.toBeNull();
    expect(checkpoint!.shuffle).toBe(true);
    expect(checkpoint!.repeat).toBe('all');
    expect(checkpoint!.shuffleOrder).toEqual(['q1', 'q3', 'q2']);
  });

  it('detects playlist context when queue matches playlist exactly', () => {
    const t1 = catalogTrack('saavn:aaa11111', 'Song A');
    const t2 = catalogTrack('saavn:bbb22222', 'Song B');

    const session: Session = {
      ...defaults(),
      queue: [
        { id: 'q1', trackId: t1.id },
        { id: 'q2', trackId: t2.id },
      ],
      queueTracks: { [t1.id]: t1, [t2.id]: t2 },
      currentId: 'q1',
      playlists: [
        {
          id: 'playlist-1',
          name: 'My Playlist',
          items: [
            { id: 'q1', trackId: t1.id },
            { id: 'q2', trackId: t2.id },
          ],
        },
      ],
    };

    const checkpoint = captureCheckpoint(session, [], 0, false, 'device-123');

    expect(checkpoint).not.toBeNull();
    expect(checkpoint!.playlistId).toBe('playlist-1');
    expect(checkpoint!.playlistName).toBe('My Playlist');
  });

  it('preserves requested flag on queue entries', () => {
    const t1 = catalogTrack('saavn:aaa11111', 'Song A');
    const t2 = catalogTrack('saavn:bbb22222', 'Song B');

    const session: Session = {
      ...defaults(),
      queue: [
        { id: 'q1', trackId: t1.id },
        { id: 'q2', trackId: t2.id, requested: true },
      ],
      queueTracks: { [t1.id]: t1, [t2.id]: t2 },
      currentId: 'q1',
    };

    const checkpoint = captureCheckpoint(session, [], 0, false, 'device-123');

    expect(checkpoint).not.toBeNull();
    expect(checkpoint!.queue[0].requested).toBeUndefined();
    expect(checkpoint!.queue[1].requested).toBe(true);
  });
});

describe('validateCheckpoint', () => {
  const validCheckpoint = () => ({
    version: 1,
    id: crypto.randomUUID(),
    deviceId: 'device-123',
    capturedAt: Date.now(),
    playing: false,
    currentEntryId: 'q1',
    position: 42,
    queue: [
      {
        id: 'q1',
        trackId: 'saavn:abc12345',
        metadata: catalogTrack('saavn:abc12345', 'Test Song'),
      },
    ],
    shuffleOrder: [],
    shuffle: false,
    repeat: 'off' as const,
  });

  it('accepts valid checkpoint', () => {
    const result = validateCheckpoint(validCheckpoint());
    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('rejects non-object', () => {
    expect(validateCheckpoint(null).valid).toBe(false);
    expect(validateCheckpoint('string').valid).toBe(false);
    expect(validateCheckpoint(123).valid).toBe(false);
  });

  it('rejects unsupported version', () => {
    const checkpoint = { ...validCheckpoint(), version: 99 };
    const result = validateCheckpoint(checkpoint);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('version');
  });

  it('rejects invalid position', () => {
    const negative = { ...validCheckpoint(), position: -5 };
    expect(validateCheckpoint(negative).valid).toBe(false);

    const tooLarge = { ...validCheckpoint(), position: 90000 };
    expect(validateCheckpoint(tooLarge).valid).toBe(false);
  });

  it('rejects empty queue', () => {
    const checkpoint = { ...validCheckpoint(), queue: [] };
    expect(validateCheckpoint(checkpoint).valid).toBe(false);
  });

  it('rejects oversized queue', () => {
    const checkpoint = {
      ...validCheckpoint(),
      queue: Array.from({ length: 250 }, (_, i) => {
        const trackId = `tr${String(i).padStart(6, '0')}`;
        return {
          id: `q${i}`,
          trackId: `saavn:${trackId}`,
          metadata: catalogTrack(`saavn:${trackId}`, `Song ${i}`),
        };
      }),
    };
    const result = validateCheckpoint(checkpoint);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('queue size');
  });

  it('rejects queue entry with local-only track', () => {
    const checkpoint = {
      ...validCheckpoint(),
      queue: [
        {
          id: 'q1',
          trackId: 'local-song',
          metadata: localTrack('/music/song.mp3'),
        },
      ],
    };
    const result = validateCheckpoint(checkpoint);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('local-only');
  });

  it('rejects invalid repeat value', () => {
    const checkpoint = { ...validCheckpoint(), repeat: 'invalid' };
    const result = validateCheckpoint(checkpoint);
    expect(result.valid).toBe(false);
  });
});

describe('restoreFromCheckpoint', () => {
  it('restores queue and playback state', () => {
    const t1 = catalogTrack('saavn:aaa11111', 'Song A');
    const t2 = catalogTrack('saavn:bbb22222', 'Song B');

    const checkpoint = {
      version: 1,
      id: crypto.randomUUID(),
      deviceId: 'source-device',
      capturedAt: Date.now(),
      playing: true,
      currentEntryId: 'q1',
      position: 75.5,
      queue: [
        { id: 'q1', trackId: t1.id, metadata: t1 },
        { id: 'q2', trackId: t2.id, metadata: t2 },
      ],
      shuffleOrder: ['q1', 'q2'],
      shuffle: true,
      repeat: 'all' as const,
    };

    const currentSession = defaults();
    const restored = restoreFromCheckpoint(checkpoint, currentSession);

    expect(restored.queue).toHaveLength(2);
    expect(restored.queue[0].id).toBe('q1');
    expect(restored.queue[1].id).toBe('q2');
    expect(restored.currentId).toBe('q1');
    expect(restored.position).toBe(75.5);
    expect(restored.settings.shuffle).toBe(true);
    expect(restored.settings.repeat).toBe('all');
    expect(restored.shuffleOrder).toEqual(['q1', 'q2']);
    expect(restored.queueTracks[t1.id]).toEqual(t1);
    expect(restored.queueTracks[t2.id]).toEqual(t2);
  });

  it('throws on invalid checkpoint', () => {
    const invalid = { version: 99, queue: [] };
    expect(() => restoreFromCheckpoint(invalid as any, defaults())).toThrow();
  });

  it('preserves existing session fields not in checkpoint', () => {
    const checkpoint = {
      version: 1,
      id: crypto.randomUUID(),
      deviceId: 'source',
      capturedAt: Date.now(),
      playing: false,
      currentEntryId: 'q1',
      position: 0,
      queue: [
        {
          id: 'q1',
          trackId: 'saavn:abc12345',
          metadata: catalogTrack('saavn:abc12345', 'Song'),
        },
      ],
      shuffleOrder: [],
      shuffle: false,
      repeat: 'off' as const,
    };

    const currentSession = {
      ...defaults(),
      favorites: ['fav1', 'fav2'],
      playlists: [{ id: 'p1', name: 'My Playlist', items: [] }],
    };

    const restored = restoreFromCheckpoint(checkpoint, currentSession);

    expect(restored.favorites).toEqual(['fav1', 'fav2']);
    expect(restored.playlists).toHaveLength(1);
    expect(restored.playlists[0].name).toBe('My Playlist');
  });

  it('restores requested flags on queue entries', () => {
    const checkpoint = {
      version: 1,
      id: crypto.randomUUID(),
      deviceId: 'source',
      capturedAt: Date.now(),
      playing: false,
      currentEntryId: 'q1',
      position: 0,
      queue: [
        {
          id: 'q1',
          trackId: 'saavn:aaa11111',
          metadata: catalogTrack('saavn:aaa11111', 'Song A'),
        },
        {
          id: 'q2',
          trackId: 'saavn:bbb22222',
          metadata: catalogTrack('saavn:bbb22222', 'Song B'),
          requested: true,
        },
      ],
      shuffleOrder: [],
      shuffle: false,
      repeat: 'off' as const,
    };

    const restored = restoreFromCheckpoint(checkpoint, defaults());

    expect(restored.queue[0].requested).toBeUndefined();
    expect(restored.queue[1].requested).toBe(true);
  });
});

describe('estimatePosition', () => {
  it('returns saved position when paused', () => {
    const checkpoint = {
      version: 1,
      id: crypto.randomUUID(),
      deviceId: 'device',
      capturedAt: Date.now() - 60000, // 1 minute ago
      playing: false,
      currentEntryId: 'q1',
      position: 42,
      queue: [
        {
          id: 'q1',
          trackId: 'saavn:abc12345',
          metadata: catalogTrack('saavn:abc12345', 'Song'),
        },
      ],
      shuffleOrder: [],
      shuffle: false,
      repeat: 'off' as const,
    };

    const estimated = estimatePosition(checkpoint);
    expect(estimated).toBe(42);
  });

  it('advances position when playing', () => {
    const capturedAt = Date.now() - 10000; // 10 seconds ago
    const checkpoint = {
      version: 1,
      id: crypto.randomUUID(),
      deviceId: 'device',
      capturedAt,
      playing: true,
      currentEntryId: 'q1',
      position: 30,
      queue: [
        {
          id: 'q1',
          trackId: 'saavn:abc12345',
          metadata: catalogTrack('saavn:abc12345', 'Song'),
        },
      ],
      shuffleOrder: [],
      shuffle: false,
      repeat: 'off' as const,
    };

    const estimated = estimatePosition(checkpoint, capturedAt + 10000);
    expect(estimated).toBeGreaterThan(30);
    expect(estimated).toBeLessThanOrEqual(40); // Approximate due to timing
  });

  it('clamps position to track duration', () => {
    const track = catalogTrack('saavn:abc12345', 'Short Song');
    track.duration = 60; // 1 minute

    const checkpoint = {
      version: 1,
      id: crypto.randomUUID(),
      deviceId: 'device',
      capturedAt: Date.now() - 120000, // 2 minutes ago
      playing: true,
      currentEntryId: 'q1',
      position: 50,
      queue: [{ id: 'q1', trackId: track.id, metadata: track }],
      shuffleOrder: [],
      shuffle: false,
      repeat: 'off' as const,
    };

    const estimated = estimatePosition(checkpoint);
    expect(estimated).toBeLessThanOrEqual(60);
  });

  it('clamps an already out-of-range saved position for paused and playing tracks', () => {
    const track = catalogTrack('saavn:abc12345', 'Short Song');
    track.duration = 60;
    const checkpoint = {
      version: 1, id: 'checkpoint', deviceId: 'device', capturedAt: 1000, playing: false,
      currentEntryId: 'q1', position: 90,
      queue: [{ id: 'q1', trackId: track.id, metadata: track }],
      shuffleOrder: [], shuffle: false, repeat: 'off' as const,
    };
    expect(estimatePosition(checkpoint, 11000)).toBe(60);
    expect(estimatePosition({ ...checkpoint, playing: true }, 11000)).toBe(60);
  });

  it('never returns negative position', () => {
    const checkpoint = {
      version: 1,
      id: crypto.randomUUID(),
      deviceId: 'device',
      capturedAt: Date.now(),
      playing: false,
      currentEntryId: 'q1',
      position: 0,
      queue: [
        {
          id: 'q1',
          trackId: 'saavn:abc12345',
          metadata: catalogTrack('saavn:abc12345', 'Song'),
        },
      ],
      shuffleOrder: [],
      shuffle: false,
      repeat: 'off' as const,
    };

    const estimated = estimatePosition(checkpoint);
    expect(estimated).toBeGreaterThanOrEqual(0);
  });
});

describe('handoff playback state', () => {
  it('preserves pause state and advances position only for a playing source', () => {
    const paused = {
      version: 1, id: 'checkpoint', deviceId: 'device', playing: false, position: 12, capturedAt: 1000,
      currentEntryId: 'q1', queue: [{ id: 'q1', trackId: 'saavn:abc12345', metadata: catalogTrack('saavn:abc12345', 'Song') }],
      shuffleOrder: [], shuffle: false, repeat: 'off' as const,
    };
    expect(handoffPlaybackState(paused, 11000)).toEqual({ autoplay: false, position: 12 });
    const playing = { ...paused, playing: true };
    expect(handoffPlaybackState(playing, 11000)).toEqual({ autoplay: true, position: 22 });
  });
});

describe('formatCheckpointAge', () => {
  it('formats recent timestamps', () => {
    const now = Date.now();
    expect(formatCheckpointAge(now - 5000, now)).toBe('Just now');
    expect(formatCheckpointAge(now - 30000, now)).toBe('Just now');
  });

  it('formats minutes', () => {
    const now = Date.now();
    expect(formatCheckpointAge(now - 60000, now)).toBe('1 minute ago');
    expect(formatCheckpointAge(now - 120000, now)).toBe('2 minutes ago');
    expect(formatCheckpointAge(now - 1800000, now)).toBe('30 minutes ago');
  });

  it('formats hours', () => {
    const now = Date.now();
    expect(formatCheckpointAge(now - 3600000, now)).toBe('1 hour ago');
    expect(formatCheckpointAge(now - 7200000, now)).toBe('2 hours ago');
  });

  it('formats days', () => {
    const now = Date.now();
    expect(formatCheckpointAge(now - 86400000, now)).toBe('1 day ago');
    expect(formatCheckpointAge(now - 172800000, now)).toBe('2 days ago');
  });
});

describe('checkpoint expiration', () => {
  it('enforces a 1 hour TTL for cross-device handoff', () => {
    expect(CHECKPOINT_TTL_MS).toBe(60 * 60 * 1000);
    const now = Date.now();
    const cpFresh = { capturedAt: now - 30 * 60 * 1000 } as any;
    const cpStale = { capturedAt: now - 61 * 60 * 1000 } as any;
    expect(isCheckpointExpired(cpFresh, now)).toBe(false);
    expect(isCheckpointExpired(cpStale, now)).toBe(true);
  });
});
