import { searchRetrieval } from "../../domain/search-retrieval";
import { useEffect, useId, useRef, useState } from "react";
import { Loader2, Search, X } from "lucide-react";
import { library, type CatalogTrack, type CatalogArtist, type CatalogAlbum } from "../../adapters/native";
import type { CatalogAction } from "./CatalogTrackActions";
import type { Track } from "../../domain/types";
import { Artwork } from "./Artwork";
import { CloseTrackMenu } from "./CloseTrackMenu";

export interface TopBarSearchProps {
  query: string;
  onChange?: (query: string) => void;
  onFocus?: () => void;
  onSubmit?: () => void;
  onSelectArtist?: (id: string) => void;
  onSelectAlbum?: (id: string) => void;
  onSelectTrack?: (track: CatalogTrack) => void;
  onCatalogAction?: (track: CatalogTrack, action: CatalogAction) => void;
  favorites?: string[];
  savedTracks?: Track[];
}

interface SearchOption {
  key: string;
  title: string;
  subtitle: string;
  artwork?: string | null;
  track?: CatalogTrack;
  select: () => void;
}

function SearchTrackContextMenu({
  track,
  saved,
  favorite,
  onCatalogAction,
  onClose,
}: {
  track: CatalogTrack;
  saved?: Track;
  favorite: boolean;
  onCatalogAction: (track: CatalogTrack, action: CatalogAction) => void;
  onClose: () => void;
}) {
  const run = (action: CatalogAction) => {
    onClose();
    onCatalogAction(track, action);
  };
  return (
    <details className="track-menu context-track-menu" onClick={e => e.stopPropagation()}>
      <summary aria-label="Track options" />
      <div className="menu-popover" role="menu">
        <button role="menuitem" type="button" onClick={() => run("next")}>Play next</button>
        <button role="menuitem" type="button" onClick={() => run("queue")}>Add to queue</button>
        <button role="menuitem" type="button" onClick={() => run("favorite")}>
          {favorite ? "Remove from favorites" : "Add to favorites"}
        </button>
        <button role="menuitem" type="button" onClick={() => run("playlist")}>Save to playlist</button>
        <button role="menuitem" type="button" onClick={() => run(saved ? "remove" : "save")}>
          {saved ? "Remove from library" : "Save to library"}
        </button>
        <CloseTrackMenu />
      </div>
    </details>
  );
}

