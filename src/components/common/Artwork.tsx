import { useEffect, useRef, useState } from "react";
import { convertFileSrc, invoke, isTauri } from "@tauri-apps/api/core";
import { Music2 } from "lucide-react";

const pending = new Map<string, Promise<string | null>>();
const resolved = new Map<string, string>();

function displayArtworkUrl(url?: string | null) {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== "i.ytimg.com") return url;
    const match = parsed.pathname.match(/^\/vi(?:_webp)?\/([\w-]{11})\//);
    return match ? `https://i.ytimg.com/vi/${match[1]}/mqdefault.jpg` : url;
  } catch {
    return url;
  }
}

function cached(url: string) {
  let request = pending.get(url);
  if (!request) {
    if (pending.size >= 256) pending.delete(pending.keys().next().value!);
    request = invoke<string>("cached_artwork", { url })
      .then(path => {
        const local = convertFileSrc(path);
        if (resolved.size >= 256) resolved.delete(resolved.keys().next().value!);
        resolved.set(url, local);
        return local;
      })
      .catch(() => {
        pending.delete(url);
        return null;
      });
    pending.set(url, request);
  }
  return request;
}

/** Reuse the backend-owned artwork cache, including embedded local-file covers. */
export async function artworkImageSource(url: string): Promise<string | null> {
  const display = displayArtworkUrl(url)!;
  if (!isTauri() || display.startsWith("data:")) return display;
  return await cached(display) || (display.startsWith("local:") ? null : display);
}

export interface ArtworkProps {
  onError?: () => void;
  url?: string | null;
  className?: string;
  kind?: "track" | "album" | "artist";
}

export function Artwork({
  url,
  className = "",
  kind,
  onError,
}: ArtworkProps) {
  const displayUrl = displayArtworkUrl(url);
  const [failed, setFailed] = useState<string | null>(null);
  const [local, setLocal] = useState<{ url: string; path: string } | null>(
    null,
  );
  const [visible, setVisible] = useState(false);
  const [fallback, setFallback] = useState<string | null>(null);
  const ref = useRef<HTMLSpanElement>(null);

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

  useEffect(() => {
    let cancelled = false;
    if (displayUrl && visible && isTauri())
      void cached(displayUrl).then((path) => {
        if (!cancelled) {
          if (path) setLocal({ url: displayUrl, path });
          else if (displayUrl.startsWith("local:")) setFailed(displayUrl);
          else setFallback(displayUrl);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [displayUrl, visible]);

  const isLocalIdentity = displayUrl?.startsWith("local:");
  const imgSrc =
    displayUrl && resolved.has(displayUrl) ? resolved.get(displayUrl) : local?.url === displayUrl
      ? local.path
      : !isLocalIdentity
        ? displayUrl
        : null;

  const canShow =
    Boolean(imgSrc) &&
    failed !== displayUrl &&
    (!isTauri() || (displayUrl && resolved.has(displayUrl)) || local?.url === displayUrl || fallback === displayUrl);

  const handleError = () => {
    if ((local?.url === displayUrl || (displayUrl && resolved.has(displayUrl))) && !isLocalIdentity && displayUrl) {
      resolved.delete(displayUrl);
      pending.delete(displayUrl);
      setLocal(null);
      setFallback(displayUrl);
    } else {
      setFailed(displayUrl);
      onError?.();
    }
  };

  return (
    <span
      className={`cover ${className}`}
      ref={ref}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {canShow && imgSrc ? (
        <img
          src={imgSrc}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={handleError}
        />
      ) : kind === "artist" || className.includes("artist") ? (
        <svg
          viewBox="0 0 24 24"
          fill="currentColor"
          className="artist-fallback-icon"
          aria-hidden="true"
        >
          <circle cx="12" cy="7" r="4" />
          <path d="M12 13.5c-3.8 0-6.8 2.5-7.1 5.8-.1.6.4 1.2 1 1.2h12.2c.6 0 1.1-.6 1-1.2-.3-3.3-3.3-5.8-7.1-5.8z" />
        </svg>
      ) : (
        <Music2 size={20} />
      )}
    </span>
  );
}
