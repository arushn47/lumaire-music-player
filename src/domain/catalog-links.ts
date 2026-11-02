import type { CatalogArtist, CatalogArtistCredit, CatalogTrack } from "../adapters/native";

const usable = (value: string): boolean => Boolean(value.trim()) && !/^unknown(?: artist| album)?$|^local collection$|^youtube$/i.test(value.trim());

export function canonicalArtistCredit(value: string): string {
  return value.split(",").map(name => /^emiway(?: bantai)?$/i.test(name.trim()) ? "Emiway Bantai" : /^kr\$na$/i.test(name.trim()) ? "KR$NA" : name.trim()).join(", ");
}

export function artistCredits(value: string): CatalogArtistCredit[] {
  // shortcut: legacy separators are ambiguous in group names; prefer structured credits when available.
  return value.split(/\s*[,;]\s*|\s+(?:&|and|feat\.?|ft\.?|featuring)\s+/i).map(name => name.trim()).filter(usable).map(name => ({ name, id: artistReference(name) }));
}

export function artistReference(name: string): string {
  // A legacy name reference opens choices; it never identifies a provider artist.
  return `saavn:artist:name:${encodeURIComponent(name.trim())}`;
}

export function isArtistId(id: string | null | undefined): id is string {
  return typeof id === 'string' && /^(?:(?:saavn:artist:|itunes:)[1-9]\d{0,19}|musicbrainz:artist:[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$/.test(id);
}

export function artistLookupName(id: string): string | null {
  const encoded = /^(?:saavn:)?artist:name:(.+)$/.exec(id)?.[1] ?? (/^saavn:artist:([^:]+)$/.exec(id)?.[1]);
  if (!encoded || isArtistId(id) || /^\d+$/.test(encoded)) return null;
  try { const name = decodeURIComponent(encoded).trim(); return name && name.length <= 200 && !/[\u0000-\u001f\u007f]/.test(name) ? name : null; } catch { return null; }
}

export function artistSource(id: string): string {
  if (!isArtistId(id)) return 'Unresolved credit';
  return `${id.startsWith('saavn:') ? 'JioSaavn' : id.startsWith('itunes:') ? 'Apple' : 'MusicBrainz'} · ${id.split(':').at(-1)}`;
}

export async function resolveArtistCredit(credit: CatalogArtistCredit, catalogId: string | null | undefined,
  lookupTrack: (id: string) => Promise<CatalogTrack>, lookupArtist: (id: string) => Promise<{ info: CatalogArtist; verifiedIds?: string[] }>): Promise<string> {
  if (isArtistId(credit.id)) return credit.id;
  const unresolved = artistReference(credit.name);
  if (!catalogId) return unresolved;
  try {
    const track = await lookupTrack(catalogId);
    if (track.id !== catalogId) return unresolved;
    const sameName = (name: string): boolean => name.trim().toLowerCase() === credit.name.trim().toLowerCase();
    const ids = [...new Set(track.artists.filter(other => sameName(other.name) && isArtistId(other.id)).map(other => other.id!))];
    if (ids.length) return ids.length === 1 ? ids[0] : unresolved;
    if (isArtistId(track.artistId) && track.artists.some(other => sameName(other.name))) {
      const profile = await lookupArtist(track.artistId);
      if ((profile.info.id === track.artistId || profile.verifiedIds?.includes(track.artistId)) && sameName(profile.info.name)) return track.artistId;
    }
  } catch { /* Missing recording evidence leaves a choice, never a guessed identity. */ }
  return unresolved;
}

export function albumReference(title: string, artist: string): string | null {
  const credit = artistCredits(artist)[0];
  return usable(title) && credit ? `saavn:album:search:${encodeURIComponent(credit.name)}:${encodeURIComponent(title.trim())}` : null;
}
