import React from "react";
import {library} from '../../adapters/native';
import type { CatalogArtistCredit } from "../../adapters/native";
import { artistCredits, artistReference, isArtistId, resolveArtistCredit } from "../../domain/catalog-links";

export interface ArtistLinksProps {
  artists?: CatalogArtistCredit[];
  artistString?: string;
  catalogId?: string | null;
  onNavigateArtist?: (artistId: string) => void;
  className?: string;
  maxArtists?: number;
}

export function ArtistLinks({
  artists,
  artistString,
  catalogId,
  onNavigateArtist,
  className = "",
  maxArtists,
}: ArtistLinksProps) {
  artists = artists?.length ? artists : artistCredits(artistString || "");
  artists = artists.filter((credit, index, all) => !isArtistId(credit.id) || all.findIndex(other => other.id === credit.id) === index);
  artists = artists.map(credit => ({ ...credit, id: credit.id || (artistCredits(credit.name).length ? artistReference(credit.name) : undefined) }));
  const hasMore = Boolean(maxArtists && artists.length > maxArtists);
  const displayedArtists = maxArtists && artists.length > maxArtists ? artists.slice(0, maxArtists) : artists;

  // If we have structured artist data with IDs, render individual links
  if (displayedArtists && displayedArtists.length > 0 && onNavigateArtist) {
    return (
      <span className={className}>
        {displayedArtists.map((artist, idx) => (
          <span key={idx}>
            {idx > 0 && ", "}
            {artist.id ? (
              <button
                type="button"
                className="link-button"
                onClick={(e) => {
                  e.stopPropagation();
                  if (isArtistId(artist.id)) onNavigateArtist(artist.id);
                  else void resolveArtistCredit(artist, catalogId, library.lookupCatalog, library.lookupArtist).then(onNavigateArtist);
                }}
              >
                {artist.name}
              </button>
            ) : (
              artist.name
            )}
          </span>
        ))}
        {hasMore && "…"}
      </span>
    );
  }

  // Fallback to plain text if no structured data or navigation handler
  if (hasMore) {
    return (
      <span className={className}>
        {displayedArtists.map(a => a.name).join(", ")}…
      </span>
    );
  }
  return <span className={className}>{artistString || ""}</span>;
}
