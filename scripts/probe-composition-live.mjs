#!/usr/bin/env node
// Live composition probe: boots the real scene in headless Chrome, places
// magenta calibration markers at known logical coordinates, snapshots the
// renderer, and samples the composition layers at exact logical positions.
//
// Checks per battlefield (clean field, no armies):
//   - zone tint: the new floor zones are visibly tinted vs plain floor
//   - plinth pool: each socket's grounding plinth darkens the floor
//   - road surface: the rebuilt road reads distinctly from the floor
//   - sprite footprint: rendered building widths (absolute, per tier)
//   - empty-area texture: luminance spread inside a previously-empty zone
//     (a flat fill would measure ~0-2; the composed floor must exceed that)
//
// Usage: node scripts/probe-composition-live.mjs [battlefieldId ...]
// Defaults to all four battlefields. Requires the vite dev server
// (CC_QA_APP_URL, default http://localhost:3000/?benchmark_mode=1).

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { CdpClient, pickFreeCdpPort, waitForWebSocketOpen } from './cdp-client.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const APP_URL = process.env.CC_QA_APP_URL || 'http://localhost:3000/?benchmark_mode=1';
const VIEWPORT = { width: 360, height: 800, dpr: 2 };

const CHROME_CANDIDATES = [
  process.env.CC_QA_CHROME_BIN,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
].filter(Boolean);

function findChrome() {
  for (const candidate of CHROME_CANDIDATES) {
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // try the next candidate
    }
  }
  throw new Error('No Chrome binary found. Set CC_QA_CHROME_BIN.');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function evaluate(cdp, expression, { awaitPromise = false } = {}) {
  const res = await cdp.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise,
  });
  if (res.exceptionDetails) {
    throw new Error(`page eval failed: ${JSON.stringify(res.exceptionDetails)}`);
  }
  return res.result?.value;
}

// ---------------------------------------------------------------------------
// PNG decode (stdlib): 8-bit RGB or RGBA, non-interlaced
// ---------------------------------------------------------------------------

function decodePngBuffer(buf) {
  if (buf[0] !== 0x89 || buf.toString('ascii', 1, 4) !== 'PNG') {
    throw new Error('not a PNG');
  }
  let pos = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idat = [];
  while (pos < buf.length) {
    const length = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      if (data[12] !== 0) throw new Error('interlaced PNG unsupported');
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') break;
    pos += 12 + length;
  }
  if (bitDepth !== 8) throw new Error(`unsupported bit depth ${bitDepth}`);
  if (colorType !== 6 && colorType !== 2) throw new Error(`unsupported color type ${colorType}`);
  const bpp = colorType === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * bpp;
  const out = Buffer.alloc(height * stride);
  let inPos = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[inPos];
    inPos += 1;
    const row = raw.subarray(inPos, inPos + stride);
    inPos += stride;
    const prevBase = (y - 1) * stride;
    const base = y * stride;
    for (let x = 0; x < stride; x += 1) {
      const a = x >= bpp ? out[base + x - bpp] : 0;
      const b = y > 0 ? out[prevBase + x] : 0;
      const c = x >= bpp && y > 0 ? out[prevBase + x - bpp] : 0;
      let value = row[x];
      switch (filter) {
        case 0: break;
        case 1: value = (value + a) & 0xff; break;
        case 2: value = (value + b) & 0xff; break;
        case 3: value = (value + ((a + b) >> 1)) & 0xff; break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          value = (value + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff;
          break;
        }
        default: throw new Error(`unknown filter ${filter}`);
      }
      out[base + x] = value;
    }
  }
  return { width, height, bpp, data: out };
}

function px(img, x, y) {
  const i = (y * img.width + x) * img.bpp;
  return [img.data[i], img.data[i + 1], img.data[i + 2]];
}

function luma(p) {
  return 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2];
}

