import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Import pure benchmark calculators and deterministic scenario definitions
import {
  computeBenchmarkMetrics,
  verifyPrerequisites,
} from '../apps/game/src/debug/benchmark/BenchmarkMetricsCalculator.ts';
import {
  SCENARIO_DEFINITIONS,
  computeScheduleHash,
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
    this.eventListeners = new Map();
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data.toString());
      if (msg.id && this.callbacks.has(msg.id)) {
        const { resolve, reject } = this.callbacks.get(msg.id);
        this.callbacks.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error)));
        else resolve(msg.result);
      } else if (msg.method && this.eventListeners.has(msg.method)) {
        for (const fn of this.eventListeners.get(msg.method)) {
          fn(msg.params);
        }
      }
    };
  }

  on(event, fn) {
    if (!this.eventListeners.has(event)) this.eventListeners.set(event, []);
    this.eventListeners.get(event).push(fn);
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
  const fast4G = Boolean(options.fast4G);
  const recordTrace = Boolean(options.recordTrace);
  const tracePath = options.tracePath;
  const injectLongTaskMs = Number(options.injectLongTaskMs || 0);
  const rendererType = disableWebgl ? 'Canvas' : 'WebGL';
  const networkName = slow4G ? 'Slow 4G' : fast4G ? 'Fast 4G' : 'LAN';
  const port = options.port || 4191;
  const cdpPort = options.cdpPort || 9251;
  const seed = options.seed ?? scenarioDef.config.seed;

  console.log(`\n======================================================`);
  console.log(`Deterministic Scenario: ${scenarioName} (${durationSec}s)`);
  console.log(`Viewport: ${viewport.width}x${viewport.height}@${viewport.dpr} | CPU: ${cpuThrottling}x | Renderer: ${rendererType} | Network: ${networkName}`);
  console.log(`PRNG Seed: ${seed} | Host: Browser Emulation (Headless Chrome on Windows)`);
  if (recordTrace) console.log(`Performance Tracing: ENABLED`);
  if (injectLongTaskMs > 0) console.log(`Synthetic Long Task Injection: ${injectLongTaskMs}ms`);
  console.log(`======================================================`);

  if (!fs.existsSync(DIST_DIR)) {
    throw new Error(`Dist directory not found: ${DIST_DIR}. Run 'npm run build' first.`);
  }

  let server;
  let chromeProcess;
  let ws;
  const tempProfileDir = path.resolve(REPO_ROOT, `qa-artifacts/chrome-profile-${Date.now()}`);

  try {
    server = await startStaticServer(port);

    // Real WebGL: Remove --disable-gpu for WebGL runs! Only disable when running pure Canvas mode.
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
    }

    chromeProcess = spawn(CHROME_PATH, chromeFlags, { stdio: 'ignore' });
    await sleep(1500);

    const listRes = await fetch(`http://127.0.0.1:${cdpPort}/json/list`);
    const tabs = await listRes.json();
    const pageTab = tabs.find((t) => t.type === 'page') || tabs[0];
    ws = new WebSocket(pageTab.webSocketDebuggerUrl);

    await new Promise((res, rej) => {
      ws.onopen = res;
      ws.onerror = rej;
    });

    const cdp = new CdpClient(ws);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');

    // Query browser version
    let browserVersion = 'HeadlessChrome';
    try {
      const versionInfo = await cdp.send('Browser.getVersion');
      browserVersion = versionInfo?.product || 'HeadlessChrome';
    } catch {}

    // Feature-detect CDP Page.setWebLifecycleState support
    let hasWebLifecycleControl = false;
    try {
      await cdp.send('Page.setWebLifecycleState', { state: 'active' });
      hasWebLifecycleControl = true;
    } catch {
      hasWebLifecycleControl = false;
    }

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
    } else if (fast4G) {
      await cdp.send('Network.enable');
      await cdp.send('Network.emulateNetworkConditions', {
        offline: false,
        latency: 40,
        downloadThroughput: (4 * 1024 * 1024) / 8,
        uploadThroughput: (3 * 1024 * 1024) / 8,
        connectionType: 'cellular4g',
      });
    }

    if (recordTrace) {
      console.log('Starting CDP Tracing (devtools.timeline, v8.execute)...');
      await cdp.send('Tracing.start', {
        traceConfig: {
          recordMode: 'recordUntilFull',
          includedCategories: [
            'devtools.timeline',
            'v8.execute',
            'disabled-by-default-devtools.timeline',
            'disabled-by-default-v8.cpu_profiler',
            'blink.user_timing',
          ],
        },
      });
    }

    // Inject authoritative measurement probe before DOM boot
    const preBootProbeScript = `
      window.__INJECT_LONG_TASK_MS__ = ${injectLongTaskMs};
      window.__LONG_TASK_INJECTED__ = false;
      window.__AUTHORITATIVE_PROBE__ = {
        renderFrames: [],
        simulationTicks: 0,
        longTasks: [],
        armySamples: [],
        peakObjects: 0,
        peakTweens: 0,
        totalDrawCalls: 0,
        startMemory: null,
        peakMemory: null,
        startTime: 0,
        lastRenderTime: 0,
        duplicateFramesDropped: 0,
        isSampling: false,
        actualRenderer: 'Unknown',
        gpuVendor: 'Unknown',
        gpuRenderer: 'Unknown',
        isSoftwareRenderer: false,
        lifecycleTransitions: [],
        gameAttached: false,
        schedule: null,
        scheduleIndex: 0,
        scenarioName: '',
        subsystemTimings: {
          simulationMs: 0,
          hudMs: 0,
          territoryVisualsMs: 0,
          armyVisualsMs: 0,
          combatArrivalsMs: 0,
          tweensMs: 0,
          renderMs: 0,
          textureUploads: 0,
          gameObjectsCreated: 0,
          tweensCreated: 0,
        },
      };

      // Listen to lifecycle & visibility events on both document and window
      const recordLifecycle = (event, state) => {
        if (window.__AUTHORITATIVE_PROBE__.isSampling) {
          window.__AUTHORITATIVE_PROBE__.lifecycleTransitions.push({
            event,
            state,
            timestampMs: performance.now(),
          });
        }
      };

      document.addEventListener('visibilitychange', () => recordLifecycle('visibilitychange', document.visibilityState));
      document.addEventListener('freeze', () => recordLifecycle('freeze', 'frozen'));
      document.addEventListener('resume', () => recordLifecycle('resume', 'resumed'));
      window.addEventListener('freeze', () => recordLifecycle('freeze', 'frozen'));
      window.addEventListener('resume', () => recordLifecycle('resume', 'resumed'));
      window.addEventListener('pagehide', () => recordLifecycle('pagehide', 'hidden'));
      window.addEventListener('pageshow', () => recordLifecycle('pageshow', 'visible'));

      // Intercept draw calls and extract GPU debug info
      const origGetContext = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function(type, ...rest) {
        const ctx = origGetContext.call(this, type, ...rest);
        if (!ctx) return ctx;

        if (type === 'webgl' || type === 'webgl2') {
          window.__AUTHORITATIVE_PROBE__.actualRenderer = 'WebGL';
          try {
            const ext = ctx.getExtension('WEBGL_debug_renderer_info');
            if (ext) {
              window.__AUTHORITATIVE_PROBE__.gpuVendor = ctx.getParameter(ext.UNMASKED_VENDOR_WEBGL) || 'Unknown';
              window.__AUTHORITATIVE_PROBE__.gpuRenderer = ctx.getParameter(ext.UNMASKED_RENDERER_WEBGL) || 'Unknown';
            }
            const r = (window.__AUTHORITATIVE_PROBE__.gpuRenderer || '').toLowerCase();
            if (r.includes('swiftshader') || r.includes('basic render') || r.includes('llvmpipe') || r.includes('software')) {
              window.__AUTHORITATIVE_PROBE__.isSoftwareRenderer = true;
            }
          } catch (e) {}

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
          const origTexImage2D = ctx.texImage2D;
          ctx.texImage2D = function(...args) {
            if (window.__AUTHORITATIVE_PROBE__.isSampling) {
              window.__AUTHORITATIVE_PROBE__.subsystemTimings.textureUploads++;
            }
            return origTexImage2D.apply(this, args);
          };
          const origTexSubImage2D = ctx.texSubImage2D;
          ctx.texSubImage2D = function(...args) {
            if (window.__AUTHORITATIVE_PROBE__.isSampling) {
              window.__AUTHORITATIVE_PROBE__.subsystemTimings.textureUploads++;
            }
            return origTexSubImage2D.apply(this, args);
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

        if (game.renderer && !game.renderer.__PROBE_INSTRUMENTED__) {
          game.renderer.__PROBE_INSTRUMENTED__ = true;
          const origRender = game.renderer.render;
          if (typeof origRender === 'function') {
            game.renderer.render = function(...args) {
              if (!window.__AUTHORITATIVE_PROBE__.isSampling) return origRender.apply(this, args);
              const t0 = performance.now();
              const res = origRender.apply(this, args);
              window.__AUTHORITATIVE_PROBE__.subsystemTimings.renderMs += (performance.now() - t0);
              return res;
            };
          }
        }

        if (game.loop && typeof game.loop.setFPSLimit === 'function') {
          game.loop.setFPSLimit(60);
        }

        // Authoritative simulation step tick
        game.events.on('step', (time, delta) => {
          const probe = window.__AUTHORITATIVE_PROBE__;
          if (!probe.isSampling) return;
          probe.simulationTicks++;

          // Synthetic long task injection check
          if (window.__INJECT_LONG_TASK_MS__ > 0 && !window.__LONG_TASK_INJECTED__) {
            const elapsedSec = (performance.now() - probe.startTime) / 1000;
            if (elapsedSec >= 5.0) {
              window.__LONG_TASK_INJECTED__ = true;
              console.log('[PROBE] Injecting synthetic long task: ' + window.__INJECT_LONG_TASK_MS__ + 'ms');
              const end = performance.now() + window.__INJECT_LONG_TASK_MS__;
              while (performance.now() < end) {}
            }
          }

          const scene = game.scene?.getScene('GameScene');
          if (scene && !scene.__PROBE_INSTRUMENTED__) {
            scene.__PROBE_INSTRUMENTED__ = true;
            const wrap = (target, fnName, statProp) => {
              if (target && typeof target[fnName] === 'function') {
                const orig = target[fnName];
                target[fnName] = function(...args) {
                  if (!window.__AUTHORITATIVE_PROBE__.isSampling) return orig.apply(this, args);
                  const t0 = performance.now();
                  const res = orig.apply(this, args);
                  window.__AUTHORITATIVE_PROBE__.subsystemTimings[statProp] += (performance.now() - t0);
                  return res;
                };
              }
            };
            wrap(scene, 'stepBotMatch', 'simulationMs');
            wrap(scene, 'updateHud', 'hudMs');
            wrap(scene, 'updateTerritoryVisuals', 'territoryVisualsMs');
            wrap(scene, 'updateArmyVisuals', 'armyVisualsMs');
            wrap(scene, 'onCombatArrival', 'combatArrivalsMs');

            if (scene.tweens) {
              wrap(scene.tweens, 'update', 'tweensMs');
              const origAddTween = scene.tweens.add;
              scene.tweens.add = function(...args) {
                if (window.__AUTHORITATIVE_PROBE__.isSampling) {
                  window.__AUTHORITATIVE_PROBE__.subsystemTimings.tweensCreated++;
                }
                return origAddTween.apply(this, args);
              };
            }
            if (scene.add && typeof scene.add.circle === 'function') {
              const factoryMethods = [
                'graphics',
                'container',
                'rectangle',
                'circle',
                'ellipse',
                'image',
                'text',
                'sprite',
                'existing',
              ];
              for (const fn of factoryMethods) {
                if (typeof scene.add[fn] === 'function') {
                  const origFactory = scene.add[fn];
                  scene.add[fn] = function(...args) {
                    if (window.__AUTHORITATIVE_PROBE__.isSampling) {
                      window.__AUTHORITATIVE_PROBE__.subsystemTimings.gameObjectsCreated =
                        (window.__AUTHORITATIVE_PROBE__.subsystemTimings.gameObjectsCreated || 0) + 1;
                    }
                    return origFactory.apply(this, args);
                  };
                }
              }
            } else {
              window.__AUTHORITATIVE_PROBE__.subsystemTimings.gameObjectsCreated = null;
            }
          }

          if (scene && scene.gameState) {
            scene.gameState.status = 'playing';

            // Top up bases if low
            if (scene.gameState.territories?.p_base && scene.gameState.territories.p_base.units < 15) {
              scene.gameState.territories.p_base.units = 30;
              scene.gameState.territories.p_base.owner = 'player';
            }
            if (scene.gameState.territories?.e_base && scene.gameState.territories.e_base.units < 15) {
              scene.gameState.territories.e_base.units = 30;
              scene.gameState.territories.e_base.owner = 'enemy';
            }

            // Execute scheduled dispatches through production executeQaDispatch entry point
            if (probe.schedule && probe.schedule.length > 0) {
              const elapsedSec = (performance.now() - probe.startTime) / 1000;
              while (probe.scheduleIndex < probe.schedule.length && probe.schedule[probe.scheduleIndex].timeSec <= elapsedSec) {
                const d = probe.schedule[probe.scheduleIndex++];
                if (typeof scene.executeQaDispatch === 'function') {
                  scene.executeQaDispatch(d.sourceId, d.targetId, d.owner);
                }
              }
            }
          }
        });

        // Authoritative post-render frame event (one measurement per actual postrender)
        game.events.on('postrender', (renderer, time, delta) => {
          const probe = window.__AUTHORITATIVE_PROBE__;
          if (!probe.isSampling) return;

          const now = performance.now();
          if (probe.lastRenderTime > 0 && now === probe.lastRenderTime) {
            probe.duplicateFramesDropped++;
            return;
          }

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
              probe.armySamples.push({ timestampMs: now, count: armies });
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

    // Prepare deterministic schedule & hash
    const schedule = scenarioDef.generateSchedule(seed, durationSec);
    const scheduleHash = computeScheduleHash(schedule);

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

    let backgroundDurationMs = 0;
    if (scenarioName === 'background_resume') {
      if (!hasWebLifecycleControl) {
        throw new Error('UNSUPPORTED_LIFECYCLE_CONTROL: CDP Page.setWebLifecycleState is not supported in this environment');
      }
      backgroundDurationMs = 10000;
      await sleep(5000);
      console.log('Suspending page via CDP Page.setWebLifecycleState ("frozen") for 10s...');
      await cdp.send('Page.setWebLifecycleState', { state: 'frozen' });
      await sleep(10000);
      console.log('Resuming page via CDP Page.setWebLifecycleState ("active")...');
      await cdp.send('Page.setWebLifecycleState', { state: 'active' });
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
          armySamples: probe.armySamples,
          peakObjects: probe.peakObjects,
          peakTweens: probe.peakTweens,
          memoryMb: { start: probe.startMemory, peak: probe.peakMemory },
          totalDrawCalls: probe.totalDrawCalls,
          actualRenderer: probe.actualRenderer,
          gpuVendor: probe.gpuVendor,
          gpuRenderer: probe.gpuRenderer,
          isSoftwareRenderer: probe.isSoftwareRenderer,
          duplicateFramesDropped: probe.duplicateFramesDropped,
          lifecycleTransitions: probe.lifecycleTransitions,
          subsystemTimings: probe.subsystemTimings,
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
        backgroundDurationMs,
        renderFrames: rawData.renderFrames,
        simulationTicks: rawData.simulationTicks,
        longTasks: rawData.longTasks,
        armySamples: rawData.armySamples,
        lifecycleTransitions: rawData.lifecycleTransitions,
        peakObjects: rawData.peakObjects,
        peakTweens: rawData.peakTweens,
        memoryMb: rawData.memoryMb,
        totalDrawCalls: rawData.totalDrawCalls,
        subsystemTimings: rawData.subsystemTimings,
      },
      60, // target FPS bound
      scenarioDef.config.warmupDurationSeconds
    );

    const verification = verifyPrerequisites(
      metrics,
      {
        renderer: rawData.actualRenderer,
        gpuVendor: rawData.gpuVendor,
        gpuRenderer: rawData.gpuRenderer,
        isSoftwareRenderer: rawData.isSoftwareRenderer,
        viewport,
        buildMode: 'production',
      },
      {
        expectedRenderer: rendererType,
        expectedViewport: viewport,
        expectedBuildMode: 'production',
        expectedDurationSeconds: durationSec,
        targetArmyRange: scenarioDef.config.targetArmyRange,
        targetFps: 60,
        maxAllowedLongTasks: scenarioDef.config.maxAllowedLongTasks,
      }
    );

    const report = {
      id: `bench_${scenarioName}_${Date.now()}`,
      timestamp: new Date().toISOString(),
      environment: {
        host: 'Browser Emulation (Headless Chrome on Windows)',
        isPhysicalDevice: false,
        renderer: rawData.actualRenderer,
        gpuVendor: rawData.gpuVendor,
        gpuRenderer: rawData.gpuRenderer,
        isSoftwareRenderer: rawData.isSoftwareRenderer,
        browserVersion,
        viewport,
        cpuThrottling,
        network: networkName,
        buildMode: 'production',
        targetFps: 60,
      },
      scenario: {
        ...scenarioDef.config,
        durationSeconds: durationSec,
        scheduleHash,
        seed,
      },
      metrics,
      verification,
    };

    if (recordTrace) {
      console.log('Stopping CDP Tracing and collecting events...');
      const traceEvents = [];
      cdp.on('Tracing.dataCollected', (params) => {
        if (params.value) traceEvents.push(...params.value);
      });
      const tracingCompletePromise = new Promise((resolve) => {
        cdp.on('Tracing.tracingComplete', resolve);
      });
      await cdp.send('Tracing.end');
      await tracingCompletePromise;

      const traceDir = path.resolve(REPO_ROOT, 'qa-artifacts/traces');
      if (!fs.existsSync(traceDir)) fs.mkdirSync(traceDir, { recursive: true });
      const targetTracePath = tracePath || path.join(traceDir, `${scenarioName}_trace.json`);
      fs.writeFileSync(targetTracePath, JSON.stringify(traceEvents));
      console.log(`Saved Chrome trace to: ${targetTracePath} (${traceEvents.length} events)\n`);
    }

    console.log('\n--- AUTHORITATIVE BENCHMARK SUMMARY ---');
    console.log(`GPU Vendor: ${rawData.gpuVendor} | GPU Renderer: ${rawData.gpuRenderer} (Software: ${rawData.isSoftwareRenderer})`);
    console.log(`Presented FPS: ${metrics.presentedFps} | Raw Rendered: ${metrics.renderedFps} FPS`);
    console.log(`Simulation Ticks: ${metrics.simulationTicks} (${metrics.simulationFps} ticks/sec)`);
    console.log(`Phaser Update Delta: avg ${metrics.phaserUpdateDelta.avgMs}ms | p50 ${metrics.phaserUpdateDelta.p50Ms}ms | p95 ${metrics.phaserUpdateDelta.p95Ms}ms | max ${metrics.phaserUpdateDelta.maxMs}ms`);
    console.log(`Frames >16.7ms: ${metrics.framesOver16Ms} (${metrics.framesOver16Pct}%) | >33.3ms: ${metrics.framesOver33Ms} (${metrics.framesOver33Pct}%)`);
    console.log(`Steady-State Armies: min ${metrics.steadyStateArmyCounts.min} | avg ${metrics.steadyStateArmyCounts.avg} | max ${metrics.steadyStateArmyCounts.max}`);
    console.log(`Objects: peak ${metrics.peakObjects} | Tweens: peak ${metrics.peakTweens} | Heap: peak ${metrics.memoryMb.peak ?? 'N/A'}MB`);
    console.log(`Draw Calls / frame: ${metrics.drawCalls?.avgPerFrame ?? 'N/A'} (total: ${metrics.drawCalls?.total ?? 'N/A'})`);
    console.log(`Long Tasks (>50ms): ${metrics.longTasks.count} (max: ${metrics.longTasks.maxDurationMs}ms, total: ${metrics.longTasks.totalDurationMs}ms)`);
    if (metrics.subsystemTimings) {
      const s = metrics.subsystemTimings;
      console.log('\n--- SUBSYSTEM ATTRIBUTION (avg ms/frame) ---');
      console.log(`Simulation (stepBotMatch):     ${s.simulationMsAvg} ms/frame`);
      console.log(`Army Visuals (updateArmies):   ${s.armyVisualsMsAvg} ms/frame`);
      console.log(`Territory Visuals (sync):      ${s.territoryVisualsMsAvg} ms/frame`);
      console.log(`HUD Updates (dominance/timer): ${s.hudMsAvg} ms/frame`);
      console.log(`Combat Arrivals (effects):     ${s.combatArrivalsMsAvg} ms/frame`);
      console.log(`Tweens Update:                 ${s.tweensMsAvg} ms/frame`);
      console.log(`Phaser Rendering:              ${s.renderMsAvg} ms/frame`);
      console.log(`Texture Uploads (total):       ${s.textureUploadsTotal}`);
      console.log(`GameObjects Created (total):   ${s.gameObjectsCreatedTotal !== null ? s.gameObjectsCreatedTotal : 'N/A (instrumentation unavailable)'}`);
      console.log(`Tweens Created (total):        ${s.tweensCreatedTotal}`);
      console.log('--------------------------------------------');
    }
    console.log(`Prerequisites Verification: ${verification.passed ? 'PASSED' : 'FAILED'}`);
    if (!verification.passed) {
      console.warn('Failures:', verification.failures);
    }

    if (!fs.existsSync(SUMMARIES_DIR)) {
      fs.mkdirSync(SUMMARIES_DIR, { recursive: true });
    }

    const defaultFilename = `${scenarioName}_${viewport.width}x${viewport.height}_cpu${cpuThrottling}x_${rendererType.toLowerCase()}${slow4G ? '_slow4g' : fast4G ? '_fast4g' : ''}.json`;
    const outFilename = options.outFilename || defaultFilename;
    const outPath = path.join(SUMMARIES_DIR, outFilename);
    fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
    console.log(`Saved small reviewable JSON summary to: ${outPath}\n`);

    return report;
  } finally {
    try {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
    } catch {}
    try {
      if (chromeProcess && chromeProcess.pid) {
        if (process.platform === 'win32') {
          try {
            execSync(`taskkill /pid ${chromeProcess.pid} /T /F`, { stdio: 'ignore' });
          } catch {}
        }
        chromeProcess.kill('SIGKILL');
      }
    } catch {}
    try {
      if (server) {
        if (typeof server.closeAllConnections === 'function') {
          server.closeAllConnections();
        }
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

// CLI invocation
if (process.argv[1] && process.argv[1].endsWith('run-benchmark.mjs')) {
  const scenario = process.argv[2] || 'normal_combat';
  const duration = parseInt(process.argv[3] || '30', 10);
  const disableWebgl = process.argv.includes('--canvas');
  const slow4G = process.argv.includes('--slow4g');
  const fast4G = process.argv.includes('--fast4g');
  const recordTrace = process.argv.includes('--trace');
  const tracePathIdx = process.argv.indexOf('--trace-path');
  const tracePath = tracePathIdx !== -1 ? process.argv[tracePathIdx + 1] : undefined;
  const injectArg = process.argv.find((a) => a.startsWith('--inject-long-task='));
  const injectLongTaskMs = injectArg ? parseInt(injectArg.split('=')[1], 10) : 0;
  const cpuThrottling = process.argv.includes('--1x') ? 1 : 4;
  const outIdx = process.argv.indexOf('--out');
  const outFilename = outIdx !== -1 ? process.argv[outIdx + 1] : undefined;

  runDeterministicBenchmark({
    scenario,
    durationSeconds: duration,
    disableWebgl,
    slow4G,
    fast4G,
    recordTrace,
    tracePath,
    injectLongTaskMs,
    cpuThrottling,
    outFilename,
  }).catch((err) => {
    console.error('Benchmark execution error:', err);
    process.exit(1);
  });
}

