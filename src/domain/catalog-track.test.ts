import { describe, expect, it, vi } from "vitest";
import type { CatalogTrack, YtdlpSearchResult } from "../adapters/native";
import { canonicalArtistNames, canonicalTrack, resolveCatalogSource, resolveCatalogSources } from "./catalog-track";
import { youtubeTrack } from "./online-track";

const catalog: CatalogTrack = {
  id: "itunes:123",
  title: "Sensitive",
  artist: "KR$NA, Seedhe Maut",
  artists: [
    { name: "KR$NA", id: null },
    { name: "Seedhe Maut", id: null },
  ],
  album: "Yours Truly",
  duration: 180,
  artworkUrl: "https://is1-ssl.mzstatic.com/cover.jpg",
};
const video: YtdlpSearchResult = {
  id: "abcdefghijk",
  title: "Kr$na - Sensitive Ft. Seedhe Maut (Official Video)",
  channel: "Uploader",
  duration: 190,
  thumbnail: "https://i.ytimg.com/video.jpg",
};

it('collects distinct verified alternatives and rejects mismatched versions',async()=>{
  const good={...video,duration:180,track:'Sensitive',artist:'KR$NA, Seedhe Maut'};
  const search=vi.fn().mockResolvedValue([good,good,{...good,id:'lmnopqrstuv'},{...good,id:'01234567890',title:'Sensitive (Live)'}]);
  const verify=vi.fn().mockResolvedValue({duration:180,track:'Sensitive',artist:'KR$NA, Seedhe Maut'});
  const rows=await resolveCatalogSources(catalog,search,{verify},2);
  expect(rows.map(row=>row.id)).toEqual(['abcdefghijk','lmnopqrstuv']);expect(verify).toHaveBeenCalledTimes(2);
});
it('recovers Naatu Naatu using extracted performer credits, not the uploader name',async()=>{
  const song={...catalog,id:'saavn:-JkPBIE7',title:'Naatu Naatu',artist:'Rahul Sipligunj, Kaala Bhairava',artists:[],duration:214};
  const candidate={id:'AbaAxgufFA8',title:'Naatu Naatu',channel:'Sipligunj’s music',duration:215,thumbnail:null};
  const verify=vi.fn().mockResolvedValue({track:'Naatu Naatu',artist:'Rahul Sipligunj, Kaala Bhairava, M.M. Keeravaani, Chandrabose',duration:214});
  expect((await resolveCatalogSource(song,vi.fn().mockResolvedValue([candidate]),{verify})).id).toBe(candidate.id);
});
it('does not accept a missing-credit upload without confirmed extracted performers and caps preflights',async()=>{
  const candidates=['abcdefghijk','lmnopqrstuv','01234567890','11111111111'].map(id=>({...video,id,title:'Sensitive',channel:'Unrelated uploader',duration:180}));
  const verify=vi.fn().mockResolvedValue({track:'Sensitive',duration:180});
  await expect(resolveCatalogSource(catalog,vi.fn().mockResolvedValue(candidates),{verify})).rejects.toThrow();expect(verify).toHaveBeenCalledTimes(3);
});
it('rejects extracted credits for a different performer even when title and duration match',async()=>{
  const candidate={...video,title:'Sensitive',channel:'Unrelated uploader',duration:180};
  await expect(resolveCatalogSource(catalog,vi.fn().mockResolvedValue([candidate]),{verify:async()=>({track:'Sensitive',artist:'Different Artist',duration:180})})).rejects.toThrow();
});
it('stops chooser discovery when the selection changes during preflight',async()=>{
  let active=true;const good={...video,duration:180,track:'Sensitive',artist:'KR$NA, Seedhe Maut'};
  const search=vi.fn().mockResolvedValue([good,{...good,id:'lmnopqrstuv'}]);
  const verify=vi.fn().mockImplementation(async()=>{active=false;return {};});
  await expect(resolveCatalogSources(catalog,search,{verify,active:()=>active})).rejects.toThrow('Playback selection changed');
  expect(verify).toHaveBeenCalledTimes(1);
});

