import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const endpoint = 'https://github.com/arushn47/music-player/releases/latest/download/latest.json';

export function validateConfig(config, overlay, pkg, cargo, cliVersion, tag) {
  assert.match(tag, /^v\d+\.\d+\.\d+$/, 'Release tag must be a stable vMAJOR.MINOR.PATCH.');
  assert.equal(tag, `v${config.version}`, 'Tag must match tauri.conf.json version.');
  assert.equal(pkg.version, config.version, 'package.json version mismatch.');
  assert.equal(cargo.match(/^version\s*=\s*"([^"]+)"/m)?.[1], config.version, 'Cargo.toml version mismatch.');
  assert.equal(cliVersion, '2.12.3', 'Reverify updater artifact format before changing the locked CLI.');
  assert.equal(overlay.bundle.createUpdaterArtifacts, true, 'Release overlay must generate v2 updater artifacts.');
  assert(!config.bundle.createUpdaterArtifacts, 'Ordinary builds must not require updater signing.');
  assert.deepEqual(config.plugins.updater.endpoints, [endpoint], 'Updater endpoint mismatch.');
  const publicLines = Buffer.from(config.plugins.updater.pubkey, 'base64').toString().trim().split(/\r?\n/);
  assert.equal(Buffer.from(publicLines[1] ?? '', 'base64').length, 42, 'Missing or invalid updater public key.');
}

export function validateManifest(manifest, version, signature, tag, filename) {
  assert(typeof manifest.notes === "string" && manifest.notes.trim(), "Updater manifest must include release notes.");
  assert.equal(manifest.version.replace(/^v/, ''), version, 'Manifest version mismatch.');
  assert(Number.isFinite(Date.parse(manifest.pub_date)), 'Manifest needs a valid publication date.');
  const platform = manifest.platforms['windows-x86_64'];
  assert(platform, 'Missing windows-x86_64 updater platform.');
  assert.equal(platform.signature.trim(), signature.trim(), 'Manifest must contain the actual signature, not a path.');
  assert.equal(platform.url, `https://github.com/arushn47/lumaire-music-player/releases/download/${tag}/${filename}`, 'Manifest URL must match the actual published payload.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const json = (file) => JSON.parse(readFileSync(file, 'utf8'));
  const config = json('src-tauri/tauri.conf.json');
  const tag = process.env.RELEASE_TAG;
  validateConfig(config, json('src-tauri/tauri.release.conf.json'), json('package.json'), readFileSync('src-tauri/Cargo.toml', 'utf8'), json('node_modules/@tauri-apps/cli/package.json').version, tag);
  if (process.argv[2] === '--artifacts') {
    const dir = process.argv[3];
    assert(dir, 'Provide the downloaded release assets directory.');
    const filename = `Lumaire_${config.version}_x64-setup.exe`;
    const local = path.join('src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis', filename);
    for (const suffix of ['', '.sig']) {
      const downloaded = path.join(dir, filename + suffix);
      assert(statSync(downloaded).size > 0, `Missing/empty ${filename + suffix}`);
      assert(readFileSync(local + suffix).equals(readFileSync(downloaded)), `Uploaded ${filename + suffix} differs from the build.`);
    }
    const signature = readFileSync(path.join(dir, filename + '.sig'), 'utf8');
    const publicKey = Buffer.from(Buffer.from(config.plugins.updater.pubkey, 'base64').toString().trim().split(/\r?\n/)[1], 'base64');
    const signed = Buffer.from(Buffer.from(signature.trim(), 'base64').toString().trim().split(/\r?\n/)[1] ?? '', 'base64');
    assert.equal(signed.length, 74, 'Invalid updater signature format.');
    assert(publicKey.subarray(2, 10).equals(signed.subarray(2, 10)), 'Signature does not belong to the configured public key.');
    validateManifest(json(path.join(dir, 'latest.json')), config.version, signature, tag, filename);
  }
  console.log('Windows release validation passed.');
}
