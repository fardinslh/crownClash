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
// CC_QA_TRAINING_ACTIONS=1 also exercises a real drag; add
// CC_QA_TRAINING_COMPLETION=1 for bounded save/retry and scene-transition QA.
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
import { createQaProfile, findQaChrome, isolateQaRequests } from './qa-browser.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const APP_URL = process.env.CC_QA_APP_URL || 'http://localhost:3000/?benchmark_mode=1';
const MISSING_ASSET = process.env.CC_QA_MISSING_ASSET;
const EXPECT_FALLBACK = process.env.CC_QA_EXPECT_FALLBACK === '1';
if (EXPECT_FALLBACK && !['ground', 'building', 'unit'].includes(MISSING_ASSET)) throw new Error('Fallback verification requires CC_QA_MISSING_ASSET=ground, building or unit');
const VIEWPORTS = [
  { width: 375, height: 667, dpr: 2 },
  { width: 360, height: 800, dpr: 2 },
  { width: 390, height: 844, dpr: 2 },
  { width: 430, height: 932, dpr: 2 },
];

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
  const profileDir = createQaProfile('cc-map-capture-');
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
    const networkIsolation = await isolateQaRequests(cdp, APP_URL, {
      missingAsset: MISSING_ASSET,
    });

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
    // Authentication is intentionally blocked: launch an isolated scene
    // directly instead of requiring the server-driven first-session route.
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
              groundLoaded: scene.hasGroundPlate === true && scene.textures.exists('cc_ground_' + scene.battlefieldId),
              propsLoaded: ['tree_birch','tree_apple','tree_pine','bush','grass_tuft','rock','pennant']
                .every((kind) => scene.textures.exists('cc_prop_' + kind)),
              propVisualCount: scene.arenaVisuals.filter((v) => v.texture?.key?.startsWith('cc_prop_')).length,
              totalDecodedBodyBytes: [...performance.getEntriesByType('navigation'), ...performance.getEntriesByType('resource')]
                .filter((r) => new URL(r.name).origin === location.origin)
                .reduce((sum, r) => sum + r.decodedBodySize, 0),
              totalDecodedTextureBytes: [...new Set(Object.values(scene.textures.list).flatMap((texture) => texture.source))]
                .reduce((sum, source) => sum + (Number.isFinite(source.image?.width) ? source.image.width : Math.ceil(source.width)) *
                  (Number.isFinite(source.image?.height) ? source.image.height : Math.ceil(source.height)) * 4, 0),
              mapAssetBytes: performance.getEntriesByType('resource')
                .filter((r) => ['assets/territories/','assets/grounds/','assets/environment/'].some((part) => r.name.includes(part)))
                .reduce((sum, r) => sum + r.decodedBodySize, 0),
              decodedMapTextureBytes: Object.entries(scene.textures.list)
                .filter(([key]) => key.startsWith('cc_' + scene.battlefieldId + '_') || key.startsWith('cc_ground_') || key.startsWith('cc_prop_'))
                .reduce((sum, [, texture]) => sum + texture.source.reduce((n, source) => n + source.width * source.height * 4, 0), 0),
            });
          })()`
        )
      );
      if (state && state.battlefieldId !== (isTraining ? 'crown_cross' : battlefieldId)) {
        throw new Error(`requested ${battlefieldId} but active scene is ${state.battlefieldId}`);
      }
      if (state?.missing.length && !EXPECT_FALLBACK) break;
      if (state && state.packFetches > 0 && (state.groundLoaded || (EXPECT_FALLBACK && MISSING_ASSET === 'ground')) && state.propsLoaded && state.visualCount === state.territoryCount &&
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
    if (state.missing.length > 0 && !EXPECT_FALLBACK) {
      throw new Error(`textures failed to load: ${state.missing.join(', ')}`);
    }
    if ((!state.groundLoaded && !(EXPECT_FALLBACK && MISSING_ASSET === 'ground')) || !state.propsLoaded || state.propVisualCount !== ({crown_cross:24,twin_passes:22,royal_ring:22,quad_citadel:23})[state.battlefieldId]) {
      throw new Error(`incomplete ground or prop render: ${JSON.stringify(state)}`);
    }
    await networkIsolation.assertHealthy();
    if (EXPECT_FALLBACK) {
      if (!state.missing.length) throw new Error('Expected asset failure was not exercised');
      if (MISSING_ASSET === 'ground') {
        if (state.groundLoaded || !state.missing.every(key => key.startsWith('cc_ground_'))) throw new Error('Missing ground did not use the vector fallback');
      } else if (MISSING_ASSET === 'unit') {
        if (state.missing.length !== 16 || !state.missing.every(key => key.startsWith('unit_'))) throw new Error('Missing units did not exercise the complete shared unit pack');
      } else {
        if (!state.textureKeys.some(key => key.startsWith('cc_fallback_')) || !state.missing.every(key => key.includes('citadel') || key.includes('outpost'))) throw new Error('Missing buildings did not use procedural fallbacks');
      }
    }
    if (state.packFetches === 0 || state.visualCount !== state.territoryCount ||
        state.fullyVisibleCount !== state.territoryCount) {
      throw new Error(`incomplete battlefield render: ${JSON.stringify(state)}`);
    }
    if (state.status !== 'playing' || state.armyCount !== 0 || state.elapsed > 1.5) {
      throw new Error(`not an initial clean battlefield: ${JSON.stringify(state)}`);
    }
    const expectedPack = isTraining ? 'crown_cross' : battlefieldId;
    if (!state.textureKeys.every((key) => key.startsWith(`cc_${expectedPack}_`) || (EXPECT_FALLBACK && MISSING_ASSET === 'building' && key.startsWith('cc_fallback_')))) {
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
        verifiedFallback: EXPECT_FALLBACK ? MISSING_ASSET : null,
        mapAssetBytes: state.mapAssetBytes,
        decodedMapTextureBytes: state.decodedMapTextureBytes,
        totalDecodedBodyBytes: state.totalDecodedBodyBytes,
        totalDecodedTextureBytes: state.totalDecodedTextureBytes,
        propVisualCount: state.propVisualCount,
        cleanFieldCaptureMatchesCanvasRender: cleanComparison,
        consoleErrors,
      };
      if (process.env.CC_QA_TRAINING_ACTIONS === '1') {
        report.trainingActions = await captureTrainingActions(cdp, viewport, outDir);
      }
      if (process.env.CC_QA_TRAINING_COMPLETION === '1') {
        report.trainingCompletion = await captureTrainingCompletion(cdp, viewport, outDir);
      }
      await networkIsolation.assertHealthy();
      console.log(`[capture] ${cleanFileName}: ${JSON.stringify(report)}`);
      return report;
    }

    // Exercise selection and drag through real browser input before armies.
    await evaluate(cdp, `(() => { window.__PHASER_GAME__.scene.resume('GameScene'); return true; })()`);
    const gesture = await evaluate(cdp, `(() => {
      const scene = window.__PHASER_GAME__.scene.getScene('GameScene');
      const territories = Object.values(scene.gameState.territories);
      const source = territories.find(t => t.owner === 'player');
      const target = territories.filter(t => t.owner === 'neutral')
        .sort((a,b) => Math.hypot(a.x-source.x,a.y-source.y)-Math.hypot(b.x-source.x,b.y-source.y))[0];
      const rect = document.querySelector('canvas').getBoundingClientRect();
      const camera = scene.cameras.main;
      const point = (t) => {
        const p = scene.boardLayout.project(t.x,t.y);
        const canvasPoint = camera.matrix.transformPoint(p.u,p.v);
        return {x:rect.left + canvasPoint.x * rect.width / scene.sys.game.canvas.width,
          y:rect.top + canvasPoint.y * rect.height / scene.sys.game.canvas.height};
      };
      return {sourceId:source.id,targetId:target.id,source:point(source),target:point(target)};
    })()`);
    await cdp.send('Input.dispatchMouseEvent', {type:'mousePressed',button:'left',buttons:1,clickCount:1,...gesture.source});
    await sleep(100);
    const selection = await evaluate(cdp, `(() => {
      const scene=window.__PHASER_GAME__.scene.getScene('GameScene');
      const pointer=scene.input.activePointer;
      const p=pointer.positionToCamera(scene.cameras.main);
      return {selected:scene.selectedSourceIds,visible:scene.selectionRings.get('${gesture.sourceId}')?.visible===true,
        pointer:{x:pointer.x,y:pointer.y,worldX:p.x,worldY:p.y},world:scene.boardLayout.unproject(p.x,p.y)};
    })()`);
    if (!selection.visible || !selection.selected.includes(gesture.sourceId)) throw new Error(`Real pointer selection failed: ${JSON.stringify({gesture,selection})}`);
    fs.writeFileSync(path.join(outDir, `${battlefieldId}-${viewport.width}x${viewport.height}-selection.png`), Buffer.from(await captureScreenshot(cdp),'base64'));
    await cdp.send('Input.dispatchMouseEvent', {type:'mouseMoved',button:'left',buttons:1,...gesture.target});
    await sleep(100);
    const drag = await evaluate(cdp, `(() => {
      const scene=window.__PHASER_GAME__.scene.getScene('GameScene');
      return {target:scene.hoveredTargetId,badgeVisible:scene.dragBadgeContainer.visible};
    })()`);
    if (drag.target !== gesture.targetId || !drag.badgeVisible) throw new Error(`Real pointer drag failed: ${JSON.stringify(drag)}`);
    fs.writeFileSync(path.join(outDir, `${battlefieldId}-${viewport.width}x${viewport.height}-drag.png`), Buffer.from(await captureScreenshot(cdp),'base64'));
    await cdp.send('Input.dispatchMouseEvent', {type:'mouseMoved',button:'left',buttons:1,...gesture.source});
    await cdp.send('Input.dispatchMouseEvent', {type:'mouseReleased',button:'left',buttons:0,clickCount:1,...gesture.source});
    const cancelled = await evaluate(cdp, `(() => {
      const scene=window.__PHASER_GAME__.scene.getScene('GameScene');
      return scene.selectedSourceIds.length===0 && scene.gameState.armies.length===0;
    })()`);
    if (!cancelled) throw new Error('Gesture cancellation changed the battlefield or left selection active');

    // Marching armies for the final QA artifact.
    await evaluate(
      cdp,
      `(() => {
        const scene = window.__PHASER_GAME__?.scene?.getScene('GameScene');
        const territories = Object.values(scene.gameState.territories);
        scene.executeAiTurn = () => {};
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
    let unitFallbackKeys = null;
    let badgeMotion = null;
    if (process.env.CC_QA_STABLE_BADGES === '1') {
      badgeMotion = JSON.parse(await evaluate(cdp, `(() => {
        const scene = window.__PHASER_GAME__.scene.getScene('GameScene');
        const armies = scene.gameState.armies;
        if (!armies.length) throw new Error('No marching armies for badge verification');
        const saved = armies.map(army => army.progress);
        const speeds = armies.map(army => army.speed * (army.owner === 'player'
          ? scene.playerArmySpeedMultiplier : scene.enemyArmySpeedMultiplier));
        if (!speeds.every(speed => Number.isFinite(speed) && speed > 0)) throw new Error('Invalid march speed');
        const duration = Math.max(...speeds.map((speed, i) => (.95-saved[i])/speed));
        const previous = new Map();
        let maxExtraMotionPixels = 0, samples = 0, overlapSamples = 0;
        try {
          for (let step = 0; step <= 200; step++) {
            const progress = speeds.map((speed, i) => saved[i] + step/200 * duration * speed);
            armies.forEach((army, i) => { army.progress = Math.min(.95, progress[i]); });
            scene.updateArmyVisuals(1 / 60);
            const pills = [];
            for (const [i, army] of armies.entries()) {
              if (progress[i] > .95) continue;
              const id = army.owner + ':' + army.id;
              const visual = scene.armyVisuals.get(id);
              if (!visual) throw new Error('Missing visual for ' + id);
              const point = { x: visual.container.x, y: visual.container.y,
                bx: visual.badgeBg.x, by: visual.badgeBg.y };
              const last = previous.get(id);
              if (last) {
                const extra = Math.max(0, Math.abs(point.bx-last.bx)-Math.abs(point.x-last.x),
                  Math.abs(point.by-last.by)-Math.abs(point.y-last.y));
                maxExtraMotionPixels = Math.max(maxExtraMotionPixels, extra);
                samples++;
              }
              if (visual.badgeText.y !== point.by || Math.abs(visual.badgeText.x-point.bx-7) > .000001)
                throw new Error('Count detached from its pill');
              previous.set(id, point);
              const width = visual.badgeBg.displayWidth;
              const rect = { x: point.bx-width/2, y: point.by-9, width, height:18 };
              for (const pill of pills) if (rect.x < pill.x+pill.width && rect.x+rect.width > pill.x &&
                rect.y < pill.y+pill.height && rect.y+rect.height > pill.y) overlapSamples++;
              pills.push(rect);
            }
          }
        } finally {
          armies.forEach((army, i) => { army.progress = saved[i]; });
          scene.updateArmyVisuals(0);
        }
        return JSON.stringify({ armies: armies.length, samples, maxExtraMotionPixels, overlapSamples });
      })()`));
      if (badgeMotion.samples < 400 || badgeMotion.maxExtraMotionPixels > .000001 || badgeMotion.overlapSamples > 0) {
        throw new Error(`Marching count jumped independently of its squad: ${JSON.stringify(badgeMotion)}`);
      }
    }
    if (EXPECT_FALLBACK && MISSING_ASSET === 'unit') {
      unitFallbackKeys = JSON.parse(await evaluate(cdp, `(() => {
        const scene = window.__PHASER_GAME__.scene.getScene('GameScene');
        return JSON.stringify([...scene.armyVisuals.values()].flatMap(visual =>
          [visual.leaderSprite, ...visual.followers.map(follower => follower.sprite)].map(image => ({key:image.texture.key, loaded:scene.textures.exists(image.texture.key)}))));
      })()`));
      if (!unitFallbackKeys.length || !unitFallbackKeys.every(({key, loaded}) => loaded && key.startsWith('cc_fallback_unit_')) ||
          !['leader_player', 'leader_enemy', 'follower_player', 'follower_enemy'].every(suffix => unitFallbackKeys.some(({key}) => key.endsWith(suffix)))) {
        throw new Error(`Missing troops did not render leader/follower fallbacks for both teams: ${JSON.stringify(unitFallbackKeys)}`);
      }
    }

    const finalShotBase64 = await captureScreenshot(cdp);
    const fileName = `${battlefieldId}-${viewport.width}x${viewport.height}-armies.png`;
    const outPath = path.join(outDir, fileName);
    fs.writeFileSync(outPath, Buffer.from(finalShotBase64, 'base64'));

    const report = {
      badgeMotion,
      file: fileName,
      cleanFile: cleanFileName,
      selectionFile: `${battlefieldId}-${viewport.width}x${viewport.height}-selection.png`,
      dragFile: `${battlefieldId}-${viewport.width}x${viewport.height}-drag.png`,
      verifiedGesture: { sourceId: gesture.sourceId, targetId: gesture.targetId, cancelled: true },
      unitFallbackKeys,
      viewport,
      metrics: m,
      packFetches: state.packFetches,
      missingTextures: state.missing,
      verifiedFallback: EXPECT_FALLBACK ? MISSING_ASSET : null,
      mapAssetBytes: state.mapAssetBytes,
      decodedMapTextureBytes: state.decodedMapTextureBytes,
      totalDecodedBodyBytes: state.totalDecodedBodyBytes,
      totalDecodedTextureBytes: state.totalDecodedTextureBytes,
      propVisualCount: state.propVisualCount,
      cleanFieldCaptureMatchesCanvasRender: cleanComparison,
      consoleErrors,
    };
    await networkIsolation.assertHealthy();
    console.log(`[capture] ${fileName}: ${JSON.stringify(report)}`);
    return report;
  } finally {
    chrome.kill('SIGKILL');
    // Only this run's disposable OS-temp browser profile is removed.
    fs.rmSync(profileDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  }
}

async function captureScreenshot(cdp) {
  // No clip, from the surface: exactly the emulated viewport at DPR 2.
  const res = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
  return res.data;
}

async function captureTrainingActions(cdp, viewport, outDir) {
  await evaluate(cdp, `(() => { window.__PHASER_GAME__.scene.resume('GameScene'); return true; })()`);
  const gesture = await evaluate(cdp, `(() => {
    const scene=window.__PHASER_GAME__.scene.getScene('GameScene');
    const ts=Object.values(scene.gameState.territories);
    const source=ts.filter(t=>t.owner==='player').sort((a,b)=>b.units-a.units)[0];
    const target=ts.filter(t=>t.owner==='neutral').sort((a,b)=>Math.hypot(a.x-source.x,a.y-source.y)-Math.hypot(b.x-source.x,b.y-source.y))[0];
    if (!source || !target) throw new Error('Training requires owned source and neutral target');
    const rect=scene.sys.game.canvas.getBoundingClientRect();
    const point=t=>{const p=scene.boardLayout.project(t.x,t.y),q=scene.cameras.main.matrix.transformPoint(p.u,p.v);
      return {x:rect.left+q.x*rect.width/scene.sys.game.canvas.width,y:rect.top+q.y*rect.height/scene.sys.game.canvas.height};};
    return {sourceId:source.id,targetId:target.id,source:point(source),target:point(target)};
  })()`);
  const files={};
  const save=async state=>{
    const file=`training-${viewport.width}x${viewport.height}-${state}.png`;
    fs.writeFileSync(path.join(outDir,file),Buffer.from(await captureScreenshot(cdp),'base64'));
    files[state]=file;
  };
  await cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',buttons:1,clickCount:1,...gesture.source});
  await sleep(100);
  if (!await evaluate(cdp,`window.__PHASER_GAME__.scene.getScene('GameScene').selectedSourceIds.includes('${gesture.sourceId}')`)) throw new Error('Training real pointer selection failed');
  await save('selection');
  await cdp.send('Input.dispatchMouseEvent',{type:'mouseMoved',button:'left',buttons:1,...gesture.target});
  await sleep(100);
  if (!await evaluate(cdp,`(() => {const s=window.__PHASER_GAME__.scene.getScene('GameScene');return s.hoveredTargetId==='${gesture.targetId}' && s.dragBadgeContainer.visible;})()`)) throw new Error('Training real pointer drag failed');
  await save('drag');
  await cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',buttons:0,clickCount:1,...gesture.target});
  await sleep(550);
  const result=await evaluate(cdp,`(() => {const s=window.__PHASER_GAME__.scene.getScene('GameScene');return {
    step:s.trainingController.currentStep?.id, armyCount:s.armyVisuals.size,
    keys:[...s.armyVisuals.values()].flatMap(v=>[v.leaderSprite,...v.followers.map(f=>f.sprite)].map(i=>i.texture.key))};})()`);
  if (result.step!=='preview_result' || result.armyCount<1 || !result.keys.length || !result.keys.every(k=>k.startsWith('unit_'))) throw new Error('Training dispatch/step/marching sprites failed: '+JSON.stringify(result));
  await save('armies');
  return {gesture,files,...result};
}

// Real Phaser transitions/input, with an isolated API double. No production
// account is touched. Controller hooks accelerate the remaining guided actions.
async function captureTrainingCompletion(cdp, viewport, outDir) {
  const read = () => evaluate(cdp, `(() => {
    const g=window.__PHASER_GAME__,s=g.scene.getScene('GameScene'),o=s.trainingOverlay;
    return {frame:g.loop.frame,active:s.scene.isActive(),training:s.trainingMode,
      elapsed:s.gameState.elapsedTimeSeconds,
      matchId:s.activeMatchId,completed:s.careerManager.isTutorialCompleted(),
      retry:!!o?.retryButton?.input?.enabled,subtitle:o?.celebrationSubtitle?.text,
      progress:localStorage.getItem('crown_clash_training_progress_'+s.platform.getUser().id),
      saveAttempts:window.__trainingQa.saveAttempts,starts:window.__trainingQa.starts,
      menu:g.scene.isActive('MenuScene')};
  })()`);
  const wait = async (predicate, label, timeout = 3000) => {
    const deadline = Date.now() + timeout;
    do {
      const state = await read();
      if (predicate(state)) return state;
      await sleep(100);
    } while (Date.now() < deadline);
    throw new Error(`Training completion ${label} failed: ${JSON.stringify(await read())}`);
  };
  const save = async name => {
    const file=`training-${viewport.width}x${viewport.height}-${name}.png`;
    fs.writeFileSync(path.join(outDir,file),Buffer.from(await captureScreenshot(cdp),'base64'));
    return file;
  };
  await evaluate(cdp, `(() => {
    const g=window.__PHASER_GAME__,s=g.scene.getScene('GameScene'),m=s.careerManager;
    // SceneManager.start does not stop the menu as ScenePlugin.start does.
    // Stop the explicitly launched QA menu so a pre-existing menu cannot
    // satisfy the later timeout/return assertion.
    g.scene.stop('MenuScene');
    const q=window.__trainingQa={saveAttempts:0,starts:0};
    m.remoteConnected=true;
    m.career={...m.getCareer(),tutorialCompleted:false};
    m.remoteApi={
      completeTutorial:()=>{q.saveAttempts++;return q.saveAttempts===1
        ?new Promise(resolve=>{q.finishOldSave=()=>resolve({...m.getCareer(),tutorialCompleted:true});})
        :Promise.resolve({...m.getCareer(),tutorialCompleted:true});},
      startBotMatch:()=>{q.starts++;return Promise.resolve({matchId:'qa_after_training',battlefieldId:'crown_cross'});}
    };
    g.scene.resume('GameScene');
    const c=s.trainingController;
    c.onDispatch(['p_base'],'n_bot_left');c.onPreviewShown();c.onTimerTick(2.6);
    c.onCapture('n_bot_left',true);c.onTimerTick(1.6);
    c.onDispatch(['p_base','n_bot_left'],'n_center');c.onCapture('e_base',true);
    if(!c.isCompleted)throw new Error('Guided finale did not complete');
    return true;
  })()`);
  const saving = await read();
  if (saving.progress!=='5' || saving.completed || saving.subtitle!=='TRAINING COMPLETE — SAVING…' || saving.saveAttempts!==1) {
    throw new Error('Training saving prerequisites failed: '+JSON.stringify(saving));
  }
  const savingFile=await save('saving');
  const retry=await wait(s=>s.retry,'save timeout retry',17_000);
  if(retry.completed || retry.starts!==0 || retry.progress!=='5' || retry.frame<=saving.frame || retry.elapsed!==saving.elapsed) {
    throw new Error('Training timeout must remain responsive and fail closed: '+JSON.stringify(retry));
  }
  const retryFile=await save('retry');
  await evaluate(cdp,'window.__trainingQa.finishOldSave()');
  await sleep(200);
  const late=await read();
  if(!late.retry || late.starts!==0 || late.progress!=='5' || late.elapsed!==saving.elapsed) throw new Error('Expired save navigated or lost progress');
  const point=await evaluate(cdp, `(() => {
    const s=window.__PHASER_GAME__.scene.getScene('GameScene'),p=s.trainingOverlay.retryButton;
    const rect=s.sys.game.canvas.getBoundingClientRect();
    const q=s.cameras.main.matrix.transformPoint(p.x,p.y);
    return {x:rect.left+q.x*rect.width/s.sys.game.canvas.width,y:rect.top+q.y*rect.height/s.sys.game.canvas.height};
  })()`);
  await cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',buttons:1,clickCount:1,...point});
  await cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',buttons:0,clickCount:1,...point});
  const battle=await wait(s=>s.active&&!s.training&&s.matchId==='qa_after_training','retry transition');
  if(!battle.completed || battle.progress!==null || battle.saveAttempts!==2 || battle.starts!==1) {
    throw new Error('Retry did not confirm and start exactly one match: '+JSON.stringify(battle));
  }
  await sleep(300);
  if((await read()).frame<=battle.frame) throw new Error('Phaser frame loop stopped after training restart');
  const source=await evaluate(cdp, `(() => {
    const s=window.__PHASER_GAME__.scene.getScene('GameScene'),t=s.gameState.territories.p_base;
    const p=s.boardLayout.project(t.x,t.y),q=s.cameras.main.matrix.transformPoint(p.u,p.v);
    const r=s.sys.game.canvas.getBoundingClientRect();
    return {x:r.left+q.x*r.width/s.sys.game.canvas.width,y:r.top+q.y*r.height/s.sys.game.canvas.height};
  })()`);
  await cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',buttons:1,clickCount:1,...source});
  await sleep(100);
  if(!await evaluate(cdp,"window.__PHASER_GAME__.scene.getScene('GameScene').selectedSourceIds.includes('p_base')")) {
    throw new Error('First battle input stopped after training restart');
  }
  await cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',buttons:0,clickCount:1,...source});
  const battleFile=await save('first-battle');

  let matchTimeout=null;
  if(viewport.width===375) {
    await evaluate(cdp, `(() => {
      const g=window.__PHASER_GAME__,m=g.scene.getScene('GameScene').careerManager;
      m.remoteApi.startBotMatch=()=>new Promise(resolve=>{window.__trainingQa.finishOldMatch=()=>resolve({matchId:'qa_late',battlefieldId:'crown_cross'});});
      g.scene.start('GameScene',{source:'menu',mode:'bot',training:true});return true;
    })()`);
    await wait(s=>s.active&&s.training,'second training start');
    await evaluate(cdp,"window.__PHASER_GAME__.scene.getScene('GameScene').handleTrainingCompleted()");
    await wait(s=>s.subtitle==='TRAINING COMPLETE — STARTING BATTLE…','confirmed save subtitle');
    const menu=await wait(s=>s.menu&&!s.active&&!s.training,'first match timeout menu',17_000);
    if(!menu.completed || menu.progress!==null) throw new Error('Match timeout lost confirmed training');
    await evaluate(cdp,'window.__trainingQa.finishOldMatch()');
    await sleep(300);
    const after=await read();
    if(!after.menu || after.active || after.frame<=menu.frame) throw new Error('Late match left the menu or stopped rendering');
    matchTimeout={...after,file:await save('match-timeout-menu')};
  }
  return {saving,retry,late,battle,files:{savingFile,retryFile,battleFile},matchTimeout};
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
  const chromePath = findQaChrome();

  const reports = [];
  for (const viewport of VIEWPORTS) {
    reports.push(await captureViewport(chromePath, battlefieldId, viewport, outDir));
  }
  fs.writeFileSync(path.join(outDir, 'capture-report.json'), JSON.stringify(reports, null, 2));

  const problems = reports.flatMap((r) => [
    ...(r.missingTextures.length > 0 && !r.verifiedFallback ? [`${r.file}: missing textures`] : []),
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
