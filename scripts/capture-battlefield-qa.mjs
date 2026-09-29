#!/usr/bin/env node
// Battlefield visual QA capture via raw CDP (cross-platform).
//
// Corrected capture procedure (per review):
//   1. Launch a FRESH headless Chrome per viewport (never resize a running
//      scene across viewport/DPR changes — mid-scene resizes corrupt the
//      Phaser EXPAND layout and produced duplicated/stitched captures).
//   2. Emulation.setDeviceMetricsOverride with CSS width/height and
//      deviceScaleFactor: 2 BEFORE navigation.
//   3. Assert window.innerWidth/innerHeight/devicePixelRatio and that the
//      Phaser canvas client rect fits the single intended viewport.
//   4. Start GameScene through the __PHASER_GAME__ QA hook with the requested
//      battlefieldId; wait until the battlefield's sprite pack is actually
//      fetched and no texture failed to load.
//   5. Capture with Page.captureScreenshot (no clip, fromSurface: true).
//   6. Prove single-view: compare the capture against Phaser's own renderer
//      snapshot of the same scene (a stitched/duplicated capture would
//      disagree with the canvas render).
//
// Usage:
//   node scripts/capture-battlefield-qa.mjs <battlefieldId> [outDir]
//   node scripts/capture-battlefield-qa.mjs training [outDir]
//
// The special id "training" captures the guided training battle's first
// step (clean field, spotlight + instruction visible) instead of an
// ordinary bot match — the same launch data MenuScene uses on first play.
//
// Primary review artifacts are the CLEAN captures (`-clean.png`: no armies,
// no transient combat labels). The `-armies.png` captures keep the marching
// armies QA frame.
//
// Requires the vite dev server on localhost:3000 (`npm run dev` in apps/game).

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CdpClient, pickFreeCdpPort, waitForWebSocketOpen } from './cdp-client.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const APP_URL = process.env.CC_QA_APP_URL || 'http://localhost:3000/?benchmark_mode=1';
const VIEWPORTS = [
  { width: 360, height: 800, dpr: 2 },
  { width: 390, height: 844, dpr: 2 },
  { width: 430, height: 932, dpr: 2 },
];

const CHROME_CANDIDATES = [
  process.env.CC_QA_CHROME_BIN,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
].filter(Boolean);

function findChrome() {
  for (const candidate of CHROME_CANDIDATES) {
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // try the next candidate
    }
  }
  throw new Error(
    'No Chrome binary found. Set CC_QA_CHROME_BIN=/path/to/chrome (headless Chrome is required for capture).'
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function evaluate(cdp, expression, { awaitPromise = false } = {}) {
  const res = await cdp.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise,
  });
  if (res.exceptionDetails) {
    throw new Error(`page eval failed: ${JSON.stringify(res.exceptionDetails)}`);
  }
  return res.result?.value;
}

