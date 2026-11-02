import {fillTrackMetadata} from '../domain/metadata-enrichment';
import { type DownloadProgress } from "../domain/downloads";
import { useCallback, useEffect, useRef, useState } from "react";
import { flushListening } from "../player/listening-service";
import { PlaybackController } from "../player/controller";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  library,
  desktop,
  mobile,
  type CatalogTrack,
} from "../adapters/native";
import { withoutTrack } from "../domain/collections";
import {
  metadataQueries,
  needsMetadata,
  repairYoutubeTrack,
} from "../domain/online-track";
import { canonicalTrack, catalogQueueTrack, failureKind, resolveCatalogSource } from "../domain/catalog-track";
import { matchSource } from "../domain/source-matching";
import { enqueue, setShuffle, isQueuedCatalog, resolveUpcomingCatalog } from "../domain/queue";
import { restoreSession } from "../domain/session";
import { checkpointListening } from '../domain/home-listening';
import { stampPlaylistUpdates } from "../domain/playlists";
import { capturePlaylistEdits } from '../domain/device-sync';
import { defaults, item, type EngineInstallProgress, type EngineInstallState, type Session, type Track } from "../domain/types";
import {
  player,
  offlineTracks,
  playbackTracks,
  resolvedMusic,
  musicResolved,
  prepareCatalogCandidate,
} from "../player/service";

import { playbackEvent } from "../player/diagnostics";
import type { ToastAction } from "../components/common/Banners";

const LAST_PLAYLIST_KEY = "lumaire:last-playlist-id";

const formatError = (e: unknown) =>
  e instanceof Error ? e.message : String(e);

