// Visual and gesture check of lane battles (candidate rules v5) at 360x640 and 390x844:
// drag from the base opens a lane, soldiers stream, a swipe cuts it, the result card shows.
// Needs the dev server started with VITE_ENABLE_LANES=true (CC_QA_APP_URL, default
// http://127.0.0.1:3000/) and the compose stack with ALLOW_GUEST_AUTH=true. Screenshots: qa-artifacts/lanes.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { Client } from '@heroiclabs/nakama-js';
import { CdpClient, pickFreeCdpPort, waitForWebSocketOpen } from './cdp-client.mjs';
import { assertLocalQaUrl, createQaProfile, findQaChrome } from './qa-browser.mjs';

const appUrl = process.env.CC_QA_APP_URL ?? 'http://127.0.0.1:3000/';
assertLocalQaUrl(appUrl);
const out = 'qa-artifacts/lanes';
fs.mkdirSync(out, { recursive: true });
const key = fs.readFileSync('.env', 'utf8').match(/^NAKAMA_SERVER_KEY=(.*)$/m)?.[1]?.replace(/^['"]|['"]$/g, '') ?? 'defaultkey';
const client = new Client(key, '127.0.0.1', '7350', false);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const game = 'window.__PHASER_GAME__';

for (const [width, height] of [[360, 640], [390, 844]]) {
  const profile = createQaProfile('cc-lanes-qa-');
  let chrome, ws;
  try {
    const external = `lanes_qa_${randomUUID()}`, username = `LQ${randomUUID().replaceAll('-', '').slice(0, 10)}`;
    const session = await client.authenticateCustom(`browser:${external}`, true, username, { platform: 'browser', init_data: `user_id=${external}&username=${username}` });
    await client.rpc(session, 'career/get', {});
    await client.rpc(session, 'tutorial/complete', {});
    const port = await pickFreeCdpPort();
    chrome = spawn(findQaChrome(), ['--headless=new', `--remote-debugging-port=${port}`, '--disable-extensions', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
    let tabs;
    for (let i = 0; i < 60; i++) { await sleep(100); try { tabs = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); } catch { continue; } if (tabs.some((t) => t.type === 'page')) break; }
    ws = new WebSocket(tabs.find((t) => t.type === 'page').webSocketDebuggerUrl);
    await waitForWebSocketOpen(ws);
    const cdp = new CdpClient(ws);
    await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
    const errors = [];
    cdp.on('Runtime.exceptionThrown', (e) => errors.push(e.exceptionDetails?.exception?.description ?? e.exceptionDetails?.text));
    await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: true });
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
    const evaluate = async (expression) => {
      const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails));
      return r.result.value;
    };
    const shot = async (name) => { const r = await cdp.send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(out, `${width}x${height}-${name}.png`), Buffer.from(r.data, 'base64')); };
    const wait = async (expression, attempts = 150) => { for (let i = 0; i < attempts; i++) { if (await evaluate(expression)) return; await sleep(100); } await shot('timeout'); throw Error(`Timed out: ${expression}; ${JSON.stringify(errors)}`); };
    const show = (sceneKey, data = 'undefined') => evaluate(`(async()=>{const g=${game};const m=await import('/src/scenes/lazyScenes.ts');await m.ensureSceneRegistered(g.scene,${JSON.stringify(sceneKey)});for(const s of g.scene.getScenes(true))g.scene.stop(s.scene.key);g.scene.start(${JSON.stringify(sceneKey)},${data});return true})()`);
    // Screen position of a flat world point in the GameScene.
    const screen = (x, y) => evaluate(`(()=>{const g=${game},s=g.scene.getScene('GameScene'),p=s.projectSocketPoint(${x},${y}),b=g.canvas.getBoundingClientRect(),c=s.cameras.main.matrixCombined.transformPoint(p.u,p.v);return{x:b.x+c.x*b.width/g.canvas.width,y:b.y+c.y*b.height/g.canvas.height}})()`);
    const touch = async (points) => {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [points[0]] });
      for (const p of points.slice(1)) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [p] }); await sleep(30); }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    };
    const line = (a, b, n = 10) => Array.from({ length: n + 1 }, (_, i) => ({ x: a.x + (b.x - a.x) * i / n, y: a.y + (b.y - a.y) * i / n }));

    const url = new URL(appUrl); url.searchParams.set('user_id', external); url.searchParams.set('username', username);
    await cdp.send('Page.navigate', { url: url.toString() });
    await wait(`${game}?.scene.isActive('MenuScene')`);
    await sleep(1200);
    await show('LevelsScene');
    await wait(`${game}.scene.isActive('LevelsScene') && ${game}.scene.getScene('LevelsScene').loaded`);
    await sleep(600);
    await shot('levels-with-lane-button');

    await show('GameScene', `{source:'menu',lanes:{levelId:1}}`);
    await wait(`${game}.scene.isActive('GameScene') && ${game}.scene.getScene('GameScene').laneRuntime`);
    await evaluate(`(()=>{const s=${game}.scene.getScene('GameScene');s.introHolding=false;s.gameState.territories.p_base.units=30;return true})()`);
    await sleep(500);
    await shot('battle-start');

    const base = await evaluate(`(()=>{const t=${game}.scene.getScene('GameScene').gameState.territories;return{x:t.p_base.x,y:t.p_base.y,tx:t.n_bot_left.x,ty:t.n_bot_left.y}})()`);
    const from = await screen(base.x, base.y), to = await screen(base.tx, base.ty);
    await touch(line(from, to));
    await sleep(2500);
    await shot('lane-streaming');
    const lanes = await evaluate(`(()=>{const r=${game}.scene.getScene('GameScene').laneRuntime.lanes;return{lanes:r.lanes.filter(l=>l.owner==='player').length,soldiers:r.soldiers.length}})()`);
    assert.ok(lanes.lanes >= 1, 'the drag opened a player lane');
    assert.ok(lanes.soldiers >= 1, 'soldiers are streaming');

    // Swipe across the middle of the lane, starting and ending off the towers.
    const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
    const dx = (to.y - from.y) * 0.3, dy = -(to.x - from.x) * 0.3;
    await touch(line({ x: mid.x + dx, y: mid.y + dy }, { x: mid.x - dx, y: mid.y - dy }, 8));
    await sleep(500);
    await shot('lane-cut');
    const after = await evaluate(`${game}.scene.getScene('GameScene').laneRuntime.lanes.lanes.filter(l=>l.owner==='player'&&l.sourceId==='p_base'&&l.targetId==='n_bot_left').length`);
    assert.equal(after, 0, 'the swipe cut the lane');

    await evaluate(`(()=>{const s=${game}.scene.getScene('GameScene');s.gameState.status='victory';s.renderLevelResultModal(s.levelDef,'victory',true,0);return true})()`);
    await sleep(500);
    await shot('result');
    await evaluate(`(()=>{const s=${game}.scene.getScene('GameScene');s.gameState.status='defeat';s.renderLevelResultModal(s.levelDef,'defeat',true,0);return true})()`);
    await sleep(500);
    await shot('result-defeat');
    assert.deepEqual(errors, [], `no page errors at ${width}x${height}`);
    console.log(`${width}x${height}: ok`);
  } finally {
    try { ws?.close(); } catch {}
    chrome?.kill();
    await sleep(500);
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* temp cleaner removes it */ }
  }
}
