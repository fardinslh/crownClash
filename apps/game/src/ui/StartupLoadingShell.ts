export const UI_READY_MARK = 'crown-clash-ui-ready';
export const LOADING_SHELL_ID = 'loading-shell';
export const LOADING_SHELL_HIDDEN_CLASS = 'loading-shell--hidden';

let isDismissed = false;

export function isStartupLoadingShellDismissed(): boolean {
  return isDismissed;
}

export function resetStartupLoadingShellStateForTesting(): void {
  isDismissed = false;
}

/**
 * Dismisses the static HTML startup loading shell once the first interactive UI is rendered.
 * This function is completely idempotent.
 *
 * Guarantees:
 * - Records `performance.mark('crown-clash-ui-ready')` exactly once.
 * - Applies non-interactive styles (pointer-events: none, display: none).
 * - Removes the element from the DOM to ensure it can never block pointer events or remain over the canvas.
 */
export function dismissStartupLoadingShell(): void {
  if (isDismissed) {
    return;
  }
  isDismissed = true;

  if (typeof performance !== 'undefined' && typeof performance.mark === 'function') {
    try {
      performance.mark(UI_READY_MARK);
    } catch (err) {
      console.warn('[StartupLoadingShell] Failed to record performance mark:', err);
    }
  }

  if (typeof document !== 'undefined') {
    const shell = document.getElementById(LOADING_SHELL_ID);
    if (shell) {
      shell.classList.add(LOADING_SHELL_HIDDEN_CLASS);
      shell.style.pointerEvents = 'none';
      shell.style.display = 'none';
      if (typeof shell.remove === 'function') {
        shell.remove();
      } else if (shell.parentNode) {
        shell.parentNode.removeChild(shell);
      }
    }
  }
}

if (typeof window !== 'undefined') {
  (window as unknown as { dismissStartupLoadingShell?: typeof dismissStartupLoadingShell }).dismissStartupLoadingShell =
    dismissStartupLoadingShell;
}