export function TopBarSearch({
  query,
  onChange,
  onFocus,
  onSubmit,
  onSelectArtist,
  onSelectAlbum,
  onSelectTrack,
  onCatalogAction,
  favorites,
  savedTracks,
}: TopBarSearchProps) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const selectedKey = useRef<string | null>(null);
  const [matches, setMatches] = useState<{ query: string; tracks: CatalogTrack[]; artists: CatalogArtist[]; albums: CatalogAlbum[]; error: string; warning: string } | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const trimmed = query.trim();
  const expanded = open && Boolean(trimmed);
  const current = matches?.query === trimmed ? matches : null;

  useEffect(() => {
    if (!expanded) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      const update = (patch: Partial<NonNullable<typeof matches>>) => {
        if (!cancelled) setMatches(current => ({ query: trimmed, tracks: [], artists: [], albums: [], error: "", warning: "", ...(current?.query === trimmed ? current : {}), ...patch }));
      };
      void searchRetrieval(trimmed, 5, library.searchCatalog).then(tracks => update({ tracks: tracks.slice(0, 5) }), () => update({ warning: "Some suggestions could not be loaded." }));
      void library.searchCatalogEntities(trimmed).then(entities => update({ artists: entities.artists.slice(0, 3), albums: entities.albums.slice(0, 3), warning: entities.warning || "" }), () => update({ warning: "Some suggestions could not be loaded." }));
    }, 300);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [trimmed, expanded]);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) { setOpen(false); setActive(-1); input.current?.blur(); } };
    document.addEventListener("pointerdown", close, true);
    return () => document.removeEventListener("pointerdown", close, true);
  }, [open]);

  const options: SearchOption[] = [
    { key: "search", title: `Search for “${trimmed}”`, subtitle: "View all results", select: () => onSubmit?.() },
    ...(current?.artists ?? []).map(artist => ({ key: `artist:${artist.id}`, title: artist.name, subtitle: "Artist", artwork: artist.artworkUrl, select: () => onSelectArtist?.(artist.id) })),
    ...(current?.tracks ?? []).map(track => ({ key: `song:${track.id}`, title: track.title, subtitle: `Song · ${track.artist}`, artwork: track.artworkUrl, track, select: () => onSelectTrack?.(track) })),
    ...(current?.albums ?? []).map(album => ({ key: `album:${album.id}`, title: album.title, subtitle: `Album · ${album.artist}`, artwork: album.artworkUrl, select: () => onSelectAlbum?.(album.id) })),
  ];
  useEffect(() => {
    if (selectedKey.current) setActive(options.findIndex(option => option.key === selectedKey.current));
  }, [matches]);
  const choose = (index: number) => { options[index]?.select(); setOpen(false); setActive(-1); };

  return <div className="topbar-search" ref={root} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
    <div className="topbar-search-wrap">
      <Search size={15} className="topbar-search-icon" />
      <input ref={input} type="text" className="topbar-search-input" aria-label="Search music" placeholder="Search for songs, artists, albums…" maxLength={200}
        role="combobox" aria-autocomplete="list" aria-expanded={expanded} aria-controls={expanded ? listId : undefined}
        aria-activedescendant={expanded && active >= 0 ? `${listId}-${active}` : undefined} autoComplete="off"
        value={query} onFocus={() => { setOpen(true); onFocus?.(); }}
        onChange={event => { selectedKey.current = null; onChange?.(event.target.value); setOpen(true); setActive(-1); }}
        onKeyDown={event => {
          if (event.key === "Escape") { setOpen(false); setActive(-1); }
          else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault(); setOpen(true);
            const next = event.key === "ArrowDown" ? (active + 1) % options.length : (active < 0 ? options.length - 1 : (active - 1 + options.length) % options.length);
            selectedKey.current = options[next]?.key ?? null;
            setActive(next);
            document.getElementById(`${listId}-${next}`)?.scrollIntoView({ block: "nearest" });
          } else if (event.key === "Enter" && trimmed) { event.preventDefault(); choose(expanded && active >= 0 ? active : 0); }
        }} />
      {query && <button type="button" className="topbar-search-clear" aria-label="Clear search" onClick={() => { onChange?.(""); setActive(-1); input.current?.focus(); }}><X size={13} /></button>}
    </div>
    {expanded && <div className="topbar-search-dropdown">
      <div id={listId} role="listbox" aria-label="Search suggestions">
        {options.map((option, index) => {
          const track = option.track;
          const saved = track && savedTracks ? savedTracks.find(s => s.metadataSourceId === track.id || s.id === track.id) : undefined;
          const isFav = Boolean(track && ((saved && favorites?.includes(saved.id)) || favorites?.includes(track.id)));
          return (
            <div
              role="option"
              tabIndex={0}
              aria-selected={active === index}
              id={`${listId}-${index}`}
              key={option.key}
              className="topbar-search-option"
              onMouseDown={event => {
                if (!(event.target as HTMLElement).closest(".menu-popover, details")) {
                  event.preventDefault();
                }
              }}
              onClick={(event) => {
                if ((event.target as HTMLElement).closest(".menu-popover, details")) return;
                choose(index);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  if ((event.target as HTMLElement).closest(".menu-popover, details")) return;
                  event.preventDefault();
                  choose(index);
                }
              }}
            >
              {option.artwork ? <Artwork url={option.artwork} kind={option.subtitle === "Artist" ? "artist" : undefined} /> : <Search size={18} />}
              <span><strong>{option.title}</strong><small>{option.subtitle}</small></span>
              {track && onCatalogAction && (
                <SearchTrackContextMenu
                  track={track}
                  saved={saved}
                  favorite={isFav}
                  onCatalogAction={onCatalogAction}
                  onClose={() => { setOpen(false); setActive(-1); }}
                />
              )}
            </div>
          );
        })}
      </div>
      <div role="status" className="topbar-search-status">
        {!current ? <><Loader2 size={14} className="spin" /> Searching…</> : current.error || current.warning || (options.length === 1 ? "No matches found. Try another search." : "")}
      </div>
    </div>}
  </div>;
}
