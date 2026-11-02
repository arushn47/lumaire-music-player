import { describe, expect, it } from "vitest";
import { parseLyrics } from "./lyrics";
import { romanizeDocument } from "./romanization";

describe("romanization quality and alignment", () => {
  it.each([
    ["नमस्ते", "namaste"],
    ["নমস্কার", "namaskaara"],
    ["ਸਤਿ", "sati"],
    ["નમસ્તે", "namaste"],
    ["ନମସ୍କାର", "namaskaara"],
    ["வணக்கம்", "vanakkam"],
    ["నమస్కారం", "namaskaaram"],
    ["ನಮಸ್ಕಾರ", "namaskaara"],
    ["നമസ്കാരം", "namaskaaram"],
    ["ආයුබෝවන්", "aayubovan"],
  ])(
    "transliterates %s without dropping characters",
    async (text, expected) => {
      const doc = parseLyrics(`[00:01]${text}`);
      expect(await romanizeDocument(doc)).toEqual({
        [doc.lines[0].id]: expected,
      });
      expect(doc.lines[0].text).toBe(text);
      expect(doc.lines[0].time).toBe(1000);
    },
  );



  it("romanizes Telugu without consulting Devanagari scheme fields", async () => {
    const doc = parseLyrics("కిట్టని చూపులుగా\nచుట్టాలంతో కొండరుమ్దాలిగా?");
    const roman = await romanizeDocument(doc);
    expect(Object.values(roman)).toHaveLength(2);
    for (const value of Object.values(roman)) {
      expect(value).toMatch(/[a-z]/i);
      expect(value).not.toMatch(/[\u0c00-\u0c7f]/);
    }
  });
  it("uses ASCII-friendly spellings for Devanagari and Bengali long vowels and diacritics", async () => {
    const doc = parseLyrics("हाथों में चाँदनी, मैं हूँ\nবাংলা চাঁদ নীল পৃথিবী");
    const roman = await romanizeDocument(doc);
    expect(Object.values(roman)).toEqual([
      "haathon men chaandanee, main hoon",
      "baanglaa chaanda neela prithivee",
    ]);
    for (const value of Object.values(roman)) expect(value).toMatch(/^[\x00-\x7f]*$/);
  });
  it("preserves English text and punctuation in mixed-script lyrics", async () => {
    const doc = parseLyrics("मैं café, hello!\nEnglish only");
    const roman = await romanizeDocument(doc);
    expect(roman[doc.lines[0].id]).toBe("main café, hello!");
    expect(roman[doc.lines[1].id]).toBeUndefined();
    expect(doc.lines.map(line => line.time)).toEqual([null, null]);
  });
  it("converts Devanagari nasal tildes and removes extra word-final schwas", async () => {
    const doc = parseLyrics("मैं वहाँ से हूँ आया\nक्योंकि चाहिए उसे चाहिए मोरे दी\nरंग संगीता\nहर दम, करवाता लून भी मिलो\nये रंगता काजल तेरे");
    const roman = await romanizeDocument(doc);
    expect(Object.values(roman)).toEqual([
      "main vahaan se hoon aayaa",
      "kyonki chaahie use chaahie more dee",
      "rang sangeetaa",
      "har dam, karavaataa loon bhee milo",
      "ye rangataa kaajal tere",
    ]);
    for (const value of Object.values(roman)) expect(value).not.toContain("~");
  });
  it("uses familiar Punjabi spellings and keeps decomposed diacritics out", async () => {
    const doc = parseLyrics("ਪਾਣੀ ਚੰਨ ਰਾਤੀਂ");
    const roman = await romanizeDocument(doc);
    expect(Object.values(roman)).toEqual(["paanee channa raateen"]);
    for (const value of Object.values(roman)) expect(value).toMatch(/^[\x00-\x7f]*$/);
  });
  it("keeps Tamil long vowels readable and removes academic marks", async () => {
    const doc = parseLyrics("என் ஏக்கத்த எங்கணா மாத்திக்கிறியா\nபாத்துட்டியா\nநான் பாட்டுற தவிப்ப ரச்சிக்கிறியா\nகொன்னுட்டியே");
    const roman = await romanizeDocument(doc);
    expect(Object.values(roman)).toEqual([
      "en eekkaththa engkanaa maaththikkiriyaa",
      "paaththuttiyaa",
      "naan paattura thavippa rachchikkiriyaa",
      "konnuttiyee",
    ]);
    for (const value of Object.values(roman)) expect(value).not.toMatch(/[\u0300-\u036f]/);
  });
  it("simplifies Tamil ṉ/ṟ but retains Sanskrit ṉ in other scripts", async () => {
    const doc = parseLyrics("என்\nञ");
    const roman = await romanizeDocument(doc);
    expect(roman[doc.lines[0].id]).toBe("en");
    expect(roman[doc.lines[1].id]).toBe("ny");
  });
  it("keeps Tamil short/long vowels and native consonants distinct, without false aspirates", async () => {
    const doc = parseLyrics(
      "காலை ஒளி\nதமிழ்\nக கா கி கீ கு கூ கெ கே கை கொ கோ கௌ",
    );
    const roman = await romanizeDocument(doc);
    expect(roman[doc.lines[0].id]).toBe("kaalai oli");
    expect(roman[doc.lines[1].id]).toBe("thamizh");
    expect(roman[doc.lines[2].id]).toBe(
      "ka kaa ki kee ku koo ke kee kai ko koo kau",
    );
  });
  it("handles shaping joiners and decomposed vowels without breaking conjuncts or Latin punctuation", async () => {
    const doc = parseLyrics("क्‍ष, friend!\nகொ");
    const roman = await romanizeDocument(doc);
    expect(roman[doc.lines[0].id]).toBe("ksh, friend!");
    expect(roman[doc.lines[1].id]).toBe("ko");
  });
  it("automatically repairs exact legacy generated Tamil while preserving supplied text", async () => {
    const doc = parseLyrics("வணக்கம்\nகாலை ஒளி");
    doc.romanisation[doc.lines[0].id] = "vaṇaghgham";
    doc.romanisation[doc.lines[1].id] = "Kaalai oli (supplied)";
    expect(await romanizeDocument(doc)).toEqual({
      [doc.lines[0].id]: "vanakkam",
    });
  });
  it("upgrades cached academic text but never changes Gemini, supplied text, timing or Latin spelling", async () => {
    const doc = parseLyrics("தமிழ் தமிழ் café\nHello");
    doc.romanisation[doc.lines[0].id] = "tamiḻ tamiḻ café";
    doc.localRomanisation = { ...doc.romanisation };
    expect((await romanizeDocument(doc))[doc.lines[0].id]).toBe(
      "thamizh thamizh café",
    );
    doc.romanisationSource = "gemini";
    expect(await romanizeDocument(doc)).toEqual({});
  });
  it("converts decomposed nukta spellings without leaking source marks into the Latin layer", async () => {
    const doc = parseLyrics("क़ ख़ ग़ ज़ ड़ ढ़ फ़\nড় ঢ় য়\nਖ਼ ਗ਼ ਜ਼ ਫ਼");
    const roman = await romanizeDocument(doc);
    for (const line of doc.lines) {
      expect(roman[line.id]).toBeTruthy();
      expect(roman[line.id]).not.toMatch(/[\u0900-\u0aff]/);
    }
    expect(roman[doc.lines[0].id]).toContain("q");
    expect(roman[doc.lines[0].id]).toContain("z");
  });
});


