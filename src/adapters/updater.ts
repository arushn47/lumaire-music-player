import { isTauri } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { check, type Update } from "@tauri-apps/plugin-updater";
import bundledNotes from "../../docs/RELEASE_NOTES.md?raw";
import config from "../../src-tauri/tauri.conf.json";

export type UpdateStage = "idle" | "development" | "checking" | "unconfigured" | "current" | "available" | "downloading" | "ready" | "restarting" | "error";
export interface UpdateState {
  stage: UpdateStage;
  currentVersion: string;
  version?: string;
  date?: string;
  notes?: string;
  progress?: number;
  error?: string;
  installedRelease?: { version: string; notes: string };
  unreadNotes?: boolean;
}

export const supportsWindowsUpdates = (): boolean => isTauri() && /Windows/i.test(navigator.userAgent);
const settings = config.plugins.updater;
const configured = (): boolean => Boolean(settings.pubkey.trim()) && settings.endpoints.length > 0 && settings.endpoints.every((endpoint) => Boolean(endpoint.trim()));
let update: Update | null = null;
let state: UpdateState = { stage: configured() ? "idle" : "unconfigured", currentVersion: config.version };
const listeners = new Set<() => void>();
export const getUpdateState = (): UpdateState => state;
export function subscribeToUpdates(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
function publish(next: Partial<UpdateState>): void {
  state = { ...state, ...next };
  listeners.forEach((listener) => listener());
}
function failed(error: unknown): void {
  const message = String(error);
  const missing = /404|not found|pubkey|public key|could not fetch a valid release json/i.test(message);
  const network = /error sending request|network|timed?\s*out|dns|connection|certificate|tls/i.test(message);
  publish({ stage: missing ? "unconfigured" : "error", error: missing ? undefined : network
    ? "Could not reach the update server on GitHub. Check your connection and whether your VPN, proxy or firewall allows GitHub release downloads, then try again. Your installed app has not changed."
    : `Unable to update. ${message}` });
}
const VERSION_KEY = "lumaire:last-installed-version";
const NOTES_KEY = "lumaire:installed-release-notes";
const PENDING_KEY = "lumaire:pending-release-notes";
function storedRelease(key: string): { version: string; notes: string } | undefined {
  try {
    const text = localStorage.getItem(key);
    if (!text || text.length > 25000) return;
    const value = JSON.parse(text);
    if (typeof value?.version === "string" && /^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(value.version) && typeof value.notes === "string" && value.notes.length <= 20000) return value;
  } catch { /* Updates still work when local storage is unavailable. */ }
}
function saveRelease(key: string, value: unknown): void {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Optional local release log. */ }
}
let initialized: Promise<void> | undefined;
/** Check once per launch in the background; downloading and installing remain explicit. */
export function initializeUpdates(): Promise<void> {
  return initialized ??= (async () => {
    if (!supportsWindowsUpdates() && !supportsAndroidUpdates()) return;
    try {
      const version = await getVersion();
      const pending = storedRelease(PENDING_KEY);
      let previous: string | null = null;
      try { previous = localStorage.getItem(VERSION_KEY); } catch { /* Optional. */ }
      const changed = !!previous && previous !== version;
      const firstRelease = !previous && !import.meta.env.DEV;
      const installed = pending?.version === version ? pending : changed || firstRelease ? { version, notes: bundledNotes.slice(0, 20000) } : storedRelease(NOTES_KEY);
      if (installed?.version === version) saveRelease(NOTES_KEY, installed);
      publish({ currentVersion: version, installedRelease: installed?.version === version ? installed : undefined, unreadNotes: changed || firstRelease || pending?.version === version });
      try {
        localStorage.setItem(VERSION_KEY, version);
        if (pending?.version === version) localStorage.removeItem(PENDING_KEY);
      } catch { /* Optional. */ }
    } catch { /* Keep the bundled version if the native version cannot be read. */ }
    if (supportsWindowsUpdates() && !import.meta.env.DEV && configured()) await checkForUpdates();
  })();
}
export function dismissReleaseNotes(): void { publish({ unreadNotes: false }); }
export const supportsAndroidUpdates = (): boolean => isTauri() && /Android/i.test(navigator.userAgent);

export async function checkForUpdates(): Promise<void> {
  if (["checking", "downloading", "ready", "restarting"].includes(state.stage)) return;
  publish({ stage: "checking", error: undefined, version: undefined, notes: undefined, date: undefined, progress: undefined });
  try {
    if (import.meta.env.DEV && supportsWindowsUpdates()) { publish({ stage: "development" }); return; }
    if (!supportsWindowsUpdates() || !configured()) {
      publish({ stage: "unconfigured" });
      return;
    }
    publish({ currentVersion: await getVersion() });
    if (update) await update.close();
    update = null;
    update = await check({ timeout: 15000 });
    publish(update ? { stage: "available", version: update.version, date: update.date, notes: update.body } : { stage: "current" });
  } catch (error) { failed(error); }
}
export async function downloadUpdate(): Promise<void> {
  if (!update || !["available", "error"].includes(state.stage)) return;
  publish({ stage: "downloading", progress: undefined, error: undefined });
  let received = 0;
  let total: number | undefined;
  try {
    await update.download((event) => {
      if (event.event === "Started") { total = event.data.contentLength; received = 0; }
      if (event.event === "Progress") received += event.data.chunkLength;
      // Keep 100% for a successful, signature-verified download promise.
      publish({ progress: total ? Math.min(99, Math.floor(received / total * 100)) : undefined });
    }, { timeout: 120000 });
    publish({ stage: "ready", progress: 100 });
  } catch (error) { failed(error); }
}
export async function restartAndUpdate(): Promise<void> {
  if (!update || state.stage !== "ready") return;
  publish({ stage: "restarting", error: undefined });
  try {
    saveRelease(PENDING_KEY, { version: state.version, notes: state.notes?.slice(0, 20000) || "No release notes were supplied for this update." });
    await update.install({ restartAfterInstall: true });
  } catch (error) {
    publish({ stage: "ready", error: `Installation failed. You can retry. ${String(error)}` });
  }
}
