<div align="center">

<img src="public/lumaire.svg" alt="Lumaire" width="80" height="80" />

# Lumaire

**Your music. Your words. A little closer.**

A local-first music player for Windows and Android, with a dedicated lyric room and a quiet, customizable interface.

[Downloads](https://github.com/arushn47/lumaire-music-player/releases) · [Features](#features) · [Build from source](#build-from-source) · [Report an issue](https://github.com/arushn47/lumaire-music-player/issues)

</div>

## Download

Download **[Lumaire v1.0.8 for Windows and Android](https://github.com/arushn47/lumaire-music-player/releases/tag/v1.0.8)**. The release includes both platform packages, clear release notes and SHA-256 checksums.

| Platform | Download to choose | Requirements |
| --- | --- | --- |
| Windows | Windows x64 setup `.exe` | 64-bit Windows with Microsoft WebView2; the installer can download WebView2 if needed |
| Android | Signed ARM64 `.apk` | Android 8.0 or later, ARM64 device |

Only the listed platforms are currently packaged. An APK is installed directly on Android; it is not a Windows installer. Linux, macOS, iOS and other Android architectures are not currently distributed.

### Install and verify

**Windows:** run the setup EXE. Current installers do not have an Authenticode publisher certificate, so Windows may show an unknown-publisher warning. Check the repository, release notes and checksum before deciding whether to install; do not disable system protection globally.

**Android:** open the APK and allow installation from your chosen browser/file manager when Android asks. Future APKs must use the same package name and signing certificate to update the app without uninstalling it. A conflict with an old development build can also come from a work/private profile; uninstalling app copies deletes their private data.

To verify a downloaded file in PowerShell:

```powershell
Get-FileHash .\Lumaire-1.0.8-Android-arm64.apk -Algorithm SHA256
```

Compare the result with that release's `SHA256SUMS.txt`. A checksum detects a changed download; it does not by itself prove that software is safe.

### Release status

Lumaire v1.0.8 is available for Windows x64 and Android ARM64. It improves lyric following, artist profiles, Android playback recovery, and the update/setup controls.

Installed Windows releases check for updates at launch. Use the update indicator or **Settings → About** to download; the highlighted action stays visible while release notes scroll. Choose **Restart & Update** when you are ready. Android uses manual APK installation from the same release page. Keep your existing installation to preserve your library and settings; Android signing certificates must match.

The streaming engine is maintained separately: Windows and Android check official stable yt-dlp releases at most daily, verify downloads, and retain a fallback if an update fails. This does not require a YouTube account or browser cookies.

## Features

- **Your library:** local audio files, favorites, playlists and a playback queue.
- **Discover:** catalog search with Lumaire artist and album pages. Metadata availability does not guarantee a playable source.
- **Lyric room:** synchronized lyrics, romanization and optional translation, with language labels and controls for how lyrics are displayed.
- **Listening tracker:** listening history and summaries of tracks, artists and albums.
- **Appearance:** light/dark themes and configurable accents.
- **Local storage:** library data and settings are stored on your device; no Lumaire account is required.

Audio formats and playback availability depend on the platform, codecs, provider access and installed optional components. Online discovery, streaming and lyric services require a connection. Local files remain usable offline.

## Privacy and online services

Lumaire has no required Lumaire account or analytics service. Local library data and listening history are stored on the device. Online services receive information needed for the feature you use—for example search terms, track metadata or lyric text. Optional Gemini lyric processing sends text to Google's service and requires a user-supplied key. Provider terms, quotas and availability apply.

Use Settings to review online sources and lyric processing. Never include API keys, listening databases, personal file paths or private signing keys in public bug reports.

Lumaire is an independent project and is not affiliated with Apple, Google, YouTube, JioSaavn or other catalog providers. Music, artwork and lyrics belong to their respective rightsholders. Source availability and permission to use a recording are separate questions.

## Build from source

The frontend uses React, TypeScript and Vite. Native functionality uses Tauri 2, Rust and SQLite.

For Windows, install Node.js, stable Rust, MSVC Build Tools, Windows SDK and Microsoft WebView2, then:

```powershell
git clone https://github.com/arushn47/music-player.git
cd music-player
npm ci
npm run desktop
```

```powershell
npm run build           # Production frontend
npm test                # Frontend/domain regression tests
npm run desktop:installer  # Local Windows NSIS installer
```

The Tauri wrapper uses the installed CLI and a project-local Cargo cache. Windows release signing is enabled only with the explicit release overlay. The [Windows release workflow](.github/workflows/windows-release.yml) builds and verifies updater artifacts; ordinary local builds do not require signing secrets.

For Android, install Android Studio, its Java runtime, Android SDK and NDK, then run `npm run android:doctor`. `npm run android:build` builds a development ARM64 APK; it is not the public release APK. Keep Android signing material private and reuse the existing release key for updates.

## Feedback and project information

Use [GitHub Issues](https://github.com/arushn47/lumaire-music-player/issues) for bugs and feature requests. Include your app version, platform, steps to reproduce and a redacted error message. Platform-specific failures are easier to fix when a report identifies whether it concerns local files, streaming or lyrics.

- [Release history and downloads](https://github.com/arushn47/lumaire-music-player/releases)
- [Windows build workflow](.github/workflows/windows-release.yml)
- [Third-party notices](THIRD_PARTY_NOTICES.md) and [license texts](THIRD_PARTY_LICENSES.txt)

Dependency licenses apply to their respective components. This repository does not yet declare a distribution license for Lumaire's original code; no license badge or blanket open-source claim is made here.
