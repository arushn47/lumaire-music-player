import { expect, it, vi } from "vitest";
import type { CatalogTrack } from "../adapters/native";
import { searchRetrieval } from "./search-retrieval";
const row = (id: string): CatalogTrack => ({ id, title:"Song", artist:"Artist", artists:[], album:"Album", duration:180 });
it("generates one local Roman recovery for mixed tokens, preserving native query and IDs", async () => {
 const search=vi.fn().mockResolvedValueOnce([row("original")]).mockResolvedValueOnce([row("original"),{...row("recovered"),title:"Kesariya",artist:"Arijit"}]);
 const rows=await searchRetrieval("केसरिया Arijit",20,search);
 expect(search.mock.calls[0][0]).toBe("केसरिया Arijit");
 expect(search.mock.calls[1][0]).toMatch(/kesariya Arijit/i);
 expect(search).toHaveBeenCalledTimes(2);
 expect(rows.map(row=>row.id)).toEqual(["original","recovered"]);
});
it("does not expand dense results or lose successful results on recovery failure", async () => {
 const dense=vi.fn().mockResolvedValue(Array.from({length:5},(_,i)=>row(String(i))));
 await searchRetrieval("केसरिया",20,dense);expect(dense).toHaveBeenCalledTimes(1);
 const failed=vi.fn().mockResolvedValueOnce([row("kept")]).mockRejectedValueOnce(Error("offline"));
 expect((await searchRetrieval("केसरिया",20,failed))[0].id).toBe("kept");
});
it("uses only artist-ID-scoped aliases and refuses homonyms", async () => {
 const id="musicbrainz:artist:11111111-1111-4111-8111-111111111111";
 const source="musicbrainz:recording:11111111-1111-4111-8111-111111111111";
 const sample={...row(source),artists:[{id,name:"Stage Name"}],recordingMetadata:{sourceId:source,isrcs:[],releaseDate:null,artistAliases:{[id]:["Sourced Name"]}}};
 await searchRetrieval("seed",5,vi.fn().mockResolvedValue([sample]));
 const search=vi.fn().mockResolvedValue([]);await searchRetrieval("Sourced Name",20,search);
 expect(search.mock.calls.map(call=>call[0])).toEqual(["Sourced Name","Stage Name"]);
 const second="musicbrainz:artist:22222222-2222-4222-8222-222222222222";
 await searchRetrieval("seed2",5,vi.fn().mockResolvedValue([{...sample,artists:[{id:second,name:"Other"}],recordingMetadata:{...sample.recordingMetadata,artistAliases:{[second]:["Sourced Name"]}}}]));
 search.mockClear();await searchRetrieval("Sourced Name",20,search);expect(search).toHaveBeenCalledTimes(1);
});

it("ignores aliases without matching artist identity or source provenance", async () => {
 const id="musicbrainz:artist:33333333-3333-4333-8333-333333333333";
 const sample={...row("recording"),artists:[{name:"Performer"}],recordingMetadata:{sourceId:"other",isrcs:[],releaseDate:null,artistAliases:{[id]:["Untrusted Alias"]}}};
 await searchRetrieval("seed3",5,vi.fn().mockResolvedValue([sample]));
 const search=vi.fn().mockResolvedValue([]);await searchRetrieval("Untrusted Alias",20,search);expect(search).toHaveBeenCalledTimes(1);
});

const artistId="musicbrainz:artist:44444444-4444-4444-8444-444444444444";
const recordingId="musicbrainz:recording:44444444-4444-4444-8444-444444444444";
const aliasRow:CatalogTrack={...row(recordingId),title:"Evening Song",artist:"Stage Singer",artists:[{id:artistId,name:"Stage Singer"}],recordingMetadata:{sourceId:recordingId,isrcs:[],releaseDate:null,artistAliases:{[artistId]:["Named Performer"]}}};
it("expands an alias phrase within a title query and accepts only the sourced artist ID",async()=>{
 await searchRetrieval("alias seed",20,vi.fn().mockResolvedValue([aliasRow]));
 const wrong={...aliasRow,id:"itunes:999",artists:[{id:"itunes:123",name:"Stage Singer"}]};
 const search=vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([wrong,aliasRow]);
 const results=await searchRetrieval("Evening Song Named Performer",20,search);
 expect(search.mock.calls[1][0]).toBe("evening song Stage Singer");
 expect(results.map(row=>row.id)).toEqual([recordingId]);
});
it("combines native title tokens with a sourced artist alias",async()=>{
 const target={...aliasRow,id:"itunes:444",title:"Kesariya"};
 const search=vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([target]);
 expect(await searchRetrieval("केसरिया Named Performer",20,search)).toEqual([target]);
 expect(search.mock.calls[1][0]).toMatch(/kesariya Stage Singer/i);
});
it("retrieves a known native title from Roman metadata forms without dropping it at the native relevance gate",async()=>{
 const native={...row("itunes:555"),title:"வணக்கம்",artist:"Singer"};
 const saved={...native,fileName:"",missing:false,format:"catalog",metadataSourceId:native.id};
 const search=vi.fn().mockResolvedValueOnce([]).mockImplementation(async query=>query==="வணக்கம் singer"?[native]:[]);
 expect(await searchRetrieval("vanakkam Singer",20,search,{knownTracks:[saved]})).toEqual([native]);
 expect(search.mock.calls.map(call=>call[0])).toEqual(["vanakkam Singer","வணக்கம் singer"]);
});
it("keeps dense unrelated results from hiding an identity-backed recovery and retains separate versions",async()=>{
 const original=Array.from({length:5},(_,i)=>({...row(`itunes:${900+i}`),title:"Other"}));
 const remix={...aliasRow,id:"itunes:777",title:"Evening Song (Remix)"};
 const search=vi.fn().mockResolvedValueOnce(original).mockResolvedValueOnce([aliasRow,remix]);
 const results=await searchRetrieval("Named Performer",5,search);
 expect(results.slice(0,2)).toEqual([aliasRow,remix]);expect(results).toHaveLength(5);
});
it("does not accept unrelated expanded candidates or expand a short substring of an alias",async()=>{
 const search=vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([{...row("itunes:888"),title:"Other"}]);
 expect(await searchRetrieval("केसरिया Arijit",20,search)).toEqual([]);
 const substring=vi.fn().mockResolvedValue([]);await searchRetrieval("Named",20,substring);expect(substring).toHaveBeenCalledTimes(1);
});
it("stops expansion after cancellation and keeps successful originals when a fallback fails",async()=>{
 const controller=new AbortController();
 const cancelled=vi.fn().mockImplementation(async()=>{controller.abort();return []});
 await searchRetrieval("केसरिया",20,cancelled,{signal:controller.signal});expect(cancelled).toHaveBeenCalledTimes(1);
 const failed=vi.fn().mockResolvedValueOnce([row("kept")]).mockRejectedValueOnce(Error("offline"));
 expect(await searchRetrieval("केसरिया Arijit",20,failed)).toEqual([row("kept")]);
});

