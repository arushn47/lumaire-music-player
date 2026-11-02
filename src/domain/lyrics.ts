import type { LyricDocument, LyricLine } from "./types";

function enhancedLine(body: string, start: number): Pick<LyricLine, "text" | "words"> {
  const markers = [...body.matchAll(/<(\d{1,3}):([0-5]\d)(?:[.:](\d{1,3}))?>/g)];
  const text = body.replace(/<\d{1,3}:[0-5]\d(?:[.:]\d{1,3})?>/g, "");
  if (!markers.length) return { text };
  const times = markers.map(m => (Number(m[1]) * 60 + Number(m[2])) * 1000 + Number((m[3] || "").padEnd(3, "0")));
  // Unmarked prefixes and backwards clocks cannot be assigned genuine word timings.
  if (body.slice(0, markers[0].index).trim() || times.some((t, i) => t < start || (i > 0 && t < times[i - 1]))) return { text };
  const words = markers.flatMap((m, i) => {
    const value = body.slice(m.index! + m[0].length, markers[i + 1]?.index ?? body.length);
    return value ? [{ time: times[i], end: times[i + 1], text: value }] : [];
  });
  return words.length && words.map(w => w.text).join("") === text ? { text, words } : { text };
}

export function wordProgress(word: NonNullable<LyricLine["words"]>[number], clock: number): number {
  if (!Number.isFinite(clock) || clock < word.time) return 0;
  // A final word without an explicit end gets a discrete highlight, never an invented duration.
  return word.end !== undefined && word.end > word.time ? Math.min(1, (clock - word.time) / (word.end - word.time)) : 1;
}

