import assert from 'node:assert/strict';
import test from 'node:test';
import { CdpClient } from '../../scripts/cdp-client.mjs';

class FakeSocket extends EventTarget {
  sent = [];

  send(payload) {
    this.sent.push(JSON.parse(payload));
  }

  receive(payload) {
    this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(payload) }));
  }
}

test('resolves a matching CDP response while preserving event listeners', async () => {
  const socket = new FakeSocket();
  const client = new CdpClient(socket, 100);
  let eventPayload;
  client.on('Runtime.consoleAPICalled', (payload) => {
    eventPayload = payload;
  });

  const response = client.send('Page.enable');
  socket.receive({ method: 'Runtime.consoleAPICalled', params: { type: 'error' } });
  socket.receive({ id: socket.sent[0].id, result: { enabled: true } });

  assert.deepEqual(await response, { enabled: true });
  assert.deepEqual(eventPayload, { type: 'error' });
});

test('rejects a CDP command that never receives a response', async () => {
  const socket = new FakeSocket();
  const client = new CdpClient(socket, 10);

  await assert.rejects(client.send('Page.navigate'), /CDP command timed out.*Page\.navigate/);
});

test('rejects pending commands when the socket closes', async () => {
  const socket = new FakeSocket();
  const client = new CdpClient(socket, 1_000);
  const response = client.send('Runtime.evaluate');

  socket.dispatchEvent(new Event('close'));

  await assert.rejects(response, /CDP socket closed/);
});

