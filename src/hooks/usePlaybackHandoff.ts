import { useEffect, useState, useCallback } from 'react';
import { checkpoint } from '../adapters/collections';
import type { PlaybackCheckpoint } from '../domain/playback-checkpoint';
import { restoreFromCheckpoint, validateCheckpoint, CHECKPOINT_TTL_MS, handoffPlaybackState } from '../domain/playback-checkpoint';
import type { Session, Track } from '../domain/types';
import { isQueuedCatalog, resolveQueueEntry } from '../domain/queue';
import { playbackTracks } from '../player/service';
import { desktop } from '../adapters/native';

export function usePlaybackHandoff(options: {
  ready: boolean;
  session: Session;
  tracks: Track[];
  update: (fn: (s: Session) => Session) => void;
  notify: (message: string) => void;
  player: { load: (trackId: string, autoplay: boolean, startTime?: number) => Promise<void> };
  resolve?: (track: Track) => Promise<Track>;
}) {
  const [availableCheckpoints, setAvailableCheckpoints] = useState<PlaybackCheckpoint[]>([]);
  const [dismissedCheckpoints, setDismissedCheckpoints] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);

  // Load checkpoints on mount, periodically, and when coming back online/foreground
  const loadCheckpoints = useCallback(async () => {
    if (!options.ready || !desktop) return;
    
    try {
      let localDeviceId = localStorage.getItem('lumaire-device-id');
      try {
        const { collections } = await import('../adapters/collections');
        const sync = await collections.syncState();
        if (sync.deviceId) {
          localDeviceId = sync.deviceId;
          localStorage.setItem('lumaire-device-id', sync.deviceId);
        }
      } catch { /* offline / mock */ }
      
      const checkpoints = await checkpoint.getAll() as PlaybackCheckpoint[];
      const now = Date.now();
      
      // Filter out local device checkpoint, expired checkpoints, and invalid ones
      const remoteCheckpoints = checkpoints.filter(cp => {
        if (localDeviceId && cp.deviceId === localDeviceId) return false;
        
        // Check if checkpoint is older than 1 hour
        const age = now - cp.capturedAt;
        if (age > CHECKPOINT_TTL_MS) {
          // Delete expired checkpoint asynchronously
          void checkpoint.delete(cp.deviceId).catch(err => 
            console.warn('Failed to delete expired checkpoint:', err)
          );
          return false;
        }
        
        const validation = validateCheckpoint(cp);
        return validation.valid;
      });
      
      setAvailableCheckpoints(remoteCheckpoints);
    } catch (err) {
      console.warn('Failed to load checkpoints:', err);
    }
  }, [options.ready]);

  useEffect(() => {
    if (!options.ready) return;
    
    void loadCheckpoints();
    
    // Poll for checkpoints delivered via background sync
    const timer = setInterval(() => void loadCheckpoints(), 5000);
    
    // Reload on window focus
    const onFocus = () => void loadCheckpoints();
    window.addEventListener('focus', onFocus);
    
    // Reload on visibility change
    const onVisible = () => {
      if (!document.hidden) void loadCheckpoints();
    };
    document.addEventListener('visibilitychange', onVisible);
    
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [options.ready, loadCheckpoints]);

  const visibleCheckpoint = availableCheckpoints
    .filter(cp => !dismissedCheckpoints.has(cp.id))
    .sort((a, b) => b.capturedAt - a.capturedAt)[0];

  const handleContinue = useCallback(async (cp: PlaybackCheckpoint) => {
    if (loading) return;
    setLoading(true);
    
    try {
      // Restore session from checkpoint
      const restored = restoreFromCheckpoint(cp, options.session);
      
      // Update session with restored state
      options.update(() => restored);
      
      // Try to load and play the current track
      const currentEntry = restored.queue.find(e => e.id === restored.currentId);
      if (currentEntry) {
        let track = restored.queueTracks[currentEntry.trackId];
        if (track) {
          // Resolve catalog track to playable source
          if (isQueuedCatalog(track)) {
            if (!options.resolve) {
              options.notify('Track resolution not available');
              return;
            }
            try {
              options.notify('Resolving track...');
              const resolved = await options.resolve(track);
              if (resolved && !isQueuedCatalog(resolved)) {
                playbackTracks.set(resolved.id, resolved);
                options.update(s => resolveQueueEntry(s, currentEntry.id, track.id, resolved));
                track = resolved;
              } else {
                options.notify('Could not resolve track source');
                return;
              }
            } catch (err) {
              console.error('Failed to resolve catalog track for handoff:', err);
              options.notify(`Track unavailable: ${err instanceof Error ? err.message : 'Resolution failed'}`);
              return;
            }
          }
          
          // Load track at checkpoint position and start playback
          const playback = handoffPlaybackState(cp);
          await options.player.load(track.id, playback.autoplay, playback.position);
          options.notify(`Resuming from ${cp.deviceName || 'other device'}`);
          
          // Delete the used checkpoint so source device knows handoff occurred
          try {
            await checkpoint.delete(cp.deviceId);
          } catch (err) {
            console.warn('Failed to delete checkpoint:', err);
          }
        } else {
          options.notify('Current track is not available on this device');
        }
      }
      
      // Dismiss this checkpoint
      setDismissedCheckpoints(prev => new Set(prev).add(cp.id));
    } catch (err) {
      console.error('Handoff failed:', err);
      options.notify(`Could not resume playback: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoading(false);
    }
  }, [loading, options]);

  const handleDismiss = useCallback((cp: PlaybackCheckpoint) => {
    setDismissedCheckpoints(prev => new Set(prev).add(cp.id));
  }, []);

  return {
    checkpoint: visibleCheckpoint || null,
    loading,
    onContinue: handleContinue,
    onDismiss: handleDismiss,
    reload: loadCheckpoints,
  };
}
