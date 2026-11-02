import { romanizeForeign } from "./foreign-romanization";
import type { LyricDocument } from "./types";

const scripts: [number, number, string][] = [
  [0x0900, 0x097f, "devanagari"],
  [0x0980, 0x09ff, "bengali"],
  [0x0a00, 0x0a7f, "gurmukhi"],
  [0x0a80, 0x0aff, "gujarati"],
  [0x0b00, 0x0b7f, "oriya"],
  [0x0b80, 0x0bff, "tamil"],
  [0x0c00, 0x0c7f, "telugu"],
  [0x0c80, 0x0cff, "kannada"],
  [0x0d00, 0x0d7f, "malayalam"],
  [0x0d80, 0x0dff, "sinhala"],
];
const runs =
  /[\u0900-\u097f][\u0900-\u097f\u200c\u200d]*|[\u0980-\u09ff][\u0980-\u09ff\u200c\u200d]*|[\u0a00-\u0a7f][\u0a00-\u0a7f\u200c\u200d]*|[\u0a80-\u0aff][\u0a80-\u0aff\u200c\u200d]*|[\u0b00-\u0b7f][\u0b00-\u0b7f\u200c\u200d]*|[\u0b80-\u0bff][\u0b80-\u0bff\u200c\u200d]*|[\u0c00-\u0c7f][\u0c00-\u0c7f\u200c\u200d]*|[\u0c80-\u0cff][\u0c80-\u0cff\u200c\u200d]*|[\u0d00-\u0d7f][\u0d00-\u0d7f\u200c\u200d]*|[\u0d80-\u0dff][\u0d80-\u0dff\u200c\u200d]*/g;

// Familiar spellings from TuneScript 4010e3b's offline transliterator, using
// Sanscript for the wider script coverage and conjunct/nukta handling.
function readableRoman(text: string, script?: string): string {
  const spelling: Record<string, string> = {
    ā: "aa", ī: "ee", ū: "oo", ē: "ee", ō: "oo",
    ṛ: "ri", ṝ: "ree", ḷ: "l", ḹ: "ll", ḻ: "zh",
    ṅ: "ng", ñ: "ny", ṇ: "n", ṭ: "t", ḍ: "d", ṟ: "r", ṙ: "r",
    ś: "sh", ṣ: "sh", ṃ: "m", ṁ: "m", ḥ: "h", ẓ: "z", "~": "n",
    c: "ch",
    ...(script === "tamil" ? { t: "th", ṉ: "n", ṟ: "r" } : {}),
    ...(script === "malayalam" ? { ñ: "nj", ṟ: "r", t: "th" } : {}),
  };
  if (script === "gurmukhi") spelling["ṃ"] = "n";
  if (script === "bengali") spelling["ṃ"] = spelling["ṁ"] = "n";

  if (script === "tamil") spelling["ṉ"] = "n";
  const letters = Array.from(text.normalize("NFD"));
  const normalized = letters.map((letter, index) => {
    if (/\p{M}/u.test(letter)) return "";
    const marked = letters.slice(index, index + 2).join("").normalize("NFC");
    return spelling[marked] ?? spelling[letter] ?? letter;
  }).join("");
  const readable = script === "malayalam"
    ? normalized.replace(/ñc/g, "nc").replace(/ē/g, "e").replace(/ō/g, "o").replace(/ṟ/g, "r").replace(/ñ/g, "nj")
    : normalized;
  return readable;
}

