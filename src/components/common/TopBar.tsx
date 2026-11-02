import type { ReactNode } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  FolderInput,
  ListMusic,
  PanelLeft,
  PanelLeftClose,
  RefreshCw,
  Settings,
  Wifi,
} from "lucide-react";
import { IconButton } from "./IconButton";
import { TopBarSearch, type TopBarSearchProps } from "./TopBarSearch";

export interface TopBarProps extends Pick<TopBarSearchProps, "onSelectArtist" | "onSelectAlbum" | "onSelectTrack" | "onCatalogAction" | "favorites" | "savedTracks"> {
  windowControls?: ReactNode;
  view: string;
  heading: string;
  sidebarCollapsed: boolean;
  queueOpen: boolean;
  onToggleSidebar: () => void;
  onToggleQueue: () => void;
  onOpenSettings?: () => void;
  onOpenSync?: () => void;
  onOpenCollectionHub?: () => void;
  onOpenImport?: () => void;
  onOpenUpdates?: () => void;
  updateLabel?: string;
  onOpenConnect?: () => void;
  nearbySharing?: boolean;
  nearbyConnected?: boolean;
  nearbyFollowing?: boolean;
  onStopFollowing?: () => void;
  canGoBack?: boolean;
  canGoForward?: boolean;
  onGoBack?: () => void;
  onGoForward?: () => void;
  searchQuery?: string;
  onSearchChange?: (query: string) => void;
  onSearchFocus?: () => void;
  onSearchSubmit?: () => void;
}

export function TopBar({
  windowControls,
  view,
  heading,
  sidebarCollapsed,
  queueOpen,
  onToggleSidebar,
  onToggleQueue,
  onOpenSettings,
  onOpenSync,
  onOpenCollectionHub,
  onOpenImport,
  onOpenUpdates,
  updateLabel,
  onOpenConnect,
  nearbySharing,
  nearbyConnected,
  nearbyFollowing,
  onStopFollowing,
  canGoBack = false,
  canGoForward = false,
  onGoBack,
  onGoForward,
  searchQuery = "",
  onSearchChange,
  onSearchFocus,
  onSearchSubmit,
  onSelectArtist,
  onSelectAlbum,
  onSelectTrack,
  onCatalogAction,
  favorites,
  savedTracks,
}: TopBarProps) {
  const handleSync = onOpenSync || onOpenCollectionHub || onOpenImport || onOpenConnect;

  return (
    <header className={`topbar${windowControls ? " with-window-controls" : ""}`} data-tauri-drag-region={windowControls ? true : undefined}>
      <div className="topbar-left" data-tauri-drag-region={windowControls ? true : undefined}>
        <IconButton
          label={sidebarCollapsed ? "Show sidebar" : "Hide sidebar"}
          className="sidebar-toggle-btn"
          onClick={onToggleSidebar}
        >
          {sidebarCollapsed ? <PanelLeft size={18} /> : <PanelLeftClose size={18} />}
        </IconButton>
        <div className="topbar-nav-arrows" data-tauri-drag-region={windowControls ? true : undefined}>
          <button
            type="button"
            className="topbar-arrow-btn"
            disabled={!canGoBack}
            onClick={onGoBack}
            aria-label="Go back"
            title="Go back"
          >
            <ChevronLeft size={16} />
          </button>
          <button
            type="button"
            className="topbar-arrow-btn"
            disabled={!canGoForward}
            onClick={onGoForward}
            aria-label="Go forward"
            title="Go forward"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      <div className={`topbar-center${queueOpen ? " queue-open" : ""}`} data-tauri-drag-region={windowControls ? true : undefined}>
        <TopBarSearch query={searchQuery} onChange={onSearchChange} onFocus={onSearchFocus}
          onSubmit={onSearchSubmit} onSelectArtist={onSelectArtist} onSelectAlbum={onSelectAlbum} onSelectTrack={onSelectTrack}
          onCatalogAction={onCatalogAction} favorites={favorites} savedTracks={savedTracks} />
      </div>

      <div className="topbar-actions" data-tauri-drag-region={windowControls ? true : undefined}>
        {nearbyFollowing && onStopFollowing && (
          <button
            type="button"
            className="topbar-sharing-pill following"
            onClick={onStopFollowing}
            aria-label="Stop listening together"
            title="Listening together (Click to stop)"
          >
            <Wifi size={13} />
            <span>Stop listening</span>
          </button>
        )}
        {nearbySharing && handleSync && (
          <button
            type="button"
            className="topbar-sharing-pill sharing"
            onClick={handleSync}
            aria-label="Sharing on your Wi-Fi (Click to manage)"
            title="Sharing on your Wi-Fi (Click to manage)"
          >
            <Wifi size={13} />
            <span>{nearbyConnected ? "Connected on Wi-Fi" : "Sharing on Wi-Fi"}</span>
          </button>
        )}
        {handleSync && !nearbySharing && (
          <button
            type="button"
            className="topbar-sync-btn"
            onClick={handleSync}
            aria-label="Sync playlists & devices"
            title="Sync playlists from other services or connect nearby devices over Wi-Fi"
          >
            <RefreshCw size={13} />
            <span>Sync</span>
          </button>
        )}
        {onOpenUpdates && updateLabel && (
          <button
            type="button"
            className="topbar-import-btn topbar-update-btn"
            aria-label="Software updates and release notes"
            onClick={onOpenUpdates}
            title="Update available · View release notes and installation options"
          >
            <Download size={14} />
            <span>{updateLabel}</span>
          </button>
        )}
        <IconButton
          label={queueOpen ? "Hide queue" : "Show queue"}
          active={queueOpen}
          onClick={onToggleQueue}
        >
          <ListMusic size={19} />
        </IconButton>
        {onOpenSettings && (
          <IconButton
            label="Settings & sources"
            active={view === "settings"}
            onClick={onOpenSettings}
          >
            <Settings size={18} />
          </IconButton>
        )}
        {windowControls}
      </div>
    </header>
  );
}
