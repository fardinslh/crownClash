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
import { createQaProfile, findQaChrome, isolateQaRequests } from './qa-browser.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const APP_URL = process.env.CC_QA_APP_URL || 'http://127.0.0.1:4173/?benchmark_mode=1';
const ALL_BATTLEFIELDS = ['crown_cross', 'twin_passes', 'royal_ring', 'quad_citadel'];
const ONLY_BATTLEFIELD = process.env.CC_QA_BATTLEFIELD_ID;
if (ONLY_BATTLEFIELD && !ALL_BATTLEFIELDS.includes(ONLY_BATTLEFIELD)) throw new Error('Unknown QA battlefield');
const BATTLEFIELDS = ONLY_BATTLEFIELD ? [ONLY_BATTLEFIELD] : ALL_BATTLEFIELDS;
const VERIFY_RESIZE = process.env.CC_QA_RESIZE === '1';
const VIEWPORT = VERIFY_RESIZE ? { width: 375, height: 667, dpr: 2 } : { width: 360, height: 800, dpr: 2 };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function evaluate(cdp, expression, { awaitPromise = false } = {}) {
  const res = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise });
  if (res.exceptionDetails) {
    throw new Error(`page eval failed: ${JSON.stringify(res.exceptionDetails)}`);
  }
  return res.result?.value;
}

async function verifyLiveResize(cdp, battlefieldId, outDir) {
  const source = await evaluate(cdp, `(() => {
    const scene=window.__PHASER_GAME__.scene.getScene('GameScene');
    if (!scene.hasGroundPlate || !scene.textures.exists('cc_ground_'+scene.battlefieldId)) throw new Error('Resize requires a loaded ground plate');
    const t=Object.values(scene.gameState.territories).find(t=>t.owner==='player' && t.units>1);
    if (!t) throw new Error('Resize requires a selectable player territory');
    const rect=scene.sys.game.canvas.getBoundingClientRect();
    const p=scene.boardLayout.project(t.x,t.y), q=scene.cameras.main.matrix.transformPoint(p.u,p.v);
    window.__qaResizeSourceId=t.id;
    window.__qaResizeVisualCount=scene.territoryVisuals.size;
    window.__qaResizePropCount=scene.arenaVisuals.filter(v=>v.texture?.key?.startsWith('cc_prop_')).length;
    return {x:rect.left+q.x*rect.width/scene.sys.game.canvas.width,y:rect.top+q.y*rect.height/scene.sys.game.canvas.height};
  })()`);
  await cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',buttons:1,clickCount:1,...source});
  await sleep(100);
  const frames=[];
  for (const viewport of [VIEWPORT,{width:390,height:844,dpr:2},VIEWPORT]) {
    await cdp.send('Emulation.setDeviceMetricsOverride',{width:viewport.width,height:viewport.height,deviceScaleFactor:viewport.dpr,mobile:true});
    await sleep(700);
    const state=await evaluate(cdp, `(() => {
      const scene=window.__PHASER_GAME__.scene.getScene('GameScene');
      const selected=window.__qaResizeSourceId, errors=[];
      const ring=scene.selectionRings.get(selected);
      if (!scene.hasGroundPlate || !scene.textures.exists('cc_ground_'+scene.battlefieldId)) errors.push('ground missing');
      if (!scene.selectedSourceIds.includes(selected) || !ring?.visible) errors.push('selection lost');
      if (scene.territoryVisuals.size!==window.__qaResizeVisualCount) errors.push('territory visual count changed');
      const props=scene.arenaVisuals.filter(v=>v.texture?.key?.startsWith('cc_prop_')).length;
      if (props!==window.__qaResizePropCount) errors.push('prop count changed');
      for (const [id,vis] of scene.territoryVisuals) {
        const t=scene.gameState.territories[id], p=scene.boardLayout.project(t.x,t.y), lifted=scene.projectSocketPoint(t.x,t.y);
        const world=scene.boardLayout.unproject(p.u,p.v);
        if (Math.hypot(vis.container.x-lifted.u,vis.container.y-lifted.v)>0.001 || !(lifted.v<p.v)) errors.push(id+': socket anchor');
        if (Math.hypot(world.x-t.x,world.y-t.y)>0.001) errors.push(id+': touch projection roundtrip');
        const hit=scene.getTerritoryUnderPointer({positionToCamera:(_camera,out)=>out.set(p.u,p.v)});
        if (hit?.id!==id) errors.push(id+': production pointer hit test');
        if (vis.ring.lineWidth!==2 || Math.abs(vis.ring.fillAlpha-0.06)>0.0001 || vis.basePlate.strokeAlpha!==0) errors.push(id+': owner ring style');
        if (id===selected && (Math.hypot(ring.x-lifted.u,ring.y-lifted.v)>0.001)) errors.push(id+': selection anchor');
      }
      const rect=scene.sys.game.canvas.getBoundingClientRect();
      if (Math.abs(rect.width-innerWidth)>1 || Math.abs(rect.height-innerHeight)>1) errors.push('canvas does not fit resized viewport');
      return {errors,viewport:{width:innerWidth,height:innerHeight},visibleHeight:scene.lastAppliedViewport.height,
        territoryCount:scene.territoryVisuals.size,propCount:props,selectedSource:selected};
    })()`);
    if (state.errors.length || state.viewport.width!==viewport.width || state.viewport.height!==viewport.height) throw new Error('Live resize failed: '+JSON.stringify(state));
    const file=`${battlefieldId}-${viewport.width}x${viewport.height}-resize-${frames.length}.png`;
    const shot=await cdp.send('Page.captureScreenshot',{format:'png',fromSurface:true});
    fs.writeFileSync(path.join(outDir,file),Buffer.from(shot.data,'base64'));
    frames.push({...state,file});
  }
  return frames;
}

