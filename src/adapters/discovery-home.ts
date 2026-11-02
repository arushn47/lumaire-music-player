import { library, type CatalogAlbum, type CatalogChart, type CatalogTrack, type DiscoverPage, type TrendingItem } from "./native";

export const DISCOVERY_LANGUAGES = ["english", "hindi", "tamil", "telugu", "malayalam", "kannada", "punjabi", "bengali", "marathi"] as const;
export type DiscoveryLanguage = typeof DISCOVERY_LANGUAGES[number];
const SETTINGS_KEY = "lumaire-discovery";
const CACHE_KEY = "lumaire-discovery-albums-";
const MAX_AGE = 6 * 60 * 60 * 1000;
const pending = new Map<string, Promise<HomeAlbums>>();
export interface HomeAlbums { albums: CatalogAlbum[]; updatedAt: number }

export function featuredAlbum(albums: CatalogAlbum[], now = new Date()): CatalogAlbum | undefined {
  const available = [...new Map(albums.map(album => [album.id, album])).values()].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
  const day = Math.floor(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / 86400000);
  return available.length ? available[day % available.length] : undefined;
}

function read(key: string): unknown {
  try { return JSON.parse(localStorage.getItem(key) || "null"); } catch { return null; }
}
function write(key: string, value: unknown): void {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Browsing works when local storage is unavailable. */ }
}
export const DISCOVERY_PREFERENCES_CHANGED = "lumaire:discovery-preferences-changed";
export function discoveryPreferences(): { languages: DiscoveryLanguage[]; onboarded: boolean; searches: string[] } {
  const value = read(SETTINGS_KEY) as { language?: unknown; languages?: unknown; onboarded?: unknown; searches?: unknown } | null;
  const languages = Array.isArray(value?.languages) ? value.languages : value?.language ? [value.language] : [];
  return {
    languages: [...new Set(languages.filter((language): language is DiscoveryLanguage => DISCOVERY_LANGUAGES.includes(language as DiscoveryLanguage)))],
    onboarded: value?.onboarded === true,
    searches: Array.isArray(value?.searches) ? value.searches.filter((query): query is string => typeof query === "string" && query.trim().length > 0 && query.length <= 200 && !/[\u0000-\u001f]/.test(query)).slice(0, 6) : [],
  };
}
export function setDiscoveryLanguages(languages: DiscoveryLanguage[]): void {
  write(SETTINGS_KEY, { ...discoveryPreferences(), languages: [...new Set(languages.filter(language => DISCOVERY_LANGUAGES.includes(language)))], onboarded: true });
  if (typeof window !== "undefined") window.dispatchEvent(new Event(DISCOVERY_PREFERENCES_CHANGED));
}
export function recommendationLanguages(languages: DiscoveryLanguage[]): DiscoveryLanguage[] {
  return [...new Set<DiscoveryLanguage>([...(languages.length ? languages : ["english", "hindi"] as const), "english"])];
}
export function blendDiscoveryResults<T extends { id: string }>(groups: T[][], limit = 12): T[] {
  const result: T[] = [], seen = new Set<string>();
  const length = Math.max(0, ...groups.map(group => group.length));
  for (let index = 0; index < length && result.length < limit; index++) {
    for (const group of groups) {
      const item = group[index];
      if (item && !seen.has(item.id)) { seen.add(item.id); result.push(item); }
      if (result.length === limit) break;
    }
  }
  return result;
}
export async function loadPreferredHomeAlbums(languages: DiscoveryLanguage[], refresh = false): Promise<HomeAlbums> {
  const responses = await Promise.allSettled(recommendationLanguages(languages).map(language => loadHomeAlbums(language, refresh)));
  const values = responses.flatMap(response => response.status === "fulfilled" ? [response.value] : []);
  if (!values.length) throw Error("Discovery albums unavailable");
  return { albums: blendDiscoveryResults(values.map(value => value.albums)), updatedAt: Math.max(...values.map(value => value.updatedAt)) };
}
export function rememberDiscoverySearch(query: string): string[] {
  const preferences = discoveryPreferences();
  const clean = query.trim().slice(0, 200);
  const searches = clean ? [clean, ...preferences.searches.filter(old => old.toLocaleLowerCase() !== clean.toLocaleLowerCase())].slice(0, 6) : preferences.searches;
  write(SETTINGS_KEY, { ...preferences, searches });
  return searches;
}
export function clearDiscoverySearches(): void {
  write(SETTINGS_KEY, { ...discoveryPreferences(), searches: [] });
}
export function removeDiscoverySearch(query: string): string[] {
  const preferences = discoveryPreferences();
  const clean = query.trim().toLocaleLowerCase();
  const searches = preferences.searches.filter(
    (old) => old.trim().toLocaleLowerCase() !== clean,
  );
  write(SETTINGS_KEY, { ...preferences, searches });
  return searches;
}
export function cachedHomeAlbums(language: DiscoveryLanguage): HomeAlbums | null {
  const value = read(CACHE_KEY + language) as Partial<HomeAlbums> | null;
  if (!value || !Number.isFinite(value.updatedAt) || value.updatedAt! <= 0 || value.updatedAt! > Date.now() || !Array.isArray(value.albums)) return null;
  const albums: CatalogAlbum[] = value.albums.slice(0, 12).filter(album => album && typeof album.id === "string" && /^saavn:album:[1-9]\d{0,19}$/.test(album.id)
    && typeof album.title === "string" && album.title.length > 0 && album.title.length <= 4000 && typeof album.artist === "string" && album.artist.length <= 4000)
    .map(album => ({ id: album.id, title: album.title, artist: album.artist, artists: [],
      artworkUrl: typeof album.artworkUrl === "string" && /^https:\/\/c\.saavncdn\.com\//.test(album.artworkUrl) ? album.artworkUrl : null,
      year: Number.isInteger(album.year) && album.year! >= 1900 && album.year! <= 2200 ? album.year : null }));
  return { albums, updatedAt: value.updatedAt! };
}
export function loadHomeAlbums(language: DiscoveryLanguage, refresh = false): Promise<HomeAlbums> {
  const cached = cachedHomeAlbums(language);
  if (!refresh && cached && Date.now() - cached.updatedAt < MAX_AGE) return Promise.resolve(cached);
  let request = pending.get(language);
  if (!request) {
    request = library.discoverAlbums(language).then(albums => {
      const result = { albums, updatedAt: Date.now() };
      write(CACHE_KEY + language, result);
      return result;
    }).finally(() => { pending.delete(language); });
    pending.set(language, request);
  }
  return request;
}

