import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  LivePvpController,
  sanitizeRoomCode,
  isValidRoomCode,
  mapLivePvpError,
} from '../LivePvpController.js';

describe('LivePvpController', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('utility functions', () => {
    it('sanitizeRoomCode formats correctly', () => {
      expect(sanitizeRoomCode('')).toBe('');
      expect(sanitizeRoomCode('abc12345')).toBe('ABC12345');
      expect(sanitizeRoomCode('  ab-c1 2345-- ')).toBe('ABC12345');
      expect(sanitizeRoomCode('ABC123456789')).toBe('ABC12345'); // trims to 8
      expect(sanitizeRoomCode('xyzGHIJ!@#12')).toBe('12'); // non-hex filtered
    });

    it('isValidRoomCode validates 8-char hex', () => {
      expect(isValidRoomCode('ABCDEF01')).toBe(true);
      expect(isValidRoomCode('01234567')).toBe(true);
      expect(isValidRoomCode('ABCDEF0')).toBe(false); // 7 chars
      expect(isValidRoomCode('ABCDEF012')).toBe(false); // 9 chars
      expect(isValidRoomCode('ABCDEFG1')).toBe(false); // G is not hex
      expect(isValidRoomCode('abcdef01')).toBe(false); // lowercase
    });

    it('mapLivePvpError provides friendly messages', () => {
      expect(mapLivePvpError('invite_not_found')).toContain('Battle room not found');
      expect(mapLivePvpError('live_match_full')).toContain('already full');
      expect(mapLivePvpError('live_match_invalid_code')).toContain('Invalid code format');
      expect(mapLivePvpError('missing_room_code')).toContain('Invalid code format');
      expect(mapLivePvpError('live_match_finished')).toContain('already finished');
      expect(mapLivePvpError('live_connection_timeout')).toContain('timed out');
      expect(mapLivePvpError('invite_create_failed')).toContain('Could not create');
      expect(mapLivePvpError('invite_join_failed')).toContain('Could not join');
      expect(mapLivePvpError('connection_closed')).toContain('closed');
      expect(mapLivePvpError('unknown_custom')).toBe('Error: unknown_custom');
    });
  });

  describe('state transitions', () => {
    it('initializes in lobby state', () => {
      const controller = new LivePvpController();
      const state = controller.getState();
      expect(state.view).toBe('lobby');
      expect(state.roomCode).toBe('');
      expect(state.errorMessage).toBe('');
      expect(state.copied).toBe(false);
    });

    it('handles create room flow', () => {
      const controller = new LivePvpController();
      const states: string[] = [];
      controller.subscribe((s) => states.push(s.view));

      expect(controller.startCreating()).toBe(true);
      expect(controller.getState().view).toBe('creating');

      // Duplicate call while creating is rejected
      expect(controller.startCreating()).toBe(false);

      controller.onInviteCreated('deadbeef');
      const state = controller.getState();
      expect(state.view).toBe('waiting');
      expect(state.roomCode).toBe('DEADBEEF');
    });

    it('handles copy toast status and timeout', () => {
      const controller = new LivePvpController();
      controller.onInviteCreated('12345678');
      expect(controller.getState().copied).toBe(false);

      controller.markCopied();
      expect(controller.getState().copied).toBe(true);

      vi.advanceTimersByTime(2000);
      expect(controller.getState().copied).toBe(false);
    });

    it('handles join flow with code input validation', () => {
      const controller = new LivePvpController();
      controller.startEnteringCode();
      expect(controller.getState().view).toBe('entering_code');

      // Invalid code rejected
      const invalidResult = controller.startJoining('ABC');
      expect(invalidResult.success).toBe(false);
      expect(controller.getState().errorMessage).toContain('8-character');
      expect(controller.getState().view).toBe('entering_code');

      // Valid code accepted
      const validResult = controller.startJoining('ABCD0123');
      expect(validResult.success).toBe(true);
      expect(controller.getState().view).toBe('joining');
      expect(controller.getState().roomCode).toBe('ABCD0123');
    });

    it('handles matchmaking queue flow', () => {
      const controller = new LivePvpController();
      expect(controller.startQueueing()).toBe(true);
      expect(controller.getState().view).toBe('queueing');
      expect(controller.startQueueing()).toBe(false); // duplicate rejected
    });

    it('handles error state and cancellation', () => {
      const controller = new LivePvpController();
      controller.startCreating();
      controller.onError('invite_not_found');

      expect(controller.getState().view).toBe('error');
      expect(controller.getState().errorMessage).toContain('Battle room not found');

      controller.cancel();
      expect(controller.getState().view).toBe('lobby');
      expect(controller.getState().errorMessage).toBe('');
      expect(controller.getState().roomCode).toBe('');
    });

    it('destroy cleans up listeners', () => {
      const controller = new LivePvpController();
      let callCount = 0;
      controller.subscribe(() => { callCount++; });

      controller.startCreating();
      expect(callCount).toBe(2); // initial + startCreating

      controller.destroy();
      controller.startQueueing();
      expect(callCount).toBe(2); // no further calls after destroy
    });
  });
});