async function captureBattlefield(battlefieldId, outDir) {
  const cdpPort = 9500 + Math.floor(Math.random() * 300);
  const profileDir = createQaProfile('cc-map-ownership-');
  const chrome = spawn(findQaChrome(), [
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
    const networkIsolation = await isolateQaRequests(cdp, APP_URL, { missingAsset: process.env.CC_QA_MISSING_ASSET });

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
      const game=window.__PHASER_GAME__;
      game.registry.set('trainingLaunchedThisSession', true);
      game.scene.getScene('MenuScene').startTrainingBattle=()=>{};
      return true;
    })()`);

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
          playerVisualsCorrect: playerFlips.every(id => scene.territoryVisuals.get(id)?.sprite.texture.key.endsWith('_player')),
          enemyVisualsCorrect: enemyFlips.every(id => scene.territoryVisuals.get(id)?.sprite.texture.key.endsWith('_enemy')),
        });
      })()`));
      if (flips.playerFlips.length > 0 && flips.enemyFlips.length > 0) break;
    }

    const shot = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
    const fileName = `${battlefieldId}-${VIEWPORT.width}x${VIEWPORT.height}-ownership-change.png`;
    const outPath = path.join(outDir, fileName);
    fs.writeFileSync(outPath, Buffer.from(shot.data, 'base64'));

    const report = {
      file: fileName,
      playerFlips: flips.playerFlips,
      enemyFlips: flips.enemyFlips,
      missingTextures: flips.missing,
      playerVisualsCorrect: flips.playerVisualsCorrect,
      enemyVisualsCorrect: flips.enemyVisualsCorrect,
      consoleErrors: consoleErrors.length,
      liveResizeFrames: VERIFY_RESIZE ? await verifyLiveResize(cdp,battlefieldId,outDir) : undefined,
    };
    console.log(`[ownership] ${fileName}: ${JSON.stringify(report)}`);

    const problems = [];
    if (flips.playerFlips.length === 0) problems.push('no neutral flipped to player');
    if (flips.enemyFlips.length === 0) problems.push('no neutral flipped to enemy');
    if (!flips.playerVisualsCorrect || !flips.enemyVisualsCorrect) problems.push('ownership changed without matching rendered textures');
    if (flips.missing.length > 0) problems.push(`missing textures: ${flips.missing.join(',')}`);
    if (consoleErrors.length > 0) problems.push(`console errors: ${consoleErrors.slice(0, 3).join(' | ')}`);
    await networkIsolation.assertHealthy();
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
  fs.writeFileSync(path.join(outDir, 'ownership-report.json'), JSON.stringify(results, null, 2));
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