function patchMedian(img, cx, cy, half) {
  const chans = [[], [], []];
  for (let y = cy - half; y <= cy + half; y += 1) {
    for (let x = cx - half; x <= cx + half; x += 1) {
      if (x < 0 || y < 0 || x >= img.width || y >= img.height) continue;
      const p = px(img, x, y);
      chans[0].push(p[0]);
      chans[1].push(p[1]);
      chans[2].push(p[2]);
    }
  }
  return chans.map((arr) => {
    arr.sort((a, b) => a - b);
    return arr[arr.length >> 1];
  });
}

function colorDistance(a, b) {
  return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
}

function luminanceStd(img, cx, cy, half) {
  const values = [];
  for (let y = cy - half; y <= cy + half; y += 1) {
    for (let x = cx - half; x <= cx + half; x += 1) {
      if (x < 0 || y < 0 || x >= img.width || y >= img.height) continue;
      values.push(luma(px(img, x, y)));
    }
  }
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length);
}

// ---------------------------------------------------------------------------
// Per-battlefield probe definitions (logical coordinates from battlefields.json)
// ---------------------------------------------------------------------------

const PROBES = {
  crown_cross: {
    base: [200, 610],
    roadMid: [[200, 610], [85, 485]],
    zoneCenter: [140, 225], // NW plaza zone, on its mid paving joint
    zoneControl: [36, 320],
    groundPad: [40, 363], // tier-1 n_mid_left socket edge (r+8)
    groundControl: [140, 700],
  },
  twin_passes: {
    base: [200, 610],
    roadMid: [[200, 610], [100, 490]],
    zoneCenter: [130, 380], // west pass zone interior, clear of road/cairns
    zoneControl: [36, 346], // between cairn rows (266-334 and 358-426)
    groundPad: [65, 493], // tier-1 n_west_gate_s socket edge
    groundControl: [65, 400], // same pass zone, clear of sockets/roads
  },
  royal_ring: {
    base: [200, 610],
    roadMid: [[200, 610], [125, 505]],
    zoneCenter: [200, 360], // ring court center, clear of roads/sockets
    zoneControl: [36, 320],
    groundPad: [91, 508], // tier-1 n_ring_sw socket edge
    groundControl: [160, 430], // same ring zone, clear of sockets/roads
  },
  quad_citadel: {
    base: [310, 590],
    roadMid: [[310, 590], [285, 470]],
    zoneCenter: [240, 500], // SE quadrant zone, spanning its mid paving joint
    zoneControl: [36, 320],
    groundPad: [80, 473], // tier-1 a_gate_w socket edge
    groundControl: [140, 530], // same quadrant zone, clear of sockets/roads
  },
};

// ---------------------------------------------------------------------------
// Live probe
// ---------------------------------------------------------------------------

