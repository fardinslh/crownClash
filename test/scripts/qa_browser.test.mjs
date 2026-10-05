import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertLocalQaUrl, classifyQaRequest, isolateQaRequests } from '../../scripts/qa-browser.mjs';

const appUrl = 'http://127.0.0.1:4173/?benchmark_mode=1';
const request = (url, method = 'GET') => ({ url, method });

test('isolated QA allows loopback static assets while rejecting account and external requests', () => {
  assert.equal(classifyQaRequest(request('http://127.0.0.1:4173/assets/index.js'), appUrl), 'allowed');
  assert.equal(classifyQaRequest(request('http://127.0.0.1:7350/v2/account/authenticate/custom', 'POST'), appUrl), 'blocked');
  assert.equal(classifyQaRequest(request('https://game.example/v2/account'), appUrl), 'blocked');
  assert.equal(classifyQaRequest(request('http://127.0.0.1:4173/v2/account', 'POST'), appUrl), 'blocked');
  assert.equal(classifyQaRequest(request('http://127.0.0.1:4173/api/player.json'), appUrl), 'blocked');
  assert.throws(() => assertLocalQaUrl('https://game.example/'), /loopback/);
});

test('asset negative controls only remove the requested ground, building or unit class', () => {
  const ground = request('http://127.0.0.1:4173/assets/grounds/crown_cross.webp');
  const building = request('http://127.0.0.1:4173/assets/territories/crown_cross/citadel_player.webp');
  assert.equal(classifyQaRequest(ground, appUrl, 'ground'), 'missing');
  assert.equal(classifyQaRequest(building, appUrl, 'building'), 'missing');
  assert.equal(classifyQaRequest(building, appUrl, 'ground'), 'allowed');
  const unit = request('http://127.0.0.1:4173/assets/units/unit_leader_player_front.png?v=cartoon-meadow-v1.5');
  assert.equal(classifyQaRequest(unit, appUrl, 'unit'), 'missing');
  assert.equal(classifyQaRequest(unit, appUrl, 'building'), 'allowed');
  assert.equal(classifyQaRequest(building, appUrl, 'unit'), 'allowed');
});

test('CDP interception fulfills blocked requests locally and propagates interception failures', async () => {
  const calls = [];
  let paused;
  const cdp = { on(_name, fn) { paused = fn; }, async send(method, params) { calls.push({method, params}); } };
  const isolation = await isolateQaRequests(cdp, appUrl);
  paused({ requestId: 'account-write', request: request('https://game.example/v2/account', 'POST') });
  await isolation.assertHealthy();
  assert.equal(calls.at(-1).method, 'Fetch.fulfillRequest');
  assert.equal(calls.at(-1).params.responseCode, 503);
  assert.equal(calls.filter((call) => call.method === 'Fetch.continueRequest').length, 0);
  assert.equal(isolation.blocked.length, 1);

  cdp.send = async () => { throw new Error('negative-control-interception-failure'); };
  paused({ requestId: 'broken-isolation', request: request('https://game.example/v2/account', 'POST') });
  await assert.rejects(isolation.assertHealthy(), /negative-control-interception-failure/);
});
