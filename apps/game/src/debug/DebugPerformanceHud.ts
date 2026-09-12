import type Phaser from 'phaser';
import { PerformanceMonitor, BUILD_VERSION } from './PerformanceMonitor.js';
import { StressModeController } from './StressModeController.js';
import { QA_HUD_TOP_CSS } from './qaLayout.js';

export class DebugPerformanceHud {
  private monitor: PerformanceMonitor;
  private stressController: StressModeController;
  private containerEl: HTMLElement | null = null;
  private textEl: HTMLElement | null = null;
  private pillEl: HTMLElement | null = null;
  private expandedEl: HTMLElement | null = null;
  private stressBtnEl: HTMLButtonElement | null = null;

  private isCollapsed = false;
  private isVisible = true;
  private rafId: number | null = null;
  private lastTextUpdate = 0;
  private lastFrameTime = performance.now();

  constructor(game: Phaser.Game) {
    this.monitor = new PerformanceMonitor(game);
    this.stressController = new StressModeController(game);

    // Default to collapsed pill on narrow mobile screens (<= 480px width)
    if (typeof window !== 'undefined') {
      this.isCollapsed = window.innerWidth <= 480;
    }

    this.mountDom();
    this.toggleCollapsed(this.isCollapsed);
    this.startLoop();

    const params = new URLSearchParams(window.location.search);
    if (params.get('debug_performance') === '1' && params.get('stress_armies') === '1') {
      this.stressController.start();
      this.updateStressButtonText();
    }
  }

  public getMonitor(): PerformanceMonitor {
    return this.monitor;
  }

  public getStressController(): StressModeController {
    return this.stressController;
  }

  private mountDom(): void {
    if (typeof document === 'undefined') return;

    const existing = document.getElementById('debug-perf-hud');
    if (existing) existing.remove();

    const container = document.createElement('div');
    container.id = 'debug-perf-hud';
    container.style.cssText = `
      position: fixed;
      top: ${QA_HUD_TOP_CSS};
      right: max(8px, env(safe-area-inset-right));
      z-index: 99999;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 11px;
      line-height: 1.35;
      color: #e2e8f0;
      background: rgba(10, 15, 29, 0.94);
      border: 1px solid rgba(56, 189, 248, 0.45);
      border-radius: 8px;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.6);
      backdrop-filter: blur(4px);
      -webkit-backdrop-filter: blur(4px);
      pointer-events: none;
      max-width: calc(100vw - 16px);
      box-sizing: border-box;
    `;

    // Collapsed Pill (>= 44px min touch target)
    const pill = document.createElement('div');
    pill.id = 'debug-perf-pill';
    pill.style.cssText = `
      display: none;
      align-items: center;
      justify-content: center;
      gap: 6px;
      padding: 6px 12px;
      min-height: 44px;
      min-width: 44px;
      box-sizing: border-box;
      cursor: pointer;
      pointer-events: auto;
      font-weight: 700;
      color: #38bdf8;
      touch-action: manipulation;
    `;
    pill.onclick = () => this.toggleCollapsed(false);

    // Expanded Container
    const expanded = document.createElement('div');
    expanded.id = 'debug-perf-expanded';
    expanded.style.cssText = `
      display: flex;
      flex-direction: column;
      gap: 6px;
      padding: 8px 10px;
      box-sizing: border-box;
    `;

    // Header bar
    const header = document.createElement('div');
    header.style.cssText = `
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.12);
      padding-bottom: 4px;
      font-weight: 700;
      color: #38bdf8;
    `;

    const title = document.createElement('span');
    title.textContent = `🐞 QA HUD • ${BUILD_VERSION}`;
    header.appendChild(title);

    const winControls = document.createElement('div');
    winControls.style.cssText = `
      display: flex;
      gap: 6px;
      pointer-events: auto;
    `;

    const collapseBtn = document.createElement('button');
    collapseBtn.textContent = '—';
    collapseBtn.title = 'Collapse HUD to pill';
    this.styleButton(collapseBtn);
    collapseBtn.style.minWidth = '44px';
    collapseBtn.style.minHeight = '44px';
    collapseBtn.style.fontSize = '14px';
    collapseBtn.onclick = () => this.toggleCollapsed(true);

    const closeBtn = document.createElement('button');
    closeBtn.textContent = '✕';
    closeBtn.title = 'Close Debug HUD';
    this.styleButton(closeBtn);
    closeBtn.style.minWidth = '44px';
    closeBtn.style.minHeight = '44px';
    closeBtn.style.fontSize = '14px';
    closeBtn.onclick = () => this.destroy();

    winControls.appendChild(collapseBtn);
    winControls.appendChild(closeBtn);
    header.appendChild(winControls);
    expanded.appendChild(header);

    // Text readouts
    const textEl = document.createElement('div');
    textEl.style.cssText = `
      white-space: pre-line;
      color: #f1f5f9;
      pointer-events: none;
    `;
    textEl.textContent = 'Collecting metrics...';
    expanded.appendChild(textEl);

    // Action button toolbar (all buttons >= 44px)
    const toolbar = document.createElement('div');
    toolbar.style.cssText = `
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      border-top: 1px solid rgba(255, 255, 255, 0.12);
      padding-top: 6px;
      pointer-events: auto;
    `;

    const copyBtn = document.createElement('button');
    copyBtn.textContent = '📋 Copy';
    copyBtn.title = 'Copy QA Session Report JSON';
    this.styleButton(copyBtn);
    copyBtn.onclick = () => this.copyReport();

    const exportBtn = document.createElement('button');
    exportBtn.textContent = '💾 Export';
    exportBtn.title = 'Download QA Session Report JSON';
    this.styleButton(exportBtn);
    exportBtn.onclick = () => this.exportReport();

    const stressBtn = document.createElement('button');
    stressBtn.textContent = '⚡ Stress: Start';
    stressBtn.title = 'Toggle Army Visual Stress Mode';
    this.styleButton(stressBtn, '#eab308');
    stressBtn.onclick = () => this.toggleStressMode();
    this.stressBtnEl = stressBtn;

    const resetStressBtn = document.createElement('button');
    resetStressBtn.textContent = '🧹 Reset';
    resetStressBtn.title = 'Clear Stress Armies & Metrics';
    this.styleButton(resetStressBtn);
    resetStressBtn.onclick = () => this.resetAll();

    toolbar.appendChild(copyBtn);
    toolbar.appendChild(exportBtn);
    toolbar.appendChild(stressBtn);
    toolbar.appendChild(resetStressBtn);
    expanded.appendChild(toolbar);

    container.appendChild(pill);
    container.appendChild(expanded);
    document.body.appendChild(container);

    this.containerEl = container;
    this.pillEl = pill;
    this.expandedEl = expanded;
    this.textEl = textEl;
  }