async function probeBattlefield(chromePath, battlefieldId) {
  const cdpPort = await pickFreeCdpPort();
  const profileDir = path.join(REPO_ROOT, `qa-artifacts/chrome-probe-${Date.now()}`);
  fs.mkdirSync(profileDir, { recursive: true });
  const chrome = spawn(
    chromePath,
    [
      '--headless=new',
      `--remote-debugging-port=${cdpPort}`,
      '--no-sandbox',
      '--disable-extensions',
      '--hide-scrollbars',
      `--user-data-dir=${profileDir}`,
      'about:blank',
    ],
    { stdio: 'ignore' }
  );

  try {
    let tabs = null;
    for (let attempt = 0; attempt < 40 && !tabs; attempt += 1) {
      await sleep(250);
      try {
        const res = await fetch(`http://127.0.0.1:${cdpPort}/json/list`, {
          signal: AbortSignal.timeout(2000),
        });
        tabs = (await res.json()).filter((t) => t.type === 'page');
      } catch {
        // Chrome not ready yet
      }
    }
    if (!tabs || tabs.length === 0) throw new Error('Chrome CDP endpoint never came up');
    const ws = new WebSocket(tabs[0].webSocketDebuggerUrl);
    await waitForWebSocketOpen(ws);
    const cdp = new CdpClient(ws);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');

    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: VIEWPORT.width,
      height: VIEWPORT.height,
      deviceScaleFactor: VIEWPORT.dpr,
      mobile: true,
    });
    await cdp.send('Page.navigate', { url: APP_URL });
    // Wait for the app to boot (the page occasionally comes up slowly under
    // a fresh headless profile; probing before __PHASER_GAME__ exists fails).
    let booted = false;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      await sleep(500);
      booted = await evaluate(
        cdp,
        `(() => window.__PHASER_GAME__ && window.__PHASER_GAME__.scene ? true : false)()`
      );
      if (booted === true) break;
    }
    if (booted !== true) throw new Error('app never booted (__PHASER_GAME__ missing)');

    await evaluate(
      cdp,
      `(() => {
        window.__PHASER_GAME__.scene.start('GameScene', {
          source: 'menu',
          botMatch: { matchId: 'probe_${battlefieldId}_' + Date.now(), battlefieldId: '${battlefieldId}' },
        });
        return 'started';
      })()`
    );
    // Wait for the requested scene to fully load. The first-launch menu can
    // auto-start the training battle (default battlefield) a beat after our
    // start and override it — re-issue the start until OUR battlefield is
    // the active one with all textures present.
    let loaded = false;
    let lastState = null;
    for (let attempt = 0; attempt < 30 && !loaded; attempt += 1) {
      await sleep(500);
      const raw = await evaluate(
        cdp,
        `(() => {
          const s = window.__PHASER_GAME__?.scene?.getScene('GameScene');
          if (!s || !s.gameState) return JSON.stringify(null);
          return JSON.stringify({ bf: s.battlefieldId, missing: [...(s.missingTerritoryTextures || [])].length });
        })()`
      );
      lastState = JSON.parse(raw);
      if (lastState && lastState.bf === battlefieldId && lastState.missing === 0) {
        loaded = true;
        break;
      }
      if (attempt % 4 === 3) {
        // The menu's auto-training overrode our start: claim the scene back.
        await evaluate(
          cdp,
          `(() => {
            window.__PHASER_GAME__.scene.start('GameScene', {
              source: 'menu',
              botMatch: { matchId: 'probe_${battlefieldId}_' + Date.now(), battlefieldId: '${battlefieldId}' },
            });
            return 'restarted';
          })()`
        );
      }
    }
    if (!loaded) {
      throw new Error(`scene never loaded ${battlefieldId} (last state: ${JSON.stringify(lastState)})`);
    }

    // Place two magenta markers at known logical coordinates, snapshot, and
    // read their pixel centers: exact logical->pixel mapping, no guessing.
    // Marker A uses the zone control (x=36 on every map) so the two markers
    // never share an X (royal_ring's zone center and base are both x=200).
    const spec = PROBES[battlefieldId];
    const markerA = spec.zoneControl;
    const markerB = spec.base;
    const markerBase64 = await evaluate(
      cdp,
      `new Promise((resolve, reject) => {
        const scene = window.__PHASER_GAME__.scene.getScene('GameScene');
        const markers = [
          scene.add.rectangle(${markerA[0]}, ${markerA[1]}, 10, 10, 0xff00ff),
          scene.add.rectangle(${markerB[0]}, ${markerB[1]}, 10, 10, 0xff00ff),
        ];
        markers.forEach((m) => m.setDepth(9999));
        const timeout = setTimeout(() => reject(new Error('snapshot timed out')), 8000);
        window.__PHASER_GAME__.renderer.snapshot((image) => {
          clearTimeout(timeout);
          markers.forEach((m) => m.destroy());
          const canvas = document.createElement('canvas');
          canvas.width = image.width;
          canvas.height = image.height;
          canvas.getContext('2d').drawImage(image, 0, 0);
          resolve(canvas.toDataURL('image/png').split(',')[1]);
        });
      })`,
      { awaitPromise: true }
    );
    const markerImg = decodePngBuffer(Buffer.from(markerBase64, 'base64'));
    // Two clusters: split found magenta points by y to separate the markers.
    const pts = [];
    for (let y = 0; y < markerImg.height; y += 1) {
      for (let x = 0; x < markerImg.width; x += 1) {
        const p = px(markerImg, x, y);
        if (p[0] > 200 && p[1] < 90 && p[2] > 200) pts.push([x, y]);
      }
    }
    if (pts.length === 0) throw new Error('calibration markers not visible in snapshot');
    pts.sort((a, b) => a[1] - b[1]);
    const split = pts.findIndex((p) => p[1] > pts[0][1] + 40);
    const clusters = split === -1 ? [pts] : [pts.slice(0, split), pts.slice(split)];
    const magentaClusters = clusters.map((cluster) => [
      Math.round(cluster.reduce((a, p) => a + p[0], 0) / cluster.length),
      Math.round(cluster.reduce((a, p) => a + p[1], 0) / cluster.length),
    ]);
    if (magentaClusters.length !== 2) {
      throw new Error(`expected 2 calibration markers, found ${magentaClusters.length}`);
    }
    // Marker A (upper) maps to zoneCenter, marker B (lower) to base.
    const [ax, ay] = magentaClusters[0];
    const [bx, by] = magentaClusters[1];
    const scaleX = (bx - ax) / (markerB[0] - markerA[0]);
    const offsetX = ax - markerA[0] * scaleX;
    const scaleY = (by - ay) / (markerB[1] - markerA[1]);
    const offsetY = ay - markerA[1] * scaleY;
    const toP = (lx, ly) => [Math.round(lx * scaleX + offsetX), Math.round(ly * scaleY + offsetY)];

    // Clean scene snapshot (markers destroyed) for all layer sampling.
    const sceneBase64 = await evaluate(
      cdp,
      `new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('snapshot timed out')), 8000);
        window.__PHASER_GAME__.renderer.snapshot((image) => {
          clearTimeout(timeout);
          const canvas = document.createElement('canvas');
          canvas.width = image.width;
          canvas.height = image.height;
          canvas.getContext('2d').drawImage(image, 0, 0);
          resolve(canvas.toDataURL('image/png').split(',')[1]);
        });
      })`,
      { awaitPromise: true }
    );
    const img = decodePngBuffer(Buffer.from(sceneBase64, 'base64'));

    const zone = patchMedian(img, ...toP(...spec.zoneCenter), 5);
    const zoneControl = patchMedian(img, ...toP(...spec.zoneControl), 5);
    const zoneTintDelta = colorDistance(zone, zoneControl);

    // Ground pad: the socket (with its new plinth pool) must read as a
    // distinct anchored pad against the floor — darker fill or lit rim both
    // count, as long as the pad edge is clearly not plain floor.
    const groundPad = patchMedian(img, ...toP(...spec.groundPad), 4);
    const groundControl = patchMedian(img, ...toP(...spec.groundControl), 4);
    const groundPadDistinct = colorDistance(groundPad, groundControl);
    const groundPadDarkening = Math.round((luma(groundControl) - luma(groundPad)) * 10) / 10;

    const floor = patchMedian(img, ...toP(...spec.groundControl), 4);
    const mid = [
      (spec.roadMid[0][0] + spec.roadMid[1][0]) / 2,
      (spec.roadMid[0][1] + spec.roadMid[1][1]) / 2,
    ];
    const road = patchMedian(img, ...toP(...mid), 3);
    const roadSurfaceDelta = colorDistance(road, floor);

    // Empty-area texture: luminance spread inside the zone (grid + zone tint
    // + motif lines give a composed floor; a flat fill would be ~0-2).
    const emptyTextureStd = luminanceStd(img, ...toP(...spec.zoneCenter), 28);

    // Authoritative runtime sprite sizes (visual-only; hit areas unchanged).
    const spriteSizes = JSON.parse(
      await evaluate(
        cdp,
        `(() => {
          const scene = window.__PHASER_GAME__.scene.getScene('GameScene');
          const byTier = {};
          for (const [id, v] of scene.territoryVisuals) {
            const tier = v.territory.tier;
            byTier[tier] = Math.max(byTier[tier] ?? 0, v.sprite.displayWidth);
          }
          return JSON.stringify(byTier);
        })()`
      )
    );
    const tier1SpriteLogicalWidth = spriteSizes['1'];
    const tier2SpriteLogicalWidth = spriteSizes['2'];
    const tier3SpriteLogicalWidth = spriteSizes['3'];

    return {
      battlefieldId,
      calibration: {
        scaleX: Math.round(scaleX * 1000) / 1000,
        scaleY: Math.round(scaleY * 1000) / 1000,
        offsetX: Math.round(offsetX * 10) / 10,
        offsetY: Math.round(offsetY * 10) / 10,
      },
      zoneTintDelta,
      zoneSamples: { zone, zoneControl, groundPad, groundControl, road },
      groundPadDistinct,
      groundPadDarkening,
      roadSurfaceDelta,
      emptyTextureStd: Math.round(emptyTextureStd * 10) / 10,
      spriteSizes,
      tier1SpriteLogicalWidth,
      tier2SpriteLogicalWidth,
      tier3SpriteLogicalWidth,
    };
  } finally {
    chrome.kill('SIGKILL');
    fs.rmSync(profileDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  }
}

