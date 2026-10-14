import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { Client } from '@heroiclabs/nakama-js';
import { CdpClient, pickFreeCdpPort, waitForWebSocketOpen } from './cdp-client.mjs';
import { assertLocalQaUrl, createQaProfile, findQaChrome } from './qa-browser.mjs';
const appUrl=process.env.CC_QA_APP_URL??'http://127.0.0.1:3000/';assertLocalQaUrl(appUrl);
const out='qa-artifacts/tactical';fs.mkdirSync(out,{recursive:true});
const key=fs.readFileSync('.env','utf8').match(/^NAKAMA_SERVER_KEY=(.*)$/m)?.[1]?.replace(/^['"]|['"]$/g,'')??'defaultkey';
const client=new Client(key,'127.0.0.1','7350',false);
const sql=query=>execFileSync('docker',['compose','exec','-T','db','psql','-X','-U','crownclash','-d','crownclash','-v','ON_ERROR_STOP=1','-Atc',query],{encoding:'utf8'}).trim();
const maps=JSON.parse(fs.readFileSync('apps/server-nakama/battlefields.json','utf8'));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
for(const [width,height] of [[360,640],[390,844]]){
 const profile=createQaProfile('cc-tactical-qa-');let chrome,ws,session;
 try{
  const external='tactical_qa_'+randomUUID(),username='TQ'+randomUUID().replaceAll('-','').slice(0,12);
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
  assert.equal(await evaluate(`${game}.scene.getScene('MenuScene').children.list.some(v=>v.text?.includes('CROWN HOLD'))`),false);await shot('menu');
  await tap(await point('MenuScene',"s.children.list.find(v=>v.text==='PLAY  ⚔')"));
  await wait(`!!document.querySelector('.bot-difficulty-overlay')`);
  await evaluate(`document.querySelector('[data-difficulty=normal]').click();document.querySelector('.bot-difficulty-play').click()`);
  await wait(`${game}.scene.isActive('GameScene') && ${scene}.territoryVisuals.size>0`);
  const state=await evaluate(`${scene}.gameState`);assert.equal(state.gameplayRulesVersion,3);
  const matchId=await evaluate(`${scene}.activeMatchId`);assert.match(matchId,/^bot_[a-f0-9]{32}$/);
  assert.equal(sql(`SELECT gameplay_rules_version FROM bot_matches WHERE match_id='${matchId}' AND player_id='${session.user_id}'`),'3');
  await drag('p_base','e_base','illegal-attack');assert.equal(await evaluate(`${scene}.matchActions.length`),0);
  const roads=maps.find(m=>m.id===state.battlefieldId).roads;
  const adjacent=roads.flatMap(([a,b])=>a==='p_base'?[b]:b==='p_base'?[a]:[]);
  const target=adjacent.find(id=>state.territories[id].owner==='neutral'&&state.territories[id].units<14);
  const support=Object.values(state.territories).find(t=>t.owner==='player'&&t.id!=='p_base').id;assert.ok(target);
  await drag('p_base',target,'legal-attack');await wait(`${scene}.gameState.territories[${JSON.stringify(target)}].owner==='player'`);
  assert.equal(await evaluate(`${scene}.matchActions.length`),1);
  // The left lane's next tower is adjacent to the support, but not to HQ.
  // Show the excluded source instead of silently making a two-tower gesture
  // look like a failed multi-select.
  const leftTarget=roads.flatMap(([a,b])=>a===support?[b]:b===support?[a]:[]).find(id=>state.territories[id].owner!=='player'&&!adjacent.includes(id));
  assert.ok(leftTarget,'each map must provide a support-only adjacent target');
  const leftStart=await tower('p_base'),leftSecond=await tower(support),leftEnd=await tower(leftTarget);
  const leftActionCount=await evaluate(`${scene}.matchActions.length`);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[leftStart]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[leftSecond]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[leftEnd]});
  assert.deepEqual(await evaluate(`${scene}.selectedSourceIds`),['p_base',support]);
  assert.ok((await evaluate(`${scene}.dragBadgeText.text`)).includes('1/2 TOWERS'));
  assert.ok((await evaluate(`${scene}.bottomHintText.text`)).includes('1 selected tower has no direct road'));
  await shot('multi-select-left-lane');
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  assert.deepEqual(await evaluate(`${scene}.matchActions.slice(${leftActionCount}).map(a=>[a.sourceId,a.targetId])`),[[support,leftTarget]]);
  // One continuous touch selects both owned towers, then releases on one target.
  const multiStart=await tower(support),multiSecond=await tower('p_base'),multiTarget=await tower(target);
  const actionCount=await evaluate(`${scene}.matchActions.length`);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[multiStart]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[multiSecond]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[multiTarget]});
  assert.deepEqual(await evaluate(`${scene}.selectedSourceIds`),[support,'p_base'],'both towers must stay selected');
  assert.ok((await evaluate(`${scene}.dragBadgeText.text`)).includes('2/2 TOWERS'));
  await shot('multi-select');
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  assert.deepEqual(await evaluate(`${scene}.matchActions.slice(${actionCount}).map(a=>[a.sourceId,a.targetId])`),[[support,target],['p_base',target]],'both legal sources must dispatch in the same release');
  let supplySource=support,supplyTarget=target;
  // Royal Ring has a direct road between the southern gates. Expand one more
  // legal tower through real orders before asserting multi-leg reinforcement.
  if(roads.some(([a,b])=>(a===support&&b===target)||(b===support&&a===target))){
    await drag(support,target);await drag('p_base',target);
    await wait(`${scene}.gameState.territories[${JSON.stringify(target)}].units>=20`);
    supplyTarget=roads.flatMap(([a,b])=>a===target?[b]:b===target?[a]:[]).find(id=>state.territories[id].owner==='neutral'&&id!==target&&!roads.some(([a,b])=>(a==='p_base'&&b===id)||(b==='p_base'&&a===id)));
    assert.ok(supplyTarget);await drag(target,supplyTarget);await wait(`${scene}.gameState.territories[${JSON.stringify(supplyTarget)}].owner==='player'`);supplySource='p_base';
  }
  await drag(supplySource,supplyTarget,'supply-route');
  await wait(`${scene}.gameState.armies.some(a=>a.owner==='player'&&a.routeIds?.length>=3)`);
  const route=await evaluate(`${scene}.gameState.armies.find(a=>a.owner==='player'&&a.routeIds?.length>=3).routeIds`);assert.equal(route[0],supplySource);assert.equal(route.at(-1),supplyTarget);
  assert.equal(await evaluate(`${scene}.matchActions.at(-1).targetId`),supplyTarget);
  // Follow the newest multi-leg supply through a real simulation turn.
  // Keep object identity as evidence that troops and their walk phase are
  // continuous, rather than replacing a squad at every waypoint.
  await wait(`${scene}.gameState.armies.some(a=>a.owner==='player'&&a.routeIds?.length>=3&&(a.routeLeg??0)===0&&${scene}.armyVisuals.has(a.owner+':'+a.id))`);
  await evaluate(`(()=>{const s=${scene},a=s.gameState.armies.filter(a=>a.owner==='player'&&a.routeIds?.length>=3&&(a.routeLeg??0)===0&&s.armyVisuals.has(a.owner+':'+a.id)).at(-1),v=s.armyVisuals.get(a.owner+':'+a.id);if(!v)throw Error('missing routed visual');window.__routeAnimation={id:a.id,visual:v,phase:v.phaseSeconds,badgeOffset:{...v.badgeOffset},units:a.units}})()`);
  await wait(`${scene}.gameState.armies.some(a=>a.id===window.__routeAnimation.id&&a.routeLeg>0)`);
  assert.equal(await evaluate(`${scene}.armyVisuals.get('player:'+window.__routeAnimation.id)===window.__routeAnimation.visual`),true,'one troop group must survive the waypoint');
  assert.equal(await evaluate(`${scene}.armyVisuals.get('player:'+window.__routeAnimation.id).phaseSeconds>window.__routeAnimation.phase`),true,'walk phase must continue');
  assert.deepEqual(await evaluate(`${scene}.armyVisuals.get('player:'+window.__routeAnimation.id).badgeOffset`),await evaluate('window.__routeAnimation.badgeOffset'),'number must keep its attachment through the turn');
  await shot('supply-turn');await sleep(160);await shot('supply-turn-settled');
  await evaluate(`${scene}.matchMenuController.openMenu()`);const paused=await evaluate(`${scene}.gameState.elapsedTimeSeconds`);await sleep(300);assert.equal(await evaluate(`${scene}.gameState.elapsedTimeSeconds`),paused);
  await shot('paused');await evaluate(`${scene}.matchMenuController.closeMenu()`);await wait(`${scene}.gameState.elapsedTimeSeconds>${paused}`);
  await cdp.send('Emulation.setDeviceMetricsOverride',{width:height,height:width,deviceScaleFactor:2,mobile:true});await sleep(300);
  await cdp.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:2,mobile:true});await sleep(300);await shot('resized');
  assert.equal(await evaluate(`${scene}.activeMatchId`),matchId);
  await evaluate(`${scene}.matchMenuController.confirmExit()`);await wait(`${game}.scene.isActive('MenuScene')`);
  assert.equal(sql(`SELECT COUNT(*) FROM match_settlements WHERE match_id='${matchId}'`),'0');
  const analyticsQuery=`SELECT COUNT(DISTINCT name) FROM analytics_events WHERE player_id='${session.user_id}' AND props->>'matchId'='${matchId}' AND props->>'gameplayRulesVersion'='3' AND name IN ('match_start','match_quit')`;
  for(let attempt=0;attempt<150&&sql(analyticsQuery)!=='2';attempt++)await sleep(100);
  if(sql(analyticsQuery)!=='2'){const queued=await evaluate(`Object.keys(localStorage).filter(k=>k.startsWith('analytics:')).map(k=>JSON.parse(localStorage.getItem(k)))`);fs.writeFileSync(path.join(out,'analytics-failure.json'),JSON.stringify({analyticsResponses,queued},null,2));}
  assert.equal(sql(analyticsQuery),'2','start and quit must reach PostgreSQL with server-verified v3');
  assert.deepEqual(runtimeErrors,[]);assert.deepEqual(networkErrors,[]);
  console.log(`PASS ${width}x${height}: main PLAY, real v3 ticket, retired URL, legal/illegal touch orders, two-tower selection and excluded-source explanation, continuous routed supply animation, pause, resize, quit`);
 }catch(error){ console.error(error instanceof Response ? `HTTP ${error.status}: ${await error.clone().text()}` : error); throw error; }finally{
  ws?.close();chrome?.kill();await sleep(200);fs.rmSync(profile,{recursive:true,force:true});
  if(session){const id=session.user_id;assert.match(id,/^[a-f0-9-]{36}$/);sql(`BEGIN;DELETE FROM analytics_events WHERE player_id='${id}';DELETE FROM bot_matches WHERE player_id='${id}';DELETE FROM match_settlements WHERE player_id='${id}';DELETE FROM economy_ledger WHERE player_id='${id}';DELETE FROM player_names WHERE player_id='${id}';DELETE FROM pvp_defenses WHERE player_id='${id}';DELETE FROM player_daily_progress WHERE player_id='${id}';DELETE FROM players WHERE id='${id}';COMMIT;`);await client.deleteAccount(session);}
 }
}
