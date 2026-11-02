import { useTaskbarControls } from "./useTaskbarControls";
import { useEffect, useRef, useState } from "react";
import { library, mobile, type CatalogTrack, type YtdlpSearchResult } from "../adapters/native";
import { canonicalTrack } from '../domain/catalog-track';
import { matchSource } from '../domain/source-matching';
import { autoplayCandidates, resolveAutoplayCandidate } from '../domain/autoplay';
import { loadAutoplayPool } from '../adapters/autoplay';
import { discoveryPreferences } from '../adapters/discovery-home';
import { rankAutoplay } from '../domain/autoplay-ranking';
import { catalogQuickPick } from '../domain/quick-picks';
import type { ListeningRecord } from '../domain/listening';
import {
  advance,
  advanceAfterFailure,
  enqueue,
  playCollection,
  playbackQueue,
  playSelection,
  isQueuedCatalog,
  resolveQueueEntry,
} from "../domain/queue";
import { type QueueItem, type Session, type Track } from "../domain/types";
import type { Playback } from "../player/controller";
import { player, playbackTracks, prepareCatalogCandidate } from "../player/service";
import { playbackEvent } from "../player/diagnostics";
import { checkpointListening } from '../domain/home-listening';
import { nativeListeningHandoff } from '../player/listening-service';

export interface UsePlaybackOptions {
  resolveQueuedTrack: (track: Track) => Promise<Track>;
  session: Session;
  update: (fn: (s: Session) => Session) => void;
  sessionRef: React.MutableRefObject<Session>;
  tracksRef: React.MutableRefObject<Track[]>;
  tracks: Track[];
  currentTrack?: Track | null;
  view: string;
  setView: (v: string) => void;
  notify: (msg: string) => void;
  persist: () => void;
  dialogOpen: boolean;
  onSetFollow?: (follow: boolean) => void;
  onToggleQueue?: () => void;
  queueOpen?: boolean;
  listeningRecords?: ListeningRecord[];
}

