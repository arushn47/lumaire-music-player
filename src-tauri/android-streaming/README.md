# Android bundled streaming integration

This Android-only module is shared by the main app and the original streaming
experiment. Windows continues to use its existing yt-dlp commands. The resolver
does not replace the Media3 playback engine or save heard tracks to the library.

## Packaging

Pinned runtime: Chaquopy 17.1.0, Python 3.11 (currently resolved to 3.11.17-0),
yt-dlp 2026.8.19, yt-dlp-ejs 0.8.0, QuickJS-NG 0.17.0. The current target is
ARM64, minimum Android API 26. A host Python installation is needed for building;
the installed app uses embedded Python and requires neither Termux nor an
external Python installation.

Run `node scripts/android-runtime-prepare.mjs` to verify the pinned wheel/source
hashes and build QuickJS with the NDK. Run the normal Android configure/build
scripts afterward. Bundled dependencies remain an offline fallback. The resolver checks for the official stable yt-dlp wheel and its exact EJS dependency at most daily, verifies published hashes, and activates successful import checks in its private process. Python and QuickJS remain bundled; they require an APK update.

`streaming.gradle` is applied only by Android. Set
`ORG_GRADLE_PROJECT_lumaireStreaming=false` to omit the bundled runtime and
disable its private service. The disabled build has not yet been verified.

## Boundaries

`ResolverClient` sends one bounded request to `ResolverService` in the private
`:resolver` process. Cancellation terminates that process and its QuickJS child;
it does not stop the existing Media3 session. Generation checks prevent an old
lookup from loading after a newer request. The resolver returns a direct HTTPS
Googlevideo URL, duration, available metadata and an allowlisted HTTP-header map.
It checks a bounded HTTP range before handing the source to Media3.

`ScopedHttpHeaders` applies headers only to the registered exact media URI.
`StreamHeaderPolicy` rejects credentials, line breaks and unapproved origins.
Local files continue through the existing Android data source. This candidate
uses direct HTTPS audio rather than HLS. Stream URLs expire and are resolved
again when needed; audio is not downloaded persistently by this module.

Challenge diagnostics are debug-only. They observe the actual yt-dlp QuickJS
provider and record counts plus input/output hashes, without storing challenge
values. No cookies or user account credentials are supplied.

## Licences

The APK includes the repository's third-party notices and full licence file,
plus original notices under `src/main/assets/licenses`. These cover Chaquopy,
Python and bundled standard-library dependencies, yt-dlp, EJS, QuickJS, OpenSSL,
libffi, bzip2, liblzma and certifi. Preserve these notices when redistributing.
EJS contains Unlicense, MIT and ISC components; certifi carries MPL notices.
Review upstream changes and any modified MPL-covered files before distribution.

`audit-dependencies.gradle`, used as an optional Gradle init script, inventories
the actual resolved JVM runtime graph and cached POM licence declarations.
`audit-native.py APK OUTPUT_JSON` recursively inspects ELF files, including
those inside Chaquopy archives. These are audit helpers, not runtime code.

## Verification status (2026-10-19)

Evidence files in the ignored `test-results` directory distinguish executed
checks from remaining work:

- `android-integrated-streaming.json`: seven real Motorola checks passed,
  including streaming, pause/resume, seek, screen-off playback, cancellation
  and unavailable-source handling on the final APK.
- `android-live-challenge.json`: a live `n` challenge was solved by bundled
  QuickJS/EJS using the public Blender fixture. The final run verified transformed
  outputs differ from inputs, recording SHA-256 pairs without challenge values.
- `android-streaming-ui.json`: two real phone UI checks passed. Mobile navigation,
  search, online playback and explicit queue insertion preserve library membership.
- `android-report.json`: five Android local playback, lyrics and persistence
  regression checks passed on the final APK.
- Frontend: 68 tests passed. Rust: 41 passed, seven ignored live-provider tests
  by default; the new Last.fm live test was separately executed and passed.
  Android JVM: three header-policy tests passed. All 22 browser bridge regressions
  passed; browser bridge checks are not real device audio evidence.
- `android-runtime-dependencies.json`: 94 graph components inventoried; all
  external components have declared or inherited licence information.
- `android-integrated-alignment.json`: all 71 packaged ELF objects pass static
  16 KB segment-alignment checks. The Motorola uses 4 KB pages; no usable 16 KB
  emulator image is installed, so actual 16 KB execution remains unverified.
- `android-launcher-icon-audit.json`: all 15 packaged launcher PNGs match the
  canonical Lumaire Android artwork. Adaptive background is `#151812`. All 13
  required licence/notice assets are present; packaged wheel hashes match pins.
- `android-session-restoration.json`: queue, saved preferences, playlists,
  lyrics and history restored. The historical snapshot's exact synthetic WAV
  fixture was mapped to its re-imported ID; no user track was changed or deleted.

The completed UI refactor initially omitted enrichment on track selection; that
effect was restored and verified by the existing browser regression. Device UI
testing also found that restoring playback could cancel resolver probing and
permanently disable Discover. Availability now checks packaged files without
starting or cancelling the resolver process. The final APK passes both paths.

Final APK SHA-256:
`3bbf8c6fe465bb591cd960d769572f4fd57606c63571d547fea02216e1d89d2f`.
It is built and installed on Motorola ZD222LVFWT (Android 16/API 36, ARM64).

| Measurement | Standalone POC | Integrated main app |
| --- | ---: | ---: |
| APK bytes | 21,010,714 | 50,553,253 |
| Android installed app bytes | 34,580,992 | 109,935,104 |
| Android data bytes | 12,943,360 | 23,298,048 |
| Android cache bytes (included in data) | 32,768 | 737,280 |

StorageStats were captured after streaming verification; data/cache vary with
usage. The main app includes the full Rust/UI/library implementation omitted by
the minimal POC. Original POC and final main-app reports are separate evidence.

Historical size baselines: standalone POC APK 21,010,714 bytes, POC baseline
4,721,080 bytes, pre-integration main APK 56,377,483 bytes. Native compression,
extraction and APK alignment changed between builds, so comparing APK file size
alone does not isolate the runtime overhead. Record the final APK hash and
Android StorageStats separately when making future comparisons.

Remaining gaps: actual execution on a 16 KB page-size device/emulator; rollback
build with streaming disabled; broader ABI and Android-version coverage; release
signing/distribution review. Six older live-provider tests remain unexecuted.
The user confirmed audible POC output earlier; the final device checks use real
Media3 decoding/clock/state, HTTP range checks and Android foreground sessions.
No mock result is counted as physical playback.

Last.fm is a separate read-only metadata fallback. Its desktop runtime key is
not bundled into Android. No Android Last.fm key settings flow was added.

Lumaire Connect and library synchronization are outside this integration.
