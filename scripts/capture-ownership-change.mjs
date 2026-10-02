#!/usr/bin/env node
// Ownership-change state captures (Art Bible section 15 verification).
//
// For each battlefield: start a bot match at 360x800 (the smallest supported
// viewport), record the initial neutral territory ids, dispatch full
// garrisons from both bases at their nearest neutrals, poll until at least
// one neutral has flipped to EACH side, then capture. Asserts the flips
// actually happened, no textures failed, and no console errors — so a red
// "captured by enemy" and blue "captured by player" state are both proven
// on screen, not just claimed.
//
// Usage: node scripts/capture-ownership-change.mjs [outDir]
// Requires the dist server: node scripts/serve-dist.mjs 4173

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CdpClient, waitForWebSocketOpen } from './cdp-client.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const APP_URL = process.env.CC_QA_APP_URL || 'http://127.0.0.1:4173/?benchmark_mode=1';
const BATTLEFIELDS = ['crown_cross', 'twin_passes', 'royal_ring', 'quad_citadel'];
const VIEWPORT = { width: 360, height: 800, dpr: 2 };
const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function evaluate(cdp, expression, { awaitPromise = false } = {}) {
  const res = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise });
  if (res.exceptionDetails) {
    throw new Error(`page eval failed: ${JSON.stringify(res.exceptionDetails)}`);
  }
  return res.result?.value;
}

