import { Check, Download, LoaderCircle } from "lucide-react";
import type { EngineInstallProgress, EngineInstallState } from "../../domain/types";

export interface EngineSetupProps {
  engineState: EngineInstallState;
  engineError: string;
  engineProgress: EngineInstallProgress | null;
  engineCancelling: boolean;
  onInstallYoutubeEngine: () => Promise<void>;
  onCancelYoutubeEngineInstall: () => Promise<void>;
  required?: boolean;
}

export function EngineSetupCard({ engineState, engineError, engineProgress: progress, engineCancelling, onInstallYoutubeEngine, onCancelYoutubeEngineInstall, required = false }: EngineSetupProps) {
  const installing = engineState === "installing";
  const checking = engineState === "checking";
  const installed = engineState === "installed";
  const percent = progress?.stage === "downloading" && progress.total
    ? Math.min(100, Math.floor(progress.received / progress.total * 100)) : undefined;
  const stage = !progress ? "Preparing download…" : {
    connecting: `Connecting to the official download · ${progress.component}`,
    retrying: `Retrying ${progress.component} · attempt ${progress.attempt} of 3`,
    downloading: `Downloading ${progress.component}${percent === undefined ? "" : ` · ${percent}%`}`,
    verifying: `Verifying ${progress.component}`,
    testing: "Testing online playback components…",
    activating: "Finishing setup…",
  }[progress.stage];
  return <section className="engine-setup" aria-label="Online playback setup" aria-busy={checking || installing} data-stage={installing ? progress?.stage : engineState}>
    <div className="engine-setup-content">
      <strong>{installed ? "Online playback is ready" : installing ? "Setting up online playback" : checking ? "Checking online playback" : "Enable online playback"}</strong>
      <p>{installed ? "Ready to listen. No restart needed."
        : checking ? "Checking the components on this device. Your local music is ready to use."
        : installing ? required ? "Keep Lumaire open while setup finishes. This dialog closes when playback is ready." : "You can keep browsing while setup finishes. Keep Lumaire open."
        : required ? "Download the free playback components once to continue into Lumaire. If setup fails or is cancelled, retry here."
        : "Download the free playback components once to listen to online discoveries. Local music works without this step."}</p>
      {installing && <div className="engine-install-progress">
        <p role="status" aria-live="polite">{engineCancelling ? "Cancelling… Waiting for the current check to stop." : stage}</p>
        <progress aria-label="Online playback setup progress" max={100} value={percent} />
        {progress?.stage === "downloading" && <small>{(progress.received / 1048576).toFixed(1)} MB{progress.total ? ` of ${(progress.total / 1048576).toFixed(1)} MB` : " downloaded"} · file {progress.component === "yt-dlp.exe" ? "1" : "2"} of 2</small>}
      </div>}
      {engineError && <p className="engine-install-error" role="alert">{engineError}</p>}
      {!installed && <details><summary>What gets installed?</summary>
        <p>yt-dlp and QuickJS from their official releases. Lumaire checks for stable engine updates automatically, verifies downloads and tests them before use. Components stay private to Lumaire; no administrator access is needed.</p>
        <a href="https://github.com/yt-dlp/yt-dlp/releases" target="_blank" rel="noreferrer">yt-dlp source & licences</a>{" · "}
        <a href="https://github.com/quickjs-ng/quickjs/releases" target="_blank" rel="noreferrer">QuickJS source & MIT licence</a>
      </details>}
    </div>
    <div className="engine-setup-actions">
      <button className={installed ? "subtle" : "primary engine-setup-action"} disabled={checking || installing || installed} onClick={() => void onInstallYoutubeEngine()}>
        {installed ? <Check size={16} aria-hidden="true" /> : checking || installing ? <LoaderCircle size={16} className="updater-spinner" aria-hidden="true" /> : <Download size={16} aria-hidden="true" />}
        {installed ? "Installed" : checking ? "Checking…" : installing ? "Setting up…" : engineState === "error" ? "Retry setup" : "Enable online playback"}
      </button>
      {installing && <button className="subtle" disabled={engineCancelling || !progress || progress.stage === "activating"} onClick={() => void onCancelYoutubeEngineInstall()}>Cancel setup</button>}
    </div>
  </section>;
}
