import { describe, expect, it } from "vitest";
import { albumReference, artistCredits, artistReference, canonicalArtistCredit } from "./catalog-links";

describe("catalog navigation references", () => {
  it("preserves Emiway Bantai's full credit and resolves the legacy alias without fuzzy matches", () => {
    expect(canonicalArtistCredit("Emiway, Guest")).toBe("Emiway Bantai, Guest");
    expect(canonicalArtistCredit("EMIWAY BANTAI")).toBe("Emiway Bantai");
    expect(canonicalArtistCredit("Emiway Tribute")).toBe("Emiway Tribute");
    expect(artistCredits("Emiway")[0].name).toBe("Emiway");
    expect(artistReference("Emiway")).toBe("saavn:artist:name:Emiway");
  });
  it("keeps individual collaboration credits and escapes locator delimiters", () => {
    expect(artistCredits('Kr$na')[0]).toEqual({ name: 'Kr$na', id: 'saavn:artist:name:Kr%24na' });
    expect(artistCredits("KR$NA, Seedhe Maut").map(credit => credit.name)).toEqual(["KR$NA", "Seedhe Maut"]);
    expect(artistCredits("Bayaan, Hasan Raheem & Rovalio").map(credit => credit.name)).toEqual(["Bayaan", "Hasan Raheem", "Rovalio"]);
    expect(artistCredits("R&B")[0].name).toBe("R&B");
    expect(artistReference("AC/DC: Live")).toBe("saavn:artist:name:AC%2FDC%3A%20Live");
    expect(albumReference("Yours: Truly", "KR$NA, Phenom")).toBe("saavn:album:search:KR%24NA:Yours%3A%20Truly");
  });
  it("does not create links for placeholder metadata", () => {
    expect(artistCredits("Unknown artist")).toEqual([]);
    expect(albumReference("Unknown", "Emiway")).toBeNull();
    expect(albumReference("Album", "Unknown artist")).toBeNull();
  });
});


it("splits comma, ampersand and and-separated legacy collaborations into individual artist references", () => {
  expect(artistCredits("Hasan Raheem, Abdullah and Talal Qureshi & Guest").map(artist => artist.name)).toEqual(["Hasan Raheem", "Abdullah", "Talal Qureshi", "Guest"]);
});
