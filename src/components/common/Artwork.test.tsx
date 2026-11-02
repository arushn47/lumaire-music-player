import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Artwork } from "./Artwork";

describe("Artwork fallback representations", () => {
  it("renders a centralized human icon for artist fallbacks", () => {
    const byKind = renderToStaticMarkup(<Artwork kind="artist" />);
    expect(byKind).toContain("artist-fallback-icon");
    expect(byKind).not.toContain("lucide-music-2");

    const byClass = renderToStaticMarkup(<Artwork className="search-artist-cover" />);
    expect(byClass).toContain("artist-fallback-icon");
    expect(byClass).not.toContain("lucide-music-2");
  });

  it("renders the standard music note icon for tracks and albums with centered flex styling", () => {
    const normal = renderToStaticMarkup(<Artwork />);
    expect(normal).toContain("lucide-music2");
    expect(normal).toContain("display:inline-flex");
    expect(normal).toContain("align-items:center");
    expect(normal).toContain("justify-content:center");
    expect(normal).not.toContain("artist-fallback-icon");

    const album = renderToStaticMarkup(<Artwork kind="album" />);
    expect(album).toContain("lucide-music2");
    expect(album).not.toContain("artist-fallback-icon");
  });
});