async function captureBattlefield(battlefieldId, outDir) {
  const cdpPort = 9500 + Math.floor(Math.random() * 300);
  const profileDir = path.join(REPO_ROOT, `qa-artifacts/chrome-own-${Date.now()}`);
  fs.mkdirSync(profileDir, { recursive: true });
  const chrome = spawn(CHROME_PATH, [
    '--headless=new',
    `--remote-debugging-port=${cdpPort}`,
    '--no-sandbox',
    '--disable-extensions',
    '--hide-scrollbars',
    `--user-data-dir=${profileDir}`,
    'about:blank',
  ], { stdio: 'ignore' });

  try {
    let tabs = null;
    for (let attempt = 0; attempt < 40 && !tabs; attempt += 1) {
      await sleep(250);
      try {
        const res = await fetch(`http://127.0.0.1:${cdpPort}/json/list`, { signal: AbortSignal.timeout(2000) });
        tabs = (await res.json()).filter((t) => t.type === 'page');
      } catch { /* Chrome not ready yet */ }
    }
    if (!tabs?.length) throw new Error('Chrome CDP endpoint never came up');
    const ws = new WebSocket(tabs[0].webSocketDebuggerUrl);
    await waitForWebSocketOpen(ws);
    const cdp = new CdpClient(ws);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');

    const consoleErrors = [];
    cdp.on('Runtime.consoleAPICalled', (params) => {
      if (params.type === 'error') {
        consoleErrors.push(params.args.map((a) => a.value || a.description).join(' '));
      }
    });
    cdp.on('Runtime.exceptionThrown', (params) => {
      consoleErrors.push(params.exceptionDetails?.text || 'Uncaught exception');
    });

    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: VIEWPORT.width,
      height: VIEWPORT.height,
      deviceScaleFactor: VIEWPORT.dpr,
      mobile: true,
    });
    await cdp.send('Page.navigate', { url: APP_URL });
    await sleep(4000);

    // Wait for the app to boot before starting the scene: a fixed sleep
    // races cold dist-server loads (the game global is undefined otherwise).
    let booted = false;
    for (let attempt = 0; attempt < 40 && !booted; attempt += 1) {
      await sleep(400);
      booted = await evaluate(cdp, `Boolean(window.__PHASER_GAME__)`);
    }
    if (!booted) throw new Error(`app never booted for ${battlefieldId}`);

    await evaluate(cdp, `(() => {
      window.__PHASER_GAME__.scene.start('GameScene', {
        source: 'menu',
        botMatch: { matchId: 'ownq_${battlefieldId}_' + Date.now(), battlefieldId: '${battlefieldId}' },
      });
      return 'started';
    })()`);

    // Wait for the scene to be fully loaded.
    let loaded = false;
    for (let attempt = 0; attempt < 30 && !loaded; attempt += 1) {
      await sleep(400);
      loaded = await evaluate(cdp, `(() => {
        const scene = window.__PHASER_GAME__?.scene?.getScene('GameScene');
        return Boolean(scene && scene.gameState && scene.battlefieldId === '${battlefieldId}');
      })()`);
    }
    if (!loaded) throw new Error(`GameScene never loaded for ${battlefieldId}`);

    // Record the initial neutral set, then send both bases' full garrisons
    // at their nearest neutrals (both sides, so the capture shows red AND
    // blue ownership changes on screen at once).
    await evaluate(cdp, `(() => {
      const scene = window.__PHASER_GAME__.scene.getScene('GameScene');
      const territories = Object.values(scene.gameState.territories);
      window.__qaNeutralIds = territories.filter((t) => t.owner === 'neutral').map((t) => t.id);
      const playerBase = territories.find((t) => t.owner === 'player');
      const enemyBase = territories.find((t) => t.owner === 'enemy');
      const neutrals = territories.filter((t) => t.owner === 'neutral');
      const nearest = (base) => [...neutrals].sort((a, b) =>
        Math.hypot(a.x - base.x, a.y - base.y) - Math.hypot(b.x - base.x, b.y - base.y));
      nearest(playerBase).slice(0, 2).forEach((t) => scene.executeQaDispatch(playerBase.id, t.id, 'player'));
      nearest(enemyBase).slice(0, 2).forEach((t) => scene.executeQaDispatch(enemyBase.id, t.id, 'enemy'));
      return 'dispatched';
    })()`);

    // Poll until at least one neutral flipped to player AND one to enemy.
    let flips = null;
    for (let attempt = 0; attempt < 80; attempt += 1) {
      await sleep(400);
      flips = JSON.parse(await evaluate(cdp, `(() => {
        const scene = window.__PHASER_GAME__.scene.getScene('GameScene');
        const neutralIds = window.__qaNeutralIds || [];
        const playerFlips = [];
        const enemyFlips = [];
        for (const id of neutralIds) {
          const t = scene.gameState.territories[id];
          if (!t) continue;
          if (t.owner === 'player') playerFlips.push(id);
          if (t.owner === 'enemy') enemyFlips.push(id);
        }
        return JSON.stringify({
          playerFlips,
          enemyFlips,
          missing: [...(scene.missingTerritoryTextures || [])],
        });
      })()`));
      if (flips.playerFlips.length > 0 && flips.enemyFlips.length > 0) break;
    }

    const shot = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
    const fileName = `${battlefieldId}-360x800-ownership-change.png`;
    const outPath = path.join(outDir, fileName);
    fs.writeFileSync(outPath, Buffer.from(shot.data, 'base64'));

    const report = {
      file: fileName,
      playerFlips: flips.playerFlips,
      enemyFlips: flips.enemyFlips,
      missingTextures: flips.missing,
      consoleErrors: consoleErrors.length,
    };
    console.log(`[ownership] ${fileName}: ${JSON.stringify(report)}`);

    const problems = [];
    if (flips.playerFlips.length === 0) problems.push('no neutral flipped to player');
    if (flips.enemyFlips.length === 0) problems.push('no neutral flipped to enemy');
    if (flips.missing.length > 0) problems.push(`missing textures: ${flips.missing.join(',')}`);
    if (consoleErrors.length > 0) problems.push(`console errors: ${consoleErrors.slice(0, 3).join(' | ')}`);
    return { battlefieldId, report, problems };
  } finally {
    chrome.kill('SIGKILL');
    fs.rmSync(profileDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  }
}

async function main() {
  const outDir = path.resolve(process.argv[2] || path.join(REPO_ROOT, 'qa-artifacts/art-overhaul'));
  fs.mkdirSync(outDir, { recursive: true });
  const results = [];
  for (const battlefieldId of BATTLEFIELDS) {
    results.push(await captureBattlefield(battlefieldId, outDir));
  }
  const problems = results.flatMap((r) => r.problems.map((p) => `${r.battlefieldId}: ${p}`));
  if (problems.length > 0) {
    console.error(`OWNERSHIP-CHANGE QA FAILED:\n${problems.join('\n')}`);
    process.exit(1);
  }
  console.log(`OWNERSHIP-CHANGE QA PASSED: ${results.length} battlefields with proven player and enemy flips.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
