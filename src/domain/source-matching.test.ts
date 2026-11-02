import { describe, expect, it, vi } from "vitest";
import type { CatalogTrack, YtdlpSearchResult } from "../adapters/native";
import { matchSource, sourceCoreTitle, sourceTitle } from "./source-matching";
import { resolveCatalogSource } from "./catalog-track";

const song: CatalogTrack = { id: "saavn:12345678", title: 'Evening Sky (From "Film")', artist: "Writer, A. R. Singer, Guest", artists: [{ name: "Writer" }, { name: "A. R. Singer" }, { name: "Guest" }], album: "Film", duration: 210 };
const video: YtdlpSearchResult = { id: "abcdefghijk", title: "Evening Sky - Video Song | Guest | Film | HD", channel: "Film Label", duration: 216, thumbnail: null };

describe("shared recording identity", () => {
  it('rejects the Hola Amigo overdub even with matching original-song Content ID credits',async()=>{
    const catalog={...song,id:'saavn:M4t__2Pc',title:'Hola Amigo',artist:'Umair, KR$NA, Seedhe Maut',artists:[{name:'Umair'},{name:'KR$NA'},{name:'Seedhe Maut'}],duration:226};
    const bad={id:'wEnj5LfAS_0',title:'Hola Amigo - BAN$AL X Seedhe Maut X KR$NA',channel:'BAN$AL',track:'Hola Amigo',artist:'KR$NA, Seedhe Maut, Umair',duration:226,thumbnail:null};
    expect(await matchSource(catalog,bad)).toMatchObject({accepted:false,reason:'additional-performer'});
    expect(await matchSource(catalog,{...bad,id:'g12hFFO6KCI',title:'Hola Amigo',channel:'KR$NA',artist:'KR$NA, Seedhe Maut, Umair'})).toMatchObject({accepted:true});
    expect(await matchSource(catalog,{...bad,title:'Hola Amigo - KR$NA X Seedhe Maut (Official Audio)'})).toMatchObject({accepted:true});
    expect(await matchSource(catalog,{...bad,title:'Seedhe Maut x Kr$na - Hola Amigo || Legacy Performance'})).toMatchObject({accepted:false,reason:'recording-version'});
  });
  it("verifies a complete match before extracting incomplete alternatives", async () => {
    const incomplete = { ...video, id: "incomplete1", duration: null };
    const search = vi.fn().mockResolvedValue([incomplete, video]);
    const verify = vi.fn().mockResolvedValue({ duration: video.duration });
    expect(await resolveCatalogSource(song, search, { verify })).toBe(video);
    expect(search).toHaveBeenCalledTimes(2);
    expect(verify).toHaveBeenCalledExactlyOnceWith(video);
  });
  it("recovers incomplete metadata after a complete candidate fails stream verification", async () => {
    const incomplete = { ...video, id: "incomplete1", duration: null };
    const verify = vi.fn(async (candidate: YtdlpSearchResult) => ({ duration: candidate.id === video.id ? 90 : 216 }));
    expect(await resolveCatalogSource(song, vi.fn().mockResolvedValue([incomplete, { ...video }]), { verify })).toBe(incomplete);
    expect(verify.mock.calls.map(([candidate]) => candidate.id)).toEqual([video.id, incomplete.id]);
  });
  it("does not turn cancelled searches or extractions into new fallback work", async () => {
    const cancelled = Error("Online lookup cancelled.");
    const search = vi.fn().mockRejectedValue(cancelled);
    await expect(resolveCatalogSource(song, search)).rejects.toBe(cancelled);
    expect(search).toHaveBeenCalledTimes(2);
    const verify = vi.fn().mockRejectedValue(cancelled);
    await expect(resolveCatalogSource(song, vi.fn().mockResolvedValue([video, { ...video, id: "incomplete1" }]), { verify })).rejects.toBe(cancelled);
    expect(verify).toHaveBeenCalledTimes(1);
  });
  it("still retries provider failures mentioning a cancelled recording", async () => {
    const search = vi.fn().mockRejectedValueOnce(Error('Video "Cancelled" is unavailable')).mockResolvedValue([video]);
    await expect(resolveCatalogSource(song, search)).resolves.toBe(video);
  });
  it("resolves Claude's Plan from generic Topic search metadata using the recording's verified artist", async () => {
    const catalog = { ...song, title: "Claude's Plan (Lo-fi Version)", artist: "Jallidevs", artists: [{ name: "Jallidevs" }], album: "Claude's Plan (Lo-fi Version)", duration: 149 };
    const candidate = { ...video, id: "Jos0Nzvj-2s", title: catalog.title, channel: "Release - Topic", duration: 150, track: null, artist: null };
    const verify = vi.fn().mockResolvedValue({ track: candidate.title, artist: "Jallidevs", duration: 150 });
    expect(await resolveCatalogSource(catalog, vi.fn().mockResolvedValue([candidate]), { verify })).toBe(candidate);
    expect(verify).toHaveBeenCalledTimes(1);
    expect(candidate.artist).toBe("Jallidevs");
  });
  it.each([
    { artist: "Different performer", duration: 150 },
    { track: "Claude's Plan (Remix)", artist: "Jallidevs", duration: 150 },
    { artist: "Jallidevs", duration: 90 },
    {},
  ])("still rejects generic Topic recordings when extracted metadata is incompatible or incomplete: %j", async details => {
    const catalog = { ...song, title: "Claude's Plan (Lo-fi Version)", artist: "Jallidevs", artists: [], duration: 149 };
    const candidate = { ...video, title: catalog.title, channel: "Release - Topic", duration: 150 };
    await expect(resolveCatalogSource(catalog, vi.fn().mockResolvedValue([candidate]), { verify: vi.fn().mockResolvedValue(details) })).rejects.toThrow("No matching audio source");
  });
  it("avoids extracting generic Topic results with wrong titles, versions, durations or an explicit different artist", async () => {
    const catalog = { ...song, title: "Claude's Plan (Lo-fi Version)", artist: "Jallidevs", artists: [], duration: 149 };
    for (const override of [{ title: "Another song" }, { title: catalog.title + " Remix" }, { duration: 90 }, { artist: "Different performer" }]) {
      const verify = vi.fn();
      await expect(resolveCatalogSource(catalog, vi.fn().mockResolvedValue([{ ...video, title: catalog.title, channel: "Release - Topic", duration: 150, ...override }]), { verify })).rejects.toThrow("No matching audio source");
      expect(verify).not.toHaveBeenCalled();
    }
  });
  it.each([150, null])("bounds missing-artist extraction across all search phases with duration %s", async duration => {
    const catalog = { ...song, title: "Claude's Plan (Lo-fi Version)", artist: "Jallidevs", artists: [], duration: 149 };
    const candidates = Array.from({ length: 10 }, (_, index) => ({ ...video, id: `candidate0${index}`, title: catalog.title, channel: "Release - Topic", duration }));
    const verify = vi.fn().mockResolvedValue({ artist: "Different performer" });
    await expect(resolveCatalogSource(catalog, vi.fn().mockResolvedValue(candidates), { verify })).rejects.toThrow("No matching audio source");
    expect(verify).toHaveBeenCalledTimes(3);
  });
  it.each([
    ["Nee Paartha Vizhigal (The Touch of Love)", "Nee Partha Vizhigal"],
    ["The Rhythm of Love Theme (Theme)", "The Rhythm of Love Theme"],
    ["Po Nee Po (The Pain of Love)", "Po Nee Po"],
    ["Po Nee Po (Remix - The Scream of Love)", "Po Nee Po (Remix)"],
  ])("matches descriptive subtitles without changing catalog metadata: %s", async (title, source) => {
    const catalog = { ...song, title, artist: "Shweta Mohan", artists: [], album: "3", duration: 264 };
    const candidate = { ...video, title: source, channel: "Shweta Mohan", duration: 265 };
    expect(await resolveCatalogSource(catalog, vi.fn().mockResolvedValue([candidate]))).toBe(candidate);
    expect(catalog.title).toBe(title);
  });
  it("finds the live Sony lyric result and still rejects the shortened video", async () => {
    const catalog = { ...song, title: "Nee Paartha Vizhigal (The Touch of Love)", artist: "Anirudh Ravichander, Vijay Yesudas, Shweta Mohan, Dhanush", artists: [], album: "3", duration: 264 };
    const full = { ...video, id: "sZksJJ0169M", title: "3 - Nee Paartha Vizhigal Tamil Lyric | Dhanush, Shruti | Anirudh", channel: "SonyMusicSouthVEVO", duration: 268 };
    expect(await matchSource(catalog, full)).toMatchObject({ accepted: true });
    expect(await matchSource(catalog, { ...full, id: "_IuJsaMqtqc", title: "3 - Nee Paartha Vizhigal Video Song | Dhanush, Shruti | Anirudh Ravichander", duration: 249 })).toMatchObject({ accepted: false, reason: "duration" });
  });
  it("tries subtitle-free searches only after full-title searches fail", async () => {
    const catalog = { ...song, title: "Evening Sky (The Light of Dawn)" };
    const search = vi.fn(async (query: string) => query.includes("Light of Dawn") ? [] : [video]);
    expect(await resolveCatalogSource(catalog, search)).toBe(video);
    expect(search.mock.calls[0][0]).toBe('"Evening Sky (The Light of Dawn)" Writer');
    expect(search.mock.calls.some(([query]) => query === "Evening Sky Writer")).toBe(true);
  });
  it.each(["Live", "Remix", "Reprise", "Instrumental", "Acoustic", "Remastered"])("preserves %s recording identity during subtitle fallback", async version => {
    const original = { ...song, title: "Evening Sky (The Light of Dawn)" };
    const variant = { ...video, title: `Evening Sky (${version}) | Guest` };
    expect(await matchSource(original, variant)).toMatchObject({ accepted: false, reason: "recording-version" });
    expect(await matchSource({ ...song, title: `Evening Sky (${version} - The Light of Dawn)` }, video)).toMatchObject({ accepted: false, reason: "recording-version" });
    expect(await matchSource({ ...song, title: `Evening Sky (${version} - The Light of Dawn)` }, variant)).toMatchObject({ accepted: true });
  });
  it("keeps unknown annotations, unrelated titles, and artist checks", async () => {
    expect(sourceCoreTitle("Evening Sky (Part Two)")).toBe("Evening Sky (Part Two)");
    expect(sourceCoreTitle("Evening Sky (Taylor's Version)")).toBe("Evening Sky (Taylor's Version)");
    const catalog = { ...song, title: "Evening Sky (The Light of Dawn)" };
    expect(await matchSource(catalog, { ...video, title: "Other Song | Guest" })).toMatchObject({ accepted: false, reason: "title" });
    expect(await matchSource(catalog, { ...video, title: "Evening Sky", channel: "Other" })).toMatchObject({ accepted: false, reason: "artist" });
  });
  it("selects the full Tamil lyric recording instead of a shortened music-video edit", async () => {
    const catalog = { ...song, title: "Nenjukkul Peidhidum", artist: "Hariharan, Harris Jayaraj", artists: [], album: "Vaaranam Aayiram", duration: 369 };
    const short = { ...video, id: "FzLpP8VBC6E", title: "Vaaranam Aayiram - Nenjukkul Peidhidum Video Song | Harris Jayaraj | Suriya", duration: 340 };
    const full = { ...video, id: "sy_-_bczxJA", title: "Vaaranam Aayiram - Nenjukkul Peidhidum Tamil Lyric | Harris Jayaraj | Suriya", duration: 371 };
    expect(await matchSource(catalog, short)).toMatchObject({ accepted: false, reason: "duration" });
    expect(await resolveCatalogSource(catalog, vi.fn().mockResolvedValue([short, full]))).toBe(full);
    expect(await matchSource(catalog, { ...full, title: full.title + " | Remix" })).toMatchObject({ accepted: false });
  });
  it("uses credits across the complete title, including label uploads and collaborators", async () => {
    expect(await matchSource(song, video)).toMatchObject({ accepted: true });
    expect(await matchSource({ ...song, artist: "Beyoncé", artists: [] }, { ...video, title: "Evening Sky (Official Audio)", artist: "Beyonce" })).toMatchObject({ accepted: true });
    expect(await matchSource(song, { ...video, title: "A.R. Singer—Evening Sky" })).toMatchObject({ accepted: true });
    expect(await matchSource(song, { ...video, title: "Evening Sky | AR Singer" })).toMatchObject({ accepted: true });
  });
  it.each([
    [{ title: "Evening Sky 2 - Video Song | Guest" }, "title"],
    [{ title: "Evening Sky Remix | Guest" }, "recording-version"],
    [{ title: "Evening Sky Reprise | Guest" }, "recording-version"],
    [{ title: "Evening Sky | Guest reaction" }, "non-music"],
    [{ title: "Evening Sky", channel: "Other" }, "artist"],
    [{ id: "https://example.com" }, "invalid-id"],
    [{ duration: 300 }, "duration"],
  ] as const)("rejects mismatches with a stage reason %j", async (override, reason) => {
    expect(await matchSource(song, { ...video, ...override })).toMatchObject({ accepted: false, reason });
  });
  it("matches one minor long-word spelling difference but keeps short words distinct", async () => {
    expect(await matchSource({ ...song, title: "Moonlight" }, { ...video, title: "Moonlite | Guest" })).toMatchObject({ accepted: false });
    expect(await matchSource({ ...song, title: "Moonlight" }, { ...video, title: "Moonlighht | Guest" })).toMatchObject({ accepted: true });
    expect(await matchSource({ ...song, title: "Moon" }, { ...video, title: "Mood | Guest" })).toMatchObject({ accepted: false });
  });
  it("handles cross-script forms without conflating different native-script words", async () => {
    expect(await matchSource({ ...song, title: "नमस्ते" }, { ...video, title: "Namaste | Guest" })).toMatchObject({ accepted: true });
    expect(await matchSource({ ...song, title: "கூட" }, { ...video, title: "கட | Guest" })).toMatchObject({ accepted: false });
    expect(await matchSource({ ...song, title: "夜に駆ける", artist: "Artist", artists: [] }, { ...video, title: "Artist「夜に駆ける」 Official Music Video" })).toMatchObject({ accepted: true });
  });
  it("requires independent album evidence for abbreviated multi-part artist credits", async () => {
    const catalog = { ...song, artist: "Firstname Middle Lastname", artists: [] };
    expect(await matchSource(catalog, { ...video, title: "Evening Sky - Official Audio Song | Film | Firstname" })).toMatchObject({ accepted: true });
    expect(await matchSource(catalog, { ...video, title: "Evening Sky - Official Audio Song | Firstname" })).toMatchObject({ accepted: false, reason: "artist" });
  });
  it("tries other credible candidates after extraction failure", async () => {
    const second = { ...video, id: "lmnopqrstuv", duration: 218 };
    const verify = vi.fn().mockRejectedValueOnce(Error("private video")).mockResolvedValueOnce(undefined);
    expect(await resolveCatalogSource(song, vi.fn().mockResolvedValue([video, second]), { verify })).toBe(second);
    expect(verify).toHaveBeenCalledTimes(2);
  });
  it("searches collaborators and the album only after initial queries fail to match", async () => {
    const search = vi.fn(async (query: string) => query.includes("Guest") ? [video] : []);
    expect(await resolveCatalogSource(song, search)).toBe(video);
    expect(search.mock.calls.some(([q]) => q === "Evening Sky Guest")).toBe(true);
    expect(search.mock.calls.every(([q]) => !q.includes('From "Film"'))).toBe(true);
  });
  it("uses extracted duration when a flat-search result lacks it", async () => {
    const result = await resolveCatalogSource(song, vi.fn().mockResolvedValue([{ ...video, duration: null }]), { verify: async () => ({ duration: 216 }) });
    expect(result.duration).toBe(216);
  });
  it("reports extraction failures separately from empty successful searches and transport failures", async () => {
    await expect(resolveCatalogSource(song, vi.fn().mockResolvedValue([video]), { verify: async () => { throw Error("403"); } })).rejects.toThrow("stream extraction failed");
    await expect(resolveCatalogSource(song, vi.fn().mockResolvedValue([]))).rejects.toThrow("No matching audio source");
    await expect(resolveCatalogSource(song, vi.fn().mockRejectedValue(Error("Offline")))).rejects.toThrow("Audio search failed");
  });
  it("validates catalog provider identities before searching", async () => {
    const search = vi.fn();
    await expect(resolveCatalogSource({ ...song, id: "saavn:album:123" }, search)).rejects.toThrow("Invalid catalog");
    expect(search).not.toHaveBeenCalled();
    expect(await resolveCatalogSource({ ...song, id: "itunes:42" }, vi.fn().mockResolvedValue([video]))).toBe(video);
  });
});

it('normalizes quoted and unquoted film annotations without confusing song versions or literal From titles', () => {
  expect(sourceTitle('Veezha Veera (From OM Chapter 1_ Udhiram - The Blood Wood) [Tamil]')).toBe('Veezha Veera');
  expect(sourceTitle('Veezha Veera (From "OM Chapter 1: Udhiram - The Blood Wood") [Tamil]')).toBe('Veezha Veera');
  expect(sourceTitle('Veezha Veera (Live) (From OM Chapter 1)')).toBe('Veezha Veera (Live)');
  expect(sourceTitle('From Me To You')).toBe('From Me To You');
});
