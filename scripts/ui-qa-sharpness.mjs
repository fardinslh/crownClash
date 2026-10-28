// Sharpness and FPS baseline for the render tiers: boots a lane battle in headless Chrome at device pixel ratio
// 1, 2 and 3 (CC_QA_DPRS) on a 390x844 viewport, prints the canvas backing size against the physical size it is
// shown at (upscale 1.00 = pixel perfect), saves screenshots to qa-artifacts/sharpness and samples FPS for 8 s.
// Needs the dev server with VITE_ENABLE_LANES=true (CC_QA_APP_URL, default http://127.0.0.1:3000/) and the compose
// stack with ALLOW_GUEST_AUTH=true. Headless FPS is a relative number, not a phone number.
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
const out = process.env.CC_QA_OUT ?? 'qa-artifacts/sharpness';
fs.mkdirSync(out, { recursive: true });
const key = fs.readFileSync('.env', 'utf8').match(/^NAKAMA_SERVER_KEY=(.*)$/m)?.[1]?.replace(/^['"]|['"]$/g, '') ?? 'defaultkey';
const client = new Client(key, '127.0.0.1', '7350', false);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const game = 'window.__PHASER_GAME__';

for (const dpr of (process.env.CC_QA_DPRS ?? '1,2,3').split(',').map(Number)) {
  const [width, height] = [390, 844];
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
    await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: dpr, mobile: true });
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
    const evaluate = async (expression) => {
      const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails));
      return r.result.value;
    };
    const shot = async (name) => { const r = await cdp.send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(out, `dpr${dpr}-${name}.png`), Buffer.from(r.data, 'base64')); };
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
    for (const [k, v] of new URLSearchParams(process.env.CC_QA_QUERY ?? '')) url.searchParams.set(k, v);
    await cdp.send('Page.navigate', { url: url.toString() });
    await wait(`${game}?.scene.isActive('MenuScene')`);
    await sleep(1200);
    await show('GameScene', `{source:'menu',lanes:{levelId:1}}`);
    await wait(`${game}.scene.isActive('GameScene') && ${game}.scene.getScene('GameScene').laneRuntime`);
    await sleep(2500);
    const info = await evaluate(`(()=>{const g=${game};const c=g.canvas;const r=c.getBoundingClientRect();return {tier:g.registry.get('renderTier')??null,renderScale:g.registry.get('renderScale'),backing:[c.width,c.height],cssSize:[Math.round(r.width),Math.round(r.height)],devicePixelRatio:window.devicePixelRatio,renderer:g.renderer.type===2?'WebGL':'Canvas',assetTier:g.registry.get('assetTier')??null,hdFiles:performance.getEntriesByType('resource').filter(r=>r.name.includes('/assets/hd/')).length,failedFiles:performance.getEntriesByType('resource').filter(r=>r.name.includes('/assets/')&&r.responseStatus>=400).map(r=>r.name)}})()`);
    const physical = info.cssSize[0] * dpr;
    await shot('battle');
    // CC_QA_EVAL: JS run in the page before an extra screenshot (e.g. to try camera filter values live).
    if (process.env.CC_QA_EVAL) { await evaluate(process.env.CC_QA_EVAL); await sleep(600); await shot('battle-eval'); }
    const fps = await evaluate(`new Promise((resolve)=>{const g=${game};const s=[];const t=setInterval(()=>s.push(g.loop.actualFps),250);setTimeout(()=>{clearInterval(t);resolve(Math.round(s.reduce((a,b)=>a+b,0)/Math.max(1,s.length)))},8000)})`);
    console.log(`dpr ${dpr}: ${JSON.stringify(info)} physicalWidth=${physical} upscale=${(physical / info.backing[0]).toFixed(2)} fps~${fps}`);
    assert.deepEqual(errors, [], `no page errors at dpr ${dpr}`);
  } finally {
    try { ws?.close(); } catch {}
    chrome?.kill();
    await sleep(500);
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
  }
}
