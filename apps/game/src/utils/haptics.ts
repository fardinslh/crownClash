import { createPlatformAdapter, HapticImpactStyle, HapticNotificationType } from '@crown-clash/platform';

const fallbackPlatform = createPlatformAdapter();

/**
  * @deprecated Use `platform.hapticImpact()` or `platform.hapticNotification()` from `@crown-clash/platform`.
  */
export function triggerHaptic(type: 'light' | 'medium' | 'heavy' | 'success' | 'warning'): void {
  if (type === 'success' || type === 'warning') {
    fallbackPlatform.hapticNotification(type as HapticNotificationType);
  } else {
    fallbackPlatform.hapticImpact(type as HapticImpactStyle);
  }
}
