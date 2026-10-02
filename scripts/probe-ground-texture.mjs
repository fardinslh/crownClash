// One-off dev probe: verifies the rendered ground texture actually loads and
// exists in GameScene for a battlefield (evidence beyond pixel diffs).
// Usage: node scripts/probe-ground-texture.mjs crown_cross
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CdpClient, pickFreeCdpPort, waitForWebSocketOpen } from './cdp-client.mjs';

const battlefieldId = process.argv[2] ?? 'crown_cross';
const appUrl = process.env.CC_QA_APP_URL ?? 'http://localhost:3000/?benchmark_mode=1';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const chromePath = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
].find((p) => fs.existsSync(p));
if (!chromePath) throw new Error('no Chrome/Chromium found');

const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-ground-probe-'));
const cdpPort = await pickFreeCdpPort();
const chrome = spawn(
  chromePath,
  [
    '--headless=new',
    `--remote-debugging-port=${cdpPort}`,
    `--user-data-dir=${profileDir}`,
    '--no-sandbox',
    '--hide-scrollbars',
    'about:blank',
  ],
  { stdio: 'ignore' }
);

try {
  let tabs = null;
  for (let attempt = 0; attempt < 40 && !tabs; attempt += 1) {
    await sleep(250);
    try {
      const res = await fetch(`http://127.0.0.1:${cdpPort}/json/list`, { signal: AbortSignal.timeout(2000) });
      tabs = (await res.json()).filter((t) => t.type === 'page');
    } catch {
      /* Chrome not ready yet */
    }
  }
  if (!tabs || tabs.length === 0) throw new Error('Chrome CDP endpoint never came up');
  const ws = new WebSocket(tabs[0].webSocketDebuggerUrl);
  await waitForWebSocketOpen(ws);
  const cdp = new CdpClient(ws);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Network.enable');

  const groundUrls = [];
  cdp.on('Network.requestWillBeSent', (params) => {
    if (params.request.url.includes('grounds/')) groundUrls.push(params.request.url);
  });

  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
    deviceScaleFactor: 2,
    mobile: true,
  });
  await cdp.send('Page.navigate', { url: appUrl });

  // Boot, auto-training settle and scene start mirror the QA capture script.
  await sleep(11000);

  const result = await cdp.send('Runtime.evaluate', {
    expression: `(() => {
      const game = window.__PHASER_GAME__;
      if (!game) return { error: 'no __PHASER_GAME__' };
      const scene = game.scene.getScene('GameScene');
      if (!scene) return { error: 'no GameScene' };
      return {
        battlefieldId: scene.battlefieldId,
        groundTextureExists: game.textures.exists('cc_ground_${battlefieldId}'),
      };
    })()`,
    returnByValue: true,
  });
  console.log(JSON.stringify({ ...result.result.value, groundUrlFetches: groundUrls }, null, 2));
} finally {
  chrome.kill();
  fs.rmSync(profileDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
}
