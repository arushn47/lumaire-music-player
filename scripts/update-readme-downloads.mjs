// Keep the README's direct downloads and button labels in step with each release.
import { readFileSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const version = JSON.parse(readFileSync('src-tauri/tauri.conf.json', 'utf8')).version;
assert(/^\d+\.\d+\.\d+$/.test(version));
const base = `https://github.com/arushn47/lumaire-music-player/releases/download/v${version}`;
const block = `<!-- release-downloads:start -->
<p align="center"><strong>Latest release · v${version}</strong></p>
<p align="center">
  <a href="${base}/Lumaire_${version}_x64-setup.exe"><img src=".github/readme/windows.svg" alt="Download Lumaire v${version} for Windows x64 — EXE installer" width="272" height="72" /></a>
  <a href="${base}/Lumaire-${version}-Android-arm64.apk"><img src=".github/readme/android.svg" alt="Download Lumaire v${version} for Android ARM64 — signed APK" width="272" height="72" /></a>
</p>
<p align="center">Windows x64 + WebView2 · Android 8.0+ / ARM64</p>
<p align="center"><a href="${base}/SHA256SUMS.txt">Verify checksums</a> · <a href="https://github.com/arushn47/lumaire-music-player/releases/tag/v${version}">What's new in v${version}</a> · <a href="https://github.com/arushn47/lumaire-music-player/releases">All releases</a></p>
<!-- release-downloads:end -->`;
const readme = readFileSync('README.md', 'utf8').replace(/\r\n/g, '\n');
const marker = /<!-- release-downloads:start -->[\s\S]*?<!-- release-downloads:end -->/;
assert(marker.test(readme), 'README download section is missing.');
const expected = readme.replace(marker, block);
const check = process.argv.includes('--check');
if (check) assert.equal(readme, expected, 'Run node scripts/update-readme-downloads.mjs before releasing.');
else writeFileSync('README.md', expected);

for (const [platform, label, detail, icon] of [
  ['windows', 'Download for Windows', 'x64 · EXE installer', '<path d="M22 24h11v11H22zm14 0h11v11H36zM22 38h11v11H22zm14 0h11v11H36z" fill="#18151f"/>'],
  ['android', 'Download for Android', 'ARM64 · Signed APK', '<g fill="none" stroke="#18151f" stroke-width="2.5" stroke-linecap="round"><path d="m27 23-3-4m19 4 3-4M23 36a12 12 0 0 1 24 0Z"/><path d="M23 39h24v12H23zm4 12v4m16-4v4m-24-15v8m32-8v8"/><path d="M29 29h.1M41 29h.1"/></g>'],
]) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="272" height="72" viewBox="0 0 272 72" role="img" aria-label="${label}, v${version}"><title>${label} — v${version}</title><rect width="272" height="72" rx="16" fill="#b5a0f3"/>${icon}<g fill="#18151f" font-family="Segoe UI,Arial,sans-serif"><text x="64" y="31" font-size="16" font-weight="700">${label}</text><text x="64" y="51" font-size="12">v${version} · ${detail}</text></g></svg>\n`;
  const file = `.github/readme/${platform}.svg`;
  if (check) assert.equal(readFileSync(file, 'utf8').replace(/\r\n/g, '\n'), svg, `Regenerate ${file}.`);
  else writeFileSync(file, svg);
}
console.log(`${check ? 'Verified' : 'Updated'} README downloads for v${version}.`);
