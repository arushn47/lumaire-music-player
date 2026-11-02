import type { CatalogTrack, YtdlpSearchResult } from "../adapters/native";
import { cleanVideoTitle, metadataQueries, youtubeTrack } from "./online-track";
import { canonicalArtistCredit } from "./catalog-links";

const words = (text: string): string => text.normalize("NFKD").replace(/(\p{Script=Latin})\p{M}+/gu, "$1").toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, " ").trim().replace(/\b([a-z]) (?=[a-z](?: |$))/g, "$1");
const identity = (text: string): string => words(text).replaceAll(" ", "");
const versions = /\b(cover|remix|live|performance|mashup|rework|slowed|sped|nightcore|instrumental|karaoke|acoustic|reprise|remaster(?:ed)?|sped up)\b/gi;

export function sourceTitle(text: string): string {
  return cleanVideoTitle(text.replace(/\s+(?:Tamil|Telugu|Hindi|Malayalam|Kannada|Bengali|Punjabi)\s+lyric(?:s|al)?(?=\s*(?:[|｜]|$))/gi, ""))
    .replace(/\s*(?:[-–—]\s*)?(?:[([]from\s+|from\s+["“]).*$/i, "")
    .replace(/\s+[([]?(?:feat\.?|ft\.?|featuring)\s+.*$/i, "")
    .replace(/\s*(?:[-–—:]\s*)?[([]?(?:(?:full|official)\s+)?(?:video\s+song|lyrical\s+video|full\s+audio|audio\s+song)[)\]]?.*$/i, "")
    .trim();
}

export function sourceCoreTitle(text: string): string {
  const title = sourceTitle(text);
  // shortcut: only article-led subtitles and redundant Theme labels; expand with verified catalog examples.
  return title.replace(/\s*[([]([^()[\]]+)[)\]]$/, (annotation, content: string, offset: number) => {
    if (/^theme$/i.test(content) && /\btheme$/i.test(title.slice(0, offset))) return "";
    const parts = content.split(/\s+[-–—]\s+/);
    if (!/^(?:the|an?)\s+\p{L}/iu.test(parts.at(-1)!)) return annotation;
    if (parts.length === 1) return "";
    if (parts.length === 2 && parts[0].match(versions)?.join("").toLowerCase() === parts[0].toLowerCase()) return ` (${parts[0]})`;
    return annotation;
  }).trim();
}

export function sourceCredits(track: CatalogTrack): string[] {
  if (!track) return [];
  return [...new Set([...(track.artists || []).map(a => a.name), track.artist]
    .flatMap(text => canonicalArtistCredit(text).split(/\s*[,;&]\s*|\s+(?:and|feat\.?|ft\.?|featuring|x)\s+/i))
    .map(text => text.trim()).filter(text => text && !/^unknown(?: artist)?$/i.test(text)))];
}

export async function searchRoman(text: string): Promise<string> {
  if (!/[\u0900-\u0dff]/.test(text)) return text;
  const { default: Sanscript } = await import("@indic-transliteration/sanscript");
  const schemes = ["devanagari", "bengali", "gurmukhi", "gujarati", "oriya", "tamil", "telugu", "kannada", "malayalam", "sinhala"];
  return text.replace(/[\u0900-\u0dff]+/g, run => {
    const script = schemes[Math.floor((run.charCodeAt(0) - 0x0900) / 128)];
    return script ? Sanscript.t(run, script, "iast") : run;
  }).normalize("NFKD").replace(/(\p{Script=Latin})\p{M}+/gu, "$1");
}

// One spelling edit in a long Latin word covers transliteration variants without
// collapsing short Indic words, track numbers, or different recording versions.
function closeTitle(left: string, right: string): boolean {
  if (identity(left) === identity(right)) return true;
  const a = words(left).split(" "), b = words(right).split(" ");
  if (a.length !== b.length) return false;
  let edits = 0;
  return a.every((word, index) => {
    const other = b[index];
    if (word === other) return true;
    if (++edits > 1 || !/^[a-z]{6,}$/.test(word) || !/^[a-z]{6,}$/.test(other) || Math.abs(word.length - other.length) > 1) return false;
    let i = 0, j = 0, differences = 0;
    while (i < word.length && j < other.length) {
      if (word[i] === other[j]) { i++; j++; continue; }
      if (++differences > 1) return false;
      if (word.length >= other.length) i++;
      if (other.length >= word.length) j++;
    }
    return differences + (word.length - i) + (other.length - j) <= 1;
  });
}

export interface CandidateMatch { accepted: boolean; reason: string; score: number }

export async function matchSource(catalog: CatalogTrack, candidate: YtdlpSearchResult): Promise<CandidateMatch> {
  const reject = (reason: string): CandidateMatch => ({ accepted: false, reason, score: 0 });
  if (!/^[\w-]{11}$/.test(candidate.id)) return reject("invalid-id");
  const recording = `${candidate.title} ${candidate.track || ""}`;
  if (/\b(reaction|tutorial|review|interview|podcast|how to|making of|trailer)\b/i.test(recording)) return reject("non-music");
  const requestedVersions = new Set((catalog.title.match(versions) || []).map(v => v.toLowerCase()));
  const actualVersions = new Set((recording.match(versions) || []).map(v => v.toLowerCase()));
  if ([...actualVersions].some(v => !requestedVersions.has(v)) || [...requestedVersions].some(v => !actualVersions.has(v))) return reject("recording-version");
  const title = sourceTitle(catalog.title);
  const romanTitle = await searchRoman(title);
  const queries = metadataQueries(youtubeTrack(candidate));
  const quotedTitle = candidate.title.match(/[「『]([^」』]+)[」』]/)?.[1];
  const pieces = candidate.title.split(/\s*[-–—]\s*/);
  const compactTitles = pieces.flatMap((_, index) => index > 0 && [...sourceCredits(catalog), catalog.album].filter(Boolean).some(credit => identity(credit) === identity(pieces.slice(0, index).join("-"))) ? [sourceTitle(pieces.slice(index).join("-"))] : []);
  const titles = [candidate.track, quotedTitle, sourceTitle(candidate.title), ...compactTitles, ...queries.map(q => sourceTitle(q.title))].filter((t): t is string => Boolean(t));
  let titleMatch = false;
  for (const value of titles) if (closeTitle(title, value) || (/[\u0900-\u0dff]/.test(title) !== /[\u0900-\u0dff]/.test(value) && closeTitle(romanTitle, await searchRoman(value)))) { titleMatch = true; break; }
  if (!titleMatch) {
    const coreTitle = sourceCoreTitle(title), romanCoreTitle = await searchRoman(coreTitle);
    for (const value of titles) {
      const coreValue = sourceCoreTitle(value);
      if (closeTitle(coreTitle, coreValue) || (/[\u0900-\u0dff]/.test(coreTitle) !== /[\u0900-\u0dff]/.test(coreValue) && closeTitle(romanCoreTitle, await searchRoman(coreValue)))) { titleMatch = true; break; }
    }
  }
  // Catalogs join alternate song names with a dash; label uploads may use pipe segments.
  const alternateTitles = title.split(/\s+[-–—]\s+/);
  const segments = candidate.title.split("|").map(sourceTitle);
  if (!titleMatch && alternateTitles.length === 2 && alternateTitles.every(part => part.trim() && segments.some(segment => closeTitle(part, segment)))) titleMatch = true;
  if (!title || !titleMatch) return reject("title");
  const credits = sourceCredits(catalog);
  // Explicit collaboration credits must not introduce another performer into the requested recording.
  const creditSegments=pieces.filter((_,index)=>
    (index>0&&closeTitle(title,sourceTitle(pieces.slice(0,index).join('-')))) ||
    (index<pieces.length-1&&closeTitle(title,sourceTitle(pieces.slice(index+1).join('-')))));
  for (const segment of creditSegments) {
    const collaborators=segment.split(/\s+[x×&]\s+|\s+(?:feat\.?|ft\.?|featuring)\s+/i).map(value=>cleanVideoTitle(value).trim()).filter(Boolean);
    if (collaborators.length>1) {
      const allowed=new Set((await Promise.all(credits.map(async credit=>[identity(canonicalArtistCredit(credit)),identity(await searchRoman(credit))]))).flat());
      if (collaborators.some(credit=>!allowed.has(identity(canonicalArtistCredit(credit))))) return reject('additional-performer');
    }
  }
  const evidence = [candidate.artist || "", candidate.channel || "", candidate.title, ...queries.map(q => q.artist)];
  let artistMatch = false;
  for (const credit of credits) {
    const forms = [credit, await searchRoman(credit)];
    for (const field of evidence) {
      const normalized = words(canonicalArtistCredit(field).replace(/\s*-\s*Topic$|VEVO$/i, ""));
      if (forms.some(form => normalized === words(form) || (` ${normalized} `).includes(` ${words(form)} `))) artistMatch = true;
    }
  }
  // Labels often abbreviate a multi-part performer to a first name. Require an
  // exact album segment as independent evidence; never accept a first name alone.
  if (!artistMatch && catalog.album) {
    const segments = candidate.title.split("|").map(words);
    const albumMatch = segments.includes(words(catalog.album));
    artistMatch = albumMatch && credits.some(credit => {
      const parts = words(credit).split(" ");
      return parts.length >= 2 && parts[0].length >= 5 && segments.includes(parts[0]);
    });
  }
  const missingArtistMetadata = !candidate.artist?.trim() && /^(?:Release|Various Artists|Unknown Artist)\s*-\s*Topic$/i.test(candidate.channel || "");
  if (!artistMatch && !missingArtistMetadata) return reject("artist");
  if (candidate.duration === null || !Number.isFinite(candidate.duration) || candidate.duration <= 0) return reject(!artistMatch && missingArtistMetadata ? "artist-metadata-missing" : "duration-missing");
  const difference = Math.abs(candidate.duration - catalog.duration);
  if (catalog.duration > 0 && catalog.duration - candidate.duration > Math.max(5, catalog.duration * 0.02)) return reject("duration");
  const artistChannel = credits.some(credit => identity(canonicalArtistCredit(candidate.channel || "").replace(/\s*-\s*Topic$|VEVO$/i, "")) === identity(credit));
  const video = /\b(?:official (?:music )?video|video song|full video)\b/i.test(candidate.title) && artistChannel;
  const tolerance = video && candidate.duration > catalog.duration ? Math.min(60, Math.max(30, catalog.duration * 0.25)) : Math.max(30, catalog.duration * 0.15);
  if (catalog.duration > 0 && difference > tolerance) return reject("duration");
  if (!artistMatch) return reject("artist-metadata-missing");
  return { accepted: true, reason: "matched", score: difference + (candidate.track ? 0 : 2) };
}