// Source line IDs depend on source order/occurrence, never on a timing offset or supplied variant.
export function parseLyrics(raw: string, fileName = "Lyrics"): LyricDocument {
  if (raw.length > 1_048_576)
    throw new Error("Lyric files must be smaller than 1 MB.");
  const lines: LyricDocument["lines"] = [],
    warnings: string[] = [];
  let fileOffset = 0,
    offsetTags = 0,
    timed = false;
  const text = raw.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  text.split("\n").forEach((line, index) => {
    const offset = line.match(/^\[offset:([+-]?\d+)\]\s*$/i);
    if (offset) {
      const value = Number(offset[1]);
      if (Number.isSafeInteger(value) && Math.abs(value) <= 86400000) {
        fileOffset = value;
        offsetTags++;
      } else
        warnings.push(
          `Line ${index + 1}: file offset is outside the supported one-day range.`,
        );
      return;
    }
    if (/^\[(ar|ti|al|by|length|re|ve):.*\]\s*$/i.test(line)) return;
    const stamps = [
      ...line.matchAll(/\[(\d{1,3}):([0-5]\d)(?:[.:](\d{1,3}))?\]/g),
    ];
    if (stamps.length) {
      timed = true;
      const body = line
        .replace(/\[\d{1,3}:[0-5]\d(?:[.:]\d{1,3})?\]/g, "")
        .trim();
      stamps.forEach((s, occurrence) =>
        lines.push({
          id: `l${index}-${occurrence}`,
          time:
            (Number(s[1]) * 60 + Number(s[2])) * 1000 +
            Number((s[3] || "").padEnd(3, "0")),
          ...enhancedLine(body, (Number(s[1]) * 60 + Number(s[2])) * 1000 + Number((s[3] || "").padEnd(3, "0"))),
        }),
      );
    } else if (line.trim()) {
      if (/^\[\s*(?:\d|offset:)/i.test(line))
        warnings.push(
          `Line ${index + 1}: unsupported or invalid timestamp; shown as text.`,
        );
      lines.push({ id: `l${index}-0`, time: null, text: line.trim() });
    }
  });
  if (offsetTags > 1)
    warnings.push("Multiple file offsets: the last valid offset is used.");
  if (timed) lines.sort((a, b) => (a.time ?? Infinity) - (b.time ?? Infinity));
  // Vocal lines can overlap; only the word sequence within each line must be ordered.
  if (!lines.length) throw new Error("The file contains no lyric lines.");
  return {
    id: crypto.randomUUID(),
    raw,
    fileName,
    lines,
    fileOffset,
    userOffset: 0,
    warnings,
    romanisation: {},
    translation: {},
    timingMode: timed ? "synced" : "unsynced",
  };
}

export function activeLine(doc: LyricDocument, mediaMs: number): string | null {
  if (doc.timingMode === "unsynced") return null;
  const clock = mediaMs - doc.fileOffset - doc.userOffset;
  let active: string | null = null;
  for (const line of doc.lines)
    if (line.time !== null && line.time <= clock) active = line.id;
  return active;
}

export function synchronizedLyrics(
  doc: LyricDocument,
  duration: number,
): boolean {
  if (
    doc.timingMode === "unsynced" ||
    doc.instrumental ||
    !doc.lines.some((line) => line.time !== null)
  )
    return false;
  // Legacy cached documents may contain LRC from a different-duration edition.
  if (
    doc.source &&
    (!Number.isFinite(duration) || !Number.isFinite(doc.source.duration) || duration <= 0 || doc.source.duration <= 0 || Math.abs(doc.source.duration - duration) > 2)
  )
    return false;
  return !doc.lines.some(
    (line) =>
      duration > 0 && ((line.time !== null && line.time + doc.fileOffset > (duration + 2) * 1000) || line.words?.some(word => (word.end ?? word.time) + doc.fileOffset > (duration + 2) * 1000)),
  );
}

export function lyricsVersionMatches(doc: LyricDocument, title: string): boolean {
  if (!doc.source || doc.origin === 'imported') return true;
  const labels=(value:string)=>[...new Set((value.match(/\b(?:live|remix|acoustic|instrumental|karaoke|cover|demo|remaster(?:ed)?|radio\s+edit|extended|slowed|sped\s+up|female|male)\b/gi)||[]).map(label=>label.toLowerCase()))].sort().join('|');
  return labels(doc.source.title)===labels(title);
}

/** Approximate reading position only. Never assign timestamps or enable seeking. */
export function estimatedFollowLine(
  doc: LyricDocument,
  time: number,
  duration: number,
): string | null {
  if (
    !Number.isFinite(time) ||
    !Number.isFinite(duration) ||
    duration <= 0 ||
    doc.instrumental
  )
    return null;
  const lines = doc.lines.filter((line) => line.text.trim());
  if (!lines.length) return null;
  const progress = Math.max(0, Math.min(1, time / duration));
  const weights = lines.map((line) =>
    Math.max(1, Array.from(line.text.trim()).length),
  );
  const target = progress * weights.reduce((sum, weight) => sum + weight, 0);
  let read = 0;
  for (let i = 0; i < lines.length; i++) {
    read += weights[i];
    if (target < read) return lines[i].id;
  }
  return lines.at(-1)!.id;
}

export function normalizeCachedLyrics(
  doc: LyricDocument,
  duration: number,
): LyricDocument {
  if (doc.raw.length <= 1_048_576 && /<\d{1,3}:[0-5]\d(?:[.:]\d{1,3})?>/.test(doc.raw)) {
    const parsed = parseLyrics(doc.raw, doc.fileName);
    const source = new Map(parsed.lines.map(line => [line.id, line]));
    let changed = false;
    const lines = doc.lines.map(line => {
      const original = source.get(line.id);
      if (!original || original.time !== line.time || original.text !== line.text.replace(/<\d{1,3}:[0-5]\d(?:[.:]\d{1,3})?>/g, "")) return line;
      if (original.text === line.text && JSON.stringify(original.words) === JSON.stringify(line.words)) return line;
      changed = true;
      return { ...line, text: original.text, words: original.words };
    });
    if (changed) doc = { ...doc, lines };
  }
  // Older parsers mistook section labels such as [Chorus: Singer] for timestamps.
  const sourceLines = doc.raw.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").split("\n");
  const cleanedWarnings = doc.warnings.filter(warning => {
    const match = warning.match(/^Line (\d+): unsupported or invalid timestamp; shown as text\.$/);
    return !match || /^\[\s*(?:\d|offset:)/i.test(sourceLines[Number(match[1]) - 1] || "");
  });
  if (cleanedWarnings.length !== doc.warnings.length) doc = { ...doc, warnings: cleanedWarnings };
  if (!doc.source) return doc; // Preserve explicitly imported local documents.
  const unsynced = !synchronizedLyrics(
    { ...doc, timingMode: "synced" },
    duration,
  );
  const warnings = doc.warnings.filter(
    (warning) => !warning.startsWith("The selected lyric recording is "),
  );
  const timingMode = unsynced ? "unsynced" : "synced";
  if (timingMode === doc.timingMode && warnings.length === doc.warnings.length)
    return doc;
  return {
    ...doc,
    warnings,
    timingMode,
  };
}

export function upgradeSyncedLyrics(current: LyricDocument, fresh: LyricDocument, duration: number): LyricDocument {
  if ((!current.source && current.origin !== "provider") || synchronizedLyrics(current, duration) || !synchronizedLyrics(fresh, duration)) return current;
  const oldLines = current.lines.filter(line => line.text.trim());
  const newLines = fresh.lines.filter(line => line.text.trim());
  const aligned = oldLines.length === newLines.length && oldLines.every((line, i) => line.text.normalize("NFKC").trim() === newLines[i].text.normalize("NFKC").trim());
  if (!aligned) return current.translationSource === "imported" || current.romanisationSource === "imported" ? current : fresh;
  const remap = <T,>(values: Record<string, T>): Record<string, T> => Object.fromEntries(oldLines.flatMap((line, i) => values[line.id] === undefined ? [] : [[newLines[i].id, values[line.id]]]));
  return { ...current, ...fresh, userOffset: current.userOffset,
    romanisation: remap(current.romanisation), translation: remap(current.translation),
    localRomanisation: current.localRomanisation && remap(current.localRomanisation),
    lineLanguages: current.lineLanguages && remap(current.lineLanguages),
    romanisationSource: current.romanisationSource, translationSource: current.translationSource,
    processedModel: current.processedModel, languageSource: current.languageSource, englishOnly: current.englishOnly,
  };
}

// A supplied LRC must have identical occurrence timestamps. Plain text requires explicit row confirmation.
export function alignVariant(
  original: LyricDocument,
  supplied: LyricDocument,
): Record<string, string> {
  if (original.lines.length !== supplied.lines.length)
    throw new Error(
      `Line count differs (${original.lines.length} original, ${supplied.lines.length} supplied). Attach a variant with one matching row per original line.`,
    );
  const timed = supplied.lines.some((l) => l.time !== null);
  if (timed && supplied.lines.some((l, i) => l.time !== original.lines[i].time))
    throw new Error(
      "The supplied timestamps differ from the original. Use matching LRC timestamps, or a plain text file with one row per line.",
    );
  return Object.fromEntries(
    original.lines.map((l, i) => [l.id, supplied.lines[i].text]),
  );
}
