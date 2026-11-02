// Run with Node's test runner, independently of frontend Vitest discovery.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateConfig, validateManifest } from './check-windows-release.mjs';

const json = (file) => JSON.parse(readFileSync(file, 'utf8'));
test('release config preserves ordinary builds and rejects wrong tags/versions', () => {
  const config = json('src-tauri/tauri.conf.json');
  const args = [config, json('src-tauri/tauri.release.conf.json'), json('package.json'), readFileSync('src-tauri/Cargo.toml', 'utf8'), '2.12.3'];
  validateConfig(...args, `v${config.version}`);
  for (const tag of ['main', 'v9.9.9', `v${config.version}-beta.1`]) assert.throws(() => validateConfig(...args, tag));
  assert.throws(() => validateConfig(...args.slice(0, 4), '2.13.0', `v${config.version}`));
});
test('manifest must use the actual signed v2 EXE and complete matching signature', () => {
  const filename = 'Lumaire_1.0.4_x64-setup.exe';
  const manifest = { notes: 'User-visible changes', version: '1.0.4', pub_date: '2026-10-20T00:00:00Z', platforms: { 'windows-x86_64': { signature: 'signature-content', url: `https://github.com/arushn47/lumaire-music-player/releases/download/v1.0.4/${filename}` } } };
  const validate = (value) => validateManifest(value, '1.0.4', 'signature-content\n', 'v1.0.4', filename);
  validate(manifest);
  assert.throws(() => validate({ ...manifest, notes: "" }));
  assert.throws(() => validate({ ...manifest, version: '1.0.3' }));
  for (const change of [{ url: manifest.platforms['windows-x86_64'].url.replace('.exe', '.nsis.zip') }, { signature: 'file.sig' }]) {
    assert.throws(() => validate({ ...manifest, platforms: { 'windows-x86_64': { ...manifest.platforms['windows-x86_64'], ...change } } }));
  }
});
