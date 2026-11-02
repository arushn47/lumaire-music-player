import { useEffect, useMemo, useState } from "react";
import { Heart, ListPlus, RefreshCw } from "lucide-react";
import { Artwork, IconButton, Select } from "../common";
import { EntityArtwork } from "../common/EntityArtwork";
import { library } from "../../adapters/native";
import { ArtistLinks } from "../common/ArtistLinks";
import { albumReference, artistCredits, resolveArtistCredit } from "../../domain/catalog-links";
import {
  aggregateListening, formatListening, localDay, rangeStart,
  type HistoryRange, type ListeningRecord,
} from "../../domain/listening";

export interface HistoryViewProps {
  initialTab?: "stats" | "history";
  onNavigateArtist?: (id: string) => void;
  onNavigateAlbum?: (id: string) => void;
  records: ListeningRecord[];
  loading: boolean;
  error: string;
  mobile: boolean;
  enabled: boolean;
  onReplay: (record: ListeningRecord) => void;
  onQueue: (record: ListeningRecord) => void;
  onFavorite: (record: ListeningRecord) => void;
  favorites: string[];
  onRefresh: () => void;
}

const ranges: { value: HistoryRange; label: string }[] = [
  { value: "year", label: "This year" },
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
  { value: "all", label: "All time" },
];

function dayTitle(day: string, now: number) {
  if (day === localDay(now)) return "Today";
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (day === localDay(yesterday.getTime())) return "Yesterday";
  return new Date(`${day}T12:00:00`).toLocaleDateString(undefined, {
    weekday: "long", month: "long", day: "numeric", year: "numeric",
  });
}

