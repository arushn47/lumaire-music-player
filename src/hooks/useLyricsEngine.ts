import { englishLyrics } from "../domain/lyric-languages";
import { useEffect, useRef, useState } from "react";
import { lookupLyrics, type LookupState } from "../adapters/lrclib";
import { library } from "../adapters/native";
import { desktop, mobile } from "../adapters/native";
import { invoke } from "@tauri-apps/api/core";
import {
  GEMINI_KEY_CHANGED,
  GEMINI_PROCESS_RETRY,
  mergeProcessedLyrics,
  processLyrics,
  processPreferredLyrics,
  type LyricProcessingState,
  type ProcessedLyrics,
} from "../adapters/lyric-processing";
import type { LineAlignmentVariant } from "../components/modals";
import { clearFetchedLyrics, isFetchedLyrics } from "../domain/lyric-display";
import {
  activeLine,
  alignVariant,
  estimatedFollowLine,
  normalizeCachedLyrics,
  lyricsVersionMatches,
  upgradeSyncedLyrics,
  parseLyrics,
  synchronizedLyrics,
} from "../domain/lyrics";
import { romanizeDocument } from "../domain/romanization";
import { centerLyricLine } from "../components/lyrics/scroll-lyric";
import type { LyricDocument, Session, Track } from "../domain/types";
import type { Playback } from "../player/controller";

const formatError = (e: unknown) =>
  e instanceof Error ? e.message : String(e);

export interface UseLyricsEngineOptions {
  track?: Track | null;
  doc?: LyricDocument;
  playback: Playback;
  session: Session;
  update: (fn: (s: Session) => Session) => void;
  sessionRef: React.MutableRefObject<Session>;
  ready: boolean;
  view: string;
  notify: (msg: string) => void;
  action: (fn: () => Promise<void>) => Promise<void>;
  setError: (err: string) => void;
}

