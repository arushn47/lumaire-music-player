import { useEffect, useState } from "react";
import { Laptop, Play, Smartphone, X } from "lucide-react";
import type { PlaybackCheckpoint } from "../../domain/playback-checkpoint";
import { formatCheckpointAge } from "../../domain/playback-checkpoint";
import { Artwork } from "../common";

export interface PlaybackHandoffCardProps {
  checkpoint: PlaybackCheckpoint;
  onContinue: () => void;
  onDismiss: () => void;
}

function getDeviceIcon(name?: string) {
  const lower = (name || "").toLowerCase();
  if (
    lower.includes("mac") ||
    lower.includes("pc") ||
    lower.includes("laptop") ||
    lower.includes("computer") ||
    lower.includes("windows") ||
    lower.includes("desktop")
  ) {
    return Laptop;
  }
  return Smartphone;
}

export function PlaybackHandoffCard({
  checkpoint,
  onContinue,
  onDismiss,
}: PlaybackHandoffCardProps) {
  const [now, setNow] = useState(Date.now());

  // Update age display every minute
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(timer);
  }, []);

  const currentEntry = checkpoint.queue.find(
    (e) => e.id === checkpoint.currentEntryId,
  );
  const track = currentEntry?.metadata;
  const age = formatCheckpointAge(checkpoint.capturedAt, now);
  const ageInHours = (now - checkpoint.capturedAt) / (1000 * 60 * 60);
  const isOld = ageInHours > 0.5;

  if (!track) return null;

  const deviceName = checkpoint.deviceName || "Other Device";
  const DeviceIcon = getDeviceIcon(checkpoint.deviceName);

  return (
    <aside
      className="handoff-card"
      aria-label={`Continue playback from ${deviceName}`}
    >
      <div className="handoff-body">
        <div className="handoff-artwork-wrap">
          <Artwork url={track.artworkUrl} className="handoff-artwork" />
        </div>

        <div className="handoff-content">
          <div className="handoff-eyebrow">
            <span className="handoff-device-badge">
              <DeviceIcon size={13} strokeWidth={2.2} />
              <span>Continue from {deviceName}</span>
            </span>
            <span className="handoff-dot-separator">•</span>
            <span
              className={`handoff-timestamp ${isOld ? "handoff-timestamp-old" : ""}`}
            >
              {age}
            </span>
          </div>

          <div className="handoff-track-title" title={track.title}>
            {track.title}
          </div>
          <div className="handoff-track-artist" title={track.artist}>
            {track.artist}
          </div>

          <div className="handoff-meta-row">
            {checkpoint.playlistName && (
              <span className="handoff-pill-meta">
                From: {checkpoint.playlistName} •{" "}
              </span>
            )}
            <span className="handoff-pill-meta">
              {checkpoint.queue.length}{" "}
              {checkpoint.queue.length === 1 ? "track" : "tracks"} in queue
            </span>
            {checkpoint.shuffle && (
              <span className="handoff-pill-meta">• Shuffle on</span>
            )}
            {checkpoint.repeat !== "off" && (
              <span className="handoff-pill-meta">
                • Repeat {checkpoint.repeat}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="handoff-actions">
        <button
          type="button"
          className="handoff-button"
          onClick={onContinue}
          aria-label="Continue listening"
        >
          <Play size={13} fill="currentColor" />
          <span>Continue</span>
        </button>

        <button
          type="button"
          className="handoff-dismiss"
          onClick={onDismiss}
          aria-label="Dismiss"
          title="Dismiss"
        >
          <X size={15} />
        </button>
      </div>
    </aside>
  );
}
