import { invoke } from "@tauri-apps/api/core";
import type { Track } from "../domain/types";
import type { SharedState } from "../domain/nearby";
import type { SyncState, SyncPeer } from '../domain/device-sync';
import type { ImportRow } from '../domain/playlist-import';
export const collections = {
  readPlaylistFile: (): Promise<string | null> => invoke("read_playlist_file"),
  readPlaylistLink: (link: string): Promise<{ name: string; rows: (ImportRow & { track?: Track | null })[]; warning: string }> => invoke('read_playlist_link', { link }),
  saveCatalogTracks: (tracks: Track[]): Promise<Track[]> => invoke("save_catalog_tracks", { tracks }),
  startSharing: (): Promise<string> => invoke("nearby_start"),
  stopSharing: (forget = false): Promise<void> => invoke("nearby_stop", { forget }),
  publish: (data: SharedState): Promise<void> => invoke("nearby_publish", { data }),
  fetch: (link: string): Promise<SharedState> => invoke("nearby_fetch", { link }),
  rediscover: (link: string): Promise<string> => invoke("nearby_rediscover", { link }),
  syncState: (since = 0): Promise<SyncState> => invoke('get_sync_state', { since }),
  exchange: (link: string): Promise<boolean> => invoke('nearby_exchange', { link }),
  historySync: (enabled: boolean): Promise<SyncState> => invoke('set_history_sync', { enabled }),
  favoritesSync: (enabled: boolean): Promise<SyncState> => invoke('set_favorites_sync', { enabled }),
  getPeer: (): Promise<SyncPeer | null> => invoke('get_sync_peer'),
};

// Playback checkpoint commands
export const checkpoint = {
  async save(checkpoint: unknown): Promise<void> {
    await invoke('save_playback_checkpoint', { checkpoint });
  },

  async getAll(): Promise<unknown[]> {
    return await invoke('get_playback_checkpoints');
  },

  async delete(deviceId: string): Promise<void> {
    await invoke('delete_playback_checkpoint', { deviceId });
  },
};
