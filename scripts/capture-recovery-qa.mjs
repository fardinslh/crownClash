import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { CdpClient, pickFreeCdpPort, waitForWebSocketOpen } from './cdp-client.mjs';
import { createQaProfile, findQaChrome, isolateQaRequests } from './qa-browser.mjs';

const appUrl = process.env.CC_QA_APP_URL ?? 'http://127.0.0.1:4180/?gameplay_lab=1';
const out = path.resolve('qa-artifacts/production-C');
fs.mkdirSync(out, { recursive: true });
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function run(width, height) {
  const port = await pickFreeCdpPort();
  const profile = createQaProfile('cc-production-C-');
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
    const errors = []; const runtimeErrors = [];
    cdp.on('Runtime.exceptionThrown', (e) => { errors.push(e.exceptionDetails); runtimeErrors.push(e.exceptionDetails); });
    cdp.on('Runtime.consoleAPICalled', (e) => { if (e.type === 'error') errors.push(e.args); });
    const network = await isolateQaRequests(cdp, appUrl, { allowViteModules: false });
    await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: true });
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `
      window.__productionCQA = { events: [], writes: [] };
      window.addEventListener('crown-clash:analytics', e => window.__productionCQA.events.push(e.detail));
      const originalSet = Storage.prototype.setItem;
      Storage.prototype.setItem = function(key,value) { window.__productionCQA.writes.push(key); return originalSet.call(this,key,value); };
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
    await wait('Boolean(window.__PHASER_GAME__)');
    assert.equal(await evaluate("window.__PHASER_GAME__.scene.isActive('MenuScene')"),true);
    assert.equal(await evaluate("Boolean(document.querySelector('.gameplay-lab'))"),false,'retired lab URL must show the normal app');
    const scene="window.__PHASER_GAME__.scene.getScene('GameScene')";
    await evaluate(`(() => {
      const game=window.__PHASER_GAME__;
      game.scene.getScene('MenuScene').startTrainingBattle=()=>{};
      game.scene.start('GameScene',{mode:'bot',botMatch:{matchId:'qa_C',battlefieldId:'crown_cross',gameplayRulesVersion:2}});
    })()`);
    await wait(`${scene}.gameState?.gameplayRulesVersion===2 && ${scene}.territoryVisuals?.size===9`);
    await pause(300);
    const point=async(id)=>evaluate(`(() => {
      const g=window.__PHASER_GAME__,s=${scene},v=s.territoryVisuals.get(${JSON.stringify(id)}).container;
      const b=g.canvas.getBoundingClientRect(),p=s.cameras.main.matrixCombined.transformPoint(v.x,v.y);
      return {x:b.left+p.x*b.width/g.canvas.width,y:b.top+p.y*b.height/g.canvas.height};
    })()`);
    const tap=async(p)=>{await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[p]});await pause(40);await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await pause(100);};
    for(const [id,owner] of [['p_base','player'],['n_bot_right','neutral'],['e_base','enemy']]){
      await tap(await point(id));
      assert.equal(await evaluate(`${scene}.inspectionId`),id);
      assert.equal(await evaluate(`${scene}.inspector.visible`),true);
      assert.match(await evaluate(`${scene}.inspectorText.text`),new RegExp(owner));
      assert.match(await evaluate(`${scene}.inspectorText.text`),/PROD .*DEF .*SPD/);
      assert.equal(await evaluate(`${scene}.matchActions.length`),0,'tap must not attack');
    }
    await shot('inspector');
    // Disposable pointer fixture, never submitted as a real match settlement.
    await evaluate(`(() => {const s=${scene};s.gameState.territories.p_base.units=40;s.gameState.territories.n_bot_right.owner='player';s.gameState.territories.n_bot_right.units=40;s.updateTerritoryVisuals();})()`);
    const source=await point('p_base'),second=await point('n_bot_right'),target=await point('n_bot_left');
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[source]});await pause(40);
    await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[second]});await pause(40);
    await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[target]});await pause(40);
    assert.deepEqual(await evaluate(`${scene}.selectedSourceIds`),['p_base','n_bot_right']);
    await shot('drag');await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await pause(80);
    assert.equal(await evaluate(`${scene}.matchActions.filter(a=>a.targetId==='n_bot_left').length`),2);
    const countdown=await evaluate(`(() => {const s=${scene};s.scene.pause();let frames=0;
      while(s.gameState.territories.n_bot_left.owner!=='player' && frames<100)s.update(++frames*20,20);
      return {owner:s.gameState.territories.n_bot_left.owner,text:s.captureCountdowns.get('n_bot_left')?.text};})()`);
    assert.equal(countdown.owner,'player');assert.equal(countdown.text,'PROD 50%\n3.0s');await shot('recovery');
    await evaluate(`(() => {const s=${scene};for(let i=0;i<150;i++)s.update(i*20,20);})()`);
    assert.equal(await evaluate(`${scene}.captureCountdowns.get('n_bot_left').visible`),false,'recovery ends at three seconds');
    // Restart an unmodified C match and let the real simulation reach its result.
    await evaluate(`(() => {const s=${scene};s.scene.restart({mode:'bot',botMatch:{matchId:'qa_C_terminal',battlefieldId:'crown_cross',gameplayRulesVersion:2}});})()`);
    await wait(`${scene}.activeMatchId==='qa_C_terminal' && ${scene}.gameState.status==='playing'`);
    const terminal=await evaluate(`(() => {const s=${scene};s.scene.pause();let n=0;while(s.gameState.status==='playing'&&n<1000)s.update(++n*250,250);return {status:s.gameState.status,elapsed:s.gameState.elapsedTimeSeconds,version:s.gameState.gameplayRulesVersion};})()`);
    assert.ok(['victory','defeat','draw'].includes(terminal.status));assert.equal(terminal.version,2);assert.ok(terminal.elapsed<=90);
    await wait(`Boolean(${scene}.resultModalContainer)`);
    await evaluate(`(() => { ${scene}.scene.resume(); return true; })()`);
    await wait(`${scene}.resultModalContainer?.visible === true && ${scene}.resultModalContainer.alpha >= .99`);
    const resultText = await evaluate(`${scene}.resultModalContainer.list.filter(child => typeof child.text === 'string').map(child => child.text).join(' | ')`);
    assert.match(resultText, /DEFEAT|VICTORY|RETRY/, 'terminal result or settlement retry must be visibly rendered');
    await shot('result');
    const evidence=await evaluate(`({events:window.__productionCQA.events,writes:window.__productionCQA.writes})`);
    assert.ok(evidence.events.some(e=>e.name==='match_start'),'production start analytics remains active');
    assert.deepEqual(evidence.writes.filter(key=>key.includes('gameplay_lab')),[],'no experiment storage may be written');
    await network.assertHealthy();assert.deepEqual(runtimeErrors,[]);
    fs.writeFileSync(path.join(out,`${width}x${height}-evidence.json`),JSON.stringify({...evidence,terminal,resultText,blocked:network.blocked,errors},null,2));
    console.log(`PASS ${width}x${height}: production C, tap, multi-select, recovery, automatic result, normal analytics, no Lab`);
  } finally {
    ws?.close(); chrome.kill();
    await pause(300); fs.rmSync(profile, { recursive: true, force: true });
  }
}

for (const [width, height] of [[360, 640], [390, 844]]) await run(width, height);
