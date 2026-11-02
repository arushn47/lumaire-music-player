import {beforeEach,expect,it,vi} from 'vitest';
import {defaults,type Session,type Track} from '../domain/types';
const bridge=vi.hoisted(()=>({save:vi.fn(),prepare:vi.fn(),player:{state:{trackId:'youtube:01234567890',playbackId:'play-1',status:'paused',time:37,autoplay:true},startQueue:vi.fn()}}));
vi.mock('react',async original=>({...await original<typeof import('react')>(),useEffect:()=>{},useRef:(value:unknown)=>({current:value}),useState:(value:unknown)=>[value,vi.fn()]}));
vi.mock('./useTaskbarControls',()=>({useTaskbarControls:()=>{}}));
vi.mock('../adapters/native',()=>({mobile:true,library:{setVerifiedSource:bridge.save}}));
vi.mock('../adapters/autoplay',()=>({loadAutoplayPool:vi.fn()}));
vi.mock('../adapters/discovery-home',()=>({discoveryPreferences:()=>({languages:['english']})}));
vi.mock('../player/listening-service',()=>({nativeListeningHandoff:()=>null}));
vi.mock('../player/service',()=>({player:bridge.player,playbackTracks:new Map(),prepareCatalogCandidate:bridge.prepare}));
import {usePlayback} from './usePlayback';
const catalog={id:'itunes:42',title:'Evening Sky',artist:'Singer',artists:[],album:'Album',duration:180};
const source={id:'abcdefghijk',title:'Singer - Evening Sky',channel:'Singer',duration:180,thumbnail:null};
const old:Track={id:'youtube:01234567890',metadataSourceId:catalog.id,title:catalog.title,artist:catalog.artist,album:catalog.album,duration:180,format:'webm',fileName:'',missing:false};
beforeEach(()=>{vi.clearAllMocks();Object.assign(bridge.player.state,{trackId:old.id,playbackId:'play-1',status:'paused',time:37,autoplay:true});bridge.prepare.mockResolvedValue({duration:180,track:catalog.title,artist:catalog.artist});bridge.save.mockResolvedValue(undefined);});
function setup(){
 const ref={current:{...defaults(),queue:[{id:'chosen',trackId:old.id},{id:'other',trackId:old.id}],currentId:'chosen',queueTracks:{[old.id]:old},favorites:[old.id]} as Session};
 const initial=structuredClone(ref.current);
 const hook=usePlayback({session:ref.current,sessionRef:ref,tracksRef:{current:[old]},tracks:[old],update:fn=>{ref.current=fn(ref.current);},resolveQueuedTrack:vi.fn(),view:'home',dialogOpen:false,setView:vi.fn(),notify:vi.fn(),persist:vi.fn()});
 return {ref,initial,hook};
}
it('changes only the selected queue occurrence and preserves pause, position, saved identity and favorites',async()=>{
 const {ref,initial,hook}=setup();await hook.chooseRecording(catalog,source,'chosen');
 expect(bridge.save).toHaveBeenCalledWith(catalog.id,expect.objectContaining({sourceId:source.id,userSelected:true}));
 expect(ref.current.queue).toEqual([{id:'chosen',trackId:'youtube:abcdefghijk'},{id:'other',trackId:old.id}]);
 expect(ref.current.favorites).toEqual(initial.favorites);expect(old.id).toBe('youtube:01234567890');
 expect(bridge.player.startQueue).toHaveBeenCalledWith(expect.anything(),false,37);
});
it('does not persist or take over playback after selection changes during verification',async()=>{
 const {hook}=setup();bridge.prepare.mockImplementation(async()=>{bridge.player.state.playbackId='another-selection';return {};});
 await expect(hook.chooseRecording(catalog,source,'chosen')).rejects.toThrow('Playback selection changed');
 expect(bridge.save).not.toHaveBeenCalled();expect(bridge.player.startQueue).not.toHaveBeenCalled();
});
it('leaves queue and playback intact when persistence fails',async()=>{
 const {ref,initial,hook}=setup();bridge.save.mockRejectedValue(Error('Disk full'));
 await expect(hook.chooseRecording(catalog,source,'chosen')).rejects.toThrow('Disk full');
 expect(ref.current).toEqual(initial);expect(bridge.player.startQueue).not.toHaveBeenCalled();
});

