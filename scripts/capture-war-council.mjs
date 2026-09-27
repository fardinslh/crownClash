import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { CdpClient, waitForWebSocketOpen } from './cdp-client.mjs';

// Captures CommanderScene ("War Council") screenshots across the Art Bible
// mobile viewport matrix after the text-resolution fix. Local macOS runner:
// serves apps/game/dist, drives headless Chrome over CDP, saves PNGs to
// qa-artifacts/screenshots. Read-only against the repo apart from artifacts.

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const DIST_DIR = path.resolve(REPO_ROOT, 'apps/game/dist');
const SCREENSHOTS_DIR = path.resolve(REPO_ROOT, 'qa-artifacts/screenshots');
const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

// Android 9 UA on a low-memory device: reproduces the legacy Bale canvas
// render profile (renderer canvas, renderScale 1, reducedEffects) from
// RenderProfile.selectRenderProfile.
const LEGACY_BALE_UA =
  'Mozilla/5.0 (Linux; Android 9; SM-J410F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/89.0.4383.105 Mobile Safari/537.36';

const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
};

function startStaticServer(port) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      let reqPath = req.url.split('?')[0];
      if (reqPath === '/') reqPath = '/index.html';
      const filePath = path.join(DIST_DIR, reqPath);
      if (!fs.existsSync(filePath)) {
        res.writeHead(404);
        res.end('Not Found');
        return;
      }
      const ext = path.extname(filePath);
      const mime = MIME_TYPES[ext] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': mime });
      fs.createReadStream(filePath).pipe(res);
    });
    server.listen(port, '127.0.0.1', () => resolve(server));
    server.on('error', reject);
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * @param {{width:number,height:number,dpr:number,label:string,file:string,uaOverride?:string,extraQuery?:string}} profile
 */
async function captureProfile(profile, serverPort, cdpPort) {
  const tempProfileDir = path.resolve(REPO_ROOT, `qa-artifacts/chrome-cmdr-${Date.now()}`);
  let server;
  let chromeProcess;
  let ws;

  try {
    server = await startStaticServer(serverPort);
    chromeProcess = spawn(CHROME_PATH, [
      '--headless=new',
      `--remote-debugging-port=${cdpPort}`,
      '--no-sandbox',
      '--disable-extensions',
      '--hide-scrollbars',
      `--user-data-dir=${tempProfileDir}`,
      'about:blank',
    ], { stdio: 'ignore' });
    await sleep(1500);

    const listRes = await fetch(`http://127.0.0.1:${cdpPort}/json/list`, {
      signal: AbortSignal.timeout(10_000),
    });
    const tabs = await listRes.json();
    const pageTab = tabs.find((t) => t.type === 'page') || tabs[0];
    ws = new WebSocket(pageTab.webSocketDebuggerUrl);
    await waitForWebSocketOpen(ws);

    const cdp = new CdpClient(ws);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');

    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: profile.width,
      height: profile.height,
      deviceScaleFactor: profile.dpr,
      mobile: true,
    });
    if (profile.uaOverride) {
      await cdp.send('Emulation.setUserAgentOverride', {
        userAgent: profile.uaOverride,
      });
    }

    const consoleErrors = [];
    cdp.on('Runtime.consoleAPICalled', (params) => {
      if (params.type === 'error') {
        consoleErrors.push(params.args.map((a) => a.value || a.description).join(' '));
      }
    });
    cdp.on('Runtime.exceptionThrown', (params) => {
      consoleErrors.push(params.exceptionDetails?.text || 'Uncaught exception');
    });

    const query = profile.extraQuery ? `&${profile.extraQuery}` : '';
    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${serverPort}/?${query.slice(1)}`.replace('?&', '?') });
    await sleep(3000);

    // Enter the War Council scene directly.
    await cdp.send('Runtime.evaluate', {
      expression: `(() => {
        const game = window.__PHASER_GAME__;
        if (game) game.scene.start('CommanderScene');
      })()`,
    });
    await sleep(1500);

    // Verify the scene actually rendered its cards and collect render state.
    const evalRes = await cdp.send('Runtime.evaluate', {
      expression: `(() => {
        const game = window.__PHASER_GAME__;
        const scene = game?.scene?.getScene('CommanderScene');
        if (!scene) return { error: 'CommanderScene not found' };
        const cards = scene.cards || [];
        const texts = [];
        scene.children.list.forEach((obj) => {
          if (obj.type === 'Text') texts.push(obj.text);
        });
        return {
          active: scene.scene.isActive(),
          cardCount: cards.length,
          textSample: texts.slice(0, 6),
          renderer: game.renderType === 2 ? 'webgl' : game.renderType === 1 ? 'canvas' : String(game.renderType),
          renderScale: game.registry.get('renderScale'),
          canvasWidth: game.canvas.width,
          canvasHeight: game.canvas.height,
        };
      })()`,
      returnByValue: true,
    });
    const state = evalRes.result?.value;
    console.log(`[${profile.label}] scene state:`, JSON.stringify(state));

    const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
    fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
    const outPath = path.join(SCREENSHOTS_DIR, profile.file);
    fs.writeFileSync(outPath, Buffer.from(shot.data, 'base64'));
    console.log(`[${profile.label}] saved ${outPath} (console errors: ${consoleErrors.length})`);
    if (consoleErrors.length) console.warn(`[${profile.label}] console errors:`, consoleErrors.slice(0, 4));

    return { profile, state, consoleErrors, outPath };
  } finally {
    try { if (ws && ws.readyState === WebSocket.OPEN) ws.close(); } catch {}
    try { chromeProcess?.kill('SIGKILL'); } catch {}
    try {
      if (server) {
        if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
        server.close();
      }
    } catch {}
    try {
      if (tempProfileDir && fs.existsSync(tempProfileDir)) {
        fs.rmSync(tempProfileDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
      }
    } catch {}
  }
}

async function main() {
  const profiles = [
    { width: 360, height: 800, dpr: 2, label: '360x800@2 webgl', file: 'war_council_360x800_dpr2.png' },
    { width: 390, height: 844, dpr: 2, label: '390x844@2 webgl', file: 'war_council_390x844_dpr2.png' },
    { width: 430, height: 932, dpr: 2, label: '430x932@2 webgl', file: 'war_council_430x932_dpr2.png' },
    {
      width: 360, height: 800, dpr: 1,
      label: '360x800@1 legacy-bale canvas',
      file: 'war_council_360x800_bale_canvas.png',
      uaOverride: LEGACY_BALE_UA,
      extraQuery: 'platform=bale',
    },
  ];

  const results = [];
  for (let i = 0; i < profiles.length; i++) {
    results.push(await captureProfile(profiles[i], 4210 + i, 9280 + i));
  }

  const failures = results.filter((r) => r.consoleErrors.length > 0 || r.state?.error);
  console.log('\n--- War Council capture summary ---');
  for (const r of results) {
    console.log(`${r.profile.label}: ${r.outPath} (renderer=${r.state?.renderer}, renderScale=${r.state?.renderScale}, cards=${r.state?.cardCount}, errors=${r.consoleErrors.length})`);
  }
  if (failures.length) {
    console.error('Capture FAILED for some profiles.');
    process.exit(1);
  }
  console.log('All War Council captures completed.');
}

main().catch((err) => {
  console.error('War Council capture runner error:', err);
  process.exit(1);
});
