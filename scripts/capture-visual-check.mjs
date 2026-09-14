import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { CdpClient, waitForWebSocketOpen } from './cdp-client.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const DIST_DIR = path.resolve(REPO_ROOT, 'apps/game/dist');
const SCREENSHOTS_DIR = path.resolve(REPO_ROOT, 'qa-artifacts/screenshots');
const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BATTLEFIELD_ID = process.argv[2] || 'crown_cross';

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

function startStaticServer(port = 4195) {
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

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function captureViewportScreenshot(viewport, filename, serverPort, cdpPort) {
  const tempProfileDir = path.resolve(REPO_ROOT, `qa-artifacts/chrome-vis-${Date.now()}`);

  let server;
  let chromeProcess;
  let ws;

  try {
    server = await startStaticServer(serverPort);
    const chromeFlags = [
      '--headless=new',
      `--remote-debugging-port=${cdpPort}`,
      '--no-sandbox',
      '--disable-extensions',
      '--hide-scrollbars',
      `--user-data-dir=${tempProfileDir}`,
      'about:blank',
    ];

    chromeProcess = spawn(CHROME_PATH, chromeFlags, { stdio: 'ignore' });
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
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: viewport.dpr,
      mobile: true,
    });

    const consoleErrors = [];
    cdp.on('Runtime.consoleAPICalled', (params) => {
      if (params.type === 'error') {
        consoleErrors.push(params.args.map((a) => a.value || a.description).join(' '));
      }
    });
    cdp.on('Runtime.exceptionThrown', (params) => {
      consoleErrors.push(params.exceptionDetails?.text || 'Uncaught exception');
    });

    // Navigate to game
    const targetUrl = `http://127.0.0.1:${serverPort}/?benchmark_mode=1`;
    await cdp.send('Page.navigate', { url: targetUrl });
    await sleep(2500);

    // Transition into GameScene
    await cdp.send('Runtime.evaluate', {
      expression: `(() => {
        const game = window.__PHASER_GAME__;
        if (game) {
          game.scene.start('GameScene', {
            source: 'menu',
            botMatch: { matchId: 'vis_' + Date.now(), battlefieldId: '${BATTLEFIELD_ID}' }
          });
        }
      })()`,
    });
    await sleep(1500);

    // Dispatch active armies across multiple lanes
    await cdp.send('Runtime.evaluate', {
      expression: `(() => {
        const scene = window.__PHASER_GAME__?.scene?.getScene('GameScene');
        if (scene && typeof scene.executeQaDispatch === 'function') {
          const territories = Object.values(scene.gameState?.territories || {});
          const playerBase = territories.find(t => t.owner === 'player');
          const enemyBase = territories.find(t => t.owner === 'enemy');
          const neutrals = territories.filter(t => t.owner === 'neutral');
          const nearest = (base) => [...neutrals].sort((a, b) =>
            Math.hypot(a.x - base.x, a.y - base.y) - Math.hypot(b.x - base.x, b.y - base.y)
          );
          const playerTargets = playerBase ? nearest(playerBase).slice(0, 2) : [];
          const enemyTargets = enemyBase ? nearest(enemyBase).slice(0, 2) : [];
          playerTargets.forEach(target => scene.executeQaDispatch(playerBase.id, target.id, 'player'));
          enemyTargets.forEach(target => scene.executeQaDispatch(enemyBase.id, target.id, 'enemy'));
        }
      })()`,
    });

    // Wait briefly so armies remain visible mid-field on fast simulations.
    console.log(`Waiting for marching armies at ${viewport.width}x${viewport.height}@${viewport.dpr}...`);
    await sleep(300);

    // Inspect army visual game objects in active scene
    const evalRes = await cdp.send('Runtime.evaluate', {
      expression: `(() => {
        const scene = window.__PHASER_GAME__?.scene?.getScene('GameScene');
        const visuals = scene?.armyVisuals;
        const armies = visuals ? Array.from(visuals.values()) : [];
        return {
          armiesCount: armies.length,
          hasArmies: armies.length >= 2,
          allHaveImageShadows: armies.length > 0 && armies.every(a => a.leaderShadow && a.leaderShadow.type === 'Image'),
          allHaveImageAuras: armies.length > 0 && armies.every(a => a.roleAura && a.roleAura.type === 'Image'),
          allHaveImageBadges: armies.length > 0 && armies.every(a => a.badgeBg && a.badgeBg.type === 'Image'),
          allBadgesHaveText: armies.every(a => a.badgeText && a.badgeText.text && a.badgeText.text.length > 0),
          badgeTexts: armies.map(a => a.badgeText.text),
        };
      })()`,
      returnByValue: true,
    });

    const val = evalRes.result?.value;
    console.log('Army Visuals Verification:', val);

    if (!val || !val.hasArmies || !val.allHaveImageShadows || !val.allHaveImageAuras || !val.allHaveImageBadges) {
      throw new Error(`Visual verification failed: ${JSON.stringify(val)}`);
    }

    // Capture screenshot
    const screenshotData = await cdp.send('Page.captureScreenshot', { format: 'png' });
    if (!fs.existsSync(SCREENSHOTS_DIR)) {
      fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
    }

    const outPath = path.join(SCREENSHOTS_DIR, filename);
    fs.writeFileSync(outPath, Buffer.from(screenshotData.data, 'base64'));
    console.log(`Saved screenshot to: ${outPath}`);

    if (consoleErrors.length > 0) {
      console.warn('Console errors detected:', consoleErrors);
    } else {
      console.log('Zero console errors detected.');
    }

    return {
      success: true,
      visualsData: val,
      consoleErrors,
    };
  } finally {
    try { if (ws && ws.readyState === WebSocket.OPEN) ws.close(); } catch {}
    try {
      if (chromeProcess && chromeProcess.pid) {
        if (process.platform === 'win32') {
          try { execSync(`taskkill /pid ${chromeProcess.pid} /T /F`, { stdio: 'ignore' }); } catch {}
        }
        chromeProcess.kill('SIGKILL');
      }
    } catch {}
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
  console.log(`--- Visual Verification Check: ${BATTLEFIELD_ID} ---`);
  // Viewport 1: 375x667 @ 2 (iPhone SE / compact mobile)
  const res1 = await captureViewportScreenshot(
    { width: 375, height: 667, dpr: 2 },
    `visual_check_${BATTLEFIELD_ID}_375x667.png`,
    4197,
    9265
  );

  // Viewport 2: 430x932 @ 2 (iPhone 16 Pro Max / large mobile)
  const res2 = await captureViewportScreenshot(
    { width: 430, height: 932, dpr: 2 },
    `visual_check_${BATTLEFIELD_ID}_430x932.png`,
    4198,
    9266
  );

  if (res1.consoleErrors.length === 0 && res2.consoleErrors.length === 0) {
    console.log('\nVisual verification PASSED: Both viewports rendered cleanly with 0 console errors.');
  } else {
    console.error('\nVisual verification FAILED due to console errors.');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Visual verification runner error:', err);
  process.exit(1);
});
