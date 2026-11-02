import type {RecordingMetadata, Track} from './types';
import {isCatalogId} from './queue';

export function recordingMetadata(value: unknown): RecordingMetadata | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const v=value as RecordingMetadata;
  if (!isCatalogId(v.sourceId) || !Array.isArray(v.isrcs) || v.isrcs.length>32 || !v.isrcs.every(code=>typeof code==='string'&&/^[A-Z]{2}[A-Z0-9]{3}\d{7}$/.test(code))) return undefined;
  if (v.releaseDate!==null) {
    if(typeof v.releaseDate!=='string'||!/^\d{4}(?:-\d{2}(?:-\d{2})?)?$/.test(v.releaseDate))return undefined;
    const [year,month=1,day=1]=v.releaseDate.split('-').map(Number), date=new Date(Date.UTC(year,month-1,day));
    if(year<1800||year>2200||date.getUTCFullYear()!==year||date.getUTCMonth()!==month-1||date.getUTCDate()!==day)return undefined;
  }
  if(!v.artistAliases||typeof v.artistAliases!=='object'||Array.isArray(v.artistAliases)||Object.keys(v.artistAliases).length>32)return undefined;
  for(const [id,names] of Object.entries(v.artistAliases))if(!/^musicbrainz:artist:[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(id)||!Array.isArray(names)||names.length>32||!names.every(name=>typeof name==='string'&&name.trim()&&name.length<=1000&&!/[\u0000-\u001f\u007f]/.test(name)))return undefined;
  return {sourceId:v.sourceId,isrcs:[...v.isrcs],releaseDate:v.releaseDate,artistAliases:Object.fromEntries(Object.entries(v.artistAliases).map(([id,names])=>[id,[...names]]))};
}

/** Existing values, including corrections made while a request ran, win. */
export function fillTrackMetadata(latest: Track, proposed: Track, initial: Track = latest): Track {
  const result={...proposed,...latest};
  result.recordingMetadata=latest.recordingMetadata;
  for(const key of ['title','artist','album','artworkUrl','metadataSourceId'] as const) {
    if(latest[key]===initial[key]&&!latest[key]?.trim()) Object.assign(result,{[key]:proposed[key]});
  }
  // Playback duration belongs to the selected source, not a catalogue release.
  result.duration=latest.duration;
  const extra=recordingMetadata(proposed.recordingMetadata);
  if(!latest.recordingMetadata && extra && extra.sourceId===result.metadataSourceId)result.recordingMetadata=extra;
  return result;
}
