import { expect, it, vi } from "vitest";
import type { CatalogTrack } from "../adapters/native";
import { searchRetrieval } from "./search-retrieval";
const row = (id: string): CatalogTrack => ({ id, title:"Song", artist:"Artist", artists:[], album:"Album", duration:180 });
it("generates one local Roman recovery for mixed tokens, preserving native query and IDs", async () => {
 const search=vi.fn().mockResolvedValueOnce([row("original")]).mockResolvedValueOnce([row("original"),row("recovered")]);
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
