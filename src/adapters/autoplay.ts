import { library, type CatalogTrack } from './native';
import { recommendations, seedId } from './quick-picks';
import { catalogQuickPick, recommendationKey, sameRecommendation } from '../domain/quick-picks';
import { sourceTitle } from '../domain/source-matching';
import type { RadioCandidate } from '../domain/autoplay-ranking';
import type { Track } from '../domain/types';

const metadataCache = new Map<string, { at: number; request: Promise<CatalogTrack> }>();
function metadata(id: string): Promise<CatalogTrack> {
  const cached = metadataCache.get(id);
  if (cached && Date.now() - cached.at < 30 * 60000) return cached.request;
  const request = library.lookupCatalog(id).catch(error => { metadataCache.delete(id); throw error; });
  if (metadataCache.size >= 32) metadataCache.delete(metadataCache.keys().next().value!);
  metadataCache.set(id, { at: Date.now(), request });
  return request;
}
const hasLanguage = (track?: CatalogTrack | null) => !!track?.language?.trim() && !['unknown', 'und', 'zxx'].includes(track.language.toLowerCase().trim());

/** One original-song radio; an exact catalog match can recover missing language metadata. */
export async function loadAutoplayPool(anchor: Track, active: () => boolean, budgetMs = 5000): Promise<{ candidates: RadioCandidate[]; metadata: CatalogTrack[] }> {
  const result: { candidates: RadioCandidate[]; metadata: CatalogTrack[] } = { candidates: [], metadata: [] };
  let accepting = true;
  const task = async () => {
    const id = await seedId(anchor);
    if (!id || !accepting || !active()) return;
    let seed = await metadata(id).catch(() => null);
    if (!hasLanguage(seed) && accepting && active()) {
      const knownGenre = seed?.genre;
      const matches = await library.searchCatalog(`${anchor.title} ${anchor.artist}`.slice(0, 200), 10);
      seed = matches.find(row => hasLanguage(row) && Math.abs(row.duration - anchor.duration) <= 2
        && recommendationKey(sourceTitle(row.title)) === recommendationKey(sourceTitle(anchor.title))
        && sameRecommendation(catalogQuickPick(row), { track: anchor })) ?? null;
      if (seed && !seed.genre && knownGenre) seed = {...seed, genre: knownGenre};
      if (seed) metadataCache.set(id, { at: Date.now(), request: Promise.resolve(seed) });
    }
    if (!seed || !hasLanguage(seed) || !accepting || !active()) return;
    result.metadata = [seed];
    const tracks = await recommendations(seed.id);
    if (!accepting || !active()) return;
    const seen = new Set<string>();
    result.candidates = tracks.slice(0, 30).filter(track => {
      if (seen.has(track.id)) return false;
      seen.add(track.id);
      return true;
    })
      .map((track, position) => ({ track, position, sources: ['anchor'] }));
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  // The native worker already has a cancellable service deadline and synchronous RPC.
  if (budgetMs === 0) await task().catch(() => { });
  else await Promise.race([task().catch(() => { }), new Promise<void>(resolve => { timer = setTimeout(resolve, budgetMs); })]);
  clearTimeout(timer); accepting = false;
  return active() ? result : { candidates: [], metadata: [] };
}
