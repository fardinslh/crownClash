import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import {
  dismissStartupLoadingShell,
  isStartupLoadingShellDismissed,
  resetStartupLoadingShellStateForTesting,
  LOADING_SHELL_ID,
  LOADING_SHELL_HIDDEN_CLASS,
  UI_READY_MARK,
} from '../StartupLoadingShell.js';

describe('StartupLoadingShell', () => {
  let mockShellElement: {
    classList: { add: ReturnType<typeof vi.fn> };
    style: { pointerEvents: string; display: string };
    remove: ReturnType<typeof vi.fn>;
    parentNode: { removeChild: ReturnType<typeof vi.fn> } | null;
  };

  beforeEach(() => {
    resetStartupLoadingShellStateForTesting();

    mockShellElement = {
      classList: {
        add: vi.fn(),
      },
      style: {
        pointerEvents: 'auto',
        display: 'flex',
      },
      remove: vi.fn(),
      parentNode: {
        removeChild: vi.fn(),
      },
    };

    // Setup globals
    vi.stubGlobal('document', {
      getElementById: vi.fn((id: string) => {
        if (id === LOADING_SHELL_ID) {
          return mockShellElement;
        }
        return null;
      }),
    });

    vi.stubGlobal('performance', {
      mark: vi.fn(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetStartupLoadingShellStateForTesting();
  });

  it('starts in un-dismissed state', () => {
    expect(isStartupLoadingShellDismissed()).toBe(false);
  });

  it('dismisses shell and records performance mark exactly once', () => {
    dismissStartupLoadingShell();

    expect(isStartupLoadingShellDismissed()).toBe(true);
    expect(performance.mark).toHaveBeenCalledTimes(1);
    expect(performance.mark).toHaveBeenCalledWith(UI_READY_MARK);

    expect(mockShellElement.classList.add).toHaveBeenCalledWith(LOADING_SHELL_HIDDEN_CLASS);
    expect(mockShellElement.style.pointerEvents).toBe('none');
    expect(mockShellElement.style.display).toBe('none');
    expect(mockShellElement.remove).toHaveBeenCalledTimes(1);
  });

  it('is completely idempotent across repeated dismissal calls', () => {
    dismissStartupLoadingShell();
    dismissStartupLoadingShell();
    dismissStartupLoadingShell();

    expect(isStartupLoadingShellDismissed()).toBe(true);
    expect(performance.mark).toHaveBeenCalledTimes(1);
    expect(mockShellElement.remove).toHaveBeenCalledTimes(1);
  });

  it('handles missing shell element gracefully without throwing', () => {
    vi.stubGlobal('document', {
      getElementById: vi.fn(() => null),
    });

    expect(() => dismissStartupLoadingShell()).not.toThrow();
    expect(isStartupLoadingShellDismissed()).toBe(true);
    expect(performance.mark).toHaveBeenCalledTimes(1);
  });

  it('handles failing performance.mark gracefully without throwing', () => {
    vi.stubGlobal('performance', {
      mark: vi.fn(() => {
        throw new Error('PerformanceMark restricted in environment');
      }),
    });

    expect(() => dismissStartupLoadingShell()).not.toThrow();
    expect(isStartupLoadingShellDismissed()).toBe(true);
    expect(mockShellElement.remove).toHaveBeenCalledTimes(1);
  });

  it('falls back to parentNode.removeChild when element.remove is unavailable', () => {
    const parentNodeMock = { removeChild: vi.fn() };
    const elementWithoutRemove = {
      classList: { add: vi.fn() },
      style: { pointerEvents: 'auto', display: 'flex' },
      remove: undefined,
      parentNode: parentNodeMock,
    };

    vi.stubGlobal('document', {
      getElementById: vi.fn(() => elementWithoutRemove),
    });

    dismissStartupLoadingShell();

    expect(parentNodeMock.removeChild).toHaveBeenCalledWith(elementWithoutRemove);
    expect(elementWithoutRemove.style.pointerEvents).toBe('none');
    expect(elementWithoutRemove.style.display).toBe('none');
  });
});
