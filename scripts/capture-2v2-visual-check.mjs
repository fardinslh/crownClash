import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { CdpClient, waitForWebSocketOpen } from './cdp-client.mjs';

// ── 2v2 Phase 5 visual QA captures ─────────────────────────────────────────
// Captures four scenarios (active match HUD, reconnect overlay,
// reconnect-failed, result modal) at three mobile viewports using a synthetic
// version-2 match payload. No server or real accounts are required: the scene
// is initialized exactly as MenuScene hands it a live match, with a stub
// LiveMatchClient, and the overlay/modal renderers are driven directly.
//
// Screenshots land in qa-artifacts/2v2-phase5/ (gitignored).

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const DIST_DIR = path.resolve(REPO_ROOT, 'apps/game/dist');
const OUT_DIR = path.resolve(REPO_ROOT, 'qa-artifacts/2v2-phase5');

const CHROME_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
];
const CHROME_PATH = CHROME_CANDIDATES.find((p) => fs.existsSync(p));

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

const VIEWPORTS = [
  { width: 360, height: 800, dpr: 2, name: '360x800' },
  { width: 390, height: 844, dpr: 2, name: '390x844' },
  { width: 430, height: 932, dpr: 2, name: '430x932' },
];

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
      res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
      fs.createReadStream(filePath).pipe(res);
    });
    server.listen(port, '127.0.0.1', () => resolve(server));
    server.on('error', reject);
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Synthetic quad_citadel projection (matches live2v2.go geometry): my team's
// two shared fortresses at the bottom, enemy fortresses top, neutral middle.
function synthetic2v2StartPayload() {
  const fortress = (id, name, x, y, owner) => ({
    id, name, x, y, radius: 36, owner, units: 20, maxUnits: 65,
    productionRate: 1.2, tier: 3, type: 'fortress',
  });
  const minor = (id, name, x, y, type) => ({
    id, name, x, y, radius: 27, owner: 'neutral', units: 8, maxUnits: 40,
    productionRate: 0.9, tier: 1, type,
  });
  const territories = {};
  for (const t of [
    fortress('a_base_w', 'West Bastion', 90, 590, 'player'),
    fortress('a_base_e', 'East Bastion', 310, 590, 'player'),
    fortress('b_base_w', 'North Citadel West', 90, 130, 'enemy'),
    fortress('b_base_e', 'North Citadel East', 310, 130, 'enemy'),
    minor('a_gate_w', 'South Gate West', 115, 470, 'barracks'),
    minor('a_gate_e', 'South Gate East', 285, 470, 'stable'),
    minor('b_gate_w', 'North Gate East', 285, 250, 'barracks'),
    minor('b_gate_e', 'North Gate West', 115, 250, 'stable'),
    minor('n_corner_sw', 'Southwest Spur', 60, 540, 'stable'),
    minor('n_corner_se', 'Southeast Spur', 340, 540, 'barracks'),
    minor('n_corner_nw', 'Northwest Spur', 60, 180, 'barracks'),
    minor('n_corner_ne', 'Northeast Spur', 340, 180, 'stable'),
    { id: 'n_center', name: 'Quad Keep', x: 200, y: 360, radius: 34, owner: 'neutral', units: 16, maxUnits: 55, productionRate: 1.15, tier: 2, type: 'fortress' },
  ]) {
    territories[t.id] = t;
  }
  const state = {
    battlefieldId: 'quad_citadel',
    territories,
    armies: [
      {
        id: '2v2_10_1_0_0', sourceId: 'a_base_w', targetId: 'a_gate_w', owner: 'player',
        units: 12, startX: 90, startY: 590, targetX: 115, targetY: 470,
        progress: 0.45, speed: 0.25, distance: 1,
      },
      {
        id: '2v2_10_2_1_0', sourceId: 'a_base_e', targetId: 'a_gate_e', owner: 'player',
        units: 9, startX: 310, startY: 590, targetX: 285, targetY: 470,
        progress: 0.3, speed: 0.25, distance: 1,
      },
      {
        id: '2v2_10_3_2_0', sourceId: 'b_base_w', targetId: 'b_gate_e', owner: 'enemy',
        units: 15, startX: 90, startY: 130, targetX: 115, targetY: 250,
        progress: 0.4, speed: 0.25, distance: 1,
      },
      {
        id: 'pred_0', sourceId: 'a_base_w', targetId: 'a_gate_w', owner: 'player',
        units: 6, startX: 90, startY: 590, targetX: 115, targetY: 470,
        progress: 0.15, speed: 0.25, distance: 1,
      },
    ],
    status: 'playing',
    elapsedTimeSeconds: 14,
    timeLimitSeconds: 90,
    stats: {
      matchDurationSeconds: 14,
      playerUnitsDispatched: 27,
      enemyUnitsDispatched: 15,
      territoriesCapturedByPlayer: 0,
      territoriesCapturedByEnemy: 0,
    },
  };
  return {
    matchId: 'qa2v2_visual_match',
    mode: '2v2',
    slot: 1,
    teamId: 'a',
    nextSequence: 1,
    players: [
      { slot: 0, teamId: 'a', userId: 'u0', displayName: 'Commander_8A2F' },
      { slot: 1, teamId: 'a', userId: 'u1', displayName: 'Commander_YOU' },
      { slot: 2, teamId: 'b', userId: 'u2', displayName: 'Commander_D44C' },
      { slot: 3, teamId: 'b', userId: 'u3', displayName: 'Commander_B901' },
    ],
    state,
  };
}

