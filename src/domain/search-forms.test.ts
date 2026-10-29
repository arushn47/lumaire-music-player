import { expect, it } from "vitest";
import { searchForm } from "./search-forms";
it.each([
 ["Hindi", "नमस्ते", "namaste"], ["Marathi", "नमस्ते", "namaste"],
 ["Tamil", "வணக்கம்", "vanakkam"], ["Telugu", "నమస్కారం", "namaskaram"],
 ["Malayalam", "നമസ്കാരം", "namaskaram"], ["Kannada", "ನಮಸ್ಕಾರ", "namaskara"],
 ["Bengali", "নমস্কার", "namaskara"], ["Punjabi", "ਸਤਿ", "sati"],
 ["Gujarati", "નમસ્તે", "namaste"], ["Odia", "ନମସ୍କାର", "namaskara"],
])("generates a bounded search form for %s without changing Latin tokens", async (_,native,roman) => {
 expect(await searchForm(`${native} Singer`)).toBe(`${roman} Singer`);
});
it("segments adjacent scripts independently and preserves NFC vowel signs", async()=>{
 expect(await searchForm("नमस्तेவணக்கம் Singer")).toBe("namastevanakkam Singer");
 expect(await searchForm("नमस्\u200dते Singer")).toBe("namaste Singer");
 expect(await searchForm("Café")).toBe("Cafe");
});
