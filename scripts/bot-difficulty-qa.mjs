import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { Client } from '@heroiclabs/nakama-js';
import { CdpClient, pickFreeCdpPort, waitForWebSocketOpen } from './cdp-client.mjs';
import { assertLocalQaUrl, createQaProfile, findQaChrome } from './qa-browser.mjs';
const appUrl=process.env.CC_QA_APP_URL??'http://127.0.0.1:3000/';assertLocalQaUrl(appUrl);
const out='qa-artifacts/bot-difficulty';fs.mkdirSync(out,{recursive:true});
const key=fs.readFileSync('.env','utf8').match(/^NAKAMA_SERVER_KEY=(.*)$/m)?.[1]?.replace(/^['"]|['"]$/g,'')??'defaultkey';
const client=new Client(key,'127.0.0.1','7350',false);
const sql=query=>execFileSync('docker',['compose','exec','-T','db','psql','-X','-U','crownclash','-d','crownclash','-v','ON_ERROR_STOP=1','-Atc',query],{encoding:'utf8'}).trim();

const sleep=ms=>new Promise(r=>setTimeout(r,ms));
for(const [width,height] of [[360,640],[390,844]]){
 const profile=createQaProfile('cc-difficulty-qa-' );let chrome,ws,session;
 try{
  const external='difficulty_qa_' +randomUUID(),username='TQ'+randomUUID().replaceAll('-','').slice(0,12);
  session=await client.authenticateCustom('browser:'+external,true,username,{platform:'browser',init_data:`user_id=${external}&username=${username}`});assert.match(session.user_id,/^[a-f0-9-]{36}$/);
  fs.appendFileSync(path.join(out,'qa-actors.jsonl'),JSON.stringify({id:session.user_id,external,username})+'\n');
  await client.rpc(session,'career/get',{});await client.rpc(session,'tutorial/complete',{});
  const config=(await client.rpc(session,'pilot/config',{})).payload;assert.equal(config.enabled,false,'this QA exercises ordinary main-game tickets; realm is covered by PostgreSQL tests');
  const port=await pickFreeCdpPort();chrome=spawn(findQaChrome(),['--headless=new',`--remote-debugging-port=${port}`,'--disable-extensions',`--user-data-dir=${profile}`,'about:blank'],{stdio:'ignore'});
  let tabs;for(let i=0;i<60;i++){await sleep(100);try{tabs=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();}catch{continue;}if(tabs.some(t=>t.type==='page'))break;}
  assert.ok(tabs?.some(t=>t.type==='page'));ws=new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);await waitForWebSocketOpen(ws);
  const cdp=new CdpClient(ws);await cdp.send('Page.enable');await cdp.send('Runtime.enable');
  const runtimeErrors=[],networkErrors=[],analyticsResponses=[];
  await cdp.send('Network.enable');cdp.on('Network.responseReceived',e=>{if(e.response.url.includes('analytics/events')||e.response.url.includes('analytics%2Fevents'))analyticsResponses.push({status:e.response.status,url:e.response.url.split('?')[0]});});cdp.on('Runtime.exceptionThrown',e=>runtimeErrors.push(e.exceptionDetails));
  cdp.on('Fetch.requestPaused',e=>{
    const url=new URL(e.request.url);const local=['127.0.0.1','localhost'].includes(url.hostname);
    const request=local?cdp.send('Fetch.continueRequest',{requestId:e.requestId}):cdp.send('Fetch.fulfillRequest',{requestId:e.requestId,responseCode:503,body:''});
    request.catch(err=>networkErrors.push(String(err)));
  });await cdp.send('Fetch.enable',{patterns:[{urlPattern:'*',requestStage:'Request'}]});
  await cdp.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:2,mobile:true});await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});
  const evaluate=async expression=>{const r=await cdp.send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
  const shot=async name=>{const r=await cdp.send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(out,`${width}x${height}-${name}.png`),Buffer.from(r.data,'base64'));};
  const wait=async(expression,attempts=120)=>{for(let i=0;i<attempts;i++){if(await evaluate(expression))return;await sleep(100);}await shot('failure');throw Error(`Timed out: ${expression}; ${JSON.stringify(runtimeErrors)}`);};
  const game='window.__PHASER_GAME__',scene=`${game}.scene.getScene('GameScene')`;
  const point=async(key,expr)=>evaluate(`(()=>{const g=${game},s=g.scene.getScene(${JSON.stringify(key)}),o=${expr};if(!o)throw Error('missing target');const b=g.canvas.getBoundingClientRect(),p=s.cameras.main.matrixCombined.transformPoint(o.x,o.y);return{x:b.x+p.x*b.width/g.canvas.width,y:b.y+p.y*b.height/g.canvas.height}})()`);
  const tower=id=>point('GameScene',`s.territoryVisuals.get(${JSON.stringify(id)}).container`);
  const tap=async p=>{await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[p]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});};
  const drag=async(from,to,shotName)=>{const a=await tower(from),b=await tower(to);await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[a]});for(let i=1;i<=8;i++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:a.x+(b.x-a.x)*i/8,y:a.y+(b.y-a.y)*i/8}]});}if(shotName)await shot(shotName);await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});};
  const url=new URL(appUrl);url.searchParams.set('user_id',external);url.searchParams.set('username',username);url.searchParams.set('prototype','crown');
  await cdp.send('Page.navigate',{url:url.toString()});await wait(`${game}?.scene.isActive('MenuScene') && ${game}.scene.getScene('MenuScene').children.list.some(v=>v.text==='PLAY  ⚔')`);
  const domPoint=selector=>evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('missing DOM button');const b=e.getBoundingClientRect();return{x:b.x+b.width/2,y:b.y+b.height/2}})()`);
  const ticketCount=()=>Number(sql(`SELECT COUNT(*) FROM bot_matches WHERE player_id='${session.user_id}'`));
  const resultPoint=()=>point('GameScene',"(()=>{const m=s.resultModalContainer,t=m.list.find(v=>v.text==='PLAY AGAIN ⚔');if(!t)throw Error('missing replay');return {x:m.x+t.x,y:m.y+t.y}})()");
  await tap(await point('MenuScene',"s.children.list.find(v=>v.text==='PLAY  ⚔')"));
  await wait(`!!document.querySelector('.bot-difficulty-overlay')`);
  assert.equal(await evaluate(`document.querySelector('[data-difficulty=normal]').getAttribute('aria-pressed')`),'true');
  await tap(await domPoint('[data-difficulty=hard]'));
  await tap(await domPoint('.bot-difficulty-cancel'));
  await wait(`${game}.scene.getScene('MenuScene').children.list.some(v=>v.text==='PLAY  ⚔')`);
  assert.equal(ticketCount(),0,'cancelling must not create a ticket');
  await tap(await point('MenuScene',"s.children.list.find(v=>v.text==='PLAY  ⚔')"));
  await wait(`!!document.querySelector('.bot-difficulty-overlay')`);
  for(const difficulty of ['easy','normal','hard']){
    await tap(await domPoint(`[data-difficulty=${difficulty}]`));
    assert.equal(await evaluate(`document.querySelector('[data-difficulty=${difficulty}]').getAttribute('aria-pressed')`),'true');
    await shot(`picker-${difficulty}`);
    const sizes=await evaluate(`Array.from(document.querySelectorAll('.bot-difficulty-overlay button')).map(b=>{const r=b.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height}})`);
    assert.ok(sizes.every(b=>b.height>=44&&b.width>=44&&b.x>=0&&b.y>=0&&b.x+b.width<=width&&b.y+b.height<=height),'all touch targets must fit the mobile viewport');
    await tap(await domPoint('.bot-difficulty-play'));
    await wait(`${game}.scene.isActive('GameScene') && ${scene}.territoryVisuals.size>0 && ${scene}.botDifficulty===${JSON.stringify(difficulty)}`);
    assert.equal(await evaluate(`!!document.querySelector('.bot-difficulty-overlay')`),false);
    const matchId=await evaluate(`${scene}.activeMatchId`);assert.match(matchId,/^bot_[a-f0-9]{32}$/);
    assert.equal(sql(`SELECT bot_difficulty FROM bot_matches WHERE match_id='${matchId}' AND player_id='${session.user_id}'`),difficulty);
    assert.equal(await evaluate(`${scene}.aiNextTick`),{easy:3.6,normal:1.8,hard:.9}[difficulty]);
    await shot(`battle-${difficulty}`);
    // Advance the real client simulation clock, with its ordinary AI/settlement path.
    await evaluate(`(()=>{const s=${scene};for(let i=0;i<400&&s.gameState.status==='playing';i++)s.stepBotMatch(.25)})()`);
    assert.notEqual(await evaluate(`${scene}.gameState.status`),'playing','client simulation must actually finish');
    await evaluate(`${scene}.endMatch()`);
    await wait(`${scene}.resultModalContainer?.list.some(v=>v.text==='PLAY AGAIN ⚔')`,200);
    assert.equal(sql(`SELECT COUNT(*) FROM match_settlements WHERE match_id='${matchId}'`),'1','result must be settled by server');
    await sleep(400);await tap(await resultPoint());
    await wait(`!!document.querySelector('.bot-difficulty-overlay')`);
    assert.equal(await evaluate(`document.querySelector('[data-difficulty=${difficulty}]').getAttribute('aria-pressed')`),'true','replay must remember previous selection');
    const count=ticketCount();
    await tap(await domPoint('.bot-difficulty-cancel'));
    await wait(`${scene}.resultModalContainer?.list.some(v=>v.text==='PLAY AGAIN ⚔')`);
    assert.equal(ticketCount(),count,'cancelled rematch must not issue a ticket');
    await tap(await resultPoint());await wait(`!!document.querySelector('.bot-difficulty-overlay')`);
  }
  // Leaving the scene must dismiss a pending choice without issuing a match.
  const count=ticketCount();
  await evaluate(`void ${scene}.scene.start('MenuScene')`);
  await wait(`${game}.scene.isActive('MenuScene') && !document.querySelector('.bot-difficulty-overlay')`);
  assert.equal(ticketCount(),count);
  const analyticsQuery=`SELECT COUNT(DISTINCT props->>'botDifficulty') FROM analytics_events WHERE player_id='${session.user_id}' AND name='match_start' AND props->>'botDifficulty' IN ('easy','normal','hard')`;
  for(let attempt=0;attempt<100&&sql(analyticsQuery)!=='3';attempt++)await sleep(100);
  assert.equal(sql(analyticsQuery),'3','all three levels must reach analytics with server-verified ticket metadata');
  assert.deepEqual(runtimeErrors,[]);assert.deepEqual(networkErrors,[]);
  console.log(`PASS ${width}x${height}: touch selection, all three server tickets, actual AI clocks, settlement, rematch preference, cancellation and shutdown cleanup`);
 }catch(error){ console.error(error instanceof Response ? `HTTP ${error.status}: ${await error.clone().text()}` : error); throw error; }finally{
  ws?.close();chrome?.kill();await sleep(200);fs.rmSync(profile,{recursive:true,force:true});
  if(session){const id=session.user_id;assert.match(id,/^[a-f0-9-]{36}$/);sql(`BEGIN;DELETE FROM analytics_events WHERE player_id='${id}';DELETE FROM bot_matches WHERE player_id='${id}';DELETE FROM match_settlements WHERE player_id='${id}';DELETE FROM economy_ledger WHERE player_id='${id}';DELETE FROM player_names WHERE player_id='${id}';DELETE FROM pvp_defenses WHERE player_id='${id}';DELETE FROM player_daily_progress WHERE player_id='${id}';DELETE FROM players WHERE id='${id}';COMMIT;`);await client.deleteAccount(session);}
 }
}
