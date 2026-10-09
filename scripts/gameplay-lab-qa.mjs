import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { CdpClient, pickFreeCdpPort, waitForWebSocketOpen } from './cdp-client.mjs';
import { createQaProfile, findQaChrome, isolateQaRequests } from './qa-browser.mjs';

const appUrl = process.env.CC_QA_APP_URL ?? 'http://127.0.0.1:3000/?gameplay_lab=1';
const out = path.resolve('qa-artifacts/gameplay-C');
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
    const scene = `window.__PHASER_GAME__.scene.getScene('GameScene')`;
    const store=`window.__PHASER_GAME__.registry.get('gameplayLabStore')`;
    const preReloadEvidence=[];
    const variants = ['capture_recovery'];
    await wait(`Boolean(document.querySelector('#lab-pilot'))`);
    await evaluate(`localStorage.setItem('crown_clash_gameplay_lab_v2','preserved-v2');localStorage.setItem('crown_clash_gameplay_lab_v3','preserved-v3')`);
    assert.equal(await evaluate(`document.querySelectorAll('[id^=lab-capture_recovery]').length`),1,'only C is selectable');
    await shot('selection');
    const click = async (selector) => {
      const point = await evaluate(`(() => { const b=document.querySelector(${JSON.stringify(selector)});if(!b||b.disabled)throw Error('Unavailable button '+${JSON.stringify(selector)});b.scrollIntoView({block:'center'});const r=b.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
      await cdp.send('Input.dispatchTouchEvent', {type:'touchStart',touchPoints:[point]});
      await pause(40);
      await cdp.send('Input.dispatchTouchEvent', {type:'touchEnd',touchPoints:[]});
      await pause(100);
    };
    const point = async (id) => evaluate(`(() => {
      const g=window.__PHASER_GAME__,s=${scene},v=s.territoryVisuals.get(${JSON.stringify(id)}).container;
      const b=g.canvas.getBoundingClientRect(),p=s.cameras.main.matrixCombined.transformPoint(v.x,v.y);
      return {x:b.left+p.x*b.width/g.canvas.width,y:b.top+p.y*b.height/g.canvas.height};
    })()`);
    const tap = async (p) => {
      await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[p]});await pause(40);
      await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await pause(100);
    };
    const rate = async () => evaluate(`document.querySelector('#lab-repetition').value='2';document.querySelector('#lab-early').value='3';document.querySelector('#lab-unfair').value='2';document.querySelector('#lab-rate').click()`);
    const finish = async () => {
      const result = await evaluate(`(() => {const s=${scene};s.scene.pause();let frames=0;while(s.gameState.status==='playing'&&frames<1000)s.update(++frames*250,250);return {status:s.gameState.status,result:s.lab.trial.battle.result,pending:s.resultPending};})()`);
      assert.ok(['victory','defeat','draw'].includes(result.status),'real simulation must finish');
      assert.equal(result.result,result.status);assert.equal(result.pending,true);
      await wait(`Boolean(document.querySelector('#lab-rate'))`);return result;
    };
    for (const [index,variant] of variants.entries()) {
      await click(`#lab-${variant}`);await wait(`Boolean(document.querySelector('#lab-quit'))`);await pause(250);
      await tap(await point('p_base'));
      assert.equal(await evaluate(`document.querySelector('#lab-inspector').hidden`),false,'short touch must inspect');
      assert.equal(await evaluate(`${scene}.lab.battle.record.actions.filter(a=>a.owner==='player').length`),0,'tap must not attack');
      assert.match(await evaluate(`document.querySelector('#lab-inspect').textContent`),/PROD .*DEF .*SPD/);
      await shot(`${'CDEF'[index]}-inspect`);
      await tap(await point('n_bot_right'));
      assert.match(await evaluate(`document.querySelector('#lab-inspect').textContent`),/neutral/);
      await tap(await point('e_base'));
      assert.match(await evaluate(`document.querySelector('#lab-inspect').textContent`),/enemy/);
      await tap(await point('p_base'));
      assert.equal(await evaluate(`Boolean(document.querySelector('#lab-upgrade'))`),false);
      // Controlled two-source fixture verifies real pointer selection, without claiming it is a human match.
      await evaluate(`(() => {const s=${scene};s.gameState.territories.p_base.units=40;s.gameState.territories.n_bot_right.owner='player';s.gameState.territories.n_bot_right.units=40;s.updateTerritoryVisuals();})()`);
      const source=await point('p_base'),second=await point('n_bot_right'),target=await point('n_bot_left');
      await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[source]});await pause(40);
      await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[second]});await pause(40);
      await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[target]});await pause(40);
      assert.deepEqual(await evaluate(`${scene}.selectedSourceIds`),['p_base','n_bot_right']);
      assert.equal(await evaluate(`${scene}.hoveredTargetId`),'n_bot_left');
      await shot(`${'CDEF'[index]}-drag`);
      await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await pause(80);
      assert.equal(await evaluate(`${scene}.lab.battle.record.actions.filter(a=>a.type==='dispatch'&&a.owner==='player'&&a.targetId==='n_bot_left').length`),2);
      await shot(`${'CDEF'[index]}-match`);
      if(index===0){
        const countdown=await evaluate(`(() => {const s=${scene};s.scene.pause();while(s.lab.battle.state.territories.n_bot_left.owner!=='player'&&s.lab.battle.tick<250)s.lab.battle.step();s.gameState=s.lab.battle.state;s.updateTerritoryVisuals();s.updateLabIndicators();return s.labCountdowns.get('n_bot_left')?.text;})()`);
        assert.equal(countdown,'PROD 50%\n3.0s');await shot('C-capture-recovery');
      }
      await click('#lab-quit');await wait(`Boolean(document.querySelector('#lab-rate'))`);await rate();
      if(index===0){await click('#lab-retry');await wait(`Boolean(document.querySelector('#lab-quit'))`);
        assert.equal(await evaluate(`${scene}.lab.trial.kind`),'optional');await click('#lab-quit');}
      await click('#lab-choose');await wait(`Boolean(document.querySelector('#lab-pilot'))`);
    }
    const fixtureEvidence=await evaluate(`${store}.data.trials`);
    assert.equal(fixtureEvidence.filter(t=>t.kind==='practice').length,1);
    // Controlled state fixtures are not importable engine histories or pilot data.
    await evaluate(`${store}.data.trials=[];${store}.save()`);
    // Two unmodified main matches through the scene's real terminal and persistence path.
    for(let i=0;i<2;i++){
      await click('#lab-pilot');await wait(`Boolean(document.querySelector('#lab-quit'))`);
      assert.equal(await evaluate(`${scene}.lab.trial.pilotIndex`),i);
      await finish();await rate();
      if(i===1){
        assert.ok(await evaluate(`Boolean(document.querySelector('#lab-continue')&&document.querySelector('#lab-optional'))`));
        const choices=await evaluate(`['#lab-continue','#lab-optional'].map(id=>{const b=document.querySelector(id),r=b.getBoundingClientRect();return {width:r.width,height:r.height,background:getComputedStyle(b).backgroundColor};})`);
        assert.deepEqual(choices[0],choices[1],'offer choices have equal visual weight');
        await shot(`offer-${i}`);
        if(i===1){
          preReloadEvidence.push(await evaluate(`window.__labQa`));
          await cdp.send('Page.reload');
          await wait(`Boolean(document.querySelector('#lab-optional')&&document.querySelector('#lab-pilot'))`);
          assert.equal(await evaluate(`document.querySelector('#lab-pilot').disabled`),true,'reload must preserve the unanswered offer');
          await click('#lab-optional');await wait(`Boolean(document.querySelector('#lab-quit'))`);
          assert.equal(await evaluate(`${scene}.lab.trial.kind`),'optional');await click('#lab-quit');await click('#lab-choose');}
        else await click('#lab-continue');
      }else await click('#lab-choose');
      await wait(`Boolean(document.querySelector('#lab-pilot'))`);
    }
    await evaluate(`document.querySelector('#lab-reflection').value='Test fixture: attack earlier';document.querySelector('#lab-feedback').click()`);
    const importFile=path.join(out,`${width}x${height}-import.json`);
    fs.writeFileSync(importFile,await evaluate(`${store}.exportJson()`));
    await click('#lab-export');
    await cdp.send('DOM.enable');const dom=await cdp.send('DOM.getDocument');
    const input=await cdp.send('DOM.querySelector',{nodeId:dom.root.nodeId,selector:'#lab-import-file'});
    assert.ok(input.nodeId);await cdp.send('DOM.setFileInputFiles',{nodeId:input.nodeId,files:[importFile]});
    await wait(`document.querySelector('#lab-status').textContent.startsWith('Data jam shod')`);
    assert.equal(await evaluate(`localStorage.getItem('crown_clash_gameplay_lab_v2')`),'preserved-v2');
    assert.equal(await evaluate(`localStorage.getItem('crown_clash_gameplay_lab_v3')`),'preserved-v3');
    // Measure the retained production bot under actual browser CPU throttling.
    await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
    const performanceEvidence=await evaluate(`(async()=>{
      const core=await import('/@fs'+${JSON.stringify(path.resolve('packages/game-core/src/index.ts'))});
      const b=new core.GameplayLabBattle('capture_recovery',false);
      for(const [i,t] of Object.values(b.state.territories).entries()){t.owner=i%2?'player':'enemy';t.units=i%2?6:80;}
      const sources=Object.values(b.state.territories);
      for(let i=0;i<18;i++){const from=sources[i%sources.length],to=sources[(i+4)%sources.length];
        const d=core.dispatchArmy(from,to,from.owner,.5,()=> 'perf_'+i,1,b.state);
        if(d.army)b.state.armies.push({...d.army,progress:0});}
      // In-flight armies remain in the fixture; C scores the current territories.
      for(const a of b.state.armies)a.speed=.18;
      const defense=structuredClone(b.state);
      defense.armies.forEach((a,i)=>{a.speed=.35+(i%4)*.15;a.units=i%3?18:50;});
      const cases=[b.state,defense];
      const moves=cases.map(state=>core.evaluateAiMove(state.territories,'enemy',8));
      if(moves.some(move=>!move))throw Error('Performance fixture must produce actual bot decisions');
      for(let i=0;i<30;i++)core.evaluateAiMove(cases[i%2].territories,'enemy',8);
      const times=[];for(let i=0;i<120;i++){const start=performance.now();core.evaluateAiMove(cases[i%2].territories,'enemy',8);times.push(performance.now()-start);}
      if(${JSON.stringify(process.env.CC_LAB_QA_NEGATIVE_CONTROL==='performance')})times.push(60,60,60,60,60,60,60,60);
      times.sort((a,b)=>a-b);return {rate:4,samples:times.length,moves,armies:b.state.armies.length,p95:times[Math.ceil(times.length*.95)-1],max:times.at(-1)};
    })()`);
    assert.ok(performanceEvidence.armies===18,'performance fixture must actually include in-flight armies');
    assert.ok(performanceEvidence.p95<16,`AI p95 must be <16ms: ${JSON.stringify(performanceEvidence)}`);
    assert.ok(performanceEvidence.max<=50,`no AI decision may exceed 50ms: ${JSON.stringify(performanceEvidence)}`);
    await cdp.send('Emulation.setCPUThrottlingRate',{rate:1});
    const evidence=await evaluate(`({events:window.__labQa.events,writes:window.__labQa.writes,data:JSON.parse(localStorage.getItem('crown_clash_gameplay_lab_v4'))})`);
    evidence.events=[...preReloadEvidence.flatMap(e=>e.events),...evidence.events];
    evidence.writes=[...preReloadEvidence.flatMap(e=>e.writes),...evidence.writes];
    assert.deepEqual(evidence.events,[]);assert.ok(evidence.writes.includes('crown_clash_gameplay_lab_v4'));
    assert.deepEqual(evidence.writes.filter(key=>/career|ledger|daily|league/.test(key)),[]);
    assert.equal(evidence.data.trials.filter(t=>t.kind==='main').length,2);
    assert.equal(evidence.data.offers.length,1);assert.equal(evidence.data.offers.filter(o=>o.decision==='replay').length,1);
    await network.assertHealthy();assert.deepEqual(network.blocked,[]);assert.deepEqual(errors,[]);
    fs.writeFileSync(path.join(out,`${width}x${height}-evidence.json`),JSON.stringify({...evidence,fixtureEvidence,performance:performanceEvidence,blocked:network.blocked},null,2));
    console.log(`PASS ${width}x${height}: C only, real touch, main quota, offers, retry, automatic result, import/export, isolated storage/analytics; AI ${JSON.stringify(performanceEvidence)}`);
  } finally {
    ws?.close(); chrome.kill();
    await pause(300); fs.rmSync(profile, { recursive: true, force: true });
  }
}

for (const [width, height] of [[360, 640], [390, 844]]) await run(width, height);
