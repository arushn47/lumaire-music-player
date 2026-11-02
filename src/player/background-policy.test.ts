import { expect, it, vi } from 'vitest';
import { defaults, type Track } from '../domain/types';
import { backgroundNext, type BackgroundLibrary, type BackgroundQueue } from './background-policy';
import { catalogQueueTrack } from '../domain/catalog-track';
import type { CatalogTrack } from '../adapters/native';

const song = (id: string): Track => ({ id, title: id, artist: 'Artist', album: 'Album', duration: 180, fileName: id, format: 'wav', missing: false });
const a = song('a'), b = song('b'), c = song('c');
const fixture = (): BackgroundQueue => ({ session: { ...defaults(), queue: [a,b,c].map(track => ({ id: `entry-${track.id}`, trackId: track.id })), currentId: 'entry-a' }, tracks: [a,b,c], records: [], languages: ['english'] });
const library = (): BackgroundLibrary => ({ lookup: vi.fn(), autoplayPool: vi.fn().mockResolvedValue({candidates:[],metadata:[]}), search: vi.fn(), resolve: vi.fn(), verified: vi.fn().mockResolvedValue(null), remember: vi.fn() });

it('advances a native-owned queue without browser callbacks or online resolution for local files', async () => {
  const api = library(), input = fixture();
  const next = await backgroundNext(input, api);
  expect(next?.track.id).toBe('b');
  expect(next?.queue.session.currentId).toBe('entry-b');
  expect(input.session.currentId).toBe('entry-a');
  expect(api.lookup).not.toHaveBeenCalled();
});
it('keeps a linked local file local even when it has catalogue metadata and a preferred stream',async()=>{
  const input=fixture(),api=library();input.tracks[1]={...b,metadataSourceId:'itunes:42'};
  vi.mocked(api.verified).mockResolvedValue({id:'abcdefghijk',title:'b',channel:'Artist',duration:180,thumbnail:null,userSelected:true});
  expect((await backgroundNext(input,api))?.track.id).toBe(b.id);expect(api.verified).not.toHaveBeenCalled();
});
it('uses the saved shuffle order and skips missing entries', async () => {
  const input = fixture(); input.session.settings.shuffle = true;
  input.session.shuffleOrder = ['entry-a','entry-c','entry-b'];
  expect((await backgroundNext(input, library()))?.track.id).toBe('c');
  input.tracks = [a,b,{...c,missing:true}];
  expect((await backgroundNext(input, library()))?.track.id).toBe('b');
});
it('owns the initial selection and resume position before any song has started', async () => {
  const input = fixture(); input.session.position = 17;
  const selected = await backgroundNext(input,library(),0,false);
  expect(selected?.track.id).toBe('a');
  expect(selected?.queue.session.position).toBe(17);
});
it('distinguishes repeat-one completion from an explicit Next command', async () => {
  const input = fixture(); input.session.settings.repeat = 'one';
  expect((await backgroundNext(input, library()))?.track.id).toBe('a');
  expect((await backgroundNext(input, library(),1,false))?.track.id).toBe('b');
});
it('stops at the end unless repeat-all or Autoplay is enabled', async () => {
  const input = fixture(), api = library(); input.session.currentId = 'entry-c';
  expect(await backgroundNext(input, api)).toBeNull();
  expect(api.autoplayPool).not.toHaveBeenCalled();
  input.session.settings.repeat = 'all';
  expect((await backgroundNext(input,api))?.track.id).toBe('a');
});
it('terminates a repeat-all queue containing only unavailable items', async () => {
  const input = fixture(); input.session.settings.repeat = 'all';
  input.tracks = [a,b,c].map(track => ({...track,missing:true}));
  await expect(backgroundNext(input,library())).rejects.toThrow('No queued audio');
});