  private styleButton(btn: HTMLButtonElement, accentColor = '#38bdf8'): void {
    btn.style.cssText = `
      background: rgba(30, 41, 59, 0.9);
      border: 1px solid ${accentColor};
      color: #f8fafc;
      font-family: inherit;
      font-size: 11px;
      font-weight: 600;
      padding: 8px 12px;
      min-height: 44px;
      min-width: 44px;
      box-sizing: border-box;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border-radius: 6px;
      cursor: pointer;
      touch-action: manipulation;
    `;
    btn.onmouseenter = () => (btn.style.background = 'rgba(51, 65, 85, 0.95)');
    btn.onmouseleave = () => (btn.style.background = 'rgba(30, 41, 59, 0.9)');
  }

  private toggleCollapsed(collapsed: boolean): void {
    this.isCollapsed = collapsed;
    if (this.pillEl && this.expandedEl) {
      if (collapsed) {
        this.pillEl.style.display = 'flex';
        this.expandedEl.style.display = 'none';
      } else {
        this.pillEl.style.display = 'none';
        this.expandedEl.style.display = 'flex';
      }
    }
  }

  private toggleStressMode(): void {
    if (this.stressController.isRunning()) {
      this.stressController.stop();
    } else {
      this.stressController.start();
    }
    this.updateStressButtonText();
  }

  private updateStressButtonText(): void {
    if (!this.stressBtnEl) return;
    const running = this.stressController.isRunning();
    this.stressBtnEl.textContent = running ? '⏸ Stress: Stop' : '⚡ Stress: Start';
    this.stressBtnEl.style.borderColor = running ? '#ef4444' : '#eab308';
    this.stressBtnEl.style.color = running ? '#f87171' : '#fde047';
  }

  private resetAll(): void {
    this.stressController.reset();
    this.monitor.reset();
    this.updateStressButtonText();
    this.renderText();
  }

