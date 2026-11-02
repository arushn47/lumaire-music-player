import {useEffect, useRef, useState} from 'react';
import {library, type CatalogTrack, type YtdlpSearchResult} from '../../adapters/native';
import {failureKind, resolveCatalogSources} from '../../domain/catalog-track';
import {prepareCatalogCandidate} from '../../player/service';
import './source-chooser.css';

export function SourceChooser({catalogId,active,onChoose,onClose}:{catalogId:string;active:()=>boolean;onChoose:(catalog:CatalogTrack,source:YtdlpSearchResult)=>Promise<void>;onClose:()=>void}) {
  const dialog=useRef<HTMLDialogElement>(null),generation=useRef(0);
  const [catalog,setCatalog]=useState<CatalogTrack|null>(null),[sources,setSources]=useState<YtdlpSearchResult[]>([]);
  const [busy,setBusy]=useState(true),[error,setError]=useState(''),[message,setMessage]=useState('');
  const [selected,setSelected]=useState<string|null>(null);
  const activeRef=useRef(active);activeRef.current=active;
  useEffect(()=>{
    const node=dialog.current!;node.showModal();const token=++generation.current;
    const current=()=>generation.current===token&&activeRef.current();
    void (async()=>{
      if(!current())return;
      const song=await library.lookupCatalog(catalogId);if(!current())return;setCatalog(song);
      const saved=await library.getVerifiedSource(catalogId);if(current())setSelected(saved?.userSelected?saved.sourceId:null);
      const rows=await resolveCatalogSources(song,library.ytdlpSearch,{verify:prepareCatalogCandidate,active:current});
      if(current())setSources(rows);
    })().catch(reason=>{if(current()&&failureKind(reason)!=='cancelled')setError(String(reason));}).finally(()=>{if(current())setBusy(false);});
    return ()=>{generation.current++;node.close();};
  },[catalogId]);
  async function choose(source:YtdlpSearchResult){
    if(!catalog||busy||!activeRef.current())return;
    const token=generation.current;setBusy(true);setError('');
    try{await onChoose(catalog,source);if(generation.current===token)onClose();}
    catch(reason){if(generation.current===token&&failureKind(reason)!=='cancelled')setError(String(reason));}
    finally{if(generation.current===token)setBusy(false);}
  }
  return <dialog ref={dialog} className="update-dialog source-chooser" aria-labelledby="source-chooser-title" onCancel={event=>{event.preventDefault();onClose();}}>
    <header><h2 id="source-chooser-title">Choose recording</h2><button autoFocus type="button" onClick={onClose} aria-label="Close recording chooser">Close</button></header>
    <p>{catalog?`${catalog.title} — ${catalog.artist}`:'Looking up the selected song…'}</p>
    <p>Only recordings that pass title, artist, version and duration checks are listed. Availability can change.</p>
    {busy&&<p role="status">Checking recordings…</p>}
    {error&&<p role="alert">{error}</p>}{message&&<p role="status">{message}</p>}
    <ul>{sources.map(source=><li key={source.id}>
      <strong>{source.track||source.title}</strong><p>Artist: {source.artist||'Not supplied by source'} · Uploader: {source.channel||'Unknown'}</p>
      <p>{Math.floor(Math.round(source.duration||0)/60)}:{String(Math.round(source.duration||0)%60).padStart(2,'0')} · Version: {[...new Set(`${source.title} ${source.track||''}`.match(/\b(?:live|remix|acoustic|remaster(?:ed)?|instrumental|reprise)\b/gi)||[])].join(', ')||'Not labeled; matches requested version'}</p>
      <p>Source title: {source.title}</p>
      <button type="button" disabled={busy} onClick={()=>void choose(source)}>{selected===source.id?'Use saved recording':'Use this recording'}</button>
    </li>)}</ul>
    {!busy&&!sources.length&&!error&&<p>No alternative recording passed verification. Retry later or import local audio.</p>}
    <button type="button" disabled={busy||!selected} onClick={()=>{
      setBusy(true);void library.deleteVerifiedSource(catalogId).then(()=>{setSelected(null);setMessage('Saved choice cleared. Future playback can choose automatically.');}).catch(reason=>setError(String(reason))).finally(()=>setBusy(false));
    }}>Reset saved choice</button>
  </dialog>;
}
