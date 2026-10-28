// Visual check of the Levels screen (with the Weekly Challenge button), the
// Weekly Challenge hub and the weekly/level result cards at 360x640 and 390x844.
// Needs the dev server (CC_QA_APP_URL, default http://localhost:5173/) and the
// compose stack with ALLOW_GUEST_AUTH=true. Screenshots go to qa-artifacts/weekly.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { Client } from '@heroiclabs/nakama-js';
import { CdpClient, pickFreeCdpPort, waitForWebSocketOpen } from './cdp-client.mjs';
import { assertLocalQaUrl, createQaProfile, findQaChrome } from './qa-browser.mjs';

const appUrl = process.env.CC_QA_APP_URL ?? 'http://localhost:5173/';
assertLocalQaUrl(appUrl);
const out = 'qa-artifacts/weekly';
fs.mkdirSync(out, { recursive: true });
const key = fs.readFileSync('.env', 'utf8').match(/^NAKAMA_SERVER_KEY=(.*)$/m)?.[1]?.replace(/^['"]|['"]$/g, '') ?? 'defaultkey';
const client = new Client(key, '127.0.0.1', '7350', false);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const game = 'window.__PHASER_GAME__';

for (const [width, height] of [[360, 640], [390, 844]]) {
  const profile = createQaProfile('cc-weekly-qa-');
  let chrome, ws;
  try {
    const external = `weekly_qa_${randomUUID()}`, username = `WQ${randomUUID().replaceAll('-', '').slice(0, 10)}`;
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
    const evaluate = async (expression) => {
      const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails));
      return r.result.value;
    };
    const shot = async (name) => { const r = await cdp.send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(out, `${width}x${height}-${name}.png`), Buffer.from(r.data, 'base64')); };
    const wait = async (expression, attempts = 150) => { for (let i = 0; i < attempts; i++) { if (await evaluate(expression)) return; await sleep(100); } await shot('timeout'); throw Error(`Timed out: ${expression}; ${JSON.stringify(errors)}`); };
    const show = async (sceneKey, data = 'undefined') => evaluate(`(async()=>{const g=${game};const m=await import('/src/scenes/lazyScenes.ts');await m.ensureSceneRegistered(g.scene,${JSON.stringify(sceneKey)});for(const s of g.scene.getScenes(true))g.scene.stop(s.scene.key);g.scene.start(${JSON.stringify(sceneKey)},${data});return true})()`);
    const sceneTexts = (key) => evaluate(`${game}.scene.getScene(${JSON.stringify(key)}).children.list.flatMap(function f(o){return o.list?o.list.flatMap(f):[o]}).filter(o=>typeof o.text==='string').map(o=>o.text)`);

    const url = new URL(appUrl); url.searchParams.set('user_id', external); url.searchParams.set('username', username);
    await cdp.send('Page.navigate', { url: url.toString() });
    await wait(`${game}?.scene.isActive('MenuScene')`);
    await sleep(1500);

    await show('LevelsScene');
    await wait(`${game}.scene.isActive('LevelsScene') && ${game}.scene.getScene('LevelsScene').loaded`);
    await sleep(700);
    await shot('levels');
    const levelTexts = await sceneTexts('LevelsScene');
    assert.ok(levelTexts.some((t) => t.includes('250')), 'the weekly button shows its 250 coin ceiling');

    await show('WeeklyScene');
    await wait(`${game}.scene.isActive('WeeklyScene') && ${game}.scene.getScene('WeeklyScene').state`);
    await sleep(700);
    await shot('weekly');
    const weeklyTexts = await sceneTexts('WeeklyScene');
    for (const reward of ['+50', '+80', '+120']) assert.ok(weeklyTexts.some((t) => t.includes(reward)), `weekly hub lists ${reward}`);

    const launch = JSON.stringify(await evaluate(`(()=>{const s=${game}.scene.getScene('WeeklyScene').state;const x=s.slots[1];return{weekIndex:s.weekIndex,slot:x.slot,battlefieldId:x.battlefieldId,botDifficulty:x.botDifficulty,enemy:x.enemy,coinReward:x.coinReward}})()`));
    await show('GameScene', `{source:'menu',weekly:${launch}}`);
    await wait(`${game}.scene.isActive('GameScene') && ${game}.scene.getScene('GameScene').gameState`);
    await sleep(800);
    await shot('weekly-battle');
    await evaluate(`(()=>{const s=${game}.scene.getScene('GameScene');s.introHolding=false;s.gameState.status='victory';s.renderLevelResultModal(s.levelDef,'victory',true,80);return true})()`);
    await sleep(500);
    await shot('weekly-result-reward');
    await evaluate(`(()=>{const s=${game}.scene.getScene('GameScene');s.resultModalContainer?.destroy();s.resultModalContainer=undefined;s.weeklyNote='x';s.renderLevelResultModal(s.levelDef,'victory',true,0);return true})()`);
    await sleep(500);
    await shot('weekly-result-no-reward');
    await show('GameScene', `{source:'menu',levelId:1}`);
    await wait(`${game}.scene.isActive('GameScene') && ${game}.scene.getScene('GameScene').gameState`);
    await sleep(800);
    await evaluate(`(()=>{const s=${game}.scene.getScene('GameScene');s.introHolding=false;s.gameState.status='victory';s.renderLevelResultModal(s.levelDef,'victory',true,25);return true})()`);
    await sleep(500);
    await shot('level-result-reward');
    assert.deepEqual(errors, [], `no page errors at ${width}x${height}`);
    console.log(`${width}x${height}: ok`);
  } finally {
    try { ws?.close(); } catch {}
    chrome?.kill();
    await sleep(500);
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* the OS temp cleaner removes a profile Chrome still holds */ }
  }
}
