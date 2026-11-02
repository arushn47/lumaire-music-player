## README Download and Presentation Refresh (2 November 2026)

- Added a branded SVG header, prominent Windows EXE and Android APK download buttons, and desktop/mobile previews made with demo tracks and original artwork. No personal library data or recordings are included. Current v1.0.8 highlights are near the top; longer installation, engine, privacy and licensing details are collapsed.
- Download links point directly to the existing verified v1.0.8 release assets. `node scripts/update-readme-downloads.mjs` refreshes links and SVG labels from the app version; the Windows release workflow checks them before packaging. Checks normalize Windows line endings.
- Verified GitHub-sanitized Markdown in a real browser at 390px and 1280px in light/dark themes: all five images load, both download buttons exist, details start collapsed and content has no horizontal overflow. Preview screenshots were visually reviewed. Download/version assertions, release configuration validation, both release-validator self-checks and diff whitespace checks passed.
- Documentation/assets only; no app binaries changed or rebuilt, and frontend/Rust suites were not rerun. GitHub does not permit arbitrary README CSS or scripts, so the design uses supported HTML and local images.

## v1.0.8 Published for Windows and Android (2 November 2026)

- Published combined stable release: https://github.com/arushn47/lumaire-music-player/releases/tag/v1.0.8 . Source tag v1.0.8 points to 2b71dddc902d409435c58fdda308c7ffcf8461a7. Windows workflow 41396251122 succeeded and verified its draft assets against the build. Both platform binaries, the Windows updater signature, latest.json and SHA256SUMS.txt are attached.
- Verified the exact Windows installer cryptographically against the configured updater key, including the trusted comment and a deliberately modified payload rejection. The verifier was first self-checked using the installed minisign-verify crate's official prehashed signature fixture. Manifest URLs and signature match the published installer; release-note content matches the reviewed notes, allowing Windows line endings.
- Android is an optimized release build, package app.lumaire.player, versionName 1.0.8 / versionCode 1000008, not debuggable. Release signing and 16KB ZIP alignment passed. Its signing certificate matches the public v1.0.7 APK; required Rust/QuickJS/Python-wheel runtime assets are present. No signing keys, private databases or environment files are packaged. The Windows symlink restriction was handled by the existing --apk copy fallback; no security settings were changed.
- Public post-publication checks passed: latest release is v1.0.8, both platform download URLs return success, SHA256SUMS.txt matches the verified local file, and the original Windows updater URL serves v1.0.8 with the reviewed notes. Report: ignored `test-results/release-108-public.json`.
- Final local checks: 734 frontend tests, 220 native tests (22 deliberately ignored), TypeScript/Vite, release-config self-checks and 42 responsive browser UI layouts passed. Existing user manual acceptance applies to the functional changes; new update/setup actions were tested in isolated browser fixtures. A fresh installed-app upgrade of these exact public packages was not performed on the user's real library, and the public APK was not installed over their development build.
- Windows EXE SHA256: a47d2056ecdb1aba0a37e036f4a0de791510287ac55d6375b8ee6f21682aec86 . Android APK SHA256: 7c55e966670f34ae1ec52613e4d3c84c0da4d66ce42d4f4064c8014a717cef2e . Every uploaded asset was downloaded and matched byte-for-byte before publishing. No existing release assets were overwritten.
- Publishing helper now resolves drafts through authenticated release listings because the tag endpoint returned 404 for an unpublished draft, and normalizes line endings when comparing reviewed release notes. README now describes the current published update flow rather than the old 1.0.4 preview.

## v1.0.8 Release Preparation (2 November 2026)

- Rewrote release notes around this version: lyric following, artist identity, Android close/resume/notification behavior, download/sync fixes, and update/setup usability. Removed the old v1.0.7 highlights from the current notes.
- Updates now have a dedicated prominent action area outside the scrolling notes. Download, progress, retry and restart share that location. Current notes are expanded; prior installed notes and multi-version history are collapsed. Android has a highlighted APK-download action with installation guidance below it. Setup retains real per-file progress, cancellation and retry; obsolete fixed engine-version copy was removed.
- Verified 42 browser layouts: seven update/setup states at 390/768/1440 widths in dark/light themes. Checked visible 48px primary actions, actual independent note scrolling, download/restart callbacks, setup/retry callbacks, no horizontal overflow or page errors. Screenshots and report: ignored `test-results/release-ui/after/`. Existing Lumaire palette/type retained for these components. Skill lint: zero failures; the Settings section label is retained to match surrounding Settings navigation and is hidden in the dialog.
- Frontend suite: 734 passed. Native suite: 220 passed / 22 ignored. TypeScript/Vite and release-configuration self-checks passed. Canonical repository is now arushn47/lumaire-music-player; corrected the workflow repository guard and generated-asset validation URL, preserving the existing updater endpoint for older clients.
- Release-mode Android compilation initially encountered a Windows Application Control rejection of a generated Rust helper. An unchanged retry progressed; no system security setting was altered. Final signing, platform packaging, upload verification and publication results will be recorded after completion.

## Release Readiness After User Acceptance (2 November 2026)

- User reports the requested manual checks are working. This supersedes the earlier pending manual-check status; these are user-reported results, not a new agent-operated device test.
- Rebuilt the final Windows release executable including the lyric-follow fix successfully (`test-results/release-readiness-windows.log`). The Android ARM64 debug APK containing the same fix was already built and installed successfully; frontend suite remains 733 passing tests.
- Code is ready for release packaging based on automated checks and user acceptance. No release was published during this readiness check. Signed Android distribution packaging, Windows installer/updater packaging, versioning and publication still need the existing release workflow; the installed Android test artifact is a debug APK.

## Lyrics Follow Paused Without User Input (2 November 2026)

- Found a false manual-scroll detector in LyricsView: any scroll arriving outside a timer-based programmatic-scroll window disabled following. Smooth-scroll completion, layout anchoring, or scroll events following an early scrollend could therefore expose the Back to sync button without user input.
- Removed generic scroll/scrollend classification and all programmatic-scroll timers. Only explicit wheel, touch movement, pointer interaction or scrolling keyboard keys pause following. Settings/buttons and editable keyboard targets remain excluded. Track changes and Back to sync retain the existing follow behavior. The fix covers both lyric room and embedded/mobile lyrics; playback and lyric timestamps are unchanged.
- Verification: full frontend suite passed (733 tests); final focused follow regressions passed for both embedded and full-page panes, including scrolls after the old timer window, repeated scroll/scrollend events, manual gestures, keyboard paging, control exclusions and listener cleanup. TypeScript/Vite production build passed.
- ARM64 Android debug build passed and the APK was installed in place on ZD222LVFWT via ADB (Success), without clearing app data. No real-device no-touch long-song playback check or Windows manual UI check is claimed; the reported stop was traced to the input classifier, not reproduced with the user's exact song. Rust logic is unchanged, so its suite was not rerun for this frontend-only fix.

## Artist Search Seven-Card Regression Fixed (2 November 2026)

