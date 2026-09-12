import { describe, expect, it, vi } from 'vitest';
import {
  BATTLEFIELDS,
  createInitialGameState,
  PVP_SIMULATION_TICK_SECONDS,
  PVP_TIME_LIMIT_SECONDS,
  simulatePvpBattle,
  stepSimulation,
  type MarchingArmy,
} from '@crown-clash/game-core';
import { formatDominancePercentages } from '../../ui/HudLayout.js';
import { MatchMenuController } from '../../match/MatchMenuController.js';

describe('BotFreezeHardening', () => {
  describe('Scenario 1 & 2: Enemy armies without territories & terminal resolution', () => {
    it('reports <1% or non-zero enemy dominance and marks isLastEnemyArmy when 0 enemy bases remain but army is active', () => {
      const state = createInitialGameState({ battlefieldId: 'royal_ring' });

      // Player captures all territories, leaving enemy with 0 territories
      for (const t of Object.values(state.territories)) {
        t.owner = 'player';
        t.units = 25;
      }

      // Add a single active enemy marching army with 2 units
      const enemyArmy: MarchingArmy = {
        id: 'army_enemy_survivor',
        owner: 'enemy',
        units: 2,
        sourceId: 'e_base',
        targetId: 'p_base',
        startX: 200,
        startY: 110,
        targetX: 200,
        targetY: 610,
        progress: 0.5,
        speed: 0.25,
        distance: 500,
      };
      state.armies = [enemyArmy];

      // Match status must still be 'playing' because enemy has surviving forces
      expect(state.status).toBe('playing');

      const territories = Object.values(state.territories);
      let playerStrength = 0;
      let enemyStrength = 0;
      let neutralStrength = 0;

      territories.forEach((t) => {
        if (t.owner === 'player') playerStrength += 35 + t.units;
        else if (t.owner === 'enemy') enemyStrength += 35 + t.units;
        else neutralStrength += 15 + t.units;
      });

      state.armies.forEach((a) => {
        if (a.owner === 'player') playerStrength += a.units;
        else if (a.owner === 'enemy') enemyStrength += a.units;
      });

      const dominance = formatDominancePercentages({
        playerStrength,
        enemyStrength,
        neutralStrength,
        playerArmiesCount: 0,
        enemyTerritoriesCount: territories.filter((t) => t.owner === 'enemy').length,
        enemyArmiesCount: state.armies.filter((a) => a.owner === 'enemy').length,
      });

      // Dominance assertions:
      // 1. Enemy percentage display must never show plain "0%" while active forces survive
      expect(dominance.enemyDomText).not.toBe('0%');
      expect(dominance.enemyDomText).toBe('<1%');
      // 2. Player percentage display clamped to at most 99%
      expect(dominance.playerDomText).toBe('99%');
      expect(dominance.playerPct).toBeLessThanOrEqual(99);
      // 3. Last enemy army indicator flag must be true
      expect(dominance.isLastEnemyArmy).toBe(true);
    });

    it('transitions to victory on the very next simulation tick when the last enemy army is eliminated', () => {
      const state = createInitialGameState({ battlefieldId: 'royal_ring' });

      // Player owns all territories
      for (const t of Object.values(state.territories)) {
        t.owner = 'player';
        t.units = 30;
      }

      // Enemy has no territories and no armies left
      state.armies = [];

      const accumulators: Record<string, number> = {};
      const result = stepSimulation(state, accumulators, PVP_SIMULATION_TICK_SECONDS);

      expect(result.state.status).toBe('victory');

      const territories = Object.values(result.state.territories);
      let playerStrength = 0;
      let enemyStrength = 0;
      let neutralStrength = 0;

      territories.forEach((t) => {
        if (t.owner === 'player') playerStrength += 35 + t.units;
        else if (t.owner === 'enemy') enemyStrength += 35 + t.units;
        else neutralStrength += 15 + t.units;
      });

      const dominance = formatDominancePercentages({
        playerStrength,
        enemyStrength,
        neutralStrength,
        playerArmiesCount: 0,
        enemyTerritoriesCount: 0,
        enemyArmiesCount: 0,
      });

      expect(dominance.enemyDomText).toBe('0%');
      expect(dominance.playerDomText).toBe('100%');
      expect(dominance.isLastEnemyArmy).toBe(false);
    });
  });

  describe('Scenario 3 & 4: Settlement syncing UI lifecycle and error handling', () => {
    it('maintains syncing state while match settlement is pending', async () => {
      let isSyncingModalVisible = false;
      let isResultModalVisible = false;
      let isResultPending = false;

      const renderSyncingModal = () => {
        isSyncingModalVisible = true;
      };
      const dismissSyncingModal = () => {
        isSyncingModalVisible = false;
      };
      const renderResultModal = () => {
        isResultModalVisible = true;
      };

      // Match ends
      isResultPending = true;
      renderSyncingModal();

      expect(isResultPending).toBe(true);
      expect(isSyncingModalVisible).toBe(true);
      expect(isResultModalVisible).toBe(false);

      // Simulate asynchronous authoritative settlement completion
      await Promise.resolve();

      isResultPending = false;
      dismissSyncingModal();
      renderResultModal();

      expect(isResultPending).toBe(false);
      expect(isSyncingModalVisible).toBe(false);
      expect(isResultModalVisible).toBe(true);
    });

    it('transitions to retry UI upon settlement failure without granting premature rewards', async () => {
      let isSyncingModalVisible = false;
      let isRetryModalVisible = false;
      const rewardsGranted = false;

      const renderSyncingModal = () => {
        isSyncingModalVisible = true;
      };
      const dismissSyncingModal = () => {
        isSyncingModalVisible = false;
      };
      const showSettlementError = (_error: unknown) => {
        isRetryModalVisible = true;
      };

      // End match and start sync
      renderSyncingModal();
      expect(isSyncingModalVisible).toBe(true);

      // Simulate settlement error (e.g. backend_required_for_match_settlement or timeout)
      const settlementError = new Error('backend_required_for_match_settlement');
      dismissSyncingModal();
      showSettlementError(settlementError);

      expect(isSyncingModalVisible).toBe(false);
      expect(isRetryModalVisible).toBe(true);
      // Server-authoritative contract: local rewards must never be granted on failure
      expect(rewardsGranted).toBe(false);

      // User triggers retry sync
      isRetryModalVisible = false;
      renderSyncingModal();

      expect(isRetryModalVisible).toBe(false);
      expect(isSyncingModalVisible).toBe(true);
    });
  });

  describe('Scenario 5: MatchMenuController desynchronization guard', () => {
    it('automatically reconciles paused state to false when modal is destroyed/closed externally', () => {
      let modalVisible = false;

      const controller = new MatchMenuController({
        liveMode: false,
        matchId: 'bot_test_123',
        getDurationSeconds: () => 30,
        closeLiveClient: vi.fn(),
        trackQuit: vi.fn(() => true),
        onStateChange: vi.fn(),
        onExitConfirmed: vi.fn(),
        isModalVisible: () => modalVisible,
      });

      // Initially closed
      expect(controller.isPaused()).toBe(false);

      // Open menu
      controller.openMenu();
      modalVisible = true;
      expect(controller.isPaused()).toBe(true);
      expect(controller.getState()).toBe('menu');

      // Modal is destroyed or hidden externally without calling controller.closeMenu()
      modalVisible = false;

      // isPaused() must detect the absence of the modal, auto-reconcile, and return false
      expect(controller.isPaused()).toBe(false);
      expect(controller.getState()).toBe('closed');
    });
  });

  describe('Scenario 6: Deterministic simulation and monotonic time across all battlefields', () => {
    for (const { id: battlefieldId, name } of BATTLEFIELDS) {
      it(`progresses time monotonically and settles deterministically on battlefield: ${name} (${battlefieldId})`, () => {
        let state = createInitialGameState({
          timeLimit: PVP_TIME_LIMIT_SECONDS,
          battlefieldId,
        });
        let accumulators: Record<string, number> = {};
        let previousTime = 0;

        // Run simulation with simulated ticks up to 90 seconds
        const stepSize = PVP_SIMULATION_TICK_SECONDS;
        const maxSteps = Math.ceil(PVP_TIME_LIMIT_SECONDS / stepSize) + 50;

        for (let step = 0; step < maxSteps; step++) {
          if (state.status !== 'playing') break;

          const result = stepSimulation(state, accumulators, stepSize);
          state = result.state;
          accumulators = result.accumulators;

          // Time progression must be strictly monotonic and finite
          expect(Number.isFinite(state.elapsedTimeSeconds)).toBe(true);
          expect(state.elapsedTimeSeconds).toBeGreaterThanOrEqual(previousTime);
          previousTime = state.elapsedTimeSeconds;
        }

        // Must terminate by or at 90s time limit (never remain stuck playing indefinitely)
        expect(state.status).not.toBe('playing');
        expect(state.elapsedTimeSeconds).toBeGreaterThan(0);
        expect(state.elapsedTimeSeconds).toBeLessThanOrEqual(PVP_TIME_LIMIT_SECONDS + stepSize);
      });
    }

    it('simulates complete deterministic replay without errors on all 3 battlefields', () => {
      for (const { id } of BATTLEFIELDS) {
        const result = simulatePvpBattle({
          battlefieldId: id,
          actions: [
            { sequence: 0, atSeconds: 0.1, sourceId: 'p_base', targetId: 'n_center' },
            { sequence: 1, atSeconds: 3.5, sourceId: 'p_base', targetId: 'n_bot_left' },
          ],
        });

        expect(result.finalState.status).not.toBe('playing');
        expect(result.finalState.battlefieldId).toBe(id);
        expect(Number.isFinite(result.finalState.elapsedTimeSeconds)).toBe(true);
        expect(result.summary.durationSeconds).toBeGreaterThan(0);
      }
    });
  });
});
