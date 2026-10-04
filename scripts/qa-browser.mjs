import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function findQaChrome() {
  const candidates = [process.env.CC_QA_CHROME_BIN,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'];
  for (const candidate of candidates.filter(Boolean)) {
    try { fs.accessSync(candidate, fs.constants.X_OK); return candidate; } catch {}
  }
  throw new Error('No Chrome binary found; set CC_QA_CHROME_BIN.');
}

export function createQaProfile(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export function assertLocalQaUrl(appUrl) {
  const url = new URL(appUrl);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
      !['http:', 'https:'].includes(url.protocol)) {
    throw new Error('QA requires a loopback app URL and a disposable browser profile.');
  }
  return url;
}

export function classifyQaRequest(request, appUrl, missingAsset) {
  const app = assertLocalQaUrl(appUrl);
  const url = new URL(request.url);
  if (url.origin !== app.origin || request.method !== 'GET') return 'blocked';
  const staticPath = url.pathname === '/' || /\.(?:html|js|css|json|webp|png|svg|woff2?|ttf|ogg|mp3|wav)$/.test(url.pathname);
  if (!staticPath || /^\/(?:v2|api)\//.test(url.pathname)) return 'blocked';
  if (missingAsset === 'ground' && url.pathname.includes('/assets/grounds/')) return 'missing';
  if (missingAsset === 'building' && /\/assets\/territories\/[^/]+\/.*(?:citadel|outpost).*\.(?:webp|png)$/.test(url.pathname)) return 'missing';
  return 'allowed';
}

/** Allows only static requests to the loopback app, including when a build embeds a production API URL. */
export async function isolateQaRequests(cdp, appUrl, { missingAsset } = {}) {
  assertLocalQaUrl(appUrl);
  const pending = new Set();
  const failures = [];
  const blocked = [];
  cdp.on('Fetch.requestPaused', (event) => {
    const task = (async () => {
      const action = classifyQaRequest(event.request, appUrl, missingAsset);
      if (action === 'allowed') {
        await cdp.send('Fetch.continueRequest', { requestId: event.requestId });
      } else {
        if (action === 'blocked') blocked.push({ url: event.request.url, method: event.request.method });
        await cdp.send('Fetch.fulfillRequest', {
          requestId: event.requestId,
          responseCode: action === 'missing' ? 404 : 503,
          responseHeaders: [{ name: 'Access-Control-Allow-Origin', value: '*' }, { name: 'Content-Type', value: 'application/json' }],
          body: Buffer.from(JSON.stringify({ error: 'isolated_local_qa' })).toString('base64'),
        });
      }
    })().catch((error) => failures.push(error)).finally(() => pending.delete(task));
    pending.add(task);
  });
  await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] });
  return {
    blocked,
    async assertHealthy() {
      await Promise.all(pending);
      if (failures.length) throw new Error(`QA network isolation failed: ${failures.map((e) => e.message).join('; ')}`);
    },
  };
}
