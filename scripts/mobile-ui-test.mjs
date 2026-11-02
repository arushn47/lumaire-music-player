// Isolated presentation fixtures: never writes to the phone or its library.
import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { build } from 'vite';

const previewDirectory=path.resolve('.test-data/mobile-preview');
if (!process.env.LUMAIRE_TEST_URL) await build({logLevel:'error',base:'/',build:{outDir:previewDirectory,rollupOptions:{input:path.resolve('tests/mobile/index.html')}}});
const previewUrl = process.env.LUMAIRE_TEST_URL || 'http://127.0.0.1:5177';

const executablePath = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
assert(executablePath, 'Chrome or Edge is required.');
const browser = await chromium.launch({ executablePath, headless: true, args: ['--no-proxy-server'] });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
const page = await context.newPage();
const cdp = await context.newCDPSession(page);
await context.route('**/*', async route => {
  if (new URL(route.request().url()).hostname !== '127.0.0.1') { await route.abort(); return; }
  if (process.env.LUMAIRE_TEST_URL) { await route.continue(); return; }
  const file=path.resolve(previewDirectory,'.'+decodeURIComponent(new URL(route.request().url()).pathname));
  assert(file.startsWith(previewDirectory+path.sep));
  const contentType={'.html':'text/html','.js':'text/javascript','.css':'text/css','.jpg':'image/jpeg','.png':'image/png'}[path.extname(file)]||'application/octet-stream';
  await route.fulfill({status:existsSync(file)?200:404,contentType,body:existsSync(file)?readFileSync(file):'Not found'});
});
page.setDefaultTimeout(5000);
const errors = [];
page.on('pageerror', error => errors.push(error.message));
mkdirSync('.test-data/mobile-review', { recursive: true });
try {
  await page.goto(previewUrl + '/tests/mobile/index.html', { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.locator('.mobile-library-filters').waitFor();
  assert.equal(await page.locator('.mobile-tab-bar button').count(), 5);
  await page.screenshot({ path: '.test-data/mobile-review/library.png' });
  await page.getByRole('navigation', { name: 'Library sections' }).getByRole('button', { name: 'Songs', exact: true }).click();
  assert.equal(await page.locator('.track-row').count(), 3);
  await page.locator('.track-row .track-menu summary').first().click();
  const sheet = page.locator('details[open] .menu-popover');
  await sheet.waitFor();
  await sheet.evaluate(async n => { await Promise.all(n.getAnimations().map(animation => animation.finished)); });
  const bounds = await sheet.boundingBox();
  assert(bounds && bounds.width >= 389 && bounds.y + bounds.height <= 845, `Actions must be a bottom sheet: ${JSON.stringify(bounds)}`);
  await page.screenshot({ path: '.test-data/mobile-review/actions.png' });
  await sheet.getByRole('button', { name: 'Done', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('details[open]'));
  async function swipe(selector, x, y) {
    const r=await page.locator(selector).first().boundingBox(); assert(r);
    const startX=r.x+r.width/2, startY=r.y+r.height/2;
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:startX,y:startY}]});
    for(let step=1;step<=4;step++) await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:startX+x*step/4,y:startY+y*step/4}]});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  }
  assert.equal(await page.locator('.transport [aria-label="Next track"]').count(),0);
  await swipe('.transport .now-playing-title-wrap strong', -90, 0);
  assert.equal(await page.evaluate(()=>window.lastSkip),1);
  await swipe('.transport .now-playing-title-wrap strong', 90, 0);
  assert.equal(await page.evaluate(()=>window.lastSkip),-1);
  await swipe('.transport .now-playing-title-wrap strong', 0, -120);
  await page.locator('.mobile-now-playing').waitFor();
  const historyLength = await page.evaluate(() => history.length);
  const elapsed = await page.locator('.mobile-np-time.elapsed').textContent();
  await page.waitForFunction(previous => document.querySelector('.mobile-np-time.elapsed')?.textContent !== previous, elapsed);
  assert.equal(await page.evaluate(() => history.length), historyLength, 'Playback renders must not push history.');
  await page.screenshot({ path: '.test-data/mobile-review/player.png' });
  await swipe('.mobile-np-artwork-container', -100, 0);
  assert.equal(await page.evaluate(()=>window.lastSkip),1);
  await swipe('.mobile-np-artwork-container', 100, 0);
  assert.equal(await page.evaluate(()=>window.lastSkip),-1);
  await page.getByRole('button',{name:'Remove favorite',exact:true}).click();
  assert.equal(await page.getByRole('button',{name:'Save to favorites',exact:true}).getAttribute('aria-pressed'),'false');
  await page.getByRole('button',{name:'Save to favorites',exact:true}).click();
  assert.equal(await page.getByRole('button',{name:'Remove favorite',exact:true}).getAttribute('aria-pressed'),'true');
  await page.setViewportSize({ width: 360, height: 800 });
  assert(await page.locator('.mobile-np-header').evaluate(n => n.scrollWidth <= n.clientWidth), 'Player header must fit a narrow phone.');
  await page.setViewportSize({ width: 390, height: 844 });
  await swipe('.mobile-np-artwork-container', 0, -160);
  await page.locator('.mobile-np-queue-tab.is-open').waitFor();
  await page.locator('.mobile-np-queue-tab.is-open').evaluate(async panel => { await Promise.all(panel.getAnimations().map(animation => animation.finished)); });
  assert.equal(await page.locator('.mobile-np-queue-scroll .queue-drag-handle').count(),2);
  const dragRows=await page.locator('.mobile-np-queue-scroll [data-queue-entry]').evaluateAll(rows=>rows.map(row=>row.getBoundingClientRect().height));
  await swipe('.mobile-np-queue-scroll .queue-drag-handle',0,dragRows[0]);
  assert.deepEqual(await page.evaluate(()=>window.fixtureQueue),['t1','t3','t2']);
  await page.getByRole('button',{name:'Reorder Song 2 with a longer title',exact:true}).press('ArrowUp');
  assert.deepEqual(await page.evaluate(()=>window.fixtureQueue),['t1','t2','t3']);
  await page.screenshot({path:'.test-data/mobile-review/drag-queue.png'});
  await page.getByRole('button', { name: 'Remove from queue' }).last().click();
  assert.equal(await page.locator('.mobile-np-queue-item:not(.current)').count(), 1);
  await page.getByRole('button',{name:'Back to song',exact:true}).click();
  await swipe('.mobile-np-artwork-container', 0, 150);
  await page.locator('.mobile-now-playing').waitFor({state:'detached'});
  await page.locator('.mobile-tab-bar').getByRole('button',{name:'Lyrics',exact:true}).click();
  assert(await page.locator('.lyric-room').isVisible());
  assert(await page.locator('.transport').isVisible());
  assert.equal(await page.locator('.mobile-now-playing').count(),0);
  await page.screenshot({path:'.test-data/mobile-review/lyric-room.png'});
  await page.getByRole('button',{name:'Sync playlists & devices',exact:true}).click();
  await page.locator('dialog.collection-hub').evaluate(async dialog => { await Promise.all(dialog.getAnimations().map(animation => animation.finished)); });
  const closeBounds=await page.getByRole('button',{name:'Close playlists and devices',exact:true}).boundingBox();
  assert(closeBounds&&closeBounds.width===44&&closeBounds.height===44,JSON.stringify(closeBounds));
  await page.getByRole('button',{name:'Close playlists and devices',exact:true}).click();
  await page.locator('.mobile-tab-bar').getByRole('button',{name:'Tracker',exact:true}).click();
  const overview=await page.locator('.listening-recap-overview').boundingBox();
  assert(overview&&overview.height<310,JSON.stringify(overview));
  assert.equal(await page.locator('.listening-notice').count(),0);
  await page.screenshot({path:'.test-data/mobile-review/tracker.png'});

  await page.getByRole('button', { name: 'App settings', exact: true }).click();
  assert(await page.locator('.settings-index .settings-sidebar').isVisible());
  await page.getByRole('button', { name: 'Appearance', exact: true }).click();
  assert(await page.locator('.settings-detail .settings-content').isVisible());
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.screenshot({ path: '.test-data/mobile-review/settings.png' });
  await page.locator('.mobile-tab-bar').getByRole('button', { name: 'Library', exact: true }).click();
  await page.locator('.mobile-tab-bar').getByRole('button',{name:'Home',exact:true}).click();
  for(const label of ['Recently Played','Continue Listening','Quick Picks','Your Rotation','Forgotten Favorites']) assert(await page.getByRole('region',{name:label,exact:true}).isVisible());
  await page.locator('.mobile-tab-bar').getByRole('button',{name:'Discover',exact:true}).click();
  const moodCover=page.locator('.explore-card-img').first();
  if (await moodCover.isVisible()) await moodCover.scrollIntoViewIfNeeded();
  await page.waitForFunction(()=>{const image=document.querySelector('.explore-card-img');return image?.hidden||(image?.complete&&image.naturalWidth>0)});
  await page.screenshot({path:'.test-data/mobile-review/discover.png'});
  await page.goto(previewUrl+'/tests/mobile/index.html?search',{waitUntil:'domcontentloaded'});
  await page.locator('.mobile-tab-bar').getByRole('button',{name:'Discover',exact:true}).click();
  await page.locator('.discover-page .track-row').first().waitFor();
  const rowLayout=await page.locator('.discover-page .track-row').first().evaluate(row=>{const meta=row.querySelector('.track-meta').getBoundingClientRect(),actions=row.querySelector('.track-actions').getBoundingClientRect();return {height:row.getBoundingClientRect().height,sameRow:Math.abs(meta.y-actions.y)<20,albumHidden:getComputedStyle(row.querySelector('.album')).display==='none'}});
  assert(rowLayout.height<100&&rowLayout.sameRow&&rowLayout.albumHidden,JSON.stringify(rowLayout));
  await page.screenshot({path:'.test-data/mobile-review/discover-songs.png'});
  await page.locator('.mobile-tab-bar').getByRole('button',{name:'Library',exact:true}).click();
  for (const width of [360, 433]) {
    await page.setViewportSize({ width, height: 844 });
    const problems = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth > innerWidth,
      oval: [...document.querySelectorAll('.mobile-header-btn,.transport .play-button,.track-menu summary')].some(n => { const r=n.getBoundingClientRect(); return r.width > 0 && (Math.abs(r.width-r.height)>1 || r.width<44); }) }));
    assert.deepEqual(problems, { overflow: false, oval: false });
  }
  const rotationSizes = [[390,844],[844,390],[915,412],[1024,433],[800,1280],[1280,800],[1024,600],[640,800],[768,600],[900,500],[600,320],[320,568],[320,300],[390,844]];
  for (const [width,height] of rotationSizes) {
    await page.setViewportSize({width,height});
    await page.locator('.mobile-tab-bar').waitFor();
    const shell = await page.evaluate(() => {
      const rect = selector => document.querySelector(selector).getBoundingClientRect().toJSON();
      return {header:rect('.mobile-header'), workspace:rect('.workspace'), bar:rect('.mobile-tab-bar'), transport:rect('.transport'), overflow:document.documentElement.scrollWidth>innerWidth};
    });
    assert(!shell.overflow, `Shell overflow ${width}x${height}`);
    assert(shell.header.width>=width-1&&shell.workspace.height>0&&shell.workspace.y>=shell.header.y+shell.header.height-1, `Shell placement ${width}x${height}: ${JSON.stringify(shell)}`);
    assert(shell.transport.y>=shell.workspace.y+shell.workspace.height-1&&shell.bar.y>=shell.transport.y+shell.transport.height-1&&shell.bar.y+shell.bar.height<=height+1, `Shell rows ${width}x${height}: ${JSON.stringify(shell)}`);
  }
  await page.locator('.transport .mobile-cover-expand').click();
  await page.locator('.mobile-now-playing').waitFor();
  const playerHistory = await page.evaluate(()=>history.length);
  for (const [width,height] of rotationSizes) {
    await page.setViewportSize({width,height});
    const wide=width>=900&&height>=600;
    const player=page.locator(wide?'dialog.expanded-player[open]':'.mobile-now-playing');
    await player.waitFor();
    assert.equal(await page.evaluate(()=>history.length),playerHistory,'Rotation must retain one player history entry.');
    const controls=player.getByRole('button',{name:'Play',exact:true});
    await controls.scrollIntoViewIfNeeded();
    const geometry=await player.evaluate(n=>({overflow:n.scrollWidth>n.clientWidth,rect:n.getBoundingClientRect().toJSON()}));
    assert(!geometry.overflow, `Player overflow ${width}x${height}: ${JSON.stringify(geometry)}`);
    const r=await controls.boundingBox();
    assert(r&&r.x>=0&&r.y>=0&&r.x+r.width<=width+1&&r.y+r.height<=height+1, `Player control offscreen ${width}x${height}: ${JSON.stringify(r)}`);
    if(height>=500||width>=600) {
      const art=await player.locator(wide?'.expanded-cover-wrapper':'.mobile-np-artwork-card').boundingBox();
      const identity=await player.locator(wide?'.now-playing':'.mobile-np-identity-row').boundingBox();
      assert(art&&identity&&(art.x+art.width<=identity.x+1||art.y+art.height<=identity.y+1), `Artwork overlaps text ${width}x${height}: ${JSON.stringify({art,identity})}`);
      assert(Math.abs(art.width-art.height)<2, `Artwork must remain square ${width}x${height}: ${JSON.stringify(art)}`);
    }
    if (wide) {
      const record=await player.locator('.expanded-record').boundingBox();
      const seek=await player.locator('.seek-bar-top').boundingBox();
      assert(record&&seek&&record.y+record.height<=seek.y+1, `Song details overlap seek ${width}x${height}: ${JSON.stringify({record,seek})}`);
      for (const label of ['Shuffle','Previous track','Next track','Close expanded player']) {
        const button=await player.getByRole('button',{name:label,exact:true}).boundingBox();
        assert(button&&button.width>=44&&button.height>=44, `Touch target too small: ${label}`);
      }
    }
    await page.screenshot({path:`.test-data/mobile-review/rotation-${width}x${height}.png`});
  }
  await page.setViewportSize({width:1024,height:600});
  await page.locator('dialog.expanded-player[open]').waitFor();
  for (const theme of ['light','dark']) {
    await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
    for (const layout of ['Minimal','Immersive']) {
      await page.getByRole('button',{name:'Fullscreen layout',exact:true}).click();
      await page.getByRole('option',{name:layout,exact:true}).click();
      const details=await page.locator('.expanded-record').boundingBox(), buttons=await page.locator('.expanded-transport .player-center').boundingBox();
      assert(details&&buttons&&details.y>=60&&buttons.y+buttons.height<=600, `Expanded ${theme} ${layout} must fit.`);
      assert.equal(await page.evaluate(()=>history.length),playerHistory);
      await page.screenshot({path:`.test-data/mobile-review/tablet-${theme}-${layout.toLowerCase()}.png`});
    }
  }
  await page.setViewportSize({width:390,height:844});
  await page.locator('.mobile-now-playing').waitFor();
  await page.goBack();
  await page.locator('.mobile-now-playing').waitFor({state:'detached'});
  await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:false});
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.waitForFunction(() => !document.querySelector('.app')?.classList.contains('android'));
  assert(!await page.locator('.mobile-library-navigation').isVisible());
  assert(!await page.locator('.mobile-tab-bar').isVisible());
  assert(await page.locator('.desktop-sidebar').isVisible());
  await page.locator('.queue-pane [data-queue-entry]').first().waitFor();
  const handles=page.locator('.queue-pane [data-queue-entry]');
  const from=await handles.first().boundingBox(),to=await handles.last().boundingBox();
  assert(from&&to);
  await page.mouse.move(from.x+from.width/2,from.y+from.height/2);await page.mouse.down();
  await page.mouse.move(to.x+to.width/2,to.y+to.height/2,{steps:8});await page.mouse.up();
  assert.deepEqual(await page.evaluate(()=>window.fixtureQueue),['t1','t3','t2']);
  await handles.last().getByRole('button',{name:/Play queued/}).press('Alt+ArrowUp');
  assert.deepEqual(await page.evaluate(()=>window.fixtureQueue),['t1','t2','t3']);
  await page.locator('.transport .mobile-cover-expand').click();
  const expandedPlayer=page.locator('dialog.expanded-player[open]');
  const progress=expandedPlayer.locator('.seek-bar-top');
  const progressOpacity=()=>progress.evaluate(n=>Number(getComputedStyle(n).opacity));
  await expandedPlayer.getByRole('button',{name:'Play',exact:true}).click();
  await page.mouse.move(1100,100);
  await page.waitForFunction(()=>getComputedStyle(document.querySelector('.expanded-player .seek-bar-top')).opacity==='0');
  assert.equal(await expandedPlayer.locator('.expanded-times').evaluate(n=>getComputedStyle(n).opacity),'0');
  await page.mouse.move(1101,100);
  await page.waitForFunction(()=>getComputedStyle(document.querySelector('.expanded-player .seek-bar-top')).opacity==='1');
  await expandedPlayer.getByRole('slider',{name:'Seek playback',exact:true}).focus();
  await page.waitForTimeout(3300);
  assert.equal(await progressOpacity(),1,'Keyboard focus must keep progress visible.');
  await expandedPlayer.getByRole('button',{name:'Pause',exact:true}).click();
  await page.mouse.move(1100,100);
  await page.waitForTimeout(3300);
  assert.equal(await progressOpacity(),1,'Paused progress must remain visible.');
  await expandedPlayer.getByRole('button',{name:'Fullscreen layout',exact:true}).click();
  await page.getByRole('option',{name:'Minimal',exact:true}).click();
  await expandedPlayer.getByRole('button',{name:'Play',exact:true}).click();
  await page.mouse.move(1100,100);
  await page.waitForTimeout(3300);
  assert.equal(await progressOpacity(),1,'Minimal progress must remain visible.');
  await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});
  await expandedPlayer.getByRole('button',{name:'Fullscreen layout',exact:true}).click();
  await page.getByRole('option',{name:'Immersive',exact:true}).click();
  await page.waitForTimeout(3300);
  assert.equal(await progressOpacity(),1,'Touch progress must remain visible.');
  await page.goBack();
  await expandedPlayer.waitFor({state:'detached'});
  assert.deepEqual(errors, []);
  writeFileSync('.test-data/mobile-review/result.json', JSON.stringify({ passed: true, widths: [360, 390, 433, 1280], rotationSizes, errors }, null, 2));
  console.log('Passed: navigation, library filters, bottom sheets, player history, queue, lyrics, settings, circles, overflow and desktop isolation.');
} catch (error) {
  console.error(error.message, errors);
  await page.screenshot({ path: '.test-data/mobile-review/failure.png', animations: 'disabled', timeout: 2000 }).catch(() => {});
  console.log(JSON.stringify(await page.evaluate(() => ({ view: document.querySelector('h1')?.textContent, menu: [...document.querySelectorAll('details[open] .menu-popover')].map(n=>({rect:n.getBoundingClientRect().toJSON()})), errors: document.querySelector('vite-error-overlay')?.shadowRoot?.textContent?.slice(0,400) }))));
  throw error;
} finally { await browser.close(); }