export function useLibraryManager() {
  const [pendingTrack, setPendingTrack] = useState<Track | null>(null);
  const pendingCatalog = useRef<CatalogTrack | null>(null);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [session, setSession] = useState<Session>(defaults);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [messageAction, setMessageAction] = useState<ToastAction | null>(null);
  const [error, setError] = useState("");
  const [downloads, setDownloads] = useState<Record<string, string>>({});
  const [ytdlpAvailable, setYtdlpAvailable] = useState(false);
  const [engineState, setEngineState] = useState<EngineInstallState>("checking");
  const [engineError, setEngineError] = useState("");
  const [engineProgress, setEngineProgress] = useState<EngineInstallProgress | null>(null);
  const [engineCancelling, setEngineCancelling] = useState(false);
  const engineInstallPromise = useRef<Promise<void> | null>(null);
  const engineCheckGeneration = useRef(0);

  const messageTimeoutRef = useRef<number | null>(null);
  const catalogSources = useRef(new Map<string, Promise<Track>>());
  const metadataInFlight = useRef(new Set<string>());
  const sessionRef = useRef(session);
  const tracksRef = useRef(tracks);
  const readyRef = useRef(false);
  const saveChain = useRef(Promise.resolve());
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suspendPersistence = useRef(false);

  sessionRef.current = session;
  tracksRef.current = tracks;
  playbackTracks.clear();
  Object.values(session.queueTracks).forEach(t => playbackTracks.set(t.id, t));
  tracks.forEach(t => playbackTracks.set(t.id, t));

  offlineTracks.clear();
  tracks
    .filter((track) => track.offline)
    .forEach((track) => offlineTracks.add(track.id));

  const update = (fn: (s: Session) => Session) => {
    const now = Date.now();
    const s = sessionRef.current;
    const next = fn(s);
    const updated = capturePlaylistEdits(s, next.playlists === s.playlists ? next : {
        ...next, playlists: stampPlaylistUpdates(s.playlists, next.playlists, now),
      }, tracksRef.current);
    sessionRef.current = updated;
    setSession(updated);
  };

  const setting = <K extends keyof Session["settings"]>(
    key: K,
    value: Session["settings"][K],
  ) =>
    update((s) =>
      key === "shuffle"
        ? setShuffle(s, value === true)
        : { ...s, settings: { ...s.settings, [key]: value } },
    );

  const notify = (text: string, action?: ToastAction | null) => {
    setMessage(text);
    setMessageAction(action ?? null);
    if (messageTimeoutRef.current) {
      window.clearTimeout(messageTimeoutRef.current);
    }
    const duration = action ? 6000 : 4000;
    messageTimeoutRef.current = window.setTimeout(() => {
      setMessage("");
      setMessageAction(null);
      messageTimeoutRef.current = null;
    }, duration);
  };

  const persist = () => {
    if (!readyRef.current || suspendPersistence.current) return;
    const s = restoreSession(
      playbackSnapshot(),
      tracksRef.current,
    );
    saveChain.current = saveChain.current
      .then(() => library.save(s))
      .catch((e) =>
        setError(`Your latest changes could not be saved. ${formatError(e)}`),
      );
  };

  function playbackSnapshot() {
    const s = sessionRef.current;
    const state = player.state;
    const matching = s.queue.find(entry => entry.id === s.currentId)?.trackId === state.trackId;
    return matching ? { ...checkpointListening(s, tracksRef.current, state.time, state.status === 'ended'), position: state.time, ...(mobile ? {nativePositionAt:state.nativeStateAt} : {}) } : s;
  }

  // Checkpoint capture for cross-device handoff
  const lastCheckpointCapture = useRef({ time: 0, sessionHash: '' });
  const capturePlaybackCheckpoint = useCallback(async () => {
    if (!readyRef.current || !desktop) return;
    
    const s = sessionRef.current;
    const state = player.state;
    
    // Skip if no meaningful playback state
    if (!s.currentId || !s.queue.length) return;
    
    // Coalesce rapid updates - don't checkpoint more than once per 3 seconds
    const now = Date.now();
    if (now - lastCheckpointCapture.current.time < 3000) return;
    
    // Create a simple hash to detect meaningful changes
    const sessionHash = JSON.stringify({
      currentId: s.currentId,
      queueIds: s.queue.map(e => e.id).slice(0, 5),
      shuffle: s.settings.shuffle,
      repeat: s.settings.repeat,
    });
    
    // Skip if nothing meaningful changed
    if (sessionHash === lastCheckpointCapture.current.sessionHash && now - lastCheckpointCapture.current.time < 10000) {
      return;
    }
    
    try {
      const { captureCheckpoint } = await import('../domain/playback-checkpoint');
      const { collections, checkpoint: checkpointApi } = await import('../adapters/collections');
      let localDeviceId = localStorage.getItem('lumaire-device-id');
      try {
        const sync = await collections.syncState();
        if (sync.deviceId) {
          localDeviceId = sync.deviceId;
          localStorage.setItem('lumaire-device-id', sync.deviceId);
        }
      } catch { /* offline / mock */ }
      if (!localDeviceId) {
        localDeviceId = crypto.randomUUID();
        localStorage.setItem('lumaire-device-id', localDeviceId);
      }
      
      const deviceName = mobile ? 'Android Phone' : 'Windows PC';
      const checkpoint = captureCheckpoint(
        s,
        tracksRef.current,
        state.time,
        state.status === 'playing',
        localDeviceId,
        deviceName
      );
      
      if (checkpoint) {
        await checkpointApi.save(checkpoint);
        lastCheckpointCapture.current = { time: now, sessionHash };
      }
    } catch (err) {
      console.warn('Checkpoint capture failed:', err);
    }
  }, []);

  // Trigger checkpoint on meaningful playback changes
  useEffect(() => {
    if (!ready) return;
    void capturePlaybackCheckpoint();
  }, [ready, session.currentId, session.settings.shuffle, session.settings.repeat]);

  // Also checkpoint on player state changes (track change, pause)
  useEffect(() => {
    if (!ready) return;
    const unsubscribe = player.subscribe(() => {
      const state = player.state;
      if (state.status === 'paused' || state.status === 'ended') {
        void capturePlaybackCheckpoint();
      }
    });
    return unsubscribe;
  }, [ready, capturePlaybackCheckpoint]);

  const action = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(formatError(e));
    } finally {
      setBusy(false);
    }
  };

  // Desktop window close requested handler
  useEffect(() => {
    if (!desktop || mobile) return;
    const unsubscribe = getCurrentWindow().onCloseRequested(async (event) => {
      event.preventDefault();
      if (!readyRef.current) {
        await getCurrentWindow().destroy();
        return;
      }
      player.pause();
      const latest = restoreSession(
        playbackSnapshot(),
        tracksRef.current,
      );
      try {
        await flushListening();
        await saveChain.current;
        await library.save(latest);
        await getCurrentWindow().destroy();
      } catch (e) {
        setError(
          `Lumaire stayed open because your library could not be saved. ${formatError(e)}`,
        );
      }
    });
    return () => {
      void unsubscribe.then((fn) => fn());
    };
  }, []);

  // Mobile visibility persistence
  useEffect(() => {
    if (!mobile) return;
    const persistMobile = () => {
      if (!readyRef.current) return;
      void library.save(
        restoreSession(
          playbackSnapshot(),
          tracksRef.current,
        ),
      );
    };
    const hidden = () => {
      if (document.hidden) persistMobile();
    };
    document.addEventListener("visibilitychange", hidden);
    return () => document.removeEventListener("visibilitychange", hidden);
  }, []);

  // Initial load and periodic persistence
  useEffect(() => {
    const onMusicResolved = (event: Event) => {
      const selected = [
        ...tracksRef.current,
        ...Object.values(sessionRef.current.queueTracks),
      ].find((track) => track.id === (event as CustomEvent<string>).detail);
      const credits = selected && resolvedMusic.get(selected.id);
      if (
        selected &&
        needsMetadata(selected) &&
        credits &&
        (selected.title !== credits.title ||
          selected.artist !== credits.artist ||
          (credits.album && selected.album !== credits.album))
      )
        void enrichOnline(selected);
    };
    musicResolved.addEventListener("resolved", onMusicResolved);

    library
      .load()
      .then(async (snapshot) => {
        snapshot.tracks = await Promise.all(
          snapshot.tracks.map(async (original) => {
            const repaired = repairYoutubeTrack(original);
            if (repaired === original) return original;
            return library.saveOnline(repaired, true).catch((err) => {
              console.warn("Saved track metadata repair failed:", err);
              return original;
            });
          }),
        );
        const normalized = restoreSession(snapshot.session, snapshot.tracks);
        const restored = checkpointListening(normalized, snapshot.tracks, normalized.position);
        setTracks(snapshot.tracks);
        snapshot.tracks
          .filter((track) => track.offline)
          .forEach((track) => offlineTracks.add(track.id));
        snapshot.tracks.forEach(t => playbackTracks.set(t.id, t));
        Object.values(restored.queueTracks).forEach(t => playbackTracks.set(t.id, t));
        setSession(restored);
        sessionRef.current = restored;
        readyRef.current = true;
        setReady(true);
        const selected = restored.queue.find(
          (i) => i.id === restored.currentId,
        );
        if (selected && !isQueuedCatalog(restored.queueTracks[selected.trackId] || snapshot.tracks.find(t => t.id === selected.trackId)!))
          void player.load(selected.trackId, false, restored.position);
      })
      .catch((e) =>
        setError(`The library could not be opened. ${formatError(e)}`),
      );

    const checkEngine = () => void refreshYoutubeEngine();
    checkEngine();
    window.addEventListener("focus", checkEngine);
    
    // Capture checkpoint on window focus for cross-device handoff
    const onFocus = () => void capturePlaybackCheckpoint();
    window.addEventListener("focus", onFocus);

    const timer = setInterval(persist, 2000);
    const onHidden = () => {
      if (document.visibilityState === "hidden") {
        persist();
        void capturePlaybackCheckpoint(); // Checkpoint before app goes to background
      } else {
        void capturePlaybackCheckpoint(); // Checkpoint when app returns to foreground
      }
    };
    document.addEventListener("visibilitychange", onHidden);
    return () => {
      musicResolved.removeEventListener("resolved", onMusicResolved);
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onHidden);
      window.removeEventListener("focus", checkEngine);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  // Restore enrichment on selection/startup after the App.tsx extraction.
  // Queued sources remain transient; enrichOnline only updates saved rows.
  useEffect(() => {
    if (!ready) return;
    const entry = session.queue.find((item) => item.id === session.currentId);
    const selected =
      entry &&
      (tracks.find((track) => track.id === entry.trackId) ||
        session.queueTracks[entry.trackId]);
    if (selected && needsMetadata(selected)) void enrichOnline(selected);
  }, [ready, session.currentId]);

  // Reconcile legacy online credits in the background; local file tags stay user-owned.
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    void (async () => {
      for (const track of tracksRef.current) {
        if (cancelled) return;
        if (track.source?.providerId === "youtube") await enrichOnline(track);
      }
    })();
    return () => { cancelled = true; };
  }, [ready]);

  useEffect(() => {
    if (ready) {
      if (persistTimer.current) clearTimeout(persistTimer.current);
      persistTimer.current = setTimeout(persist, 200);
    }
  }, [session, ready]);

  async function enrichOnline(base: Track, explicit = false) {
    if (metadataInFlight.current.has(base.id)) return;
    metadataInFlight.current.add(base.id);
    try {
      let enriched: Track;
      let canonical: CatalogTrack | null = null;
      if (base.metadataSourceId) {
        canonical = await library.lookupCatalog(base.metadataSourceId);
        enriched = { ...base, title: canonical.title, artist: canonical.artist,
          album: canonical.album, recordingMetadata: canonical.recordingMetadata, artworkUrl: canonical.artworkUrl };
      } else {
        let source = resolvedMusic.get(base.id);
        let metadata = null;
        for (const query of metadataQueries(source ? { ...base, title: source.title, artist: source.artist } : base)) {
          try {
            metadata = await library.lookupMetadata(query.title, query.artist, base.duration);
            if (metadata) break;
          } catch (e) {
            console.warn("Catalog metadata unavailable:", e);
            break;
          }
        }
        const latestSource = resolvedMusic.get(base.id);
        if (!metadata && latestSource && latestSource !== source) {
          try {
            metadata = await library.lookupMetadata(latestSource.title, latestSource.artist, base.duration);
          } catch (e) {
            console.warn("Catalog metadata unavailable:", e);
          }
        }
        source = latestSource;
        if (!source && !metadata) {
          if (explicit) notify("No verified metadata is available right now.");
          return;
        }
        enriched = { ...base,
          title: metadata?.title || source?.title || base.title,
          artist: metadata?.artist || source?.artist || base.artist,
          album: metadata?.album || source?.album || base.album,
          artworkUrl: metadata?.artworkUrl || base.artworkUrl,
          metadataSourceId: metadata?.sourceId?.startsWith("itunes:") ? metadata.sourceId : undefined,
        };
      }
      if (enriched.metadataSourceId) {
        canonical ??= await library.lookupCatalog(enriched.metadataSourceId);
        enriched = { ...enriched, title: canonical.title, album: canonical.album,
          artist: canonical.artist, recordingMetadata: canonical.recordingMetadata,
          artworkUrl: canonical.artworkUrl || enriched.artworkUrl };
      }
      const latest = tracksRef.current.find(t => t.id === base.id) || sessionRef.current.queueTracks[base.id];
      if (latest?.metadataSourceId && latest.metadataSourceId !== base.metadataSourceId) return;
      enriched = fillTrackMetadata(latest || base, enriched, base);
      playbackTracks.set(enriched.id, enriched);
      if (tracksRef.current.some((t) => t.id === base.id)) {
        enriched = await library.saveOnline(enriched, true, latest || base);
        setTracks((all) =>
          all.map((t) => (t.id === enriched.id ? fillTrackMetadata(t, enriched, latest || base) : t)),
        );
      } else {
        update((s) =>
          s.queue.some((entry) => entry.trackId === base.id)
            ? { ...s, queueTracks: { ...s.queueTracks, [base.id]: enriched } }
            : s,
        );
      }
      if (explicit) notify(`Metadata updated for ${enriched.title}`);
    } catch (e) {
      if (explicit) throw e;
      console.warn("Optional metadata enrichment failed:", e);
    } finally {
      metadataInFlight.current.delete(base.id);
    }
  }

  async function importMusic(folder: boolean, onAfterImport?: () => void) {
    await action(async () => {
      const result = await library.importAudio(folder);
      if (!result.tracks.length) return;
      const before = new Set(tracks.map((t) => t.id));
      setTracks((all) => [
        ...all.filter((t) => !result.tracks.some((n) => n.id === t.id)),
        ...result.tracks,
      ]);
      const added = result.tracks.filter((t) => !before.has(t.id));
      if (onAfterImport) onAfterImport();
      notify(
        `${added.length} ${added.length === 1 ? "track" : "tracks"} added${result.tracks.length > added.length ? ` · ${result.tracks.length - added.length} already in your library` : ""}${result.warnings.length ? ` · ${result.warnings.join(" ")}` : ""}`,
      );
    });
  }

  const favorite = (id: string, candidate?: Track) => {
    const track = tracksRef.current.find(t => t.id === id) || sessionRef.current.queueTracks[id] || candidate;
    if (!track) return;
    const toggle = (savedId: string) => {
      update((s) => ({
        ...s,
        favorites: s.favorites.includes(savedId)
          ? s.favorites.filter((f) => f !== savedId)
          : [...s.favorites, savedId],
      }));
    };
    if (tracksRef.current.some(t => t.id === id)) toggle(id);
    else void saveOnline(track).then(saved => toggle(saved.id)).catch(e => setError(`Could not save favorite. ${formatError(e)}`));
  };

  async function saveOnline(t: Track): Promise<Track> {
    if (isQueuedCatalog(t)) return saveOnline(await resolveDiscovery(await library.lookupCatalog(t.id)));
    const saved = await library.saveOnline(t);
    tracksRef.current = [
      ...tracksRef.current.filter((track) => track.id !== saved.id),
      saved,
    ];
    setTracks(tracksRef.current);
    return saved;
  }

  async function saveCommons(
    t: Track,
    play = false,
    onPlay?: (t: Track) => void,
  ) {
    await action(async () => {
      if (play && onPlay) {
        onPlay(tracksRef.current.find((saved) => saved.id === t.id) || t);
      } else {
        await saveOnline(t);
      }
      notify(`${play ? "Loading" : "Saved"} ${t.title}`);
    });
  }

  async function downloadTrack(t: Track, signal?: AbortSignal, onProgress?: (progress: DownloadProgress) => void): Promise<boolean> {
    if (signal?.aborted) return false;
    const cancel = () => { void library.cancelDownload(t.id).catch(err => setError(formatError(err))); };
    setDownloads((prev) => ({ ...prev, [t.id]: "downloading" }));
    try {
      if (isQueuedCatalog(t)) {
        const success = await downloadTrack(await resolveDiscovery(await library.lookupCatalog(t.id)), signal, onProgress);
        setDownloads(previous => ({ ...previous, [t.id]: success ? "complete" : "Audio source unavailable; retry" }));
        return success;
      }
      if (t.metadataSourceId || !tracksRef.current.some((track) => track.id === t.id))
        await saveOnline(t);
      if (signal?.aborted) { setDownloads(prev => ({ ...prev, [t.id]: "Cancelled" })); return false; }
      signal?.addEventListener("abort", cancel, { once: true });
      if (!signal) void library.downloadNotification?.({ active: true, title: t.title, done: 0, total: 0 });
      let notificationPercent = -1;
      const saved = await library.download(t.id, progress => {
        setDownloads(prev => ({ ...prev, [t.id]: "downloading" }));
        if (!signal && progress.total !== null && progress.total > 0) {
          const percent = Math.floor(progress.received / progress.total * 100);
          if (percent !== notificationPercent) {
            notificationPercent = percent;
            void library.downloadNotification?.({ active: true, title: t.title, done: progress.received, total: progress.total });
          }
        }
        onProgress?.(progress);
      });
      tracksRef.current = [
        ...tracksRef.current.filter((track) => track.id !== saved.id),
        saved,
      ];
      setTracks(tracksRef.current);
      setDownloads((prev) => ({ ...prev, [t.id]: "complete" }));
      notify(`${saved.title} is available offline`);
      return true;
    } catch (err) {
      setDownloads((prev) => ({ ...prev, [t.id]: signal?.aborted ? "Cancelled" : String(err) }));
      if (!signal?.aborted) setError(String(err));
      return false;
    } finally {
      signal?.removeEventListener("abort", cancel);
      if (!signal) void library.downloadNotification?.({ active: false, title: "", done: 0, total: 0 });
    }
  }

  function deleteOffline(
    t: Track,
    currentTrackId: string | undefined,
    askConfirm: (
      title: string,
      label: string,
      val: string,
      submit: (v: string) => void,
    ) => void,
  ) {
    askConfirm(
      "Delete offline copy",
      "Type DELETE to remove the app-owned audio copy. The saved online source stays in your library.",
      "",
      (value) => {
        if (value !== "DELETE") return;
        void action(async () => {
          if (currentTrackId === t.id) player.stop();
          const saved = await library.deleteDownload(t.id);
          offlineTracks.delete(t.id);
          setTracks((currentTracks) =>
            currentTracks.map((track) =>
              track.id === saved.id ? saved : track,
            ),
          );
          if (
            sessionRef.current.queue.find(
              (entry) => entry.id === sessionRef.current.currentId,
            )?.trackId === t.id
          )
            void player.load(saved.id, false);
          notify("Offline copy deleted. The online source is still saved.");
        });
      },
    );
  }

  async function relink(
    t: Track,
    currentTrackId: string | undefined,
    playbackTime: number,
  ) {
    await action(async () => {
      const replacement = await library.relink(t.id);
      if (replacement) {
        setTracks((ts) => ts.map((x) => (x.id === t.id ? replacement : x)));
        if (currentTrackId === t.id)
          void player.load(t.id, false, playbackTime);
        notify("File relinked. Playback stays paused.");
      }
    });
  }

  async function removeTrack(t: Track, onResetUndo: () => void) {
    await action(async () => {
      suspendPersistence.current = true;
      if (persistTimer.current) clearTimeout(persistTimer.current);
      try {
        await saveChain.current;
        const previous = sessionRef.current.currentId;
        const snapshot = await library.remove(
          t.id,
          capturePlaylistEdits(sessionRef.current, withoutTrack(
            {
              ...sessionRef.current,
              position: player.state.time,
            },
            t.id,
          ), tracksRef.current),
        );
        const restored = restoreSession(snapshot.session, snapshot.tracks);
        sessionRef.current = restored;
        tracksRef.current = snapshot.tracks;
        setTracks(snapshot.tracks);
        setSession(restored);
        onResetUndo();
        if (previous !== restored.currentId) {
          player.stop();
          const next = restored.queue.find(
            (entry) => entry.id === restored.currentId,
          );
          if (next) void player.load(next.trackId, false);
        }
        notify(
          `Removed ${t.title} from the library. Original files stay on disk.`,
        );
      } finally {
        suspendPersistence.current = false;
      }
    });
  }

  async function addOnlineToPlaylist(
    t: Track,
    playlistId: string,
    newName?: string,
    options?: {
      action?: ToastAction | null;
      customMessage?: string;
      silent?: boolean;
    },
  ) {
    await action(async () => {
      if (playlistId === "favorites") {
        const saved = t.metadataSourceId
          ? await saveOnline(t)
          : tracksRef.current.find((entry) => entry.id === t.id) ||
            await saveOnline(sessionRef.current.queueTracks[t.id] || t);
        if (!sessionRef.current.favorites.includes(saved.id)) {
          update((s) => ({
            ...s,
            favorites: [...s.favorites, saved.id],
          }));
        }
        notify(`Added ${saved.title} to favorites`);
        return;
      }
      if (
        !newName &&
        !sessionRef.current.playlists.some((p) => p.id === playlistId)
      )
        return;
      const saved = t.metadataSourceId
        ? await saveOnline(t)
        : tracksRef.current.find((entry) => entry.id === t.id) ||
          await saveOnline(sessionRef.current.queueTracks[t.id] || t);
      update((s) => ({
        ...s,
        playlists: newName
          ? [
              ...s.playlists,
              { id: playlistId, name: newName, items: [item(saved.id)] },
            ]
          : s.playlists.map((playlist) =>
              playlist.id === playlistId
                ? {
                    ...playlist,
                    items: playlist.items.some((i) => i.trackId === saved.id)
                      ? playlist.items
                      : [...playlist.items, item(saved.id)],
                  }
                : playlist,
            ),
      }));
      try {
        localStorage.setItem(LAST_PLAYLIST_KEY, playlistId);
      } catch {
        // Local storage unavailable
      }
      if (!options?.silent) {
        const targetPlaylist = sessionRef.current.playlists.find((p) => p.id === playlistId);
        const playlistName = newName || targetPlaylist?.name || "playlist";
        const messageText = options?.customMessage ?? `Added to ${playlistName}`;
        notify(messageText, options?.action);
      }
    });
  }

  async function resolveDiscovery(result: CatalogTrack, refresh = false): Promise<Track> {
    if (refresh) void library.deleteVerifiedSource?.(result.id)?.catch?.(() => {});
    const known = [...tracksRef.current, ...Object.values(sessionRef.current.queueTracks)]
      .find(t => t.metadataSourceId === result.id && !isQueuedCatalog(t));
    if (known && !refresh) {
      let compatible = true;
      if (!known.offline && known.source?.providerId === "youtube") {
        const candidate = { id: known.source.sourceId, title: known.title, channel: known.artist, duration: null, thumbnail: null };
        try {
          const details = await prepareCatalogCandidate(candidate);
          compatible = (await matchSource(result, { ...candidate, ...details })).accepted;
        } catch (error) {
          if (failureKind(error) === "cancelled") throw error;
          compatible = false;
        }
      }
      if (compatible) {
        if (known.source?.sourceId) {
          playbackEvent({ trackId: result.id, stage: "source-resolved", candidateId: known.source.sourceId, cache: "known" });
        }
        return { ...known, title: result.title, artist: known.artist || result.artist,
          album: result.album, duration: result.duration, artworkUrl: result.artworkUrl };
      }
      catalogSources.current.delete(result.id);
    }
    if (refresh) catalogSources.current.delete(result.id);
    let pending = catalogSources.current.get(result.id);
    if (pending) playbackEvent({ trackId: result.id, stage: "source-cache", cache: "memory" });
    if (!pending) {
      if (catalogSources.current.size >= 128) catalogSources.current.delete(catalogSources.current.keys().next().value!);
      pending = (async () => {
        if (!refresh) {
          try {
            const readAt = performance.now();
            const cached = await library.getVerifiedSource?.(result.id);
            playbackEvent({ trackId: result.id, stage: "verified-cache-read", durationMs: performance.now() - readAt, cache: cached ? "hit" : "miss" });
            if (cached && cached.sourceProvider === "youtube") {
              const candidate = {
                id: cached.sourceId,
                title: cached.title,
                channel: cached.artist || "",
                duration: cached.duration || null,
                thumbnail: null,
              };
              const details = await prepareCatalogCandidate(candidate);
              if (details) Object.assign(candidate, details);
              const match = await matchSource(result, candidate);
              if (match.accepted) {
                playbackEvent({ trackId: result.id, stage: "source-resolved", candidateId: candidate.id, cache: "verified" });
                const existing = tracksRef.current.find(t => t.id === `youtube:${candidate.id}`);
                return canonicalTrack(result, candidate, existing);
              }
              playbackEvent({ trackId: result.id, stage: "rejected", candidateId: candidate.id, reason: `cached-${match.reason}` });
              await library.deleteVerifiedSource?.(result.id);
            }
          } catch (error) {
            if (failureKind(error) === "cancelled") throw error;
            void library.deleteVerifiedSource?.(result.id)?.catch?.(() => {});
          }
        }
        const source = await resolveCatalogSource(result, library.ytdlpSearch, { verify: prepareCatalogCandidate });
        void library.setVerifiedSource?.(result.id, {
          sourceId: source.id,
          sourceProvider: "youtube",
          title: source.title,
          artist: source.channel || null,
          duration: source.duration || null,
        })?.catch?.(() => {});
        const existing = tracksRef.current.find(t => t.id === `youtube:${source.id}`);
        return canonicalTrack(result, source, existing);
      })().catch(error => {
        catalogSources.current.delete(result.id);
        throw error;
      });
      catalogSources.current.set(result.id, pending);
    }
    return pending;
  }

  async function saveDiscovery(
    result: CatalogTrack,
    mode: "play" | "save" | "next" | "queue",
    onPlayTrack: (t: Track) => void,
  ) {
    if (mode === "next" || mode === "queue") {
      const offline = tracksRef.current.find(track => track.metadataSourceId === result.id && track.offline && !track.missing);
      const queued = offline || catalogQueueTrack(result);
      update(s => enqueue({ ...s, queueTracks: { ...s.queueTracks, [queued.id]: queued } }, queued.id, mode === "next"));
      notify(`${mode === "next" ? "Added to play next:" : "Added to queue:"} ${result.title}`);
      if (!offline) {
        void resolveDiscovery(result).then(resolved => {
          update(s => resolveUpcomingCatalog(s, result.id, resolved));
        }).catch(error => {
          if (sessionRef.current.queue.some(entry => entry.trackId === result.id))
            notify(`Could not verify ${result.title}. Playback will retry. ${formatError(error)}`);
        });
      }
      return;
    }
    if (mode === 'play' && mobile) {
      const offline = tracksRef.current.find(track => track.metadataSourceId === result.id && track.offline && !track.missing);
      setPendingTrack(null); pendingCatalog.current = null; setError('');
      onPlayTrack(offline || catalogQueueTrack(result));
      return;
    }
    if (mode === "play" && "beginLoading" in player) {
      if (player.state.trackId === result.id && player.state.status === "loading") return;
      const pending: Track = { id: result.id, title: result.title, artist: result.artist, album: result.album,
        duration: result.duration, artworkUrl: result.artworkUrl, metadataSourceId: result.id,
        fileName: "", format: "catalog", missing: false };
      setPendingTrack(pending);
      pendingCatalog.current = result;
      setError("");
      const token = player.beginLoading(result.id);
      try {
        const selected = await resolveDiscovery(result);
        if (player.state.playbackId !== token) return;
        onPlayTrack(selected);
      } catch (error) {
        if (player.state.playbackId === token) {
          const message = formatError(error);
          player.failLoading(token, message);
        }
      }
      return;
    }
    await action(async () => {
      const selected = await resolveDiscovery(result);
      const existing = tracksRef.current.find(t => t.id === selected.id);
      if (existing && mode !== "save") {
        await saveOnline(selected);
      }
      playbackTracks.set(selected.id, selected);
      if (mode === "save") { await saveOnline(selected); notify(`Saved ${selected.title} - online connection required`); }
      else if (mode === "play") onPlayTrack(selected);
    });
  }

  const refreshYoutubeEngine = useCallback(async () => {
    if (engineInstallPromise.current) return;
    const generation = ++engineCheckGeneration.current;
    setEngineState(state => state === "installed" || state === "error" ? state : "checking");
    try {
      const available = await library.ytdlpCheckAvailable();
      if (generation !== engineCheckGeneration.current || engineInstallPromise.current) return;
      setYtdlpAvailable(available);
      setEngineState(state => available ? "installed" : state === "error" ? "error" : "missing");
      if (available) setEngineError("");
    } catch (error) {
      if (generation !== engineCheckGeneration.current || engineInstallPromise.current) return;
      setYtdlpAvailable(false);
      setEngineState("error");
      setEngineError(`Could not check the engine. ${formatError(error)}`);
    }
  }, []);

  function installYoutubeEngine(): Promise<void> {
    if (engineInstallPromise.current) return engineInstallPromise.current;
    ++engineCheckGeneration.current;
    setEngineState("installing");
    setEngineError("");
    setEngineProgress(null);
    setEngineCancelling(false);
    const pending = (async () => {
      try {
        await library.ytdlpInstallEngine(setEngineProgress);
        const available = await library.ytdlpCheckAvailable();
        if (!available) throw new Error("The engine installed but could not be located. Please retry.");
        setYtdlpAvailable(true);
        setEngineState("installed");
        notify("YouTube engine installed and ready. No restart needed.");
      } catch (error) {
        setEngineState("error");
        setEngineError(formatError(error));
      } finally {
        engineInstallPromise.current = null;
        setEngineCancelling(false);
      }
    })();
    engineInstallPromise.current = pending;
    return pending;
  }

  async function cancelYoutubeEngineInstall(): Promise<void> {
    if (!engineInstallPromise.current) return;
    setEngineCancelling(true);
    try { await library.ytdlpCancelInstall(); }
    catch (error) { setEngineError(`Could not cancel installation. ${formatError(error)}`); setEngineCancelling(false); }
  }

  return {
    clearPendingPlayback: () => { setPendingTrack(null); pendingCatalog.current = null; },
    pendingTrack,
    retryPendingPlayback: (onPlayTrack: (t: Track) => void) => {
      if (pendingCatalog.current) void saveDiscovery(pendingCatalog.current, "play", onPlayTrack);
    },
    tracks,
    setTracks,
    session,
    setSession,
    ready,
    busy,
    message,
    setMessage,
    messageAction,
    setMessageAction,
    error,
    setError,
    downloads,
    ytdlpAvailable,
    engineState,
    engineError,
    engineProgress,
    engineCancelling,
    cancelYoutubeEngineInstall,
    installYoutubeEngine,
    refreshYoutubeEngine,
    sessionRef,
    tracksRef,
    readyRef,
    saveChain,
    persistTimer,
    suspendPersistence,
    update,
    setting,
    notify,
    persist,
    action,
    importMusic,
    favorite,
    saveOnline,
    saveCommons,
    downloadTrack,
    deleteOffline,
    relink,
    removeTrack,
    addOnlineToPlaylist,
    enrichOnline,
    saveDiscovery,
    resolveDiscovery,
  };
}
