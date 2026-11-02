import { useEffect, useRef, useState } from "react";
import { collections } from "../adapters/collections";
import type { Session, Track } from "../domain/types";
import { portableTrack, type SharedState } from "../domain/nearby";
import { player, playbackTracks } from "../player/service";
import type { Playback } from "../player/controller";
import { isQueuedCatalog, playSelection, resolveQueueEntry } from "../domain/queue";
import type { SyncState, SyncPeer } from '../domain/device-sync';
import { reloadSyncedListening, flushListening } from '../player/listening-service';
import { desktop } from '../adapters/native';

const needsRediscovery = (error: unknown) => {
  const message = String(error).toLowerCase();
  return message.includes('cannot reach') || message.includes('sync interrupted') || message.includes('nearby connection interrupted');
};

export function useNearby(options: { ready: boolean; session: Session; tracks: Track[]; track?: Track; playback: Playback; update: (fn: (s: Session) => Session) => void; resolve: (track: Track) => Promise<Track>; applyReplica: (state: SyncState) => Promise<void>; flush: () => Promise<void> }) {
  const latest = useRef(options); latest.current = options;
  const [hostLink, setHostLink] = useState(""); const [guestLink, setGuestLink] = useState("");
  const [following, setFollowing] = useState(false); const [snapshot, setSnapshot] = useState<SharedState | null>(null);
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false), [historyEnabled, setHistoryEnabled] = useState(false);
  const [favoritesEnabled, setFavoritesEnabled] = useState(true);
  const [syncMessage, setSyncMessage] = useState('');
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const [peer, setPeer] = useState<SyncPeer | null>(null);
  const syncFlight = useRef<Promise<void> | null>(null), revision = useRef(0);
  const peerLink = useRef('');
  const rediscovery = useRef<Promise<string> | null>(null);
  const retryAt = useRef(0), failures = useRef(0), syncEpoch = useRef(0);
  async function sync(link = peerLink.current, automatic = false) {
    if (automatic && Date.now() < retryAt.current) return;
    if (syncFlight.current) return syncFlight.current;
    const epoch = syncEpoch.current;
    const run = async () => {
      setSyncing(true);
      try {
        await flushListening();
        await latest.current.flush();
        const local = await collections.syncState(revision.current);
        setHistoryEnabled(local.historyEnabled);
        setFavoritesEnabled(local.favoritesEnabled !== false);
        if (!latest.current.session.replica?.favoritesInitialized || local.cells.length) { await latest.current.applyReplica(local); await latest.current.flush(); }
        if (local.revision !== revision.current) await reloadSyncedListening();
        revision.current = local.revision;
        if (desktop) {
          try {
            const p = await collections.getPeer();
            setPeer(p);
            if (p && p.lastSeen) setLastSyncedAt(prev => Math.max(prev || 0, p.lastSeen));
          } catch { /* offline / mock */ }
        }
        let more = false;
        if (link) {
          // Bounded pages; interrupted work resumes from durable cursors on the next tick.
          for (let page = 0; page < 8; page++) { if (epoch !== syncEpoch.current) return; more = await collections.exchange(link); if (!more) break; }
        }
        if (epoch !== syncEpoch.current) return;
        if (!link) return;
        const state = await collections.syncState(revision.current);
        setHistoryEnabled(state.historyEnabled);
        setFavoritesEnabled(state.favoritesEnabled !== false);
        if (state.cells.length) { await latest.current.applyReplica(state); await latest.current.flush(); }
        if (state.revision !== revision.current) await reloadSyncedListening();
        revision.current = state.revision;
        if (link) { failures.current = 0; retryAt.current = 0; setLastSyncedAt(Date.now()); setError(''); setSyncMessage(more ? 'More changes are syncing in the background…' : 'Changes synced in both directions.'); }
      } catch (e) {
        if (epoch !== syncEpoch.current) return;
        if (link && needsRediscovery(e)) void rediscover(link).catch(() => {});
        retryAt.current = Date.now() + Math.min(60000, 5000 * 2 ** Math.min(failures.current++, 4));
        setError(String(e)); setSyncMessage('Changes are saved on this device. Retrying automatically.'); throw e;
      }
      finally { setSyncing(false); }
    };
    const promise = run(); syncFlight.current = promise;
    try { await promise; } finally { syncFlight.current = null; }
  }
  useEffect(() => {
    if (!options.ready || !desktop) return;
    try {
      peerLink.current = localStorage.getItem('lumaire-paired-link') || '';
      if (peerLink.current) {
        setGuestLink(peerLink.current);
        void collections.fetch(peerLink.current).then(setSnapshot).catch(async () => {
          try { const updated = await rediscover(peerLink.current); setSnapshot(await collections.fetch(updated)); } catch { /* Keep retrying in the background. */ }
        });
      }
      if (localStorage.getItem('lumaire-sharing-enabled') === 'true') void start();
    } catch { /* Storage can be unavailable; active pairing still works. */ }
    void sync(undefined, true).catch(() => {});
    const timer = window.setInterval(() => void sync(undefined, true).catch(() => {}), 5000);
    const reconnect = () => { retryAt.current = 0; void sync(undefined, true).catch(() => {}); };
    window.addEventListener('online', reconnect);
    return () => { syncEpoch.current++; clearInterval(timer); window.removeEventListener('online', reconnect); };
  }, [options.ready]);
  async function setHistorySync(enabled: boolean) {
    if (syncFlight.current) await syncFlight.current.catch(() => {});
    await flushListening();
    const state = await collections.historySync(enabled);
    setHistoryEnabled(state.historyEnabled); revision.current = 0;
    await sync();
  }
  async function setFavoritesSync(enabled: boolean) {
    if (syncFlight.current) await syncFlight.current.catch(() => {});
    await latest.current.flush();
    const state = await collections.favoritesSync(enabled);
    setFavoritesEnabled(state.favoritesEnabled !== false); revision.current = 0;
    await sync();
  }
  const failed = useRef(""); const generation = useRef(0);
  const lastPosition = useRef<number | null>(null);
  const ownedLoading = useRef<string | null>(null);
  async function rediscover(link: string) {
    if (rediscovery.current) return rediscovery.current;
    const attempt = collections.rediscover(link).then(updated => {
      peerLink.current = updated;
      setGuestLink(updated);
      try { localStorage.setItem('lumaire-paired-link', updated); } catch { /* The active connection still recovers. */ }
      return updated;
    });
    rediscovery.current = attempt;
    try { return await attempt; } finally { if (rediscovery.current === attempt) rediscovery.current = null; }
  }
  async function start() {
    setBusy(true); setError("");
    try { setHostLink(await collections.startSharing());
      try { localStorage.setItem('lumaire-sharing-enabled', 'true'); } catch { /* Active sharing still works. */ }
    }
    catch (e) { setError(String(e)); } finally { setBusy(false); }
  }
  async function stop() {
    generation.current++; setFollowing(false); setGuestLink(""); setSnapshot(null);
    syncEpoch.current++; retryAt.current = 0; failures.current = 0;
    peerLink.current = ''; setSyncMessage(''); setError(''); setLastSyncedAt(null); setPeer(null);
    try { localStorage.removeItem('lumaire-paired-link'); localStorage.removeItem('lumaire-sharing-enabled'); } catch { /* Active disconnection still succeeds. */ }
    try { await collections.stopSharing(true); setHostLink(""); } catch (e) { setError(String(e)); }
  }
  async function connect(link: string) {
    setBusy(true); setError(""); generation.current++; setFollowing(false);
    syncEpoch.current++; retryAt.current = 0; failures.current = 0; setLastSyncedAt(null);
    try { const data = await collections.fetch(link); setSnapshot(data); setGuestLink(link); peerLink.current = link;
      try { localStorage.setItem('lumaire-paired-link', link); } catch { /* Pair again after restart if storage is unavailable. */ }
      await sync(link);
    }
    catch (e) { setError(previous => previous || String(e)); } finally { setBusy(false); }
  }
  useEffect(() => {
    if (!hostLink) return;
    let stopped = false;
    async function publish() {
      const { session, tracks, track, playback } = latest.current;
      const playlists = session.playlists.slice(0, 50).map(playlist => ({ id: playlist.id, name: playlist.name, tracks: playlist.items.slice(0, Math.floor(500 / Math.max(1, session.playlists.length))).flatMap(entry => { const value = portableTrack(tracks.find(t => t.id === entry.trackId)); return value ? [value] : []; }) }));
      const portable = portableTrack(track);
      try { await collections.publish({ playlists, now: portable ? { track: portable, position: playback.time, playing: playback.status === "playing" } : null }); }
      catch (e) { if (!stopped) setError(String(e)); }
    }
    void publish(); const timer = window.setInterval(() => void publish(), 1500);
    return () => { stopped = true; clearInterval(timer); };
  }, [hostLink]);
  useEffect(() => {
    if (!following || !guestLink) return;
    let stopped = false, inFlight = false, failures = 0; const token = ++generation.current;
    async function poll() {
      if (inFlight || stopped) return; inFlight = true;
      try {
        const started = performance.now();
        const state = await collections.fetch(guestLink);
        if (stopped || token !== generation.current) return;
        failures = 0; setSnapshot(state); const now = state.now;
        if (!now) { await player.pause(); return; }
        const received = performance.now();
        const current = latest.current.track;
        const identity = current?.metadataSourceId || current?.id;
        const target = now.track.metadataSourceId || now.track.id;
        const position = now.position + (now.playing ? (performance.now() - started) / 2000 : 0);
        if (identity !== target) {
          if (failed.current === target) return;
          const pending = player.beginLoading(now.track.id, false);
          ownedLoading.current = pending;
          const selected = playSelection(latest.current.session, now.track, false);
          latest.current.update(() => selected);
          try {
            const track = isQueuedCatalog(now.track) ? await latest.current.resolve(now.track) : now.track;
            if (stopped || token !== generation.current || player.state.playbackId !== pending) return;
            playbackTracks.set(track.id, track);
            latest.current.update(session => resolveQueueEntry(session, selected.currentId!, now.track.id, track));
            const loading = player.load(track.id, now.playing, position + (now.playing ? (performance.now() - received) / 1000 : 0));
            ownedLoading.current = player.state.playbackId || null;
            await loading;
            failed.current = "";
          } catch (e) { failed.current = target; player.failLoading(pending, String(e)); setError(`This device could not play the host's track. ${String(e)}`); }
        } else if (!["loading", "buffering", "error"].includes(player.state.status)) {
          ownedLoading.current = null;
          if (Math.abs(player.state.time - position) > 2 || (lastPosition.current !== null && position < lastPosition.current - 1)) await player.seek(position);
          if (now.playing && player.state.status !== "playing") await player.play();
          if (!now.playing && player.state.status === "playing") await player.pause();
        }
        lastPosition.current = position;
      } catch (e) {
        if (!stopped) {
          setError(String(e));
          if (failures === 0 && needsRediscovery(e)) { failures++; try { await rediscover(guestLink); return; } catch { /* Continue bounded retry handling below. */ } }
          if (++failures >= 3) { setFollowing(false); await player.pause(); }
        }
      } finally { inFlight = false; }
    }
    void poll(); const timer = window.setInterval(() => void poll(), 1500);
    return () => { stopped = true; generation.current++; clearInterval(timer); if (ownedLoading.current === player.state.playbackId && player.state.status === "loading") player.stop(); ownedLoading.current = null; };
  }, [following, guestLink]);
  useEffect(() => () => { generation.current++; void collections.stopSharing().catch(() => {}); }, []);
  return { hostLink, guestLink, peer, following, snapshot, error, busy, syncing, historyEnabled, favoritesEnabled, syncMessage, lastSyncedAt, sync: () => sync(), setHistorySync, setFavoritesSync, start, stop, connect, setFollowing: (value: boolean) => { generation.current++; failed.current = ""; lastPosition.current = null; setError(""); setFollowing(value); }, refresh: () => connect(guestLink) };
}
