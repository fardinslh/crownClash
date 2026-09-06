/**
 * Lightweight cross-platform haptic feedback helper for mobile webviews and browsers.
 * Safely degrades on unsupported devices.
 */
export function triggerHaptic(type: 'light' | 'medium' | 'heavy' | 'success' | 'warning'): void {
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    try {
      switch (type) {
        case 'light':
          navigator.vibrate(12);
          break;
        case 'medium':
          navigator.vibrate(25);
          break;
        case 'heavy':
          navigator.vibrate(45);
          break;
        case 'success':
          navigator.vibrate([30, 40, 60]);
          break;
        case 'warning':
          navigator.vibrate([50, 30, 50]);
          break;
      }
    } catch {
      // Gracefully ignore vibration errors
    }
  }
}
