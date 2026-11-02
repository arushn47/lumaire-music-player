import {expect,it} from 'vitest';
import {fillTrackMetadata,recordingMetadata} from './metadata-enrichment';
import {catalogQueueTrack,canonicalTrack} from './catalog-track';
import {restoreSession} from './session';
import {portableTrack} from './nearby';
import {defaults,type Track} from './types';
const extra={sourceId:'itunes:42',isrcs:['USABC2412345'],releaseDate:'2024-02-29',artistAliases:{'musicbrainz:artist:46579862-aa41-4574-b16c-05e6d0b6dbeb':['गायक','பாடகர்']}};
const base:Track={id:'youtube:abcdefghijk',metadataSourceId:'itunes:42',title:'Corrected தமிழ்',artist:'Singer & Guest',album:'My album',duration:177,fileName:'',format:'YouTube',missing:false};
it('fills gaps without overwriting corrections, collaborators, duration, or recording metadata',()=>{
 const proposed={...base,title:'Wrong version',artist:'Other',album:'Compilation',duration:200,recordingMetadata:extra};
 expect(fillTrackMetadata(base,proposed)).toMatchObject({...base,recordingMetadata:extra});
 const changed={...base,title:'New correction',recordingMetadata:{...extra,releaseDate:'2020'}};
 expect(fillTrackMetadata(changed,proposed)).toEqual(changed);
 expect(fillTrackMetadata({...base,album:''},proposed).album).toBe('Compilation');
 expect(fillTrackMetadata({...base,album:''},proposed,base).album).toBe('');
 expect(fillTrackMetadata(base,{...proposed,recordingMetadata:{...extra,sourceId:'itunes:99'}}).recordingMetadata).toBeUndefined();
});
it('rejects invalid identifiers, dates and unbounded aliases without inventing missing IDs',()=>{
 expect(recordingMetadata(extra)).toEqual(extra);
 for(const bad of [{...extra,isrcs:['bad']},{...extra,releaseDate:'2023-02-29'},{...extra,artistAliases:{unknown:['Singer']}},{...extra,sourceId:'file:///private'}])expect(recordingMetadata(bad)).toBeUndefined();
});
it('propagates optional data through catalogue queues and portable session restoration',()=>{
 const catalog={id:'itunes:42',title:'தமிழ்',artist:'Singer',artists:[],album:'Album',duration:177,recordingMetadata:extra};
 const queued=catalogQueueTrack(catalog);
 expect(queued.recordingMetadata).toEqual(extra);
 const session={...defaults(),queue:[{id:'one',trackId:queued.id}],queueTracks:{[queued.id]:queued}};
 expect(restoreSession(session,[]).queueTracks[queued.id].recordingMetadata).toEqual(extra);
 expect(portableTrack(queued)?.recordingMetadata).toEqual(extra);
 expect(canonicalTrack(catalog,{id:'abcdefghijk',title:'தமிழ்',channel:'Singer',duration:177,thumbnail:null}).recordingMetadata).toEqual(extra);
 const corrected={...base,recordingMetadata:{...extra,releaseDate:'2020'}};
 expect(canonicalTrack(catalog,{id:'abcdefghijk',title:'தமிழ்',channel:'Singer',duration:177,thumbnail:null},corrected).recordingMetadata?.releaseDate).toBe('2020');
});
