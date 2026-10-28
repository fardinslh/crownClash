// Screenshots every hub scene plus a lane battle at 360x640 and 390x844 into qa-artifacts/visual-audit (CC_QA_OUT to
// change): the quick way to compare the look of all screens after a theme or kit change. Needs the dev
// server with VITE_ENABLE_LANES=true (CC_QA_APP_URL, default http://127.0.0.1:3000/) and the compose stack
// with ALLOW_GUEST_AUTH=true.
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
const out = process.env.CC_QA_OUT ?? 'qa-artifacts/visual-audit';
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
    await shot('menu');
    for (const key of ['LevelsScene', 'KingdomScene', 'LeagueScene', 'DailyScene', 'CommanderScene', 'WeeklyScene', 'RealmScene']) {
      try {
        await show(key); await sleep(2200); await shot(key);
        if (key === 'LevelsScene') {
          // A mid-campaign state: four levels cleared, the road lit up to the next node.
          await evaluate(`(()=>{const s=${game}.scene.getScene('LevelsScene');s.levelsCompleted=4;s.renderCards();return true})()`);
          await sleep(900); await shot('LevelsScene-progress');
        }
      } catch (e) { console.log(key, 'skipped', String(e).slice(0, 120)); }
    }
    await show('GameScene', `{source:'menu',lanes:{levelId:1}}`);
    await sleep(2500);
    await shot('lane-battle');
    // The PvP result card (settlement, trophies, upgrade tiles) needs a settlement; build a plausible one.
    for (const status of ['victory', 'defeat']) {
      const ok = await evaluate(`(async()=>{
        const core=await import('/@id/@crown-clash/game-core');
        const s=${game}.scene.getScene('GameScene');
        const stats={matchDurationSeconds:74,playerUnitsDispatched:61,enemyUnitsDispatched:48,territoriesCapturedByPlayer:6,territoriesCapturedByEnemy:2};
        const previous=core.createDefaultCareer('qa');
        const breakdown=core.calculateMatchRewards(${JSON.stringify(status)},stats,1,0);
        const next={...previous,coins:previous.coins+breakdown.totalCoins,trophies:Math.max(0,previous.trophies+breakdown.trophyDelta)};
        const settlement={matchId:'qa',status:${JSON.stringify(status)},breakdown,stats,previousCareer:previous,newCareer:next,previousRank:core.getRankTier(previous.trophies),newRank:core.getRankTier(next.trophies),rankPromoted:false,ledgerEntries:[]};
        s.gameState.status=${JSON.stringify(status)};
        s.renderResultModal(${JSON.stringify(status)},stats,settlement);
        return true})()`).catch((e) => String(e).slice(0, 160));
      if (ok !== true) { console.log('pvp result skipped:', ok); break; }
      await sleep(1200); await shot(`pvp-result-${status}`);
      await evaluate(`(()=>{const s=${game}.scene.getScene('GameScene');s.children.list.filter(o=>o.depth>=200).forEach(o=>o.destroy());return true})()`);
    }

    console.log('ok');
  } finally {
    try { ws?.close(); } catch {}
    chrome?.kill();
    await sleep(500);
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
  }
}
