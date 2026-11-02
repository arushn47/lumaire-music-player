import { useEffect, useState } from "react";
import { listeningStore } from "../adapters/listening";
import { mobile } from "../adapters/native";
import type { ListeningRecord } from "../domain/listening";
import type { Session, Track } from "../domain/types";
import { historyChanged, startListening, refreshListening } from "../player/listening-service";

export function useListeningHistory(ready: boolean, sessionRef: React.MutableRefObject<Session>, tracksRef: React.MutableRefObject<Track[]>, enabled: boolean) {
  const [records, setRecords] = useState<ListeningRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const refresh = () => setRevision(value => value + 1);
  useEffect(() => {
    if (!mobile) return;
    const visible = () => { if (!document.hidden) refresh(); };
    document.addEventListener('visibilitychange', visible);
    return () => document.removeEventListener('visibilitychange', visible);
  }, []);
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    let cleanup: (() => void) | undefined;
    void startListening(
      id => tracksRef.current.find(track => track.id === id) ?? sessionRef.current.queueTracks[id],
      () => sessionRef.current.settings.historyEnabled,
      e => { if (!cancelled) setError(`Listening history could not be saved. ${String(e)}`); },
    ).then(stop => { if (cancelled) stop(); else cleanup = stop; })
      .catch(e => { if (!cancelled) setError(`Listening tracker could not start. ${String(e)}`); });
    return () => { cancelled = true; cleanup?.(); };
  }, [ready]);
  useEffect(() => { refreshListening(); }, [enabled]);
  useEffect(() => {
    const changed = () => refresh();
    historyChanged.addEventListener("change", changed);
    return () => historyChanged.removeEventListener("change", changed);
  }, []);
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    setLoading(true);
    void listeningStore.load().then(snapshot => {
      if (!cancelled) { setRecords(snapshot.records); setError(""); }
    }).catch(e => { if (!cancelled) setError(`Listening history is unavailable. ${String(e)}`); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [ready, revision, mobile]);
  return { records, loading, error, refresh };
}
