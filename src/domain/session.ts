import {recordingMetadata} from './metadata-enrichment';
import { defaults, type QueueItem, type Session, type Track } from "./types";
import { isCatalogId, isQueuedCatalog } from "./queue";
import { restoreReplica } from './device-sync';
import { repairYoutubeTrack } from './online-track';
// Backups and database contents are untrusted. Normalize before rendering or playing.
export function restoreSession(value: unknown, tracks: Track[]): Session {
  const base = defaults();
  if (!value || typeof value !== "object") return base;
  const v = value as Partial<Session>,
    savedIds = new Set(tracks.map((t) => t.id));
  const requestedIds = new Set(
    Array.isArray(v.queue) ? v.queue.map((entry) => entry?.trackId) : [],
  );
  const queueTracks: Record<string, Track> = {};
  // Only stable remote identities can be restored without a library row. Local
  // file access always requires the backend's saved path mapping.
  for (const [id, candidate] of Object.entries(v.queueTracks ?? {})
    .filter(([id]) => requestedIds.has(id) && !savedIds.has(id))
    .slice(0, 500)) {
    const t = candidate as Track;
    const source = t?.source;
    if (t?.id === id && isQueuedCatalog(t) && [t.title, t.artist, t.album, t.fileName].every(value => typeof value === "string" && value.length <= 4000) && Number.isFinite(t.duration) && t.duration >= 0) {
      queueTracks[id] = { id, recordingMetadata: recordingMetadata(t.recordingMetadata), metadataSourceId: id, title: t.title, artist: t.artist, album: t.album, fileName: "", format: "catalog", duration: t.duration, missing: false,
        artworkUrl: typeof t.artworkUrl === "string" && t.artworkUrl.startsWith("https://") ? t.artworkUrl : null };
      continue;
    }
    if (t?.id !== id || !source || typeof source.sourceId !== "string")
      continue;
    const youtube =
      source.providerId === "youtube" &&
      /^[A-Za-z0-9_-]{11}$/.test(source.sourceId);
    const commons =
      source.providerId === "wikimedia-commons" &&
      /^[1-9]\d*$/.test(source.sourceId);
    if (
      (!youtube && !commons) ||
      id !== `${source.providerId}:${source.sourceId}` ||
      ![
        t.title,
        t.artist,
        t.album,
        t.fileName,
        t.format,
        source.pageUrl,
        source.license,
        source.licenseUrl,
        source.attribution,
      ].every((value) => typeof value === "string") ||
      !Number.isFinite(t.duration)
    )
      continue;
    queueTracks[id] = {
      id,
      title: t.title,
      artist: t.artist,
      album: t.album,
      fileName: t.fileName,
      duration: Math.max(0, t.duration),
      format: t.format,
      missing: false,
      artworkUrl:
        typeof t.artworkUrl === "string" && t.artworkUrl.startsWith("https://")
          ? t.artworkUrl
          : null,
      ...(typeof t.metadataSourceId === "string" && isCatalogId(t.metadataSourceId)
        ? { metadataSourceId: t.metadataSourceId }
        : {}),
      recordingMetadata: recordingMetadata(t.recordingMetadata),
      source: {
        providerId: source.providerId,
        sourceId: source.sourceId,
        pageUrl: youtube
          ? `https://www.youtube.com/watch?v=${source.sourceId}`
          : `https://commons.wikimedia.org/?curid=${source.sourceId}`,
        license: source.license,
        licenseUrl: source.licenseUrl,
        attribution: source.attribution,
      },
    };
    queueTracks[id] = repairYoutubeTrack(queueTracks[id]);
  }
  const ids = new Set([...savedIds, ...Object.keys(queueTracks)]);
  const cleanItems = (items: unknown, validIds = ids): QueueItem[] =>
    Array.isArray(items)
      ? items
          .filter(
            (i) =>
              i &&
              typeof i.id === "string" &&
              typeof i.trackId === "string" &&
              validIds.has(i.trackId),
          )
          .slice(0, 50000)
          .map((i) => ({
            id: i.id,
            trackId: i.trackId,
            ...(i.requested === true ? { requested: true } : {}),
          }))
      : [];
  const queue = cleanItems(v.queue);
  // Item IDs must remain unique, even when the same track is intentionally repeated.
  const seen = new Set<string>();
  for (const i of queue) {
    if (seen.has(i.id)) i.id = crypto.randomUUID();
    seen.add(i.id);
  }
  const queueIds = new Set(queue.map((entry) => entry.id));
  const p = v.settings ?? base.settings;
  return {
    ...base,
    favoriteArtists: Array.isArray(v.favoriteArtists) ? [...new Map(v.favoriteArtists.filter(artist => artist && typeof artist.id === "string" && /^(?:musicbrainz:artist:[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}|saavn:artist:[1-9]\d{0,19}|itunes:[1-9]\d{0,19}|(?:saavn:)?artist:name:[^:]{1,1200})$/.test(artist.id) && typeof artist.name === "string" && artist.name.trim().length > 0 && artist.name.length <= 4000).slice(0, 500).map(artist => [artist.id, {
      id: artist.id, name: artist.name,
      artworkUrl: typeof artist.artworkUrl === "string" && artist.artworkUrl.startsWith("https://") ? artist.artworkUrl : null,
    }])).values()] : [],
    favoriteAlbums: Array.isArray(v.favoriteAlbums) ? [...new Map(v.favoriteAlbums.filter(album => album && typeof album.id === "string" && /^(?:musicbrainz:release:[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}|saavn:album:[1-9]\d{0,19}|itunes:[1-9]\d{0,19}|saavn:album:search:[^:]{1,1200}:[^:]{1,1200})$/.test(album.id) && [album.title, album.artist].every(text => typeof text === "string" && text.length <= 4000)).slice(0, 500).map(album => [album.id, {
      id: album.id, title: album.title, artist: album.artist,
      artworkUrl: typeof album.artworkUrl === "string" && album.artworkUrl.startsWith("https://") ? album.artworkUrl : null,
      year: Number.isInteger(album.year) ? album.year : null,
    }])).values()] : [],
    queue,
    shuffleOrder: Array.isArray(v.shuffleOrder)
      ? [
          ...new Set(
            v.shuffleOrder
              .slice(0, 50000)
              .filter((id) => typeof id === "string" && queueIds.has(id)),
          ),
        ]
      : [],
    queueTracks,
    replica: restoreReplica(v.replica),
    listeningResumes: Array.isArray(v.listeningResumes) ? v.listeningResumes.slice(0, 12).flatMap(item => {
      if (!item || typeof item.id !== 'string' || typeof item.title !== 'string' || !['album', 'playlist', 'queue'].includes(item.kind) || !Number.isFinite(item.updatedAt) || !Array.isArray(item.queue)) return [];
      const restored = restoreSession({ queue: item.queue.slice(0, 1000), queueTracks: item.queueTracks, currentId: item.currentId, position: item.position, shuffleOrder: item.shuffleOrder }, tracks);
      if (!restored.queue.length || (item.kind === 'queue' && restored.queue.length < 2) || restored.currentId !== item.currentId) return [];
      return [{ id: item.id.slice(0, 500), title: item.title.slice(0, 500), kind: item.kind, updatedAt: item.updatedAt, shuffle: item.shuffle === true, queue: restored.queue, queueTracks: restored.queueTracks, currentId: item.currentId, position: restored.position, shuffleOrder: restored.shuffleOrder }];
    }) : [],
    currentId: queue.some((i) => i.id === v.currentId)
      ? v.currentId!
      : (queue[0]?.id ?? null),
    position: Number.isFinite(v.position) ? Math.max(0, Number(v.position)) : 0,
    favorites: Array.isArray(v.favorites)
      ? v.favorites.filter((id) => savedIds.has(id))
      : [],
    playlists: Array.isArray(v.playlists)
      ? v.playlists
          .filter(
            (p) => p && typeof p.id === "string" && typeof p.name === "string",
          )
          .map((p) => ({
            ...p,
            name: p.name.slice(0, 100),
            updatedAt: typeof p.updatedAt === "number" && Number.isFinite(p.updatedAt) && p.updatedAt >= 0 ? p.updatedAt : undefined,
            importSources: Array.isArray(p.importSources) ? p.importSources.filter((source: unknown): source is string => typeof source === "string" && source.length <= 200).slice(0, 100) : undefined,
            items: cleanItems(p.items, savedIds),
          }))
      : [],
    lyrics:
      v.lyrics && typeof v.lyrics === "object"
        ? Object.fromEntries(
            Object.entries(v.lyrics).filter(
              ([id, d]) =>
                ids.has(id) &&
                d &&
                typeof d.raw === "string" &&
                typeof d.fileName === "string" &&
                Array.isArray(d.warnings) &&
                d.warnings.every((w) => typeof w === "string") &&
                Array.isArray(d.lines) &&
                d.lines.every(
                  (l) =>
                    l &&
                    typeof l.id === "string" &&
                    typeof l.text === "string" &&
                    (l.words === undefined || (
                      Array.isArray(l.words) &&
                      l.words.every((w, i) => w && typeof w.text === "string" &&
                        Number.isFinite(w.time) && w.time >= (l.time ?? 0) &&
                        (i === 0 || w.time >= l.words![i - 1].time) &&
                        (w.end === undefined || (Number.isFinite(w.end) && w.end >= w.time))) &&
                      l.words.map(w => w.text).join("") === l.text
                    )) &&
                    (l.time === null || Number.isFinite(l.time)),
                ) &&
                Number.isFinite(d.fileOffset) &&
                Number.isFinite(d.userOffset) &&
                d.romanisation &&
                d.translation &&
                Object.values(d.romanisation).every(
                  (t) => typeof t === "string",
                ) &&
                Object.values(d.translation).every(
                  (t) => typeof t === "string",
                ),
            ),
          )
        : {},
    history: Array.isArray(v.history)
      ? v.history
          .filter((h) => h && ids.has(h.trackId) && typeof h.at === "string")
          .slice(-500)
      : [],
    settings: {
      themeMode: p.themeMode === "light" ? "light" : "dark",
      fullscreenLayout: "immersive",
      accentColor:
        typeof p.accentColor === "string" &&
        /^#[0-9a-fA-F]{6}$/.test(p.accentColor)
          ? p.accentColor.toUpperCase()
          : base.settings.accentColor,
      volume: Number.isFinite(p.volume)
        ? Math.min(1, Math.max(0, p.volume))
        : 0.75,
      repeat: ["all", "one"].includes(p.repeat) ? p.repeat : "off",
      shuffle: p.shuffle === true,
      romanisation: p.romanisation !== false,
      translation: p.translation !== false,
      originalScript: p.originalScript !== false,
      originalFirst: p.originalFirst !== false,
      autoOpenLyrics: p.autoOpenLyrics === true,
      autoplay: p.autoplay === true,
      estimatedScroll: p.estimatedScroll !== false,
      geminiModel:
        typeof p.geminiModel === "string" &&
        /^[A-Za-z0-9._-]{1,100}$/.test(p.geminiModel)
          ? p.geminiModel
          : base.settings.geminiModel,
      lyricSize: Number.isFinite(p.lyricSize)
        ? Math.max(18, Math.min(46, p.lyricSize))
        : base.settings.lyricSize,
      historyEnabled: p.historyEnabled !== false,
      autoGemini: p.autoGemini !== false,
    },
  };
}
export function toggleArtistFavorite(artists: Session['favoriteArtists'], artist: Session['favoriteArtists'][number], verifiedIds: string[] = []): Session['favoriteArtists'] {
  const aliases = new Set([artist.id, ...verifiedIds]);
  return artists.some(saved => aliases.has(saved.id)) ? artists.filter(saved => !aliases.has(saved.id)) : [...artists, artist];
}
