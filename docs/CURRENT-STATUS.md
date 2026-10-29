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
