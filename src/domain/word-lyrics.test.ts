import { describe, expect, it } from "vitest";
import { parseLyrics, wordProgress, activeLine, normalizeCachedLyrics, synchronizedLyrics, lyricsVersionMatches } from "./lyrics";

describe("genuine Enhanced LRC", () => {
  it('does not reuse provider lyrics from another version but preserves explicitly imported originals',()=>{
    const doc=parseLyrics('[00:01]Fixture');
    doc.source={provider:'lrclib',recordId:1,title:'Despacito (feat. Justin Bieber) [Remix]',artist:'Luis Fonsi',duration:230};
    expect(lyricsVersionMatches(doc,'Despacito')).toBe(false);
    expect(lyricsVersionMatches(doc,'Despacito [Remix]')).toBe(true);
    expect(lyricsVersionMatches({...doc,origin:'imported'},'Despacito')).toBe(true);
  });
  it('validates provider file offsets and word endings without changing manual offsets',()=>{
    const doc=parseLyrics('[offset:3000]\n[00:09.500]Fixture');
    doc.source={provider:'lrclib',recordId:1,title:'Fixture',artist:'Artist',duration:10};
    expect(synchronizedLyrics(doc,10)).toBe(false);
    expect(synchronizedLyrics({...doc,fileOffset:0,userOffset:3000},10)).toBe(true);
    expect(synchronizedLyrics({...doc,fileOffset:0,source:{...doc.source,duration:NaN}},10)).toBe(false);
    const words=parseLyrics('[00:01]<00:01>Fixture<00:13>');words.source=doc.source;
    expect(synchronizedLyrics(words,10)).toBe(false);
  });
  it("keeps word timestamps when a second vocal line starts before the first ends", () => {
    const doc = parseLyrics("[01:01.74]<01:01.74>Main <01:02.28>voice <01:05.37>continues<01:06.06>\n[01:05.89]<01:05.89>Backing <01:06.25>voice<01:07.40>");
    expect(doc.lines[0].words).toHaveLength(3);
    expect(doc.lines[0].words?.at(-1)?.end).toBe(66060);
    expect(doc.lines[1].words).toHaveLength(2);
    expect(activeLine(doc, 65950)).toBe(doc.lines[1].id);
  });
  it("repairs cached stripped word timing without replacing variants, IDs, or user offsets", () => {
    const doc = parseLyrics("[00:01]<00:01>Lead <00:02>voice<00:04>\n[00:03]<00:03>Backing<00:05>");
    delete doc.lines[0].words;
    doc.translation = {"l0-0": "Meaning"};
    doc.userOffset = 250;
    const restored = normalizeCachedLyrics(doc, 10);
    expect(restored.lines[0].words).toHaveLength(2);
    expect(restored.id).toBe(doc.id);
    expect(restored.translation).toBe(doc.translation);
    expect(restored.userOffset).toBe(250);
    expect(normalizeCachedLyrics(restored, 10)).toBe(restored);
  });
  it("accepts simultaneous vocals but still rejects word timing beyond recording duration", () => {
    const doc = parseLyrics("[00:01]<00:01>Voice one<00:04>\n[00:01]<00:01>Voice two<00:03>");
    expect(doc.lines.every(line => line.words?.length)).toBe(true);
    expect(synchronizedLyrics(doc, 10)).toBe(true);
    expect(synchronizedLyrics(parseLyrics("[00:01]<00:01>Outside recording<01:00>"), 10)).toBe(false);
  });
  it("does not replace edited text while recovering missing cached timing", () => {
    const doc = parseLyrics("[00:01]<00:01>Original<00:03>");
    delete doc.lines[0].words;
    doc.lines[0].text = "Edited text";
    expect(normalizeCachedLyrics(doc, 10)).toBe(doc);
  });
  it.each(["Hello world", "வணக்கம் உலகம்", "नमस्ते दुनिया", "こんにちは 世界", "مرحبا عالم"])("preserves Unicode and exact spaces: %s", text => {
    const [first, second] = text.split(" ");
    const doc = parseLyrics(`[00:01]<00:01>${first} <00:02>${second}<00:03>`);
    expect(doc.lines[0].text).toBe(text);
    expect(doc.lines[0].words?.map(w => w.text).join("")).toBe(text);
    expect(wordProgress(doc.lines[0].words![0], 1500)).toBe(.5);
  });
  it("recomputes on backward seeks and respects document offsets", () => {
    const doc = parseLyrics("[offset:100]\n[00:01]<00:01>One <00:02>two<00:03>");
    doc.userOffset = 200;
    const word = doc.lines[0].words![1];
    expect(wordProgress(word, 2800 - doc.fileOffset - doc.userOffset)).toBe(.5);
    expect(wordProgress(word, 1300 - doc.fileOffset - doc.userOffset)).toBe(0);
    expect(activeLine(doc, 1299)).toBe(null);
  });
  it("does not invent timings for prefixes, backwards markers, plain text or line LRC", () => {
    for (const raw of ["plain", "[00:01]line", "[00:01]prefix<00:02>word", "[00:01]<00:02>a<00:01>b"]) expect(parseLyrics(raw).lines[0].words).toBeUndefined();
    expect(wordProgress({time: 1000, text: "final"}, 1000)).toBe(1);
  });
  it("upgrades cached enhanced text without losing aligned variants", () => {
    const doc = parseLyrics("[00:01]<00:01>Hello<00:02>");
    delete doc.lines[0].words;
    doc.lines[0].text = "<00:01>Hello<00:02>";
    doc.translation = {"l0-0": "Bonjour"};
    const upgraded = normalizeCachedLyrics(doc, 10);
    expect(upgraded.lines[0].words).toHaveLength(1);
    expect(upgraded.translation).toEqual(doc.translation);
  });
});