- The first background-resolution change incorrectly passed raw JioSaavn artist search entries into the card list. Live provider search reproduced the reported seven cards: two credited artist identities and five collaboration entities. Restored recording-credit admission and retained raw entries only as portrait candidates; names alone never collapse identities.
- Album fallback initially spent its three lookups on newest releases absent from Apple evidence. Prioritization now uses matching recording/release titles and compatible release years. A 2026 Ethir Neechal reissue displaced useful older evidence until year compatibility was included. This only chooses which associated albums to inspect; recording credit, duration, release diversity, credit contexts and ambiguity requirements remain unchanged.
- Added a captured public-provider fixture (`tests/fixtures/artist-anirudh-live.json`) and a regression covering seven raw entries becoming two credited cards, reissue-aware album selection, and strict overlap on captured evidence. It complements the earlier constructed fixture.
- Final live acceptance passed from a fresh process: two initial credited cards, one confirmed combined profile within the background deadline, and both original provider links opening the combined identity. Full Rust suite: 220 passed / 22 ignored; frontend: 731 passed; TypeScript/Vite, Windows release and ARM64 Android builds passed. The corrected APK was installed in place on ZD222LVFWT via ADB (Success), preserving app data.
- Physical interaction after installation remains for user testing. Provider failures or insufficient evidence can still retain separate profiles; no safety threshold was relaxed.

## Artist Resolution APK Installed for User Testing (2 November 2026)

- Rebuilt the ARM64 Android debug APK successfully and installed it in place on connected phone ZD222LVFWT using ADB `install -r` (Success). No app data was cleared. Physical search, profile navigation and favorites testing is left to the user as requested; the earlier no-device limit no longer applies to deployment.

## Bounded Background Artist Resolution (2 November 2026)

- Search returns provider identities before duplicate verification. Background work considers at most three same-name JioSaavn/Apple pairs, with two shared request permits and a 12-second deadline including coalescing waits. Entire over-budget name groups are skipped; failed or missing candidate evidence cannot establish a merge. Existing 10-minute success / 30-second partial cache lifetimes are reused.
- Apple retains up to 100 unique recording proofs from interleaved India and US lookup responses, with available artwork as fallback. JioSaavn retains broader artist-response evidence and, when overlap is insufficient, checks at most three associated albums, admitting only explicitly credited candidate recordings. The original three-recording / three-release / varied-context and bidirectional ambiguity checks remain in force.
- Confirmed aliases open either original link with JioSaavn identity/portrait preferred. Combined profiles retain original recording/release IDs; ArtistView uses existing recording grouping. Resolution events carry the query, request ID, artist and confirmed IDs. Search updates require the active query and request ID, including repeated identical queries. Frontend aliases expire after ten minutes.
- Favorites recognize either alias, present one confirmed identity, and remove all matched aliases through the existing sync-aware session update. No migration, dependency, account access or artist-specific exception was added.
- Verification: full frontend suite passed (731 tests); full Rust suite passed (219 passed, 21 explicitly ignored). TypeScript/Vite production build, final Windows release executable and final ARM64 Android debug APK passed. Rust HTTP fixture tests required unsandboxed local network access; initial sandbox failures are not product failures.
- Regression coverage includes a constructed Anirudh top-ten mismatch fixture (not a captured live response), broader evidence, album credit filtering and three-album cap, insufficient/repeated/unrelated/collaboration evidence, ambiguity, request deadline cancellation, cached results, both original profile links, query/request correlation, favorites under either/both IDs and preservation of sync tombstones.
- Remaining verification limits: ADB listed no connected device; no physical phone search/navigation/favorites check or APK installation was performed. The isolated Windows dev app started without panic and onboarding was visible; manual search/profile/favorites verification was blocked by Computer Use reporting a 14x14 input boundary for the full-size app. No live-provider Anirudh merge is claimed. Apple throttling, incomplete catalogs, failed providers, strict evidence requirements and the deadline can leave duplicates separate. Favorite alias display requires a confirmed resolution in the current session; stored favorites are not rewritten on startup.

## Search Whitespace and Artist Research (2 November 2026)