export function usePlayback({
  resolveQueuedTrack,
  session,
  update,
  sessionRef,
  tracksRef,
  tracks,
  currentTrack,
  view,
  setView,
  notify,
  persist,
  dialogOpen,
  onSetFollow,
  onToggleQueue,
  queueOpen,
  listeningRecords = [],
}: UsePlaybackOptions) {
  const [playback, setPlayback] = useState<Playback>(player.state);
  const [undo, setUndo] = useState<Session["queue"] | null>(null);
  const [autoplayLoading, setAutoplayLoading] = useState(false);
  useTaskbarControls(playback.status === "playing" || playback.status === "buffering", Boolean(playback.trackId), autoplayLoading || playback.status === "loading" || playback.status === "buffering", togglePlay, skip);
  const autoplayRequest = useRef(0);
  const autoplayPending = useRef(false);
  const autoplayAnchor = useRef<Track | null>(null);
  const autoplayRecent = useRef<CatalogTrack[]>([]);
  const autoplayCount = useRef(0);
  const explicitSkips = useRef<{ track: Track; at: number }[]>([]);
  const pendingAutoplay = useRef<{ entryId: string; track: Track; metadata?: CatalogTrack; playbackId: Playback['playbackId'] } | null>(null);
  const recordsRef = useRef(listeningRecords);
  recordsRef.current = listeningRecords;
  const autoOpenedLyrics = useRef<string | null>(null);
  const failedQueueItems = useRef(new Set<string>());
  const lastVolumeRef = useRef<number>(session.settings.volume || 0.7);
  const warmedNext = useRef("");
  const shouldWarmNext = playback.status === "playing" && playback.duration > 0 && playback.time >= playback.duration - 30;
  useEffect(() => {
    if (mobile || !shouldWarmNext) return;
    const nextId = advance(session, 1);
    const entry = session.queue.find(item => item.id === nextId);
    if (!entry || entry.id === session.currentId) return;
    const next = tracksRef.current.find(track => track.id === entry.trackId) || session.queueTracks[entry.trackId];
    const key = `${session.currentId}:${entry.id}`;
    if (!next || next.offline || warmedNext.current === key || (!isQueuedCatalog(next) && next.source?.providerId !== "youtube")) return;
    warmedNext.current = key;
    // Resolve only the next source near the end; the audio element still streams on demand.
    void (isQueuedCatalog(next) ? resolveQueuedTrack(next) : Promise.resolve(next)).then(track => {
      if (track.source?.providerId === "youtube") return prepareCatalogCandidate({ id: track.source.sourceId, title: track.title, channel: track.artist, duration: track.duration, thumbnail: track.artworkUrl || null });
    }).catch(() => {});
  }, [shouldWarmNext, session.currentId, session.queue, session.shuffleOrder, session.settings.shuffle]);

  // Subscribe to playback changes
  useEffect(() => {
    return player.subscribe(state => {
      const native = state.nativeQueue;
      if (mobile && native && (native.epoch !== sessionRef.current.nativeQueueEpoch || native.revision > (sessionRef.current.nativeQueueRevision ?? -1))) {
        Object.values(native.session.queueTracks).forEach(track => playbackTracks.set(track.id, track));
        update(s => ({ ...s, queue: native.session.queue, queueTracks: native.session.queueTracks,
          currentId: native.session.currentId, shuffleOrder: native.session.shuffleOrder, position: state.time,
          nativeQueueRevision: native.revision, nativeQueueEpoch: native.epoch }));
      }
      setPlayback(state);
    });
  }, []);

  useEffect(() => {
    if (!mobile || !('handoffQueue' in player) || (!['playing', 'paused', 'buffering'].includes(playback.status) && !(playback.status === 'loading' && playback.nativeQueue))) return;
    const entry = session.queue.find(item => item.id === session.currentId);
    if (!entry || entry.trackId !== playback.trackId) return;
    void player.handoffQueue({ session, tracks, records: listeningRecords, languages: discoveryPreferences().languages, listening:nativeListeningHandoff() }, playback.nativeQueueRevision ?? 0)
      .catch(error => console.warn('Background queue handoff failed', String(error)));
  }, [session, tracks, listeningRecords, playback.trackId, playback.status, playback.nativeQueueRevision]);

  useEffect(() => {
    let checkpoint = 0;
    return player.subscribe(state => {
      const current = sessionRef.current.queue.find(entry => entry.id === sessionRef.current.currentId);
      if (current?.trackId !== state.trackId || !['playing', 'paused', 'ended'].includes(state.status)) return;
      const now = Date.now();
      if (state.status === 'playing' && now - checkpoint < 5000) return;
      checkpoint = now;
      update(s => s.queue.find(entry => entry.id === s.currentId)?.trackId === state.trackId
        ? checkpointListening(s, tracksRef.current, state.time, state.status === 'ended', now) : s);
    });
  }, []);

  useEffect(() => {
    if (mobile && playback.nativeQueue) return;
    if (playback.status === "playing") failedQueueItems.current.clear();
    if (playback.status !== "error" || !playback.autoplay) return;
    const current = sessionRef.current.queue.find(entry => entry.id === sessionRef.current.currentId);
    if (!current || current.trackId !== playback.trackId || failedQueueItems.current.has(current.id)) return;
    failedQueueItems.current.add(current.id);
    const next = advanceAfterFailure(sessionRef.current, failedQueueItems.current);
    if (next) {
      playbackEvent({ trackId: current.trackId, stage: "queue-skip", reason: "unavailable" });
      notify(`Skipped unavailable track. ${playback.error || "Retry it later."}`);
      selectQueue(next, true, false);
    } else if (sessionRef.current.settings.autoplay) {
      void continueAutoplay();
    }
  }, [playback.status, playback.trackId, playback.error]);

  // Update volume (on mobile, keep at 1.0; on desktop, follow settings)
  useEffect(() => {
    if (mobile) {
      player.volume(1);
    } else {
      player.volume(session.settings.volume);
    }
  }, [mobile, session.settings.volume]);

  // Adjust precision for lyrics room
  useEffect(() => {
    player.precise(view === "lyrics");
    return () => player.precise(false);
  }, [view]);

  // On ended callback and widget next/prev navigation
  useEffect(() => {
    player.onEnded = () => {
      const s = sessionRef.current;
      const next = advance(s, 1, true);
      if (next) {
        selectQueue(next, true, false);
      } else if (s.settings.autoplay) {
        void continueAutoplay();
      } else {
        persist();
      }
    };
    if ("onNext" in player) {
      (player as { onNext?: () => void }).onNext = () => {
        skip(1);
      };
    }
    if ("onPrevious" in player) {
      (player as { onPrevious?: () => void }).onPrevious = () => {
        skip(-1);
      };
    }
  });

  // Start audio only after React has committed our queue entry, never from a stale snapshot.
  useEffect(() => {
    const pending = pendingAutoplay.current;
    if (!pending) return;
    pendingAutoplay.current = null;
    if (session.currentId !== pending.entryId || !session.settings.autoplay || player.state.playbackId !== pending.playbackId || ['playing', 'buffering', 'loading'].includes(player.state.status)) return;
    playbackTracks.set(pending.track.id, pending.track);
    autoplayCount.current++;
    if (pending.metadata) autoplayRecent.current = [...autoplayRecent.current, pending.metadata].slice(-80);
    void player.load(pending.track.id, true);
  }, [session.currentId, session.queue, session.settings.autoplay]);

  useEffect(() => {
    autoplayRequest.current++;
    autoplayPending.current = false;
    setAutoplayLoading(false);
    if (!session.settings.autoplay) autoplayAnchor.current = null;
    return () => { autoplayRequest.current++; autoplayPending.current = false; };
  }, [session.settings.autoplay, session.currentId, session.queue]);

  useEffect(() => {
    if (session.settings.autoplay && playback.status === 'ended' && !advance(sessionRef.current, 1, true)) void continueAutoplay();
  }, [session.settings.autoplay, playback.status, session.currentId, session.queue]);

  async function continueAutoplay() {
    if (mobile && player.state.nativeQueue) return;
    if (autoplayPending.current || !sessionRef.current.settings.autoplay) return;
    const initial = sessionRef.current;
    const current = initial.queue.find(entry => entry.id === initial.currentId);
    const seed = current && (tracksRef.current.find(track => track.id === current.trackId) || initial.queueTracks[current.trackId]);
    if (!current || !seed?.artist || /unknown artist/i.test(seed.artist)) return;
    const request = ++autoplayRequest.current;
    const playbackId = player.state.playbackId;
    const queueVersion = initial.queue;
    autoplayAnchor.current ??= seed;
    const anchor = autoplayAnchor.current;
    const active = () => request === autoplayRequest.current && sessionRef.current.settings.autoplay
      && sessionRef.current.currentId === current.id && player.state.playbackId === playbackId
      && sessionRef.current.queue === queueVersion
      && !advance(sessionRef.current, 1);
    autoplayPending.current = true;
    setAutoplayLoading(true);
    player.pause();
    try {
      const preferences = () => ({ session: sessionRef.current, saved: tracksRef.current, records: recordsRef.current, languages: discoveryPreferences().languages });
      const pool = await loadAutoplayPool(anchor, active);
      if (!active()) return;
      const live = sessionRef.current;
      const known = live.queue.map(entry => tracksRef.current.find(track => track.id === entry.trackId) || live.queueTracks[entry.trackId]).filter((track): track is Track => !!track);
      const excluded = [...known, ...autoplayRecent.current.map(item => catalogQuickPick(item).track), ...explicitSkips.current.filter(item => Date.now() - item.at < 10 * 60000).map(item => item.track)];
      const ranked = rankAutoplay(pool.candidates, preferences(), { anchor, current: seed, metadata: pool.metadata, recent: autoplayRecent.current, skipped: explicitSkips.current, excluded, turn: autoplayCount.current + 1 });
      if (!ranked.length) { notify('Autoplay could not verify a matching song in the original song’s language. Add a song to the queue or try again.'); return; }
      const resolvedCandidates = new Map<Track, CatalogTrack>();
      const track = await resolveAutoplayCandidate(ranked.map(item => item.track), async candidate => {
        const resolved = await resolveQueuedTrack(candidate);
        const metadata = ranked.find(item => item.track.id === candidate.id)?.track;
        if (metadata) resolvedCandidates.set(resolved, metadata);
        return resolved;
      }, active, resolved => autoplayCandidates([{ ...resolved, artists: [] }], seed, excluded).length > 0
        && !excluded.some(known => resolved.metadataSourceId && [known.id, known.metadataSourceId].includes(resolved.metadataSourceId)));
      if (!active()) return;
      if (!track) { notify('No playable songs found in this radio. Try Next again.'); return; }
      if (['playing', 'buffering', 'loading'].includes(player.state.status)) return;
      const next = enqueue({ ...sessionRef.current, queueTracks: { ...sessionRef.current.queueTracks, [track.id]: track } }, track.id);
      const selected = next.queue.find(entry => entry.id === advance(next, 1));
      if (selected) {
        pendingAutoplay.current = { entryId: selected.id, track, metadata: resolvedCandidates.get(track), playbackId };
        update(s => s.queue !== queueVersion || s.currentId !== current.id || !s.settings.autoplay ? s : ({ ...s,
          queueTracks: { ...s.queueTracks, [track.id]: track }, shuffleOrder: next.shuffleOrder,
          currentId: selected.id, position: 0, queue: next.queue.map(entry => entry.id === selected.id ? { ...entry, requested: false } : entry),
        }));
      }
    } catch { if (active()) notify('Autoplay could not reach the catalog. Try Next again to retry.'); }
    finally {
      if (request === autoplayRequest.current) {
        autoplayPending.current = false;
        setAutoplayLoading(false);
      }
    }
  }

  // Keyboard shortcuts (Nuclear & desktop media controls)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isInput = Boolean(
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable),
      );

      // In text inputs, allow Escape to blur the input without triggering playback shortcuts
      if (isInput) {
        if (e.key === "Escape") {
          target?.blur();
        }
        return;
      }

      if (dialogOpen || target?.closest("dialog[open]:not(.expanded-player), .apple-select-container, [role='listbox'], [role='menu']")) {
        return;
      }

      // Space: Toggle Play / Pause (blur any focused button so it doesn't trigger synthetic button clicks)
      if (e.code === "Space" || e.key === " ") {
        e.preventDefault();
        if (target && target.tagName === "BUTTON") {
          target.blur();
        }
        togglePlay();
        return;
      }

      // Next track: Ctrl+Right or Alt+Right
      if (
        (e.ctrlKey || e.altKey) &&
        (e.key === "ArrowRight" || e.code === "ArrowRight")
      ) {
        e.preventDefault();
        skip(1);
        return;
      }

      // Previous track: Ctrl+Left or Alt+Left
      if (
        (e.ctrlKey || e.altKey) &&
        (e.key === "ArrowLeft" || e.code === "ArrowLeft")
      ) {
        e.preventDefault();
        skip(-1);
        return;
      }

      // Seek forward (+5s): Right arrow (without Ctrl/Alt)
      if (
        !e.ctrlKey &&
        !e.altKey &&
        (e.key === "ArrowRight" || e.code === "ArrowRight")
      ) {
        e.preventDefault();
        const duration = playback.duration || 0;
        const newTime = Math.min(duration, (playback.time || 0) + 5);
        seek(newTime);
        return;
      }

      // Seek backward (-5s): Left arrow (without Ctrl/Alt)
      if (
        !e.ctrlKey &&
        !e.altKey &&
        (e.key === "ArrowLeft" || e.code === "ArrowLeft")
      ) {
        e.preventDefault();
        const newTime = Math.max(0, (playback.time || 0) - 5);
        seek(newTime);
        return;
      }

      // Volume up (+5%): Ctrl+Up or Up arrow
      if (
        (e.ctrlKey && (e.key === "ArrowUp" || e.code === "ArrowUp")) ||
        (!e.altKey &&
          !e.ctrlKey &&
          (e.key === "ArrowUp" || e.code === "ArrowUp"))
      ) {
        e.preventDefault();
        const currentVol = sessionRef.current.settings.volume;
        const nextVol = Math.min(
          1,
          Math.round((currentVol + 0.05) * 100) / 100,
        );
        update((s) => ({ ...s, settings: { ...s.settings, volume: nextVol } }));
        player.volume(nextVol);
        notify(`Volume: ${Math.round(nextVol * 100)}%`);
        return;
      }

      // Volume down (-5%): Ctrl+Down or Down arrow
      if (
        (e.ctrlKey && (e.key === "ArrowDown" || e.code === "ArrowDown")) ||
        (!e.altKey &&
          !e.ctrlKey &&
          (e.key === "ArrowDown" || e.code === "ArrowDown"))
      ) {
        e.preventDefault();
        const currentVol = sessionRef.current.settings.volume;
        const nextVol = Math.max(
          0,
          Math.round((currentVol - 0.05) * 100) / 100,
        );
        update((s) => ({ ...s, settings: { ...s.settings, volume: nextVol } }));
        player.volume(nextVol);
        notify(`Volume: ${Math.round(nextVol * 100)}%`);
        return;
      }

      // Mute / Unmute: Ctrl+M or M
      if (
        (e.ctrlKey && (e.key === "m" || e.key === "M")) ||
        (!e.ctrlKey && !e.altKey && (e.key === "m" || e.key === "M"))
      ) {
        e.preventDefault();
        const currentVol = sessionRef.current.settings.volume;
        if (currentVol > 0) {
          lastVolumeRef.current = currentVol;
          update((s) => ({ ...s, settings: { ...s.settings, volume: 0 } }));
          player.volume(0);
          notify("Muted");
        } else {
          const restore =
            lastVolumeRef.current > 0 ? lastVolumeRef.current : 0.7;
          update((s) => ({
            ...s,
            settings: { ...s.settings, volume: restore },
          }));
          player.volume(restore);
          notify(`Unmuted (${Math.round(restore * 100)}%)`);
        }
        return;
      }

      // Open / toggle Settings: Ctrl + Comma
      if ((e.ctrlKey || e.metaKey) && (e.key === "," || e.code === "Comma")) {
        e.preventDefault();
        setView(view === "settings" ? "library" : "settings");
        return;
      }

      // Toggle Queue: Ctrl + Q
      if (
        (e.ctrlKey || e.metaKey) &&
        (e.key === "q" || e.key === "Q" || e.code === "KeyQ")
      ) {
        e.preventDefault();
        onToggleQueue?.();
        return;
      }

      // Escape: close queue if open
      if (e.key === "Escape" && queueOpen) {
        e.preventDefault();
        onToggleQueue?.();
        return;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });

  // Auto-open lyrics when playback starts
  useEffect(() => {
    const current = session.queue.find((i) => i.id === session.currentId);
    if (
      playback.status === "playing" &&
      current &&
      session.settings.autoOpenLyrics &&
      autoOpenedLyrics.current !== current.id
    ) {
      autoOpenedLyrics.current = current.id;
      setView("lyrics");
      if (onSetFollow) onSetFollow(true);
    }
  }, [playback.status, session.currentId, session.settings.autoOpenLyrics]);

  function selectQueue(id: string, autoplay: boolean, deliberate = true) {
    autoplayRequest.current++;
    autoplayPending.current = false;
    setAutoplayLoading(false);
    const selected = sessionRef.current.queue.find((i) => i.id === id);
    if (!selected) return;
    if (deliberate) autoplayAnchor.current = tracksRef.current.find(track => track.id === selected.trackId) || sessionRef.current.queueTracks[selected.trackId] || null;
    const previous = player.state;
    update((s) => ({
      ...checkpointListening(s, tracksRef.current, previous.time, previous.status === 'ended'),
      currentId: id,
      position: 0,
      queue: s.queue.map((entry) =>
        entry.id === id ? { ...entry, requested: false } : entry,
      ),
    }));
    void loadQueuedTrack(selected, autoplay);
    if (onSetFollow) onSetFollow(true);
  }

  async function loadQueuedTrack(entry: QueueItem, autoplay: boolean, selected?: Track, position = 0) {
    if (mobile && 'startQueue' in player) {
      await player.startQueue({session:{...sessionRef.current,currentId:entry.id,position},tracks:tracksRef.current,records:recordsRef.current,languages:discoveryPreferences().languages,listening:nativeListeningHandoff(true)},autoplay,position);
      return;
    }
    const track = selected || tracksRef.current.find(t => t.id === entry.trackId) || sessionRef.current.queueTracks[entry.trackId];
    if (!track || !isQueuedCatalog(track)) { void player.load(entry.trackId, autoplay, position); return; }
    const token = player.beginLoading(track.id, autoplay, position);
    try {
      const resolved = await resolveQueuedTrack(track);
      if (player.state.playbackId !== token) return;
      if (isQueuedCatalog(resolved)) throw Error("The catalog entry did not resolve to playable audio. Retry later.");
      playbackTracks.set(resolved.id, resolved);
      update(s => resolveQueueEntry(s, entry.id, track.id, resolved));
      void player.load(resolved.id, autoplay, position);
    } catch (error) {
      player.failLoading(token, error instanceof Error ? error.message : String(error), autoplay);
    }
  }

  function playTrack(t: Track) {
    if (player.state.trackId === t.id && player.state.status === "loading") return;
    autoplayAnchor.current = t;
    autoplayRequest.current++;
    autoplayPending.current = false;
    setAutoplayLoading(false);
    playbackTracks.set(t.id, t);
    setUndo(null);
    const previousPosition = player.state.time;
    update((s) =>
      playSelection(
        checkpointListening(s, tracksRef.current, previousPosition),
        t,
        tracksRef.current.some((saved) => saved.id === t.id),
      ),
    );
    if (mobile) {
      const entry = sessionRef.current.queue.find(item => item.id === sessionRef.current.currentId);
      if (entry) void loadQueuedTrack(entry, true, t);
    } else void player.load(t.id, true);
    if (onSetFollow) onSetFollow(true);
  }

  async function chooseRecording(catalog: CatalogTrack, source: YtdlpSearchResult, entryId: string) {
    const before = sessionRef.current.queue.find(item => item.id === entryId);
    if (!before || sessionRef.current.currentId !== entryId) throw Error('Playback selection changed.');
    const old = tracksRef.current.find(item => item.id === before.trackId) || sessionRef.current.queueTracks[before.trackId];
    if (!old || old.offline || (!isQueuedCatalog(old) && !old.id.startsWith('youtube:')) || old.metadataSourceId !== catalog.id) throw Error('Playback selection changed.');
    const playbackId = player.state.playbackId;
    const candidate = {...source,...await prepareCatalogCandidate(source)};
    if (!(await matchSource(catalog,candidate)).accepted) throw Error('This recording no longer matches the selected song.');
    if (player.state.playbackId !== playbackId || sessionRef.current.currentId !== entryId) throw Error('Playback selection changed.');
    await library.setVerifiedSource(catalog.id,{sourceId:candidate.id,sourceProvider:'youtube',title:candidate.title,artist:candidate.channel,duration:candidate.duration,userSelected:true});
    if (player.state.playbackId !== playbackId || sessionRef.current.currentId !== entryId) return;
    const position = player.state.time;
    const autoplay = player.state.status === 'playing' || player.state.status === 'buffering' || (['loading','error'].includes(player.state.status) && !!player.state.autoplay);
    const resolved = canonicalTrack(catalog,candidate);
    playbackTracks.set(resolved.id,resolved);
    // Replace only this occurrence; saved tracks, favorites, downloads and other queue entries retain their identities.
    update(s=>({...s,queue:s.queue.map(item=>item.id===entryId?{...item,trackId:resolved.id}:item),queueTracks:{...s.queueTracks,[resolved.id]:resolved},position}));
    const entry = sessionRef.current.queue.find(item=>item.id===entryId);
    if (entry) await loadQueuedTrack(entry,autoplay,resolved,position);
  }

  function playCollectionTrack(collectionTracks: Track[], startIndex: number, shuffle = sessionRef.current.settings.shuffle) {
    if (player.state.status === "loading" && player.state.autoplay && player.state.trackId === collectionTracks[startIndex]?.id && sessionRef.current.settings.shuffle === shuffle) return;
    setUndo(null);
    const next = playCollection(
      { ...checkpointListening(sessionRef.current, tracksRef.current, player.state.time), settings: { ...sessionRef.current.settings, shuffle } },
      collectionTracks,
      startIndex,
    );
    if (!next.currentId || !collectionTracks[startIndex] || collectionTracks[startIndex].missing) return;
    autoplayAnchor.current = collectionTracks[startIndex];
    autoplayRequest.current++;
    autoplayPending.current = false;
    setAutoplayLoading(false);
    update(() => next);
    collectionTracks.forEach(track => playbackTracks.set(track.id, track));
    void loadQueuedTrack(next.queue.find(entry => entry.id === next.currentId)!, true, collectionTracks[startIndex]);
    if (onSetFollow) onSetFollow(true);
  }

  function resumeListening(id: string) {
    const resume = sessionRef.current.listeningResumes?.find(item => item.id === id);
    if (!resume) return;
    const entry = resume.queue.find(item => item.id === resume.currentId);
    if (!entry || resume.queue.some(item => !(tracksRef.current.find(track => track.id === item.trackId) || resume.queueTracks[item.trackId]) || tracksRef.current.find(track => track.id === item.trackId)?.missing)) { notify('Some tracks in this saved queue are unavailable.'); return; }
    const previousPosition = player.state.time;
    update(s => ({ ...checkpointListening(s, tracksRef.current, previousPosition), queue: resume.queue, queueTracks: resume.queueTracks, currentId: resume.currentId, position: resume.position, shuffleOrder: resume.shuffleOrder, settings: { ...s.settings, shuffle: resume.shuffle } }));
    Object.values(resume.queueTracks).forEach(track => playbackTracks.set(track.id, track));
    const track = tracksRef.current.find(track => track.id === entry.trackId) || resume.queueTracks[entry.trackId];
    autoplayAnchor.current = track || null;
    autoplayRequest.current++;
    autoplayPending.current = false;
    setAutoplayLoading(false);
    void loadQueuedTrack(entry, true, track, resume.position);
  }

  function togglePlay() {
    if (autoplayPending.current || player.state.status === "loading") return;
    if (currentTrack && isQueuedCatalog(currentTrack) && sessionRef.current.currentId) { selectQueue(sessionRef.current.currentId, true); return; }
    if (!currentTrack) {
      const queued = sessionRef.current.queue[0];
      if (queued) {
        selectQueue(queued.id, true);
        return;
      }
      const first = tracks[0];
      if (first) playTrack(first);
      return;
    }
    if (playback.status === "playing" || playback.status === "buffering") {
      player.pause();
    } else if (playback.status === "error") {
      void player.load(currentTrack.id, true, playback.time);
    } else {
      void player.play();
    }
  }

  function skip(direction: 1 | -1) {
    if (direction === -1 && playback.time > 3) {
      player.seek(0);
      return;
    }
    const state = player.state;
    const current = sessionRef.current.queue.find(entry => entry.id === sessionRef.current.currentId);
    const track = current && (tracksRef.current.find(track => track.id === current.trackId) || sessionRef.current.queueTracks[current.trackId]);
    if (direction === 1 && !autoplayPending.current && track && state.trackId === track.id && ['playing', 'paused'].includes(state.status)) {
      explicitSkips.current = [...explicitSkips.current, { track, at: Date.now() }].slice(-50);
    }
    const id = advance(sessionRef.current, direction);
    if (id) selectQueue(id, true, false);
    else if (direction === -1) player.seek(0);
    else if (sessionRef.current.settings.autoplay) void continueAutoplay();
  }

  function queueTrack(id: string, next = false) {
    update((s) => enqueue(s, id, next));
    notify(next ? "Added to play next" : "Added to queue");
  }

  function queueRemote(t: Track, next = false) {
    const saved = tracksRef.current.some((track) => track.id === t.id);
    update((s) =>
      enqueue(
        {
          ...s,
          queueTracks: saved ? s.queueTracks : { ...s.queueTracks, [t.id]: t },
        },
        t.id,
        next,
      ),
    );
    notify(next ? "Added to play next" : "Added to queue");
  }

  function removeQueue(id: string) {
    const s = sessionRef.current;
    setUndo(s.queue);
    const order = playbackQueue(s);
    const queue = s.queue.filter((i) => i.id !== id);
    if (id === s.currentId) {
      const index = order.findIndex((i) => i.id === id);
      const remaining = order.filter((entry) => entry.id !== id);
      const next = remaining[Math.min(index, remaining.length - 1)];
      update((x) => ({
        ...x,
        queue,
        currentId: next?.id ?? null,
        position: 0,
      }));
      if (next) void loadQueuedTrack(next, false);
      else player.stop();
    } else {
      update((x) => ({ ...x, queue }));
    }
  }

  function clearQueue() {
    setUndo(session.queue);
    update((s) => ({
      ...s,
      queue: s.queue.filter((entry) => entry.id === s.currentId),
    }));
  }

  function undoRemoval() {
    if (undo) {
      update((s) => ({ ...s, queue: undo }));
      setUndo(null);
    }
  }

  function seek(seconds: number) {
    player.seek(seconds);
    persist();
  }

  return {
    player,
    playback,
    autoplayLoading,
    undo,
    setUndo,
    selectQueue,
    playTrack,
    chooseRecording,
    playCollectionTrack,
    resumeListening,
    togglePlay,
    skip,
    queueTrack,
    queueRemote,
    removeQueue,
    clearQueue,
    undoRemoval,
    seek,
  };
}