async function captureViewport(chromePath, battlefieldId, viewport, outDir) {
  const cdpPort = await pickFreeCdpPort();
  const profileDir = path.join(REPO_ROOT, `qa-artifacts/chrome-qa-${Date.now()}-${viewport.width}`);
  fs.mkdirSync(profileDir, { recursive: true });
  const chrome = spawn(
    chromePath,
    [
      '--headless=new',
      `--remote-debugging-port=${cdpPort}`,
      '--no-sandbox',
      '--disable-extensions',
      '--hide-scrollbars',
      `--user-data-dir=${profileDir}`,
      'about:blank',
    ],
    { stdio: 'ignore' }
  );

  try {
    // Wait for the CDP endpoint.
    let tabs = null;
    for (let attempt = 0; attempt < 40 && !tabs; attempt += 1) {
      await sleep(250);
      try {
        const res = await fetch(`http://127.0.0.1:${cdpPort}/json/list`, {
          signal: AbortSignal.timeout(2000),
        });
        const list = await res.json();
        tabs = list.filter((t) => t.type === 'page');
      } catch {
        // Chrome not ready yet
      }
    }
    if (!tabs || tabs.length === 0) throw new Error('Chrome CDP endpoint never came up');
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

    // Device metrics BEFORE navigation: CSS viewport + DPR 2.
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: viewport.dpr,
      mobile: true,
    });

    await cdp.send('Page.navigate', { url: APP_URL });
    // Wait for the app to actually boot (a cold headless Chrome under load
    // can take far longer than a fixed sleep; the canvas is the boot proof).
    let canvasUp = false;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      await sleep(500);
      canvasUp = await evaluate(
        cdp,
        `(() => document.querySelector('canvas') && window.__PHASER_GAME__ ? true : false)()`
      );
      if (canvasUp === true) break;
    }
    if (canvasUp !== true) {
      throw new Error('app never booted (no canvas after 20s)');
    }

    // --- Capture-time assertions -----------------------------------------
    const metrics = await evaluate(
      cdp,
      `(() => {
        const canvas = document.querySelector('canvas');
        const rect = canvas ? canvas.getBoundingClientRect() : null;
        return JSON.stringify({
          innerWidth: window.innerWidth,
          innerHeight: window.innerHeight,
          devicePixelRatio: window.devicePixelRatio,
          canvasRect: rect ? {
            left: rect.left, top: rect.top,
            width: rect.width, height: rect.height,
            right: rect.right, bottom: rect.bottom,
          } : null,
          canvasBacking: canvas ? [canvas.width, canvas.height] : null,
        });
      })()`
    );
    const m = JSON.parse(metrics);
    const failures = [];
    if (m.innerWidth !== viewport.width) failures.push(`innerWidth ${m.innerWidth} != ${viewport.width}`);
    if (m.innerHeight !== viewport.height) failures.push(`innerHeight ${m.innerHeight} != ${viewport.height}`);
    if (m.devicePixelRatio !== viewport.dpr) failures.push(`devicePixelRatio ${m.devicePixelRatio} != ${viewport.dpr}`);
    if (!m.canvasRect) failures.push('no canvas found');
    else {
      const r = m.canvasRect;
      const fitsViewport =
        r.left >= 0 && r.top >= 0 && r.right <= m.innerWidth + 0.5 && r.bottom <= m.innerHeight + 0.5;
      if (!fitsViewport) failures.push(`canvas rect ${JSON.stringify(r)} does not fit the single viewport`);
    }
    if (failures.length > 0) {
      throw new Error(`viewport assertion failed: ${failures.join('; ')}`);
    }

    const isTraining = battlefieldId === 'training';
    if (!isTraining) {
      // Fresh QA profiles trigger the first-session tutorial. Wait for that
      // asynchronous navigation to finish before replacing it with the
      // requested map, otherwise it can win a later scene.start race.
      let autoTrainingReady = false;
      for (let attempt = 0; attempt < 60; attempt += 1) {
        autoTrainingReady = await evaluate(cdp, `(() => {
          const game = window.__PHASER_GAME__;
          const scene = game?.scene?.getScene('GameScene');
          return game?.scene?.isActive('GameScene') === true && scene?.trainingMode === true;
        })()`);
        if (autoTrainingReady) break;
        await sleep(200);
      }
      if (!autoTrainingReady) throw new Error('first-session training did not settle before QA map launch');
    }
    // This is an explicit QA scene launch. The menu's asynchronous career
    // connection can finish after our scene.start call. Suppress only its
    // automatic training navigation; the capture still asserts the actual
    // GameScene battlefield, textures, and renderer output below.
    await evaluate(cdp, `(() => {
      window.__PHASER_GAME__.registry.set('trainingLaunchedThisSession', true);
      ${isTraining ? '' : "window.__PHASER_GAME__.scene.getScene('MenuScene').startTrainingBattle = () => {};"}
      return true;
    })()`);

    // --- Start the requested battlefield scene ----------------------------
    await evaluate(
      cdp,
      `(() => {
        window.__PHASER_GAME__.scene.start('GameScene', ${
          isTraining
            ? "{ source: 'menu', mode: 'bot', training: true }"
            : `{
          source: 'menu',
          botMatch: { matchId: 'qa_${battlefieldId}_' + Date.now(), battlefieldId: '${battlefieldId}' },
        }`
        });
        return 'started';
      })()`
    );

    // Prove this is the initial, fully rendered state of the requested map.
    // Resource-history checks alone can accept an old fetch and a battle that
    // has already been running for 20 seconds. Freeze the scene as soon as
    // these invariants hold so the screenshot cannot drift after validation.
    let state = null;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      await sleep(100);
      state = JSON.parse(
        await evaluate(
          cdp,
          `(() => {
            const scene = window.__PHASER_GAME__?.scene?.getScene('GameScene');
            if (!scene || !scene.gameState) return JSON.stringify(null);
            const urls = performance.getEntriesByType('resource').map((r) => r.name);
            const visuals = [...scene.territoryVisuals.values()];
            return JSON.stringify({
              battlefieldId: scene.battlefieldId,
              trainingMode: scene.trainingMode === true,
              trainingStep: scene.trainingController ? scene.trainingController.currentStepId : null,
              packFetches: urls.filter((u) => u.includes('territories/' + scene.battlefieldId + '/')).length,
              missing: [...(scene.missingTerritoryTextures || [])],
              status: scene.gameState.status,
              elapsed: scene.gameState.elapsedTimeSeconds,
              armyCount: scene.gameState.armies.length,
              territoryCount: Object.keys(scene.gameState.territories).length,
              visualCount: visuals.length,
              fullyVisibleCount: visuals.filter((v) => v.container.alpha >= 0.99).length,
              textureKeys: visuals.map((v) => v.sprite.texture.key),
            });
          })()`
        )
      );
      if (state && state.battlefieldId !== (isTraining ? 'crown_cross' : battlefieldId)) {
        throw new Error(`requested ${battlefieldId} but active scene is ${state.battlefieldId}`);
      }
      if (state && state.packFetches > 0 && state.visualCount === state.territoryCount &&
          state.fullyVisibleCount === state.territoryCount) break;
    }
    if (!state) throw new Error('GameScene never reached a loaded game state');
    // Final pre-capture assertion: the auto-training race must not have
    // silently replaced the scene between the wait loop and the screenshot.
    const preCapture = JSON.parse(
      await evaluate(
        cdp,
        `(() => {
          const scene = window.__PHASER_GAME__?.scene?.getScene('GameScene');
          if (!scene || !scene.gameState) return JSON.stringify(null);
          return JSON.stringify({
            battlefieldId: scene.battlefieldId,
            trainingMode: scene.trainingMode === true,
          });
        })()`
      )
    );
    if (!preCapture) throw new Error('GameScene vanished before capture');
    if (isTraining) {
      if (!preCapture.trainingMode) throw new Error('training scene replaced before capture');
    } else if (preCapture.trainingMode || preCapture.battlefieldId !== battlefieldId) {
      throw new Error(
        `scene replaced before capture: active ${preCapture.battlefieldId}, training=${preCapture.trainingMode}; requested ${battlefieldId}`
      );
    }
    if (isTraining) {
      if (!state.trainingMode) throw new Error('training scene did not enter training mode');
      if (state.trainingStep !== 'drag_to_attack') {
        throw new Error(`training scene is not on the first guided step (got ${state.trainingStep})`);
      }
      if (state.battlefieldId !== 'crown_cross') {
        throw new Error(`training battlefieldId ${state.battlefieldId} != crown_cross`);
      }
    } else {
      if (state.trainingMode) throw new Error('training scene replaced the requested bot match');
      if (state.battlefieldId !== battlefieldId) {
        throw new Error(`scene battlefieldId ${state.battlefieldId} != requested ${battlefieldId}`);
      }
    }
    if (state.missing.length > 0) {
      throw new Error(`textures failed to load: ${state.missing.join(', ')}`);
    }
    if (state.packFetches === 0 || state.visualCount !== state.territoryCount ||
        state.fullyVisibleCount !== state.territoryCount) {
      throw new Error(`incomplete battlefield render: ${JSON.stringify(state)}`);
    }
    if (state.status !== 'playing' || state.armyCount !== 0 || state.elapsed > 1.5) {
      throw new Error(`not an initial clean battlefield: ${JSON.stringify(state)}`);
    }
    const expectedPack = isTraining ? 'crown_cross' : battlefieldId;
    if (!state.textureKeys.every((key) => key.startsWith(`cc_${expectedPack}_`))) {
      throw new Error(`wrong or fallback territory pack: ${JSON.stringify(state.textureKeys)}`);
    }
    await evaluate(cdp, `(() => { window.__PHASER_GAME__.scene.pause('GameScene'); return true; })()`);

    // Clean-field capture (the primary review artifact): no armies yet,
    // canvas should match 1:1.
    const cleanShotBase64 = await captureScreenshot(cdp);
    const canvasSnapshotBase64 = await rendererSnapshot(cdp);
    const cleanComparison = await comparePhysicalToCanvas(cdp, cleanShotBase64, canvasSnapshotBase64, viewport);
    const cleanFileName = `${battlefieldId}-${viewport.width}x${viewport.height}-clean.png`;
    fs.writeFileSync(path.join(outDir, cleanFileName), Buffer.from(cleanShotBase64, 'base64'));

    if (isTraining) {
      // The training capture is the clean first step; no army dispatch
      // (training is client-local and the guided actions must not advance).
      const report = {
        file: cleanFileName,
        viewport,
        metrics: m,
        packFetches: state.packFetches,
        missingTextures: state.missing,
        cleanFieldCaptureMatchesCanvasRender: cleanComparison,
        consoleErrors,
      };
      console.log(`[capture] ${cleanFileName}: ${JSON.stringify(report)}`);
      return report;
    }

    // Marching armies for the final QA artifact.
    await evaluate(cdp, `(() => { window.__PHASER_GAME__.scene.resume('GameScene'); return true; })()`);
    await evaluate(
      cdp,
      `(() => {
        const scene = window.__PHASER_GAME__?.scene?.getScene('GameScene');
        const territories = Object.values(scene.gameState.territories);
        const playerBase = territories.find((t) => t.owner === 'player');
        const enemyBase = territories.find((t) => t.owner === 'enemy');
        const neutrals = territories.filter((t) => t.owner === 'neutral');
        const nearest = (base) => [...neutrals].sort((a, b) =>
          Math.hypot(a.x - base.x, a.y - base.y) - Math.hypot(b.x - base.x, b.y - base.y));
        nearest(playerBase).slice(0, 2).forEach((t) => scene.executeQaDispatch(playerBase.id, t.id, 'player'));
        nearest(enemyBase).slice(0, 2).forEach((t) => scene.executeQaDispatch(enemyBase.id, t.id, 'enemy'));
        return 'dispatched';
      })()`
    );
    await sleep(550);
    const marchingTeams = JSON.parse(await evaluate(cdp, `(() => {
      const scene = window.__PHASER_GAME__?.scene?.getScene('GameScene');
      return JSON.stringify([...scene.armyVisuals.keys()].map((id) => id.split(':')[0]));
    })()`));
    if (!marchingTeams.includes('player') || !marchingTeams.includes('enemy')) {
      throw new Error(`army capture has no visible march for both teams: ${JSON.stringify(marchingTeams)}`);
    }

    const finalShotBase64 = await captureScreenshot(cdp);
    const fileName = `${battlefieldId}-${viewport.width}x${viewport.height}-armies.png`;
    const outPath = path.join(outDir, fileName);
    fs.writeFileSync(outPath, Buffer.from(finalShotBase64, 'base64'));

    const report = {
      file: fileName,
      cleanFile: cleanFileName,
      viewport,
      metrics: m,
      packFetches: state.packFetches,
      missingTextures: state.missing,
      cleanFieldCaptureMatchesCanvasRender: cleanComparison,
      consoleErrors,
    };
    console.log(`[capture] ${fileName}: ${JSON.stringify(report)}`);
    return report;
  } finally {
    chrome.kill('SIGKILL');
    // QA scratch chrome profile: never enter git (qa-artifacts/chrome-* is ignored).
    fs.rmSync(profileDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  }
}

