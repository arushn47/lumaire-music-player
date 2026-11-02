import { useEffect, useRef, useState } from "react";
import { library, type EntityArtwork as ImageCredit } from "../../adapters/native";
import { Artwork } from "./Artwork";
import { albumReference, isArtistId, resolveArtistCredit } from "../../domain/catalog-links";

const requests = new Map<string, Promise<ImageCredit | null>>();

export async function resolveEntityArtwork(
  kind: "artist" | "album",
  name: string,
  artist: string,
  trackTitle: string,
  rejected: string[] = [],
  catalogId?: string | null,
): Promise<ImageCredit | null> {
  if (rejected.length >= 3) return null;
  if (kind === "artist") {
    const id = await resolveArtistCredit(
      { name },
      catalogId,
      library.lookupCatalog,
      library.lookupArtist,
    );
    if (isArtistId(id)) {
      const profile = await library.lookupArtist(id).catch(() => null);
      if (profile && (profile.info.id === id || profile.verifiedIds?.includes(id))) {
        const url = profile.info.artworkUrl;
        if (url && !rejected.includes(url)) {
          return { url, sourceUrl: "", credit: `${profile.info.name} · Catalog portrait` };
        }
      }
    }
    if (library.searchCatalogEntities && name.trim()) {
      try {
        const result = await library.searchCatalogEntities(name.trim());
        const match = result.artists.find(
          (a) =>
            a.name.trim().toLowerCase() === name.trim().toLowerCase() &&
            isArtistId(a.id),
        );
        if (match) {
          if (match.artworkUrl && !rejected.includes(match.artworkUrl)) {
            return { url: match.artworkUrl, sourceUrl: "", credit: `${match.name} · Catalog portrait` };
          }
          const profile = await library.lookupArtist(match.id).catch(() => null);
          if (profile?.info.artworkUrl && !rejected.includes(profile.info.artworkUrl)) {
            return { url: profile.info.artworkUrl, sourceUrl: "", credit: `${profile.info.name} · Catalog portrait` };
          }
        }
      } catch {
        /* exact-name catalog entity search failure */
      }
    }
  }
  if (kind === "album") {
    const id = albumReference(name, artist);
    const album = id ? await library.lookupAlbum(id).catch(() => null) : null;
    if (album?.info.artworkUrl && !rejected.includes(album.info.artworkUrl)) {
      return {
        url: album.info.artworkUrl,
        sourceUrl: "",
        credit: `${album.info.artist} · ${album.info.title}`,
      };
    }
  }
  const fallback = await library.entityArtwork(kind, name, artist, trackTitle);
  return fallback && !rejected.includes(fallback.url) ? fallback : null;
}

export function EntityArtwork({
  kind,
  name,
  artist = "",
  trackTitle = "",
  artworkUrl,
  catalogId,
}: {
  kind: "artist" | "album";
  name: string;
  artist?: string;
  trackTitle?: string;
  artworkUrl?: string | null;
  catalogId?: string | null;
}) {
  const identity = JSON.stringify([kind, name, artist, catalogId]);
  const [failures, setFailures] = useState<{ identity: string; urls: string[] }>({
    identity,
    urls: [],
  });
  const rejected = failures.identity === identity ? failures.urls : [];
  const known = artworkUrl && !rejected.includes(artworkUrl) ? artworkUrl : null;
  const key = JSON.stringify([kind, name, artist, trackTitle, rejected, catalogId]);
  const ref = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!ref.current) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  const [image, setImage] = useState<{ key: string; value: ImageCredit | null } | null>(null);
  useEffect(() => {
    if (!visible || known) return;
    let cancelled = false;
    let request = requests.get(key);
    if (!request) {
      if (requests.size >= 256) requests.delete(requests.keys().next().value!);
      request = resolveEntityArtwork(kind, name, artist, trackTitle, rejected, catalogId)
        .then((value) => {
          if (!value) requests.delete(key);
          return value;
        })
        .catch(() => {
          requests.delete(key);
          return null;
        });
      requests.set(key, request);
    }
    void request.then((value) => {
      if (!cancelled) setImage({ key, value });
    });
    return () => {
      cancelled = true;
    };
  }, [key, kind, name, artist, trackTitle, visible, known, catalogId]);
  const value = image?.key === key ? image.value : null;
  const url = known || value?.url;
  const cover = (
    <Artwork
      url={url}
      className="listening-artwork"
      kind={kind}
      onError={() => {
        if (url) setFailures({ identity, urls: [...new Set([...rejected, url])].slice(0, 3) });
      }}
    />
  );
  return (
    <span ref={ref} className="entity-artwork" data-kind={kind}>
      {value?.sourceUrl ? (
        <a
          href={value.sourceUrl}
          target="_blank"
          rel="noreferrer"
          title={value.credit}
          aria-label={`Photo credits for ${name}`}
        >
          {cover}
        </a>
      ) : (
        cover
      )}
    </span>
  );
}
