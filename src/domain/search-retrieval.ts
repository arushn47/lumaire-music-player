import type { CatalogTrack } from "../adapters/native";
import { searchRoman } from "./source-matching";

const key = (value: string): string => value.normalize("NFC").trim().toLocaleLowerCase();
const forms = new Map<string, Promise<string>>();
const aliases = new Map<string, Map<string, string>>();

function learn(rows: CatalogTrack[]): void {
  for (const row of rows) {
    const metadata = row.recordingMetadata;
    if (metadata?.sourceId !== row.id) continue;
    for (const [id, names] of Object.entries(metadata.artistAliases)) {
      const credit = row.artists.find(artist => artist.id === id);
      if (!credit || !/^musicbrainz:artist:[0-9a-f-]{36}$/.test(id)) continue;
      for (const name of names.slice(0, 32)) {
        if (!name.trim() || name.length > 200 || /[\p{Cc}]/u.test(name)) continue;
        const normalized = key(name);
        if (!aliases.has(normalized)) {
          if (aliases.size >= 256) aliases.delete(aliases.keys().next().value!);
          aliases.set(normalized, new Map());
        }
        const identities = aliases.get(normalized)!;
        if (identities.size < 32 || identities.has(id)) identities.set(id, credit.name);
      }
    }
  }
}

export async function searchRetrieval(query: string, limit: number | undefined, search: (query: string, limit?: number) => Promise<CatalogTrack[]>): Promise<CatalogTrack[]> {
  const original = query.trim().slice(0, 200);
  const rows = await search(original, limit);
  learn(rows);
  if (rows.length >= Math.min(limit ?? 20, 5)) return rows;
  const known = aliases.get(key(original));
  let recovery = known?.size === 1 ? [...known.values()][0] : original;
  if (recovery === original && /[\u0900-\u0dff]/.test(original)) {
    if (!forms.has(original)) {
      if (forms.size >= 256) forms.delete(forms.keys().next().value!);
      forms.set(original, searchRoman(original).catch(() => original));
    }
    recovery = await forms.get(original)!;
  }
  if (key(recovery) === key(original) || !recovery.trim()) return rows;
  // Recovery generates catalogue candidates only; playback verification remains authoritative.
  try {
    const extra = await search(recovery, limit);
    learn(extra);
    const seen = new Set(rows.map(row => row.id));
    return [...rows, ...extra.filter(row => !seen.has(row.id) && Boolean(seen.add(row.id)))].slice(0, limit ?? 20);
  } catch { return rows; }
}
