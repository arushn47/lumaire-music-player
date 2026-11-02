import { beforeEach, describe, expect, it, vi } from "vitest";
import { cachedHomeAlbums, clearDiscoverySearches, discoveryPreferences, loadHomeAlbums, rememberDiscoverySearch, removeDiscoverySearch, setDiscoveryLanguages, loadPreferredHomeAlbums, recommendationLanguages, blendDiscoveryResults, loadDiscoverPage, mergeNewReleases, sortChartsByPreferences } from "./discovery-home";
import { library } from "./native";
import { discoveryTrendingItems } from "./discovery-home";
import type { DiscoverPage } from "./native";
import {featuredAlbum} from './discovery-home';
it('rotates featured albums by local day, stable across feed reordering and duplicate IDs',()=>{
  const albums=[album,{...album,id:'saavn:album:43',title:'Second'},{...album,id:'saavn:album:44',title:'Third'}];
  const morning=new Date(2026,9,29,1),evening=new Date(2026,9,29,23),tomorrow=new Date(2026,9,30,1);
  expect(featuredAlbum(albums,morning)?.id).toBe(featuredAlbum([...albums].reverse(),evening)?.id);
  expect(featuredAlbum(albums,morning)?.id).not.toBe(featuredAlbum(albums,tomorrow)?.id);
  expect(featuredAlbum([...albums,albums[0]],morning)?.id).toBe(featuredAlbum(albums,morning)?.id);
  expect(featuredAlbum([],morning)).toBeUndefined();
  expect(featuredAlbum([album],tomorrow)).toEqual(album);
});
vi.mock("./native", () => ({ library: { discoverAlbums: vi.fn(), discoverPage: vi.fn() } }));
const album = { id: "saavn:album:42", title: "Album", artist: "Artist", artists: [], artworkUrl: "https://c.saavncdn.com/a.jpg" };
beforeEach(() => {
  const data = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => data.set(key, value) });
  vi.mocked(library.discoverAlbums).mockReset();
});
describe("discovery preferences and album cache", () => {
  it("bounds and deduplicates submitted searches and lets users clear them", () => {
    rememberDiscoverySearch("  Artist  "); rememberDiscoverySearch("artist");
    expect(discoveryPreferences().searches).toEqual(["artist"]);
    for (let i = 0; i < 8; i++) rememberDiscoverySearch(`Query ${i}`);
    expect(discoveryPreferences().searches).toHaveLength(6);
    expect(removeDiscoverySearch("Query 7")).toEqual(["Query 6", "Query 5", "Query 4", "Query 3", "Query 2"]);
    expect(discoveryPreferences().searches).not.toContain("Query 7");
    setDiscoveryLanguages(["tamil"]); clearDiscoverySearches();
    expect(discoveryPreferences()).toEqual({ languages: ["tamil"], onboarded: true, searches: [] });
    localStorage.setItem("lumaire-discovery", '{"language":"invalid","searches":[null,4,""]}');
    expect(discoveryPreferences()).toEqual({ languages: [], onboarded: false, searches: [] });
  });
  it("migrates the previous choice and persists optional multiple languages without losing searches", () => {
    localStorage.setItem("lumaire-discovery", JSON.stringify({ language: "malayalam", searches: ["Music"] }));
    expect(discoveryPreferences()).toEqual({ languages: ["malayalam"], onboarded: false, searches: ["Music"] });
    setDiscoveryLanguages(["tamil", "english", "tamil"]);
    clearDiscoverySearches();
    expect(discoveryPreferences()).toEqual({ languages: ["tamil", "english"], onboarded: true, searches: [] });
    setDiscoveryLanguages([]);
    expect(discoveryPreferences()).toEqual({ languages: [], onboarded: true, searches: [] });
    expect(recommendationLanguages([])).toEqual(["english", "hindi"]);
    localStorage.setItem("lumaire-discovery", JSON.stringify({ languages: ["tamil", null, "invalid", "tamil"], onboarded: "yes" }));
    expect(discoveryPreferences().languages).toEqual(["tamil"]);
    expect(discoveryPreferences().onboarded).toBe(false);
  });
  it("blends selected languages and broader discovery, deduplicates and tolerates one unavailable language", async () => {
    const other = { ...album, id: "saavn:album:43", title: "Other language" };
    vi.mocked(library.discoverAlbums).mockImplementation(async language => {
      if (language === "malayalam") throw Error("Offline");
      return language === "english" ? [album, other] : [album];
    });
    const result = await loadPreferredHomeAlbums(["tamil", "malayalam"]);
    expect(result.albums.map(value => value.id)).toEqual([album.id, other.id]);
    expect(vi.mocked(library.discoverAlbums).mock.calls.map(call => call[0])).toEqual(["tamil", "malayalam", "english"]);
    expect(blendDiscoveryResults([[album], [other]], 1)).toEqual([album]);
  });
  it("reports unavailable discovery when every language request fails", async () => {
    vi.mocked(library.discoverAlbums).mockRejectedValue(Error("Offline"));
    await expect(loadPreferredHomeAlbums(["tamil"])).rejects.toThrow("Discovery albums unavailable");
    expect(blendDiscoveryResults([])).toEqual([]);
  });
  it("shares in-flight requests and reuses a fresh cache across navigation", async () => {
    vi.mocked(library.discoverAlbums).mockResolvedValue([album]);
    await Promise.all([loadHomeAlbums("tamil"), loadHomeAlbums("tamil")]);
    await loadHomeAlbums("tamil");
    expect(library.discoverAlbums).toHaveBeenCalledTimes(1);
    expect(cachedHomeAlbums("tamil")?.albums[0].title).toBe("Album");
  });
  it("retains stale data on failure and retries later instead of caching the rejection", async () => {
    localStorage.setItem("lumaire-discovery-albums-hindi", JSON.stringify({ albums: [album], updatedAt: Date.now() - 86400000 }));
    vi.mocked(library.discoverAlbums).mockRejectedValueOnce(Error("Offline")).mockResolvedValueOnce([album]);
    await expect(loadHomeAlbums("hindi")).rejects.toThrow("Offline");
    expect(cachedHomeAlbums("hindi")?.albums).toHaveLength(1);
    await expect(loadHomeAlbums("hindi")).resolves.toHaveProperty("albums");
  });
  it("rejects malformed cache metadata and unsafe artwork", () => {
    localStorage.setItem("lumaire-discovery-albums-english", JSON.stringify({ albums: [{ ...album, artworkUrl: "javascript:bad" }, { ...album, id: "invalid" }], updatedAt: Date.now() }));
    expect(cachedHomeAlbums("english")?.albums).toHaveLength(1);
    expect(cachedHomeAlbums("english")?.albums[0].artworkUrl).toBeNull();
    localStorage.setItem("lumaire-discovery-albums-english", "broken json");
    expect(cachedHomeAlbums("english")).toBeNull();
  });
});

