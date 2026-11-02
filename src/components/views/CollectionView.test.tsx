import { expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { library } from "../../adapters/native";
import { CollectionView } from "./CollectionView";

vi.mock("../../adapters/native", async () => {
  const actual = await vi.importActual<typeof import("../../adapters/native")>("../../adapters/native");
  return { ...actual, library: { ...actual.library, searchMoodCollection: vi.fn(), searchGenreCollection: vi.fn() } };
});

const props = {
  type: "mood" as const,
  name: "Chill",
  onBack: vi.fn(),
  onlineAvailable: true,
  busy: false,
  downloads: {},
  savedTracks: [],
  favorites: [],
  onCatalogAction: vi.fn(),
  onSaveDiscovery: vi.fn(),
  onNavigateAlbum: vi.fn(),
  onNavigateArtist: vi.fn(),
  onPlayCollection: vi.fn(),
};

it("keeps loading mood routes visible while the catalog request is pending", () => {
  vi.mocked(library.searchMoodCollection).mockReturnValue(new Promise(() => {}));
  const html = renderToStaticMarkup(<CollectionView {...props} />);
  expect(html).toContain('role="status"');
  expect(html).toContain("Loading mood collection");
});

it("keeps loading genre routes visible while the catalog request is pending", () => {
  vi.mocked(library.searchGenreCollection).mockReturnValue(new Promise(() => {}));
  const html = renderToStaticMarkup(<CollectionView {...props} type="genre" name="Jazz" />);
  expect(html).toContain('role="status"');
  expect(html).toContain("Loading genre collection");
});


