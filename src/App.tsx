import { localSearchMatches } from "./domain/search";
import { toggleNativeFullscreen } from "./adapters/fullscreen";
import {lyricsVersionMatches} from './domain/lyrics';
import { WindowControls } from "./components/common/WindowControls";
import { useSyncExternalStore } from "react";
import { initializeUpdates, getUpdateState, subscribeToUpdates, dismissReleaseNotes, supportsWindowsUpdates } from "./adapters/updater";
import { MusicLanguageOnboarding } from "./components/modals/MusicLanguageOnboarding";
import { UpdateDialog } from "./components/modals/UpdateDialog";
import { SourceChooser } from './components/modals/SourceChooser';
import { prepareCatalogCandidate } from './player/service';
import { matchSource } from './domain/source-matching';
import { downloadProgressText } from "./domain/downloads";
import { mergePlaylistImport, type PlaylistImportOptions } from "./domain/playlist-import";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { flushSync } from 'react-dom';
import { useExpandedLayout } from './hooks/useExpandedLayout';
import { usePlayerHistory } from './hooks/usePlayerHistory';
import { dismissAndroidLayer, useAndroidBack } from './hooks/useAndroidBack';
import { Disc3, Minimize2 } from "lucide-react";
import { desktop, mobile, library, type CatalogTrack } from "./adapters/native";
import { TopBar, Banners, MobileTabBar } from "./components/common";
import { PlayerBar } from "./components/player";
import { ExpandedPlayer } from "./components/player/ExpandedPlayer";
import { MobileNowPlaying } from "./components/player/MobileNowPlaying";
import { Sidebar } from "./components/sidebar";
import { QueuePanel } from "./components/queue";
import {
  SaveToPlaylistModal,
  AddMusicModal,
  PromptModal,
  LineAlignmentModal,
  type PromptDialogData,
} from "./components/modals";
import { LyricsView } from "./components/lyrics";
import { DiscoveryView, DiscoveryHome, SettingsView, LibraryView, ArtistView, AlbumView, ChartView } from "./components/views";
import { useAlbumDownloads } from "./hooks/useAlbumDownloads";
import {
  initialDiscoveryViewState,
  type DiscoveryViewState,
} from "./components/views/DiscoveryView";
import { libraryCollections } from "./domain/collections";
import { restoreSession } from "./domain/session";
import { lyricLayers } from "./domain/lyric-display";
import { type Track, type Playlist } from "./domain/types";
import {
  useLibraryManager,
  usePlayback,
  useLyricsEngine,
  useClickOutsideMenus,
} from "./hooks";
import { useListeningHistory } from "./hooks/useListeningHistory";
import { HistoryView } from "./components/views/HistoryView";
import { historyTrack, type ListeningRecord } from "./domain/listening";
import { clearListening } from "./player/listening-service";
import { reorderUpcoming } from "./domain/queue";
import { applyTheme, storeTheme } from "./theme";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { emit } from "@tauri-apps/api/event";
import type { CatalogAction } from "./components/common/CatalogTrackActions";
import { EngineSetupDialog } from "./components/modals/EngineSetupDialog";
import { clearDiscoverySearches } from "./adapters/discovery-home";
import { canonicalTrack, catalogQueueTrack } from "./domain/catalog-track";
import { CollectionHub } from "./components/views/CollectionHub";
import { useNearby } from "./hooks/useNearby";
import { useJam } from "./hooks/useJam";
import { useLyricOverlay } from "./hooks/useLyricOverlay";
import { overlaySnapshot } from "./domain/lyric-overlay";
import { mergePlaylistReplica, replicaTracks } from './domain/device-sync';
import { item } from "./domain/types";
import { collections as collectionAdapter } from "./adapters/collections";

type View =
  | "home"
  | "search"
  | "library"
  | "favorites"
  | "lyrics"
  | "settings"
  | "discover"
  | { type: "artist"; id: string }
  | { type: "album"; id: string }
  | { type: "chart"; id: string }
  | string;

