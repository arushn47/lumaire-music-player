import { beforeEach, describe, expect, it, vi } from "vitest";
import { library } from "../../adapters/native";
import { resolveEntityArtwork } from "./EntityArtwork";

vi.mock("../../adapters/native", () => ({
  library: {
    lookupCatalog: vi.fn(),
    lookupAlbum: vi.fn(),
    lookupArtist: vi.fn(),
    entityArtwork: vi.fn(),
    searchCatalogEntities: vi.fn(),
  },
}));

const commons = {
  url: "commons.webp",
  sourceUrl: "https://commons.wikimedia.org/wiki/File:Portrait",
  credit: "Photographer · CC BY",
};

describe("Tracker artist portraits", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(library.entityArtwork).mockResolvedValue(commons);
  });

  it("resolves the portrait from the recording credit, including verified provider aliases", async () => {
    vi.mocked(library.lookupCatalog).mockResolvedValue({
      id: "itunes:42",
      artists: [{ name: "Sai Abhyankkar", id: "itunes:1652280551" }],
    } as never);
    vi.mocked(library.lookupArtist).mockResolvedValue({
      info: {
        id: "saavn:artist:14477737",
        name: "Sai Abhyankkar",
        artworkUrl: "portrait.webp",
      },
      verifiedIds: ["saavn:artist:14477737", "itunes:1652280551"],
      topTracks: [],
      albums: [],
      similarArtists: [],
    });
    expect(
      await resolveEntityArtwork(
        "artist",
        "Sai Abhyankkar",
        "",
        "",
        [],
        "itunes:42",
      ),
    ).toMatchObject({ url: "portrait.webp" });
    expect(library.lookupArtist).toHaveBeenCalledWith("itunes:1652280551");
    expect(library.entityArtwork).not.toHaveBeenCalled();
    expect(
      await resolveEntityArtwork(
        "artist",
        "Sai Abhyankkar",
        "",
        "",
        ["portrait.webp"],
        "itunes:42",
      ),
    ).toEqual(commons);
    expect(
      await resolveEntityArtwork(
        "artist",
        "Sai Abhyankkar",
        "",
        "",
        ["portrait.webp", commons.url],
        "itunes:42",
      ),
    ).toBeNull();
  });

  it("falls back to exact-name catalog entity search when recording credit cannot resolve an artist ID", async () => {
    vi.mocked(library.lookupCatalog).mockRejectedValue(new Error("No track"));
    vi.mocked(library.searchCatalogEntities).mockResolvedValue({
      artists: [
        {
          id: "saavn:artist:14477737",
          name: "Sai Abhyankkar",
          artworkUrl: "sai.webp",
        },
        {
          id: "saavn:artist:99999",
          name: "Other Artist",
          artworkUrl: "other.webp",
        },
      ],
      albums: [],
      warning: null,
    });
    expect(
      await resolveEntityArtwork("artist", "Sai Abhyankkar", "", ""),
    ).toEqual({
      url: "sai.webp",
      sourceUrl: "",
      credit: "Sai Abhyankkar · Catalog portrait",
    });
    expect(library.searchCatalogEntities).toHaveBeenCalledWith(
      "Sai Abhyankkar",
    );
  });

  it("falls back to exact-name catalog entity search and profile lookup when recording credit cannot resolve an artist ID", async () => {
    vi.mocked(library.lookupCatalog).mockRejectedValue(new Error("No track"));
    vi.mocked(library.searchCatalogEntities).mockResolvedValue({
      artists: [
        {
          id: "saavn:artist:14477737",
          name: "Harini",
          artworkUrl: null,
        },
      ],
      albums: [],
      warning: null,
    });
    vi.mocked(library.lookupArtist).mockResolvedValue({
      info: {
        id: "saavn:artist:14477737",
        name: "Harini",
        artworkUrl: "harini-profile.webp",
      },
      verifiedIds: ["saavn:artist:14477737"],
      topTracks: [],
      albums: [],
      similarArtists: [],
    });
    expect(
      await resolveEntityArtwork("artist", "Harini", "", ""),
    ).toEqual({
      url: "harini-profile.webp",
      sourceUrl: "",
      credit: "Harini · Catalog portrait",
    });
    expect(library.searchCatalogEntities).toHaveBeenCalledWith("Harini");
    expect(library.lookupArtist).toHaveBeenCalledWith("saavn:artist:14477737");
  });

  it("falls back to Commons artwork when catalog entity search yields no match", async () => {
    vi.mocked(library.searchCatalogEntities).mockResolvedValue({
      artists: [],
      albums: [],
      warning: null,
    });
    expect(await resolveEntityArtwork("artist", "Artist", "", "")).toEqual(commons);
    expect(library.entityArtwork).toHaveBeenCalledWith("artist", "Artist", "", "");
  });

  it("retains album metadata fallback when the album page lookup is unavailable", async () => {
    vi.mocked(library.lookupAlbum).mockRejectedValue(Error("Unavailable"));
    expect(
      await resolveEntityArtwork("album", "Album", "Artist", "Track"),
    ).toEqual(commons);
    expect(library.entityArtwork).toHaveBeenCalledWith(
      "album",
      "Album",
      "Artist",
      "Track",
    );
    expect(library.lookupArtist).not.toHaveBeenCalled();
  });

  it("uses the same album identity and cover as the album page, splitting track collaborations", async () => {
    vi.mocked(library.lookupAlbum).mockResolvedValue({
      info: {
        id: "saavn:album:1",
        title: "King Of The Streets",
        artist: "Emiway Bantai",
        artists: [],
        artworkUrl: "cover.webp",
      },
      tracks: [],
      partial: false,
    });
    expect(
      await resolveEntityArtwork(
        "album",
        "King Of The Streets",
        "Emiway Bantai, Keri Hilson, D.O.E.",
        "Company",
      ),
    ).toEqual({
      url: "cover.webp",
      sourceUrl: "",
      credit: "Emiway Bantai · King Of The Streets",
    });
    expect(library.lookupAlbum).toHaveBeenCalledWith(
      "saavn:album:search:Emiway%20Bantai:King%20Of%20The%20Streets",
    );
    expect(library.entityArtwork).not.toHaveBeenCalled();
  });

  it("falls back from broken portraits without repeatedly returning the failed image", async () => {
    vi.mocked(library.lookupArtist).mockResolvedValue({
      info: { id: "1", name: "Artist", artworkUrl: "broken.webp" },
      topTracks: [],
      albums: [],
      similarArtists: [],
    });
    vi.mocked(library.searchCatalogEntities).mockResolvedValue({
      artists: [],
      albums: [],
      warning: null,
    });
    expect(
      await resolveEntityArtwork("artist", "Artist", "", "", ["broken.webp"]),
    ).toEqual(commons);
    expect(
      await resolveEntityArtwork("artist", "Artist", "", "", [
        "broken.webp",
        commons.url,
      ]),
    ).toBeNull();
  });
});
