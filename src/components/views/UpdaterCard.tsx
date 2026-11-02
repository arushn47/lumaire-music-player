import { useState, useSyncExternalStore } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Download, LoaderCircle, RefreshCw } from "lucide-react";
import { checkForUpdates, downloadUpdate, restartAndUpdate, getUpdateState, subscribeToUpdates, supportsWindowsUpdates, supportsAndroidUpdates } from "../../adapters/updater";

function NoteContent({ text }: { text: string }) {
  const inline = (value: string) => value.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, index) =>
    part.startsWith('**') ? <strong key={index}>{part.slice(2, -2)}</strong>
      : part.startsWith('`') ? <code key={index}>{part.slice(1, -1)}</code> : part);
  return <div className="updater-notes">{text.slice(0, 20000).trim().split(/\r?\n\s*\r?\n/).map((block, index) => {
    const heading = block.match(/^#{1,6}\s+([^\n]+)$/);
    if (heading) return <h5 key={index}>{inline(heading[1])}</h5>;
    const lines = block.split(/\r?\n/);
    if (lines.every(line => /^[-*]\s+/.test(line))) return <ul key={index}>{lines.map((line, i) => <li key={i}>{inline(line.replace(/^[-*]\s+/, ''))}</li>)}</ul>;
    return <p key={index}>{inline(lines.join(' '))}</p>;
  })}</div>;
}

function ReleaseNotes({ text }: { text: string }) {
  const versions = [...text.matchAll(/^#{1,2}\s+(?:Lumaire\s+)?v?\d+\.\d+\.\d+[^\n]*$/gm)];
  const older = versions[1]?.index;
  return <><NoteContent text={(older === undefined ? text : text.slice(0, older)).replace(/^# Lumaire v\d+\.\d+\.\d+[^\n]*\r?\n\s*\r?\n/, "")} />
    {older !== undefined && <details className="updater-history"><summary>Earlier versions</summary><NoteContent text={text.slice(older)} /></details>}
  </>;
}

export function UpdaterCard() {
  const state = useSyncExternalStore(subscribeToUpdates, getUpdateState, getUpdateState);
  const [linkError, setLinkError] = useState("");
  const android = supportsAndroidUpdates();
  if (!android && !supportsWindowsUpdates()) return null;
  const busy = ["checking", "downloading", "restarting"].includes(state.stage);
  const status = android ? "Updates for Android"
    : state.stage === "development" ? "Development build"
    : state.stage === "unconfigured" ? "Updates aren't configured"
    : state.stage === "current" ? "You're up to date"
    : state.stage === "downloading" ? "Downloading your update"
    : ["ready", "restarting"].includes(state.stage) ? "Your update is ready"
    : state.version ? `Lumaire v${state.version} is available` : "Keep Lumaire up to date";
  const release = !android && state.version ? {version: state.version, notes: state.notes || "No release notes were supplied for this update."} : state.installedRelease;
  return <section className="settings-section updater-section" aria-label="Software updates">
    <h3 className="section-label">Software updates</h3>
    <div className="settings-card-group">
      <div className="updater-controls">
        <div className="row-text" role="status" aria-live="polite">
          <strong>{status}</strong>
          <small>Installed v{state.currentVersion}{!android && state.version ? ` · New v${state.version}` : ""}</small>
        </div>
        {android ? <>
          <button className="primary updater-action" onClick={() => void openUrl("https://github.com/arushn47/lumaire-music-player/releases/latest").catch(() => setLinkError("Couldn't open releases. Visit github.com/arushn47/lumaire-music-player/releases in your browser."))}><Download size={18} aria-hidden="true" /> Download Android update</button>
          <p>Opens the latest release with APK downloads. Install over Lumaire to keep your music and settings.</p>
        </> : <>
          {state.stage === "downloading" ? <div className="updater-download-status" role="status"><LoaderCircle size={18} className="updater-spinner" aria-hidden="true" /><span>Downloading update{state.progress === undefined ? "…" : ` · ${state.progress}%`}</span><progress aria-label="Update download progress" max={100} value={state.progress} /></div>
            : ["ready", "restarting"].includes(state.stage) ? <>
              <button className="primary updater-action" disabled={busy} onClick={() => void restartAndUpdate()}><RefreshCw size={18} aria-hidden="true" />{state.stage === "restarting" ? "Restarting…" : "Restart & Update"}</button>
              <p>Playback will stop while Lumaire restarts. Your library and settings stay in place.</p>
            </> : state.version && ["available", "error"].includes(state.stage) ? <>
              <button className="primary updater-action" onClick={() => void downloadUpdate()}><Download size={18} aria-hidden="true" />{state.stage === "error" ? "Retry download" : `Download update v${state.version}`}</button>
              <p>Keep listening while it downloads. Restart when you're ready.</p>
            </> : <button className="primary updater-action" disabled={busy} onClick={() => void checkForUpdates()}>{state.stage === "checking" ? <LoaderCircle size={18} className="updater-spinner" aria-hidden="true" /> : <RefreshCw size={18} aria-hidden="true" />}{state.stage === "checking" ? "Checking for updates…" : "Check for updates"}</button>}
        </>}
        {(state.error || linkError) && <p className="updater-error" role="alert">{linkError || state.error}</p>}
      </div>
      <div className="updater-details updater-details--notes">
        {android && <details className="updater-history"><summary>Installing on Android</summary><p>Download and open the newer APK. Android asks you to confirm installation. The package and signing certificate must match your installed app. Do not uninstall first; uninstalling deletes private app data.</p></details>}
        {!android && state.stage === 'development' && <p>Update checks are disabled in development builds. Signed installed releases can download and install updates without uninstalling Lumaire.</p>}
        {!android && state.stage === 'unconfigured' && <p>No signed update feed is available yet. Updates appear here after a newer Windows release and its update manifest are published.</p>}
        {release && <>
          <h4>What's new in v{release.version}</h4>
          {!android && state.date && <small>Released {new Date(state.date).toLocaleDateString()}</small>}
          <ReleaseNotes text={release.notes} />
        </>}
        {!android && state.version && state.installedRelease && state.installedRelease.version !== state.version && <details className="updater-history"><summary>Earlier version · v{state.installedRelease.version}</summary><ReleaseNotes text={state.installedRelease.notes} /></details>}
      </div>
    </div>
  </section>;
}