/** Hand-built view model matching TwoVTwoResultViewModel's output shape. */
function synthetic2v2ResultModel() {
  return {
    matchId: 'qa2v2_visual_match',
    cancelled: false,
    myStatus: 'victory',
    winnerTeamId: 'a',
    hasSettlements: true,
    teams: [
      {
        teamId: 'a', isMyTeam: true, isWinner: true,
        participants: [
          { slot: 0, teamId: 'a', label: 'A1', displayName: 'Commander_8A2F', status: 'victory', abandoned: false, unitsDispatched: 30, territoriesCaptured: 4, coinsAwarded: 65, isYou: false },
          { slot: 1, teamId: 'a', label: 'A2', displayName: 'Commander_YOU', status: 'victory', abandoned: false, unitsDispatched: 21, territoriesCaptured: 3, coinsAwarded: 55, isYou: true },
        ],
      },
      {
        teamId: 'b', isMyTeam: false, isWinner: false,
        participants: [
          { slot: 2, teamId: 'b', label: 'B1', displayName: 'Commander_D44C', status: 'defeat', abandoned: false, unitsDispatched: 18, territoriesCaptured: 1, coinsAwarded: 10, isYou: false },
          { slot: 3, teamId: 'b', label: 'B2', displayName: 'Commander_B901', status: 'defeat', abandoned: true, unitsDispatched: 7, territoriesCaptured: 0, coinsAwarded: 10, isYou: false },
        ],
      },
    ],
  };
}

