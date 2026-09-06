import { describe, expect, it } from 'vitest';
import {
  calculateDispatchUnits,
  createDefaultTerritories,
  createInitialGameState,
  dispatchArmy,
  dispatchMultipleArmies,
  evaluateAiMove,
  resolveArrival,
  stepSimulation,
  tickUnitGeneration,
  Territory,
} from '../index.js';

describe('Crown Clash - Domain Logic Tests', () => {
  describe('Combat & Reinforcement (resolveArrival)', () => {
    const baseTarget: Territory = {
      id: 'target_1',
      name: 'Target Keep',
      x: 200,
      y: 200,
      radius: 30,
      owner: 'neutral',
      units: 10,
      maxUnits: 50,
      productionRate: 0,
      tier: 1,
    };

    it('successfully captures a neutral territory when incoming > defenders', () => {
      const result = resolveArrival(baseTarget, 15, 'player');
      expect(result.captured).toBe(true);
      expect(result.reinforced).toBe(false);
      expect(result.newOwner).toBe('player');
      expect(result.remainingUnits).toBe(5); // 15 - 10 = 5
      expect(result.remainingUnits).toBeGreaterThan(0);
    });

    it('fails to capture when incoming < defenders and keeps defender owner', () => {
      const result = resolveArrival(baseTarget, 6, 'player');
      expect(result.captured).toBe(false);
      expect(result.reinforced).toBe(false);
      expect(result.newOwner).toBe('neutral');
      expect(result.remainingUnits).toBe(4); // 10 - 6 = 4
    });

    it('results in 0 defenders on exact tie without changing owner', () => {
      const result = resolveArrival(baseTarget, 10, 'player');
      expect(result.captured).toBe(false);
      expect(result.newOwner).toBe('neutral');
      expect(result.remainingUnits).toBe(0);
    });

    it('correctly reinforces friendly territory', () => {
      const friendlyTarget: Territory = {
        ...baseTarget,
        owner: 'player',
        units: 12,
      };
      const result = resolveArrival(friendlyTarget, 8, 'player');
      expect(result.reinforced).toBe(true);
      expect(result.captured).toBe(false);
      expect(result.newOwner).toBe('player');
      expect(result.remainingUnits).toBe(20); // 12 + 8 = 20
    });

    it('guarantees unit counts never become negative on any battle', () => {
      for (let def = 0; def <= 50; def += 5) {
        for (let atk = 0; atk <= 50; atk += 5) {
          const testTarget: Territory = { ...baseTarget, units: def, owner: 'enemy' };
          const result = resolveArrival(testTarget, atk, 'player');
          expect(result.remainingUnits).toBeGreaterThanOrEqual(0);
        }
      }
    });

    it('correctly transitions ownership between player and enemy', () => {
      const enemyTerritory: Territory = {
        ...baseTarget,
        owner: 'enemy',
        units: 7,
      };

      // Player captures enemy territory
      const captureResult = resolveArrival(enemyTerritory, 12, 'player');
      expect(captureResult.previousOwner).toBe('enemy');
      expect(captureResult.newOwner).toBe('player');
      expect(captureResult.captured).toBe(true);
      expect(captureResult.remainingUnits).toBe(5);

      // Enemy retaliates and re-captures it
      const recapturedTarget: Territory = {
        ...enemyTerritory,
        owner: captureResult.newOwner,
        units: captureResult.remainingUnits,
      };
      const enemyRetaliation = resolveArrival(recapturedTarget, 10, 'enemy');
      expect(enemyRetaliation.previousOwner).toBe('player');
      expect(enemyRetaliation.newOwner).toBe('enemy');
      expect(enemyRetaliation.captured).toBe(true);
      expect(enemyRetaliation.remainingUnits).toBe(5); // 10 - 5 = 5
    });
  });

  describe('Dispatch Logic (calculateDispatchUnits & dispatchArmy)', () => {
    it('dispatches 50% rounded down', () => {
      expect(calculateDispatchUnits(20, 0.5)).toBe(10);
      expect(calculateDispatchUnits(21, 0.5)).toBe(10);
      expect(calculateDispatchUnits(5, 0.5)).toBe(2);
      expect(calculateDispatchUnits(3, 0.5)).toBe(1);
      expect(calculateDispatchUnits(2, 0.5)).toBe(1);
    });

    it('does not dispatch if territory has 1 or 0 units', () => {
      expect(calculateDispatchUnits(1, 0.5)).toBe(0);
      expect(calculateDispatchUnits(0, 0.5)).toBe(0);
    });

    it('successfully deducts dispatched units from source territory', () => {
      const territories = createDefaultTerritories();
      const pBase = territories['p_base'];
      const target = territories['n_center'];

      const result = dispatchArmy(pBase, target, 'player', 0.5);
      expect(result.success).toBe(true);
      expect(result.army).toBeDefined();
      expect(result.sourceTerritory).toBeDefined();
      expect(result.sourceTerritory!.units).toBe(10); // 20 - 10 = 10
      expect(result.army!.units).toBe(10);
      expect(result.army!.owner).toBe('player');
      expect(result.army!.targetId).toBe(target.id);
    });

    it('rejects dispatch if sender does not own the source', () => {
      const territories = createDefaultTerritories();
      const eBase = territories['e_base'];
      const target = territories['n_center'];

      const result = dispatchArmy(eBase, target, 'player', 0.5);
      expect(result.success).toBe(false);
    });

    it('rejects dispatch if targeting the same territory', () => {
      const territories = createDefaultTerritories();
      const pBase = territories['p_base'];

      const result = dispatchArmy(pBase, pBase, 'player', 0.5);
      expect(result.success).toBe(false);
    });

    it('successfully dispatches from newly captured territory after ownership transfer', () => {
      const territories = createDefaultTerritories();
      const neutralOutpost = territories['n_bot_left'];
      expect(neutralOutpost.owner).toBe('neutral');

      // Player captures the neutral outpost with 15 units (against 8 defenders)
      const captureResult = resolveArrival(neutralOutpost, 15, 'player');
      expect(captureResult.captured).toBe(true);
      expect(captureResult.newOwner).toBe('player');
      expect(captureResult.remainingUnits).toBe(7);

      // Update territory to captured state
      const capturedTerritory: Territory = {
        ...neutralOutpost,
        owner: captureResult.newOwner,
        units: captureResult.remainingUnits,
      };

      // Player should now be able to dispatch from this newly captured outpost!
      const nextTarget = territories['n_center'];
      const dispatchFromCaptured = dispatchArmy(capturedTerritory, nextTarget, 'player', 0.5);

      expect(dispatchFromCaptured.success).toBe(true);
      expect(dispatchFromCaptured.sourceTerritory!.units).toBe(4); // 7 - 3 = 4
      expect(dispatchFromCaptured.army!.units).toBe(3); // floor(7 * 0.5) = 3
      expect(dispatchFromCaptured.army!.owner).toBe('player');
      expect(dispatchFromCaptured.army!.sourceId).toBe('n_bot_left');
      expect(dispatchFromCaptured.army!.targetId).toBe('n_center');
    });

    it('successfully dispatches from multiple sources toward a single target', () => {
      const territories = createDefaultTerritories();
      // Setup player with base (20 units) and bottom-left outpost (10 units)
      const pBase = territories['p_base'];
      const pOutpost: Territory = {
        ...territories['n_bot_left'],
        owner: 'player',
        units: 10,
      };
      const enemyTarget = territories['e_base'];

      const result = dispatchMultipleArmies([pBase, pOutpost], enemyTarget, 'player', 0.5);

      expect(result.armies.length).toBe(2);
      expect(result.totalUnitsDispatched).toBe(15); // floor(20*0.5)=10 + floor(10*0.5)=5
      expect(result.updatedSources['p_base'].units).toBe(10);
      expect(result.updatedSources['n_bot_left'].units).toBe(5);
      expect(result.armies[0].targetId).toBe('e_base');
      expect(result.armies[1].targetId).toBe('e_base');
    });
  });

  describe('Unit Generation (tickUnitGeneration)', () => {
    it('generates units for owned territories up to maxUnits', () => {
      const territories = createDefaultTerritories();
      let accumulators: Record<string, number> = {};

      // Simulate 5 seconds (productionRate = 1.2 -> 6 units)
      const res = tickUnitGeneration(territories, accumulators, 5.0);
      expect(res.territories['p_base'].units).toBe(26); // 20 + 6
      expect(res.territories['e_base'].units).toBe(26);

      // Neutral territories should NOT generate units
      expect(res.territories['n_center'].units).toBe(14);
      expect(res.territories['n_bot_left'].units).toBe(8);
    });

    it('caps generation at maxUnits', () => {
      const territories = createDefaultTerritories();
      territories['p_base'].units = 64;
      territories['p_base'].maxUnits = 65;
      let accumulators: Record<string, number> = {};

      const res = tickUnitGeneration(territories, accumulators, 10.0);
      expect(res.territories['p_base'].units).toBe(65);
    });
  });

  describe('Simulation Loop & Victory/Defeat (stepSimulation)', () => {
    it('detects victory when enemy has 0 territories and 0 armies', () => {
      const state = createInitialGameState();
      // Player captures all territories
      for (const t of Object.values(state.territories)) {
        t.owner = 'player';
      }
      state.armies = [];

      const step = stepSimulation(state, {}, 0.1);
      expect(step.state.status).toBe('victory');
    });

    it('detects defeat when player has 0 territories and 0 armies', () => {
      const state = createInitialGameState();
      for (const t of Object.values(state.territories)) {
        t.owner = 'enemy';
      }
      state.armies = [];

      const step = stepSimulation(state, {}, 0.1);
      expect(step.state.status).toBe('defeat');
    });

    it('resolves marching army arrival upon progress completion', () => {
      const state = createInitialGameState();
      state.territories['n_bot_left'].owner = 'neutral';
      state.territories['n_bot_left'].units = 5;

      // Spawn an army almost at arrival
      state.armies = [
        {
          id: 'test_army_1',
          sourceId: 'p_base',
          targetId: 'n_bot_left',
          owner: 'player',
          units: 10,
          startX: 200,
          startY: 600,
          targetX: 85,
          targetY: 505,
          progress: 0.95,
          speed: 1.0, // will exceed 1.0 in 0.1s
          distance: 100,
        },
      ];

      const step = stepSimulation(state, {}, 0.1);
      expect(step.state.armies.length).toBe(0); // Arrived and removed
      expect(step.resolvedArrivals.length).toBe(1);
      expect(step.resolvedArrivals[0].captured).toBe(true);
      expect(step.state.territories['n_bot_left'].owner).toBe('player');
      expect(step.state.territories['n_bot_left'].units).toBe(5); // 10 - 5 = 5
      expect(step.state.stats.territoriesCapturedByPlayer).toBe(1);
    });
  });

  describe('AI Move Heuristic (evaluateAiMove)', () => {
    it('selects an action when enemy has ready units', () => {
      const territories = createDefaultTerritories();
      territories['e_base'].units = 25; // Plenty of units
      const move = evaluateAiMove(territories, 'enemy', 8);

      expect(move).not.toBeNull();
      expect(move!.fromId).toBe('e_base');
      expect(territories[move!.toId]).toBeDefined();
      expect(move!.toId).not.toBe('e_base');
    });

    it('returns null if enemy has no territories or insufficient units', () => {
      const territories = createDefaultTerritories();
      territories['e_base'].units = 3; // Below min threshold 8
      const move = evaluateAiMove(territories, 'enemy', 8);
      expect(move).toBeNull();
    });
  });
});
