import type { CatalogArtist, CatalogTrack } from "../adapters/native";
import type { Track } from "./types";
import { isCatalogId } from "./queue";
import { searchForm } from "./search-forms";

const indic = /[\u0900-\u0dff]/;
const key = (value: string): string => value.normalize("NFKD").replace(/(\p{Script=Latin})\p{M}+/gu, "$1").normalize("NFC").toLowerCase().match(/[\p{L}\p{M}\p{N}]+/gu)?.join(" ") || "";
const uuid = /^musicbrainz:artist:[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const forms = new Map<string, Promise<string>>();
type Target = { id: string; kind: "artist" | "recording"; text: string; context?: string };
const terms = new Map<string, Map<string, Target>>();

async function roman(value: string): Promise<string> {
  if (!indic.test(value)) return value;
  if (!forms.has(value)) {
    if (forms.size >= 256) forms.delete(forms.keys().next().value!);
    forms.set(value, searchForm(value).catch(() => value));
  }
  return forms.get(value)!;
}
async function remember(value: string, target: Target): Promise<void> {
  if (!value.trim() || value.length > 200 || /[\p{Cc}]/u.test(value)) return;
  for (const form of new Set([key(value), key(await roman(value))])) {
    if (!form || form === key(target.text)) continue;
    if (!terms.has(form)) {
      if (terms.size >= 256) terms.delete(terms.keys().next().value!);
      terms.set(form, new Map());
    }
    const identities = terms.get(form)!;
    if (identities.size < 32 || identities.has(target.id)) identities.set(target.id, target);
  }
}
async function learn(rows: readonly CatalogTrack[], saved: readonly Track[]): Promise<void> {
  // Saved tracks lack structured artist IDs, so they can supply title forms, never inferred aliases.
  for (const row of saved.slice(-128)) {
    const id = row.metadataSourceId || row.id;
    if (isCatalogId(id) && indic.test(row.title)) await remember(row.title, { id, kind: "recording", text: row.title, context: key(await roman(row.artist)) });
  }
  for (const row of rows.slice(0, 60)) {
    if (!isCatalogId(row.id)) continue;
    if (indic.test(row.title)) await remember(row.title, { id: row.id, kind: "recording", text: row.title, context: key(await roman(row.artist)) });
    for (const credit of row.artists) {
      if (!credit.id || credit.id.includes(":name:")) continue;
      if (indic.test(credit.name)) await remember(credit.name, { id: credit.id, kind: "artist", text: credit.name });
      const metadata = row.recordingMetadata;
      if (metadata?.sourceId !== row.id || !uuid.test(credit.id)) continue;
      const names = metadata.artistAliases[credit.id];
      if (!Array.isArray(names)) continue;
      for (const name of names.slice(0, 32)) if (typeof name === "string")
        await remember(name, { id: credit.id, kind: "artist", text: credit.name });
    }
  }
}
function expansion(original: string): { query: string; bindings: Target[][] } | null {
  const words = key(original).split(" ");
  const output: string[] = [], bindings: Target[][] = [];
  for (let start = 0; start < words.length;) {
    let consumed = 0;
    for (let end = words.length; end > start; end--) {
      const found = terms.get(words.slice(start, end).join(" "));
      if (!found) continue;
      let targets = [...found.values()];
      const context = targets.filter(target => target.kind === "recording" && target.context
        && (` ${key(original)} `).includes(` ${target.context} `));
      if (context.length) targets = context;
      // A name cannot establish identity; conflicting people or scripts require more evidence.
      if (new Set(targets.map(target => key(target.text))).size !== 1 || new Set(targets.map(target => target.kind)).size !== 1
        || (targets[0].kind === "artist" && targets.length !== 1)) {
        output.push(words.slice(start, end).join(" ")); consumed = end - start; break;
      }
      output.push(targets[0].text); bindings.push(targets); consumed = end - start; break;
    }
    if (!consumed) output.push(words[start]);
    start += consumed || 1;
  }
  return bindings.length ? { query: output.join(" "), bindings } : null;
}
const creditsMatch = (row: CatalogTrack, bindings: Target[][]): boolean => bindings.every(targets => targets.some(target =>
  target.kind === "recording" ? row.id === target.id : row.artists.some(credit => credit.id === target.id)));
async function literalMatch(query: string, row: CatalogTrack): Promise<boolean> {
  const wanted = key(await roman(query)).split(" ");
  const available = key(await roman(`${row.title} ${row.artist}`)).split(" ");
  return wanted.every(word => available.some(candidate => candidate.startsWith(word)));
}

export interface SearchRetrievalOptions {
  knownTracks?: readonly Track[];
  signal?: AbortSignal;
  onExpandedArtists?: (artists: CatalogArtist[]) => void;
}
export async function searchRetrieval(query: string, limit: number | undefined, search: (query: string, limit?: number) => Promise<CatalogTrack[]>, options: SearchRetrievalOptions = {}): Promise<CatalogTrack[]> {
  const original = query.normalize("NFC").trim().slice(0, 200);
  const count = Math.max(1, Math.min(60, limit ?? 20));
  if (!key(original) || key(original).split(" ").length > 12 || options.signal?.aborted) return [];
  const rows = await search(original, count);
  if (options.signal?.aborted) return rows;
  await learn(rows, options.knownTracks || []);
  if (options.signal?.aborted) return rows;
  const plan = expansion(await roman(original)) || expansion(original);
  const expanded = plan && key(plan.query) !== key(original) ? plan : null;
  if (rows.length >= Math.min(count, 5) && (!expanded || rows.some(row => creditsMatch(row, expanded.bindings)))) return rows;
  const recovery = expanded?.query || await roman(original);
  if (key(recovery) === key(original) || recovery.length > 200 || options.signal?.aborted) return rows;
  // One native request evaluates the expanded terms, so the original-script relevance gate cannot discard them.
  try {
    const extra = await search(recovery, count);
    if (options.signal?.aborted) return rows;
    const seen = new Set(rows.map(row => row.id));
    const accepted: CatalogTrack[] = [];
    for (const row of extra.slice(0, count)) {
      if (seen.has(row.id) || (expanded && !creditsMatch(row, expanded.bindings)) || !await literalMatch(recovery, row)) continue;
      if (options.signal?.aborted) return rows;
      accepted.push(row); seen.add(row.id);
    }
    await learn(accepted, []);
    if (options.signal?.aborted) return rows;
    const artistIds = new Set(expanded?.bindings.flat().filter(target => target.kind === "artist").map(target => target.id));
    const artists = new Map<string, CatalogArtist>();
    for (const row of accepted) for (const credit of row.artists) {
      if (credit.id && !credit.id.includes(":name:") && artistIds.has(credit.id))
        artists.set(credit.id, { id: credit.id, name: credit.name, artworkUrl: null });
    }
    if (artists.size) options.onExpandedArtists?.([...artists.values()]);
    return (expanded && !rows.some(row => creditsMatch(row, expanded.bindings)) ? [...accepted, ...rows] : [...rows, ...accepted]).slice(0, count);
  } catch { return rows; }
}