let discoverCache: { key: string; at: number; value: DiscoverPage } | undefined;
let chartsCache: { at: number; charts: CatalogChart[] } | undefined;
const discoverPending = new Map<string, Promise<DiscoverPage>>();
export function loadDiscoverPage(languages: DiscoveryLanguage[], refresh = false): Promise<DiscoverPage> {
  const selected = recommendationLanguages(languages);
  const key = selected.join(",");
  if (!refresh && discoverCache?.key === key && Date.now() - discoverCache.at < 10 * 60 * 1000) return Promise.resolve(discoverCache.value);
  const existing = discoverPending.get(key);
  if (existing) return existing;
  const request = library.discoverPage(selected).then(response => {
    let value = response;
    if (value.charts?.length) chartsCache = { at: Date.now(), charts: value.charts };
    else if (chartsCache && Date.now() - chartsCache.at < 86400000) value = {
      ...value, charts: chartsCache.charts, warnings: [...value.warnings, "Showing the last saved JioSaavn charts; the provider couldn't refresh them."],
    };
    discoverCache = { key, at: Date.now(), value };
    return value;
  }).finally(() => discoverPending.delete(key));
  discoverPending.set(key, request);
  return request;
}

export type NewRelease =
  | { id: string; kind: "album"; item: CatalogAlbum }
  | { id: string; kind: "single"; item: CatalogTrack };
export function discoveryTrendingItems(feed: DiscoverPage): Exclude<TrendingItem, { kind: "playlist" }>[] {
  const entries: TrendingItem[] = feed.trendingItems?.length ? feed.trendingItems : feed.trending.map(item => ({ kind: "song", item }));
  return entries.filter((entry): entry is Exclude<TrendingItem, { kind: "playlist" }> =>
    entry.kind !== "playlist" && !/\b(?:remix(?:es|ed)?|lo[\s\-‐‑–—]?fi|slowed|sped[\s\-‐‑–—]?up|nightcore|mash[\s\-‐‑–—]?up|karaoke|reverb(?:ed)?)\b/i.test(entry.item.title));
}
export function mergeNewReleases(albums: CatalogAlbum[], singles: CatalogTrack[]): NewRelease[] {
  return blendDiscoveryResults<NewRelease>([
    albums.map(item => ({ id: item.id, kind: "album", item })),
    singles.map(item => ({ id: item.id, kind: "single", item })),
  ], 24);
}

export function sortChartsByPreferences(charts: CatalogChart[], preferredLanguages: DiscoveryLanguage[]): CatalogChart[] {
  if (!charts.length || !preferredLanguages.length) return charts;
  const rankChart = (chart: CatalogChart): number => {
    const text = `${chart.title} ${chart.subtitle}`.toLowerCase();
    for (let i = 0; i < preferredLanguages.length; i++) {
      const lang = preferredLanguages[i].toLowerCase();
      if (new RegExp(`\\b${lang}\\b`, "i").test(text)) {
        return i;
      }
    }
    return -1;
  };
  return [...charts].sort((a, b) => {
    const rankA = rankChart(a);
    const rankB = rankChart(b);
    if (rankA !== -1 && rankB !== -1) return rankA - rankB;
    if (rankA !== -1) return -1;
    if (rankB !== -1) return 1;
    return 0;
  });
}

