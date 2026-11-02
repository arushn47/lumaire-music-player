// Real UI selection -> media playback. Every profile is isolated from the user's library.
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright-core');
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync, cpSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import net from 'node:net';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { playbackMetrics, summarizePlaybackTrials } from './playback-metrics.mjs';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';

export async function runLatency(commandArgs=typeof process==='undefined'?[]:process.argv.slice(2),lifecycle={}) {
const env=lifecycle.env||(typeof process==='undefined'?{}:process.env);
const arg = (name, fallback) => commandArgs.includes(name) ? commandArgs[commandArgs.indexOf(name)+1] : fallback;
const platform = arg('--platform','windows'), label = arg('--label','baseline'), samples = Number(arg('--samples','20'));
const validation = commandArgs.includes('--validation');
const androidValidation = commandArgs.includes('--android-validation');
const coverage = commandArgs.includes('--coverage');
assert(!validation || platform==='windows','Extended fault injection currently targets the desktop WebView only');
assert(!androidValidation || platform==='android');
assert(['windows','android'].includes(platform) && /^[\w-]+$/.test(label));
assert(Number.isInteger(samples) && samples > 0 && samples <= 100);
const percentile = (values,q) => { const sorted=[...values].sort((a,b)=>a-b); return !sorted.length?null:q===.5?(sorted[Math.floor((sorted.length-1)/2)]+sorted[Math.floor(sorted.length/2)])/2:sorted[Math.ceil(sorted.length*q)-1]; };
if(commandArgs.includes('--self-test')) {
 assert.equal(percentile([100,20,10,50],.5),35); assert.equal(percentile(Array.from({length:20},(_,i)=>i+1),.95),19);
 assert.equal(percentile([], .95),null); console.log('PASS percentile self-check'); return;
}
const output=path.resolve('test-results',`latency-${platform}-${label}.json`);
mkdirSync(path.dirname(output),{recursive:true});
const data=path.resolve(arg('--profile',path.join('.test-data/latency',`${platform}-${label}-${Date.now()}`)));
assert(data.startsWith(path.resolve('.test-data')+path.sep),'Benchmark profiles must stay inside the workspace test-data directory');
const adb='C:/Users/ARUSH/AppData/Local/Android/Sdk/platform-tools/adb.exe', pkg='app.lumaire.player.latency';
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function device(args) {
 const r=spawnSync(adb,args,{encoding:'utf8',timeout:60000,windowsHide:true});
 assert.equal(r.status,0,(r.stderr||r.stdout).slice(-600));return r.stdout.trim();
}
function seedStoppedAndroid(session,clearSourceCache=commandArgs.includes('--clear-source-cache')){
 device(['shell','am','force-stop',pkg]);
 const local=path.join(data,'seed.sqlite3');
 for(const suffix of ['', '-wal']){
 const result=spawnSync(adb,['exec-out','run-as',pkg,'cat',`library.sqlite3${suffix}`],{maxBuffer:64*1024*1024});
 if(result.status!==0){assert(suffix==='-wal','Cannot read isolated database');continue;}
 writeFileSync(local+suffix,result.stdout);
 }
 const db=new DatabaseSync(local);
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM tracks').get().n,0,'Refusing to replace a profile with saved tracks');
 if(clearSourceCache)db.exec('DELETE FROM verified_sources');
 db.exec('PRAGMA journal_mode=DELETE');
 db.prepare('INSERT INTO app_state(id,data) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(JSON.stringify(session));
 assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');db.close();
 const bytes=readFileSync(local);
 device(['push',local,'/data/local/tmp/lumaire-latency-seed.sqlite3']);
 device(['shell','run-as',pkg,'cp','/data/local/tmp/lumaire-latency-seed.sqlite3','library.sqlite3']);
 assert.equal(device(['shell','run-as',pkg,'sha256sum','library.sqlite3']).split(/\s/)[0],createHash('sha256').update(bytes).digest('hex'));
 device(['shell','run-as',pkg,'rm','-f','library.sqlite3-wal','library.sqlite3-shm']);
}
let report={platform,label,samples,startedAt:new Date().toISOString(),trials:[],
 sourceCache:commandArgs.includes('--clear-source-cache')?'Cleared before each cold cycle':'Preserved across process restarts',
 definitions:{cold:'Process restart and catalogue selection; see sourceCache for verified mapping policy. OS/DNS/CDN caches are not cleared.',repeat:'Select a second queue entry for the same catalogue song without restarting; this loads again, rather than resuming.',queue:'Select the next different catalogue entry immediately; no near-end warmup or artificial seek.',audio:'Windows playing event / Android native playing plus media time > 50 ms. No acoustic speaker measurement.',p95:'Nearest-rank empirical p95 of successes; failures reported separately.'}};
if(commandArgs.includes('--resume')){
 const previous=JSON.parse(readFileSync(output,'utf8'));assert.equal(previous.label,label);assert.equal(previous.platform,platform);assert.equal(previous.samples,samples);report=previous;
 report.resumeNotes=[...(report.resumeNotes||[]),{at:new Date().toISOString(),previousError:report.error}];delete report.error;delete report.finishedAt;
 const last=Math.max(...report.trials.map(t=>t.index));for(const kind of ['cold','repeat','queue'])if(!report.trials.some(t=>t.index===last&&t.kind===kind))report.trials.push({kind,index:last,ok:false,skipped:true,error:'Chained case not selected after preceding playback failure/auto-advance'});
}
let browser,page,app,port,stayAwake,fatalError;
const invoke=(command,args={})=>page.evaluate(({command,args})=>window.__TAURI_INTERNALS__.invoke(command,args),{command,args});
function save(){
 report.trials.forEach(trial=>{trial.metrics=playbackMetrics(trial.events||[]);});
 report.summary=Object.fromEntries([...new Set(['cold','repeat','queue',...report.trials.map(t=>t.kind)])].map(kind=>{
 const rows=report.trials.filter(t=>t.kind===kind),values=rows.filter(t=>t.ok).map(t=>t.ms);
 return [kind,{attempted:rows.filter(t=>!t.skipped).length,blocked:rows.filter(t=>t.skipped).length,succeeded:values.length,medianMs:percentile(values,.5),p95Ms:percentile(values,.95)}];}));
 report.stageSummary=summarizePlaybackTrials(report.trials);
 writeFileSync(output,JSON.stringify(report,null,2));
}
async function close(){
 if(lifecycle.launch&&page){
   const closed=page.waitForEvent('close',{timeout:5000}).catch(()=>{});
   await page.evaluate(()=>{void window.__TAURI_INTERNALS__.invoke('plugin:window|close',{label:'main'});}).catch(()=>{});
   await closed;
 }
 await browser?.close().catch(()=>{});browser=null;page=null;
 if(app){const owned=app;if(owned.exitCode===null)await new Promise(r=>{owned.once('exit',r);owned.kill();setTimeout(r,2000);});app=null;}
 if(platform==='android'&&port){spawnSync(adb,['forward','--remove',`tcp:${port}`],{windowsHide:true});port=null;}
}
async function launch(){
 if(platform==='windows'){
 port=lifecycle.launch?Number(arg('--port','58996')):await new Promise(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
 const executable=path.resolve(arg('--executable','src-tauri/target/debug/lumaire.exe'));
 report.executableSha256=createHash('sha256').update(readFileSync(executable)).digest('hex');
 if(lifecycle.launch)await lifecycle.launch(executable);
 else app=spawn(executable,[],{windowsHide:true,env:{...env,LUMAIRE_DATA_DIR:data,WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:`--remote-debugging-port=${port}`}});
 }else{device(['shell','am','force-stop',pkg]);device(['shell','am','start','-n',`${pkg}/app.lumaire.player.MainActivity`]);}
 for(let i=0;i<120;i++){
 if(app&&app.exitCode!==null)throw Error(`Validation executable exited before WebView startup: ${app.exitCode}`);
 try{
 if(platform==='android'){const pid=device(['shell','pidof',pkg]).split(' ')[0];port=device(['forward','tcp:0',`localabstract:webview_devtools_remote_${pid}`]);}
 browser=await chromium.connectOverCDP(`http://127.0.0.1:${port}`);page=browser.contexts()[0].pages()[0];
 await page.waitForFunction(()=>!!window.__TAURI_INTERNALS__,null,{timeout:3000});await delay(800);
 await page.waitForFunction(()=>document.querySelector('#main')&&!document.body.innerText.includes('Opening your library'),null,{timeout:15000});
 if(await page.locator('.music-language-onboarding').count())await page.locator('.music-language-onboarding').getByRole('button',{name:'Skip',exact:true}).click();
 report.url=page.url();return;
 }catch(e){if(platform==='android'&&port){device(['forward','--remove',`tcp:${port}`]);port=null;}if(i===119)throw e;await delay(200);}
 }
}
async function instrument(automatic=false){
 await page.evaluate(automatic=>{
 const state=window.__latency={events:[],start:null,playing:null,activePlaybackId:null,eventsTruncated:false};
 if(!automatic)document.addEventListener('click',()=>{state.start=performance.now();},{capture:true,once:true});
 if(!window.__originalDebug)window.__originalDebug=console.debug.bind(console);
 console.debug=(...args)=>{if(args[0]==='[Lumaire playback]'){try{const e=JSON.parse(args[1]);if(state.events.length<2048)state.events.push({stage:e.stage,at:performance.now(),trackId:e.trackId,candidateId:e.candidateId,reason:e.reason,operationId:e.operationId,playbackId:e.playbackId,durationMs:e.durationMs,cache:e.cache});else state.eventsTruncated=true;if(e.stage==='selection')state.activePlaybackId=e.playbackId;if(e.stage==='playing'&&state.start!==null&&(!state.activePlaybackId||e.playbackId===state.activePlaybackId))state.playing??=performance.now();}catch{}}window.__originalDebug(...args);};
 if(!window.__originalPlay)window.__originalPlay=HTMLMediaElement.prototype.play;
 HTMLMediaElement.prototype.play=function(...args){window.__benchmarkAudio=this;return window.__originalPlay.apply(this,args);};
 },automatic);
}
async function trial(kind,index,entry,options={}){
 await instrument(Boolean(options.automatic));
 const selector=platform==='windows'?`[data-queue-entry="${entry}"] .track-title-button`:`[data-queue-entry="${entry}"] .mobile-np-queue-item-main`;
 if(!(coverage&&platform==='android')&&!await page.locator(selector).count()){report.trials.push({kind,index,ok:false,skipped:true,error:'Selection no longer upcoming after a previous failure/auto-advance'});save();return;}
 const start=Date.now();let native;
 try{
 await options.before?.();
 if(options.automatic){
   if(platform==='android'){
     await page.evaluate(async()=>{
       const api=window.__TAURI_INTERNALS__;
       const state=await api.invoke('android_playback',{action:'state'});
       if(!state.seekable||state.duration<=1)throw Error('Automatic transition requires seekable real audio');
       window.__endedHandler=api.transformCallback(raw=>{if(raw.message?.status==='ended'&&raw.message.id===state.id&&window.__latency.start===null)window.__latency.start=performance.now();});
       await api.invoke('plugin:lumaire-android|register_listener',{event:'playback',handler:`__CHANNEL__:${window.__endedHandler}`});
       await api.invoke('android_playback',{action:'seek',value:state.duration-.25});
       await api.invoke('android_playback',{action:'play'});
     });
   }else await page.evaluate(()=>{window.__benchmarkAudio.addEventListener('ended',()=>{window.__latency.start=performance.now();window.__latency.playing=null;},{once:true});window.__benchmarkAudio.currentTime=window.__benchmarkAudio.duration-.25;});
 }else if(coverage&&platform==='android'){
   const song=report.corpus[index];
   await page.evaluate(async({song,entry})=>{
     const api=window.__TAURI_INTERNALS__,snapshot=await api.invoke('load_library');
     const session={...snapshot.session,queue:[{id:entry,trackId:song.id}],queueTracks:{[song.id]:{...song,metadataSourceId:song.id,format:'catalog',fileName:'',missing:false}},currentId:entry,position:0,shuffleOrder:[],settings:{...snapshot.session.settings,autoplay:false,repeat:'off',shuffle:false}};
     window.__latency.start=performance.now();
     await api.invoke('android_background_start',{queue:{session,tracks:[],records:[],languages:['english']},autoplay:true,position:0});
   },{song,entry});
 }else await page.locator(selector).click();
 while(Date.now()-start<120000){
 if(platform==='android'){native=await invoke('android_playback',{action:'state'});if(native.status==='error')throw Error(native.error);if(native.status==='playing'&&native.time>.05&&(coverage ? native.nativeQueue?.session.currentId===entry : await page.evaluate(id=>window.__latency.start!==null&&window.__latency.events.some(e=>e.stage==='native-load-start'&&e.trackId===id),native.id)))break;}
 else{if(await page.evaluate(()=>window.__latency.playing!==null))break;if(await page.locator('[data-testid="playback-state"]').textContent()==='error')throw Error('Desktop playback error');}
 await delay(40);
 }
 assert(Date.now()-start<120000,'No playback within 120s');
 const result=await page.evaluate(()=>({...window.__latency,end:performance.now()}));assert(result.start!==null,'Selection/ended timestamp was not observed');const ms=(platform==='windows'?(result.playing??result.end):result.end)-result.start;assert(Number.isFinite(ms)&&ms>=0);
 assert(!result.events.some(event=>event.stage==='queue-skip'),'A skipped selection must not count as successful playback');
 assert(!result.eventsTruncated,'Diagnostic event limit exceeded');
 const expected=options.catalogId||report.corpus[(index+(kind==='queue'?1:0))%report.corpus.length].id;
 const resolved=result.events.filter(event=>event.stage==='source-resolved'&&event.trackId===expected).at(-1);
 if(platform==='windows'&&validation){
   const source=await invoke('get_verified_source',{catalogId:expected});assert(source,'Expected recording has no verified mapping');
   const playing=result.events.filter(event=>event.stage==='playing').at(-1);assert.equal(playing?.trackId,`youtube:${source.sourceId}`,'Wrong recording reached playback');
   const clock=await page.evaluate(()=>window.__benchmarkAudio.currentTime);
   await page.waitForFunction(clock=>!window.__benchmarkAudio.paused&&window.__benchmarkAudio.currentTime>clock+.1,clock,{timeout:5000});
 }
 if(platform==='android'){
   const source=await invoke('get_verified_source',{catalogId:expected});assert(source,'Expected recording has no verified mapping');
   assert.equal(native.id,`youtube:${source.sourceId}`,'Native audio does not match the verified source');
 }
 await options.verify?.(result);
report.trials.push({kind,index,ok:true,ms,catalogId:expected,clickedAt:result.start,endedAt:result.end,playingAt:result.playing,events:result.events,nativeId:native?.id,...(coverage?{verifiedSource:await invoke('get_verified_source',{catalogId:expected}),incorrectMatch:'requires-labeled-review'}:{})});console.log(`${platform} ${label} ${kind} ${index}: ${Math.round(ms)} ms`);
 if(platform==='android')report.trials.at(-1).resolver=await invoke('android_source',{operation:'diagnostics'});
 if(platform==='android')await invoke('android_playback',{action:'pause'});else await page.evaluate(()=>window.__benchmarkAudio?.pause());
 }catch(e){const end=await page.evaluate(()=>({...window.__latency,end:performance.now()}));report.trials.push({kind,index,ok:false,error:String(e).replace(/https?:\/\/\S+/g,'[URL]'),elapsedMs:end.end-end.start,events:end.events});console.log(`${platform} ${label} ${kind} ${index}: FAILED ${String(e).slice(0,120)}`);}
 if(options.automatic&&platform==='android')await page.evaluate(async()=>{const api=window.__TAURI_INTERNALS__;await api.invoke('plugin:lumaire-android|remove_listener',{event:'playback',channelId:window.__endedHandler});api.unregisterCallback(window.__endedHandler);});
 save();
}
try{
 mkdirSync(data,{recursive:true});
 if(platform==='windows'){const components=path.join(env.LOCALAPPDATA,'app.lumaire.player/components');if(existsSync(components))cpSync(components,path.join(data,'components'),{recursive:true});}
 else {
 stayAwake=device(['shell','settings','get','global','stay_on_while_plugged_in']);
 report.originalStayAwake=stayAwake;save();
 device(['shell','svc','power','stayon','true']);
 device(['shell','input','keyevent','224']);
 device(['shell','wm','dismiss-keyguard']);
 report.device={model:device(['shell','getprop','ro.product.model']),api:device(['shell','getprop','ro.build.version.sdk'])};
 const expectedApk=path.resolve('.test-data/latency',`${label}-android.apk`);
 assert(existsSync(expectedApk),'Missing labelled benchmark APK');
 const installedPath=device(['shell','pm','path',pkg]).split('\n').find(line=>line.trim().endsWith('/base.apk'))?.trim().replace(/^package:/,'');
 assert(installedPath,'Install the isolated benchmark APK first');
 report.apkSha256=device(['shell','sha256sum',installedPath]).split(/\s/)[0];
 assert.equal(report.apkSha256,createHash('sha256').update(readFileSync(expectedApk)).digest('hex'),'Installed APK does not match the benchmark label');
 }
 await launch();const snapshot=await invoke('load_library');assert.equal(snapshot.tracks.length,0,'Refusing to use a profile containing user tracks');
 await page.evaluate(()=>localStorage.setItem('lumaire-discovery',JSON.stringify({languages:['english'],onboarded:true})));
 const fixtureFile=path.resolve(arg('--corpus','test-results/latency-catalog.json'));let corpus;
 if(existsSync(fixtureFile))corpus=JSON.parse(readFileSync(fixtureFile,'utf8'));
 else{corpus=[];const queries=coverage?JSON.parse(readFileSync('tests/fixtures/failed-song-corpus.json','utf8')).map(row=>row.query):['Never Gonna Give You Up Rick Astley','Despacito Luis Fonsi','Naa Ready Anirudh'];for(const query of queries){const rows=await invoke('search_catalog',{query,limit:10});const chosen=coverage?rows[0]:(rows.find(t=>t.id.startsWith('itunes:'))||rows[0]);if(!chosen&&coverage){(report.catalogMisses??=[]).push({query,category:"catalog-no-result"});continue;}assert(chosen,query);corpus.push(chosen);}writeFileSync(fixtureFile,JSON.stringify(corpus,null,2));}
 assert(Array.isArray(corpus)&&corpus.length>0&&corpus.length<=100&&corpus.every(song=>typeof song.id==='string'&&typeof song.title==='string'&&typeof song.artist==='string'&&Number.isFinite(song.duration)&&song.duration>0),'Invalid benchmark corpus');
 report.corpus=corpus;save();
 const session={queue:[],queueTracks:{},shuffleOrder:[],currentId:null,position:0,favoriteArtists:[],favoriteAlbums:[],favorites:[],playlists:[],history:[],lyrics:{},settings:{themeMode:'dark',accentColor:'#c4dca3',volume:.1,repeat:'off',shuffle:false,romanisation:false,translation:false,originalScript:true,originalFirst:true,autoOpenLyrics:false,autoplay:false,estimatedScroll:false,geminiModel:'',lyricSize:32,historyEnabled:false,autoGemini:false}};
 const firstIndex=commandArgs.includes('--resume')?Math.max(...report.trials.map(t=>t.index))+1:0;
 for(let index=firstIndex;index<samples;index++){
 const a=corpus[index%corpus.length],b=corpus[(index+1)%corpus.length],c=corpus[(index+2)%corpus.length];
 const songs=coverage?corpus:validation?[a,a,b,a,a,a,b,c]:androidValidation?[a,a,b,c]:[a,a,b];
 session.queue=[{id:'sentinel',trackId:songs[0].id},...songs.map((song,i)=>({id:`bench-${i}`,trackId:song.id}))];session.currentId='sentinel';session.queueTracks=Object.fromEntries(songs.map(song=>[song.id,{...song,metadataSourceId:song.id,format:'catalog',fileName:'',missing:false}]));
 if(platform==='android'){await close();seedStoppedAndroid(session);}else{await delay(500);await close();const seeded=new DatabaseSync(path.join(data,'library.sqlite3'));try{assert.equal(seeded.prepare('SELECT COUNT(*) AS n FROM tracks').get().n,0);seeded.prepare('INSERT INTO app_state(id,data) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(JSON.stringify(session));}finally{seeded.close();}
 if(commandArgs.includes('--clear-source-cache')){const db=new DatabaseSync(path.join(data,'library.sqlite3'));try{assert.equal(db.prepare('SELECT COUNT(*) AS n FROM tracks').get().n,0,'Refusing to clear source cache in a user library');db.exec('DELETE FROM verified_sources');}finally{db.close();}}
 }
 await launch();
 const restored=await invoke('load_library');
 assert.equal(restored.session.currentId,'sentinel','Fixture was overwritten by a pending session save');
 assert.equal(restored.session.queue[1].trackId,songs[0].id,'Wrong catalogue fixture restored');
 if(await page.locator('.engine-setup-dialog').count())throw Error('Benchmark profile needs pinned streaming engine');
 await page.getByRole('button',{name:'Show queue',exact:true}).filter({visible:true}).first().click();
 if(platform==='android')assert.equal(await page.evaluate(()=>document.visibilityState),'visible','Unlock the phone for foreground playback measurement');
 if(platform==='android')await invoke('android_playback',{action:'volume',value:.1});
 if(coverage){for(let n=0;n<songs.length;n++)await trial('coverage',n,`bench-${n}`,{catalogId:songs[n].id});continue;}
 await trial('cold',index,'bench-0');
 if(validation||androidValidation){
   await delay(500);await close();
   if(platform==='android')seedStoppedAndroid(session,false);else{const seeded=new DatabaseSync(path.join(data,'library.sqlite3'));try{assert.equal(seeded.prepare('SELECT COUNT(*) AS n FROM tracks').get().n,0);seeded.prepare('INSERT INTO app_state(id,data) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(JSON.stringify(session));}finally{seeded.close();}}
   await launch();
   await page.getByRole('button',{name:'Show queue',exact:true}).filter({visible:true}).first().click();
   await trial('durable-cached',index,'bench-0',{catalogId:a.id,verify:result=>assert(result.events.some(e=>e.cache==='verified'),'Durable cache was not used')});
 }
 await trial('repeat',index,'bench-1');await trial('queue',index,'bench-2');
 if(androidValidation)await trial('queue-ended',index,'bench-3',{catalogId:c.id,automatic:true});
 if(validation){
   const expire=()=>page.evaluate(()=>{window.__wallNow??=Date.now.bind(Date);window.__wallOffset=(window.__wallOffset||0)+31*60*1000;Date.now=()=>window.__wallNow()+window.__wallOffset;});
   await trial('cache-expiry-controlled',index,'bench-3',{catalogId:a.id,before:expire,verify:result=>assert(result.events.some(e=>e.stage==='extraction-end'),'Expired frontend cache did not extract again')});
   let refused=0;
   const refuse=route=>{if(refused++===0)return route.fulfill({status:403,body:'Controlled validation refusal'});return route.continue();};
   await page.route('https://**.googlevideo.com/**',refuse);
   try{await trial('http-retry-controlled',index,'bench-4',{catalogId:a.id,verify:result=>{assert(refused>0,'No media request intercepted');assert(result.events.some(e=>e.stage==='engine-retry'),'No engine recovery observed');assert(result.events.some(e=>e.stage==='extraction-end'),'Recovery did not extract a fresh URL');}});}finally{await page.unroute('https://**.googlevideo.com/**',refuse);}
   await trial('selection-cancellation',index,'bench-6',{catalogId:b.id,before:async()=>{
     await expire();await page.locator('[data-queue-entry="bench-5"] .track-title-button').click();
     await page.waitForFunction(()=>window.__latency.events.some(e=>e.stage==='extraction-start'),null,{timeout:15000});
     await page.evaluate(()=>{window.__latency.start=null;window.__latency.playing=null;document.addEventListener('click',()=>window.__latency.start=performance.now(),{capture:true,once:true});});
   },verify:async result=>{await delay(1500);const latest=await page.evaluate(()=>window.__latency.events.filter(e=>e.stage==='playing').at(-1));assert.equal(latest.playbackId,result.events.filter(e=>e.stage==='playing').at(-1).playbackId,'Late cancelled result replaced current playback');}});
   // Resume the current recording, then let the real ended event advance the queue.
   await page.evaluate(()=>window.__benchmarkAudio.play());
   await trial('queue-ended',index,'bench-7',{catalogId:c.id,automatic:true});
   await page.evaluate(()=>{if(window.__wallNow)Date.now=window.__wallNow;window.__wallOffset=0;});
 }
 }
 if(platform==='android'&&label==='combined-fix'){
 const songs=[corpus[0],corpus[1]];
 session.queue=[{id:'sentinel',trackId:songs[0].id},...songs.map((song,i)=>({id:`rapid-${i}`,trackId:song.id}))];
 session.currentId='sentinel';session.queueTracks=Object.fromEntries(songs.map(song=>[song.id,{...song,metadataSourceId:song.id,format:'catalog',fileName:'',missing:false}]));
 await close();seedStoppedAndroid(session);await launch();await page.getByRole('button',{name:'Show queue',exact:true}).click();await invoke('android_playback',{action:'volume',value:.1});await instrument();
 await page.locator('[data-queue-entry="rapid-0"] .mobile-np-queue-item-main').click();await delay(350);
 let active=false;for(let n=0;n<40;n++){const result=spawnSync(adb,['shell','pidof',`${pkg}:resolver`],{encoding:'utf8',windowsHide:true});if(result.stdout.trim()){active=true;break;}await delay(50);}
 assert(active,'Rapid-selection test must interrupt a real active worker');
 const switchedAt=await page.evaluate(()=>performance.now());await page.locator('[data-queue-entry="rapid-1"] .mobile-np-queue-item-main').click();
 let final;const deadline=Date.now()+120000;
 while(Date.now()<deadline){const native=await invoke('android_playback',{action:'state'});const events=await page.evaluate(()=>window.__latency.events);const selected=events.filter(e=>e.stage==='source-resolved'&&e.trackId===songs[1].id).at(-1);
 if(selected&&native.id===`youtube:${selected.candidateId}`&&native.status==='playing'&&native.time>.05){final={nativeId:native.id,events,switchedAt};break;}await delay(50);}
 assert(final,'Newer catalogue selection did not start');assert(!final.events.some(e=>e.stage==='search'&&e.trackId===songs[0].id&&e.at>switchedAt+50),'Cancelled selection launched fallback work');
 await delay(1000);assert.equal((await invoke('android_playback',{action:'state'})).id,final.nativeId,'Stale result replaced the newer selection');
 report.rapidSelection={ok:true,...final};save();console.log('PASS rapid catalogue selection: latest recording wins, no stale fallback work');
 }
}catch(e){report.error=String(e);console.error(e);if(lifecycle.launch)fatalError=e;else process.exitCode=1;}
finally{if(platform==='android'){try{await invoke('android_playback',{action:'stop'});}catch{}}await close();try{if(stayAwake!==undefined){if(stayAwake==='null')device(['shell','settings','delete','global','stay_on_while_plugged_in']);else device(['shell','settings','put','global','stay_on_while_plugged_in',stayAwake]);}}catch(error){report.cleanupError=String(error);}report.finishedAt=new Date().toISOString();save();}
if(fatalError)throw fatalError;
return report;
}

if(typeof process!=='undefined'&&process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(process.argv.includes('--native-launcher')){
    const input=createInterface({input:process.stdin}), lines=input[Symbol.asyncIterator]();
    try { await runLatency(process.argv.slice(2),{launch:async executable=>{
      console.log(`NATIVE_LAUNCH_REQUIRED ${JSON.stringify(executable)}`);
      const reply=await lines.next();assert(!reply.done&&reply.value.trim()==='ready','Native launcher did not acknowledge startup');
    }}); } finally { input.close(); }
  }else await runLatency();
}

