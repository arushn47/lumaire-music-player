import { expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { TopBar } from "./TopBar";

it("renders desktop topbar with small sync button and queue toggle", () => {
  const onToggleSidebar = vi.fn();
  const onToggleQueue = vi.fn();
  const onOpenCollectionHub = vi.fn();

  const html = renderToStaticMarkup(
    <TopBar
      view="discover"
      heading="Discover new music"
      sidebarCollapsed={false}
      queueOpen={false}
      onToggleSidebar={onToggleSidebar}
      onToggleQueue={onToggleQueue}
      onOpenCollectionHub={onOpenCollectionHub}
    />
  );

  expect(html).toContain('class="topbar-sync-btn"');
  expect(html).toContain('Sync');
  expect(html).toContain('aria-label="Sync playlists &amp; devices"');
  expect(html).toContain('aria-label="Show queue"');
});

it("omits sync button when onOpenCollectionHub callback is not provided", () => {
  const html = renderToStaticMarkup(
    <TopBar
      view="discover"
      heading="Discover new music"
      sidebarCollapsed={false}
      queueOpen={false}
      onToggleSidebar={vi.fn()}
      onToggleQueue={vi.fn()}
    />
  );

  expect(html).not.toContain('class="topbar-sync-btn"');
});

it("renders sharing on Wi-Fi indicator when nearbySharing is true", () => {
  const onOpenCollectionHub = vi.fn();
  const html = renderToStaticMarkup(
    <TopBar
      view="discover"
      heading="Discover new music"
      sidebarCollapsed={false}
      queueOpen={false}
      onToggleSidebar={vi.fn()}
      onToggleQueue={vi.fn()}
      onOpenCollectionHub={onOpenCollectionHub}
      nearbySharing={true}
    />
  );

  expect(html).toContain('class="topbar-sharing-pill sharing"');
  expect(html).toContain('Sharing on Wi-Fi');
});

it("renders connected on Wi-Fi indicator when nearbySharing and nearbyConnected are true", () => {
  const onOpenCollectionHub = vi.fn();
  const html = renderToStaticMarkup(
    <TopBar
      view="discover"
      heading="Discover new music"
      sidebarCollapsed={false}
      queueOpen={false}
      onToggleSidebar={vi.fn()}
      onToggleQueue={vi.fn()}
      onOpenCollectionHub={onOpenCollectionHub}
      nearbySharing={true}
      nearbyConnected={true}
    />
  );

  expect(html).toContain('class="topbar-sharing-pill sharing"');
  expect(html).toContain('Connected on Wi-Fi');
});


it("puts software updates immediately after Sync only when an update is available", () => {
  const html=renderToStaticMarkup(<TopBar view="discover" heading="Discover" sidebarCollapsed={false} queueOpen={false} onToggleSidebar={()=>{}} onToggleQueue={()=>{}} onOpenImport={()=>{}} onOpenUpdates={()=>{}} onOpenConnect={()=>{}} updateLabel="Update v1.0.5" />);
  expect(html).toContain('aria-label="Software updates and release notes"');
  expect(html).toContain('class="topbar-import-btn topbar-update-btn"');
  expect(html.indexOf('>Sync</span>')).toBeLessThan(html.indexOf('>Update v1.0.5</span>'));
});

it('hides the update shortcut without a pending update label', () => {
  const html = renderToStaticMarkup(<TopBar view="discover" heading="Discover" sidebarCollapsed={false} queueOpen={false} onToggleSidebar={()=>{}} onToggleQueue={()=>{}} onOpenUpdates={()=>{}} />);
  expect(html).not.toContain('Software updates and release notes');
});


it("keeps header search as an autocomplete without rendering a results page", () => {
  const html = renderToStaticMarkup(<TopBar view="home" heading="Home" sidebarCollapsed={false} queueOpen={false} onToggleSidebar={() => {}} onToggleQueue={() => {}} searchQuery="Chill" onSearchChange={() => {}} onSearchSubmit={() => {}} />);
  expect(html).toContain('role="combobox"');
  expect(html).toContain('aria-autocomplete="list"');
  expect(html).toContain('aria-expanded="false"');
  expect(html).toContain('value="Chill"');
  expect(html).not.toContain('Search &amp; explore');
  expect(html).not.toContain('catalog-search-results');
});


it("integrates desktop window controls into the draggable search header", () => {
  const props = { view: "home", heading: "Home", sidebarCollapsed: false, queueOpen: false, onToggleSidebar: () => {}, onToggleQueue: () => {} };
  const html = renderToStaticMarkup(<TopBar {...props} windowControls={<button>Close window</button>} />);
  expect(html).toContain('topbar with-window-controls');
  expect(html).toContain('data-tauri-drag-region="true"');
  expect(html.indexOf('Close window')).toBeLessThan(html.indexOf('</header>'));
  expect(html).not.toContain('desktop-titlebar');
  expect(renderToStaticMarkup(<TopBar {...props} />)).not.toContain('data-tauri-drag-region');
});

it("marks topbar-center with queue-open class when queue is open", () => {
  const props = { view: "home", heading: "Home", sidebarCollapsed: false, onToggleSidebar: () => {}, onToggleQueue: () => {} };
  const closedHtml = renderToStaticMarkup(<TopBar {...props} queueOpen={false} />);
  expect(closedHtml).toContain('class="topbar-center"');
  expect(closedHtml).not.toContain('class="topbar-center queue-open"');

  const openHtml = renderToStaticMarkup(<TopBar {...props} queueOpen={true} />);
  expect(openHtml).toContain('class="topbar-center queue-open"');
});

it("renders settings gear button next to queue toggle when onOpenSettings is provided", () => {
  const props = { view: "home", heading: "Home", sidebarCollapsed: false, queueOpen: false, onToggleSidebar: () => {}, onToggleQueue: () => {} };
  const html = renderToStaticMarkup(<TopBar {...props} onOpenSettings={() => {}} />);
  expect(html).toContain('aria-label="Settings &amp; sources"');
  expect(html.indexOf('aria-label="Show queue"')).toBeLessThan(html.indexOf('aria-label="Settings &amp; sources"'));
});