async function captureScreenshot(cdp) {
  // No clip, from the surface: exactly the emulated viewport at DPR 2.
  const res = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
  return res.data;
}

async function rendererSnapshot(cdp) {
  // Phaser renders one viewport into its canvas; snapshot it through the
  // renderer and hand it back as a data URL.
  return evaluate(
    cdp,
    `new Promise((resolve, reject) => {
      const game = window.__PHASER_GAME__;
      const timeout = setTimeout(() => reject(new Error('renderer snapshot timed out')), 8000);
      game.renderer.snapshot((image) => {
        clearTimeout(timeout);
        const canvas = document.createElement('canvas');
        canvas.width = image.width;
        canvas.height = image.height;
        canvas.getContext('2d').drawImage(image, 0, 0);
        resolve(canvas.toDataURL('image/png').split(',')[1]);
      });
    })`,
    { awaitPromise: true }
  );
}

async function comparePhysicalToCanvas(cdp, screenshotBase64, canvasSnapshotBase64, viewport) {
  // Downscale the DPR-2 page capture to the canvas snapshot's CSS size inside
  // the page and compute the mean per-channel difference. A capture that
  // contained duplicated/stitched views would disagree strongly.
  return evaluate(
    cdp,
    `new Promise((resolve, reject) => {
      const shot = new Image();
      shot.onload = () => {
        const snap = new Image();
        snap.onload = () => {
          const scale = shot.width / snap.width;
          const work = document.createElement('canvas');
          work.width = snap.width;
          work.height = snap.height;
          const ctx = work.getContext('2d');
          ctx.drawImage(shot, 0, 0, snap.width, snap.height);
          const shotData = ctx.getImageData(0, 0, snap.width, snap.height).data;

          const snapCanvas = document.createElement('canvas');
          snapCanvas.width = snap.width;
          snapCanvas.height = snap.height;
          snapCanvas.getContext('2d').drawImage(snap, 0, 0);
          const snapData = snapCanvas.getContext('2d').getImageData(0, 0, snap.width, snap.height).data;

          let total = 0;
          let count = 0;
          for (let i = 0; i < shotData.length; i += 4) {
            total += (Math.abs(shotData[i] - snapData[i])
              + Math.abs(shotData[i + 1] - snapData[i + 1])
              + Math.abs(shotData[i + 2] - snapData[i + 2])) / 765;
            count += 1;
          }
          resolve(JSON.stringify({
            captureSize: [shot.width, shot.height],
            canvasSnapshotSize: [snap.width, snap.height],
            captureIsDprScaled: shot.width === ${viewport.width} * ${viewport.dpr} && shot.height === ${viewport.height} * ${viewport.dpr},
            meanAbsDiff: Math.round((total / count) * 10000) / 10000,
          }));
        };
        snap.onerror = () => reject(new Error('snapshot image failed to decode'));
        snap.src = 'data:image/png;base64,' + '${canvasSnapshotBase64}';
      };
      shot.onerror = () => reject(new Error('screenshot image failed to decode'));
      shot.src = 'data:image/png;base64,' + '${screenshotBase64}';
    })`,
    { awaitPromise: true }
  ).then((v) => JSON.parse(v));
}

