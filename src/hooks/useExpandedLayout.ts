import { useSyncExternalStore } from "react";

// Use available window space, including split-screen, rather than device orientation.
export const expandedLayoutQuery = "(min-width: 900px) and (min-height: 600px), (min-width: 769px) and (min-height: 600px) and (pointer: fine)";
const subscribe = (notify: () => void): (() => void) => {
  const media = window.matchMedia(expandedLayoutQuery);
  media.addEventListener("change", notify);
  return () => media.removeEventListener("change", notify);
};
export function useExpandedLayout(): boolean {
  return useSyncExternalStore(subscribe, () => window.matchMedia(expandedLayoutQuery).matches, () => false);
}