it("romanizes Malayalam chillus, traditional spellings and Dravidian vowels without leaking script", async () => {
  const doc = parseLyrics("കാറിൻ തൂവൽ പോലെ മെല്ലെ തഴുകാനേ\nമോഹം പൂത്തേൻ നെഞ്ചിനുള്ളിൽ മഴ പോലെ\nഅവളുടെ കരിമഷി മിഴി ഉണ്ടല്ലോ\nൻ ൻ ന്‍ ൽ ൾ ർ ൺ ൿ");
  const roman = await romanizeDocument(doc);
  expect(roman[doc.lines[0].id]).toBe("kaarin thooval pole melle thazhukaane");
  for (const value of Object.values(roman)) expect(value).not.toMatch(/[\u0d00-\u0d7f\u0300-\u036f]/);
  expect(roman[doc.lines[3].id]).toBe("n n n l l r n k");
  doc.romanisation = { [doc.lines[0].id]: "kaarriൻ toovaൽ polè mèllè tazhukaane" };
  doc.localRomanisation = { ...doc.romanisation };
  expect((await romanizeDocument(doc))[doc.lines[0].id]).toBe("kaarin thooval pole melle thazhukaane");
});


it("uses the installed Assamese scheme for its distinct consonants", async () => {
  const doc = parseLyrics("ৰৱ");
  const value = (await romanizeDocument(doc))[doc.lines[0].id];
  expect(value).toBeTruthy();
  expect(value).not.toMatch(/[\u0980-\u09ff]/);
});
