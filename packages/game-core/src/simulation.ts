import { resolveArrival } from './combat.js';
import { tickUnitGeneration } from './generation.js';
import { createDefaultTerritories } from './map.js';
import { CombatResult, GameState, MarchingArmy, MatchStatus, Territory } from './types.js';
import type { PlayerUpgradeModifiers } from './upgrades.js';
import { normalizeBattlefieldId, type BattlefieldId } from './battlefields.js';
import { ABILITY_CONFIG, CAPTURE_RECOVERY_MS, GAMEPLAY_RULES_VERSION, TACTICAL_CONFIG, hasCaptureRecovery, usesTacticalRules, getCaptureProductionMultiplier, validateGameplayRulesVersion, type GameplayRulesVersion } from './gameplay-rules.js';
import { advanceRoutedArmy, TACTICAL_SUPPORTS } from './tactical-routes.js';

export interface StepResult {
  state: GameState;
  accumulators: Record<string, number>;
  resolvedArrivals: CombatResult[];
}

export const DEFAULT_MATCH_TIME_LIMIT = 90; // 90 seconds maximum match duration

export interface InitialGameOptions {
  gameplayRulesVersion?: GameplayRulesVersion;
  timeLimit?: number;
  playerModifiers?: PlayerUpgradeModifiers;
  enemyModifiers?: PlayerUpgradeModifiers;
  battlefieldId?: BattlefieldId;
}

export function createInitialGameState(options: number | InitialGameOptions = DEFAULT_MATCH_TIME_LIMIT): GameState {
  const timeLimit = typeof options === 'number' ? options : (options.timeLimit ?? DEFAULT_MATCH_TIME_LIMIT);
  const playerModifiers = typeof options === 'number' ? undefined : options.playerModifiers;
  const enemyModifiers = typeof options === 'number' ? undefined : options.enemyModifiers;
  const battlefieldId = normalizeBattlefieldId(
    typeof options === 'number' ? undefined : options.battlefieldId
  );

  const version = validateGameplayRulesVersion(typeof options === 'number' ? GAMEPLAY_RULES_VERSION : (options.gameplayRulesVersion ?? GAMEPLAY_RULES_VERSION));
  const territories = createDefaultTerritories(playerModifiers, enemyModifiers, battlefieldId);
  if (usesTacticalRules(version)) {
    if (battlefieldId === 'quad_citadel') throw new Error('tactical_rules_require_1v1');
    territories.p_base.units += TACTICAL_CONFIG.baseBonus;
    territories.e_base.units += TACTICAL_CONFIG.baseBonus;
    TACTICAL_SUPPORTS[battlefieldId].forEach((id, i) => {
      territories[id].owner = i === 0 ? 'player' : 'enemy';
      territories[id].units = TACTICAL_CONFIG.supportUnits;
      territories[id].productionRate *= (i === 0 ? playerModifiers : enemyModifiers)?.productionRateMultiplier ?? 1;
    });
  }
  return {
    battlefieldId,
    territories,
    armies: [],
    status: 'playing',
    elapsedTimeSeconds: 0,
    timeLimitSeconds: timeLimit,
    stats: {
      matchDurationSeconds: 0,
      playerUnitsDispatched: 0,
      enemyUnitsDispatched: 0,
      territoriesCapturedByPlayer: 0,
      territoriesCapturedByEnemy: 0,
    },
    gameplayRulesVersion: version,
  };
}

/**
 * Steps the match simulation forward by deltaSeconds.
 * Completely deterministic and independent of any rendering library.
 */
