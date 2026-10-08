import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { CdpClient, pickFreeCdpPort, waitForWebSocketOpen } from './cdp-client.mjs';
import { createQaProfile, findQaChrome, isolateQaRequests } from './qa-browser.mjs';

const appUrl = process.env.CC_QA_APP_URL ?? 'http://127.0.0.1:3000/?gameplay_lab=1';
const out = path.resolve('qa-artifacts/gameplay-lab');
fs.mkdirSync(out, { recursive: true });
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function run(width, height) {
  const port = await pickFreeCdpPort();
  const profile = createQaProfile('cc-gameplay-lab-');
  const chrome = spawn(findQaChrome(), ['--headless=new', `--remote-debugging-port=${port}`,
    '--no-sandbox', '--disable-extensions', '--autoplay-policy=no-user-gesture-required', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
  let ws;
  try {
    let tabs;
    for (let i = 0; i < 40; i++) {
      await pause(250);
      try { tabs = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); } catch { continue; }
      if (tabs.some((t) => t.type === 'page')) break;
    }
    assert.ok(tabs?.some((t) => t.type === 'page'), 'Chrome must expose a page');
    ws = new WebSocket(tabs.find((t) => t.type === 'page').webSocketDebuggerUrl);
    await waitForWebSocketOpen(ws);
    const cdp = new CdpClient(ws);
    await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
    const errors = [];
    cdp.on('Runtime.exceptionThrown', (e) => errors.push(e.exceptionDetails));
    cdp.on('Runtime.consoleAPICalled', (e) => { if (e.type === 'error') errors.push(e.args); });
    const network = await isolateQaRequests(cdp, appUrl, { allowViteModules: true });
    await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: true });
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `
      window.__labQa = { events: [], writes: [] };
      window.addEventListener('crown-clash:analytics', e => window.__labQa.events.push(e.detail));
      const originalSet = Storage.prototype.setItem;
      Storage.prototype.setItem = function(key,value) { window.__labQa.writes.push(key); return originalSet.call(this,key,value); };
    ` });
    const evaluate = async (expression) => {
      const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
      return r.result.value;
    };
    const wait = async (expression) => {
      for (let i = 0; i < 60; i++) { if (await evaluate(expression)) return; await pause(200); }
      await shot('failure');
      console.error(JSON.stringify({ errors, blocked: network.blocked, page: await evaluate('document.body.innerText') }));
      throw new Error(`Timed out: ${expression}`);
    };
    const shot = async (name) => {
      const result = await cdp.send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(out, `${width}x${height}-${name}.png`), Buffer.from(result.data, 'base64'));
    };
    await cdp.send('Page.navigate', { url: appUrl });
    if (process.env.CC_QA_EXPECT_PRODUCTION === '1') {
      await wait('Boolean(window.__PHASER_GAME__)');
      await pause(500);
      assert.equal(await evaluate("Boolean(document.querySelector('.gameplay-lab'))"), false, 'production must not open lab UI');
      assert.equal(await evaluate("window.__PHASER_GAME__.scene.isActive('MenuScene')"), true, 'production must retain its ordinary entry scene');
      assert.equal(await evaluate("Boolean(window.__PHASER_GAME__.registry.get('gameplayLabStore'))"), false);
      await shot('production-no-lab');
      await network.assertHealthy();
      console.log(`PASS ${width}x${height}: production ignores gameplay_lab=1`);
      return;
    }
    await wait(`Boolean(document.querySelector('#lab-roads'))`);
    assert.equal(await evaluate(`document.querySelector('#loading-shell')?.style.display === 'none' || !document.querySelector('#loading-shell')`), true);
    await shot('selection');
    await evaluate(`document.querySelector('#lab-roads').click()`);
    await wait(`Boolean(document.querySelector('#lab-quit') && window.__PHASER_GAME__.scene.getScene('GameScene').lab)`);
    await pause(500);
    await evaluate(`(() => {const s=window.__PHASER_GAME__.scene.getScene('GameScene');s.scene.pause();s.gameState.territories.n_bot_right.owner='player';s.gameState.territories.n_bot_right.units=40;s.updateTerritoryVisuals();})()`);
    const point = async (id) => evaluate(`(() => {
      const g=window.__PHASER_GAME__, s=g.scene.getScene('GameScene'), v=s.territoryVisuals.get(${JSON.stringify(id)}).container;
      const c=s.cameras.main, b=g.canvas.getBoundingClientRect();
      const p=c.matrixCombined.transformPoint(v.x,v.y);
      return {x:b.left+p.x*b.width/g.canvas.width,y:b.top+p.y*b.height/g.canvas.height};
    })()`);
    const source = await point('p_base'), secondSource = await point('n_bot_right'), target = await point('n_bot_left');
    // Resume for real pointer input, then pause again to keep screenshots reproducible.
    await evaluate(`window.__PHASER_GAME__.scene.getScene('GameScene').scene.resume();void 0`);
    await pause(100);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [source] });
    await pause(60);
    await wait(`window.__PHASER_GAME__.scene.getScene('GameScene').selectedSourceIds.includes('p_base')`);
    await shot('roads-targets');
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [secondSource] });
    await pause(60);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [target] });
    await pause(60);
    assert.equal(await evaluate(`window.__PHASER_GAME__.scene.getScene('GameScene').hoveredTargetId`), 'n_bot_left');
    assert.deepEqual(await evaluate(`window.__PHASER_GAME__.scene.getScene('GameScene').selectedSourceIds`), ['p_base', 'n_bot_right']);
    assert.ok(await evaluate(`window.__PHASER_GAME__.scene.getScene('GameScene').dragBadgeText.text.endsWith('(2 bases)')`), 'preview must include both sources');
    await shot('roads-preview');
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await wait(`window.__PHASER_GAME__.scene.getScene('GameScene').lab.battle.record.actions.some(a=>a.owner==='player'&&a.targetId==='n_bot_left')`);
    if (process.env.CC_LAB_QA_NEGATIVE_CONTROL === 'roads') {
      await evaluate(`(() => {const s=window.__PHASER_GAME__.scene.getScene('GameScene');s.lab.battle.state.rules.roadSpeedMultiplier=1;s.lab.battle.dispatch(['p_base'],'n_bot_left');})()`);
    }
    const roads = await evaluate(`(() => {const s=window.__PHASER_GAME__.scene.getScene('GameScene'),b=s.lab.battle;
      s.scene.pause();const a=b.state.armies.filter(a=>a.owner==='player'&&a.targetId==='n_bot_left');
      return {sources:a.map(a=>a.sourceId),bonus:a.filter(a=>a.sourceId==='p_base').at(-1)?.speed/(1/Math.max(1,Math.hypot(115,125)/140)),
        remote:b.dispatch(['p_base'],'e_base').armies.length};})()`);
    assert.deepEqual(roads.sources.slice(0, 2), ['p_base', 'n_bot_right'], 'touch multi-attack must dispatch both sources');
    assert.ok(Math.abs(roads.bonus - 1.25) < 1e-12, 'direct road must grant 25% speed bonus');
    assert.equal(roads.remote, 1, 'non-adjacent dispatch must remain available');
    await evaluate(`document.querySelector('#lab-quit').click()`);
    await wait(`Boolean(document.querySelector('#lab-retry'))`);
    await evaluate(`document.querySelector('#lab-repetition').value='2';document.querySelector('#lab-early').value='3';document.querySelector('#lab-rate').click()`);
    await shot('result');
    assert.equal(await evaluate(`window.__PHASER_GAME__.scene.getScene('GameScene').lab.trial.ratings.repetition`), 2);
    await evaluate(`document.querySelector('#lab-retry').click()`);
    await wait(`Boolean(document.querySelector('#lab-quit'))`);
    assert.equal(await evaluate(`window.__PHASER_GAME__.scene.getScene('GameScene').resultPending`), false);
    assert.ok(await evaluate(`Boolean(window.__PHASER_GAME__.scene.getScene('GameScene').lab.trial.retryOf)`));
    await evaluate(`document.querySelector('#lab-quit').click();document.querySelector('#lab-choose').click()`);
    await wait(`Boolean(document.querySelector('#lab-capture_recovery'))`);
    await evaluate(`document.querySelector('#lab-capture_recovery').click()`);
    await wait(`Boolean(document.querySelector('#lab-quit'))`);
    await pause(800);
    await evaluate(`(() => {const s=window.__PHASER_GAME__.scene.getScene('GameScene');s.scene.pause();const r=s.lab.battle.dispatch(['p_base'],'n_bot_left');if(r.armies.length!==1)throw Error('missing capture dispatch');while(s.lab.battle.state.territories.n_bot_left.owner!=='player'&&s.lab.battle.tick<200)s.lab.battle.step();s.gameState=s.lab.battle.state;s.updateTerritoryVisuals();s.updateLabIndicators();})()`);
    const capture = await evaluate(`(() => {const s=window.__PHASER_GAME__.scene.getScene('GameScene');return {owner:s.gameState.territories.n_bot_left.owner,text:s.labCountdowns.get('n_bot_left')?.text};})()`);
    assert.equal(capture.owner, 'player'); assert.equal(capture.text, 'PROD 50%\n3.0s');
    await shot('capture-countdown');
    await evaluate(`(() => {const s=window.__PHASER_GAME__.scene.getScene('GameScene');for(let i=0;i<75;i++)s.lab.battle.step();s.gameState=s.lab.battle.state;s.updateTerritoryVisuals();s.updateLabIndicators();})()`);
    assert.equal(await evaluate(`window.__PHASER_GAME__.scene.getScene('GameScene').labCountdowns.get('n_bot_left').text`), 'PROD 75%\n1.5s');
    await shot('capture-recovery');
    // Finish through the scene's real update path so automatic terminal UI and
    // persistence are verified without assigning a synthetic match result.
    const terminal = await evaluate(`(() => {
      const s=window.__PHASER_GAME__.scene.getScene('GameScene');
      let frames=0;
      while(s.gameState.status==='playing' && frames<1000)s.update(++frames*250,250);
      return {status:s.gameState.status,result:s.lab.trial.battle.result,pending:s.resultPending,frames};
    })()`);
    assert.ok(['victory','defeat','draw'].includes(terminal.status), 'scene must reach a real terminal result');
    assert.equal(terminal.result, terminal.status, 'persisted result must match the battle');
    assert.equal(terminal.pending, true, 'automatic finish must freeze the match');
    await wait(`Boolean(document.querySelector('#lab-retry'))`);
    await shot('automatic-result');
    const importFile = path.join(out, `${width}x${height}-import.json`);
    fs.writeFileSync(importFile, await evaluate(`window.__PHASER_GAME__.scene.getScene('GameScene').lab.store.exportJson()`));
    await evaluate(`document.querySelector('#lab-choose').click()`);
    await wait(`Boolean(document.querySelector('#lab-import-file'))`);
    await cdp.send('DOM.enable');
    const dom = await cdp.send('DOM.getDocument');
    const input = await cdp.send('DOM.querySelector', { nodeId: dom.root.nodeId, selector: '#lab-import-file' });
    assert.ok(input.nodeId, 'import file input must exist');
    await cdp.send('DOM.setFileInputFiles', { nodeId: input.nodeId, files: [importFile] });
    await wait(`document.querySelector('#lab-status').textContent.startsWith('Data jam shod')`);
    const evidence = await evaluate(`({events:window.__labQa.events,writes:window.__labQa.writes,data:JSON.parse(localStorage.getItem('crown_clash_gameplay_lab_v2'))})`);
    assert.deepEqual(evidence.events, [], 'lab must emit no production analytics');
    assert.ok(evidence.writes.includes('crown_clash_gameplay_lab_v2'), 'lab persistence must actually run');
    assert.deepEqual(evidence.writes.filter((key) => /career|ledger|daily|league/.test(key)), [], 'career data must not be written');
    assert.equal(evidence.data.trials.length, 3);
    assert.equal(evidence.data.trials[2].battle.result, terminal.status);
    assert.equal(evidence.data.trials[2].events[1].name, 'end');
    await network.assertHealthy(); assert.deepEqual(network.blocked, [], 'lab must not request external services');
    assert.deepEqual(errors, [], 'browser must have no runtime errors');
    fs.writeFileSync(path.join(out, `${width}x${height}-evidence.json`), JSON.stringify({ ...evidence, blocked: network.blocked }, null, 2));
    console.log(`PASS ${width}x${height}: touch multi-attack, road speed bonus, production recovery, automatic result, retry, import, isolated storage and analytics`);
  } finally {
    ws?.close(); chrome.kill();
    await pause(300); fs.rmSync(profile, { recursive: true, force: true });
  }
}

for (const [width, height] of [[360, 640], [390, 844]]) await run(width, height);
