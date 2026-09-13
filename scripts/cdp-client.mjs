const DEFAULT_COMMAND_TIMEOUT_MS = 10_000;

export class CdpClient {
  constructor(ws, commandTimeoutMs = DEFAULT_COMMAND_TIMEOUT_MS) {
    this.ws = ws;
    this.commandTimeoutMs = commandTimeoutMs;
    this.id = 1;
    this.callbacks = new Map();
    this.eventListeners = new Map();

    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data.toString());
      if (msg.id && this.callbacks.has(msg.id)) {
        const callback = this.callbacks.get(msg.id);
        clearTimeout(callback.timer);
        this.callbacks.delete(msg.id);
        if (msg.error) callback.reject(new Error(msg.error.message || JSON.stringify(msg.error)));
        else callback.resolve(msg.result);
      } else if (msg.method && this.eventListeners.has(msg.method)) {
        for (const fn of this.eventListeners.get(msg.method)) fn(msg.params);
      }
    });

    const rejectPending = () => {
      for (const [id, callback] of this.callbacks) {
        clearTimeout(callback.timer);
        callback.reject(new Error(`CDP socket closed while waiting for command ${id}`));
      }
      this.callbacks.clear();
    };
    ws.addEventListener('close', rejectPending);
    ws.addEventListener('error', rejectPending);
  }

  on(event, fn) {
    if (!this.eventListeners.has(event)) this.eventListeners.set(event, []);
    this.eventListeners.get(event).push(fn);
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const msgId = this.id++;
      const timer = setTimeout(() => {
        this.callbacks.delete(msgId);
        reject(new Error(`CDP command timed out after ${this.commandTimeoutMs}ms: ${method}`));
      }, this.commandTimeoutMs);
      this.callbacks.set(msgId, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ id: msgId, method, params }));
    });
  }
}

export function waitForWebSocketOpen(ws, timeoutMs = DEFAULT_COMMAND_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`CDP WebSocket open timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    const cleanup = () => {
      clearTimeout(timer);
      ws.removeEventListener('open', onOpen);
      ws.removeEventListener('error', onError);
    };
    const onOpen = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error('CDP WebSocket failed to open'));
    };
    ws.addEventListener('open', onOpen);
    ws.addEventListener('error', onError);
  });
}