/** Offline script fallback; Gemini supplies contextual pronunciation when configured. */
export async function romanizeDocument(
  doc: LyricDocument,
): Promise<Record<string, string>> {
  if (!doc.lines.some(line => /(?!\p{Script=Latin})\p{L}/u.test(line.text))) return {};
  const { default: Sanscript } =
    await import("@indic-transliteration/sanscript");
  if (!Sanscript.schemes.lumaire_tamil) {
    const tamil = structuredClone(Sanscript.schemes.tamil);
    // Tamil collapses Sanskrit k/kh/g/gh to க. Sanscript's reverse map picks
    // the last alias (gh), producing vaṇaghgham. Keep each native consonant's
    // first, unaspirated mapping in our own scheme without mutating the library.
    for (const group of ["consonants", "extra_consonants"]) {
      const seen = new Set<string>();
      tamil[group] = Object.fromEntries(
        Object.entries(tamil[group]).filter(([, value]) => {
          if (seen.has(value)) return false;
          seen.add(value);
          return true;
        }),
      );
    }
    Sanscript.addBrahmicScheme("lumaire_tamil", tamil);
    const roman = structuredClone(Sanscript.schemes.iast);
    Object.assign(roman.vowels, { ऎ: "e", ए: "ē", ऒ: "o", ओ: "ō" });
    Object.assign(roman.vowel_marks, {
      "ॆ": "e",
      "े": "ē",
      "ॊ": "o",
      "ो": "ō",
    });
    roman.consonants["ळ"] = "ḷ";
    Sanscript.addRomanScheme("lumaire_tamil_roman", roman);
    const malayalam = structuredClone(roman);
    malayalam.consonants["ऱ"] = "ṟ";
    Sanscript.addRomanScheme("lumaire_malayalam_roman", malayalam);
  }
  for (const script of [...scripts.map(([, , name]) => name), "assamese"]) {
    if (script === "tamil" || Sanscript.schemes[`lumaire_${script}`]) continue;
    const scheme = structuredClone(Sanscript.schemes[script]);
    // The upstream Brahmic reader consumes one character at a time. Internal
    // single-character tokens let it handle multi-character nukta consonants
    // while retaining their existing Roman targets and following vowel marks.
    Object.entries(scheme.extra_consonants ?? {}).forEach(
      ([key, value], index) => {
        if (value.length > 1)
          scheme.extra_consonants[key] = String.fromCharCode(0xe000 + index);
      },
    );
    Sanscript.addBrahmicScheme(`lumaire_${script}`, scheme);
  }

  if (!Sanscript.schemes.lumaire_devanagari_roman) {
    const roman = structuredClone(Sanscript.schemes.iast);
    roman.yogavaahas["ं"] = "n";
    roman.yogavaahas["ँ"] = "n";
    Sanscript.addRomanScheme("lumaire_devanagari_roman", roman);
  }
  const result: Record<string, string> = {};
  const japanese = doc.lines.some(item => /[\u3040-\u30ff]/.test(item.text)) || Object.values(doc.lineLanguages ?? {}).flat().some(code => /^(?:ja|jpn)(?:-|$)/i.test(code));
  for (const line of doc.lines) {
    const spoken: string[] = [];
    const academic = line.text.replace(runs, (run) => {
      const code = run.codePointAt(0)!;
      const script = /[ৰৱ]/.test(run) ? "assamese" : scripts.find(
        ([first, last]) => code >= first && code <= last,
      )?.[2];
      let text = run.replace(/[\u200c\u200d]/g, "").normalize("NFC");
      if (script === "malayalam") {
        const chillus: Record<string, string> = { "ൺ": "ണ്", "ൻ": "ന്", "ർ": "ര്", "ൽ": "ല്", "ൾ": "ള്", "ൿ": "ക്", "ൔ": "മ്", "ൕ": "യ്", "ൖ": "ഴ്" };
        text = text.replace(/[ൺൻർൽൾൿൔൕൖ]/g, letter => chillus[letter]).replaceAll("ൗ", "ൌ");
      }
      // NFC deliberately leaves several nukta letters decomposed. Sanscript's
      // maps contain their precomposed spelling; restore those exact tokens so
      // Hindi/Bengali/Punjabi diacritics don't leak into the Latin layer.
      if (script)
        for (const value of Object.values(
          Sanscript.schemes[script].extra_consonants ?? {},
        )) {
          const decomposed = value.normalize("NFD");
          if (decomposed !== value) text = text.replaceAll(decomposed, value);
        }
      if (script && script !== "tamil")
        for (const [key, value] of Object.entries(
          Sanscript.schemes[script].extra_consonants ?? {},
        )) {
          const token =
            Sanscript.schemes[`lumaire_${script}`].extra_consonants[key];
          if (token !== value) text = text.replaceAll(value, token);
        }
      const transliterated = script
        ? Sanscript.t(
            text,
            `lumaire_${script}`,
            script === "tamil" ? "lumaire_tamil_roman" : script === "malayalam" ? "lumaire_malayalam_roman" : script === "devanagari" ? "lumaire_devanagari_roman" : "iast",
          )
        : run;
      const pronunciation = script === "bengali"
        ? readableRoman(transliterated.replace(/vāṃ/g, "baaṅ").replace(/~/g, "n"), script).replace(/ṅ/g, "n")
        : script === "devanagari"
          ? readableRoman(transliterated.replace(/~/g, "n"), script)
              .replace(/(?<=[bcdfghjklmnpqrstvwxyz])a(?=$|\s|[,.;!?])/g, "")
              .replace(/(?<=[bcdfghjklmnpqrstvwxyz])(?=\s|[,.;!?]|$)/g, "")
          : script === "malayalam"
            ? readableRoman(transliterated.replace(/ñc/g, "nc").replace(/ē/g, "e").replace(/ō/g, "o").replace(/ṟ/g, "r").replace(/ñ/g, "nj"), script)
                .replace(/(?<=th)o(?=v)/g, "oo")
            : readableRoman(transliterated, script);
      spoken.push(pronunciation);
      return pronunciation;
    });
    let runIndex = 0;
    const roman = (await romanizeForeign([line.text.replace(runs, () => spoken[runIndex++])], japanese))[0];
    const existing = doc.romanisation[line.id];
    if (existing) {
      // Repair only an exact old generated value. Different supplied text is
      // preserved; concurrent manual changes are guarded by the caller too.
      const legacy = line.text.replace(runs, (run) => {
        const code = run.codePointAt(0)!;
        const script = /[ৰৱ]/.test(run) ? "assamese" : scripts.find(
          ([first, last]) => code >= first && code <= last,
        )?.[2];
        return script ? Sanscript.t(run, script, "iast") : run;
      });
      if (
        doc.romanisationSource === "gemini" ||
        doc.romanisationSource === "google" ||
        doc.romanisationSource === "imported"
      )
        continue;
      const legacyReadable = line.text.replace(runs, run => {
        const code = run.codePointAt(0)!;
        const script = /[ৰৱ]/.test(run) ? "assamese" : scripts.find(([first, last]) => code >= first && code <= last)?.[2];
        return script ? readableRoman(Sanscript.t(run, script, "iast"), script) : run;
      });
      if (
        existing !== legacy &&
        existing !== academic &&
        existing !== legacyReadable &&
        existing !== doc.localRomanisation?.[line.id]
      )
        continue;
      if (roman === existing) continue;
    }
    if (roman !== line.text) result[line.id] = roman;
  }
  return result;
}