describe("catalogue metadata and audio sources", () => {
  it('validates MusicBrainz recording identity through the existing source matcher', async () => {
    const recording = { ...catalog, id: 'musicbrainz:recording:c4197d72-b3dd-445f-bdb8-a7f6598b5f74' };
    const search = vi.fn().mockResolvedValue([video]);
    expect((await resolveCatalogSource(recording, search)).id).toBe(video.id);
    await expect(resolveCatalogSource({ ...recording, id: 'musicbrainz:recording:invalid' }, search)).rejects.toThrow('Invalid catalog');
  });
  it("matches alternate titles across label segments with album and abbreviated artist evidence", async () => {
    const song = { ...catalog, title: "Arabic Kuthu - Halamithi Habibo", artist: "Anirudh Ravichander, Jonita Gandhi", artists: [{ name: "Anirudh Ravichander", id: null }, { name: "Jonita Gandhi", id: null }], album: "Beast", duration: 279 };
    const source = { ...video, id: "8FAUEv_E_xQ", title: "Arabic Kuthu | Halamithi Habibo -Lyric Video| Beast| Thalapathy Vijay| Sun Pictures| Nelson| Anirudh", channel: "Sun TV", duration: 283 };
    await expect(resolveCatalogSource(song, vi.fn().mockResolvedValue([source]))).resolves.toBe(source);
    for (const title of [source.title.replace("Beast", "Other Film"), source.title.replace("Anirudh", "Other Artist"), source.title.replace("Halamithi Habibo", "Other Song"), source.title + " | Live", source.title + " | Remix"]) {
      await expect(resolveCatalogSource(song, vi.fn().mockResolvedValue([{ ...source, title }]))).rejects.toThrow("No matching audio source");
    }
  });
  it("matches Machayenge's attached artist separator and producer credit", async () => {
    const source = { ...video, title: "EMIWAY- MACHAYENGE  (PROD BY.TONY JAMES)", channel: "Emiway Bantai", duration: 181 };
    await expect(resolveCatalogSource({ ...catalog, title: "Machayenge", artist: "Emiway Bantai", duration: 152 }, vi.fn().mockResolvedValue([source]))).resolves.toBe(source);
  });
  it("allows a bounded video intro only with matching artist channel and exact recording", async () => {
    const song = { ...catalog, title: "Firse Machayenge", artist: "Emiway Bantai", duration: 207 };
    const source = { ...video, title: "EMIWAY - FIRSE MACHAYENGE (OFFICIAL MUSIC VIDEO)", channel: "Emiway Bantai", duration: 243 };
    await expect(resolveCatalogSource(song, vi.fn().mockResolvedValue([source]))).resolves.toBe(source);
    for (const override of [{ channel: "Unrelated" }, { duration: 300 }, { title: "EMIWAY - FIRSE MACHAYENGE REMIX (OFFICIAL MUSIC VIDEO)" }, { title: "EMIWAY - MACHAYENGE 3 (OFFICIAL MUSIC VIDEO)" }]) {
      await expect(resolveCatalogSource(song, vi.fn().mockResolvedValue([{ ...source, ...override }]))).rejects.toThrow("No matching audio source");
    }
  });
  it("uses the verified artist identity for names and preserves collaborations on errors", async () => {
    const lookup = vi.fn(async (id: string) => ({ id, name: "Emiway Bantai" }));
    const track = { ...catalog, artists: [{ name: "Emiway", id: "itunes:42" }, { name: "Guest", id: null }] };
    expect(await canonicalArtistNames(track, lookup)).toBe("Emiway Bantai, Guest");
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(await canonicalArtistNames(track, async () => ({ id: "itunes:99", name: "Unrelated" }))).toBe("Emiway Bantai, Guest");
    expect(await canonicalArtistNames(track, async () => { throw Error("Offline"); })).toBe("Emiway Bantai, Guest");
  });
  it("keeps Saavn catalogue provenance distinct from the YouTube audio source", () => {
    const saavn = { ...catalog, id: "saavn:QAbmbZ7O" };
    expect(canonicalTrack(saavn, video)).toMatchObject({
      id: "youtube:abcdefghijk",
      metadataSourceId: saavn.id,
      title: saavn.title,
      artist: saavn.artist,
      album: saavn.album,
      duration: saavn.duration,
      artworkUrl: saavn.artworkUrl,
      source: { providerId: "youtube", sourceId: video.id },
    });
  });
  it("keeps catalogue metadata intact while retaining the selected audio identity", () => {
    const resolved = canonicalTrack(catalog, {
      ...video,
      track: "Other title",
      artist: "Other credit",
      album: "Other album",
    });
    expect(resolved).toMatchObject({
      id: "youtube:abcdefghijk",
      title: catalog.title,
      artist: catalog.artist,
      album: catalog.album,
      duration: catalog.duration,
      artworkUrl: catalog.artworkUrl,
      metadataSourceId: catalog.id,
    });
    expect(resolved.source).toEqual(youtubeTrack(video).source);
    expect(JSON.stringify(resolved)).not.toContain("streamUrl");
    expect(
      canonicalTrack({ ...catalog, artworkUrl: null }, video).artworkUrl,
    ).toBeNull();
  });
  it("preserves existing flags only when the selected audio identity is unchanged", () => {
    const existing = {
      ...youtubeTrack(video),
      offline: true,
      missing: true,
      format: "MP4",
    };
    expect(canonicalTrack(catalog, video, existing)).toMatchObject({
      offline: true,
      missing: true,
      format: "MP4",
    });
    expect(
      canonicalTrack(catalog, { ...video, id: "lmnopqrstuv" }, existing),
    ).toMatchObject({ id: "youtube:lmnopqrstuv", missing: false });
    expect(
      canonicalTrack(catalog, { ...video, id: "lmnopqrstuv" }, existing)
        .offline,
    ).toBeUndefined();
  });
  it.each([0, 1])(
    "searches quoted and plain credits and survives either failed search (%i)",
    async (failed) => {
      const search = vi
        .fn()
        .mockImplementation((_query, _limit) =>
          search.mock.calls.length - 1 === failed
            ? Promise.reject(Error("Offline"))
            : Promise.resolve([video]),
        );
      await expect(resolveCatalogSource(catalog, search)).resolves.toBe(video);
      expect(search.mock.calls).toEqual([
        [`"Sensitive" KR$NA`, 15, true],
        ["Sensitive KR$NA", 15, true],
      ]);
    },
  );
  it("merges duplicate searches, rejects malformed IDs and chooses the closest duration", async () => {
    const closest = { ...video, id: "lmnopqrstuv", duration: 182 };
    const search = vi
      .fn()
      .mockResolvedValueOnce([{ ...video, id: "bad" }, video])
      .mockResolvedValueOnce([video, closest]);
    await expect(resolveCatalogSource(catalog, search)).resolves.toBe(closest);
  });
  it("matches structured credits and Latin diacritics without changing Indic words", async () => {
    await expect(
      resolveCatalogSource(
        { ...catalog, title: "Été", artist: "Beyoncé" },
        vi.fn().mockResolvedValue([
          {
            ...video,
            title: "A source upload",
            track: "Ete",
            artist: "Beyonce",
          },
        ]),
      ),
    ).resolves.toHaveProperty("id", video.id);
    await expect(
      resolveCatalogSource(
        { ...catalog, title: "கூட", artist: "Singer" },
        vi.fn().mockResolvedValue([{ ...video, title: "Singer - கட" }]),
      ),
    ).rejects.toThrow("No matching audio source");
  });
  it.each([
    { title: "Other artist - Sensitive" },
    { title: "Kr$na - Unrelated song" },
    { duration: 250 },
    { duration: null },
    { duration: Number.NaN },
    { title: "Kr$na - Sensitive (Cover)" },
    { title: "Kr$na - Sensitive (Remix)" },
    { title: "Kr$na - Sensitive (Live)" },
    { title: "Kr$na - Sensitive (Slowed)" },
    { title: "Kr$na - Sensitive (Sped up)" },
    { title: "Sensitive", channel: "Unrelated uploader" },
  ])("rejects an untrustworthy source %j", async (overrides) => {
    await expect(
      resolveCatalogSource(
        catalog,
        vi.fn().mockResolvedValue([{ ...video, ...overrides }]),
      ),
    ).rejects.toThrow("No matching audio source");
  });
  it("accepts the requested recording version and official-video intros", async () => {
    const live = {
      ...video,
      title: "Kr$na - Sensitive (Live) (Official Audio)",
      duration: 209,
    };
    await expect(
      resolveCatalogSource(
        { ...catalog, title: "Sensitive (Live)" },
        vi.fn().mockResolvedValue([live]),
      ),
    ).resolves.toBe(live);
  });
  it("reports failure when neither search can provide a matching source", async () => {
    await expect(
      resolveCatalogSource(
        catalog,
        vi.fn().mockRejectedValue(Error("Offline")),
      ),
    ).rejects.toThrow("Audio search failed");
  });
});