export function stepSimulation(
  currentState: GameState,
  accumulators: Record<string, number>,
  deltaSeconds: number
): StepResult {
  if (currentState.status !== 'playing') {
    return {
      state: currentState,
      accumulators,
      resolvedArrivals: [],
    };
  }

  const recoveryEnabled = hasCaptureRecovery(currentState.gameplayRulesVersion);
  const elapsed = currentState.elapsedTimeSeconds + deltaSeconds;
  const newElapsed = recoveryEnabled ? Math.round(elapsed * 1e9) / 1e9 : elapsed;
  const nowMs = Math.round(newElapsed * 1000);
  const readyTimes = recoveryEnabled ? { ...currentState.productionReadyAtMs } : undefined;
  const generationAccumulators = recoveryEnabled ? { ...accumulators } : accumulators;
  const territories: Record<string, Territory> = {};
  for (const [id, t] of Object.entries(currentState.territories)) {
    territories[id] = { ...t };
  }

  // 1. Move armies and check arrivals
  const remainingArmies: MarchingArmy[] = [];
  const resolvedArrivals: CombatResult[] = [];
  const stats = { ...currentState.stats, matchDurationSeconds: newElapsed };

  for (const originalArmy of currentState.armies) {
    const routed = usesTacticalRules(currentState.gameplayRulesVersion) ? advanceRoutedArmy(originalArmy, territories, deltaSeconds) : null;
    const army = routed?.army ?? originalArmy;
    const nextProgress = routed ? (routed.arrived ? 1 : army.progress) : army.progress + army.speed * deltaSeconds;

    if (nextProgress >= 1.0) {
      // Army arrived at target!
      const target = territories[army.targetId];
      if (target) {
        const shielded = (currentState.shieldedUntilMs?.[target.id] ?? 0) > nowMs;
        const combat = resolveArrival(target, army.units, army.owner, shielded ? ABILITY_CONFIG.shieldDefenseMultiplier : 1);
        if (army.routeIds && army.targetId !== army.routeIds[army.routeIds.length - 1]) combat.routeInterrupted = true;
        target.owner = combat.newOwner;
        target.units = combat.remainingUnits;
        resolvedArrivals.push(combat);

        if (combat.captured) {
          if (readyTimes) {
            // Recaptures preserve a recovery already in progress, for either owner.
            if ((readyTimes[target.id] ?? 0) <= nowMs) readyTimes[target.id] = nowMs + CAPTURE_RECOVERY_MS;
            generationAccumulators[target.id] = 0;
          }
          if (combat.newOwner === 'player') {
            stats.territoriesCapturedByPlayer++;
          } else if (combat.newOwner === 'enemy') {
            stats.territoriesCapturedByEnemy++;
          }
        }
      }
    } else {
      remainingArmies.push({
        ...army,
        progress: nextProgress,
      });
    }
  }

  // 2. Tick passive unit generation for owned territories
  const productionMultipliers = readyTimes ? Object.fromEntries(Object.entries(readyTimes).map(([id, readyAtMs]) =>
    [id, getCaptureProductionMultiplier(newElapsed, readyAtMs)])) : undefined;
  const genResult = tickUnitGeneration(territories, generationAccumulators, deltaSeconds, productionMultipliers);

  // 3. Check win / loss status
  let status: MatchStatus = 'playing';

  const playerTerritories = Object.values(genResult.territories).filter((t) => t.owner === 'player');
  const enemyTerritories = Object.values(genResult.territories).filter((t) => t.owner === 'enemy');
  const playerArmies = remainingArmies.filter((a) => a.owner === 'player');
  const enemyArmies = remainingArmies.filter((a) => a.owner === 'enemy');

  if (enemyTerritories.length === 0 && enemyArmies.length === 0) {
    status = 'victory';
  } else if (playerTerritories.length === 0 && playerArmies.length === 0) {
    status = 'defeat';
  } else if (newElapsed >= currentState.timeLimitSeconds) {
    // Time limit reached: decide by territories then total units
    const playerTotal = playerTerritories.reduce((acc, t) => acc + t.units, 0);
    const enemyTotal = enemyTerritories.reduce((acc, t) => acc + t.units, 0);

    if (playerTerritories.length > enemyTerritories.length) {
      status = 'victory';
    } else if (enemyTerritories.length > playerTerritories.length) {
      status = 'defeat';
    } else if (playerTotal > enemyTotal) {
      status = 'victory';
    } else if (enemyTotal > playerTotal) {
      status = 'defeat';
    } else {
      status = 'draw';
    }
  }

  return {
    state: {
      battlefieldId: currentState.battlefieldId,
      territories: genResult.territories,
      armies: remainingArmies,
      status,
      elapsedTimeSeconds: newElapsed,
      timeLimitSeconds: currentState.timeLimitSeconds,
      stats,
      ...(currentState.gameplayRulesVersion !== undefined ? { gameplayRulesVersion: currentState.gameplayRulesVersion } : {}),
      ...(readyTimes && Object.keys(readyTimes).length ? { productionReadyAtMs: readyTimes } : {}),
      ...(currentState.shieldedUntilMs ? { shieldedUntilMs: currentState.shieldedUntilMs } : {}),
      ...(currentState.playerAbilityUsed ? { playerAbilityUsed: true } : {}),
    },
    accumulators: genResult.accumulators,
    resolvedArrivals,
  };
}
