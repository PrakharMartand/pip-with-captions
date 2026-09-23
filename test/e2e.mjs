// End-to-end test: loads the unpacked extension into Chromium, opens the PiP
// window on (1) the WebVTT demo page and (2) a mock YouTube page, and checks
// that captions appear in the PiP window and the video returns on close.
//
//   npm install && npm test

import { chromium } from 'playwright';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const demoHtml = readFileSync(join(root, 'demo/index.html'), 'utf8');
const youtubeHtml = readFileSync(join(root, 'test/fake-youtube.html'), 'utf8');

const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'pipc-')), {
  channel: 'chromium', // the new headless mode, which can load extensions
  headless: !process.env.HEADED,
  args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`],
});
await context.route('https://demo.test/**', (r) => r.fulfill({ contentType: 'text/html', body: demoHtml }));
await context.route('https://www.youtube.com/**', (r) => r.fulfill({ contentType: 'text/html', body: youtubeHtml }));

// Collect every distinct caption shown in the PiP window for `ms`.
async function collectCaptions(page, ms) {
  return page.evaluate(async (ms) => {
    const seen = new Set();
    const end = performance.now() + ms;
    while (performance.now() < end) {
      const box = documentPictureInPicture.window?.document.getElementById('pipc-captions');
      if (box && box.children.length) seen.add([...box.children].map((s) => s.textContent).join(' | '));
      await new Promise((r) => setTimeout(r, 100));
    }
    return [...seen];
  }, ms);
}

async function waitForPip(page) {
  await page.waitForFunction(() => documentPictureInPicture.window?.document.querySelector('video'));
}

let failed = false;
async function test(name, fn) {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (err) {
    failed = true;
    console.log(`not ok - ${name}\n${err.stack}`);
  }
}

await test('WebVTT track: hover button opens PiP with captions, close restores video', async () => {
  const page = await context.newPage();
  await page.goto('https://demo.test/');
  await page.waitForSelector('body[data-ready]', { timeout: 30_000 });
  const before = await page.evaluate(() => {
    const v = document.querySelector('video');
    return { style: v.getAttribute('style'), mode: v.textTracks[0].mode, controls: v.controls };
  });

  // Hover the video, then click the injected button in its top-right corner.
  const box = await page.locator('video').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(200);
  await page.mouse.click(box.x + box.width - 45, box.y + 24);
  await waitForPip(page);

  const state = await page.evaluate(() => ({
    videoInPage: !!document.querySelector('video'),
    playing: !documentPictureInPicture.window.document.querySelector('video').paused,
    nativeControls: documentPictureInPicture.window.document.querySelector('video').controls,
  }));
  assert.equal(state.videoInPage, false, 'video should have moved to the PiP window');
  assert.equal(state.playing, true, 'video should keep playing after the move');
  assert.equal(state.nativeControls, false, 'native controls should be off in PiP');

  const captions = await collectCaptions(page, 8500);
  console.log('   captions seen:', captions);
  assert.ok(captions.includes('Subtitles in Picture-in-Picture.'));
  assert.ok(captions.includes('Speaker tags are stripped, | and line breaks are kept.'));
  assert.ok(captions.includes('Close the window to put the video back.'));

  await page.evaluate(() => documentPictureInPicture.window.close());
  await page.waitForFunction(() => document.querySelector('video'));
  const after = await page.evaluate(() => {
    const v = document.querySelector('video');
    return {
      style: v.getAttribute('style'),
      mode: v.textTracks[0].mode,
      controls: v.controls,
      className: v.className,
    };
  });
  assert.deepEqual(after, { ...before, className: '' }, 'video should be restored as it was');
  await page.close();
});

await test('YouTube DOM captions: Alt+Shift+P opens PiP and mirrors caption segments', async () => {
  const page = await context.newPage();
  await page.goto('https://www.youtube.com/watch?v=test');
  await page.waitForSelector('body[data-ready]');
  await page.keyboard.press('Alt+Shift+P');
  await waitForPip(page);

  const captions = await collectCaptions(page, 3500);
  console.log('   captions seen:', captions);
  assert.ok(captions.includes('First YouTube caption'));
  assert.ok(captions.includes('Second caption, | on two lines'));

  // Pressing the shortcut again closes the window.
  await page.keyboard.press('Alt+Shift+P');
  await page.waitForFunction(() => !documentPictureInPicture.window);
  assert.ok(await page.evaluate(() => document.querySelector('.html5-video-container > video')));
  await page.close();
});

await context.close();
process.exit(failed ? 1 : 0);
