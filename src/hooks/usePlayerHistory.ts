import { useEffect } from "react";

// Own the history entry above both player layouts so resizing cannot dismiss it.
export function usePlayerHistory(open: boolean, onClose: () => void): void {
  useEffect(() => {
    if (!open) return;
    const marker = Date.now();
    history.pushState({ ...history.state, mobileNowPlaying: marker }, "");
    window.addEventListener("popstate", onClose);
    return () => {
      window.removeEventListener("popstate", onClose);
      if (history.state?.mobileNowPlaying === marker) history.back();
    };
  }, [open, onClose]);
}
