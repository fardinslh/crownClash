import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { CdpClient, waitForWebSocketOpen } from './cdp-client.mjs';

// One-off probe: verifies at runtime that every CommanderScene text object
// rasterizes at resolution 2 after the blur fix (the pre-fix root cause was
// resolution-1 text textures upscaled by the camera zoom).

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST_DIR = path.resolve(REPO_ROOT, 'apps/game/dist');
const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

function startStaticServer(port) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      let reqPath = req.url.split('?')[0];
      if (reqPath === '/') reqPath = '/index.html';
      const filePath = path.join(DIST_DIR, reqPath);
      if (!fs.existsSync(filePath)) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': MIME_TYPES[path.extname(filePath)] || 'application/octet-stream' });
      fs.createReadStream(filePath).pipe(res);
    });
    server.listen(port, '127.0.0.1', () => resolve(server));
    server.on('error', reject);
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const tempProfileDir = path.resolve(REPO_ROOT, `qa-artifacts/chrome-probe-${Date.now()}`);
  let chromeProcess;
  let server;
  let ws;
  try {
    server = await startStaticServer(4225);
    chromeProcess = spawn(CHROME_PATH, [
      '--headless=new', '--remote-debugging-port=9295', '--no-sandbox',
      '--disable-extensions', '--hide-scrollbars',
      `--user-data-dir=${tempProfileDir}`, 'about:blank',
    ], { stdio: 'ignore' });
    await sleep(1500);

    const tabs = await (await fetch('http://127.0.0.1:9295/json/list')).json();
    ws = new WebSocket((tabs.find((t) => t.type === 'page') || tabs[0]).webSocketDebuggerUrl);
    await waitForWebSocketOpen(ws);
    const cdp = new CdpClient(ws);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 360, height: 800, deviceScaleFactor: 2, mobile: true });
    await cdp.send('Page.navigate', { url: 'http://127.0.0.1:4225/' });
    await sleep(3000);
    await cdp.send('Runtime.evaluate', {
      expression: `(() => { window.__PHASER_GAME__?.scene?.start('CommanderScene'); })()`,
    });
    await sleep(1200);

    const res = await cdp.send('Runtime.evaluate', {
      expression: `(() => {
        const scene = window.__PHASER_GAME__?.scene?.getScene('CommanderScene');
        if (!scene) return { error: 'scene missing' };
        const report = [];
        const walk = (obj) => {
          if (!obj) return;
          if (obj.type === 'Text') {
            report.push({
              text: String(obj.text).slice(0, 28),
              styleResolution: obj.style?.resolution,
              textureW: obj.canvas?.width,
              textureH: obj.canvas?.height,
              displayW: Math.round(obj.width),
            });
          }
          (obj.list || []).forEach(walk);
        };
        scene.children.list.forEach(walk);
        return {
          cameraZoom: scene.cameras.main.zoom,
          texts: report,
          allResolution2: report.length > 0 && report.every((t) => t.styleResolution === 2),
        };
      })()`,
      returnByValue: true,
    });
    console.log(JSON.stringify(res.result?.value, null, 2));
  } finally {
    try { ws?.close(); } catch {}
    try { chromeProcess?.kill('SIGKILL'); } catch {}
    try { server?.close(); } catch {}
    try { fs.rmSync(tempProfileDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); } catch {}
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
