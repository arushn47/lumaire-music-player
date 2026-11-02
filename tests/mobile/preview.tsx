import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { MobileTabBar } from '/src/components/common/MobileTabBar';
import { Sidebar } from '/src/components/sidebar/Sidebar';
import { DiscoveryHome } from '/src/components/views/DiscoveryHome';
import { DiscoveryView, initialDiscoveryViewState } from '/src/components/views/DiscoveryView';
import { HistoryView } from '/src/components/views/HistoryView';
import { CollectionHub } from '/src/components/views/CollectionHub';
import { QueuePanel } from '/src/components/queue/QueuePanel';
import { reorderUpcoming } from '/src/domain/queue';
import { LibraryView } from '/src/components/views/LibraryView';
import { SettingsView } from '/src/components/views/SettingsView';
import { ExpandedPlayer } from '/src/components/player/ExpandedPlayer';
import { useExpandedLayout } from '/src/hooks/useExpandedLayout';
import { usePlayerHistory } from '/src/hooks/usePlayerHistory';
import { MobileNowPlaying } from '/src/components/player/MobileNowPlaying';
import { PlayerBar } from '/src/components/player/PlayerBar';
import { SaveToPlaylistModal } from '/src/components/modals/SaveToPlaylistModal';
import { useClickOutsideMenus } from '/src/hooks/useClickOutsideMenus';
import { defaults } from '/src/domain/types';
import { initializeTheme } from '/src/theme';
import '/src/style.css';
initializeTheme();
const noop=(value)=>{if(value===1||value===-1)window.lastSkip=value;};
const tracks=[1,2,3].map(i=>({id:'t'+i,title:'Song '+i+' with a longer title',artist:'Artist '+i,album:'Album '+i,duration:220,fileName:'song.mp3',format:'MP3',missing:false}));
const seed=defaults();seed.queue=tracks.map((t,i)=>({id:'q'+i,trackId:t.id}));seed.currentId='q0';seed.favorites=tracks.map(t=>t.id);seed.playlists=[{id:'p1',name:'Evening listening',items:tracks.map((t,i)=>({id:'p'+i,trackId:t.id}))}];
seed.favoriteAlbums=[{id:'a1',title:'A saved album',artist:'An artist'}];seed.favoriteArtists=[{id:'a2',name:'A saved artist'}];
function Preview(){
 const [view,setView]=useState('library'),[session,setSession]=useState(seed),[expanded,setExpanded]=useState(false),[queueTab,setQueueTab]=useState(false),[query,setQuery]=useState(''),[tick,setTick]=useState(0),[dialog,setDialog]=useState(false),[hub,setHub]=useState(false);
 const [playing,setPlaying]=useState(false);
 const expandedLayout=useExpandedLayout();
 const closePlayer=useCallback(()=>setExpanded(false),[]);usePlayerHistory(expanded,closePlayer);
 const dialogRef=useRef(null);useClickOutsideMenus();
 window.fixtureQueue=session.queue.map(entry=>entry.trackId);
 const reorder=(id,delta)=>setSession(s=>reorderUpcoming(s,id,delta));
 useEffect(()=>{const id=setInterval(()=>setTick(t=>t+1),300);return()=>clearInterval(id)},[]);
 useEffect(()=>{if(dialog)dialogRef.current?.showModal();else dialogRef.current?.close()},[dialog]);
 const playback={status:playing?'playing':'paused',time:20+tick,duration:220};
 const setSetting=(key,value)=>setSession(s=>({...s,settings:{...s.settings,[key]:value}}));
 const rowProps={tracks,visible:tracks,rows:tracks.map(t=>({t,entryId:t.id})),currentTrack:tracks[0],playbackStatus:'paused',session,downloads:{},collections:[{id:'p1',name:'Evening listening',tracks,playlist:session.playlists[0]}],query,busy:false,mobile:true,desktop:true,onSetQuery:setQuery,onSelectView:setView,onPlayAll:noop,onPlayTrackInList:noop,onImportMusic:noop,onFavorite:noop,onRemoveTrack:noop,onDownloadTrack:noop,onDeleteOffline:noop,onQueueTrack:noop,onRelinkTrack:noop,onChoosePlaylist:()=>setDialog(true),onOpenImport:noop,onCreatePlaylist:noop};
 return <div className={'app '+(matchMedia('(pointer: coarse)').matches||innerWidth<769?'android':'with-queue')}>
 <Sidebar view={view} setView={setView} onHome={()=>setView('home')} onOpenSync={()=>setHub(true)} collectionsCount={1} playlists={session.playlists} collections={rowProps.collections} hasLyricsDoc={true} onCreatePlaylist={noop} onToggleQueue={()=>{setQueueTab(true);setExpanded(true)}}/>
 <div className="workspace"><main id="main">
 {view==='history'?<HistoryView records={tracks.map((track,i)=>({id:'r'+i,trackId:track.id,title:track.title,artist:track.artist,album:track.album,artworkUrl:null,providerId:null,sourceId:null,startedAt:Date.now()-100000,updatedAt:Date.now(),listenedMs:100000,days:{[new Date().toISOString().slice(0,10)]:100000}}))} loading={false} error='' mobile enabled favorites={session.favorites} onReplay={noop} onQueue={noop} onFavorite={noop} onRefresh={noop}/>:view==='lyrics'?<div className="lyric-room"><div className="lyric-lines"><button className="lyric-line is-active"><span className="lyric-primary">A short active line</span><span className="lyric-translation">A translation line</span></button><button className="lyric-line"><span className="lyric-primary">Another readable line</span></button></div></div>:view==='home'?<DiscoveryHome mobile records={[]} savedTracks={tracks} onlineAvailable={false} onPlayQuickPick={noop} />:(view==='discover'||view==='search')?<DiscoveryView {...rowProps} savedTracks={tracks} favorites={session.favorites} recentRecords={[]} historyEnabled={true} onReplay={noop} onSaveCommons={noop} onQueueRemote={noop} onOpenLibrary={noop} state={{...initialDiscoveryViewState(), ...(location.search.includes('search')?{query:'h',searchedQuery:'h',results:tracks.map(t=>({...t,artworkUrl:'/featured-hero.jpg'}))}:{})}} onStateChange={noop} ytdlpAvailable={true} engineState='installed' onSaveDiscovery={noop} onCatalogAction={noop} onPlayCollection={noop} onPlayAlbum={noop} onLoadingChange={noop} />:view==='settings'?<SettingsView session={session} tracks={tracks} downloads={{}} busy={false} mobile={true} ytdlpAvailable={true} engineState="installed" onRefreshYoutubeEngine={async()=>{}} onInstallYoutubeEngine={noop} onCancelYoutubeEngineInstall={noop} onSetting={setSetting} onExportLibrary={noop} onImportBackup={noop} onClearHistory={noop} onClearLyricCache={noop} onCancelDownload={noop} onRetryDownload={noop} onDeleteOffline={noop}/>:<LibraryView {...rowProps} view={view==='p1'?'p1':view} heading={view} playlist={view==='p1'?session.playlists[0]:undefined}/>}
 </main></div>
 {!expanded&&<PlayerBar track={tracks[0]} tracks={tracks} playback={playback} session={session} downloads={{}} busy={false} view={view} setView={setView} mobile={true} onExpand={()=>{setQueueTab(false);setExpanded(true)}} onSeek={s=>window.lastSeek=s} onTogglePlay={()=>{window.lastToggle=true;setPlaying(value=>!value)}} onSkip={noop} onFavorite={id=>setSession(s=>({...s,favorites:s.favorites.includes(id)?s.favorites.filter(f=>f!==id):[...s.favorites,id]}))} onChoosePlaylist={()=>setDialog(true)} onDownloadTrack={noop} onDeleteOffline={noop} onSaveOnline={noop} onCancelDownload={noop} onSetting={setSetting}/>}
 {expanded&&expandedLayout&&<ExpandedPlayer controls={<PlayerBar track={tracks[0]} tracks={tracks} playback={playback} session={session} downloads={{}} mobile onSetting={setSetting} onTogglePlay={()=>{window.lastToggle=true;setPlaying(value=>!value)}} onSkip={noop} onSeek={s=>window.lastSeek=s} onFavorite={noop}/>} lyrics={<div className="lyric-room"><div className="lyric-lines"><button className="lyric-line is-active"><span className="lyric-primary">A short active line</span></button></div></div>} doc={{lines:[{text:'A short active line',time:0}]}} onClose={closePlayer} follow setFollow={noop} canFollow={false} translateLyrics={async()=>{}}/>}
 {expanded&&!expandedLayout&&<MobileNowPlaying manageHistory={false} initialTab={queueTab?'queue':'player'} track={tracks[0]} tracks={tracks} playback={playback} session={session} onClose={()=>setExpanded(false)} onTogglePlay={()=>{window.lastToggle=true;setPlaying(value=>!value)}} onSkip={noop} onSeek={s=>window.lastSeek=s} onFavorite={id=>setSession(s=>({...s,favorites:s.favorites.includes(id)?s.favorites.filter(f=>f!==id):[...s.favorites,id]}))} onSetting={setSetting} onNavigateArtist={noop} onChoosePlaylist={()=>setDialog(true)} onSelectQueue={noop} onReorderUpcoming={reorder} onRemoveQueue={id=>setSession(s=>({...s,queue:s.queue.filter(q=>q.id!==id)}))} onClearQueue={noop}/>}
 {innerWidth>=769&&<QueuePanel session={session} listeningTracks={tracks} currentTrack={tracks[0]} playback={playback} undo={null} onClose={noop} onSelectQueue={noop} onReorderUpcoming={reorder} onRemoveQueue={noop} onUndoRemoval={noop} onClearQueue={noop}/>}
 {hub&&<CollectionHub onClose={()=>setHub(false)} onImport={async()=>{}} playlists={session.playlists} nearby={{hostLink:'',error:'',busy:false,connected:false}} onSync={async()=>{}}/>}
 <MobileTabBar view={view} setView={setView}/>
 <dialog ref={dialogRef} onCancel={()=>setDialog(false)}><SaveToPlaylistModal playlistTarget={tracks[0]} tracks={tracks} session={session} busy={false} onClose={()=>setDialog(false)} onSave={noop} onRemove={noop}/></dialog>
 </div>
}
createRoot(document.getElementById('root')).render(<Preview/>);

