# Lumaire third-party software inventory

Generated from the resolved lockfiles. This inventory does not grant rights to audio, artwork or lyrics. No Nuclear, TuneScript or external media code/assets are included. The original application licensing decision remains with the project owner.

## Offline language detection

The bundled native language detector runs locally without accounts or API calls.
Full licence texts are included in THIRD_PARTY_LICENSES.txt.

| Package | Version | Licence | Build/test only |
|---|---|---|---|
| whatlang | 0.18.0 | MIT | No |
| allocator-api2 | 0.2.21 | MIT | No |

Sources: https://github.com/greyblake/whatlang-rs and https://github.com/zakarumych/allocator-api2.

## Optional Windows streaming components

Windows checks the official stable yt-dlp release at most once per day and manages
its private engine automatically. Downloads are verified against the SHA-256
asset digest from the official GitHub release metadata, then startup-tested
before activation. Failed updates preserve the installed set. QuickJS-NG 0.17.0
remains pinned and checksum-verified. No system PATH, registry, administrator
changes, account credentials or browser cookies are used.

The official PyInstaller yt-dlp executable includes GPLv3+ components; see
[its source, license and dependency notices](https://github.com/yt-dlp/yt-dlp/tree/2026.08.19#license).
QuickJS-NG uses the MIT license; see
[its source and license](https://github.com/quickjs-ng/quickjs/tree/v0.17.0).
These independently downloaded tools do not grant rights to any streamed media.
Android uses the separate verified Python-wheel updater described below.

## JavaScript dependencies

Android streaming integration: Chaquopy 17.1.0 embeds Python 3.11.17-0;
yt-dlp 2026.8.19, EJS 0.8.0 and QuickJS-NG 0.17.0 are bundled at build time.
Canonical implementation and notice texts live in `src-tauri/android-streaming`.
Chaquopy/QuickJS use MIT; CPython uses PSF and incorporated notices; the yt-dlp
wheel uses Unlicense and EJS includes Unlicense/MIT/ISC notices. Python's native
dependencies include OpenSSL (Apache-2.0), libffi (MIT), bzip2, public-domain
liblzma/SQLite, and certificate data with MPL-2.0 notices/source requirements.
Their notices, this inventory and THIRD_PARTY_LICENSES.txt are packaged in Android
assets. No FFmpeg, Termux, GPL Android wrapper or PyInstaller executable is added.
The exact resolved Android Java dependency inventory and ELF audit are generated
under `test-results/android-runtime-dependencies.json` and
`test-results/android-integrated-alignment.json`. The bundled wheels remain an
offline fallback. Once per day, Android can fetch the official stable yt-dlp wheel
and its exact declared EJS dependency from PyPI, verify their published SHA-256
digests, and smoke-test imports before activation in a private resolver process.
QuickJS and Python updates still require an APK update. Downloaded wheels contain
their upstream license notices. This distribution performs runtime code updates;
app-store distribution requires a separate review of the store's applicable rules.

Android prototype: Jetpack Media3 ExoPlayer and MediaSession 1.8.0 are used
under Apache-2.0. Their source and notices are maintained in
[AndroidX Media](https://github.com/androidx/media). AndroidX, Tauri Android,
Kotlin and Android build dependencies are resolved by the generated Gradle
project. The Apache-2.0 text is included in THIRD_PARTY_LICENSES.txt; the native
dependency notice inventory needs a release review before publication. The Android SDK,
NDK and Gradle distributions are development tools and are not bundled as app
executables.

| Package | Version | Licence | Build/test only |
|---|---|---|---|
| @babel/code-frame | 7.29.7 | MIT | Yes |
| @babel/compat-data | 7.29.7 | MIT | Yes |
| @babel/core | 7.29.7 | MIT | Yes |
| @babel/generator | 7.29.8 | MIT | Yes |
| @babel/helper-compilation-targets | 7.29.7 | MIT | Yes |
| @babel/helper-globals | 7.29.7 | MIT | Yes |
| @babel/helper-module-imports | 7.29.7 | MIT | Yes |
| @babel/helper-module-transforms | 7.29.7 | MIT | Yes |
| @babel/helper-plugin-utils | 7.29.7 | MIT | Yes |
| @babel/helper-string-parser | 7.29.7 | MIT | Yes |
| @babel/helper-validator-identifier | 7.29.7 | MIT | Yes |
| @babel/helper-validator-option | 7.29.7 | MIT | Yes |
| @babel/helpers | 7.29.10 | MIT | Yes |
| @babel/parser | 7.29.9 | MIT | Yes |
| @babel/plugin-transform-react-jsx-self | 7.29.7 | MIT | Yes |
| @babel/plugin-transform-react-jsx-source | 7.29.7 | MIT | Yes |
| @babel/template | 7.29.7 | MIT | Yes |
| @babel/traverse | 7.29.10 | MIT | Yes |
| @babel/types | 7.29.8 | MIT | Yes |
| @esbuild/aix-ppc64 | 0.28.2 | MIT | Yes |
| @esbuild/android-arm | 0.28.2 | MIT | Yes |
| @esbuild/android-arm64 | 0.28.2 | MIT | Yes |
| @esbuild/android-x64 | 0.28.2 | MIT | Yes |
| @esbuild/darwin-arm64 | 0.28.2 | MIT | Yes |
| @esbuild/darwin-x64 | 0.28.2 | MIT | Yes |
| @esbuild/freebsd-arm64 | 0.28.2 | MIT | Yes |
| @esbuild/freebsd-x64 | 0.28.2 | MIT | Yes |
| @esbuild/linux-arm | 0.28.2 | MIT | Yes |
| @esbuild/linux-arm64 | 0.28.2 | MIT | Yes |
| @esbuild/linux-ia32 | 0.28.2 | MIT | Yes |
| @esbuild/linux-loong64 | 0.28.2 | MIT | Yes |
| @esbuild/linux-mips64el | 0.28.2 | MIT | Yes |
| @esbuild/linux-ppc64 | 0.28.2 | MIT | Yes |
| @esbuild/linux-riscv64 | 0.28.2 | MIT | Yes |
| @esbuild/linux-s390x | 0.28.2 | MIT | Yes |
| @esbuild/linux-x64 | 0.28.2 | MIT | Yes |
| @esbuild/netbsd-arm64 | 0.28.2 | MIT | Yes |
| @esbuild/netbsd-x64 | 0.28.2 | MIT | Yes |
| @esbuild/openbsd-arm64 | 0.28.2 | MIT | Yes |
| @esbuild/openbsd-x64 | 0.28.2 | MIT | Yes |
| @esbuild/openharmony-arm64 | 0.28.2 | MIT | Yes |
| @esbuild/sunos-x64 | 0.28.2 | MIT | Yes |
| @esbuild/win32-arm64 | 0.28.2 | MIT | Yes |
| @esbuild/win32-ia32 | 0.28.2 | MIT | Yes |
| @esbuild/win32-x64 | 0.28.2 | MIT | Yes |
| @indic-transliteration/common_maps | 1.0.6 | MIT | No |
| @indic-transliteration/sanscript | 1.3.3 | MIT | No |
| @jridgewell/gen-mapping | 0.3.13 | MIT | Yes |
| @jridgewell/remapping | 2.3.5 | MIT | Yes |
| @jridgewell/resolve-uri | 3.1.2 | MIT | Yes |
| @jridgewell/sourcemap-codec | 1.6.0 | MIT | Yes |
| @jridgewell/trace-mapping | 0.3.31 | MIT | Yes |
| @napi-rs/lzma-linux-x64-gnu | 1.5.1 | MIT | Yes |
| @rolldown/pluginutils | 1.0.0-rc.3 | MIT | Yes |
| @rollup/rollup-android-arm-eabi | 4.64.8 | MIT | Yes |
| @rollup/rollup-android-arm64 | 4.64.8 | MIT | Yes |
| @rollup/rollup-darwin-arm64 | 4.64.8 | MIT | Yes |
| @rollup/rollup-darwin-x64 | 4.64.8 | MIT | Yes |
| @rollup/rollup-freebsd-arm64 | 4.64.8 | MIT | Yes |
| @rollup/rollup-freebsd-x64 | 4.64.8 | MIT | Yes |
| @rollup/rollup-linux-arm-gnueabihf | 4.64.8 | MIT | Yes |
| @rollup/rollup-linux-arm-musleabihf | 4.64.8 | MIT | Yes |
| @rollup/rollup-linux-arm64-gnu | 4.64.8 | MIT | Yes |
| @rollup/rollup-linux-arm64-musl | 4.64.8 | MIT | Yes |
| @rollup/rollup-linux-loong64-gnu | 4.64.8 | MIT | Yes |
| @rollup/rollup-linux-loong64-musl | 4.64.8 | MIT | Yes |
| @rollup/rollup-linux-ppc64-gnu | 4.64.8 | MIT | Yes |
| @rollup/rollup-linux-ppc64-musl | 4.64.8 | MIT | Yes |
| @rollup/rollup-linux-riscv64-gnu | 4.64.8 | MIT | Yes |
| @rollup/rollup-linux-riscv64-musl | 4.64.8 | MIT | Yes |
| @rollup/rollup-linux-s390x-gnu | 4.64.8 | MIT | Yes |
| @rollup/rollup-linux-x64-gnu | 4.64.8 | MIT | Yes |
| @rollup/rollup-linux-x64-musl | 4.64.8 | MIT | Yes |
| @rollup/rollup-openbsd-x64 | 4.64.8 | MIT | Yes |
| @rollup/rollup-openharmony-arm64 | 4.64.8 | MIT | Yes |
| @rollup/rollup-win32-arm64-msvc | 4.64.8 | MIT | Yes |
| @rollup/rollup-win32-ia32-msvc | 4.64.8 | MIT | Yes |
| @rollup/rollup-win32-x64-gnu | 4.64.8 | MIT | Yes |
| @rollup/rollup-win32-x64-msvc | 4.64.8 | MIT | Yes |
| @tauri-apps/api | 2.12.4 | Apache-2.0 OR MIT | No |
| @tauri-apps/plugin-opener | 2.7.2 | MIT OR Apache-2.0 | No |
| @tauri-apps/cli | 2.12.3 | Apache-2.0 OR MIT | Yes |
| @tauri-apps/cli-darwin-arm64 | 2.12.3 | Apache-2.0 OR MIT | Yes |
| @tauri-apps/cli-darwin-x64 | 2.12.3 | Apache-2.0 OR MIT | Yes |
| @tauri-apps/cli-linux-arm-gnueabihf | 2.12.3 | Apache-2.0 OR MIT | Yes |
| @tauri-apps/cli-linux-arm64-gnu | 2.12.3 | Apache-2.0 OR MIT | Yes |
| @tauri-apps/cli-linux-arm64-musl | 2.12.3 | Apache-2.0 OR MIT | Yes |
| @tauri-apps/cli-linux-riscv64-gnu | 2.12.3 | Apache-2.0 OR MIT | Yes |
| @tauri-apps/cli-linux-x64-gnu | 2.12.3 | Apache-2.0 OR MIT | Yes |
| @tauri-apps/cli-linux-x64-musl | 2.12.3 | Apache-2.0 OR MIT | Yes |
| @tauri-apps/cli-win32-arm64-msvc | 2.12.3 | Apache-2.0 OR MIT | Yes |
| @tauri-apps/cli-win32-ia32-msvc | 2.12.3 | Apache-2.0 OR MIT | Yes |
| @tauri-apps/cli-win32-x64-msvc | 2.12.3 | Apache-2.0 OR MIT | Yes |
| @types/babel__core | 7.20.5 | MIT | Yes |
| @types/babel__generator | 7.27.0 | MIT | Yes |
| @types/babel__template | 7.4.4 | MIT | Yes |
| @types/babel__traverse | 7.28.0 | MIT | Yes |
| @types/chai | 5.2.3 | MIT | Yes |
| @types/deep-eql | 4.0.2 | MIT | Yes |
| @types/estree | 1.0.9 | MIT | Yes |
| @types/node | 24.19.2 | MIT | Yes |
| @types/react | 19.3.0 | MIT | Yes |
| @types/react-dom | 19.3.0 | MIT | Yes |
| @vitejs/plugin-react | 5.2.0 | MIT | Yes |
| @vitest/expect | 3.2.7 | MIT | Yes |
| @vitest/mocker | 3.2.7 | MIT | Yes |
| @vitest/pretty-format | 3.2.7 | MIT | Yes |
| @vitest/runner | 3.2.7 | MIT | Yes |
| @vitest/snapshot | 3.2.7 | MIT | Yes |
| @vitest/spy | 3.2.7 | MIT | Yes |
| @vitest/utils | 3.2.7 | MIT | Yes |
| assertion-error | 2.0.1 | MIT | Yes |
| baseline-browser-mapping | 2.11.29 | Apache-2.0 | Yes |
| browserslist | 4.29.3 | MIT | Yes |
| cac | 6.7.14 | MIT | Yes |
| caniuse-lite | 1.0.30001816 | CC-BY-4.0 | Yes |
| chai | 5.3.3 | MIT | Yes |
| check-error | 2.1.3 | MIT | Yes |
| convert-source-map | 2.0.0 | MIT | Yes |
| csstype | 3.2.3 | MIT | Yes |
| debug | 4.4.3 | MIT | Yes |
| deep-eql | 5.0.2 | MIT | Yes |
| dotenv | 18.0.8 | BSD-2-Clause | Yes |
| electron-to-chromium | 1.5.459 | ISC | Yes |
| es-module-lexer | 1.7.0 | MIT | Yes |
| esbuild | 0.28.2 | MIT | Yes |
| escalade | 3.2.0 | MIT | Yes |
| estree-walker | 3.0.3 | MIT | Yes |
| expect-type | 1.4.0 | Apache-2.0 | Yes |
| fdir | 6.5.0 | MIT | Yes |
| fsevents | 2.3.3 | MIT | Yes |
| gensync | 1.0.0-beta.2 | MIT | Yes |
| js-tokens | 4.0.0 | MIT | Yes |
| jsesc | 3.1.0 | MIT | Yes |
| json5 | 2.2.3 | MIT | Yes |
| loupe | 3.2.1 | MIT | Yes |
| lru-cache | 5.1.1 | ISC | Yes |
| lucide-react | 0.468.0 | ISC | No |
| magic-string | 0.30.21 | MIT | Yes |
| ms | 2.1.3 | MIT | Yes |
| nanoid | 3.3.20 | MIT | Yes |
| node-releases | 2.0.59 | MIT | Yes |
| pathe | 2.0.3 | MIT | Yes |
| pathval | 2.0.1 | MIT | Yes |
| picocolors | 1.1.1 | ISC | Yes |
| picomatch | 4.0.7 | MIT | Yes |
| playwright-core | 1.64.1 | Apache-2.0 | Yes |
| postcss | 8.5.30 | MIT | Yes |
| prettier | 3.9.10 | MIT | Yes |
| react | 19.3.1 | MIT | No |
| react-dom | 19.3.1 | MIT | No |
| react-refresh | 0.18.0 | MIT | Yes |
| rollup | 4.64.8 | MIT | Yes |
| scheduler | 0.28.0 | MIT | No |
| semver | 6.3.1 | ISC | Yes |
| siginfo | 2.0.0 | ISC | Yes |
| source-map-js | 1.2.2 | BSD-3-Clause | Yes |
| stackback | 0.0.2 | MIT | Yes |
| std-env | 3.10.0 | MIT | Yes |
| strip-literal | 3.1.0 | MIT | Yes |
| js-tokens | 9.0.1 | MIT | Yes |
| tinybench | 2.9.0 | MIT | Yes |
| tinyexec | 0.3.2 | MIT | Yes |
| tinyglobby | 0.2.17 | MIT | Yes |
| tinypool | 1.1.1 | MIT | Yes |
| tinyrainbow | 2.0.0 | MIT | Yes |
| tinyspy | 4.0.6 | MIT | Yes |
| toml | 4.3.0 | MIT | No |
| typescript | 5.9.3 | Apache-2.0 | Yes |
| undici-types | 7.24.6 | MIT | Yes |
| update-browserslist-db | 1.3.4 | MIT | Yes |
| vite | 7.3.7 | MIT | Yes |
| vite-node | 3.2.4 | MIT | Yes |
| vitest | 3.2.7 | MIT | Yes |
| why-is-node-running | 2.3.0 | MIT | Yes |
| yallist | 3.1.1 | ISC | Yes |

## Support link browser integration

Tauri plugin-opener 2.7.2 (MIT OR Apache-2.0) opens approved support links in the default browser. The native Windows opener uses open 5.4.4 (MIT). Sources: https://github.com/tauri-apps/plugins-workspace and https://github.com/Byron/open-rs. Their licence texts are included in THIRD_PARTY_LICENSES.txt.


## Offline lyric romanization engines

These engines run locally and load only when needed. Japanese uses the bundled Kuromoji/IPADIC dictionary (about 17.8 MB compressed); no dictionary CDN or Python installation is needed. The IPADIC copyright and conditions from Kuromoji NOTICE.md are reproduced in THIRD_PARTY_LICENSES.txt. Arabic, Persian, Urdu, Hebrew, Greek and Thai fallbacks are transliterations, not guaranteed contextual pronunciation. Original Latin text is retained.

| Package | Version | Licence | Source |
|---|---|---|---|
| @babel/runtime | 7.29.10 | MIT | https://github.com/babel/babel.git |
| @dehoist/romanize-thai | 1.0.0 | MPL-2.0 | git+https://github.com/Dehoist/Open-Source.git |
| @romanize/korean | 0.1.3 | MIT | https://github.com/kntng/romanize |
| @sglkc/kuromoji | 1.1.0 | Apache-2.0 | https://github.com/sglkc/kuromoji.js.git |
| @sglkc/kuroshiro | 1.0.1 | MIT | https://github.com/sglkc/kuroshiro-ts.git |
| @sglkc/kuroshiro-analyzer-kuromoji | 1.0.1 | MIT | https://github.com/sglkc/kuroshiro-analyzer-kuromoji-ts.git |
| async | 2.6.4 | MIT | https://github.com/caolan/async.git |
| cyrillic-to-translit-js | 3.2.1 | MIT | git+https://github.com/greybax/CyrillicToTranslitJS.git |
| doublearray | 0.0.2 | MIT | https://github.com/takuyaa/doublearray.git |
| fflate | 0.8.3 | MIT | https://github.com/101arrowz/fflate |
| lodash | 4.18.1 | MIT | lodash/lodash |
| lodash.invert | 4.3.0 | MIT | lodash/lodash |
| lyric-romanizer | 0.3.1 | MIT | https://github.com/thedavidweng/lyric-romanizer.git |
| pinyin-pro | 3.29.5 | MIT | git+https://github.com/zh-lx/pinyin-pro.git |
| tamil-romanizer | 1.0.2 | ISC | github:haroldalan/tamil-romanizer |
| to-jyutping | 3.1.1 | BSD-2-Clause | git+https://github.com/CanCLID/to-jyutping.git |
| transliteration | 2.7.0 | MIT | https://github.com/yf-hk/transliteration.git |


### Optional MusicBrainz metadata and official Apple charts

Artist/release-group metadata may be retrieved from the public [MusicBrainz API](https://musicbrainz.org/doc/MusicBrainz_API), with source attribution and MusicBrainz request pacing. Apple's public RSS charts identify whether the source is Apple Music Most Played or iTunes Store Top Songs; metadata fallback uses the documented [iTunes Search API](https://performance-partners.apple.com/search-api). No SDK or provider source code is bundled by these integrations. Existing audio sources and audio rights are unchanged. ListenBrainz Fresh Releases was evaluated and is not a production request source.

## Local pairing QR encoder

| Package | Version | Licence | Build/test only |
|---|---|---|---|
| qrcode-generator | 2.0.4 | MIT | No |

Copyright (c) 2009 Kazuhiko Arase. Source: https://github.com/kazuhikoarase/qrcode-generator.
Pairing codes are generated locally; no QR generation service receives the pairing link.
