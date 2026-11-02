// Native integration checks against only the isolated benchmark application.
import { spawnSync } from 'node:child_process';
import { chromium } from 'playwright-core';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const adb='C:/Users/ARUSH/AppData/Local/Android/Sdk/platform-tools/adb.exe';
const pkg='app.lumaire.player.latency', video='aqz-KE-bpKQ', id=`youtube:${video}`;
const label=process.argv[2]||'combined-fix';
assert(/^[\w-]+$/.test(label),'Invalid benchmark label');
const output=process.argv[2]?`test-results/android-playback-correctness-${label}.json`:'test-results/android-playback-correctness.json';
const report={startedAt:new Date().toISOString(),checks:[],failures:[]};
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function device(args,required=true){const r=spawnSync(adb,args,{encoding:'utf8',windowsHide:true,timeout:30000});if(required)assert.equal(r.status,0,(r.stderr||r.stdout).slice(-500));return r.stdout.trim();}
let browser,page,port,tone,cacheFilledAt=0;
const invoke=(command,args={})=>page.evaluate(({command,args})=>window.__TAURI_INTERNALS__.invoke(command,args),{command,args});
const state=()=>invoke('android_playback',{action:'state'});
const diagnostic=()=>invoke('android_source',{operation:'diagnostics'});
const safe=error=>String(error).replace(/https?:\/\/\S+/g,'[URL]').slice(0,1200);
async function until(predicate,seconds=30){const end=performance.now()+seconds*1000;while(performance.now()<end){const s=await state();if(predicate(s))return s;if(s.status==='error')throw Error(s.error);await delay(50);}throw Error('Native playback state timeout');}
async function check(name,operation){const started=performance.now();try{report.checks.push({name,evidence:await operation(),elapsedMs:performance.now()-started});console.log(`PASS ${name}`);}catch(error){report.failures.push({name,error:safe(error),elapsedMs:performance.now()-started});console.log(`FAIL ${name}: ${safe(error)}`);await invoke('android_playback',{action:'cancel'}).catch(()=>{});}writeFileSync(output,JSON.stringify(report,null,2));}
async function worker(){for(let n=0;n<60;n++){if(device(['shell','pidof',`${pkg}:resolver`],false))return;await delay(50);}throw Error('No active resolver worker was observed');}
async function loadAudio(){const before=await diagnostic();await invoke('android_playback',{action:'load',id,autoplay:true});const after=await diagnostic();if(after.resolverCacheHits===before.resolverCacheHits)cacheFilledAt=performance.now();return until(s=>s.id===id&&s.status==='playing'&&s.time>.05);}
try{
 const installed=device(['shell','pm','path',pkg]).split('\n').find(x=>x.endsWith('/base.apk')).replace(/^package:/,'');
 report.apkSha256=device(['shell','sha256sum',installed]).split(/\s/)[0];
 assert.equal(report.apkSha256,createHash('sha256').update(readFileSync(`.test-data/latency/${label}-android.apk`)).digest('hex'));
 device(['shell','input','keyevent','224']);device(['shell','wm','dismiss-keyguard']);
 device(['shell','am','force-stop',pkg]);device(['shell','am','start','-n',`${pkg}/app.lumaire.player.MainActivity`]);await delay(1200);
 const pid=device(['shell','pidof',pkg]).split(' ')[0];port=device(['forward','tcp:0',`localabstract:webview_devtools_remote_${pid}`]);
 browser=await chromium.connectOverCDP(`http://127.0.0.1:${port}`);page=browser.contexts()[0].pages()[0];
 await page.waitForFunction(()=>!!window.__TAURI_INTERNALS__);
 await invoke('android_playback',{action:'cancel'});
 await invoke('android_playback',{action:'volume',value:.1});
 const beforeLibrary=await invoke('load_library');assert(beforeLibrary.tracks.every(t=>t.fileName==='Lumaire - Android prototype.wav'),'Refusing to use a profile with non-fixture tracks');
 tone=beforeLibrary.tracks[0]??(await invoke('android_demo_track')).tracks[0];assert(tone);
 await check('Local audio still loads and advances',async()=>{await invoke('android_playback',{action:'load',id:tone.id,autoplay:true});const a=await until(s=>s.id===tone.id&&s.status==='playing');await delay(600);const b=await state();assert(b.time>a.time+.3);return {id:tone.id,advanced:b.time-a.time};});
 await check('Verification and native playback share one bounded audio-only resolution',async()=>{
 const source=await invoke('android_source',{operation:'resolve',videoId:video});cacheFilledAt=performance.now();
 assert.equal(source.videoCodec,'none');assert.equal(source.diagnostic.streamProbeStatus,206);
 const before=await diagnostic(),playing=await loadAudio(),after=await diagnostic();
 assert.equal(after.resolverExecutions,before.resolverExecutions);assert(after.resolverCacheHits>before.resolverCacheHits);
 return {before:before.resolverExecutions,after:after.resolverExecutions,cacheHits:after.resolverCacheHits,codec:source.codec,id:playing.id};
 });
 await check('Pause, seek and resume use the real service clock',async()=>{
 await invoke('android_playback',{action:'pause'});const a=await state();await delay(500);assert(Math.abs((await state()).time-a.time)<.2);assert(a.seekable);
 await invoke('android_playback',{action:'seek',value:30});await invoke('android_playback',{action:'play'});const b=await until(s=>s.status==='playing'&&s.time>=30&&s.time<36);return {pausedAt:a.time,resumedAt:b.time};
 });
 await check('Independent searches complete without cancelling each other or stopping audio',async()=>{
 const a=await state();const replies=await Promise.all([
 invoke('android_source',{operation:'search',query:'Rick Astley Never Gonna Give You Up',maxResults:1}),
 invoke('android_source',{operation:'search',query:'Luis Fonsi Despacito',maxResults:1}),
 ]);assert(replies.every(r=>r.results.length>0));const b=await state();assert.equal(b.id,id);assert.equal(b.status,'playing');assert(b.time>a.time+.5);return {counts:replies.map(r=>r.results.length),advanced:b.time-a.time};
 });
 await check('Cancelling an active uncached worker preserves the incumbent audio',async()=>{
 const a=await state();const pending=invoke('android_playback',{action:'load',id:'youtube:___________',autoplay:true}).then(()=>({ok:true}),error=>({error:safe(error)}));
 await delay(350);await worker();const start=performance.now();await invoke('android_playback',{action:'cancel'});const result=await pending;assert(result.error?.includes('cancel'));
 for(let n=0;n<30&&device(['shell','pidof',`${pkg}:resolver`],false);n++)await delay(50);
 assert(!device(['shell','pidof',`${pkg}:resolver`],false));const ms=performance.now()-start;assert(ms<2500);
 const b=await state();assert.equal(b.id,a.id);assert.equal(b.status,'playing');return {cancellationMs:ms,error:result.error};
 });
 await check('A newer local selection wins over a pending source and late results',async()=>{
 const pending=invoke('android_playback',{action:'load',id:'youtube:__________1',autoplay:true}).then(()=>({ok:true}),error=>({error:safe(error)}));await delay(350);await worker();
 await invoke('android_playback',{action:'load',id:tone.id,autoplay:true});assert((await pending).error);
 await until(s=>s.id===tone.id&&s.status==='playing');await delay(1000);const s=await state();assert.equal(s.id,tone.id);assert.equal(s.status,'playing');await loadAudio();return {winningId:s.id};
 });
 await check('Failed sources are not cached, retries and later playback still work',async()=>{
 const before=await diagnostic();const errors=[];
 for(let n=0;n<2;n++){const outcome=await invoke('android_playback',{action:'load',id:'youtube:___________',autoplay:true}).then(()=>({ok:true}),error=>({error:safe(error)}));assert(outcome.error,'Unavailable recording loaded');errors.push(outcome.error);}
 const after=await diagnostic();assert.equal(after.resolverExecutions,before.resolverExecutions+2);const s=await state();assert.equal(s.id,id);assert.equal(s.status,'playing');await loadAudio();return {errors,requests:after.resolverExecutions-before.resolverExecutions};
 });
 await check('Screen-off foreground playback advances without the WebView timer',async()=>{
 const a=await state();device(['shell','input','keyevent','3']);device(['shell','input','keyevent','223']);
 try{await delay(8000);const b=await state();assert.equal(b.id,id);assert.equal(b.status,'playing');assert(b.time>a.time+6);
 assert(device(['shell','dumpsys','activity','services',pkg]).includes('isForeground=true'));return {advanced:b.time-a.time};}
 finally{device(['shell','input','keyevent','224']);device(['shell','wm','dismiss-keyguard']);device(['shell','am','start','-n',`${pkg}/app.lumaire.player.MainActivity`]);}
 });
 await check('Expired in-memory stream entries trigger a fresh real extraction',async()=>{
 assert(cacheFilledAt>0);const deadline=cacheFilledAt+120500;
 while(performance.now()<deadline){const remaining=deadline-performance.now();console.log(`Waiting ${Math.ceil(remaining/1000)}s for real cache expiry`);await delay(Math.min(30000,remaining));}
 const before=await diagnostic(),started=performance.now();const result=await invoke('android_source',{operation:'resolve',videoId:video});const extractionMs=performance.now()-started,after=await diagnostic();
 assert.equal(result.videoCodec,'none');assert.equal(after.resolverExecutions,before.resolverExecutions+1);return {before:before.resolverExecutions,after:after.resolverExecutions,extractionMs};
 });
 const afterLibrary=await invoke('load_library');assert.deepEqual(afterLibrary.tracks.map(t=>t.id),[tone.id]);
 report.passed=report.failures.length===0;
}catch(error){report.failures.push({name:'Harness',error:safe(error)});report.passed=false;console.error(safe(error));}
finally{if(page)await invoke('android_playback',{action:'stop'}).catch(()=>{});await browser?.close().catch(()=>{});if(port)device(['forward','--remove',`tcp:${port}`],false);report.finishedAt=new Date().toISOString();writeFileSync(output,JSON.stringify(report,null,2));}
process.exitCode=report.passed?0:1;
