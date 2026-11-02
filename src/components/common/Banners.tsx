import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, CircleAlert, Layers, X } from "lucide-react";

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface BannersProps {
  error?: string | null;
  playbackError?: string | null;
  playbackErrorId?: string | null;
  message?: string | null;
  messageAction?: ToastAction | null;
  hasTrack?: boolean;
  onRetryPlayback?: () => void;
  onDismissError: () => void;
  onDismissMessage: () => void;
}
interface ErrorToast {
  id: string;
  text: string;
  playback: boolean;
  addedAt: number;
}

export function Banners({
  error,
  playbackError,
  playbackErrorId,
  message,
  messageAction,
  hasTrack,
  onRetryPlayback,
  onDismissError,
  onDismissMessage,
}: BannersProps) {
  const [errors, setErrors] = useState<ErrorToast[]>([]);
  const [host, setHost] = useState<Element | null>(null);
  const [hovered, setHovered] = useState(false);
  const hoveredRef = useRef(false);
  hoveredRef.current = hovered;

  const playbackId = `playback:${playbackErrorId || ""}:${playbackError || ""}`;

  const remember = (item: { id: string; text: string; playback: boolean }) => {
    setErrors((previous) => {
      // Deduplicate by text: don't create multiple toasts for the same error message
      const existingIndex = previous.findIndex((old) => old.text === item.text);
      if (existingIndex !== -1) {
        const existing = previous[existingIndex];
        const updated = [...previous];
        updated[existingIndex] = {
          ...existing,
          // Upgrade to playback retry if the new error has it
          id: item.playback ? item.id : existing.id,
          playback: existing.playback || item.playback,
          addedAt: Date.now(), // Refresh 10s timer on repeat
        };
        return updated;
      }
      return [...previous, { ...item, addedAt: Date.now() }];
    });
  };

  useEffect(() => {
    if (error) remember({ id: `error:${error}`, text: error, playback: false });
  }, [error]);

  useEffect(() => {
    if (playbackError) remember({ id: playbackId, text: playbackError, playback: true });
  }, [playbackError, playbackId]);

  // 10-second auto-dismiss for error toasts (paused when hovered)
  useEffect(() => {
    if (!errors.length) return;
    const interval = setInterval(() => {
      if (hoveredRef.current) return;
      const now = Date.now();
      setErrors((prev) => {
        const remaining = prev.filter((e) => now - e.addedAt < 10000);
        if (remaining.length !== prev.length) {
          if (!remaining.length) onDismissError();
          return remaining;
        }
        return prev;
      });
    }, 500);
    return () => clearInterval(interval);
  }, [errors.length, onDismissError]);

  useEffect(() => {
    let active = true;
    // Wait for sibling dialogs to open/close before selecting their top-layer host.
    queueMicrotask(() => {
      if (!active) return;
      const dialogs = document.querySelectorAll("dialog[open]");
      setHost(dialogs[dialogs.length - 1] || document.body);
    });
    return () => {
      active = false;
    };
  });

  const handleMouseLeave = () => {
    setHovered(false);
    // Refresh remaining errors so they don't vanish immediately upon cursor exit
    const now = Date.now();
    setErrors((prev) => prev.map((e) => ({ ...e, addedAt: now })));
  };

  if (!errors.length && !message) return null;

  const isStacked = errors.length > 1 && !hovered;
  // Display latest error first in the stack
  const displayedErrors = [...errors].reverse();

  const content = (
    <section
      className={`notification-stack ${isStacked ? "is-stacked" : "is-expanded"}`}
      aria-label="Notifications"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={handleMouseLeave}
      onFocus={() => setHovered(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) {
          handleMouseLeave();
        }
      }}
    >
      {displayedErrors.length > 0 && (
        <div className={`toast-cards-wrapper ${isStacked ? "is-stacked" : "is-expanded"}`}>
          {displayedErrors.map((item, index) => {
            const stackLevel = Math.min(index, 3);
            const isFrontCard = index === 0;
            return (
              <aside
                key={item.id}
                className="apple-toast banner error"
                role="alert"
                data-stack-level={stackLevel}
              >
                <CircleAlert className="toast-symbol" size={18} aria-hidden="true" />
                <div className="toast-content">
                  <div className="toast-header-row">
                    <p className="toast-text">{item.text}</p>
                    {isStacked && isFrontCard && errors.length > 1 && (
                      <span className="toast-stack-badge" title="Hover to view all alerts">
                        <Layers size={11} />+{errors.length - 1} more
                      </span>
                    )}
                  </div>
                  {item.playback &&
                    item.id === playbackId &&
                    playbackError &&
                    hasTrack &&
                    onRetryPlayback && (
                      <button
                        type="button"
                        className="toast-retry"
                        onClick={onRetryPlayback}
                      >
                        Retry playback
                      </button>
                    )}
                </div>
                <button
                  type="button"
                  className="apple-toast-close"
                  aria-label="Dismiss error"
                  onClick={() => {
                    setErrors((previous) => previous.filter((old) => old.id !== item.id));
                    if (!item.playback && item.text === error) onDismissError();
                    if (errors.length <= 1) onDismissError();
                  }}
                >
                  <X size={15} />
                </button>
              </aside>
            );
          })}
        </div>
      )}
      {message && (
        <aside className="apple-toast success" role="status" aria-live="polite">
          <Check className="toast-symbol" size={17} aria-hidden="true" />
          <span className="toast-text">{message}</span>
          {messageAction && (
            <button
              type="button"
              className="toast-action"
              onClick={() => {
                messageAction.onClick();
                onDismissMessage();
              }}
            >
              {messageAction.label}
            </button>
          )}
          <button
            type="button"
            className="apple-toast-close"
            aria-label="Dismiss notification"
            onClick={onDismissMessage}
          >
            <X size={15} />
          </button>
        </aside>
      )}
    </section>
  );
  return host ? createPortal(content, host) : null;
}