  private copyReport(): void {
    const report = this.monitor.generateReport();
    const json = JSON.stringify(report, null, 2);

    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(json).then(() => {
        this.showToast('QA report copied to clipboard!');
      }).catch(() => {
        this.promptFallback(json);
      });
    } else {
      this.promptFallback(json);
    }
  }

  private promptFallback(text: string): void {
    if (typeof window !== 'undefined' && window.prompt) {
      window.prompt('Copy QA Report JSON:', text);
    }
  }

  private exportReport(): void {
    const report = this.monitor.generateReport();
    const json = JSON.stringify(report, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cc-qa-report-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    this.showToast('QA report downloaded!');
  }

  private showToast(msg: string): void {
    if (typeof document === 'undefined') return;
    const toast = document.createElement('div');
    toast.textContent = msg;
    toast.style.cssText = `
      position: fixed;
      bottom: 24px;
      left: 50%;
      transform: translateX(-50%);
      background: #0284c7;
      color: #ffffff;
      padding: 8px 16px;
      border-radius: 6px;
      font-weight: 600;
      font-size: 12px;
      z-index: 100000;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
      pointer-events: none;
    `;
    document.body.appendChild(toast);
    setTimeout(() => {
      toast.remove();
    }, 2200);
  }

  private startLoop(): void {
    const loop = () => {
      if (!this.isVisible) return;

      const now = performance.now();
      const delta = Math.max(0.1, now - this.lastFrameTime);
      this.lastFrameTime = now;

      // Sample raw frame delta
      this.monitor.recordFrame(delta);

      // Throttled UI text update: at most twice per second (500ms)
      if (now - this.lastTextUpdate >= 500) {
        this.lastTextUpdate = now;
        this.renderText();
      }

      if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
        this.rafId = window.requestAnimationFrame(loop);
      }
    };

    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
      this.rafId = window.requestAnimationFrame(loop);
    }
  }

  private renderText(): void {
    if (!this.containerEl) return;
    const stats = this.monitor.getFrameStats();
    const mem = this.monitor.getMemoryStats();
    const peaks = this.monitor.getPeaks();
    const net = this.monitor.getNetworkStats();
    const activeScene = this.monitor.getActiveScene();

    // Determine current scene & match status
    let matchStatus = activeScene?.scene?.key || 'None';
    let armiesCount = 0;
    if (activeScene && 'gameState' in activeScene) {
      const gs = (activeScene as any).gameState;
      const mode = (activeScene as any).liveMode ? 'live' : 'bot';
      matchStatus = `${mode}:${gs?.status ?? 'active'}`;
      armiesCount = gs?.armies?.length ?? 0;
    }

    const memStr = mem.supported && mem.currentMb !== null ? `${mem.currentMb} MB` : 'N/A';

    if (this.isCollapsed && this.pillEl) {
      this.pillEl.textContent = `🐞 ${stats.currentFps} FPS | P95: ${stats.p95FrameTimeMs}ms | ${memStr} | ${armiesCount} Armies`;
      return;
    }

    if (this.textEl) {
      const lines = [
        `FPS: ${stats.currentFps} (avg: ${stats.avgFps}) | P95: ${stats.p95FrameTimeMs}ms | Max: ${stats.maxFrameTimeMs}ms`,
        `Frames >16.7ms: ${stats.framesOver16Ms} (${stats.framesOver16Pct}%) | >33ms: ${stats.framesOver33Ms} (${stats.framesOver33Pct}%)`,
        `Objects: ${peaks.peakObjects} | Armies: ${armiesCount} | Tweens: ${peaks.peakTweens} | Heap: ${memStr}`,
        `Match: ${matchStatus} | Net: ${net.currentStatus} (${net.disconnectCount} drops)`,
      ];
      this.textEl.textContent = lines.join('\n');
    }
  }

  public destroy(): void {
    this.isVisible = false;
    if (this.rafId !== null) {
      if (typeof window !== 'undefined' && typeof window.cancelAnimationFrame === 'function') {
        window.cancelAnimationFrame(this.rafId);
      }
      this.rafId = null;
    }
    this.stressController.destroy();
    this.monitor.destroy();
    if (this.containerEl) {
      this.containerEl.remove();
      this.containerEl = null;
    }
  }
}

export function initDebugPerformanceIfEnabled(game: Phaser.Game): DebugPerformanceHud | undefined {
  if (typeof window === 'undefined') return undefined;
  const params = new URLSearchParams(window.location.search);
  if (params.get('debug_performance') !== '1') {
    return undefined;
  }
  return new DebugPerformanceHud(game);
}
