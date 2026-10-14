import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Client } from '@heroiclabs/nakama-js';
import { CdpClient, pickFreeCdpPort, waitForWebSocketOpen } from './cdp-client.mjs';
import { createQaProfile, findQaChrome, assertLocalQaUrl } from './qa-browser.mjs';
const appUrl = process.env.CC_QA_APP_URL ?? 'http://127.0.0.1:3000/';
assertLocalQaUrl(appUrl);
const out = path.resolve('qa-artifacts/realm-pilot');fs.mkdirSync(out,{recursive:true});
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const env=fs.existsSync('.env')?fs.readFileSync('.env','utf8'):'';
const key=process.env.NAKAMA_SERVER_KEY??env.match(/^NAKAMA_SERVER_KEY=(.*)$/m)?.[1]??'defaultkey';
const client=new Client(key,'127.0.0.1','7350',false);
const sql=query=>execFileSync('docker',['compose','exec','-T','db','psql','-U','crownclash','-d','crownclash','-v','ON_ERROR_STOP=1','-Atc',query],{encoding:'utf8'}).trim();
const uuid=/^[a-f0-9-]{36}$/;
async function actor(){const external='realm_qa_'+randomUUID();const username='RQ'+randomUUID().replaceAll('-','').slice(0,12);const session=await client.authenticateCustom('browser:'+external,true,username,{platform:'browser',init_data:`user_id=${external}&username=${username}`});assert.match(session.user_id,uuid);await client.rpc(session,'career/get',{});await client.rpc(session,'tutorial/complete',{});sql(`UPDATE players SET matches_played=3 WHERE id='${session.user_id}'`);fs.appendFileSync(path.join(out,'created-actors.jsonl'),JSON.stringify({id:session.user_id,external,username})+'\n');return {external,session,username};}
async function run(width,height){
 const actors=[];let ws,chrome;const profile=createQaProfile('cc-realm-qa-');
 try{
  const a=await actor();actors.push(a);const b=await actor();actors.push(b);
  const config=(await client.rpc(a.session,'pilot/config',{})).payload;assert.equal(config.enabled,true);assert.equal(config.paymentsEnabled,false,'QA must never run paid checkout');
  if(width===360)await client.rpc(a.session,'pilot/goal',{goal:'production'});
  await client.rpc(b.session,'pilot/home',{});const invite=(await client.rpc(b.session,'pilot/challenge/create',{})).payload;assert.match(invite.token,/^c_[a-f0-9]{32}$/);
  const port=await pickFreeCdpPort();chrome=spawn(findQaChrome(),['--headless=new',`--remote-debugging-port=${port}`,'--disable-extensions','--autoplay-policy=no-user-gesture-required',`--user-data-dir=${profile}`,'about:blank'],{stdio:'ignore'});
  let tabs;for(let i=0;i<50;i++){await sleep(100);try{tabs=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();}catch{continue;}if(tabs.some(t=>t.type==='page'))break;}
  assert.ok(tabs?.some(t=>t.type==='page'),'Chrome page unavailable');ws=new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);await waitForWebSocketOpen(ws);const cdp=new CdpClient(ws);
  await cdp.send('Page.enable');await cdp.send('Runtime.enable');const runtimeErrors=[];cdp.on('Runtime.exceptionThrown',e=>runtimeErrors.push(e.exceptionDetails));
  await cdp.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:2,mobile:true});await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});
  const evaluate=async expression=>{const result=await cdp.send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw new Error(JSON.stringify(result.exceptionDetails));return result.result.value;};
  const shot=async name=>{await sleep(550);const r=await cdp.send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(out,`${width}x${height}-${name}.png`),Buffer.from(r.data,'base64'));};
  const wait=async (expression,attempts=120)=>{for(let i=0;i<attempts;i++){if(await evaluate(`Boolean(${expression})`))return;await sleep(100);}await shot('failure');throw new Error('Timed out: '+expression+'; errors: '+JSON.stringify(runtimeErrors));};
  const tap=async selector=>{const point=await evaluate(`(()=>{const b=document.querySelector(${JSON.stringify(selector)});if(!b)throw Error('Missing button');b.scrollIntoView({block:'center'});const r=b.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()`);await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});};
  const tapSceneObject=async (sceneName,expression)=>{const p=await evaluate(`(()=>{const g=window.__PHASER_GAME__,s=g.scene.getScene(${JSON.stringify(sceneName)}),v=${expression};if(!v)throw Error('Missing scene control');const b=g.canvas.getBoundingClientRect(),w=v.getWorldTransformMatrix().transformPoint(0,0),p=s.cameras.main.matrixCombined.transformPoint(w.x,w.y);return{x:b.x+p.x*b.width/g.canvas.width,y:b.y+p.y*b.height/g.canvas.height};})()`);await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[p]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});};
  const openRealmFromMenu=async()=>{await wait("window.__PHASER_GAME__?.scene.isActive('MenuScene') && window.__PHASER_GAME__.scene.getScene('MenuScene').children.getByName('realm-entry')");await sleep(250);await tapSceneObject('MenuScene',"s.children.getByName('realm-entry')");await wait("document.querySelector('.realm-primary[data-action=attack]')");};
  const url=new URL(appUrl);url.searchParams.set('user_id',a.external);url.searchParams.set('username',a.username);url.searchParams.set('challenge',invite.token);url.searchParams.set('campaign','ad_qa');
  await cdp.send('Page.navigate',{url:url.toString()});await wait("document.querySelector('[data-challenge]')");await shot('friend-preview');
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.realm-shell')).position"),'fixed','realm CSS missing');
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.realm-dialog')).position"),'fixed','dialog CSS missing');
  assert.equal(await evaluate("document.querySelector('.realm-shell').scrollWidth<=innerWidth"),true,'horizontal mobile overflow');
  await evaluate("document.querySelector('.realm-dialog select').value='vanguard'");await tap('[data-challenge]');
  const game='window.__PHASER_GAME__',scene=`${game}.scene.getScene('GameScene')`;
  await wait(`${game}?.scene.isActive('GameScene') && ${scene}.territoryVisuals.size>0`);
  assert.equal(await evaluate(`${scene}.realmTicket.combatPolicy`),'equal');assert.equal(await evaluate(`${scene}.playerArmySpeedMultiplier`),1.15);
  await sleep(250);assert.equal(await evaluate(`${scene}.input.enabled`),true);
  const point=async id=>evaluate(`(()=>{const g=${game},s=${scene},v=s.territoryVisuals.get(${JSON.stringify(id)}).container,b=g.canvas.getBoundingClientRect(),p=s.cameras.main.matrixCombined.transformPoint(v.x,v.y);return{x:b.x+p.x*b.width/g.canvas.width,y:b.y+p.y*b.height/g.canvas.height};})()`);
  const source=await point('p_base'),target=await point('n_bot_left');for(const p of [source,target])assert.ok(p.x>0&&p.x<width&&p.y>0&&p.y<height,'rendered tower outside viewport');await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[source]});await sleep(100);
  for(let i=1;i<=8;i++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:source.x+(target.x-source.x)*i/8,y:source.y+(target.y-source.y)*i/8}]});await sleep(30);}await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await wait(`${scene}.matchActions.length>0`);await shot('battle');await sleep(1100);
  const matchId=await evaluate(`${scene}.activeMatchId`);assert.match(matchId,/^realm_[a-f0-9]{32}$/);
  assert.equal(sql(`SELECT state FROM realm_tickets WHERE id='${matchId}'`),'active');
  await cdp.send('Page.reload');await openRealmFromMenu();
  assert.equal(await evaluate("document.querySelector('.realm-primary').textContent.includes('ادامه نبرد')"),true);
  await shot('realm');await tap('[data-action=shop]');await wait("document.querySelector('[data-product=starter]')");
  assert.equal(await evaluate("document.querySelector('[data-product=starter]').disabled"),true,'browser paid checkout exposed');await shot('shop');await tap('.realm-close');await tap('[data-action=menu]');await wait("window.__PHASER_GAME__.scene.isActive('MenuScene') && window.__PHASER_GAME__.scene.getScene('MenuScene').children.list.some(v=>v.text==='PLAY  ⚔')");await sleep(250);await tapSceneObject('MenuScene',"s.children.list.find(v=>v.text==='PLAY  ⚔')");
  await wait(`${game}.scene.isActive('GameScene') && ${scene}.matchActions.length>0`);assert.equal(await evaluate(`${scene}.activeMatchId`),matchId,'reload duplicated battle');
  let exitingActor=a;
  if(width===360){
    console.log('360x640: waiting for a real, unaccelerated battle result');
    await wait(`${game}.scene.isActive('GameScene') && ${scene}.resultModalContainer && !${scene}.resultPending && ${scene}.offlineBattleClosed`,1200);await shot('verified-result');
    assert.equal(await evaluate("Boolean(document.querySelector('.realm-shell'))"),false,'result skipped the battle screen');
    assert.equal(await evaluate(`${scene}.resultModalContainer.list.filter(v=>typeof v.text==='string' && v.text.includes('NEXT:')).length`),1,'result should focus on one upgrade goal');
    assert.equal(await evaluate(`${scene}.resultModalContainer.list.some(v=>v.text?.includes('WAR FORGE'))`),true,'result lost the selected goal');
    for(const [resultWidth,resultHeight] of [[320,568],[390,844],[360,640]]){
      await cdp.send('Emulation.setDeviceMetricsOverride',{width:resultWidth,height:resultHeight,deviceScaleFactor:2,mobile:true});await sleep(350);
      const bounds=await evaluate(`(()=>{const g=${game},s=${scene},m=s.resultModalContainer.getWorldTransformMatrix(),b=g.canvas.getBoundingClientRect(),toScreen=(x,y)=>{const w=m.transformPoint(x,y),p=s.cameras.main.matrixCombined.transformPoint(w.x,w.y);return{x:b.x+p.x*b.width/g.canvas.width,y:b.y+p.y*b.height/g.canvas.height}};return{top:toScreen(-165,-320),bottom:toScreen(165,320),replayTop:toScreen(0,107),replayBottom:toScreen(0,163)}})()`);
      assert.ok(bounds.top.x>=0&&bounds.top.y>=0&&bounds.bottom.x<=resultWidth&&bounds.bottom.y<=resultHeight,'result card clipped on mobile');
      assert.ok(bounds.replayBottom.y-bounds.replayTop.y>=44,'play-again target too small');await shot(`result-at-${resultWidth}x${resultHeight}`);
    }
    assert.equal(sql(`SELECT state FROM realm_tickets WHERE id='${matchId}'`),'settled');
    assert.equal(sql(`SELECT coins FROM players WHERE id='${a.session.user_id}'`),'120');
    assert.equal(sql(`SELECT COUNT(*) FROM economy_ledger WHERE player_id='${a.session.user_id}'`),'1');
    await tapSceneObject('GameScene',"s.resultModalContainer.list.find(v=>v.text==='PLAY AGAIN ⚔')");
    await wait(`${game}.scene.isActive('GameScene') && ${scene}.activeMatchId!==${JSON.stringify(matchId)} && ${scene}.territoryVisuals.size>0`);
    const nextId=await evaluate(`${scene}.activeMatchId`);assert.match(nextId,/^realm_[a-f0-9]{32}$/);
    assert.equal(sql(`SELECT state FROM realm_tickets WHERE id='${nextId}'`),'active','one-tap continuation did not create an authoritative battle');
    assert.equal(sql(`SELECT coins FROM players WHERE id='${a.session.user_id}'`),'120','play again duplicated rewards');
    assert.equal(await evaluate(`${scene}.realmGoal`),'production','next battle lost the selected goal');
    let replayTracked=false;for(let i=0;i<120;i++){if(sql(`SELECT COUNT(*) FROM analytics_events WHERE player_id='${a.session.user_id}' AND name='match_start' AND props->>'matchId'='${nextId}' AND props->>'source'='rematch'`)==='1'){replayTracked=true;break;}await sleep(100);}
    assert.equal(replayTracked,true,'one-tap continuation analytics missing');
    await shot('one-tap-next-battle');await evaluate(`${scene}.handleMatchExitConfirmed()`);
    await wait(`${game}.scene.isActive('MenuScene')`);assert.equal(sql(`SELECT state FROM realm_tickets WHERE id='${nextId}'`),'abandoned');
    const defenderUrl=new URL(appUrl);defenderUrl.searchParams.set('user_id',b.external);defenderUrl.searchParams.set('username',b.username);
    await cdp.send('Page.navigate',{url:defenderUrl.toString()});await openRealmFromMenu();await wait("document.querySelector('[data-revenge]')");await shot('incoming-revenge');
    await tap('[data-revenge]');await wait("document.querySelector('[data-loadout]')");await tap('[data-loadout]');
    await wait(`${game}.scene.isActive('GameScene') && ${scene}.realmTicket?.source==='revenge'`);
    assert.equal(await evaluate(`${scene}.realmTicket.combatPolicy`),'equal');assert.equal(await evaluate(`${scene}.realmTicket.originId`),matchId);
    exitingActor=b;
  }
  const exitingId=await evaluate(`${scene}.activeMatchId`);
  // Use the same exit callback invoked by the confirmation UI; server and career effects are asserted.
  await evaluate(`${scene}.handleMatchExitConfirmed()`);await openRealmFromMenu();
  assert.equal(sql(`SELECT state FROM realm_tickets WHERE id='${exitingId}'`),'abandoned');
  assert.equal(sql(`SELECT COUNT(*) FROM economy_ledger WHERE player_id='${exitingActor.session.user_id}'`),'0','social quit changed economy');
  await tap('[data-action=menu]');await wait("window.__PHASER_GAME__.scene.isActive('MenuScene') && window.__PHASER_GAME__.scene.getScene('MenuScene').children.getByName('realm-entry')");
  assert.equal(await evaluate("Boolean(document.querySelector('.realm-shell'))"),false,'Realm replaced main menu');await sleep(250);await shot('original-menu');
  await tapSceneObject('MenuScene',"s.children.list.find(v=>v.text==='KINGDOM')");await wait("window.__PHASER_GAME__.scene.isActive('KingdomScene')");await sleep(250);
  await tapSceneObject('KingdomScene',"s.children.list.find(v=>v.text==='‹')");await openRealmFromMenu();
  if(width===390){
    await wait("document.querySelector('[data-action=upgrade]:not(:disabled)')");await tap('[data-action=upgrade]');
    await wait("document.querySelector('.realm-goal-value b')?.textContent.includes('۱')");
    assert.equal(sql(`SELECT coins || ':' || starting_garrison_level FROM players WHERE id='${a.session.user_id}'`),'50:1','inline upgrade did not debit server balance');
    assert.equal(sql(`SELECT COUNT(*) FROM economy_ledger WHERE player_id='${a.session.user_id}' AND source='upgrade_purchase'`),'1');
    let observed=false;for(let i=0;i<220;i++){if(sql(`SELECT COUNT(*) FROM analytics_events e JOIN upgrade_purchases p ON p.purchase_id=e.props->>'purchaseId' AND p.player_id=e.player_id WHERE e.player_id='${a.session.user_id}' AND e.name='upgrade_purchase_succeeded' AND e.props->>'level'='1'`)==='1'){observed=true;break;}await sleep(100);}

    assert.equal(observed,true,'authoritative upgrade analytics missing');await shot('verified-upgrade');
  }
  assert.equal(runtimeErrors.length,0,JSON.stringify(runtimeErrors));console.log(`${width}x${height}: real challenge, touch dispatch, resume, locked shop, quit passed`);
 }catch(error){console.error(error instanceof Response ? `HTTP ${error.status}: ${await error.clone().text()}` : error.message);throw error;}finally{
  ws?.close();chrome?.kill();await sleep(200);fs.rmSync(profile,{recursive:true,force:true});
  for(const actor of actors){const id=actor.session.user_id;assert.match(id,uuid);
   sql(`BEGIN;DELETE FROM realm_tickets WHERE player_id='${id}' OR defender_id='${id}';DELETE FROM realm_challenges WHERE player_id='${id}';DELETE FROM realm_defenses WHERE player_id='${id}';DELETE FROM realm_goals WHERE player_id='${id}';DELETE FROM realm_live_loadouts WHERE player_id='${id}';DELETE FROM pilot_visits WHERE player_id='${id}';DELETE FROM pilot_observations WHERE player_id='${id}';DELETE FROM analytics_events WHERE player_id='${id}';DELETE FROM match_settlements WHERE player_id='${id}';DELETE FROM bot_matches WHERE player_id='${id}';DELETE FROM player_names WHERE player_id='${id}';DELETE FROM pvp_defenses WHERE player_id='${id}';DELETE FROM economy_ledger WHERE player_id='${id}';DELETE FROM player_daily_progress WHERE player_id='${id}';DELETE FROM daily_reward_claims WHERE player_id='${id}';DELETE FROM league_reward_claims WHERE player_id='${id}';DELETE FROM upgrade_purchases WHERE player_id='${id}';DELETE FROM players WHERE id='${id}';COMMIT;`);
   await client.deleteAccount(actor.session);
  }
 }
}
const sizes=[[320,568],[360,640],[390,844]].filter(([width])=>!process.env.CC_QA_WIDTH||width===Number(process.env.CC_QA_WIDTH));assert.ok(sizes.length,'unsupported QA width');
try {for(const [width,height] of sizes)await run(width,height);} catch(error) {if(error instanceof Response) throw new Error(`HTTP ${error.status}: ${await error.clone().text()}`);throw error;}