it("shares Discover requests and caches shelves until explicitly refreshed", async () => {
  const feed = { newAlbums: [], newSingles: [], trending: [], topSongs: [], chartTitle: "Chart", warnings: [] };
  vi.mocked(library.discoverPage).mockReset().mockResolvedValue(feed);
  await Promise.all([loadDiscoverPage(["punjabi"]), loadDiscoverPage(["punjabi"])]);
  await loadDiscoverPage(["punjabi"]);
  expect(library.discoverPage).toHaveBeenCalledTimes(1);
  expect(library.discoverPage).toHaveBeenCalledWith(["punjabi", "english"]);
  await loadDiscoverPage(["punjabi"], true);
  expect(library.discoverPage).toHaveBeenCalledTimes(2);
});

it("combines albums and singles in one shelf while preserving identity and release kind", () => {
  const song = { id: "saavn:abcdefgh", title: "Single", artist: "Singer", artists: [], album: "Single", duration: 180 };
  const releases = mergeNewReleases([album, album], [song, song]);
  expect(releases.map(release => [release.id, release.kind])).toEqual([[album.id, "album"], [song.id, "single"]]);
  expect(releases[1].item).toBe(song);
  expect(mergeNewReleases([], [song])[0].kind).toBe("single");
  expect(mergeNewReleases([], [])).toEqual([]);
});

it("uses mixed homepage trending in provider order and supports the legacy song fallback", () => {
  const song = { id: "saavn:abcdefgh", title: "Song", artist: "Singer", artists: [], album: "Release", duration: 180 };
  const feed: DiscoverPage = { newAlbums: [], newSingles: [], trending: [song], topSongs: [], chartTitle: "", warnings: [], trendingItems: [
    { kind: "album", item: album },
    { kind: "playlist", item: { id: "saavn:playlist:99", title: "Now Trending", subtitle: "JioSaavn", url: "https://www.jiosaavn.com/featured/now-trending/abc" } },
    { kind: "song", item: song },
  ] };
  expect(discoveryTrendingItems(feed).map(entry => entry.kind)).toEqual(["album", "song"]);
  for (const title of ["Song (Remix)", "Song (Lo-fi Version)", "Song (Lo–fi Version)", "Song Slowed + Reverb", "Song Sped Up", "Song Mashup"]) {
    expect(discoveryTrendingItems({ ...feed, trendingItems: [{ kind: "song", item: { ...song, title } }, { kind: "album", item: { ...album, title } }] })).toEqual([]);
    expect(discoveryTrendingItems({ ...feed, trendingItems: undefined, trending: [{ ...song, title }] })).toEqual([]);
  }
  expect(discoveryTrendingItems({ ...feed, trendingItems: undefined })).toEqual([{ kind: "song", item: song }]);
  expect(discoveryTrendingItems({ ...feed, trendingItems: [], trending: [] })).toEqual([]);
});

it("retains cached curated charts with a warning when refreshed discovery has no chart list", async () => {
  const chart = { id: "saavn:chart:99", title: "Tamil: Top 50", subtitle: "JioSaavn" };
  const feed = { newAlbums: [], newSingles: [], trending: [], topSongs: [], chartTitle: "", warnings: [] };
  vi.mocked(library.discoverPage).mockReset().mockResolvedValueOnce({ ...feed, charts: [chart] }).mockResolvedValueOnce(feed);
  await loadDiscoverPage(["marathi"], true);
  const refreshed = await loadDiscoverPage(["marathi"], true);
  expect(refreshed.charts).toEqual([chart]);
  expect(refreshed.warnings.some(warning => warning.includes("last saved JioSaavn charts"))).toBe(true);
});

it("sorts charts in order of preferred music languages from settings", () => {
  const charts = [
    { id: "1", title: "Telugu: India Superhits Top 50", subtitle: "JioSaavn" },
    { id: "2", title: "Tamil: India Superhits Top 50", subtitle: "JioSaavn" },
    { id: "3", title: "Malayalam: India Superhits Top 50", subtitle: "JioSaavn" },
    { id: "4", title: "Hindi: India Superhits Top 50", subtitle: "JioSaavn" },
    { id: "5", title: "Top 50 - Global", subtitle: "Weekly chart" },
  ];
  const sorted = sortChartsByPreferences(charts, ["tamil", "malayalam"]);
  expect(sorted.map(c => c.id)).toEqual(["2", "3", "1", "4", "5"]);

  // Empty preferences retains original order
  expect(sortChartsByPreferences(charts, [])).toEqual(charts);
});

