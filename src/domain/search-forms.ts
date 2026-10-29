import { searchRoman } from "./source-matching";

const runs = /[\u0900-\u097f]+|[\u0980-\u09ff]+|[\u0a00-\u0a7f]+|[\u0a80-\u0aff]+|[\u0b00-\u0b7f]+|[\u0b80-\u0bff]+|[\u0c00-\u0c7f]+|[\u0c80-\u0cff]+|[\u0d00-\u0d7f]+|[\u0d80-\u0dff]+/g;
/** Search candidates only; never rewrite recording metadata or playback verification. */
export async function searchForm(value: string): Promise<string> {
  const text = value.normalize("NFC").replace(/[\u200c\u200d]/g, "");
  const spans = [...text.matchAll(runs)];
  const converted = await Promise.all(spans.map(async ([run]) => {
    if (!/[\u0b80-\u0bff]/.test(run)) return searchRoman(run);
    const { default: Sanscript } = await import("@indic-transliteration/sanscript");
    if (!Sanscript.schemes.lumaire_search_tamil) {
      const scheme = structuredClone(Sanscript.schemes.tamil);
      // Reuse the existing lyric transliterator's first-mapping rule: க must not become gh.
      for (const group of ["consonants", "extra_consonants"]) {
        const seen = new Set<string>();
        scheme[group] = Object.fromEntries(Object.entries(scheme[group]).filter(([, native]) => {
          if (seen.has(native)) return false;
          seen.add(native); return true;
        }));
      }
      Sanscript.addBrahmicScheme("lumaire_search_tamil", scheme);
    }
    return Sanscript.t(run, "lumaire_search_tamil", "iast");
  }));
  let index = 0;
  return text.replace(runs, () => converted[index++]).normalize("NFKD").replace(/(\p{Script=Latin})\p{M}+/gu, "$1");
}
