import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { CdpClient, pickFreeCdpPort, waitForWebSocketOpen } from './cdp-client.mjs';
import { createQaProfile, findQaChrome, isolateQaRequests } from './qa-browser.mjs';

const appUrl = process.env.CC_QA_APP_URL ?? 'http://127.0.0.1:4181/?prototype=crown';
const out = path.resolve('qa-artifacts/crown-prototype');
fs.mkdirSync(out, { recursive: true });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function run(width, height) {
  const port = await pickFreeCdpPort();
  const profile = createQaProfile('cc-crown-prototype-');
  const chrome = spawn(findQaChrome(), ['--headless=new', `--remote-debugging-port=${port}`,
    '--disable-extensions', '--autoplay-policy=no-user-gesture-required', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
  let ws;
  try {
    let tabs;
    for (let i = 0; i < 50; i++) {
      await pause(200);
      try { tabs = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); } catch { continue; }
      if (tabs.some(tab => tab.type === 'page')) break;
    }
    assert.ok(tabs?.some(tab => tab.type === 'page'), 'Chrome must expose a page');
    ws = new WebSocket(tabs.find(tab => tab.type === 'page').webSocketDebuggerUrl);
    await waitForWebSocketOpen(ws);
    const cdp = new CdpClient(ws);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    const runtimeErrors = [];
    cdp.on('Runtime.exceptionThrown', event => runtimeErrors.push(event.exceptionDetails));
    const network = await isolateQaRequests(cdp, appUrl);
    await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: true });
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `
      window.__crownQA = { prototype: [], production: [], writes: [] };
      window.addEventListener('crown-clash:prototype', e => window.__crownQA.prototype.push(e.detail));
      window.addEventListener('crown-clash:analytics', e => window.__crownQA.production.push(e.detail));
      const originalSet = Storage.prototype.setItem;
      Storage.prototype.setItem = function(key,value) { window.__crownQA.writes.push(key); return originalSet.call(this,key,value); };
    ` });
    const evaluate = async expression => {
      const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
      return r.result.value;
    };
    const shot = async name => {
      const r = await cdp.send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(out, `${width}x${height}-${name}.png`), Buffer.from(r.data, 'base64'));
    };
    const wait = async expression => {
      for (let i = 0; i < 60; i++) { if (await evaluate(expression)) return; await pause(100); }
      await shot('failure');
      throw new Error(`Timed out: ${expression}; runtime errors: ${JSON.stringify(runtimeErrors)}`);
    };
    const game = 'window.__PHASER_GAME__';
    const scene = `${game}.scene.getScene('GameScene')`;
    const projectedPoint = async (sceneKey, x, y) => evaluate(`(() => {
      const g=${game},s=g.scene.getScene(${JSON.stringify(sceneKey)});
      const b=g.canvas.getBoundingClientRect(),p=s.cameras.main.matrixCombined.transformPoint(${x},${y});
      return {x:b.left+p.x*b.width/g.canvas.width,y:b.top+p.y*b.height/g.canvas.height};
    })()`);
    const towerPoint = async id => {
      const location = await evaluate(`(() => {const v=${scene}.territoryVisuals.get(${JSON.stringify(id)}).container;return {x:v.x,y:v.y};})()`);
      assert.ok(location && Number.isFinite(location.x), `visible tower ${id}`);
      return projectedPoint('GameScene', location.x, location.y);
    };
    const tap = async point => {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
      await pause(40);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    };
    const tapResult = async label => {
      const location = await evaluate(`(() => {
        const c=${scene}.resultModalContainer;
        const text=c.list.find(v=>v.text===${JSON.stringify(label)});
        if(!text) throw new Error('Missing result button: '+${JSON.stringify(label)});
        return {x:c.x+text.x,y:c.y+text.y};
      })()`);
      await tap(await projectedPoint('GameScene', location.x, location.y));
    };
    await cdp.send('Page.navigate', { url: appUrl });
    await wait(`${game}?.scene.isActive('PrototypeScene')`);
    await shot('chooser');
    // Seed an existing account in this disposable profile, then prove both
    // modes leave its serialized value untouched (including upgrades).
    await evaluate(`(() => {
      const id=${game}.registry.get('platform').getUser().id;
      window.__crownQA.careerKey='crown_clash_career_'+id;
      window.__crownQA.careerBefore=JSON.stringify({playerId:id,coins:1234,gems:7,trophies:900,
        startingGarrisonLevel:8,productionLevel:8,armySpeedLevel:8,treasuryLevel:0,
        selectedCommanderId:'vanguard',matchesPlayed:5,matchesWon:2,currentStreak:0,bestStreak:1,lastMatchTimestamp:1,tutorialCompleted:true});
      localStorage.setItem(window.__crownQA.careerKey,window.__crownQA.careerBefore);
      window.__crownQA.writes=[];
    })()`);
    const cardY = await evaluate(`(${game}.scene.getScene('PrototypeScene').scale.gameSize.height/${game}.registry.get('renderScale')-620)/2+287`);
    await tap(await projectedPoint('PrototypeScene', 200, cardY));
    await wait(`${scene}.prototypeMode==='crown' && ${scene}.territoryVisuals.size===9 && Boolean(${scene}.crownHud)`);
    assert.equal(await evaluate(`${scene}.gameState.territories.n_center.productionRate`), 0);
    assert.equal(await evaluate(`Object.values(${scene}.gameState.territories).filter(t=>t.owner==='player').length`), 2);
    assert.equal(await evaluate(`${scene}.trainingMode`), false);
    assert.equal(await evaluate(`Boolean(${scene}.careerManager)`), false);
    await pause(400);
    await shot('crown-start');

    // Use actual touch input to multi-select and attack; no action or army injection.
    const source = await towerPoint('p_base');
    const support = await towerPoint('n_bot_left');
    const target = await towerPoint('n_center');
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [source] });
    await pause(30);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [support] });
    await pause(30);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [target] });
    assert.deepEqual(await evaluate(`${scene}.selectedSourceIds`), ['p_base', 'n_bot_left']);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await wait(`${scene}.gameState.stats.playerUnitsDispatched > 0`);
    assert.equal(await evaluate(`${scene}.matchActions.length`), 0, 'prototype actions never enter settlement replay');
    await wait(`${scene}.crownProgress.captures > 0`);
    await shot('crown-contested');

    // Verify the real menu stops both simulation and hold clocks.
    await evaluate(`${scene}.matchMenuController.openMenu()`);
    const paused = await evaluate(`({elapsed:${scene}.gameState.elapsedTimeSeconds,held:${scene}.crownProgress.heldMs})`);
    await pause(350);
    assert.deepEqual(await evaluate(`({elapsed:${scene}.gameState.elapsedTimeSeconds,held:${scene}.crownProgress.heldMs})`), paused);
    await shot('paused');
    await evaluate(`${scene}.matchMenuController.closeMenu()`);

    // Resize the real renderer while the objective is active; no state reset.
    const captures = await evaluate(`${scene}.crownProgress.captures`);
    await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: height + 60, deviceScaleFactor: 2, mobile: true });
    await pause(350);
    assert.equal(await evaluate(`${scene}.prototypeMode`), 'crown');
    assert.ok(await evaluate(`${scene}.crownProgress.captures`) >= captures);
    await shot('resized');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: true });
    await pause(350);

    // Accelerate only the clock, through the actual GameScene update loop.
    const terminal = await evaluate(`(() => {const s=${scene};s.scene.pause();let ticks=0;
      while(s.gameState.status==='playing'&&ticks++<4501)s.update(ticks*20,20);
      s.scene.resume();return {status:s.gameState.status,time:s.gameState.elapsedTimeSeconds,held:s.crownProgress.heldMs,captures:s.crownProgress.captures};})()`);
    assert.ok(['victory', 'defeat', 'draw'].includes(terminal.status));
    if (terminal.status !== 'draw') assert.equal(terminal.held, 12000);
    else assert.equal(terminal.time, 90);
    await wait(`Boolean(${scene}.resultModalContainer?.visible)`);
    await pause(100);
    await shot('crown-result');
    const matchId = await evaluate(`${scene}.activeMatchId`);
    const ends = await evaluate(`window.__crownQA.prototype.filter(e=>e.matchId===${JSON.stringify(matchId)}&&e.name==='prototype_end')`);
    assert.equal(ends.length, 1);
    assert.equal(ends[0].result, terminal.status);
    await tapResult('PLAY AGAIN');
    await wait(`${scene}.activeMatchId!==${JSON.stringify(matchId)} && ${scene}.prototypeMode==='crown' && ${scene}.gameState.status==='playing'`);
    assert.equal(await evaluate(`${scene}.crownProgress.captures`), 0);
    assert.equal(await evaluate(`${scene}.crownProgress.heldMs`), 0);
    assert.equal(await evaluate(`${scene}.matchMenuController.isPaused()`), false);

    // Let an untouched rematch end naturally, then select the comparison button.
    await evaluate(`(() => {const s=${scene};s.scene.pause();for(let i=0;i<1000&&s.gameState.status==='playing';i++)s.update(i*20,20);s.scene.resume();})()`);
    await wait(`Boolean(${scene}.resultModalContainer?.visible)`);
    assert.equal(await evaluate(`${scene}.gameState.status`), 'defeat');
    await pause(100);
    await tapResult('COMPARE WITH CLASSIC');
    await wait(`${scene}.prototypeMode==='classic' && ${scene}.gameState.status==='playing'`);
    assert.equal(await evaluate(`${scene}.gameState.territories.n_center.productionRate`), 1.1);
    assert.equal(await evaluate(`Object.values(${scene}.gameState.territories).filter(t=>t.owner==='player').length`), 1);
    assert.equal(await evaluate(`Boolean(${scene}.crownHud)`), false);
    await pause(400);
    await shot('classic');
    await evaluate(`(() => {const s=${scene};s.scene.pause();for(let i=0;i<4501&&s.gameState.status==='playing';i++)s.update(i*20,20);s.scene.resume();})()`);
    await wait(`Boolean(${scene}.resultModalContainer?.visible)`);
    await pause(100);
    await shot('classic-result');
    await tapResult('CHOOSE MODE');
    await wait(`${game}.scene.isActive('PrototypeScene')`);
    // Entry works again after leaving (including input plugin restart).
    await tap(await projectedPoint('PrototypeScene', 200, cardY));
    await wait(`${scene}.prototypeMode==='crown' && ${scene}.gameState.status==='playing'`);
    await evaluate(`${scene}.matchMenuController.openConfirm()`);
    await evaluate(`${scene}.matchMenuController.confirmExit()`);
    await wait(`${game}.scene.isActive('PrototypeScene')`);

    const evidence = await evaluate(`({events:window.__crownQA,careerAfter:localStorage.getItem(window.__crownQA.careerKey)})`);
    assert.equal(evidence.careerAfter, evidence.events.careerBefore);
    assert.deepEqual(evidence.events.writes.filter(key => /career|ledger|daily|league|training/.test(key)), []);
    assert.deepEqual(evidence.events.production.filter(e => /^(match_|tutorial_|rank_)/.test(e.name)), []);
    assert.ok(evidence.events.prototype.some(e => e.name === 'prototype_quit'));
    assert.ok(evidence.events.prototype.some(e => e.name === 'prototype_start' && e.source === 'rematch'));
    assert.ok(evidence.events.prototype.some(e => e.name === 'prototype_start' && e.source === 'compare' && e.mode === 'classic'));
    await network.assertHealthy();
    assert.deepEqual(network.blocked.filter(request => request.method !== 'GET' || /\/v2\/|\/api\//.test(request.url)), [], 'no auth, ticket or settlement requests');
    assert.deepEqual(runtimeErrors, []);
    fs.writeFileSync(path.join(out, `${width}x${height}-evidence.json`), JSON.stringify({ ...evidence, terminal, blocked: network.blocked, runtimeErrors }, null, 2));
    console.log(`PASS ${width}x${height}: touch multi-select, crown hold, pause, resize, result, rematch, classic comparison, quit, no economy/production events`);
  } finally {
    ws?.close();
    chrome.kill();
    await pause(300);
    fs.rmSync(profile, { recursive: true, force: true });
  }
}

for (const [width, height] of [[360, 640], [390, 844]]) await run(width, height);
