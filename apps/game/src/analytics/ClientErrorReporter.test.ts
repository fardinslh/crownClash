import { describe, expect, it, vi } from 'vitest';
import {
  CLIENT_ERROR_MAX_PER_SESSION,
  CLIENT_ERROR_MESSAGE_MAX_LENGTH,
  describeSource,
  installClientErrorReporter,
  sanitizeErrorMessage,
  type ClientErrorReport,
} from './ClientErrorReporter.js';

type Listener = (event: Event) => void;

function fakeWindow() {
  const listeners = new Map<string, Listener>();
  return {
    addEventListener: (type: string, listener: Listener) => void listeners.set(type, listener),
    removeEventListener: (type: string) => void listeners.delete(type),
    fire: (type: string, event: object) => listeners.get(type)?.(event as Event),
    has: (type: string) => listeners.has(type),
  };
}

function setup(options: { maxPerSession?: number; report?: (r: ClientErrorReport) => void } = {}) {
  const win = fakeWindow();
  const reports: ClientErrorReport[] = [];
  const uninstall = installClientErrorReporter(win as unknown as Window, {
    getSceneKey: () => 'MenuScene',
    report: options.report ?? ((report) => void reports.push(report)),
    maxPerSession: options.maxPerSession,
  });
  return { win, reports, uninstall };
}

describe('sanitizeErrorMessage', () => {
  it('masks URLs, emails, long ids and digit runs but keeps the shape of the error', () => {
    const message = sanitizeErrorMessage(
      'Request https://nakama.example.com/v2/rpc/x?token=abc failed for ann@example.com ' +
        'session_0f8c1d2e-aaaa-bbbb user 123456 reading startHubMusic'
    );
    expect(message).not.toMatch(/https?:|example\.com|0f8c1d2e|123456/);
    expect(message).toContain('<url>');
    expect(message).toContain('<email>');
    expect(message).toContain('<n>');
    expect(message).toContain('startHubMusic');
  });

  it('truncates and never returns an empty string', () => {
    expect(sanitizeErrorMessage('x'.repeat(500))).toHaveLength(CLIENT_ERROR_MESSAGE_MAX_LENGTH);
    expect(sanitizeErrorMessage('')).toBe('unknown');
    expect(sanitizeErrorMessage({ secret: 'object' })).toBe('unknown');
  });

  it('reads Error instances', () => {
    expect(sanitizeErrorMessage(new TypeError('x is not a function'))).toBe('x is not a function');
  });
});

describe('describeSource', () => {
  it('keeps only the file name and position', () => {
    expect(describeSource('https://cdn.example.com/assets/index-abc.js?v=1#x', 12, 34)).toBe('index-abc.js:12:34');
    expect(describeSource('/assets/a.js', 3, undefined)).toBe('a.js:3');
  });

  it('falls back to unknown for missing or odd names', () => {
    expect(describeSource('', 1, 2)).toBe('unknown');
    expect(describeSource(undefined, 1, 2)).toBe('unknown');
    expect(describeSource('https://x.example/ü ñ.js', 1, 2)).toBe('unknown');
  });
});

describe('installClientErrorReporter', () => {
  it('reports an uncaught error with class, location, scene and no stack', () => {
    const { win, reports } = setup();
    const error = new TypeError('cannot read x of undefined');
    win.fire('error', {
      message: error.message,
      filename: 'https://host/assets/index-abc.js?token=secret',
      lineno: 10,
      colno: 20,
      error,
    });
    expect(reports).toEqual([
      expect.objectContaining({
        kind: 'error',
        errorName: 'TypeError',
        message: 'cannot read x of undefined',
        source: 'index-abc.js:10:20',
        scene: 'MenuScene',
      }),
    ]);
    expect(JSON.stringify(reports)).not.toMatch(/secret|https?:/);
    expect(reports[0]).not.toHaveProperty('stack');
  });

  it('reports unhandled rejections using the first stack frame', () => {
    const { win, reports } = setup();
    const reason = new Error('network_down');
    reason.stack = 'Error: network_down\n    at load (https://host/assets/chunk-9.js:5:6)\n    at other (x.js:1:1)';
    win.fire('unhandledrejection', { reason });
    expect(reports[0]).toMatchObject({ kind: 'rejection', errorName: 'Error', source: 'chunk-9.js:5:6' });
  });

  it('survives non-Error rejection reasons', () => {
    const { win, reports } = setup();
    win.fire('unhandledrejection', { reason: 'plain string failure' });
    expect(reports[0]).toMatchObject({ errorName: 'Error', message: 'plain string failure', source: 'unknown' });
  });

  it('ignores opaque cross-origin "Script error."', () => {
    const { win, reports } = setup();
    win.fire('error', { message: 'Script error.', filename: '', lineno: 0, colno: 0 });
    expect(reports).toHaveLength(0);
  });

  it('dedupes identical errors and caps reports per session', () => {
    const { win, reports } = setup();
    const same = { message: 'boom', filename: 'a.js', lineno: 1, colno: 1, error: new Error('boom') };
    win.fire('error', same);
    win.fire('error', same);
    expect(reports).toHaveLength(1);
    for (let i = 0; i < 20; i += 1) {
      win.fire('error', { ...same, message: `m${i}x`, error: new Error(`m${i}x`) });
    }
    expect(reports).toHaveLength(CLIENT_ERROR_MAX_PER_SESSION);
  });

  it('never throws into the page when the reporter itself fails, and uninstalls cleanly', () => {
    const { win, uninstall } = setup({
      report: () => {
        throw new Error('sink down');
      },
    });
    expect(() => win.fire('error', { message: 'x', filename: 'a.js', lineno: 1, colno: 1, error: new Error('x') })).not.toThrow();
    uninstall();
    expect(win.has('error')).toBe(false);
    expect(win.has('unhandledrejection')).toBe(false);
  });

  it('feeds the analytics pipeline as a client_error event by default', () => {
    const dispatched: Array<{ detail: { name: string; props: Record<string, unknown> } }> = [];
    vi.stubGlobal('window', {
      dispatchEvent: (event: { detail: { name: string; props: Record<string, unknown> } }) => dispatched.push(event),
    });
    vi.stubGlobal('CustomEvent', class { constructor(public type: string, public init: { detail: unknown }) { Object.assign(this, { detail: init.detail }); } });
    try {
      const win = fakeWindow();
      installClientErrorReporter(win as unknown as Window, { getSceneKey: () => 'GameScene' });
      win.fire('error', { message: 'bad', filename: 'a.js', lineno: 1, colno: 2, error: new RangeError('bad') });
      expect(dispatched[0].detail.name).toBe('client_error');
      expect(dispatched[0].detail.props).toMatchObject({ kind: 'error', errorName: 'RangeError', scene: 'GameScene', source: 'a.js:1:2' });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
