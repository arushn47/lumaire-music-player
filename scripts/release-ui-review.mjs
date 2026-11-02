import { build } from 'vite';
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const dir = path.resolve('.test-data/release-ui');
const out = path.join(dir, 'dist');
const phase = process.argv[2] || 'after';
mkdirSync(dir, { recursive: true });
writeFileSync(path.join(dir, 'index.html'), '<html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Lumaire updates</title><div id="root"></div><script type="module" src="./fixture.tsx"></script></html>');
writeFileSync(path.join(dir, 'updater.ts'), `
import {useSyncExternalStore} from 'react';
import notes from '../../RELEASE_NOTES.md?raw';
const params=new URLSearchParams(location.search);
let state={stage:params.get('stage')||'available',currentVersion:'1.0.7',version:'1.0.8',notes,progress:43,installedRelease:{version:'1.0.7',notes:'# Lumaire v1.0.7\\n\\nPrevious playback and library improvements.'}};
const listeners=new Set();
export const getUpdateState=()=>state;
export const subscribeToUpdates=fn=>{listeners.add(fn);return()=>listeners.delete(fn)};
export const supportsAndroidUpdates=()=>params.get('platform')==='android';
export const supportsWindowsUpdates=()=>!supportsAndroidUpdates();
function change(next){state={...state,...next};listeners.forEach(fn=>fn())}
window.review={change,calls:[]};
export const checkForUpdates=async()=>{window.review.calls.push('check');change({stage:'available'})};
export const downloadUpdate=async()=>{window.review.calls.push('download');change({stage:'ready'})};
export const restartAndUpdate=async()=>{window.review.calls.push('restart')};
`);
writeFileSync(path.join(dir, 'fixture.tsx'), `
import React from 'react';import {createRoot} from 'react-dom/client';
import {UpdateDialog} from '../../src/components/modals/UpdateDialog';
import {EngineSetupDialog} from '../../src/components/modals/EngineSetupDialog';
import {applyTheme} from '../../src/theme';
import '../../src/style.css';
const p=new URLSearchParams(location.search);applyTheme({themeMode:p.get('theme')||'dark',accentColor:'#A78BFA'});
const stage=p.get('stage')||'missing';
createRoot(document.getElementById('root')).render(<div className={'app '+(p.get('platform')==='android'?'android':'')} style={{display:'block'}}>
{p.has('engine')?<EngineSetupDialog engineState={stage} engineError={stage==='error'?'The download was interrupted. Check your connection and try again.':''} engineProgress={stage==='installing'?{stage:'downloading',component:'yt-dlp.exe',received:5242880,total:10485760,attempt:1}:null} engineCancelling={false} onInstallYoutubeEngine={async()=>{window.engineClicked=true}} onCancelYoutubeEngineInstall={async()=>{window.cancelClicked=true}}/>:<UpdateDialog onClose={()=>{window.closedUpdates=true}}/>}
</div>);
`);
await build({ logLevel: 'error', base: '/', plugins: [{ name: 'review-updater', enforce: 'pre', resolveId(source) { if (source.endsWith('/adapters/updater')) return path.join(dir, 'updater.ts'); } }], build: { outDir: out, rollupOptions: { input: path.join(dir, 'index.html') } } });
const executablePath = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
assert(executablePath, 'Chrome or Edge is required.');
const browser = await chromium.launch({ executablePath, headless: true });
const screenshots = path.resolve('test-results/release-ui', phase);
mkdirSync(screenshots, { recursive: true });
const reports = [];
try {
  for (const theme of ['dark', 'light']) for (const width of [390, 768, 1440]) for (const scenario of ['available', 'ready', 'downloading', 'android', 'engine-missing', 'engine-installing', 'engine-error']) {
    const page = await browser.newPage({ viewport: { width, height: 844 } });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.route('http://review.local/**', async route => {
      const url = new URL(route.request().url());
      const file = path.resolve(out, '.' + decodeURIComponent(url.pathname));
      assert(file.startsWith(out + path.sep));
      await route.fulfill({ status: existsSync(file) ? 200 : 404, contentType: file.endsWith('.js') ? 'application/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html', body: existsSync(file) ? readFileSync(file) : '' });
    });
    const query = new URLSearchParams(scenario.startsWith('engine-') ? {engine:'1',stage:scenario.slice(7)} : scenario === 'android' ? {platform:'android'} : {stage:scenario});
    query.set('theme',theme);
    await page.goto('http://review.local/.test-data/release-ui/index.html?' + query);
    const dialog = page.locator('dialog'); await dialog.waitFor(); await page.waitForTimeout(350);
    await page.screenshot({ path: path.join(screenshots, `${scenario}-${width}-${theme}.png`) });
    if (phase === 'after') {
      assert.deepEqual(errors, []);
      assert(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth + 1), 'Dialog overflows horizontally');
      if (scenario === 'available') {
        const action = page.getByRole('button', {name: /Download update/});
        const box = await action.boundingBox(); assert(box && box.height >= 44 && box.y >= 0 && box.y + box.height <= 844, 'Update action must be visible');
        const filled = await action.evaluate(el => getComputedStyle(el).backgroundColor !== 'rgba(0, 0, 0, 0)'); assert(filled);
        await page.locator('.updater-details--notes').evaluate(el => { el.scrollTop = el.scrollHeight; });
        assert(await page.locator('.updater-details--notes').evaluate(el=>el.scrollTop>0), 'Notes must actually scroll');
        const scrolled = await action.boundingBox(); assert(scrolled && scrolled.y >= 0 && scrolled.y + scrolled.height <= 844, 'Update action must stay visible after scrolling');
        await action.click(); await page.getByRole('button', {name:/Restart.*Update/}).waitFor();
        assert.deepEqual(await page.evaluate(() => window.review.calls), ['download']);
      }
      if (scenario === 'engine-missing' || scenario === 'engine-error') {
        const action = page.getByRole('button', {name:scenario === 'engine-error' ? 'Retry setup' : 'Enable online playback'});
        await action.click(); assert(await page.evaluate(() => window.engineClicked));
      }
    }
    reports.push({width,scenario,errors}); await page.close();
  }
  writeFileSync(path.join(screenshots, 'report.json'), JSON.stringify(reports,null,2));
  console.log(`PASS: ${reports.length} update/setup layouts (${phase}).`);
} finally { await browser.close(); }
