import { describe, expect, it, vi } from 'vitest';
import {
  detectDeviceCapabilities,
  AdaptivePerformanceController,
} from '../PerformanceProfile.js';

describe('PerformanceProfile & Device Capabilities', () => {
  describe('detectDeviceCapabilities', () => {
    it('detects low-end device when hardwareConcurrency <= 4', () => {
      const caps = detectDeviceCapabilities({ hardwareConcurrency: 4, deviceMemory: 4 }, 2);
      expect(caps.isLowEnd).toBe(true);
      expect(caps.recommendedRenderScale).toBe(1.25);
    });

    it('detects low-end device when deviceMemory <= 2GB', () => {
      const caps = detectDeviceCapabilities({ hardwareConcurrency: 8, deviceMemory: 2 }, 3);
      expect(caps.isLowEnd).toBe(true);
      expect(caps.recommendedRenderScale).toBe(1.25);
    });

    it('identifies high-end device when cores > 4 and memory > 2GB', () => {
      const caps = detectDeviceCapabilities({ hardwareConcurrency: 8, deviceMemory: 8 }, 2);
      expect(caps.isLowEnd).toBe(false);
      expect(caps.recommendedRenderScale).toBe(2);
    });

    it('clamps render scale appropriately for varying DPRs', () => {
      const lowEndCaps = detectDeviceCapabilities({ hardwareConcurrency: 2 }, 1);
      expect(lowEndCaps.recommendedRenderScale).toBe(1);

      const highEndCaps = detectDeviceCapabilities({ hardwareConcurrency: 16, deviceMemory: 16 }, 1);
      expect(highEndCaps.recommendedRenderScale).toBe(1);
    });
  });

  describe('AdaptivePerformanceController', () => {
    it('initializes with default options', () => {
      const ctrl = new AdaptivePerformanceController();
      expect(ctrl.isReducedEffects()).toBe(false);
    });

    it('initializes with initialReducedEffects true when configured', () => {
      const ctrl = new AdaptivePerformanceController({ initialReducedEffects: true });
      expect(ctrl.isReducedEffects()).toBe(true);
    });

    it('triggers degradation after sustained slow frames', () => {
      const onChange = vi.fn();
      const ctrl = new AdaptivePerformanceController({
        initialReducedEffects: false,
        degradeSampleCount: 5,
        degradeFpsThreshold: 30, // 33.3ms
      });
      ctrl.onChange(onChange);

      // Record 4 slow frames (40ms = 25fps) -> should not trigger yet
      for (let i = 0; i < 4; i++) {
        ctrl.recordFrameDelta(40);
      }
      expect(ctrl.isReducedEffects()).toBe(false);
      expect(onChange).not.toHaveBeenCalled();

      // 5th slow frame -> triggers degradation
      ctrl.recordFrameDelta(40);
      expect(ctrl.isReducedEffects()).toBe(true);
      expect(onChange).toHaveBeenCalledWith(true);
    });

    it('triggers recovery after sustained fast frames when baseline is not reduced', () => {
      const onChange = vi.fn();
      const ctrl = new AdaptivePerformanceController({
        initialReducedEffects: false,
        degradeSampleCount: 3,
        recoverSampleCount: 4,
        degradeFpsThreshold: 30,
        recoverFpsThreshold: 50, // 20ms
      });
      ctrl.onChange(onChange);

      // Degrade first
      for (let i = 0; i < 3; i++) {
        ctrl.recordFrameDelta(40);
      }
      expect(ctrl.isReducedEffects()).toBe(true);
      expect(onChange).toHaveBeenCalledWith(true);

      // Record 3 fast frames (16.6ms = 60fps) -> should not recover yet
      for (let i = 0; i < 3; i++) {
        ctrl.recordFrameDelta(16.6);
      }
      expect(ctrl.isReducedEffects()).toBe(true);

      // 4th fast frame -> triggers recovery
      ctrl.recordFrameDelta(16.6);
      expect(ctrl.isReducedEffects()).toBe(false);
      expect(onChange).toHaveBeenCalledWith(false);
    });

    it('does not auto-recover if initial baseline was reduced', () => {
      const ctrl = new AdaptivePerformanceController({
        initialReducedEffects: true,
        recoverSampleCount: 2,
        recoverFpsThreshold: 50,
      });
      expect(ctrl.isReducedEffects()).toBe(true);

      for (let i = 0; i < 10; i++) {
        ctrl.recordFrameDelta(16.6);
      }
      expect(ctrl.isReducedEffects()).toBe(true);
    });

    it('cleans up change listeners properly', () => {
      const ctrl = new AdaptivePerformanceController();
      const listener = vi.fn();
      const unsubscribe = ctrl.onChange(listener);

      ctrl.setReducedEffects(true);
      expect(listener).toHaveBeenCalledWith(true);

      unsubscribe();
      ctrl.setReducedEffects(false);
      expect(listener).toHaveBeenCalledTimes(1);
    });
  });
});
