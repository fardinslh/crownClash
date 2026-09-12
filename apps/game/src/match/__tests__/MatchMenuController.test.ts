import { describe, expect, it, vi } from 'vitest';
import {
  MatchMenuController,
  type MatchMenuDependencies,
  type MatchQuitEvent,
} from '../MatchMenuController.js';

describe('MatchMenuController', () => {
  function createController(overrides: Partial<MatchMenuDependencies> = {}) {
    const trackQuit = vi.fn((_event: MatchQuitEvent) => true);
    const trackAnalytics = vi.fn();
    const closeLiveClient = vi.fn();
    const onStateChange = vi.fn();
    const onExitConfirmed = vi.fn();
    const getDurationSeconds = vi.fn(() => 45);

    const deps: MatchMenuDependencies = {
      liveMode: false,
      matchId: 'test_match_123',
      getDurationSeconds,
      closeLiveClient,
      trackQuit,
      trackAnalytics,
      onStateChange,
      onExitConfirmed,
      ...overrides,
    };

    const controller = new MatchMenuController(deps);
    return {
      controller,
      deps,
      trackQuit,
      trackAnalytics,
      closeLiveClient,
      onStateChange,
      onExitConfirmed,
      getDurationSeconds,
    };
  }

  describe('State transitions and open state', () => {
    it('starts closed and transitions through menu and confirm', () => {
      const { controller, onStateChange } = createController();

      expect(controller.getState()).toBe('closed');
      expect(controller.isOpen()).toBe(false);

      controller.openMenu();
      expect(controller.getState()).toBe('menu');
      expect(controller.isOpen()).toBe(true);
      expect(onStateChange).toHaveBeenLastCalledWith('menu');

      controller.openConfirm();
      expect(controller.getState()).toBe('confirm');
      expect(controller.isOpen()).toBe(true);
      expect(onStateChange).toHaveBeenLastCalledWith('confirm');

      controller.backToMenu();
      expect(controller.getState()).toBe('menu');
      expect(controller.isOpen()).toBe(true);
      expect(onStateChange).toHaveBeenLastCalledWith('menu');

      controller.closeMenu();
      expect(controller.getState()).toBe('closed');
      expect(controller.isOpen()).toBe(false);
      expect(onStateChange).toHaveBeenLastCalledWith('closed');
    });
  });

  describe('Simulation pause behavior (Bot vs Live)', () => {
    it('pauses simulation in bot mode while any modal is open', () => {
      const { controller } = createController({ liveMode: false });

      expect(controller.isPaused()).toBe(false);

      controller.openMenu();
      expect(controller.isPaused()).toBe(true);

      controller.openConfirm();
      expect(controller.isPaused()).toBe(true);

      controller.closeMenu();
      expect(controller.isPaused()).toBe(false);
    });

    it('never pauses authoritative simulation in live mode', () => {
      const { controller } = createController({ liveMode: true });

      expect(controller.isPaused()).toBe(false);

      controller.openMenu();
      expect(controller.isPaused()).toBe(false);

      controller.openConfirm();
      expect(controller.isPaused()).toBe(false);

      controller.closeMenu();
      expect(controller.isPaused()).toBe(false);
    });
  });

  describe('Platform back button step-back navigation', () => {
    it('opens confirmation when closed, closes menu when open, and cancels confirm without abandoning match', () => {
      const { controller, trackQuit, trackAnalytics, closeLiveClient, onExitConfirmed } = createController();

      // 1. When closed (active match) -> platform back opens confirmation directly
      expect(controller.getState()).toBe('closed');
      controller.handleBackButton();
      expect(controller.getState()).toBe('confirm');
      expect(trackAnalytics).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'match_leave_requested' })
      );

      // 2. When in confirm (opened from match) -> platform back cancels and resumes match
      controller.handleBackButton();
      expect(controller.getState()).toBe('closed');
      expect(trackAnalytics).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'match_leave_cancelled' })
      );
      expect(trackAnalytics).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'match_resumed' })
      );

      // 3. When in menu -> platform back closes menu (resumes match)
      controller.openMenu();
      expect(controller.getState()).toBe('menu');
      controller.handleBackButton();
      expect(controller.getState()).toBe('closed');

      // 4. When in confirm (opened from menu) -> platform back steps back to menu
      controller.openMenu();
      controller.openConfirm('menu');
      expect(controller.getState()).toBe('confirm');
      controller.handleBackButton();
      expect(controller.getState()).toBe('menu');

      // 5. Must never immediately abandon match or emit quit events
      expect(trackQuit).not.toHaveBeenCalled();
      expect(closeLiveClient).not.toHaveBeenCalled();
      expect(onExitConfirmed).not.toHaveBeenCalled();
    });
  });

  describe('Match navigation analytics', () => {
    it('tracks match_menu_opened, match_resumed, match_leave_requested, match_leave_cancelled, and match_quit_confirmed', () => {
      const { controller, trackAnalytics, trackQuit } = createController({
        liveMode: false,
        matchId: 'analytics_test_1',
      });

      controller.openMenu();
      expect(trackAnalytics).toHaveBeenCalledWith({
        name: 'match_menu_opened',
        matchId: 'analytics_test_1',
        mode: 'bot',
      });

      controller.closeMenu();
      expect(trackAnalytics).toHaveBeenCalledWith({
        name: 'match_resumed',
        matchId: 'analytics_test_1',
        mode: 'bot',
      });

      controller.openConfirm('menu');
      expect(trackAnalytics).toHaveBeenCalledWith({
        name: 'match_leave_requested',
        matchId: 'analytics_test_1',
        mode: 'bot',
      });

      controller.backToMenu();
      expect(trackAnalytics).toHaveBeenCalledWith({
        name: 'match_leave_cancelled',
        matchId: 'analytics_test_1',
        mode: 'bot',
      });

      controller.confirmExit();
      expect(trackAnalytics).toHaveBeenCalledWith({
        name: 'match_quit_confirmed',
        matchId: 'analytics_test_1',
        mode: 'bot',
        durationSeconds: 45,
      });
      // Existing match_quit event must also be tracked
      expect(trackQuit).toHaveBeenCalledWith({
        name: 'match_quit',
        matchId: 'analytics_test_1',
        mode: 'bot',
        durationSeconds: 45,
      });
    });
  });

  describe('Mode-specific confirmation messaging', () => {
    it('returns lost progress message for bot mode', () => {
      const { controller } = createController({ liveMode: false });
      expect(controller.getConfirmationMessage()).toBe('Current battle progress will be lost.');
    });

    it('returns forfeit warning message for live mode', () => {
      const { controller } = createController({ liveMode: true });
      expect(controller.getConfirmationMessage()).toBe('Leaving forfeits this match.');
    });
  });

  describe('Exit idempotency and bot vs. live differences', () => {
    it('handles bot mode exit idempotently without touching live client', () => {
      const { controller, trackQuit, closeLiveClient, onExitConfirmed, getDurationSeconds } =
        createController({ liveMode: false, matchId: 'bot_match_999' });

      controller.openMenu();
      controller.openConfirm();

      // First confirmation tap
      controller.confirmExit();

      expect(trackQuit).toHaveBeenCalledTimes(1);
      expect(trackQuit).toHaveBeenCalledWith({
        name: 'match_quit',
        matchId: 'bot_match_999',
        mode: 'bot',
        durationSeconds: 45,
      });
      expect(closeLiveClient).not.toHaveBeenCalled();
      expect(onExitConfirmed).toHaveBeenCalledTimes(1);
      expect(controller.isExiting()).toBe(true);

      // Repeated spam taps must be strictly ignored
      controller.confirmExit();
      controller.confirmExit();
      controller.handleBackButton();
      controller.openMenu();

      expect(trackQuit).toHaveBeenCalledTimes(1);
      expect(closeLiveClient).not.toHaveBeenCalled();
      expect(onExitConfirmed).toHaveBeenCalledTimes(1);
      expect(getDurationSeconds).toHaveBeenCalledTimes(1);
    });

    it('handles live mode exit idempotently by closing live client once for forfeit', () => {
      const { controller, trackQuit, closeLiveClient, onExitConfirmed } =
        createController({ liveMode: true, matchId: 'live_match_456' });

      controller.openMenu();
      controller.openConfirm();

      // First confirmation tap
      controller.confirmExit();

      expect(trackQuit).toHaveBeenCalledTimes(1);
      expect(trackQuit).toHaveBeenCalledWith({
        name: 'match_quit',
        matchId: 'live_match_456',
        mode: 'live',
        durationSeconds: 45,
      });
      expect(closeLiveClient).toHaveBeenCalledTimes(1);
      expect(onExitConfirmed).toHaveBeenCalledTimes(1);
      expect(controller.isExiting()).toBe(true);

      // Repeated spam taps must be strictly ignored
      controller.confirmExit();
      controller.confirmExit();
      controller.handleBackButton();

      expect(trackQuit).toHaveBeenCalledTimes(1);
      expect(closeLiveClient).toHaveBeenCalledTimes(1);
      expect(onExitConfirmed).toHaveBeenCalledTimes(1);
    });
  });

  describe('Modal visibility desynchronization guards', () => {
    it('cannot remain paused if modal is destroyed or hidden without calling closeMenu', () => {
      let modalVisible = true;
      const { controller, onStateChange } = createController({
        liveMode: false,
        isModalVisible: () => modalVisible,
      });

      controller.openMenu();
      expect(controller.getState()).toBe('menu');
      expect(controller.isPaused()).toBe(true);

      // Simulate modal destroyed/hidden externally
      modalVisible = false;

      // isPaused() must detect missing modal, reconcile state to closed, and return false
      expect(controller.isPaused()).toBe(false);
      expect(controller.getState()).toBe('closed');
      expect(onStateChange).toHaveBeenLastCalledWith('closed');
    });

    it('reconcileVisualState closes open menu when modal visual is lost', () => {
      const { controller, onStateChange } = createController({ liveMode: false });

      controller.openConfirm();
      expect(controller.isOpen()).toBe(true);

      controller.reconcileVisualState(false);
      expect(controller.isOpen()).toBe(false);
      expect(controller.getState()).toBe('closed');
      expect(onStateChange).toHaveBeenLastCalledWith('closed');
    });
  });
});