async function captureScenario(viewport, scenario, serverPort, cdpPort) {
  const tempProfileDir = path.resolve(REPO_ROOT, `qa-artifacts/chrome-2v2vis-${Date.now()}-${Math.random().toString(36).slice(2)}`);
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
      '--mute-audio',
      `--user-data-dir=${tempProfileDir}`,
      'about:blank',
    ], { stdio: 'ignore' });
    // Poll for the debugger endpoint: Chrome cold-start can exceed 1.5s.
    let tabs = null;
    for (let attempt = 0; attempt < 40; attempt++) {
      await sleep(250);
      try {
        const listRes = await fetch(`http://127.0.0.1:${cdpPort}/json/list`, { signal: AbortSignal.timeout(2_000) });
        tabs = await listRes.json();
        if (Array.isArray(tabs) && tabs.length > 0) break;
      } catch {
        // Chrome not ready yet.
      }
    }
    if (!Array.isArray(tabs) || tabs.length === 0) {
      throw new Error(`Chrome debugger never came up on port ${cdpPort}`);
    }
    const pageTab = tabs.find((t) => t.type === 'page') || tabs[0];
    ws = new WebSocket(pageTab.webSocketDebuggerUrl);
    await waitForWebSocketOpen(ws);
    const cdp = new CdpClient(ws);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    // The Bale miniapp SDK in <head> is a parser-blocking external script;
    // in the capture sandbox it can never resolve. Block it so the module
    // bundle executes and the Browser platform adapter takes over.
    await cdp.send('Network.enable');
    await cdp.send('Network.setBlockedURLs', { urls: ['*tapi.bale.ai*'] });

    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: viewport.width, height: viewport.height,
      deviceScaleFactor: viewport.dpr, mobile: true,
    });

    const consoleErrors = [];
    cdp.on('Runtime.consoleAPICalled', (params) => {
      if (params.type === 'error') consoleErrors.push(params.args.map((a) => a.value || a.description).join(' '));
    });
    cdp.on('Runtime.exceptionThrown', (params) => {
      consoleErrors.push(params.exceptionDetails?.text || 'Uncaught exception');
    });

    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${serverPort}/` });
    await sleep(2500);

    const payloadJson = JSON.stringify(synthetic2v2StartPayload());
    const resultModelJson = JSON.stringify(synthetic2v2ResultModel());
    // Functions cannot travel through JSON: inject the stub as source.
    const stubSource = `{
      on: () => () => undefined,
      close: () => undefined,
      sendDispatch: () => 0,
      sendReady: () => undefined,
      sendSurrender: () => undefined,
      sendRematchVote: () => undefined,
    }`;

    const startEval = await cdp.send('Runtime.evaluate', {
      expression: `(() => {
        const game = window.__PHASER_GAME__;
        if (!game) return { ok: false, error: 'no game' };
        game.scene.start('GameScene', {
          source: 'menu',
          mode: 'live',
          liveClient: ${stubSource},
          liveMatch2v2: ${payloadJson},
        });
        return { ok: true };
      })()`,
      returnByValue: true,
    });
    await sleep(2600);

    const scenarioExpr = {
      active: `(() => {
        const game = window.__PHASER_GAME__;
        const scene = game?.scene?.getScene('GameScene');
        if (!scene) {
          return {
            ok: false,
            error: 'no scene',
            hasGame: Boolean(game),
            sceneKeys: game?.scene?.scenes?.map((s) => s.sys?.settings?.key) ?? null,
          };
        }
        if (scene.is2v2 !== true) return { ok: false, error: 'not in 2v2 mode' };
        if (scene.gameState?.status !== 'playing') return { ok: false, error: 'not playing' };
        return { ok: true, is2v2: true };
      })()`,
      reconnecting: `(() => {
        const scene = window.__PHASER_GAME__?.scene?.getScene('GameScene');
        scene['show2v2ReconnectOverlay'](1);
        return { ok: true };
      })()`,
      reconnect_failed: `(() => {
        const scene = window.__PHASER_GAME__?.scene?.getScene('GameScene');
        scene['hide2v2ReconnectOverlay']();
        scene['show2v2AbandonedOverlay']('reconnect_window_expired');
        return { ok: true };
      })()`,
      result: `(() => {
        const scene = window.__PHASER_GAME__?.scene?.getScene('GameScene');
        scene['hide2v2ReconnectOverlay']();
        scene['render2v2ResultModal'](${resultModelJson});
        return { ok: true };
      })()`,
    }[scenario];

    const evalRes = await cdp.send('Runtime.evaluate', {
      expression: scenarioExpr,
      returnByValue: true,
    });
    const val = evalRes.result?.value;
    if (!val || val.ok !== true) {
      throw new Error(`Scenario ${scenario} setup failed: ${JSON.stringify(val)}`);
    }
    await sleep(scenario === 'active' ? 500 : 700);

    // Each screenshot is backed by hard assertions on the live scene graph:
    // visual review catches composition issues while these checks prove the
    // exact HUD texts, shapes, overlay cards, and modal cells that must be
    // on screen are inspected programmatically before the frame is taken.
    const verifyExpr = `(() => {
      const scene = window.__PHASER_GAME__?.scene?.getScene('GameScene');
      if (!scene) return { ok: false, error: 'no scene' };
      // Walk the whole display tree (overlays live inside Containers).
      const texts = [];
      const walk = (entries) => {
        for (const o of entries ?? []) {
          if (o.type === 'Text') {
            texts.push({ text: o.text, x: Math.round(o.x), y: Math.round(o.y), visible: o.visible });
          } else if (o.type === 'Container' && o.list) {
            walk(o.list);
          }
        }
      };
      walk(scene.children?.list ?? []);
      const find = (needle) => texts.find((t) => t.visible && t.text && t.text.includes(needle));
      const scenario = '${scenario}';
      if (scenario === 'active') {
        const required = ['A1', 'A2', 'B1', 'B2', '★ YOU', 'Ally:', 'shared bases'];
        const missing = required.filter((needle) => !find(needle));
        // Shared-base cue glyphs on fortresses (drawn as Text objects).
        const cueCount = texts.filter((t) => t.visible && t.text === '⧉').length;
        if (missing.length) return { ok: false, error: 'missing HUD texts: ' + missing.join(','), texts: texts.map((t) => t.text) };
        if (cueCount !== 4) return { ok: false, error: 'expected 4 shared-cue glyphs, found ' + cueCount };
        // Slot-attributed army badges (shape + role + units).
        const armyBadges = texts.filter((t) => /●|▲|■|◆/.test(t.text) && /SPD|DEF|PROD/.test(t.text));
        if (armyBadges.length < 3) return { ok: false, error: 'expected >=3 slot-attributed army badges, found ' + armyBadges.length, badges: armyBadges.map((t) => t.text) };
        return { ok: true, cueCount, armyBadges: armyBadges.map((t) => t.text) };
      }
      if (scenario === 'reconnecting') {
        if (!find('CONNECTION LOST')) return { ok: false, error: 'reconnect overlay title missing' };
        if (!find('Reconnecting')) return { ok: false, error: 'reconnect progress missing' };
        return { ok: true };
      }
      if (scenario === 'reconnect_failed') {
        if (!find('MATCH ABANDONED')) return { ok: false, error: 'abandoned title missing' };
        if (!find('RETURN TO MENU')) return { ok: false, error: 'return-to-menu button missing' };
        if (!find('reconnect window expired')) return { ok: false, error: 'terminal code missing' };
        return { ok: true };
      }
      if (scenario === 'result') {
        if (!find('VICTORY!')) return { ok: false, error: 'result title missing' };
        if (!find('CASUAL MATCH')) return { ok: false, error: 'casual notice missing' };
        for (const label of ['A1', 'A2', 'B1', 'B2', '★YOU', 'VOTE REMATCH', 'ABANDONED']) {
          if (!find(label)) return { ok: false, error: 'result cell missing: ' + label };
        }
        if (!find('no trophy changes')) return { ok: false, error: 'no-trophy copy missing' };
        return { ok: true };
      }
      return { ok: false, error: 'unknown scenario ' + scenario };
    })()`;
    const verifyRes = await cdp.send('Runtime.evaluate', {
      expression: verifyExpr,
      returnByValue: true,
    });
    const verified = verifyRes.result?.value;
    if (!verified || verified.ok !== true) {
      throw new Error(`Visual verification failed for ${scenario}: ${JSON.stringify(verified)}`);
    }
    console.log(`Verified scene graph for ${scenario} @ ${viewport.name}: ${JSON.stringify(verified)}`);

    const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
    if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
    const outPath = path.join(OUT_DIR, `2v2_${scenario}_${viewport.name}.png`);
    fs.writeFileSync(outPath, Buffer.from(shot.data, 'base64'));
    console.log(`Saved ${outPath}`);
    return { consoleErrors };
  } finally {
    try { if (ws && ws.readyState === WebSocket.OPEN) ws.close(); } catch {}
    try {
      if (chromeProcess?.pid) chromeProcess.kill('SIGKILL');
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
  if (!CHROME_PATH) {
    console.error('No Chrome binary found. Cannot capture 2v2 visual QA screenshots.');
    process.exit(2);
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const allErrors = [];
  let port = 4200;
  let cdpPort = 9300;
  for (const viewport of VIEWPORTS) {
    for (const scenario of ['active', 'reconnecting', 'reconnect_failed', 'result']) {
      port += 1;
      cdpPort += 1;
      const { consoleErrors } = await captureScenario(viewport, scenario, port, cdpPort);
      allErrors.push(...consoleErrors);
      await sleep(300);
    }
  }
  if (allErrors.length > 0) {
    console.error('Console errors during captures:', allErrors);
    process.exit(1);
  }
  console.log('All 2v2 visual captures completed with zero console errors.');
}

main().catch((err) => {
  console.error('2v2 visual capture runner error:', err);
  process.exit(1);
});
