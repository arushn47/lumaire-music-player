import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Banners } from "./Banners";

vi.mock("react-dom", () => ({
  createPortal: (children: unknown) => children,
}));

let mockErrorsState: unknown[] = [];

vi.mock("react", async importOriginal => {
  const original = await importOriginal<typeof import("react")>();
  return {
    ...original,
    useState: (init: unknown) => {
      if (Array.isArray(init) && mockErrorsState.length) return [mockErrorsState, vi.fn()];
      if (typeof init === "boolean") return [init, vi.fn()];
      return [typeof init === "function" ? (init as () => unknown)() : init ?? { nodeType: 1 }, vi.fn()];
    },
  };
});

describe("Banners notification actions", () => {
  it("renders action button in toast when messageAction is supplied", () => {
    mockErrorsState = [];
    const html = renderToStaticMarkup(
      <Banners
        message="Added to Telugu"
        messageAction={{ label: "Change", onClick: () => {} }}
        onDismissError={() => {}}
        onDismissMessage={() => {}}
      />
    );
    expect(html).toContain("Added to Telugu");
    expect(html).toContain("toast-action");
    expect(html).toContain("Change");
  });

  it("does not render action button when messageAction is omitted", () => {
    mockErrorsState = [];
    const html = renderToStaticMarkup(
      <Banners
        message="Saved to library"
        onDismissError={() => {}}
        onDismissMessage={() => {}}
      />
    );
    expect(html).toContain("Saved to library");
    expect(html).not.toContain("toast-action");
  });

  it("renders stacked toast cards and stack badge when multiple errors are present", () => {
    mockErrorsState = [
      { id: "e1", text: "First failure", playback: false, addedAt: Date.now() },
      { id: "playback:1:Second failure", text: "Second failure", playback: true, addedAt: Date.now() },
    ];
    const html = renderToStaticMarkup(
      <Banners
        playbackError="Second failure"
        playbackErrorId="1"
        hasTrack={true}
        onRetryPlayback={() => {}}
        onDismissError={() => {}}
        onDismissMessage={() => {}}
      />
    );
    expect(html).toContain("notification-stack is-stacked");
    expect(html).toContain("toast-cards-wrapper is-stacked");
    expect(html).toContain("toast-stack-badge");
    expect(html).toContain("+1 more");
    expect(html).toContain("Retry playback");
    mockErrorsState = [];
  });
});