const catalog: CatalogTrack = {id:'itunes:42',title:'Evening Sky',artist:'Singer',artists:[],album:'New Album',duration:180,language:'english'};
const source={id:'abcdefghijk',title:'Evening Sky',channel:'Singer - Topic',duration:180,thumbnail:null};
it('rejects canonical labels hiding the Hola Amigo overdub in a native queue',async()=>{
  const input=fixture(),api=library();const catalog={id:'saavn:M4t__2Pc',title:'Hola Amigo',artist:'Umair, KR$NA, Seedhe Maut',artists:[],album:'Album',duration:226};
  const old={...catalogQueueTrack(catalog),id:'youtube:wEnj5LfAS_0',format:'webm'};
  input.session.queueTracks[old.id]=old;input.session.queue[0].trackId=old.id;input.session.position=37;
  vi.mocked(api.lookup).mockResolvedValue(catalog);vi.mocked(api.resolve).mockImplementation(async id=>({title:id==='wEnj5LfAS_0'?'Hola Amigo - BAN$AL X Seedhe Maut X KR$NA':'Hola Amigo',track:'Hola Amigo',artist:catalog.artist,duration:226}));
  vi.mocked(api.search).mockResolvedValue([{id:'g12hFFO6KCI',title:'Hola Amigo',channel:'KR$NA',artist:catalog.artist,duration:226,thumbnail:null}]);
  const next=await backgroundNext(input,api,0,false);expect(next?.track.id).toBe('youtube:g12hFFO6KCI');expect(next?.queue.session.currentId).toBe('entry-a');expect(next?.queue.session.position).toBe(37);
});
it('rechecks a user-selected source for an already resolved saved track',async()=>{
  const input=fixture(),api=library();const saved={...catalogQueueTrack(catalog),id:'youtube:oldsource01',format:'webm'};
  input.session.queueTracks[saved.id]=saved;input.session.queue[0].trackId=saved.id;
  vi.mocked(api.verified).mockResolvedValue({...source,userSelected:true});vi.mocked(api.lookup).mockResolvedValue(catalog);
  vi.mocked(api.resolve).mockResolvedValue({track:catalog.title,artist:'Singer',duration:180});
  const next=await backgroundNext(input,api,0,false);expect(next?.track.id).toBe('youtube:abcdefghijk');expect(api.search).not.toHaveBeenCalled();
});
it('rejects a preferred wrong version and recovers with a verified alternative',async()=>{
  const input=fixture(),api=library();const saved={...catalogQueueTrack(catalog),id:'youtube:oldsource01',format:'webm'};
  input.session.queueTracks[saved.id]=saved;input.session.queue[0].trackId=saved.id;
  vi.mocked(api.verified).mockResolvedValue({...source,id:'oldsource01',title:'Evening Sky (Live)',userSelected:true});vi.mocked(api.lookup).mockResolvedValue(catalog);
  vi.mocked(api.resolve).mockResolvedValue({track:catalog.title,artist:'Singer',duration:180});vi.mocked(api.search).mockResolvedValue([source]);
  expect((await backgroundNext(input,api,0,false))?.track.id).toBe('youtube:abcdefghijk');expect(api.remember).toHaveBeenCalledWith(catalog.id,expect.objectContaining({id:source.id}));
});
it('replaces a refused canonical recording without retrying it or changing the queue occurrence and resume position',async()=>{
  const input=fixture(),api=library();
  const old={...catalogQueueTrack(catalog),id:'youtube:oldsource01',format:'webm'};
  input.session.queueTracks[old.id]=old;input.session.queue[0].trackId=old.id;input.session.position=37;
  input.failedSources=['oldsource01'];
  vi.mocked(api.lookup).mockResolvedValue(catalog);
  vi.mocked(api.verified).mockResolvedValue({...source,id:'oldsource01'});
  vi.mocked(api.search).mockResolvedValue([{...source,id:'oldsource01'},{...source,id:'wronglive01',title:'Evening Sky (Live)'},source]);
  vi.mocked(api.resolve).mockResolvedValue({track:source.title,artist:'Singer',duration:180});
  const next=await backgroundNext(input,api,0,false);
  expect(next?.track.id).toBe('youtube:abcdefghijk');
  expect(next?.queue.session.currentId).toBe('entry-a');expect(next?.queue.session.position).toBe(37);
  expect(api.resolve).not.toHaveBeenCalledWith('oldsource01');expect(api.resolve).not.toHaveBeenCalledWith('wronglive01');
});
it('retains strict source verification when an old mapping points at the wrong recording', async()=>{
  const input=fixture(),api=library();input.session.queueTracks[catalog.id]=catalogQueueTrack(catalog);input.session.queue[1].trackId=catalog.id;
  vi.mocked(api.lookup).mockResolvedValue(catalog);
  vi.mocked(api.verified).mockResolvedValue({...source,id:'cachedwrong',title:'Another song'});
  vi.mocked(api.resolve).mockImplementation(async id=>({track:id==='cachedwrong'?'Another song':'Evening Sky',artist:'Singer',duration:180}));
  vi.mocked(api.search).mockResolvedValue([source]);
  const next=await backgroundNext(input,api);
  expect(next?.track.id).toBe('youtube:abcdefghijk');
  expect(next?.track.metadataSourceId).toBe(catalog.id);
  expect(api.remember).toHaveBeenCalledWith(catalog.id,expect.objectContaining({id:source.id}));
});
it('uses an existing offline copy for a queued catalogue item without contacting providers', async()=>{
  const input=fixture(),api=library(),offline={...b,offline:true,metadataSourceId:catalog.id};
  input.tracks=[a,offline,c];input.session.queueTracks[catalog.id]=catalogQueueTrack(catalog);input.session.queue[1].trackId=catalog.id;
  expect((await backgroundNext(input,api))?.track).toEqual(offline);
  expect(api.lookup).not.toHaveBeenCalled();
});
it('keeps Autoplay in the original language and verifies the recommendation before appending it', async()=>{
  const input=fixture(),api=library();input.session.currentId='entry-c';input.session.settings.autoplay=true;
  const seed={...catalog,id:'itunes:1',title:'c',artist:'Artist',album:'Album'};
  vi.mocked(api.autoplayPool).mockResolvedValue({metadata:[seed],candidates:[{track:{...catalog,id:'itunes:43',language:'tamil'},position:0,sources:['anchor']},{track:catalog,position:1,sources:['anchor']}]});
  vi.mocked(api.lookup).mockResolvedValue(catalog);vi.mocked(api.search).mockResolvedValue([source]);vi.mocked(api.resolve).mockResolvedValue({track:source.title,artist:'Singer',duration:180});
  const next=await backgroundNext(input,api);
  expect(next?.track.metadataSourceId).toBe(catalog.id);
  expect(api.lookup).not.toHaveBeenCalledWith('itunes:43');
  expect(next?.queue.anchor?.id).toBe(c.id);
  expect(next?.queue.session.queue).toHaveLength(4);
});
