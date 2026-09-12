import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Import our pure benchmark calculators and deterministic scenario definitions
import {
  computeBenchmarkMetrics,
  verifyPrerequisites,
} from '../apps/game/src/debug/benchmark/BenchmarkMetricsCalculator.ts';
import {
  SCENARIO_DEFINITIONS,
} from '../apps/game/src/debug/benchmark/DeterministicScenarioDriver.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const DIST_DIR = path.resolve(REPO_ROOT, 'apps/game/dist');
const SUMMARIES_DIR = path.resolve(REPO_ROOT, 'qa-artifacts/summaries');
const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
};

function startStaticServer(port = 4190) {
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

    server.listen(port, '127.0.0.1', () => {
      resolve(server);
    });
    server.on('error', reject);
  });
}

class CdpClient {
  constructor(ws) {
    this.ws = ws;
    this.id = 1;
    this.callbacks = new Map();
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data.toString());
      if (msg.id && this.callbacks.has(msg.id)) {
        const { resolve, reject } = this.callbacks.get(msg.id);
        this.callbacks.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error)));
        else resolve(msg.result);
      }
    };
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const msgId = this.id++;
      this.callbacks.set(msgId, { resolve, reject });
      this.ws.send(JSON.stringify({ id: msgId, method, params }));
    });
  }
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function runDeterministicBenchmark(options = {}) {
  const scenarioName = options.scenario || 'normal_combat';
  const scenarioDef = SCENARIO_DEFINITIONS[scenarioName];
  if (!scenarioDef) {
    throw new Error(`Unknown scenario: ${scenarioName}`);
  }

  const durationSec = options.durationSeconds ?? scenarioDef.config.durationSeconds;
  const viewport = options.viewport || { width: 375, height: 667, dpr: 2 };
  const cpuThrottling = options.cpuThrottling ?? 4;
  const disableWebgl = Boolean(options.disableWebgl);
  const slow4G = Boolean(options.slow4G);
  const rendererType = disableWebgl ? 'Canvas' : 'WebGL';
  const port = options.port || 4191;
  const cdpPort = options.cdpPort || 9251;
  const seed = options.seed ?? scenarioDef.config.seed;

  console.log(`\n======================================================`);
  console.log(`Deterministic Scenario: ${scenarioName} (${durationSec}s)`);
  console.log(`Viewport: ${viewport.width}x${viewport.height}@${viewport.dpr} | CPU: ${cpuThrottling}x | Renderer: ${rendererType} | Network: ${slow4G ? 'Slow 4G' : 'LAN'}`);
  console.log(`PRNG Seed: ${seed} | Host: Browser Emulation (Headless Chrome on Windows)`);
  console.log(`======================================================`);

  if (!fs.existsSync(DIST_DIR)) {
    throw new Error(`Dist directory not found: ${DIST_DIR}. Run 'npm run build' first.`);
  }

  const server = await startStaticServer(port);
  const tempProfileDir = path.resolve(REPO_ROOT, 'qa-artifacts/chrome-profile');

  const chromeFlags = [
    '--headless=new',
    `--remote-debugging-port=${cdpPort}`,
    '--no-sandbox',
    '--disable-extensions',
    '--hide-scrollbars',
    `--user-data-dir=${tempProfileDir}`,
    'about:blank',
  ];
  if (disableWebgl) {
    chromeFlags.push('--disable-webgl', '--disable-3d-apis');
  } else {
    chromeFlags.push('--disable-gpu');
  }

  const chromeProcess = spawn(CHROME_PATH, chromeFlags, { stdio: 'ignore' });
  await sleep(1500);

  try {
    const listRes = await fetch(`http://127.0.0.1:${cdpPort}/json/list`);
    const tabs = await listRes.json();
    const pageTab = tabs.find((t) => t.type === 'page') || tabs[0];
    const ws = new WebSocket(pageTab.webSocketDebuggerUrl);

    await new Promise((res, rej) => {
      ws.onopen = res;
      ws.onerror = rej;
    });

    const cdp = new CdpClient(ws);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');

    // Emulate device metrics
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: viewport.dpr,
      mobile: true,
    });

    // Emulate CPU throttling
    if (cpuThrottling > 1) {
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpuThrottling });
    }

    // Emulate Network throttling if requested
    if (slow4G) {
      await cdp.send('Network.enable');
      await cdp.send('Network.emulateNetworkConditions', {
        offline: false,
        latency: 150,
        downloadThroughput: (500 * 1024) / 8,
        uploadThroughput: (500 * 1024) / 8,
        connectionType: 'cellular3g',
      });
    }

    // Inject authoritative measurement probe before DOM boot
    const preBootProbeScript = `
      window.__AUTHORITATIVE_PROBE__ = {
        renderFrames: [],
        simulationTicks: 0,
        longTasks: [],
        armyCounts: [],
        peakObjects: 0,
        peakTweens: 0,
        totalDrawCalls: 0,
        startMemory: null,
        peakMemory: null,
        startTime: 0,
        lastRenderTime: 0,
        isSampling: false,
        actualRenderer: 'Unknown',
        gameAttached: false,
        schedule: null,
        scheduleIndex: 0,
        scenarioName: '',
      };

      // Intercept draw calls on WebGL
      const origGetContext = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function(type, ...rest) {
        const ctx = origGetContext.call(this, type, ...rest);
        if (!ctx) return ctx;

        if (type === 'webgl' || type === 'webgl2') {
          window.__AUTHORITATIVE_PROBE__.actualRenderer = 'WebGL';
          const origDrawArrays = ctx.drawArrays;
          ctx.drawArrays = function(...args) {
            if (window.__AUTHORITATIVE_PROBE__.isSampling) {
              window.__AUTHORITATIVE_PROBE__.totalDrawCalls++;
            }
            return origDrawArrays.apply(this, args);
          };
          const origDrawElements = ctx.drawElements;
          ctx.drawElements = function(...args) {
            if (window.__AUTHORITATIVE_PROBE__.isSampling) {
              window.__AUTHORITATIVE_PROBE__.totalDrawCalls++;
            }
            return origDrawElements.apply(this, args);
          };
        } else if (type === '2d') {
          if (window.__AUTHORITATIVE_PROBE__.actualRenderer === 'Unknown') {
            window.__AUTHORITATIVE_PROBE__.actualRenderer = 'Canvas';
          }
          const origDrawImage = ctx.drawImage;
          ctx.drawImage = function(...args) {
            if (window.__AUTHORITATIVE_PROBE__.isSampling) {
              window.__AUTHORITATIVE_PROBE__.totalDrawCalls++;
            }
            return origDrawImage.apply(this, args);
          };
        }
        return ctx;
      };

      // Observe long tasks
      try {
        const observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            if (window.__AUTHORITATIVE_PROBE__.isSampling) {
              window.__AUTHORITATIVE_PROBE__.longTasks.push({
                startTime: entry.startTime,
                duration: entry.duration,
              });
            }
          }
        });
        observer.observe({ entryTypes: ['longtask'] });
      } catch (e) {}

      // Authoritative subscription helper
      window.__ATTACH_PHASER_PROBE__ = function(game) {
        if (!game || window.__AUTHORITATIVE_PROBE__.gameAttached) return;
        window.__AUTHORITATIVE_PROBE__.gameAttached = true;

        if (game.renderer) {
          window.__AUTHORITATIVE_PROBE__.actualRenderer = game.renderer.type === 1 ? 'Canvas' : 'WebGL';
        }

        // Authoritative simulation step tick
        game.events.on('step', (time, delta) => {
          const probe = window.__AUTHORITATIVE_PROBE__;
          if (!probe.isSampling) return;
          probe.simulationTicks++;

          const scene = game.scene?.getScene('GameScene');
          if (scene && scene.gameState) {
            // Keep status playing throughout benchmark
            scene.gameState.status = 'playing';

            // Top up bases if depleted
            if (scene.gameState.territories?.p_base && scene.gameState.territories.p_base.units < 15) {
              scene.gameState.territories.p_base.units = 30;
              scene.gameState.territories.p_base.owner = 'player';
            }
            if (scene.gameState.territories?.e_base && scene.gameState.territories.e_base.units < 15) {
              scene.gameState.territories.e_base.units = 30;
              scene.gameState.territories.e_base.owner = 'enemy';
            }

            // Execute scheduled dispatches synchronously on simulation tick
            if (probe.schedule && probe.schedule.length > 0) {
              const elapsedSec = (performance.now() - probe.startTime) / 1000;
              while (probe.scheduleIndex < probe.schedule.length && probe.schedule[probe.scheduleIndex].timeSec <= elapsedSec) {
                const d = probe.schedule[probe.scheduleIndex++];
                const src = scene.gameState.territories[d.sourceId];
                const dst = scene.gameState.territories[d.targetId];
                if (src && dst) {
                  if (src.units < d.units) src.units = d.units + 10;
                  src.owner = d.owner;
                  window.__benchSeq = (window.__benchSeq || 0) + 1;
                  const dist = Math.hypot(dst.x - src.x, dst.y - src.y);
                  const durationSeconds = Math.max(1.2, dist / 130);
                  const speed = 1 / durationSeconds; // progress per second
                  const army = {
                    id: 'bench_' + window.__benchSeq,
                    owner: d.owner,
                    units: d.units,
                    sourceId: src.id,
                    targetId: dst.id,
                    startX: src.x,
                    startY: src.y,
                    targetX: dst.x,
                    targetY: dst.y,
                    progress: 0,
                    speed,
                    distance: dist,
                  };
                  src.units = Math.max(1, src.units - d.units);
                  scene.gameState.armies.push(army);
                  if (typeof scene.markTerritoriesDirty === 'function') {
                    scene.markTerritoriesDirty();
                  }
                }
              }
            }
          }
        });

        // Authoritative post-render frame event
        game.events.on('postrender', (renderer, time, delta) => {
          const probe = window.__AUTHORITATIVE_PROBE__;
          if (!probe.isSampling) return;

          const now = performance.now();
          const frameDelta = probe.lastRenderTime > 0 ? (now - probe.lastRenderTime) : delta;
          probe.lastRenderTime = now;

          probe.renderFrames.push({
            timestampMs: now,
            deltaMs: Math.round(frameDelta * 100) / 100,
          });

          // Sample scene peaks periodically (every 5 frames)
          if (probe.renderFrames.length % 5 === 0) {
            const scene = game.scene?.getScene('GameScene');
            if (scene) {
              const objs = scene.children?.list?.length ?? 0;
              if (objs > probe.peakObjects) probe.peakObjects = objs;
              const tweens = scene.tweens?.getTweens?.()?.length ?? 0;
              if (tweens > probe.peakTweens) probe.peakTweens = tweens;
              const armies = scene.gameState?.armies?.length ?? 0;
              probe.armyCounts.push(armies);
            }
            if (window.performance?.memory) {
              const mb = Math.round((window.performance.memory.usedJSHeapSize / (1024 * 1024)) * 10) / 10;
              if (probe.startMemory === null) probe.startMemory = mb;
              if (probe.peakMemory === null || mb > probe.peakMemory) probe.peakMemory = mb;
            }
          }
        });
      };

      window.__START_BENCHMARK_SCENARIO__ = function(schedule, scenarioName) {
        const probe = window.__AUTHORITATIVE_PROBE__;
        probe.schedule = schedule;
        probe.scheduleIndex = 0;
        probe.scenarioName = scenarioName;
        probe.startTime = performance.now();
        probe.lastRenderTime = performance.now();
        probe.isSampling = true;
      };
    `;

    await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source: preBootProbeScript,
    });

    // Navigate to app
    await cdp.send('Page.navigate', {
      url: `http://127.0.0.1:${port}/?debug_performance=1`,
    });

    // Wait for boot
    let booted = false;
    for (let i = 0; i < 60; i++) {
      await sleep(200);
      const res = await cdp.send('Runtime.evaluate', {
        expression: `Boolean(window.__PHASER_GAME__?.isBooted)`,
        returnByValue: true,
      });
      if (res?.result?.value) {
        booted = true;
        break;
      }
    }
    if (!booted) throw new Error('Phaser game boot timeout');

    // Attach probe to Phaser game
    await cdp.send('Runtime.evaluate', {
      expression: `window.__ATTACH_PHASER_PROBE__(window.__PHASER_GAME__)`,
    });

    // Start GameScene
    await cdp.send('Runtime.evaluate', {
      expression: `(() => {
        const game = window.__PHASER_GAME__;
        const activeScene = game.scene.getScenes(true)[0];
        activeScene.scene.start('GameScene', {
          source: 'menu',
          botMatch: { matchId: 'bench_${Date.now()}', battlefieldId: 'crown_cross' }
        });
      })()`,
    });
    await sleep(2000);

    // Prepare deterministic schedule
    const schedule = scenarioDef.generateSchedule(seed, durationSec);

    // If QA stress mode, activate via scene
    if (scenarioName === 'qa_stress') {
      await cdp.send('Runtime.evaluate', {
        expression: `(() => {
          const scene = window.__PHASER_GAME__?.scene?.getScene('GameScene');
          if (scene) {
            scene.isStressMode = true;
          }
        })()`,
      });
    }

    // Start active sampling with in-page schedule
    await cdp.send('Runtime.evaluate', {
      expression: `window.__START_BENCHMARK_SCENARIO__(${JSON.stringify(schedule)}, ${JSON.stringify(scenarioName)})`,
    });

    console.log(`Scenario running for ${durationSec}s...`);

    if (scenarioName === 'background_resume') {
      await sleep(5000);
      console.log('Emulating background hidden state for 10s...');
      await cdp.send('Runtime.evaluate', {
        expression: `(() => {
          const game = window.__PHASER_GAME__;
          game.events.emit('hidden');
          document.dispatchEvent(new Event('visibilitychange'));
        })()`,
      });
      await sleep(10000);
      console.log('Resuming from background state...');
      await cdp.send('Runtime.evaluate', {
        expression: `(() => {
          const game = window.__PHASER_GAME__;
          game.events.emit('visible');
          document.dispatchEvent(new Event('visibilitychange'));
        })()`,
      });
      const remainingMs = Math.max(0, (durationSec - 15) * 1000);
      await sleep(remainingMs);
    } else {
      await sleep(durationSec * 1000);
    }

    // Stop active sampling and retrieve raw probe data
    const evalRes = await cdp.send('Runtime.evaluate', {
      expression: `(() => {
        const probe = window.__AUTHORITATIVE_PROBE__;
        probe.isSampling = false;
        const endTime = performance.now();
        return {
          sampleDurationMs: Math.round(endTime - probe.startTime),
          renderFrames: probe.renderFrames,
          simulationTicks: probe.simulationTicks,
          longTasks: probe.longTasks,
          armyCountSamples: probe.armyCounts,
          peakObjects: probe.peakObjects,
          peakTweens: probe.peakTweens,
          memoryMb: { start: probe.startMemory, peak: probe.peakMemory },
          totalDrawCalls: probe.totalDrawCalls,
          actualRenderer: probe.actualRenderer,
        };
      })()`,
      returnByValue: true,
    });

    const rawData = evalRes?.result?.value;
    if (!rawData) {
      throw new Error('Failed to retrieve benchmark probe data from browser');
    }

    // Authoritative calculation & verification
    const metrics = computeBenchmarkMetrics(
      {
        sampleDurationMs: rawData.sampleDurationMs,
        renderFrames: rawData.renderFrames,
        simulationTicks: rawData.simulationTicks,
        longTasks: rawData.longTasks,
        armyCountSamples: rawData.armyCountSamples,
        peakObjects: rawData.peakObjects,
        peakTweens: rawData.peakTweens,
        memoryMb: rawData.memoryMb,
        totalDrawCalls: rawData.totalDrawCalls,
      },
      60 // target FPS bound
    );

    const verification = verifyPrerequisites(
      metrics,
      {
        renderer: rawData.actualRenderer,
        viewport,
        buildMode: 'production',
      },
      {
        expectedRenderer: rendererType,
        expectedViewport: viewport,
        expectedBuildMode: 'production',
        expectedDurationSeconds: durationSec,
        targetArmyRange: scenarioDef.config.targetArmyRange,
      }
    );

    const report = {
      id: `bench_${scenarioName}_${Date.now()}`,
      timestamp: new Date().toISOString(),
      environment: {
        host: 'Browser Emulation (Headless Chrome on Windows)',
        isPhysicalDevice: false,
        renderer: rawData.actualRenderer,
        viewport,
        cpuThrottling,
        network: slow4G ? 'Slow 4G' : 'LAN',
        buildMode: 'production',
        targetFps: 60,
      },
      scenario: {
        ...scenarioDef.config,
        durationSeconds: durationSec,
        seed,
      },
      metrics,
      verification,
    };

    console.log('\n--- AUTHORITATIVE BENCHMARK SUMMARY ---');
    console.log(`Presented FPS: ${metrics.presentedFps} (bounded by target 60 FPS) | Raw Rendered: ${metrics.renderedFps} FPS`);
    console.log(`Simulation Ticks: ${metrics.simulationTicks} (${metrics.simulationFps} ticks/sec)`);
    console.log(`Phaser Update Delta: avg ${metrics.phaserUpdateDelta.avgMs}ms | p50 ${metrics.phaserUpdateDelta.p50Ms}ms | p95 ${metrics.phaserUpdateDelta.p95Ms}ms | max ${metrics.phaserUpdateDelta.maxMs}ms`);
    console.log(`Frames >16.7ms: ${metrics.framesOver16Ms} (${metrics.framesOver16Pct}%) | >33.3ms: ${metrics.framesOver33Ms} (${metrics.framesOver33Pct}%)`);
    console.log(`Army Counts: min ${metrics.armyCounts.min} | avg ${metrics.armyCounts.avg} | peak ${metrics.armyCounts.peak}`);
    console.log(`Objects: peak ${metrics.peakObjects} | Tweens: peak ${metrics.peakTweens} | Heap: peak ${metrics.memoryMb.peak ?? 'N/A'}MB`);
    console.log(`Draw Calls / frame: ${metrics.drawCalls?.avgPerFrame ?? 'N/A'} (total: ${metrics.drawCalls?.total ?? 'N/A'})`);
    console.log(`Prerequisites Verification: ${verification.passed ? 'PASSED' : 'FAILED'}`);
    if (!verification.passed) {
      console.warn('Failures:', verification.failures);
    }

    if (!fs.existsSync(SUMMARIES_DIR)) {
      fs.mkdirSync(SUMMARIES_DIR, { recursive: true });
    }

    const outFilename = `${scenarioName}_${viewport.width}x${viewport.height}_cpu${cpuThrottling}x_${rendererType.toLowerCase()}${slow4G ? '_slow4g' : ''}.json`;
    const outPath = path.join(SUMMARIES_DIR, outFilename);
    fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
    console.log(`Saved small reviewable JSON summary to: ${outPath}\n`);

    return report;
  } finally {
    try {
      chromeProcess.kill();
    } catch {}
    try {
      server.close();
    } catch {}
    try {
      // Clean up temp user data profile
      if (fs.existsSync(tempProfileDir)) {
        fs.rmSync(tempProfileDir, { recursive: true, force: true });
      }
    } catch {}
  }
}

// CLI invocation
if (process.argv[1] && process.argv[1].endsWith('run-benchmark.mjs')) {
  const scenario = process.argv[2] || 'normal_combat';
  const duration = parseInt(process.argv[3] || '30', 10);
  const disableWebgl = process.argv.includes('--canvas');
  const slow4G = process.argv.includes('--slow4g');
  const cpuThrottling = process.argv.includes('--1x') ? 1 : 4;

  runDeterministicBenchmark({
    scenario,
    durationSeconds: duration,
    disableWebgl,
    slow4G,
    cpuThrottling,
  }).catch((err) => {
    console.error('Benchmark execution error:', err);
    process.exit(1);
  });
}