export function HistoryView({ initialTab = "stats", records, loading, error, mobile, enabled, onNavigateArtist, onNavigateAlbum,
  onReplay, onQueue, onFavorite, favorites, onRefresh }: HistoryViewProps) {
  const [tab, setTab] = useState<"stats" | "history">(initialTab);
  useEffect(() => {
    if (initialTab) setTab(initialTab);
  }, [initialTab]);
  const [range, setRange] = useState<HistoryRange>("year");
  const [pageSize, setPageSize] = useState(10);
  const [page, setPage] = useState(0);
  const now = Date.now();
  const stats = useMemo(() => aggregateListening(records, range, now), [records, range, now]);
  const visible = [...stats.records].sort((a, b) => b.startedAt - a.startedAt);
  const pages = Math.max(1, Math.ceil(visible.length / pageSize));
  const currentPage = Math.min(page, pages - 1);
  const paged = visible.slice(currentPage * pageSize, (currentPage + 1) * pageSize);
  const groups = new Map<string, ListeningRecord[]>();
  for (const record of paged) {
    const day = localDay(record.startedAt);
    groups.set(day, [...(groups.get(day) ?? []), record]);
  }
  const dateFormat: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" };
  const dateLabel = range === "all" ? "All recorded listening" :
    `${new Date(rangeStart(range, now)).toLocaleDateString(undefined, dateFormat)} – ${new Date(now).toLocaleDateString(undefined, dateFormat)}`;
  const panels = [
    { title: "Top artists", kind: "artist", rows: stats.artists },
    { title: "Top albums", kind: "album", rows: stats.albums },
    { title: "Top tracks", kind: "track", rows: stats.tracks },
  ];
  const monthlyMax = Math.max(1, ...stats.insights.monthly.map(month => month.ms));

  return <section className="listening-view" aria-label="Listening recap and recent plays">
    <header className="listening-heading">
      <div><p className="eyebrow">The music that made your days</p><h1>Your listening recap.</h1></div>
      <IconButton label="Refresh listening activity" onClick={onRefresh} disabled={loading}><RefreshCw size={18} /></IconButton>
    </header>
    <div className="listening-toolbar">
      <div className="listening-tabs" role="tablist" aria-label="Listening view">
        <button type="button" role="tab" id="listening-stats-tab" aria-controls="listening-panel" aria-selected={tab === "stats"} onClick={() => setTab("stats")}>Your recap</button>
        <button type="button" role="tab" id="listening-history-tab" aria-controls="listening-panel" aria-selected={tab === "history"} onClick={() => setTab("history")}>Recent plays</button>
      </div>
      <div className="listening-range">
        <span>{dateLabel}</span>
        <Select
          ariaLabel="Listening date range"
          value={range}
          onChange={(newRange) => {
            setRange(newRange as HistoryRange);
            setPage(0);
          }}
          options={ranges}
        />
      </div>
    </div>
    {!enabled && <p className="listening-notice">Listening activity is paused. Your existing plays are kept. Enable recording in Settings &amp; sources.</p>}
    {error && <div className="listening-notice" role="alert">{error} <button type="button" onClick={onRefresh}>Try again</button></div>}
    <div id="listening-panel" role="tabpanel" aria-labelledby={tab === "stats" ? "listening-stats-tab" : "listening-history-tab"} aria-busy={loading}>
      {loading && records.length === 0 ? <p className="listening-empty" role="status">Loading listening history…</p> : visible.length === 0 ? <div className="listening-empty"><h2>No listening here yet.</h2><p>{records.length ? "Choose a wider date range to see your listening." : "Play a song. It will appear after 10 seconds of listening."}</p></div> : <>
        {tab === "stats" ? <>
        <div className="listening-recap-overview">
          <div className="listening-recap-total"><span className="eyebrow">Time well spent</span><strong>{formatListening(stats.totalMs)}</strong><span>with your music</span></div>
          <dl className="listening-recap-metrics">
            <div><dt>Qualified plays</dt><dd>{visible.length.toLocaleString()}</dd></div>
            <div><dt>Unique songs</dt><dd>{stats.insights.uniqueTracks.toLocaleString()}</dd></div>
            <div><dt>Artists</dt><dd>{stats.insights.uniqueArtists.toLocaleString()}</dd></div>
            <div><dt>Albums</dt><dd>{stats.insights.uniqueAlbums.toLocaleString()}</dd></div>
          </dl>
        </div>
        <div className="listening-panels">{panels.map(panel => <section className="listening-ranking" key={panel.title} aria-label={panel.title}><h2>{panel.title}</h2><ol>{panel.rows.slice(0, 5).map((row, index) => <li key={row.key}>
          <span className="listening-rank-number">{index + 1}</span>{panel.kind === "track"
            ? <Artwork url={row.artworkUrl} className="listening-artwork" />
            : <EntityArtwork kind={panel.kind as "artist" | "album"} name={row.title} artist={panel.kind === "album" ? row.subtitle : ""} trackTitle={row.record.title} catalogId={row.record.metadataSourceId} artworkUrl={panel.kind === 'album' && !row.artworkUrl?.includes('ytimg.com') ? row.artworkUrl : undefined} />}
          <div className="listening-rank-detail"><button type="button" disabled={(panel.kind === "album" && !albumReference(row.title, row.subtitle)) || (panel.kind === "artist" && !artistCredits(row.title).length)} onClick={() => {
            if (panel.kind === "artist" && onNavigateArtist) void resolveArtistCredit({ name: row.title }, row.record.metadataSourceId, library.lookupCatalog, library.lookupArtist).then(onNavigateArtist);
            else if (panel.kind === "album" && onNavigateAlbum) { const id = albumReference(row.title, row.subtitle); if (id) onNavigateAlbum(id); }
            else onReplay(row.record);
          }} title={row.title}>{row.title}</button>{panel.kind === "artist" ? <span title={row.subtitle}>{row.subtitle}</span> : <span title={row.subtitle}><ArtistLinks artistString={row.subtitle} onNavigateArtist={onNavigateArtist} /></span>}<div className="listening-time-bar" aria-hidden="true"><i style={{ width: `${Math.max(1, row.ms / Math.max(1, panel.rows[0]?.ms ?? 1) * 100)}%` }} /></div></div><div className="listening-rank-metrics"><span className="listening-duration">{formatListening(row.ms)}</span>{panel.kind === "track" && <span className="listening-plays">{row.plays} {row.plays === 1 ? "play" : "plays"}</span>}</div>
        </li>)}</ol></section>)}</div>
        <div className="listening-recap-bottom">
          <section className="listening-months" aria-label="Monthly listening"><h2>Your months in music</h2><p>Time listened each month within this date range.</p><ol>{stats.insights.monthly.map(month => {
            const label = new Date(`${month.month}-01T12:00:00`).toLocaleDateString(undefined, { month: "short", year: "numeric" });
            return <li key={month.month}><span>{label}</span><div className="listening-month-bar" aria-hidden="true"><i style={{ width: `${month.ms / monthlyMax * 100}%` }} /></div><strong>{formatListening(month.ms)}</strong></li>;
          })}</ol></section>
          <section className="listening-patterns" aria-label="Listening patterns"><h2>A little rhythm</h2><dl>
            <div><dt>Active days</dt><dd>{stats.insights.activeDays.toLocaleString()}</dd></div>
            <div><dt>Longest listening streak</dt><dd>{stats.insights.longestStreak} {stats.insights.longestStreak === 1 ? "day" : "days"}</dd></div>
            <div><dt>Busiest day</dt><dd>{stats.insights.busiestDay ? new Date(`${stats.insights.busiestDay}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "—"}</dd></div>
          </dl><p>Based on recorded listening, including paired history when sync is enabled.</p></section>
        </div>
        </> : <>
          <div className="listening-summary"><span><strong>{formatListening(stats.totalMs)}</strong> listened</span><span>{visible.length} qualified {visible.length === 1 ? "play" : "plays"}</span></div>
          <div className="listening-days">{[...groups].map(([day, entries]) => <section key={day} aria-label={dayTitle(day, now)}><h2>{dayTitle(day, now)}</h2><ul>{entries.map(record => <li className="listening-history-row" key={record.id} onClick={(e) => { if ((e.target as HTMLElement).closest("button, a, summary, details, input, .listening-history-actions")) return; onReplay(record); }}>
            <div className="listening-artwork-wrap" onClick={() => onReplay(record)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onReplay(record); }} aria-label={`Play ${record.title}`}>
              <Artwork url={record.artworkUrl} className="listening-artwork" />
            </div>
            <div className="listening-history-identity">
              <button type="button" className="track-title-button" onClick={() => onReplay(record)} title={`Play ${record.title}`}>{record.title}</button>
              <span title={record.artist}><ArtistLinks artistString={record.artist || "Unknown artist"} catalogId={record.metadataSourceId} onNavigateArtist={onNavigateArtist} /></span>
            </div>
            <div className="listening-history-meta">
              <span className="listening-history-duration">{formatListening(record.listenedMs)} listened</span>
              <span className="listening-history-dot" aria-hidden="true">·</span>
              <time dateTime={new Date(record.startedAt).toISOString()}>{new Date(record.startedAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}</time>
            </div>
            <div className="listening-history-actions">
              <IconButton label={`Add ${record.title} to queue`} className="listening-queue-action" onClick={() => onQueue(record)}><ListPlus size={18} /></IconButton>
              <IconButton label={`${favorites.includes(record.trackId) ? "Unfavorite" : "Favorite"} ${record.title}`} active={favorites.includes(record.trackId)} onClick={() => onFavorite(record)}><Heart size={18} fill={favorites.includes(record.trackId) ? "currentColor" : "none"} /></IconButton>
            </div>
          </li>)}</ul></section>)}</div>
          <footer className="listening-pagination">
            <div className="pagination-page-size">
              <span>Rows per page</span>
              <Select
                ariaLabel="Recent plays rows per page"
                value={pageSize}
                onChange={(newSize) => {
                  setPageSize(Number(newSize));
                  setPage(0);
                }}
                options={[
                  { value: 10, label: "10" },
                  { value: 25, label: "25" },
                  { value: 50, label: "50" },
                ]}
                placement="up"
              />
            </div>
            <span>Page {currentPage + 1} of {pages}</span>
            <button type="button" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous</button>
            <button type="button" disabled={currentPage + 1 >= pages} onClick={() => setPage(currentPage + 1)}>Next</button>
          </footer>
        </>}
      </>}
    </div>
  </section>;
}