export function useLyricsEngine({
  track,
  doc,
  playback,
  session,
  update,
  sessionRef,
  ready,
  view,
  notify,
  action,
  setError,
}: UseLyricsEngineOptions) {
  const [lyricLookup, setLyricLookup] = useState<LookupState>({
    status: "idle",
  });
  const [lyricRetry, setLyricRetry] = useState(0);
  const syncChecks = useRef(new Set<string>());
  const lookupWaiting = Boolean(track?.source && playback.status === "loading" && playback.duration <= 0);
  const [variant, setVariant] = useState<LineAlignmentVariant | null>(null);
  const [follow, setFollow] = useState(true);
  const [keySaved, setKeySaved] = useState(false);
  const [romanizing, setRomanizing] = useState(false);
  const [processingState, setProcessingState] = useState<LyricProcessingState>({
    status: "idle",
  });
  const [processRetry, setProcessRetry] = useState(0);
  const attempted = useRef(new Map<string, Promise<ProcessedLyrics>>());
  const forceProcess = useRef(false);
  const keylessPending = useRef(false);
  const [keylessState, setKeylessState] = useState<{ docId: string; state: LyricProcessingState } | null>(null);
  const activeRef = useRef<HTMLButtonElement | null>(null);

  async function translateLyrics(language: string) {
    if (!desktop || !track || !doc?.lines.length || keylessPending.current || processingState.status === "processing") return;
    const original = doc;
    const trackId = track.id;
    const state = (value: LyricProcessingState) => setKeylessState({ docId: original.id, state: value });
    keylessPending.current = true;
    state({ status: "processing", message: "Translating…" });
    try {
      const { values, provider, model } = await processPreferredLyrics(original, session.settings.geminiModel, language);
      update(s => {
        const current = s.lyrics[trackId];
        if (!current) return s;
        const merged = mergeProcessedLyrics(current, original, values, model, provider);
        return merged === current ? s : { ...s, lyrics: { ...s.lyrics, [trackId]: merged } };
      });
      state({ status: values.incomplete ? "error" : "complete", provider, message: values.warnings?.join(" ") || "Translation saved on this device." });
    } catch (error) {
      state({ status: "error", message: formatError(error) });
    } finally { keylessPending.current = false; }
  }

  useEffect(() => {
    if (!desktop || !ready || !track || !doc?.lines.length || doc.languageSource) return;
    const original = doc;
    const trackId = track.id;
    void invoke<{ lineLanguages: Record<string, string[]>; englishOnly: boolean }>("detect_lyric_languages", {
      lines: doc.lines.map(({ id, text }) => ({ id, text })),
    }).then((languages) => update((s) => {
      const current = s.lyrics[trackId];
      if (!current || current.id !== original.id || current.raw !== original.raw || current.languageSource) return s;
      return { ...s, lyrics: { ...s.lyrics, [trackId]: { ...current, ...languages, languageSource: "local" } } };
    })).catch(() => update((s) => {
      const current = s.lyrics[trackId];
      if (!current || current.id !== original.id || current.raw !== original.raw || current.languageSource) return s;
      return { ...s, lyrics: { ...s.lyrics, [trackId]: { ...current, lineLanguages: {}, englishOnly: false, languageSource: "local" } } };
    }));
  }, [ready, track?.id, doc?.id, doc?.raw]);

  useEffect(() => {
    if (!desktop) return;
    let active = true;
    const refreshKey = () => {
      attempted.current.clear();
      void invoke<boolean>("gemini_key_status")
        .then((saved) => {
          if (active) {
            setKeySaved(saved);
            setProcessRetry((value) => value + 1);
          }
        })
        .catch(() => {
          if (active) setKeySaved(false);
        });
    };
    const retry = () => {
      setKeylessState(null);
      attempted.current.clear();
      forceProcess.current = true;
      setProcessRetry((value) => value + 1);
    };
    refreshKey();
    window.addEventListener(GEMINI_KEY_CHANGED, refreshKey);
    window.addEventListener(GEMINI_PROCESS_RETRY, retry);
    return () => {
      active = false;
      window.removeEventListener(GEMINI_KEY_CHANGED, refreshKey);
      window.removeEventListener(GEMINI_PROCESS_RETRY, retry);
    };
  }, []);

  useEffect(() => {
    setProcessingState({ status: "idle" });
    if (doc && englishLyrics(doc)) {
      setProcessingState({ status: "complete" });
      return;
    }
    if (
      !ready ||
      !track ||
      !doc?.lines.length ||
      (desktop && !doc.languageSource) ||
      !keySaved ||
      (!session.settings.autoGemini && !forceProcess.current)
    )
      return;
    if (keylessPending.current) return;
    const model = session.settings.geminiModel;
    if (doc.processedModel === model && doc.languageSource === "gemini" && !forceProcess.current) {
      setProcessingState({ status: "complete" });
      return;
    }
    forceProcess.current = false;
    setKeylessState(null);
    const requestKey = JSON.stringify([track.id, doc.id, model]);
    const request = attempted.current.get(requestKey) ?? processLyrics(doc, model);
    attempted.current.set(requestKey, request);
    const trackId = track.id;
    let active = true;
    setProcessingState({ status: "processing" });
    void request
      .then((values) => {
        update((s) => {
          const current = s.lyrics[trackId];
          if (!current) return s;
          const merged = mergeProcessedLyrics(current, doc, values, model);
          return merged === current
            ? s
            : { ...s, lyrics: { ...s.lyrics, [trackId]: merged } };
        });
        if (active) setProcessingState({ status: values.incomplete ? "error" : "complete", message: values.warnings?.join(" ") });
      })
      .catch((error) => {
        if (active)
          setProcessingState({ status: "error", message: formatError(error) });
      });
    return () => {
      active = false;
    };
  }, [
    ready,
    track?.id,
    doc?.id,
    doc?.raw,
    doc?.languageSource,
    doc?.englishOnly,
    keySaved,
    session.settings.autoGemini,
    session.settings.geminiModel,
    processRetry,
  ]);

  const lyricDuration =
    playback.trackId === track?.id && playback.duration > 0
      ? playback.duration
      : track?.duration || 0;
  const lyricSynced = doc ? synchronizedLyrics(doc, lyricDuration) : false;
  const active =
    doc && lyricSynced ? activeLine(doc, playback.time * 1000) : null;
  const followTarget =
    doc && (lyricSynced || session.settings.estimatedScroll)
      ? lyricSynced
        ? active
        : estimatedFollowLine(doc, playback.time, lyricDuration)
      : null;

  useEffect(() => {
    setFollow(true);
  }, [track?.id]);

  // Scroll active line into view
  useEffect(() => {
    if (follow && view === "lyrics" && followTarget) {
      centerLyricLine(activeRef.current, matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth");
    }
  }, [followTarget, follow, view]);

  // Background romanization
  useEffect(() => {
    if (
      !doc ||
      !track ||
      !session.settings.romanisation ||
      doc.romanisationSource === "gemini" ||
      doc.romanisationSource === "google" ||
      doc.romanisationSource === "imported"
    ) {
      setRomanizing(false);
      return;
    }
    let cancelled = false;
    const id = track.id;
    const original = doc.id;
    setRomanizing(true);
    void romanizeDocument(doc)
      .then((romanisation) => {
        if (cancelled) return;
        setRomanizing(false);
        if (!Object.keys(romanisation).length) return;
        update((currentSession) => {
          const current = currentSession.lyrics[id];
          return current?.id === original &&
            current.romanisationSource !== "gemini" &&
            current.romanisationSource !== "google" &&
            current.romanisationSource !== "imported"
            ? {
                ...currentSession,
                lyrics: {
                  ...currentSession.lyrics,
                  [id]: {
                    ...current,
                    romanisationSource: "local",
                    localRomanisation: {
                      ...current.localRomanisation,
                      ...romanisation,
                    },
                    romanisation: {
                      ...current.romanisation,
                      ...Object.fromEntries(
                        Object.entries(romanisation).filter(
                          ([lineId]) =>
                            current.romanisation[lineId] ===
                            doc.romanisation[lineId],
                        ),
                      ),
                    },
                  },
                },
              }
            : currentSession;
        });
      })
      .catch(() => {
        if (!cancelled) setRomanizing(false);
      });
    return () => {
      cancelled = true;
      setRomanizing(false);
    };
  }, [
    doc?.id,
    doc?.raw,
    track?.id,
    session.settings.romanisation,
    doc?.romanisationSource,
  ]);

  // Auto-translate effect when translation is enabled
  useEffect(() => {
    if (
      !desktop ||
      !ready ||
      !track ||
      !doc?.lines.length ||
      !session.settings.translation ||
      englishLyrics(doc) ||
      Object.keys(doc.translation || {}).length > 0 ||
      keylessPending.current ||
      processingState.status === "processing"
    )
      return;
    void translateLyrics("auto");
  }, [
    ready,
    track?.id,
    doc?.id,
    doc?.lines.length,
    session.settings.translation,
    doc?.translation,
  ]);

  // Auto-lookup effect: fires whenever current track changes
  useEffect(() => {
    if (!ready || !track) {
      setLyricLookup({ status: "idle" });
      return;
    }
    const id = track.id;
    const originalCached = sessionRef.current.lyrics[id];
    const cached = originalCached && lyricsVersionMatches(originalCached,track.title)
      ? normalizeCachedLyrics(originalCached, lyricDuration)
      : undefined;
    if (cached) {
      if (cached !== originalCached) {
        update((s) => ({ ...s, lyrics: { ...s.lyrics, [id]: cached } }));
      }
      setLyricLookup({ status: "found", doc: cached });
      if (!isFetchedLyrics(cached) || cached.instrumental || synchronizedLyrics(cached, lyricDuration)) return;
    }
    const check = JSON.stringify([id, track.title, track.artist, track.album, Math.round(lyricDuration), lyricRetry]);
    if (cached && syncChecks.current.has(check)) return;
    if (lookupWaiting) {
      if (!cached) setLyricLookup({ status: "loading" });
      return;
    }
    let cancelled = false;
    setLyricLookup({ status: "loading" });
    lookupLyrics({ ...track, duration: lyricDuration }).then((result) => {
      if (cancelled) return;
      if (syncChecks.current.size >= 128) syncChecks.current.clear();
      syncChecks.current.add(check);
      update(s => {
        const current = s.lyrics[id];
        if (result.status !== "found" || (current && current.id !== originalCached?.id)) return s;
        const next = current && lyricsVersionMatches(current,track.title) ? upgradeSyncedLyrics(current, result.doc, lyricDuration) : result.doc;
        return next === current ? s : { ...s, lyrics: { ...s.lyrics, [id]: next } };
      });
      const attached = sessionRef.current.lyrics[id];
      setLyricLookup(attached && lyricsVersionMatches(attached,track.title) ? { status: "found", doc: attached } : result);
    });
    return () => {
      cancelled = true;
    };
  }, [
    track?.id,
    track?.title,
    track?.artist,
    track?.album,
    ready,
    lyricRetry,
    lyricDuration,
    lookupWaiting,
  ]);

  async function attach(kind: "original" | "romanisation" | "translation") {
    const selected = track?.id;
    if (!selected) return;
    await action(async () => {
      const input = await library.lyrics();
      if (!input) return;
      const parsed = parseLyrics(input.text, input.fileName);
      if (
        sessionRef.current.queue.find(
          (i) => i.id === sessionRef.current.currentId,
        )?.trackId !== selected
      ) {
        throw new Error(
          "The selected track changed. Attach the lyrics again for this track.",
        );
      }
      if (kind === "original") {
        update((s) => ({ ...s, lyrics: { ...s.lyrics, [selected]: parsed } }));
        notify("Original lyrics attached locally");
      } else {
        if (!doc) throw new Error("Attach original lyrics first.");
        alignVariant(doc, parsed);
        setVariant({ doc: parsed, kind, trackId: selected, original: doc });
      }
    });
  }

  function confirmVariant() {
    if (!variant) return;
    if (
      !doc ||
      !track ||
      track.id !== variant.trackId ||
      doc.id !== variant.original.id
    ) {
      setVariant(null);
      setError(
        "The selected recording changed. Attach the supplied text again for this song.",
      );
      return;
    }
    try {
      const mapped = alignVariant(doc, variant.doc);
      update((s) => ({
        ...s,
        lyrics: {
          ...s.lyrics,
          [track.id]: {
            ...doc,
            [variant.kind]: mapped,
            ...(variant.kind === "romanisation"
              ? { romanisationSource: "imported" as const }
              : { translationSource: "imported" as const }),
          },
        },
      }));
      setVariant(null);
      notify("Supplied text attached to the original line IDs");
    } catch (e) {
      setError(formatError(e));
    }
  }

  function markInstrumental() {
    if (track) {
      update((s) => ({
        ...s,
        lyrics: {
          ...s.lyrics,
          [track.id]: {
            id: crypto.randomUUID(),
            raw: "",
            fileName: "Marked instrumental by you",
            lines: [],
            fileOffset: 0,
            userOffset: 0,
            warnings: [],
            romanisation: {},
            translation: {},
            instrumental: true,
          },
        },
      }));
    }
  }

  function clearCache() {
    update(clearFetchedLyrics);
    setLyricRetry((retry) => retry + 1);
    notify(
      "Cached lyrics cleared. Imported lyrics and your private key are preserved.",
    );
  }

  function regenerate() {
    if (!track || !doc) return;
    const id = track.id;
    const original = doc.id;
    void action(async () => {
      const romanisation = await romanizeDocument({
        ...doc,
        romanisation: {},
        romanisationSource: "local",
      });
      update((currentSession) =>
        currentSession.lyrics[id]?.id === original
          ? {
              ...currentSession,
              lyrics: {
                ...currentSession.lyrics,
                [id]: {
                  ...currentSession.lyrics[id],
                  romanisation,
                  romanisationSource: "local",
                  localRomanisation: romanisation,
                },
              },
            }
          : currentSession,
      );
      notify(
        "Romanization refreshed locally. Original lyrics and timing are preserved.",
      );
    });
  }

  function updateOffset(offset: number) {
    if (!track || !doc) return;
    update((s) => ({
      ...s,
      lyrics: {
        ...s.lyrics,
        [track.id]: { ...doc, userOffset: offset },
      },
    }));
  }

  function retryLookup() {
    if (!track) return;
    setLyricRetry((n) => n + 1);
  }

  return {
    lyricLookup,
    processingState: keylessState && (keylessState.state.status === "processing" || keylessState.docId === doc?.id) ? keylessState.state : processingState,
    translateLyrics,
    variant,
    setVariant,
    follow,
    setFollow,
    activeRef,
    lyricDuration,
    lyricSynced,
    active,
    followTarget,
    attach,
    confirmVariant,
    markInstrumental,
    clearCache,
    regenerate,
    updateOffset,
    retryLookup,
    romanizing,
  };
}