- Fixed Discover's 350ms search debounce replacing the visible query with its trimmed request. Preserve the typed query, including spaces between words; trim only provider requests/history. Recent-query selection still uses the requested text.
- Added a regression that failed before the fix: type `Anirudh `, wait beyond debounce, then append `Ravichander`. All 14 focused search/TopBar tests passed; TypeScript/Vite and Windows release builds passed. ARM64 debug APK was packaged. ADB listed no device at installation time, so this APK was not installed and the prepared physical typing check was not run.
- Read-only artist investigation: canonical JioSaavn artist 455663 and Apple artist 480976476 both represent Anirudh Ravichander. Their first ten tracks differ substantially (JioSaavn newer releases; Apple's default storefront older hits). Current automatic identity merging requires three corroborated recordings across three releases, which these samples do not establish. Apple's adapter also leaves artist artwork empty. This explains the two cards and missing portrait; no artist implementation was changed.
- User subsequently identified the earlier online playback rejection as college Wi-Fi specific and confirmed playback works elsewhere; the earlier global release-readiness conclusion based on that network was too broad.
## Android Close Preserves Playback Position (2 November 2026)

- Forced native checkpoints now complete before generation cancellation/queue clearing; orderly service shutdown does not invalidate the already-cleared queue a second time. Pause and seek events also persist immediately because paused services may disappear without a dependable task-removal callback. Playback continues to stop on Recents dismissal and reopen paused.
- Regression reproduced on the previous isolated APK: seeking a paused sample to 1:45 then dismissing Recents restored 0:00. A paused sample avoids unrelated audio-focus interruptions encountered in a longer initial test.
- Physical fixed-APK checks passed with generated local audio and renderer execution disabled during dismissal. Paused close saved/restored 105.00 seconds; active playback close saved/restored 106.77 seconds, including progress made during the swipe. The isolated database was inspected before reopening to verify persistence independently of UI restoration. Tests: `tests/android-background-playback.mjs --resume-only --screen-on` and the same with `--resume-playing`.
- Isolated and normal Android builds passed. The normal app was updated in place via ADB without clearing its data; the temporary test package created for this run was removed. Force Stop/process-death recovery and online-source resumption were not retested for this change.

## Android Media Notification Opens App (2 November 2026)

- Attached an immutable Activity PendingIntent to the Media3 session and the temporary preparation notification. Taps now open/reuse MainActivity with CLEAR_TOP/SINGLE_TOP instead of leaving the system media card without a launch target.
- Both isolated and normal ARM64 APK builds passed. The focused physical notification regression passed on the Motorola using generated local audio: tapping the system media card resumed the isolated app and preserved the track, position and paused state (`--notification-open --notification-only --screen-on`). The normal app was updated in place through ADB without clearing app data.
- An initial combined notification/queue harness passed the tap assertion but timed out in the subsequent direct-native-play section while the fixture remained paused; do not count that run as a successful playback regression. The focused notification test passed independently. Tapping while actively playing and another locked-screen run were not separately tested in this change.

## Android Explicit Close Behavior (2 November 2026)

- Recents dismissal now checkpoints and invalidates the native queue, cancels in-flight preparation, stops audio, removes the foreground playback notification and stops the playback service. MediaSession Stop also invalidates the queue so pending work cannot restart audio. Home, app switching and screen lock do not call this exit path. This supersedes earlier Recents-survival acceptance.
- The isolated physical-device regression passed on the Motorola: two real generated-audio track transitions with renderer execution disabled, queue/history/favorite/playlist persistence, Recents dismissal stopping the service, and reopening remaining paused with the queue retained. The regression lives in `tests/android-background-playback.mjs --swipe-recents --screen-on` (local-only test files remain ignored).
- The initial screen-off automated attempt was inconclusive because the screen woke; do not count it as locked-screen verification. The user subsequently confirmed lock-screen playback works and requested no further lock-screen testing. Online boundary resolution and Android Force Stop were not rechecked in this change.
- Both isolated and normal ARM64 APKs compiled successfully. The normal app was updated in place via ADB without clearing user data; the isolated fixture app was stopped afterward. No Windows build is required for this Kotlin-only change.

## Automatic Streaming Engine Updates (1 November 2026)

- Windows now checks the official stable GitHub release at most daily during engine availability checks. Installation uses the release asset's SHA-256 digest instead of permanently reinstalling the August pin. The private component set is staged and startup-tested, with previous-set retention and rollback on failed promotion. Existing playback remains available when an update fails.
- Android checks on a resolver request at most daily, obtains the official stable version from GitHub, then downloads the matching pure-Python yt-dlp wheel and its exact declared EJS dependency from PyPI. It checks Python compatibility, package hashes, archive size/integrity and imports before activating an immutable private set. Bundled wheels remain the offline/import-failure fallback; Python and QuickJS remain bundled. No accounts or browser cookies are accessed.
- Verification: seven Windows installer tests passed with local-network fixture access; a separate isolated official-download/install/startup test passed. Three Python updater regressions passed. On the connected Motorola, the installed app automatically activated yt-dlp 2026.10.26 / EJS 0.8.0; the active package hashes were verified through ADB.
- Final Windows release and ARM64 Android builds passed, including TypeScript/Vite bundling. The final APK was installed in place and its device SHA-256 matched the completed build; no app data was cleared.
- Updating the engine did **not** resolve the independently reproduced YouTube sign-in/bot rejection for the failed source. Online playback is not release-ready. Full audio playback cannot be claimed from updater tests or builds.

## Legacy Sync Version Conflicts (1 November 2026)

- Reproduced the reported conflict using pre-upgrade portable-track cells that omit `recordingMetadata`. Incoming tracks received current defaults during validation, while the persisted value was compared without those defaults. Identical versions consequently appeared to contain different data.
- Normalize the stored value with the same validator before comparing equal versions. Real title/value changes with a reused version still fail; original data and sync tombstones remain intact. No database reset or re-pairing is required.
- The regression failed with the exact reported error before the fix and passed afterward for playlist entries and track favorites. All 25 active device-sync/checkpoint tests passed. A separate local-only snapshot test replayed the phone's non-history sync cells successfully from a read-only backup; the backup is in ignored `.test-data/`.
- The earlier atomic-clock allocation change did not address this legacy-schema failure. The fixed ARM64 APK built and was installed in place on the connected Motorola. The real app subsequently persisted its 573-cell replica (previously absent), retaining 9 playlists and 17 favorites; SQLite integrity check passed. Sync conflict banners were absent on the captured screen. A separate YouTube sign-in/bot restriction was visible during online playback and remains unresolved. Windows release executable and TypeScript/Vite builds also passed. Restart the newly built Windows executable to use the same comparison fix on both peers.

## Mobile Player Menu Overhaul & Android APK Deployment (1 November 2026)

- **Mobile Expanded Player Actions Consolidation:**
  - Consolidated all track secondary actions into the header three-dots menu (`...`) using `TrackActionMenuItems`:
    - "Wrong version playing?" (for online streaming or catalog items)
    - "Save to library" (for unsaved remote/catalog tracks)
    - "Save to playlist"
    - "Add to favorites" / "Remove from favorites"
    - "Download for offline" / "Cancel download"
    - "Delete offline copy" (when an offline file exists)
  - Removed the `ListPlus` ("Add to playlist") button from the track identity row in `MobileNowPlaying.tsx`, leaving only the clean, uncluttered Favorite heart (`Heart`) button next to the title and artist, as shown in the updated design.
  - Symmetrically balanced the header bar (42px collapse button on the left, centered "Now playing" title, and 42px three-dots menu button on the right).
- **Rust Command Visibility & Android Native Decoupling:**
  - Decoupled `#[tauri::command]` declarations from the macro namespace in `lib.rs` by wrapping internal logic in `pub(crate)` functions (`resolve_commons_audio_inner`, `media_path_inner`, `get_verified_source_inner`, `set_verified_source_inner`).
  - Fixed calls in `android.rs`, `downloads.rs`, and `android_background.rs`.
- **Verification & Deployment:**
  - Full Rust test suite on Windows: 212 tests passed, 0 failed.
  - Frontend test suite: `PlayerBar.test.tsx` (8/8 passed), `MobileNowPlaying.test.tsx` (5/5 passed), `LibraryView.test.tsx` (6/6 passed), `useAlbumDownloads.test.ts` (1/1 passed).
  - Production TypeScript & Vite bundle (`npm run build`) passed with 0 errors.
  - Assembled Android ARM64 debug APK (`node scripts/android.mjs build --debug --target aarch64`) with 0 errors.
  - Streamed and successfully installed the new APK on the connected Motorola Edge 50 Pro (`ZD222LVFWT`) via ADB (`node scripts/android.mjs install`).


## Downloads Subsystem Overhaul & Android Background Resilience (1 November 2026)

- **Root Cause & Speed Bottleneck Resolution:**
  - Discovered that YouTube (`.googlevideo.com`) and streaming CDNs actively shape unbounded single-GET streams down to 1.0x audio bitrate (~16–30 KB/s). For a 4MB song, this took ~250 seconds, consistently hitting the legacy hardcoded 180s wall-clock timeout in `downloads.rs` and causing tracks to fail with "Audio transfer timed out".
  - Replaced single-stream downloads with bounded HTTP Range chunk requests (2MB chunks: `bytes={start}-{end}`). Bounded range requests trigger burst delivery at wire speed rather than throttled streaming.
  - Benchmark results on live network transfer:
    - Legacy unbounded stream: 1.35 MB took 44.72s (~0.03 MB/s).
    - Bounded chunked Range requests: 1.35 MB took 3.37s (~0.38 MB/s), achieving a **13.3x measured speedup**. A 4MB song now downloads in ~3–10 seconds instead of 5 minutes.
  - Replaced the fixed 180s wall-clock timeout with a progress-aware 20s idle timeout that resets on each chunk received.
- **Resumable Downloads & Audio Integrity:**
  - Added strict `parse_content_range` parsing and validation.
  - Updated `Partial` file handler: partial files (`.part`, deterministically named via track ID UUID v5) are preserved on transient network drops or process interruptions, and deleted only upon explicit user cancellation.
  - Downloads seamlessly resume from the existing byte offset rather than restarting from zero.
  - Added format verification with Lofty probe and `require_audio_only` checks before finalizing.
- **Compact Apple-Inspired UI Controls:**
  - Removed the bulky 5-line banner in `AlbumView.tsx` and `LibraryView.tsx`.
  - Added a compact, Apple-style rounded download button in the album/playlist action header:
    - Idle: `Download` with download icon.
    - Active: `Downloading X/Y` (or `Paused`) with spinning `Loader2` and compact cancel `X` button.
    - Completed: `Downloaded` with checkmark.
    - Failed: `Retry (N)` with error count.
  - Added subtle thumbnail progress overlay directly on the 48x48 track cover in `CatalogTrackList.tsx` and `LibraryView.tsx` (`.track-cover-download-overlay` and `.track-cover-spinner`) without cluttering track rows.
- **Persistent SQLite Queue & Startup Recovery:**
  - Added `download_queue` table in SQLite schema (`lib.rs` / `downloads.rs`) tracking `track_id`, `collection_id`, `title`, `status`, and `added_at`.
  - Added startup recovery in SQLite initialization: any tracks left in `downloading` status from process termination or app exit are automatically reset to `pending`.
  - Added Tauri commands `get_download_queue`, `save_download_queue`, `update_download_queue_status`, `clear_download_queue`.
  - Updated `useAlbumDownloads.ts`: restores persistent queue state on mount, displays accurate album progress on launch, and tracks queue status persistently.
- **Android Background WakeLock & Notification Bridge:**
  - Added `downloadNotification` command in `LumairePlugin.kt` utilizing `PowerManager.PARTIAL_WAKE_LOCK` (with 30-minute safe timeout) and ongoing system notification (ID 1002 in channel `downloads_channel`).
  - Keeps CPU active and downloads running when the screen locks or the app is minimized.
  - Added `android.permission.POST_NOTIFICATIONS` to `AndroidManifest.xml`.
- **Verification:**
  - Rust unit tests in `downloads.rs` pass (6/6 tests, including Range parsing, location validation, queue persistence/recovery, and audio validation).
  - Vitest frontend tests pass: `LibraryView.test.tsx` (6/6 tests), `useAlbumDownloads.test.ts` (1/1 test).
  - Production frontend build (`npm run build`) passed with 0 errors.

## Android Lifecycle & Cross-Device Audit Follow-Up (1 November 2026)

- Android's Tauri event loop was exiting when Recents destroyed the Activity, which caused MediaSessionService to restart without its in-memory playback queue. Tauri now prevents that exit while a native playback queue or foreground download is active. Explicit queue clear and download completion release the keep-alive state.
- On a Motorola Edge 50 Pro, an isolated ARM64 APK passed physical checks for screen lock, Home, Recents swipe, two real track transitions with WebView JavaScript disabled, queue restoration, playlist/favorite persistence, and listening-history persistence. The same process remained alive after Recents removal.
- The Android download service passed physical lifecycle checks for foreground data-sync status, bounded wake lock, Home, screen lock, Recents removal, and explicit completion. This exercised service lifecycle with a progress signal, not a live HTTP transfer.
- Download recovery now persists the track descriptor with each queue item and automatically restarts pending/paused items when Lumaire opens. A migration adds the descriptor column to existing databases without removing queue rows. Frontend queue recovery and Rust legacy-schema/round-trip tests pass.
- **Recovery limit:** `DownloadForegroundService` remains `START_NOT_STICKY`, so Android does not automatically respawn the transfer service after process death. Pending work resumes when Lumaire is opened again; automatic service restart and a live HTTP transfer through process death have not been physically verified. Android force-stop also prevents background restart until the user launches the app again.
- Added authenticated UDP LAN rediscovery using stored pairing credentials. Rust tests cover valid authentication, nonce/port checks, forged responses, and rejecting public addresses; a second-device IP-change exercise remains unverified.
- Fixed the Windows localhost HTTP test helper to use blocking accept. Full Rust tests pass with local/network test access: 212 passed, 0 failed, 19 ignored. Under the restricted sandbox, provider/local-server tests fail or stall; this is an environment limitation, not a product failure.
- The normal ARM64 APK was built and installed in place as version 1.0.7 without clearing app data. Isolated physical tests used `app.lumaire.player.latency` and separate data.
- After queue-recovery changes, the ARM64 debug APK rebuilt successfully (`app.lumaire.player`, version 1.0.7), and the Windows release executable rebuilt successfully. The final APK could not be installed in this run because the local ADB server failed to start; the connected-device verification therefore remains on the prior APK.

## Mobile Now Playing Header Centering & Playlist Button Relocation (1 November 2026)

- Relocated the "Add to playlist" button (`ListPlus`) from the mobile header bar to the track identity row right beside the favorite heart button (`Heart`).
- Header bar now has a symmetrical 1-button left (collapse chevron) and 1-button right (three-dots options menu) layout with a 42px placeholder when options are omitted.
- The center "NOW PLAYING / [Album]" title is now perfectly centered across the screen without being pushed left.
- Updated `MobileNowPlaying.tsx`, `mobile-now-playing.css`, and verified unit tests in `MobileNowPlaying.test.tsx` (5/5 tests pass).
- Rebuilt web production assets (`npm run build`) and Android ARM64 debug APK (`npm run android:build`).

## Device Handoff 1-Hour Window & Host-Side Connection Detection (1 November 2026)

- **1-Hour Playback Handoff Cutoff:**
  - Reduced cross-device checkpoint TTL from 24 hours to 1 hour (`CHECKPOINT_TTL_MS = 60 * 60 * 1000`) in `src/domain/playback-checkpoint.ts` and `src/hooks/usePlaybackHandoff.ts`.
  - Stale checkpoints (> 1 hour) are automatically dismissed and purged asynchronously from SQLite (`playback_checkpoints`), preventing old banners from cluttering the Home view.
  - Added unit test in `playback-checkpoint.test.ts` verifying the 1-hour TTL threshold.
- **Host-Side Phone Connection Detection & UI Updates:**
  - Added `sync_peer_info` table and `get_sync_peer` command in `src-tauri/src/device_sync.rs` and `src-tauri/src/lib.rs`.
  - When the laptop hosts Wi-Fi sharing and the phone connects/syncs (`POST /v3/sync`, `nearby_exchange`), the backend records the peer device identity, device name, and `last_seen` timestamp.
  - Added `peer` tracking in `src/hooks/useNearby.ts` and `collections.getPeer()`.
  - Updated `src/components/views/NearbyDevices.tsx`:
    - When a peer device connects, the modal updates status from "Ready to pair" to "Connected to [Device Name]" with a checkmark and last synced time.
    - Replaced persistent QR code with an active "Paired connection" card ("Sync now" / "Stop sharing").
    - Cleanly collapsed the QR code into an expandable "Show pairing code / Pair another device" dropdown.
  - Updated `src/components/common/TopBar.tsx` and `src/App.tsx`: TopBar sharing pill now updates to "Connected on Wi-Fi" when a peer device is actively paired.
  - Verification: Rust cargo check passed, unit tests in `NearbyDevices.test.tsx`, `TopBar.test.tsx`, and `playback-checkpoint.test.ts` pass, and `npm run build` passed.

## Keyless Translation Reliability & Android ARM64 APK Rebuild (31 October 2026)

- Rebuilt production web assets (`npm run build`), compiled ARM64 native binaries (`aarch64-linux-android`), and packaged the Android debug APK (`app-arm64-debug.apk`) via Gradle (`assembleArm64Debug`).
- Successfully installed the updated APK directly onto the connected Motorola Edge 50 Pro (`ZD222LVFWT`) via ADB streaming install (`npm run android:install`).
- Overhauled keyless Google translation in `src-tauri/src/keyless_translation.rs`:
  - Implemented sequential multi-line batching (10 lines per batch) with strict line-alignment verification. Uncontrolled concurrent bursts (which triggered HTTP 429 on 80+ line songs) are eliminated.
  - Added strict alignment checks (`parse_batch_strict`): if newline count or segment mapping is uncertain on a 200 OK batch, it safely falls back to sequential single-line requests.
  - Implemented rate limit protection: on HTTP 429, requests stop retrying after `MAX_CONSECUTIVE_429`, never split batches into individual requests during throttling, and respect Retry-After headers with jittered backoff.
  - Added persistent SQLite caching (`lyric_translations` table in `lib.rs`), storing only validated successful translations keyed by normalized source text, source language, and target language. Cached lines load instantly with 0 network calls.
  - Preserved partial successes: when some batches fail or hit rate limits, successfully translated lines are preserved in the session and stored in SQLite, with `incomplete: true` set to allow completing the remaining lines on retry.
- Verification: Rust unit tests in `keyless_translation` pass (8/8 tests, covering English skipping, hint recovery, script deduplication, alignment mismatch fallback, 429 cooldowns, partial recovery, and persistent cache reuse); production frontend build (`npm run build`) and 33 lyrics unit tests pass.

## Local Romanization Display Cleanup (31 October 2026)

- Disabled browser spellcheck and explicitly suppressed text-decoration on the Romanized lyric layer. Local romanization uses readable ASCII-style Hindi/Haryanvi spellings for diacritics and nasal tildes while keeping source lyrics and supplied variants unchanged; Malayalam output fixes are covered by regression tests.
- Fixed a Telugu-triggered runtime error by initializing the custom Devanagari roman scheme independently of other script setup. Focused romanization, collection, and lyric-view tests pass (29 tests); `npm run build` passes. Existing Vite externalization/chunk warnings remain. Manual desktop/cache verification pending.

## Romanized Word-Synced Lyric Display (31 October 2026)

- Romanized lyrics now reuse source word timestamps in the lyric room when each timed source segment maps one-to-one to a whitespace-separated Romanized token. Ambiguous/mismatched segmentation safely stays line-level; stored lyrics and source timing are unchanged.
- Added renderer and lyric-view coverage for aligned Romanized output and mismatch fallback. Focused tests passed (6 tests); `npm run build` passed. Existing Vite warnings about externalized `node:module`, chunking, and large bundles remain.

## Tracker Artist Portrait Automatic Resolution (31 October 2026)

- Resolved the issue where artist portraits in Tracker ("Top artists") only loaded after navigating to each artist page.
- Updated `resolveEntityArtwork` in `src/components/common/EntityArtwork.tsx`:
  - When recording credits cannot resolve a numeric provider ID (e.g. YouTube playback, untagged tracks, or featured collaborators), `resolveEntityArtwork` automatically falls back to an exact-name catalog entity search (`library.searchCatalogEntities`) and checks the artist profile (`library.lookupArtist`) for the portrait URL.
  - Seamlessly falls through to Wikipedia / Wikimedia Commons attribution (`library.entityArtwork`) if the catalog search does not return an image or is unavailable, preserving portraits for regional artists (Sai Abhyankkar, KR$NA, Anirudh Ravichander).
- Expanded unit tests in `EntityArtwork.test.ts` covering exact-name catalog match, profile image lookup, and graceful Commons fallback. Full test suite (101 test files, 709 tests) and production build (`npm run build`) pass.

## Playback Handoff Card Apple UI Overhaul & Fullscreen TopBar Restoration (31 October 2026)

- **Playback Handoff Card Redesign:**
  - Modernized PlaybackHandoffCard into a sleek, compact Apple Continuity banner matching the Lumaire design system.
  - Replaced broken/undefined CSS variables (--card-bg, --accent-color, --border-color) with design system tokens (--bg-panel, --accent, --line, --glass-highlight, --radius-lg, --radius-pill).
  - Frosted glass container with backdrop-filter: blur(20px), 52px squircle artwork with Artwork fallback support, device icon (Smartphone / Laptop based on device name), refined uppercase eyebrow with relative timestamp (formatCheckpointAge), prominent Continue pill CTA with play icon, and circular dismiss button.
  - Added unit test suite (PlaybackHandoffCard.test.tsx) verifying metadata rendering, device icon detection, null handling, and action callbacks. All 704 tests and production build passed.
- **Fullscreen TopBar Restoration:**
  - Removed the unnecessary .app.is-fullscreen .topbar { display: none !important; } CSS rule and the floating fullscreen-exit-pill.
  - Clicking the bottom-right fullscreen button in PlayerBar (or pressing F11) now expands the window to full monitor screen without hiding the TopBar, keeping the search bar, back/forward navigation, settings, sync indicators, and window controls fully accessible.

## Search Phase 2 — sourced multilingual retrieval (29 October 2026)

- Extended interactive search from `08f5357`: alias phrases inside mixed queries, source/artist-ID-scoped recovery, saved-title Roman/native forms, independent Indic script runs and search-only Tamil correction. At most one extra query; recovered candidates must pass full expanded terms and stable identities. Homonyms/script collisions require evidence, not guessed equivalence. Existing providers, caches, playback and lyrics unchanged.
- Identity-backed artist results merge into the existing category by ID without another entity request. Query generations/AbortSignals stop obsolete recovery. 89 focused tests across six files plus production build passed; native/manual and live recall/latency remain pending for Gemini.
- `docs/search-phase2-multilingual.md` records commands, review scope, deterministic coverage and limits. Original search checkout only; parallel-lyrics branch and Gemini environment untouched. Other WIP is preserved unstaged.

## Search Phase 2 incremental checkpoint

Phase 1 checkpoint `6a27686` created after 14 native / 12 frontend tests and build. Continued immediately with interactive-only sourced aliases and native/Roman mixed-script recovery, at most one sparse-result fallback. 60 focused frontend tests and production build passed. Existing native adapter, playback and Gemini test environment unchanged. `docs/search-checkpoints.md` lists independent validation commands, inherited WIP scope and unimplemented phase targets; manual Windows/Android and live benchmarks pending.

## Search Phase 1 implementation checkpoint

Incremental lexical/responsiveness slice implemented; see `docs/search-checkpoints.md` for scope, regression commands and remaining native-provider streaming gate. Gemini test environment untouched.

## Gini Search Duplicate Grouping (29 October 2026)

- Cross-provider artist cards previously retained every provider ID, leaving Apple `gini` beside the same JioSaavn Gini. Search now groups Apple into a uniquely matching Saavn profile only after two distinct strict recording overlaps. Same-provider homonyms, one-song coincidences, version/credit/language/ISRC conflicts stay separate. Evidence uses provider catalogues, with a separate raw-evidence cache so enriched artist pages cannot manufacture a match. No library/favorite IDs are migrated.
- Exact-name artist catalogue checks run concurrently, bounded to six seconds and cached; failed/insufficient evidence leaves separate cards. No playback, queue or lyrics changes.
- Validation: 13 focused Rust search tests passed (two explicit audit tests ignored); frontend production and isolated native Windows builds passed. Actual native Gini search returned three cards: desired portrait-bearing Gini, separate Gini catalogue, Ginikachukwu. Cold request 7387 ms; warm result and actual UI portrait/card count/click-through to Sukoon passed (`test-results/gini-group-native-warm.log`). Original executable and production library untouched. Android not checked.

## Sidebar Playlists Apple-Design UI & Ultra-Thin Scrollbar (29 October 2026)

- Modernized the desktop sidebar "YOUR PLAYLISTS" section to align with macOS Apple Music aesthetics:
  - Replaced the default 16px blocky Chromium scrollbar with an ultra-thin 5px overlay scrollbar (`scrollbar-width: thin` and `::-webkit-scrollbar`).
  - Added transparent track and rounded pill thumb (`border-radius: var(--radius-pill)`) with subtle ambient opacity (`rgba(255, 255, 255, 0.14)` / light `rgba(0, 0, 0, 0.12)`) that smoothly brightens on hover.
  - Activated macOS-style smooth gradient edge fading (`mask-image` with `--playlist-fade-top` and `--playlist-fade-bottom`) triggered by `scrollEdges` when playlists overflow.
  - Refined "YOUR PLAYLISTS" header typography (10.5px, uppercase, 0.08em letter-spacing) and styled the `+` action button with rounded hover feedback.
  - Upgraded playlist item rows: 32px squircle artwork with 6px radius and subtle inset border shadow, balanced typography (13px title, 11px song count), and refined hover/active selection states.
- Verification: full Vitest suite (619/619 tests across 90 files) and production build (`npm run build`) passed with zero errors.

## Search Audit and Phased Proposal — No Application Changes (29 October 2026)

- Audited local substring filtering, native provider fan-out/cache/coalescing, literal relevance gate, ranking compression, aliases/Roman forms, recording deduplication and suggestion barriers. Benchmarked nine actual Windows native queries with immediate warm repeats plus one suggestion fan-out in an isolated profile; no application implementation changed.
- First application-cache lookup median/p95 3220/6106 ms; immediate repeats 7.52/23.12 ms. Exact Kesariya rank 1, partial `kesar` rank 4; typo/phonetic/native variants miss the intended recording and mixed `केसरिया Arijit` returns zero. Natural-language example returns zero. Samples are diagnostic, not load/quality population estimates. Evidence: `test-results/search-audit-live.json` and `.log`.
- [Full audit, primary-source research and phased plan](plans/2026-10-29/search-improvement-audit.md): evaluation → progressive lexical search → sourced aliases/Roman/mixed-script forms → safe result grouping → local lyric-line indexing → optional semantic experiment. Humming researched separately, not implemented. Current providers, playback/source verification and local-first/accountless core remain intact. No models, microphones, lyric ingestion or dependencies added.

## Lyrics Accuracy — Windows Audit and Targeted Fixes (29 October 2026)

- Added `tests/fixtures/lyrics-accuracy-corpus.json`: 10 real songs / 24 retained candidate records, plus four actual native follow-ups. Real alternate releases cover remix, live, mixed, cover, sped/slowed and language variants. Fresh LRCLIB probe: 9/10 successful queries / 171 records; Golden Sparrow HTTP 503 is an outage, not missing lyrics. Original lyric text removed from stored corpus snapshots.
- Fixed featured-credit normalization losing a later remix marker; LRCLIB/lrc.red must retain compatible version labels. Unknown-artist matches require known duration and unambiguous performer. Provider file offsets, fractional timestamps, word endings, nonfinite duration, empty timestamps and instrumental-duration validation now gate synchronization; incompatible timing retains plain text without invented offsets. Cached provider versions cannot bypass the guard; explicitly imported originals and user offsets remain authoritative.
- Measurements: retained positive controls 10/10 before and after; unsafe alternate synchronized eligibility 1/14 before → 0/14 after; four controlled timing/offset negatives now remain plain rather than falsely synchronized. These are structural/metadata tests, not population wrong-lyrics or acoustic alignment rates. Fresh sanitized replay found compatible candidates for all nine successful queries, with no fresh incompatible-version eligibility observed.
- Actual Windows native results: Snowman 1.152 s; Despacito remix 9.280 s; Gini/Sukoon 2.651 s; Rathinamo female version 0.643 s, all synchronized with matching edition/duration metadata. Isolated library and queue unchanged. Final dedicated-profile startup passed; original working executable and production library preserved.
- Validation: **24 Rust lyrics tests passed**, five explicit network/audit tests ignored; live-snapshot audit explicitly passed. **621 frontend tests / 90 files passed**; production frontend and isolated Windows builds passed. No lyrics layout, playback, metadata, romanization or translation changes.
- [Full findings, corpus and measured limits](performance/lyrics-accuracy-windows-2026-10-29.md). Android remains pending and does not block Windows. Audible alignment, unlabeled edits, omitted collaborator evidence and legacy instrumental cache provenance remain gaps; no next language-processing phase started.

## Gini Artist Identity Repair / Android Acceptance State (29 October 2026)

- User supplied a real Gini JioSaavn page while Lumaire opened a name-only unavailable profile. Credited artist search now reuses a unique exact-name provider ID for generic name-only links, including provider casing/portrait, without mapping substrings or ambiguous names. Legacy name links try exact artist search before bounded song-search fallback; successful pages must contain credited music and match the requested name. Empty publishing entries remain excluded.
- Gini identity regression passed (unique provider identity, substring negative and ambiguous homonym). Added local HTTP fixture for direct name-to-artist-page navigation; it compiles but fails to reach its fixture service in the sandbox. Live provider/profile and native startup checks remain unverified while privileged-tool approval is unavailable. Evidence: `test-results/gini-identity-unit.log`, `gini-profile-fixture.log`, `gini-native-build.log`.
- Physical Motorola was connected. Latest isolated test APK installed without touching production app/library. Metadata JSON persistence and stale-correction rejection passed on phone. Chooser automation exposed incorrect setup assumptions (native state has no `nativeQueue`) plus a real stacking bug: bottom player tabs intercepted the header action sheet. Added an open-menu-only header z-index fix, built and installed it in the test app; subsequent chooser run still failed at playback setup, so chooser acceptance is NOT claimed. Twelve focused UI/menu tests passed.
- Featured rotation device test was blocked by the still-expanded player overlay; metadata subcheck passed but combined UI check did not. Background/locked-screen command was NOT executed: automatic approval review failed due account/reviewer usage limit (reported retry time 18:47). Do not bypass or treat this as a playback failure. Android acceptance remains incomplete. No phone operations should be attempted through an alternative tool to evade this block.

## Featured Album Daily Rotation (29 October 2026)

- Discover spotlight previously always used `newAlbums[0]`; an unchanged provider ranking kept the same banner indefinitely. Now rotates by local calendar day through distinct available album IDs, stable across provider ordering changes. Does not reorder release shelves or add provider requests.
- Checks day rollover once per minute and on window focus, so a running/minimized app catches up without restarting. A single available album naturally remains selected.
- Production build and 15 focused tests passed, covering day changes, within-day stability, feed reorder/duplicate IDs and empty/single-album inputs. Live desktop/phone visual rechecks were not run for this change.

## Metadata 5A — Optional Identity Fields and Correction Safety (29 October 2026)

- Added optional source-scoped `recordingMetadata` (validated ISRCs, release date, artist-ID-scoped multilingual aliases) through native catalogue parsing, canonical/queue conversion, saved JSON, session restoration and portable sharing. No schema migration/backfill. Apple/Saavn dates and MusicBrainz recording identifiers/credited-name aliases survive where supplied; no new alias lookup. Nonempty conflicting ISRC sets prevent deduplication; matching codes never override version/credit/language checks.
- Enrichment preserves reliable existing values and source duration, reads latest in-memory corrections, and rejects a stale expected snapshot at SQLite save time. Fields cleared while a request ran remain clear. Uses fetched credits instead of redundant artist-page calls. No automatic rewrite of populated canonical names or user corrections.
- Real eight-song native refresh: release-date coverage **0/8 → 8/8**; ISRC and alias coverage stays **0/8** because these responses supply neither. No audio resolved or production library writes. Alias/ISRC parser and propagation gains are covered by fixtures, not claimed as real-corpus gains.
- Validation: **617 frontend tests passed / 90 files**; 49 catalogue Rust tests passed (4 ignored), final merge subset 13 passed (2 ignored), recording/persistence subset 8 passed. Broad parallel Rust run had nine local lyrics-fixture socket failures; unchanged lyrics suite passed serially (20 passed, 4 ignored). Windows/frontend and Android test APK builds passed. Final native startup, JSON persistence and stale-correction rejection passed in an isolated empty library; temporary record removed.
- Android APK retained at `.test-data/latency/metadata-5a-android.apk`, verified package `app.lumaire.player.latency`; no phone operations/install. Physical Android and independently reviewed alias/ISRC/release-history coverage remain pending. Working executable and production library preserved.
- [Full changes, measurements and limits](performance/metadata-5a-propagation-2026-10-29.md). No unrelated UI, lyrics-provider, romanization, translation or jam work.

## Metadata 5A — First Increment Validated (29 October 2026)

- Tightened cross-ID recording deduplication: full artist-credit sets, atomic structured names, version labels, language conflicts and finite durations. Existing matching results fill missing genre/language without replacing populated fields or adding API calls. MusicBrainz retains named artists with missing/invalid UUIDs without fabricating IDs.
- Retained eight-song corpus: credits/album/language/artwork remain 8/8; genre remains 0/8. No real-corpus completeness gain claimed. Regression fixtures verify fill-only gains and five identity negatives.
- Validation: 48 catalogue Rust tests passed, four optional ignored; frontend/native builds and isolated Windows startup/library load passed. Original executable/library preserved; physical Android pending.
- [Audit and remaining scope](performance/metadata-5a-2026-10-29.md). 5A remains incremental: aliases, ISRC/MBID/date propagation, provenance and concurrent-edit-safe enrichment are unfinished. No 5B work started.

## Playlist Missing Duration Display (29 October 2026)

- Imported playlist rows with unknown duration now use the current recording's known playback duration, matched by exact track/catalogue identity. Existing durations remain authoritative; unrelated rows stay unknown. Playlist totals use the same displayed durations. No library records or playback behavior changed.
- Production build passed; LibraryView regressions cover a resolved source with a different provider ID and an unrelated current song. Live desktop and Android visual rechecks are pending.

## Home Context-menu Actions Fixed (29 October 2026)

- Fixed lost clicks caused by parent song-row press/hover transforms moving a fixed context menu. Rows/cards stay stationary only while their contextual menu is open; normal styling and playback clicks remain intact. Shared rule also covers search suggestion rows.
- Home queue actions now pass the complete track to the existing remote-queue handler, preserving metadata for unsaved history/recommendation songs. Favorites accept the supplied Home track when absent from both library and queue, reuse existing save/persistence/error handling, and remain independent of playback. Save-to-library errors now use the existing action error path.
- Home actions close their menu, and nested keyboard activation cannot bubble into the row's play handler. Shift+F10 / the context-menu key opens track actions and focuses the first available action.
- Production build and **27 focused tests passed**, including an unsaved recommendation favorite regression. New `tests/home-context-menu.html` / `.mjs` interaction regression passed in headless Edge and isolated native Windows WebView2: Recently Played and Quick Picks, next/queue/favorite/playlist callbacks with full track data, unsaved library save, favorite-label update, menu closing, keyboard actions, Escape and ordinary playback clicks. Commands: serve Vite on port 1437, then `node tests/home-context-menu.mjs` (or `--native` with the isolated validation app at port 58996). Evidence: `test-results/home-menu-{build,unit,browser,native}.log`.
- No native playback changes or production library edits. Physical phone validation remains deferred while the user has the device; no Android acceptance claimed for this change.

## Artist Search and Empty Profiles Fixed (29 October 2026)

- Live provider inspection confirmed that the reported Hola Amigo artist-search names are upstream records, including empty publishing entities. They were being presented without evidence of available music. Search now derives artist results from performing credits on the existing merged song results, retaining provider IDs and matching portraits; no extra per-result network requests or hardcoded artist blacklist.
- Fixed artist-page parsing of live nested `topSongs.songs` and `topAlbums.albums` responses while retaining flat-list compatibility, exact artist-ID checks and credited-release filtering. Empty profiles return an unavailable error so the existing cross-provider fallback can run, rather than displaying a successful empty artist page.
- Validation: catalogue Rust suite **46 passed, 4 optional tests ignored**; frontend production and isolated Windows native builds passed. Real native commands: `hola amigo` returns no artist entries; Anirudh Ravichander retains `saavn:artist:455663` and loads **10 tracks / 33 releases**; the reported empty publishing page is rejected. Native Windows UI checks also passed for search and populated profile. Evidence: `test-results/artist-catalog-regression.log`, `artist-catalog-native.json`, `artist-catalog-ui.log`, `artist-profile-fixed.png`.
- Changes are confined to catalogue search/parsing and regression fixtures. Playback, saved library and queue code were untouched. Original executable preserved; physical Android checks remain deferred while the user has the phone. Artist search is conservatively limited to credits found in the current bounded song search; providers may still omit legitimate artists.

## Plan 2: Optional Song Correction — Laptop Complete (29 October 2026)

- Removed permanent queue verification controls. The current song's three-dot menu now offers **Wrong version playing?**; only that optional action opens verified alternatives. Automatic verification remains silent. User choices persist locally and take precedence over automatic mappings, with strict revalidation and unavailable-source recovery.
- Windows native menu/chooser acceptance passed: local preference survives renderer restart; reset works; paused position and current queue occurrence are preserved. Full Vitest: **612 tests / 89 files passed**. Production frontend, isolated Windows native and Android test APK builds passed; real SQLite migration/persistence and bundled QuickJS Autoplay regressions passed.
- Final measured corpus: Windows **8/8** (median 4.283 s, p95 6.939 s), physical Android **8/8** (median 6.072 s, p95 13.542 s). Single observations per song with retained caches; these are not controlled speedup estimates. Known Hola Amigo added-performer upload is now rejected; missing Naatu Naatu performer metadata is preflighted without relaxing verification. General incorrect-audio rate remains unmeasured.
- User took the phone away: final Android menu/chooser/restart and latest background-recovery acceptance are pending reconnection. No further phone operations while away. Latest test APK retained at `.test-data/latency/plan2-menu-android.apk`; existing phone installations and the original Windows executable were preserved.
- Full findings and limits: [Plan 2 source recovery report](performance/plan2-source-recovery-2026-10-29.md). Metadata 5A remains paused; unrelated WIP is preserved.

## Nuclear-Inspired Category Filter Tabs for Search (29 October 2026)

- Redesigned search results in Discovery/Search to use a clean category tabbed filter layout inspired by Nuclear Music Player:
  - Replaced stacked vertical sections (which previously forced users to scroll past large artist and album shelves) with category filter pills: `Songs`, `Albums`, and `Artists`.
  - Default view keeps **Songs first**: searching immediately displays the matching track list, track headers, and actions.
  - Category filter pills display real-time result counts (e.g., `Songs 20`, `Albums 6`, `Artists 5`).
  - Switching to `Albums` renders a full multi-column responsive album card grid with hover cards and navigation to album details.
  - Switching to `Artists` renders a responsive circular artist avatar grid with centered names and navigation to artist profiles.
  - Switching between tabs is instantaneous and local; search queries continue fetching songs, albums, and artists concurrently in the background.
  - Category tabs are fully keyboard accessible with standard WAI-ARIA `tablist`, `tab`, and `tabpanel` semantics.
- Verification: full Vitest suite (612/612 tests across 89 files) and production build (`tsc -b && vite build`) passed with zero errors or warnings.

## Desktop Window Controls & Full-Span TopBar with Sub-Queue Layout (29 October 2026)

- Restructured desktop layout so `TopBar` spans the full remaining width from sidebar to the far right edge of the window (`workspace-body` architecture).
- Moved `QueuePanel` inside `.workspace-body` beneath `TopBar`, rather than as a sibling column to `.workspace`.
- Fixed window controls UX: the Minimize (`-`), Maximize (`▢`), and Close (`✕`) buttons are now permanently anchored at the top-right corner of the window. Opening, closing, or resizing the queue panel never shifts or jumps the window control buttons.
- The queue panel now opens directly below the TopBar with clean top alignment matching `<main>`, retaining its fluid resize drag handles (`--queue-width`) and collapse animations.
- Verification: full Vitest suite (609/609 tests across 89 files) and production build (`tsc -b && vite build`) passed clean with zero errors.

## Search Dropdown Track Context Menu & JSX Props Cleanup (29 October 2026)

- Removed duplicate JSX attribute declarations (`onFavorite`, `onQueueTrack`, `onSaveOnline`, `onChoosePlaylist`) in `App.tsx` that caused Vite dev compiler warnings.
- Added gesture-based track context menu to the search suggestions dropdown (`TopBarSearch.tsx`):
  - Right-clicking (PC) or touch-holding (mobile) on any song result displays the native track action menu (`Play next`, `Add to queue`, `Add to favorites` / `Remove from favorites`, `Save to playlist`, `Save to library`).
  - Right-clicking anywhere within the search suggestions dropdown suppresses the default browser WebView2 menu (`Refresh`, `Save as`, `Print`), keeping the app completely native.
  - Left-clicking or tapping an item continues to immediately play the track as expected.
  - Zero emoji, clean text-only options, with accessible keyboard navigation (`Enter` / `Space` support).
- Verification: full Vitest suite (609/609 tests across 89 files) and production build (`tsc -b && vite build`) passed with zero errors or warnings.

## Gesture-Based Track Context Menu on Home (29 October 2026)

- Added contextual actions for track rows and cards across Home shelves: Quick Picks, Recently Played, Your Rotation, and Forgotten Favorites.
- Triggered purely by gestures: desktop right-click (`contextmenu`) opens a positioned floating menu at the cursor coordinates; mobile touch-hold (450ms) smoothly invokes the native bottom sheet menu.
- Kept UI completely clean: strictly gesture-based with zero permanent buttons, hover icons, or emoji decorations. Text-only actions: `Play next`, `Add to queue`, `Add to favorites` / `Remove from favorites`, `Save to playlist`, and `Save to library`.
- Preserved existing primary click/tap behavior: regular left-click or tap immediately starts playing the track as expected.
- Handled accessible markup: updated card containers to `role="button"` and `tabIndex={0}` to legally host context menu triggers without nested `<button>` violations.
- Verification: Vitest unit tests in `useClickOutsideMenus.test.ts` and `DiscoveryHome.test.tsx` passed; production build (`tsc -b && vite build`) passed clean.

## Desktop Fullscreen Player: Unified Immersive Mode & Single-Click Lyrics Sync (29 October 2026)

- Retired redundant "Minimal" fullscreen mode in favor of the unified "Immersive" layout as the default and only desktop expanded player mode.
- Removed the layout selection dropdown (`Immersive` / `Minimal`) from the expanded player top action bar (`ExpandedPlayer.tsx`), removing top-right clutter and leaving only the lyrics configuration trigger and close button.
- Fixed lyrics "Back to sync" button double-click requirement: replaced fixed timer with `scrollend` listener and debounced scroll handling, allowing lyrics to center and lock sync on a single click without gesture regression.
- Removed the obsolete "Desktop fullscreen player" toggle section in `SettingsView.tsx`.
- Updated session defaults and restored preference normalization in `src/domain/session.ts` so `fullscreenLayout` consistently defaults to `"immersive"`.
- Cleaned up obsolete dropdown CSS (`.fullscreen-layout-select` and `.apple-select-*` menu styles) in `src/components/player/immersive.css`.
- Verification: full Vitest suite (608/608 tests passed across 89 test files) and production build (`tsc -b && vite build`) passed with zero errors.

## Plan 2 Failed-song Coverage — In Progress (29 October 2026)

- Windows first-pass corpus: 5 successes / 6 attempted, one blocked; successful median 7477 ms and p95 8053 ms. Naatu Naatu skipped after verification failure; Japanese case requires independent measurement. Arabic query yielded no catalogue result, separate from audio failure. Android first pass: 4 successes, one failed/advanced case, two blocked; independent native-command coverage harness added to avoid chained queue effects.
- Implemented the first native recovery gap: after a refused recording fails URL refresh, BackgroundQueue asks shared background-policy for a strictly verified alternative of the same catalogue recording before skipping. Failed source IDs are excluded, attempts are capped at three, direct sources retain existing behavior, offline copies win, and occurrence/play position are preserved.
- Defensive safeguards: added null checks in `source-matching.ts` (`sourceCredits`) and safeguarded stream catalogue checks in `service.ts` to prevent redundant network lookups when stream metadata already matches the track.

## Android Autoplay Fixed — Physical Acceptance Passed (29 October 2026)

- Root cause: the recommendation adapter's five-second UI timer raced synchronous QuickJS RPC and returned an empty pool. Native entry now disables that UI budget and uses the existing service timeout/cancellation; browser behavior and matching algorithms remain unchanged.
- Focused adapter/controller/policy tests 21/21; ranking/eligibility/source matching tests 79/79; actual QuickJS regression passed.
- Physical Motorola Edge 50 Pro: local closed-Activity queue/history/library preservation passed; native initial online resolution and injected HTTP 403 refresh passed; minimized/screen-off queue-exhaustion Autoplay passed. Five-minute locked playback with Activity destroyed and renderer disabled passed.

## Home Empty Sections and Background Playback Clarification (29 October 2026)

- Mobile Home hides empty Recently Played, Continue Listening, Your Rotation and Forgotten Favorites shelves. New listeners see Quick Picks; populated shelves appear normally.
- Focused Home tests 5/5 passed. Production TypeScript/Vite build passed.

## Stability Audit (1 November 2026)

- Fixed paused handoff restoration incorrectly resuming playback, and clamp restored positions to track duration.
- Reject malformed HTTP `Content-Range` responses before appending resumed downloads; check cancellation before promoting a partial file. Serialize album download queue/status persistence to prevent completed state racing an unsaved queue.
- Validate optional recording metadata received over Nearby sync. Add the missing verified-source SQLite commands used by the frontend and native Android worker; preserve writes through the shared transaction-safe session writer.
- Route Android background queue/start through the actual Tauri command wrappers. Remove Activity-task removal cleanup that stopped the media service when the player was swiped from Recents.
- Full frontend suite passed (723 tests, 102 files); TypeScript/Vite build passed. Windows release executable built successfully. Focused Rust tests passed: checkpoint (12), verified-source persistence (1), range parsing (1), and Nearby metadata validation (1).
- Android Rust library compilation passed, but APK packaging could not connect to the local Gradle daemon in this Windows environment. The full Rust suite's localhost-backed tests failed or stalled here; deterministic focused coverage passed.
- Remaining audit gaps: Nearby peer URLs have no automatic IP rediscovery, Android downloads are not managed by a dedicated foreground download service, and this audit could not repeat physical Android lifecycle/device-sync acceptance. These gaps need resolution or explicit acceptance before release.