export function App() {
  const expandedLayout = useExpandedLayout();
  const libraryManager = useLibraryManager();
  const {
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
    sessionRef,
    tracksRef,
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
  } = libraryManager;
  const engineSetup = {
    engineState: libraryManager.engineState,
    engineError: libraryManager.engineError,
    engineProgress: libraryManager.engineProgress,
    engineCancelling: libraryManager.engineCancelling,
    onInstallYoutubeEngine: libraryManager.installYoutubeEngine,
    onCancelYoutubeEngineInstall: libraryManager.cancelYoutubeEngineInstall,
  };
  const needsEngineSetup = desktop && (!ytdlpAvailable || engineSetup.engineState === "installing");

  const [view, setRawView] = useState<View>("home");
  const [discoverRoute, setDiscoverRoute] = useState<View>("home");
  const currentViewRef = useRef<View>(view);
  currentViewRef.current = view;

  const [navHistory, setNavHistory] = useState<View[]>(["home"]);
  const [navIndex, setNavIndex] = useState(0);

  const canGoBack = navIndex > 0;
  const canGoForward = navIndex < navHistory.length - 1;

  const goBack = useCallback(() => {
    if (navIndex > 0) {
      const prevIndex = navIndex - 1;
      const prev = navHistory[prevIndex];
      setNavIndex(prevIndex);
      setRawView(prev);
    }
  }, [navIndex, navHistory]);

  const goForward = useCallback(() => {
    if (navIndex < navHistory.length - 1) {
      const nextIndex = navIndex + 1;
      const next = navHistory[nextIndex];
      setNavIndex(nextIndex);
      setRawView(next);
    }
  }, [navIndex, navHistory]);

  const scrollPositions = useRef(new Map<string, number>());
  const viewKey = (v: View) => (typeof v === "object" ? `${v.type}:${v.id}` : String(v));

  const setView = useCallback((next: View | ((prev: View) => View)) => {
    const main = document.getElementById("main");
    if (main) {
      scrollPositions.current.set(viewKey(currentViewRef.current), main.scrollTop);
    }
    setRawView((prev) => {
      const resolved = typeof next === "function" ? (next as (prev: View) => View)(prev) : next;
      if (mobile && viewKey(prev) === viewKey(resolved)) return prev;
      setNavHistory((hist) => [...hist.slice(0, navIndex + 1), resolved]);
      setNavIndex((i) => i + 1);
      return resolved;
    });
  }, [navIndex]);

  const [catalogHistory, setCatalogHistory] = useState<View[]>([]);
  const [historyTab, setHistoryTab] = useState<"stats" | "history">("stats");

  function selectView(next: View, targetHistoryTab: "stats" | "history" = "stats") {
    if (next === "history") {
      setHistoryTab(targetHistoryTab);
    }
    const target = next === "discover" ? discoverRoute : next;
    const currentKey = viewKey(view);
    const targetKey = viewKey(target);
    const isSame =
      currentKey === targetKey ||
      ((currentKey === "search" || currentKey === "discover") &&
        (targetKey === "search" || targetKey === "discover"));

    if (isSame) {
      const main = document.getElementById("main");
      if (main) {
        main.scrollTo({ top: 0, behavior: "smooth" });
        scrollPositions.current.set(currentKey, 0);
      }
      if (currentKey === "search" || currentKey === "discover") {
        setDiscoveryState((prev) => ({ ...prev, scrollTop: 0 }));
      }
      return;
    }

    if ((next === "home" || next === "discover" || next === "search") && typeof view === "object") {
      scrollPositions.current.set(viewKey(next), 0);
      setView(next);
      setDiscoverRoute(next);
      setCatalogHistory([]);
      return;
    }
    scrollPositions.current.set(targetKey, 0);
    setView(target);
  }

  useLayoutEffect(() => {
    const main = document.getElementById("main");
    if (!main) return;
    const key = viewKey(view);
    main.scrollTop = scrollPositions.current.get(key) ?? 0;
  }, [view]);

  function navigateCatalog(next: View) {
    setCatalogHistory(history => typeof view === "object" ? [...history, view] : [view]);
    setView(next);
    setDiscoverRoute(next);
  }
  function backFromCatalog() {
    const previous = catalogHistory[catalogHistory.length - 1] ?? "home";
    setView(previous);
    setDiscoverRoute(typeof previous === "object" ? previous : "home");
    setCatalogHistory(history => history.slice(0, -1));
  }
  const [query, setQuery] = useState("");
  const [headerSearchQuery, setHeaderSearchQuery] = useState("");
  const [discoveryState, setDiscoveryState] = useState<DiscoveryViewState>(
    initialDiscoveryViewState,
  );
  const [queueOpen, setQueueOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    if (typeof window === "undefined") return 240;
    const saved = localStorage.getItem("lumaire:sidebar-width");
    const parsed = saved ? parseInt(saved, 10) : 240;
    return Number.isFinite(parsed) && parsed >= 180 ? Math.min(parsed, 320) : 240;
  });
  const [isResizingSidebar, setIsResizingSidebar] = useState(false);
  const [queueWidth, setQueueWidth] = useState<number>(() => {
    if (typeof window === "undefined") return 315;
    const saved = localStorage.getItem("lumaire:queue-width");
    const parsed = saved ? parseInt(saved, 10) : 315;
    return Number.isFinite(parsed) && parsed >= 260 ? Math.min(parsed, 380) : 315;
  });
  useEffect(() => {
    if (queueWidth > 380) {
      setQueueWidth(380);
      localStorage.setItem("lumaire:queue-width", "380");
      document.documentElement.style.setProperty("--queue-width", "380px");
    }
  }, [queueWidth]);
  const [isResizingQueue, setIsResizingQueue] = useState(false);
  const [dialog, setDialog] = useState<PromptDialogData | null>(null);
  const [sourceChooser,setSourceChooser] = useState<{catalogId:string;entryId:string|null}|null>(null);
  useEffect(()=>{
    if(sourceChooser&&(sourceChooser.entryId===null ? libraryManager.pendingTrack?.id!==sourceChooser.catalogId : session.currentId!==sourceChooser.entryId))setSourceChooser(null);
  },[session.currentId,sourceChooser,libraryManager.pendingTrack?.id]);
  const [playlistTarget, setPlaylistTarget] = useState<Track | null>(null);
  const [addMusicPlaylist, setAddMusicPlaylist] = useState<Playlist | null>(null);
  const listeningHistory = useListeningHistory(
    ready,
    sessionRef,
    tracksRef,
    session.settings.historyEnabled,
  );
  useEffect(() => {
    if (ready && !session.settings.historyEnabled) clearDiscoverySearches();
  }, [ready, session.settings.historyEnabled]);
  useClickOutsideMenus();

  useEffect(() => {
    if (!ready) return;
    const preference = {
      themeMode: session.settings.themeMode,
      accentColor: session.settings.accentColor,
    };
    applyTheme(preference);
    storeTheme(preference);
    if (isTauri()) {
      void emit("lumaire:theme-change", preference).catch(() => {});
    }
  }, [ready, session.settings.themeMode, session.settings.accentColor]);

  const dialogRef = useRef<HTMLDialogElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);

  const current = session.queue.find((i) => i.id === session.currentId);
  const listeningTracks = [
    ...tracks,
    ...Object.values(session.queueTracks).filter(
      (t) => !tracks.some((saved) => saved.id === t.id),
    ),
  ];
  const track = listeningTracks.find((t) => t.id === current?.trackId);
  const savedDoc = track ? session.lyrics[track.id] : undefined;
  const doc = savedDoc && track && lyricsVersionMatches(savedDoc,track.title) ? savedDoc : undefined;

  useEffect(() => {
    scrollPositions.current.set("lyrics", 0);
    if (view === "lyrics") {
      document.getElementById("main")?.scrollTo({ top: 0, behavior: "instant" });
    }
  }, [track?.id, view]);

  const updateState = useSyncExternalStore(subscribeToUpdates, getUpdateState, getUpdateState);
  const [updatesOpen, setUpdatesOpen] = useState(false);
  useEffect(() => { void initializeUpdates(); }, []);
  useEffect(() => { if (updateState.unreadNotes) setUpdatesOpen(true); }, [updateState.unreadNotes]);
  const closeUpdates = () => { dismissReleaseNotes(); setUpdatesOpen(false); };
  const [expanded, setExpanded] = useState(false);
  const dismissPlayer = useCallback(() => setExpanded(false), []);
  usePlayerHistory(expanded, dismissPlayer);
  const [mobilePlayerTab, setMobilePlayerTab] = useState<"player" | "queue">("player");
  function openExpanded() { setMobilePlayerTab("player"); setExpanded(true); }
  function closeExpanded() { setExpanded(false); requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(".cover-expand, .mobile-cover-expand")?.focus()); }
  useAndroidBack(mobile, `${viewKey(view)}:${navIndex}`, {
    // Returning to Home reaches Android's root even when earlier tabs remain in desktop history.
    canGoBack: view !== 'home' && canGoBack,
    goBack,
    dismiss: () => {
      if (dismissAndroidLayer(document, !expanded)) return true;
      if (expanded) {
        if (mobilePlayerTab === 'queue') setMobilePlayerTab('player');
        else if (history.state?.mobileNowPlaying) history.back();
        else closeExpanded();
        return true;
      }
      if (view === 'settings' && history.state?.mobileSettings) { history.back(); return true; }
      return false;
    },
  });
  function openDiscoverSearch() {
    flushSync(() => selectView('search'));
    const input = document.querySelector<HTMLInputElement>('.discover-search-bar input');
    input?.focus({ preventScroll: true });
    input?.scrollIntoView({ block: 'center', behavior: 'instant' });
    if (mobile && input) void invoke('plugin:lumaire-android|navigation', { action: 'keyboard' }).catch(() => {});
  }
  const [collectionHub, setCollectionHub] = useState<"import" | "devices" | "jam" | false>(false);
  const followRef = useRef<(f: boolean) => void>(() => {});
  const [isFullscreen, setIsFullscreen] = useState(false);
  const restoreMaximized = useRef(false);
  const fullscreenBusy = useRef(false);

  const toggleFullscreen = useCallback(async () => {
    if (fullscreenBusy.current) return;
    fullscreenBusy.current = true;
    try {
      if (isTauri()) {
        setIsFullscreen(await toggleNativeFullscreen(getCurrentWindow(), restoreMaximized));
      } else if (document.fullscreenElement) {
        await document.exitFullscreen();
        setIsFullscreen(false);
      } else {
        await document.documentElement.requestFullscreen();
        setIsFullscreen(true);
      }
    } catch (e) {
      setError(`Could not change fullscreen mode. ${String(e)}`);
      if (isTauri()) {
        void getCurrentWindow().isFullscreen().then(setIsFullscreen).catch(() => {});
      }
    } finally {
      fullscreenBusy.current = false;
    }
  }, []);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "F11") {
        e.preventDefault();
        void toggleFullscreen();
      } else if (e.key === "Escape" && isFullscreen) {
        e.preventDefault();
        void toggleFullscreen();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [toggleFullscreen, isFullscreen]);

  useEffect(() => {
    const onFsChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  const playbackEngine = usePlayback({
    listeningRecords: listeningHistory.records,
    resolveQueuedTrack: async (queued) =>
      resolveDiscovery({ ...queued, artists: [] }),
    session,
    update,
    sessionRef,
    tracksRef,
    tracks,
    currentTrack: track,
    view: expanded && expandedLayout ? "lyrics" : typeof view === "object" ? "discover" : view,
    setView: selectView,
    notify,
    persist,
    dialogOpen: Boolean(dialog || playlistTarget || collectionHub || updatesOpen || sourceChooser),
    onSetFollow: (f) => followRef.current(f),
    onToggleQueue: () => setQueueOpen((q) => !q),
    queueOpen,
  });

  const lyricsEngine = useLyricsEngine({
    track,
    doc,
    playback: playbackEngine.playback,
    session,
    update,
    sessionRef,
    ready,
    view: expanded && expandedLayout ? "lyrics" : typeof view === "object" ? "discover" : view,
    notify,
    action,
    setError,
  });

  followRef.current = lyricsEngine.setFollow;

  const {
    player,
    playback,
    undo,
    selectQueue,
    playTrack,
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
  } = playbackEngine;

  const pendingTrackActive = Boolean(
    libraryManager.pendingTrack &&
    playback.trackId &&
    libraryManager.pendingTrack.id === playback.trackId,
  );
  const activeTrack = pendingTrackActive ? libraryManager.pendingTrack : track;
  const correctionCatalog = activeTrack?.metadataSourceId || (activeTrack?.format==='catalog'?activeTrack.id:null);
  const wrongVersion = correctionCatalog && activeTrack && !activeTrack.offline && (activeTrack.format==='catalog'||activeTrack.id.startsWith('youtube:'))
    ? ()=>setSourceChooser({catalogId:correctionCatalog,entryId:pendingTrackActive?null:session.currentId}) : undefined;

  // Sync live lyrics to native Android widgets when available
  useEffect(() => {
    if (mobile && activeTrack?.id && "setLyrics" in player) {
      const activeDoc = (activeTrack?.id ? session.lyrics[activeTrack.id] : undefined) || doc;
      if (!activeDoc) {
        (player as { setLyrics: (id: string, lines: unknown[]) => void }).setLyrics(
          activeTrack.id,
          [],
        );
        return;
      }
      if (activeDoc.instrumental) {
        (player as { setLyrics: (id: string, lines: unknown[]) => void }).setLyrics(
          activeTrack.id,
          [{ time: 0, text: "♪ Instrumental ♪" }],
        );
        return;
      }
      const offset = (activeDoc.fileOffset || 0) + (activeDoc.userOffset || 0);
      const lines = (activeDoc.lines || []).map((l) => {
        const primaryText = lyricLayers(activeDoc, l, session.settings)[0]?.text || l.text;
        return {
          time: l.time !== null && l.time !== undefined ? Math.max(0, Math.round(l.time + offset)) : null,
          text: primaryText,
        };
      });
      (player as { setLyrics: (id: string, lines: unknown[]) => void }).setLyrics(
        activeTrack.id,
        lines,
      );
    }
  }, [
    activeTrack?.id,
    doc?.id,
    doc?.lines,
    session.lyrics,
    session.settings,
    player,
  ]);

  // Sync appearance theme and accent to native Android widgets
  useEffect(() => {
    if (mobile && "setTheme" in player) {
      (player as { setTheme: (mode: string, accent: string) => void }).setTheme(
        session.settings.themeMode,
        session.settings.accentColor,
      );
    }
  }, [mobile, session.settings.themeMode, session.settings.accentColor, player]);

  const floatingLyrics = useLyricOverlay(
    overlaySnapshot(activeTrack,
      pendingTrackActive ? undefined : doc, session.settings, playback.status, lyricsEngine.lyricSynced, lyricsEngine.active, lyricsEngine.lyricLookup.status),
    () => {
      if (pendingTrackActive && playback.status === 'error') libraryManager.retryPendingPlayback(playTrack);
      else togglePlay();
    }, skip, setError,
  );

  const nearby = useNearby({ ready, session, tracks, track, playback, update,
    resolve: async queued => resolveDiscovery(await library.lookupCatalog(queued.id)),
    applyReplica: async state => {
      await keepImportedTracks(replicaTracks([...Object.values(sessionRef.current.replica?.cells || {}), ...state.cells]));
      update(s => mergePlaylistReplica(s, state, tracksRef.current));
    },
    flush: async () => {
      const snapshot = restoreSession(sessionRef.current, tracksRef.current);
      const saving = saveChain.current.then(() => library.save(snapshot));
      saveChain.current = saving.catch(e => setError(`Sync could not save local changes. ${String(e)}`));
      await saving;
    },
  });

  const jam = useJam({ ready, session, tracks, track, playback, update,
    resolve: async queued => resolveDiscovery(await library.lookupCatalog(queued.id)),
  });

  async function keepImportedTracks(imported: Track[]) {
    const fresh = imported.filter(track => !tracksRef.current.some(saved => saved.id === track.id));
    const catalog = fresh.filter(track => track.format === "catalog");
    const saved: Track[] = [];
    for (let offset = 0; offset < catalog.length; offset += 500) saved.push(...await collectionAdapter.saveCatalogTracks(catalog.slice(offset, offset + 500)));
    for (const track of fresh.filter(track => track.format !== "catalog")) saved.push(await library.saveOnline(track));
    tracksRef.current = [...tracksRef.current, ...saved.filter(track => !tracksRef.current.some(existing => existing.id === track.id))];
    setTracks(tracksRef.current);
  }
  async function importPlaylist(name: string, imported: Track[], options: PlaylistImportOptions) {
    mergePlaylistImport(sessionRef.current.playlists, name, imported, tracksRef.current, options);
    await keepImportedTracks(imported);
    const result = mergePlaylistImport(sessionRef.current.playlists, name, imported, tracksRef.current, options);
    update(s => ({ ...s, playlists: result.playlists }));
    setCollectionHub(false); setView(result.playlist.id);
    notify(result.merged ? result.added ? `Added ${result.added} new songs to ${result.playlist.name}.` : `Already imported—all ${result.playlist.items.length} songs are in your playlist.` : `Imported ${result.added} tracks. Audio is resolved when played.`);
  }

  function handleQueueTrack(id: string, next = false) {
    queueTrack(id, next);
    setQueueOpen(true);
  }

  function handleQuickPick(track: Track) {
    if (track.format === "catalog") handleCatalogTrack({ ...track, artists: [] }, "play");
    else { libraryManager.clearPendingPlayback(); playTrack(track); }
  }

  function handleCatalogTrack(result: CatalogTrack, mode: "play" | "save" | "next" | "queue") {
    if (mode === "next" || mode === "queue") setQueueOpen(true);
    void saveDiscovery(result, mode, playTrack);
  }

  function playCatalogCollection(results: CatalogTrack[], shuffle = false) {
    const collection = results.map(result => [...tracksRef.current, ...Object.values(sessionRef.current.queueTracks)].find(track => track.metadataSourceId === result.id && track.offline && !track.missing) || catalogQueueTrack(result));
    if (!collection.length) return;
    libraryManager.clearPendingPlayback();
    playCollectionTrack(collection, shuffle ? Math.floor(Math.random() * collection.length) : 0, shuffle);
  }

  async function playCatalogAlbum(id: string) {
    try {
      const album = await library.lookupAlbum(id);
      if (!album.tracks.length) throw Error("No album tracks are available.");
      playCatalogCollection(album.tracks);
    } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
  }

  const albumDownloads = useAlbumDownloads(downloadCatalogTrack);

  async function downloadCatalogTrack(result: CatalogTrack, onStage?: (stage: string, percent?: number) => void, signal?: AbortSignal): Promise<boolean> {
    try {
      if (signal?.aborted) return false;
      const saved = tracksRef.current.find(track => track.metadataSourceId === result.id);
      if (saved?.offline) return true;
      onStage?.("Finding audio source");
      const track = saved?.format !== "catalog" && saved ? saved : await resolveDiscovery(result);
      if (signal?.aborted) return false;
      onStage?.("Saving offline");
      return await downloadTrack(track, signal, progress => onStage?.(downloadProgressText(progress), progress.total ? Math.min(100, progress.received / progress.total * 100) : undefined));
    } catch (error) { if (!signal?.aborted) setError(error instanceof Error ? error.message : String(error)); return false; }
  }

  function handleCatalogAction(result: CatalogTrack, mode: CatalogAction) {
    if (mode === "save" || mode === "next" || mode === "queue") return handleCatalogTrack(result, mode);
    if (mode === "download") return void downloadCatalogTrack(result);
    const saved = tracksRef.current.find(track => track.metadataSourceId === result.id);
    if (mode === "remove" && saved) return void removeTrack(saved, () => playbackEngine.setUndo(null));
    if (mode === "delete-offline" && saved) return deleteOffline(saved, track?.id, ask);
    void action(async () => {
      if (mode === "refresh") {
        await enrichOnline(saved || await resolveDiscovery(result), true);
        return;
      }
      const selected = saved?.format !== "catalog" && saved ? saved : await resolveDiscovery(result);
      if (mode === "favorite") {
        if (!saved || saved.format === "catalog") await saveOnline(selected);
        favorite(selected.id);
      } else if (mode === "playlist") choosePlaylist(selected);
    });
  }

  function handleQueueRemote(t: Track, next = false) {
    queueRemote(t, next);
    setQueueOpen(true);
  }

  function recordedTrack(record: ListeningRecord) {
    return (
      listeningTracks.find((t) => t.id === record.trackId) ??
      historyTrack(record)
    );
  }
  function replayHistory(record: ListeningRecord) {
    const t = recordedTrack(record);
    if (
      !t.source &&
      !tracksRef.current.some((saved) => saved.id === t.id && !saved.missing)
    ) {
      setError(
        "This local recording is no longer available. Import or relink the original file to play it again.",
      );
      return;
    }
    playTrack(t);
  }

  useEffect(() => {
    if (dialog || lyricsEngine.variant || playlistTarget || addMusicPlaylist) {
      previousFocus.current = document.activeElement as HTMLElement;
      dialogRef.current?.showModal();
    } else {
      dialogRef.current?.close();
      previousFocus.current?.focus();
    }
  }, [dialog, lyricsEngine.variant, playlistTarget, addMusicPlaylist]);

  function ask(
    title: string,
    label: string,
    value: string,
    submit: (name: string) => void,
  ) {
    setDialog({ title, label, value, submit });
  }

  function choosePlaylist(t: Track) {
    let lastPlaylistId: string | null = null;
    try {
      lastPlaylistId = localStorage.getItem("lumaire:last-playlist-id");
    } catch {
      // Local storage unavailable
    }
    const targetPlaylist =
      (lastPlaylistId ? session.playlists.find((p) => p.id === lastPlaylistId) : null) ||
      (session.playlists.length === 1 ? session.playlists[0] : null);

    if (!targetPlaylist) {
      setPlaylistTarget(t);
      return;
    }

    const isAlreadyIn = targetPlaylist.items.some((i) => {
      if (i.trackId === t.id) return true;
      if (t.metadataSourceId) {
        const saved = tracks.find((entry) => entry.id === i.trackId) || session.queueTracks[i.trackId];
        if (saved?.metadataSourceId === t.metadataSourceId) return true;
      }
      return false;
    });

    if (isAlreadyIn) {
      notify(`Already in ${targetPlaylist.name}`, {
        label: "Change",
        onClick: () => setPlaylistTarget(t),
      });
      return;
    }

    void addOnlineToPlaylist(t, targetPlaylist.id, undefined, {
      action: {
        label: "Change",
        onClick: () => setPlaylistTarget(t),
      },
    });
  }

  const collections = libraryCollections(tracks, session.playlists);
  const collection = collections.find((candidate) => candidate.id === view);
  const builtin = typeof view === "string" && view.startsWith("collection:");
  const playlist = session.playlists.find((p) => p.id === view);
  const collectionTracks = tracks.filter(
    (t) =>
      (view !== "favorites" || session.favorites.includes(t.id)) &&
      (!builtin ||
        collection?.tracks.some((candidate) => candidate.id === t.id)) &&
      (!playlist || playlist.items.some((i) => i.trackId === t.id)),
  );
  const visible = collectionTracks.filter(t => localSearchMatches(query, t.title, t.artist, t.album || ""));

  const heading =
    view === "history"
      ? "Tracker"
      : view === "favorites"
        ? "Liked Songs"
        : view === "albums"
          ? "Albums"
          : view === "artists"
            ? "Artists"
            : view === "library"
              ? "Playlists"
              : collection
                ? collection.name
                : "Your library";
  const rows = playlist
    ? playlist.items.flatMap((entry) => {
        const t = visible.find((candidate) => candidate.id === entry.trackId);
        return t ? [{ t, entryId: entry.id }] : [];
      })
    : visible.map((t) => ({ t, entryId: t.id }));
  const fullCollection = playlist ? playlist.items.flatMap(entry => {
    const track = collectionTracks.find(track => track.id === entry.trackId);
    return track ? [track] : [];
  }) : collectionTracks;

  const lyricsPanel = (<LyricsView embedded={expanded}
              mediaTime={playback.time}
              onNavigateArtist={id => { setExpanded(false); navigateCatalog({ type: "artist", id }); }}
              track={track}
              doc={doc}
              lyricSynced={lyricsEngine.lyricSynced}
              lyricLookup={lyricsEngine.lyricLookup}
              follow={lyricsEngine.follow}
              setFollow={lyricsEngine.setFollow}
              followTarget={lyricsEngine.followTarget}
              active={lyricsEngine.active}
              activeRef={lyricsEngine.activeRef}
              busy={busy}
              session={session}
              setting={setting}
              onUpdateOffset={lyricsEngine.updateOffset}
              clearCache={lyricsEngine.clearCache}
              regenerate={lyricsEngine.regenerate}
              processingState={lyricsEngine.processingState}
              translateLyrics={lyricsEngine.translateLyrics}
              romanizing={lyricsEngine.romanizing}
              onRetryLookup={lyricsEngine.retryLookup}
              audioDuration={lyricsEngine.lyricDuration}
              onAlbumRecording={() => {
                if (!track?.metadataSourceId) return;
                void action(async () => {
                  const catalog = await library.lookupCatalog(track.metadataSourceId!);
                  playTrack(await resolveDiscovery(catalog, true));
                });
              }}
              onMarkInstrumental={lyricsEngine.markInstrumental}
              onSeek={(seconds) => seek(seconds)}
            />);
  const playerControls = (<PlayerBar onExpand={openExpanded}
        onWrongVersion={wrongVersion}
        autoplayLoading={playbackEngine.autoplayLoading}
        onFloatingLyrics={floatingLyrics.supported ? floatingLyrics.toggle : undefined}
        floatingLyricsOpen={floatingLyrics.open}
        floatingLyricsLocked={floatingLyrics.locked}
        floatingLyricsBusy={floatingLyrics.busy}
        track={activeTrack}
        tracks={tracks}
        playback={playback}
        session={session}
        downloads={downloads}
        busy={busy}
        view={typeof view === "object" ? "discover" : view}
        setView={selectView}
        mobile={mobile}
        isFullscreen={isFullscreen}
        onToggleFullscreen={toggleFullscreen}
        queueOpen={queueOpen}
        onToggleQueue={() => setQueueOpen((x) => !x)}
        onSeek={(seconds) => seek(seconds)}
        onTogglePlay={() => {
          if (pendingTrackActive && playback.status === "error") libraryManager.retryPendingPlayback(playTrack);
          else togglePlay();
        }}
        onSkip={skip}
        onFavorite={favorite}
        onNavigateArtist={id => navigateCatalog({ type: "artist", id })}
        onChoosePlaylist={choosePlaylist}
        onDownloadTrack={(t) => void downloadTrack(t)}
        onDeleteOffline={(t) => deleteOffline(t, track?.id, ask)}
        onSaveOnline={(t) =>
          void action(async () => {
            await saveOnline(t);
            notify("Saved to library · Internet required for streaming");
          })
        }
        onCancelDownload={(trackId) =>
          void action(() => library.cancelDownload(trackId))
        }
        onSetting={setting}
      />);

  const handleCreatePlaylist = () =>
    ask("A new collection", "Playlist name", "", (name) => {
      const id = crypto.randomUUID();
      update((s) => ({
        ...s,
        playlists: [...s.playlists, { id, name, items: [] }],
      }));
      setView(id);
    });

  const handleSidebarResizeStart = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    setIsResizingSidebar(true);

    const onPointerMove = (moveEvent: PointerEvent) => {
      const clientX = moveEvent.clientX;
      if (clientX < 120) {
        setSidebarCollapsed(true);
      } else {
        const clamped = Math.min(Math.max(clientX, 180), 320);
        setSidebarCollapsed(false);
        setSidebarWidth(clamped);
        document.documentElement.style.setProperty("--sidebar-width", `${clamped}px`);
      }
    };

    const onPointerUp = (upEvent: PointerEvent) => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
      setIsResizingSidebar(false);
      const finalX = upEvent.clientX;
      if (finalX >= 120) {
        const clamped = Math.min(Math.max(finalX, 180), 320);
        setSidebarWidth(clamped);
        localStorage.setItem("lumaire:sidebar-width", String(clamped));
        document.documentElement.style.setProperty("--sidebar-width", `${clamped}px`);
      }
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
  };

  const handleSidebarResizeReset = () => {
    setSidebarWidth(240);
    setSidebarCollapsed(false);
    localStorage.setItem("lumaire:sidebar-width", "240");
    document.documentElement.style.setProperty("--sidebar-width", "240px");
  };

  const handleQueueResizeStart = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    setIsResizingQueue(true);

    const onPointerMove = (moveEvent: PointerEvent) => {
      const width = window.innerWidth - moveEvent.clientX;
      if (width < 180) {
        setQueueOpen(false);
      } else {
        const clamped = Math.min(Math.max(width, 260), 380);
        setQueueOpen(true);
        setQueueWidth(clamped);
        document.documentElement.style.setProperty("--queue-width", `${clamped}px`);
      }
    };

    const onPointerUp = (upEvent: PointerEvent) => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
      setIsResizingQueue(false);
      const finalWidth = window.innerWidth - upEvent.clientX;
      if (finalWidth >= 180) {
        const clamped = Math.min(Math.max(finalWidth, 260), 380);
        setQueueWidth(clamped);
        localStorage.setItem("lumaire:queue-width", String(clamped));
        document.documentElement.style.setProperty("--queue-width", `${clamped}px`);
      }
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
  };

  const handleQueueResizeReset = () => {
    setQueueWidth(315);
    localStorage.setItem("lumaire:queue-width", "315");
    document.documentElement.style.setProperty("--queue-width", "315px");
  };

  return (
    <div
      className={`app ${queueOpen ? "with-queue" : ""} ${sidebarCollapsed ? "sidebar-collapsed" : ""} ${isResizingSidebar || isResizingQueue ? "is-resizing" : ""} ${isFullscreen ? "is-fullscreen" : ""} ${mobile ? "android" : ""}`}
      style={{
        "--sidebar-width": `${sidebarWidth}px`,
        "--queue-width": `${queueWidth}px`,
      } as React.CSSProperties}
    >
      {isFullscreen && (
        <button
          type="button"
          className="fullscreen-exit-pill"
          onClick={toggleFullscreen}
          title="Exit full screen (F11 or Esc)"
          aria-label="Exit full screen"
        >
          <Minimize2 size={13} />
          <span>Exit full screen</span>
        </button>
      )}
      {updatesOpen && <UpdateDialog onClose={closeUpdates} />}
      {sourceChooser && <SourceChooser key={`${sourceChooser.catalogId}:${sourceChooser.entryId}`} catalogId={sourceChooser.catalogId}
        active={()=>sourceChooser.entryId===null ? libraryManager.pendingTrack?.id===sourceChooser.catalogId : sessionRef.current.currentId===sourceChooser.entryId}
        onChoose={async(catalog,source)=>{
          if(sourceChooser.entryId!==null){await playbackEngine.chooseRecording(catalog,source,sourceChooser.entryId);return;}
          const request=player.state.playbackId;
          const candidate={...source,...await prepareCatalogCandidate(source)};
          if(!(await matchSource(catalog,candidate)).accepted)throw Error('This recording no longer matches the selected song.');
          if(player.state.playbackId!==request||libraryManager.pendingTrack?.id!==catalog.id)throw Error('Playback selection changed.');
          await library.setVerifiedSource(catalog.id,{sourceId:candidate.id,sourceProvider:'youtube',title:candidate.title,artist:candidate.channel,duration:candidate.duration,userSelected:true});
          if(player.state.playbackId!==request)return;
          libraryManager.clearPendingPlayback();playTrack(canonicalTrack(catalog,candidate));
        }}
        onClose={()=>setSourceChooser(null)} />}
      {ready && needsEngineSetup && engineSetup.engineState !== "checking" && <EngineSetupDialog {...engineSetup} />}
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <Sidebar
        onHome={() => {
          if (view === "home") {
            const main = document.getElementById("main");
            if (main) {
              main.scrollTo({ top: 0, behavior: "smooth" });
              scrollPositions.current.set("home", 0);
            }
            return;
          }
          setHeaderSearchQuery("");
          setDiscoveryState(initialDiscoveryViewState());
          scrollPositions.current.set("home", 0);
          setView("home");
          setDiscoverRoute("discover");
          setCatalogHistory([]);
        }}
        view={typeof view === "object" ? "discover" : view}
        onOpenSync={() => setCollectionHub("import")}
        onSearch={openDiscoverSearch}
        setView={selectView}
        collectionsCount={session.playlists.length}
        playlists={session.playlists}
        collections={collections}
        hasLyricsDoc={Boolean(doc)}
        queueOpen={queueOpen}
        onToggleQueue={() => {
          if (!expandedLayout) { setMobilePlayerTab("queue"); setExpanded(true); }
          else setQueueOpen((x) => !x);
        }}
        onCreatePlaylist={handleCreatePlaylist}
        onResizeStart={handleSidebarResizeStart}
        onResizeReset={handleSidebarResizeReset}
      />
      <div className="workspace">
        {!mobile && (
          <TopBar
            windowControls={desktop ? <WindowControls onError={setError} /> : undefined}
            view={typeof view === "object" ? "discover" : view}
            heading={heading}
            sidebarCollapsed={sidebarCollapsed}
            queueOpen={queueOpen}
            onToggleSidebar={() => setSidebarCollapsed((c) => !c)}
            onToggleQueue={() => setQueueOpen((x) => !x)}
            onOpenSettings={() => selectView("settings")}
            onOpenUpdates={supportsWindowsUpdates() && updateState.version ? () => setUpdatesOpen(true) : undefined}
            updateLabel={updateState.stage === "ready" ? "Restart to update" : updateState.stage === "downloading" ? `Downloading${updateState.progress === undefined ? "…" : ` ${updateState.progress}%`}` : `Update v${updateState.version}`}
            onOpenImport={() => setCollectionHub("import")}
            onOpenConnect={() => setCollectionHub("devices")}
            onOpenCollectionHub={() => setCollectionHub("import")}
            nearbySharing={ready && Boolean(nearby.hostLink)}
            nearbyFollowing={ready && Boolean(nearby.following)}
            onStopFollowing={() => nearby.setFollowing(false)}
            canGoBack={canGoBack}
            canGoForward={canGoForward}
            onGoBack={goBack}
            onGoForward={goForward}
            searchQuery={headerSearchQuery}
            onSearchChange={setHeaderSearchQuery}
            onSearchSubmit={() => {
              setDiscoveryState(cur => ({ ...cur, query: headerSearchQuery.trim() }));
              selectView("search");
            }}
            onSelectArtist={id => navigateCatalog({ type: "artist", id })}
            onSelectAlbum={id => navigateCatalog({ type: "album", id })}
            onSelectTrack={result => handleCatalogTrack(result, "play")}
            onCatalogAction={handleCatalogAction}
            favorites={session.favorites}
            savedTracks={tracks}
          />
        )}
        <Banners
          error={error}
          playbackError={playback.error}
          playbackErrorId={playback.playbackId}
          message={message}
          messageAction={messageAction}
          hasTrack={Boolean(track || libraryManager.pendingTrack)}
          onRetryPlayback={() => {
            if (pendingTrackActive) libraryManager.retryPendingPlayback(playTrack);
            else if (track) void player.load(track.id, true, playback.time);
          }}
          onDismissError={() => setError("")}
          onDismissMessage={() => {
            setMessage("");
            setMessageAction(null);
          }}
        />
        <div className="workspace-body">
          <main id="main" tabIndex={-1}>
          {!ready && (
            <div className="empty">
              <Disc3 className="spin" size={32} />
              <h1>Opening your library</h1>
              {error && (
                <button onClick={() => location.reload()}>Try again</button>
              )}
            </div>
          )}
          {ready &&
            (view === "library" ||
              view === "favorites" ||
              view === "albums" ||
              view === "artists" ||
              playlist ||
              builtin) && (
              <LibraryView
                view={typeof view === "object" ? "discover" : view}
                heading={heading}
                playlist={playlist}
                tracks={tracks}
                visible={visible}
                rows={rows}
                currentTrack={track}
                playbackDuration={playback.duration}
                playbackStatus={playback.status}
                session={session}
                downloads={downloads}
                collections={collections}
                query={query}
                busy={busy}
                mobile={mobile}
                desktop={desktop}
                onCreatePlaylist={handleCreatePlaylist}
                onOpenImport={() => setCollectionHub("import")}
                onSetQuery={setQuery}
                onSelectView={setView}
                onPlayAll={() => {
                  const playable = fullCollection.filter((t) => !t.missing);
                  playCollectionTrack(playable, 0, false);
                }}
                onShufflePlay={() => {
                  const playable = fullCollection.filter((t) => !t.missing);
                  if (!playable.length) return;
                  const start = Math.floor(Math.random() * playable.length);
                  playCollectionTrack(playable, start, true);
                }}
                onPlayTrackInList={(_t, index) => {
                  playCollectionTrack(
                    rows.map((r) => r.t),
                    index,
                  );
                }}
                onImportMusic={(folder) =>
                  void importMusic(folder, () => setView("collection:local"))
                }
                onRenamePlaylist={(p) =>
                  ask("Rename collection", "Playlist name", p.name, (name) =>
                    update((s) => ({
                      ...s,
                      playlists: s.playlists.map((pl) =>
                        pl.id === p.id ? { ...pl, name } : pl,
                      ),
                    })),
                  )
                }
                onDeletePlaylist={(p) =>
                  ask(
                    "Delete collection",
                    "Type DELETE to remove this playlist. Your files stay on disk.",
                    "",
                    (value) => {
                      if (value.trim().toUpperCase() === "DELETE") {
                        update((s) => ({
                          ...s,
                          playlists: s.playlists.filter((pl) => pl.id !== p.id),
                        }));
                        try {
                          if (localStorage.getItem("lumaire:last-playlist-id") === p.id) {
                            localStorage.removeItem("lumaire:last-playlist-id");
                          }
                        } catch {
                          // Storage unavailable
                        }
                        setView("library");
                        notify(`Deleted playlist "${p.name}"`);
                      }
                    },
                  )
                }
                onDownloadPlaylist={playlist && rows.length > 0 ? () => {
                  const catalogTracks = rows.map(({ t }) => ({
                    id: t.metadataSourceId || t.id,
                    title: t.title,
                    artist: t.artist,
                    artists: [],
                    album: t.album,
                    duration: t.duration,
                    artworkUrl: t.artworkUrl,
                  }));
                  void albumDownloads.start(playlist.id, catalogTracks);
                } : undefined}
                downloadProgress={playlist ? albumDownloads.progress[playlist.id] : undefined}
                onPauseDownload={playlist ? () => albumDownloads.pause(playlist.id) : undefined}
                onCancelDownload={playlist ? () => albumDownloads.cancel(playlist.id) : undefined}
                onFavorite={favorite}
                onNavigateArtist={id => navigateCatalog({ type: "artist", id })}
                onNavigateAlbum={id => navigateCatalog({ type: "album", id })}
                onRemoveTrack={(t) =>
                  void removeTrack(t, () => playbackEngine.setUndo(null))
                }
                onDownloadTrack={(t) => void downloadTrack(t)}
                onDeleteOffline={(t) => deleteOffline(t, track?.id, ask)}
                onQueueTrack={handleQueueTrack}
                onEnrichOnline={(t) => void action(() => enrichOnline(t, true))}
                onRelinkTrack={(t) => void relink(t, track?.id, playback.time)}
                onChoosePlaylist={choosePlaylist}
                onPlayCollection={(collection) => {
                  const playable = collection.tracks.filter((t) => !t.missing);
                  if (playable.length) playCollectionTrack(playable, 0, false);
                }}
                onOpenAddMusic={(p) => setAddMusicPlaylist(p)}
                onRemoveFromPlaylist={(playlistId, entryId) => {
                  update((s) => ({
                    ...s,
                    playlists: s.playlists.map((p) =>
                      p.id === playlistId
                        ? {
                            ...p,
                            items: p.items.filter((i) => i.id !== entryId),
                          }
                        : p,
                    ),
                  }));
                }}
              />
            )}
          {ready && view === "history" && (
            <HistoryView
              initialTab={historyTab}
              {...listeningHistory}
              onRefresh={listeningHistory.refresh}
              onNavigateArtist={id => navigateCatalog({ type: "artist", id })}
              onNavigateAlbum={id => navigateCatalog({ type: "album", id })}
              mobile={mobile}
              enabled={session.settings.historyEnabled}
              favorites={session.favorites}
              onReplay={replayHistory}
              onQueue={(record) => handleQueueRemote(recordedTrack(record))}
              onFavorite={(record) =>
                void action(async () => {
                  const t = recordedTrack(record);
                  if (!tracksRef.current.some((saved) => saved.id === t.id)) {
                    if (!t.source)
                      throw new Error(
                        "Import this local recording again before adding it to Favorites.",
                      );
                    await saveOnline(t);
                  }
                  favorite(t.id);
                })
              }
            />
          )}
          {ready && view === "lyrics" && !expanded && (
lyricsPanel
          )}
          {ready && view === "home" && (
            <div className="home-view-state">
              <DiscoveryHome mobile={mobile}
                resumes={session.listeningResumes}
                onResume={resumeListening}
                onPlayQuickPick={handleQuickPick}
                searches={session.settings.historyEnabled ? [] : []}
                records={listeningHistory.records.map((record) => {
                  const artworkUrl = listeningTracks.find(
                    (track) => track.id === record.trackId,
                  )?.artworkUrl;
                  return artworkUrl ? { ...record, artworkUrl } : record;
                })}
                savedTracks={tracks}
                busy={busy}
                onlineAvailable={ytdlpAvailable}
                onSearch={(q) => {
                  setDiscoveryState((cur) => ({ ...cur, query: q }));
                  selectView("search");
                }}
                onClearSearches={clearDiscoverySearches}
                onReplay={replayHistory}
                onImportMusic={() => void importMusic(false, () => setView("collection:local"))}
                onOpenLibrary={() => selectView("library")}
                onOpenTracker={() => selectView("history", "history")}
                onNavigateAlbum={(albumId) => navigateCatalog({ type: "album", id: albumId })}
                onNavigateArtist={(artistId) => navigateCatalog({ type: "artist", id: artistId })}
                onSaveDiscovery={handleCatalogTrack}
                onPlayAlbum={playCatalogAlbum}
                favorites={session.favorites}
                favoriteArtists={session.favoriteArtists.map(artist => artist.name)}
                favoriteAlbums={session.favoriteAlbums.map(album => album.title)}
                downloads={downloads}
                onCatalogAction={handleCatalogAction}
                onFavorite={t => favorite(t.id, t)}
                onQueueTrack={handleQueueRemote}
                onSaveOnline={t => void action(async () => { await saveOnline(t); })}
                onChoosePlaylist={choosePlaylist}
              />
            </div>
          )}
          {ready && (view === "search" || view === "discover") && (
            <DiscoveryView
              {...engineSetup}
              recentRecords={listeningHistory.records.map(record => {
                const artworkUrl = listeningTracks.find(track => track.id === record.trackId)?.artworkUrl;
                return artworkUrl ? { ...record, artworkUrl } : record;
              })}
              historyEnabled={session.settings.historyEnabled}
              onReplay={replayHistory}
              onImportMusic={() => void importMusic(false, () => setView("collection:local"))}
              onOpenLibrary={() => selectView("library")}
              state={discoveryState}
              onStateChange={setDiscoveryState}
              ytdlpAvailable={ytdlpAvailable}
              mobile={mobile}
              busy={busy}
              downloads={downloads}
              onSaveDiscovery={handleCatalogTrack}
              onPlayAlbum={playCatalogAlbum}
              onPlayCollection={playCatalogCollection}
              savedTracks={tracks}
              favorites={session.favorites}
              onCatalogAction={handleCatalogAction}
              onChoosePlaylist={choosePlaylist}
              onDownloadTrack={(trackItem) => void downloadTrack(trackItem)}
              onSaveCommons={(trackItem, play) =>
                void saveCommons(trackItem, play, playTrack)
              }
              onQueueRemote={handleQueueRemote}
              onNavigateArtist={(artistId) => navigateCatalog({ type: "artist", id: artistId })}
              onNavigateAlbum={(albumId) => navigateCatalog({ type: "album", id: albumId })}
              onNavigateChart={(chartId) => navigateCatalog({ type: "chart", id: chartId })}
            />
          )}
          {ready && typeof discoverRoute === "object" && discoverRoute.type === "artist" && (
            <div hidden={typeof view !== "object"}>
              <ArtistView
                key={discoverRoute.id}
                artistId={discoverRoute.id}
                favoriteArtists={session.favoriteArtists}
                onFavoriteArtist={artist => update(s => ({ ...s, favoriteArtists: s.favoriteArtists.some(saved => saved.id === artist.id) ? s.favoriteArtists.filter(saved => saved.id !== artist.id) : [...s.favoriteArtists, artist] }))}
                onNavigateAlbum={(albumId) => navigateCatalog({ type: "album", id: albumId })}
                onNavigateArtist={(artistId) => navigateCatalog({ type: "artist", id: artistId })}
                onSaveDiscovery={handleCatalogTrack}
                savedTracks={tracks}
                favorites={session.favorites}
                onCatalogAction={handleCatalogAction}
                busy={busy}
                downloads={downloads}
                onBack={backFromCatalog}
                onPlayAlbum={playCatalogAlbum}
              />
            </div>
          )}
          {ready && typeof discoverRoute === "object" && discoverRoute.type === "album" && (
            <div hidden={typeof view !== "object"}>
              <AlbumView
                key={discoverRoute.id}
                albumId={discoverRoute.id}
                onPlayCollection={playCatalogCollection}
                onDownloadAlbum={tracks => void albumDownloads.start(discoverRoute.id, tracks)}
                downloadProgress={albumDownloads.progress[discoverRoute.id]}
                onPauseDownload={() => albumDownloads.pause(discoverRoute.id)}
                onCancelDownload={() => albumDownloads.cancel(discoverRoute.id)}
                onlineAvailable={ytdlpAvailable}
                favoriteAlbums={session.favoriteAlbums}
                onFavoriteAlbum={album => update(s => ({ ...s, favoriteAlbums: s.favoriteAlbums.some(saved => saved.id === album.id) ? s.favoriteAlbums.filter(saved => saved.id !== album.id) : [...s.favoriteAlbums, { id: album.id, title: album.title, artist: album.artist, artworkUrl: album.artworkUrl, year: album.year }] }))}
                onSaveDiscovery={handleCatalogTrack}
                savedTracks={tracks}
                favorites={session.favorites}
                onCatalogAction={handleCatalogAction}
                busy={busy}
                downloads={downloads}
                onBack={backFromCatalog}
                onNavigateArtist={(artistId) => navigateCatalog({ type: "artist", id: artistId })}
              />
            </div>
          )}
          {ready && typeof discoverRoute === "object" && discoverRoute.type === "chart" && (
            <div hidden={typeof view !== "object"}>
              <ChartView
                key={discoverRoute.id}
                chartId={discoverRoute.id}
                onPlayCollection={playCatalogCollection}
                onlineAvailable={ytdlpAvailable}
                onSaveDiscovery={handleCatalogTrack}
                savedTracks={tracks}
                favorites={session.favorites}
                onCatalogAction={handleCatalogAction}
                busy={busy}
                downloads={downloads}
                onBack={backFromCatalog}
                onNavigateAlbum={(albumId) => navigateCatalog({ type: "album", id: albumId })}
                onNavigateArtist={(artistId) => navigateCatalog({ type: "artist", id: artistId })}
              />
            </div>
          )}
          {ready && view === "settings" && (
            <SettingsView
              session={session}
              tracks={tracks}
              downloads={downloads}
              busy={busy}
              mobile={mobile}
              ytdlpAvailable={ytdlpAvailable}
              {...engineSetup}
              onRefreshYoutubeEngine={libraryManager.refreshYoutubeEngine}
              onExportLibrary={() =>
                void action(async () => {
                  persist();
                  if (
                    await library.export({
                      ...sessionRef.current,
                      position: playback.time,
                    })
                  )
                    notify(
                      "Library exported. Audio, lyric text, history and absolute paths were excluded.",
                    );
                })
              }
              onImportBackup={() =>
                ask(
                  "Import library backup",
                  "Type IMPORT to replace playlists, queue and settings from a backup. Existing audio entries are kept.",
                  "",
                  (value) => {
                    if (value === "IMPORT")
                      void action(async () => {
                        suspendPersistence.current = true;
                        if (persistTimer.current)
                          clearTimeout(persistTimer.current);
                        await saveChain.current;
                        let snapshot;
                        try {
                          snapshot = await library.import();
                        } finally {
                          suspendPersistence.current = false;
                        }
                        if (!snapshot) return;
                        player.stop();
                        const restored = restoreSession(
                          snapshot.session,
                          snapshot.tracks,
                         );
                        setTracks(snapshot.tracks);
                        setSession(restored);
                        const c = restored.queue.find(
                          (i) => i.id === restored.currentId,
                        );
                        if (c)
                          void player.load(c.trackId, false, restored.position);
                        notify(
                          "Backup imported. New tracks need explicit relinking.",
                        );
                      });
                  },
                )
              }
              onSetting={setting}
              onClearHistory={() => {
                void action(async () => {
                  await clearListening();
                  update((s) => ({ ...s, history: [] }));
                  listeningHistory.refresh();
                  notify("Listening history cleared. If history sync is enabled on both devices, the clear will propagate when connected.");
                });
              }}
              onClearLyricCache={() =>
                ask(
                  "Clear supplied lyric cache",
                  "Type CLEAR to remove locally attached original and supplied lyric text. Audio files stay on disk.",
                  "",
                  (value) => {
                    if (value === "CLEAR") {
                      update((s) => ({ ...s, lyrics: {} }));
                      notify("Local lyric cache cleared");
                    }
                  },
                )
              }
              onCancelDownload={(id) => void library.cancelDownload(id)}
              onRetryDownload={(t) => void downloadTrack(t)}
              onDeleteOffline={(t) => deleteOffline(t, track?.id, ask)}
            />
          )}
          </main>
          {queueOpen && (
            <QueuePanel
              session={session}
              listeningTracks={listeningTracks}
              undo={undo}
              onClose={() => setQueueOpen(false)}
              onSelectQueue={(id, play) => selectQueue(id, play)}
              onReorderUpcoming={(id, delta) =>
                update((s) => reorderUpcoming(s, id, delta))
              }
              onRemoveQueue={(id) => removeQueue(id)}
              onUndoRemoval={undoRemoval}
              onClearQueue={clearQueue}
              onNavigateArtist={id => navigateCatalog({ type: "artist", id })}
              currentTrack={activeTrack}
              playback={playback}
              onTogglePlay={() => {
                if (pendingTrackActive && playback.status === "error") libraryManager.retryPendingPlayback(playTrack);
                else togglePlay();
              }}
              onFavorite={favorite}
              isFavorite={Boolean(activeTrack && session.favorites.includes(activeTrack.id))}
              onChoosePlaylist={choosePlaylist}
              onResizeStart={handleQueueResizeStart}
              onResizeReset={handleQueueResizeReset}
            />
          )}
        </div>
      </div>
      {!expanded && playerControls}
      {expanded && expandedLayout && (
        <ExpandedPlayer
          follow={lyricsEngine.follow}
          setFollow={lyricsEngine.setFollow}
          canFollow={Boolean(doc && (lyricsEngine.lyricSynced || session.settings.estimatedScroll))}
          translateLyrics={lyricsEngine.translateLyrics}
          processingState={lyricsEngine.processingState}
          romanizing={lyricsEngine.romanizing}
          controls={playerControls}
          lyrics={lyricsPanel}
          onClose={closeExpanded}
          doc={doc}
          session={session}
          onSetting={setting}
          isFullscreen={isFullscreen}
          onToggleFullscreen={toggleFullscreen}
        />
      )}
      {expanded && !expandedLayout && (
        <MobileNowPlaying
          onWrongVersion={wrongVersion}
          manageHistory={false}
          initialTab={mobilePlayerTab}
          track={activeTrack || track}
          tracks={tracks}
          session={session}
          playback={playback}
          onClose={closeExpanded}
          onTogglePlay={() => {
            if (pendingTrackActive && playback.status === "error") libraryManager.retryPendingPlayback(playTrack);
            else togglePlay();
          }}
          onSkip={skip}
          onSeek={(seconds) => seek(seconds)}
          onFavorite={favorite}
          onSetting={setting}
          onNavigateArtist={(id) => {
            closeExpanded();
            navigateCatalog({ type: "artist", id });
          }}
          onChoosePlaylist={choosePlaylist}
          onSelectQueue={(id, play) => selectQueue(id, play)}
          onReorderUpcoming={(id, delta) =>
            update((s) => reorderUpcoming(s, id, delta))
          }
          onRemoveQueue={(id) => removeQueue(id)}
          onClearQueue={clearQueue}
          onUndoRemoval={undoRemoval}
          undo={undo}
          doc={doc}
          sessionVolume={session.settings.volume ?? 0.72}
        />
      )}
      {collectionHub && (
        <CollectionHub
          initialTab={collectionHub}
          onClose={() => setCollectionHub(false)}
          playlists={session.playlists}
          onImport={importPlaylist}
          nearby={nearby}
          jam={jam}
        />
      )}
      <MobileTabBar
        view={typeof view === "object" ? "discover" : view}
        setView={selectView}
        onDiscoverSearch={openDiscoverSearch}
      />
      {ready && !needsEngineSetup && <MusicLanguageOnboarding />}
      <dialog
        ref={dialogRef}
        className={playlistTarget || addMusicPlaylist ? "save-playlist-modal" : ""}
        onCancel={() => {
          setDialog(null);
          lyricsEngine.setVariant(null);
          setPlaylistTarget(null);
          setAddMusicPlaylist(null);
        }}
        onClick={(e) => {
          if (e.target === e.currentTarget) {
            setDialog(null);
            lyricsEngine.setVariant(null);
            setPlaylistTarget(null);
            setAddMusicPlaylist(null);
          }
        }}
      >
        {addMusicPlaylist && (
          <AddMusicModal
            playlist={addMusicPlaylist}
            tracks={tracks}
            session={session}
            busy={busy}
            onClose={() => setAddMusicPlaylist(null)}
            onAddTrack={async (target, playlistId) => {
              await addOnlineToPlaylist(target, playlistId);
            }}
            onImportLocal={() => {
              setAddMusicPlaylist(null);
              void importMusic(false, () => setView("collection:local"));
            }}
          />
        )}
        {playlistTarget && (
          <SaveToPlaylistModal
            playlistTarget={playlistTarget}
            tracks={tracks}
            session={session}
            busy={busy}
            onClose={() => setPlaylistTarget(null)}
            onSave={async (target, playlistId, newName) => {
              try {
                localStorage.setItem("lumaire:last-playlist-id", playlistId);
              } catch {
                // Local storage unavailable
              }
              await addOnlineToPlaylist(target, playlistId, newName);
            }}
            onRemove={(playlistId, trackId, playlistName) => {
              update((s) => ({
                ...s,
                playlists: s.playlists.map((p) =>
                  p.id === playlistId
                    ? {
                        ...p,
                        items: p.items.filter((i) => {
                          if (i.trackId === trackId) return false;
                          if (playlistTarget.metadataSourceId) {
                            const saved = tracks.find((entry) => entry.id === i.trackId) || session.queueTracks[i.trackId];
                            if (saved?.metadataSourceId === playlistTarget.metadataSourceId) return false;
                          }
                          return true;
                        }),
                      }
                    : p,
                ),
              }));
              notify(`Removed from ${playlistName}`);
            }}
          />
        )}
        {dialog && (
          <PromptModal dialog={dialog} onClose={() => setDialog(null)} />
        )}
        {lyricsEngine.variant && (
          <LineAlignmentModal
            variant={lyricsEngine.variant}
            onCancel={() => lyricsEngine.setVariant(null)}
            onConfirm={lyricsEngine.confirmVariant}
          />
        )}
      </dialog>
    </div>
  );
}