async function main() {
  const requested = process.argv.slice(2);
  const battlefields = requested.length > 0 ? requested : Object.keys(PROBES);
  const chromePath = findChrome();
  let failed = 0;
  console.log(`live composition probe (viewport ${VIEWPORT.width}x${VIEWPORT.height} @dpr${VIEWPORT.dpr})`);
  for (const battlefieldId of battlefields) {
    let r = null;
    let lastError = null;
    for (let attempt = 0; attempt < 3 && r === null; attempt += 1) {
      try {
        r = await probeBattlefield(chromePath, battlefieldId);
      } catch (error) {
        lastError = error;
        console.log(`  (attempt ${attempt + 1} failed: ${error.message}; retrying)`);
        await sleep(1500);
      }
    }
    if (!r) {
      failed += 1;
      console.log(`\n${battlefieldId}: ERROR ${lastError?.message}`);
      continue;
    }
    console.log(`\n${battlefieldId}: calibration ${JSON.stringify(r.calibration)}`);
    console.log(`  samples ${JSON.stringify(r.zoneSamples)}`);
    console.log(
      `  zone tint delta=${r.zoneTintDelta}  ground-pad distinct=${r.groundPadDistinct} (darkening ${r.groundPadDarkening})  road surface delta=${r.roadSurfaceDelta}`
    );
    console.log(
      `  empty-area luminance std=${r.emptyTextureStd}  sprite sizes (runtime) tier1=${r.tier1SpriteLogicalWidth} tier2=${r.tier2SpriteLogicalWidth ?? 'n/a'} tier3=${r.tier3SpriteLogicalWidth}`
    );
    const hasTier2 = r.tier2SpriteLogicalWidth !== undefined;
    const checks = [
      ['zone tint visible (delta >= 10)', r.zoneTintDelta >= 10],
      ['ground pad anchors building (distinct >= 12)', r.groundPadDistinct >= 12],
      ['road surface distinct (delta >= 20)', r.roadSurfaceDelta >= 20],
      ['empty area is textured, not flat (std >= 3)', r.emptyTextureStd >= 3],
      ['tier-1 building sized for presence (72)', r.tier1SpriteLogicalWidth === 72],
      ...(hasTier2 ? [['tier-2 keep sized for presence (88)', r.tier2SpriteLogicalWidth === 88]] : []),
      ['tier-3 citadel sized for presence (102)', r.tier3SpriteLogicalWidth === 102],
    ];
    for (const [label, ok] of checks) {
      if (!ok) failed += 1;
      console.log(`  ${ok ? 'PASS' : 'FAIL'} ${label}`);
    }
  }
  console.log(failed === 0 ? '\nLIVE COMPOSITION PROBE PASSED' : `\nLIVE COMPOSITION PROBE FAILED (${failed} checks)`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