it("does not let a shorter alias bypass an ambiguous longer artist name",async()=>{
 const a="musicbrainz:artist:55555555-5555-4555-8555-555555555555";
 const b="musicbrainz:artist:66666666-6666-4666-8666-666666666666";
 const seed=(id:string,name:string,aliases:string[]):CatalogTrack=>({...aliasRow,artists:[{id,name}],recordingMetadata:{...aliasRow.recordingMetadata!,artistAliases:{[id]:aliases}}});
 await searchRetrieval("ambiguous seed",20,vi.fn().mockResolvedValue([seed(a,"First",["Long Person","Long"]),seed(b,"Second",["Long Person"])]));
 const search=vi.fn().mockResolvedValue([]);await searchRetrieval("Long Person",20,search);expect(search).toHaveBeenCalledTimes(1);
});
it.each([
 ["नमस्ते","namaste",601], ["வணக்கம்","vanakkam",602], ["నమస్కారం","namaskaram",603],
 ["നമസ്കാരം","namaskaram",604], ["ನಮಸ್ಕಾರ","namaskara",605], ["নমস্কার","namaskara",606],
 ["ਸਤਿ","sati",607], ["નમસ્તે","namaste",608], ["ନମସ୍କାର","namaskara",609],
])("uses saved %s title metadata for Roman/native retrieval without cross-script collisions",async(native,roman,id)=>{
 const target={...row(`itunes:${id}`),title:native,artist:"Fixture Singer"};
 const saved={...target,metadataSourceId:target.id,fileName:"",format:"catalog",missing:false};
 const search=vi.fn().mockResolvedValueOnce([]).mockImplementation(async query=>query===`${native} fixture singer`?[target]:[]);
 const result=await searchRetrieval(`${roman} Fixture Singer`,20,search,{knownTracks:[saved]});
 // When the same Roman form names different native titles, refuse to guess the script.
 if ([604,606,608,609].includes(id)) {
   expect(result).toEqual([]);expect(search).toHaveBeenCalledTimes(1);
 } else { expect(result).toEqual([target]);expect(search).toHaveBeenCalledTimes(2); }
});

it("uses credited artist context to resolve a known Roman-form script collision",async()=>{
 const a={...row("itunes:701"),title:"नमस्ते",artist:"Hindi Singer"};
 const b={...row("itunes:702"),title:"નમસ્તે",artist:"Gujarati Singer"};
 const saved=[a,b].map(row=>({...row,metadataSourceId:row.id,fileName:"",format:"catalog",missing:false}));
 const search=vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([a,b]);
 expect(await searchRetrieval("namaste Gujarati Singer",20,search,{knownTracks:saved})).toEqual([b]);
 expect(search.mock.calls[1][0]).toBe("નમસ્તે gujarati singer");
});

it("publishes only identity-backed artists into the existing artist results",async()=>{
 const artists=vi.fn();const search=vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([aliasRow]);
 await searchRetrieval("Named Performer",20,search,{onExpandedArtists:artists});
 expect(artists).toHaveBeenCalledWith([{id:artistId,name:"Stage Singer",artworkUrl:null}]);
 const rejected=vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([{...aliasRow,artists:[{id:"itunes:1",name:"Stage Singer"}]}]);
 artists.mockClear();await searchRetrieval("Named Performer",20,rejected,{onExpandedArtists:artists});expect(artists).not.toHaveBeenCalled();
});