async function main() {
  const battlefieldId = process.argv[2];
  if (!battlefieldId) {
    console.error('usage: node scripts/capture-battlefield-qa.mjs <battlefieldId> [outDir]');
    process.exit(2);
  }
  const outDir = path.resolve(process.argv[3] || path.join(REPO_ROOT, 'qa-artifacts/art-twin-passes'));
  fs.mkdirSync(outDir, { recursive: true });
  const chromePath = findChrome();

  const reports = [];
  for (const viewport of VIEWPORTS) {
    reports.push(await captureViewport(chromePath, battlefieldId, viewport, outDir));
  }

  const problems = reports.flatMap((r) => [
    ...(r.missingTextures.length > 0 ? [`${r.file}: missing textures`] : []),
    ...(r.consoleErrors.length > 0 ? [`${r.file}: console errors`] : []),
    ...(r.cleanFieldCaptureMatchesCanvasRender.meanAbsDiff > 0.05
      ? [`${r.file}: capture does not match the single-viewport canvas render`]
      : []),
  ]);
  if (problems.length > 0) {
    console.error(`VISUAL CAPTURE QA FAILED:\n${problems.join('\n')}`);
    process.exit(1);
  }
  console.log(`VISUAL CAPTURE QA PASSED: ${reports.length} single-viewport captures for ${battlefieldId}.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
