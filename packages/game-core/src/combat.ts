import { CombatResult, Team, Territory } from './types.js';
import { getRemainingDefenders, getTerritoryDefenseStrength } from './territory-types.js';

/**
 * Resolves combat or reinforcement when a marching army arrives at a territory.
 * Deterministic and pure function suitable for both client simulation and backend validation.
 */
export function resolveArrival(
  target: Territory,
  incomingUnits: number,
  attackerOwner: Team
): CombatResult {
  if (incomingUnits <= 0) {
    return {
      targetId: target.id,
      attackerOwner,
      previousOwner: target.owner,
      newOwner: target.owner,
      previousUnits: target.units,
      incomingUnits: 0,
      remainingUnits: target.units,
      captured: false,
      reinforced: false,
    };
  }

  const previousOwner = target.owner;
  const previousUnits = target.units;

  // Case 1: Friendly territory -> Reinforcement
  if (attackerOwner === previousOwner) {
    const remainingUnits = previousUnits + incomingUnits;
    return {
      targetId: target.id,
      attackerOwner,
      previousOwner,
      newOwner: previousOwner,
      previousUnits,
      incomingUnits,
      remainingUnits,
      captured: false,
      reinforced: true,
    };
  }

  // Case 2: Hostile territory (Enemy or Neutral) -> Combat
  const defenseStrength = getTerritoryDefenseStrength(target);

  if (incomingUnits > defenseStrength) {
    // Attacker overpowers defender: territory is captured!
    const remainingUnits = incomingUnits - defenseStrength;
    return {
      targetId: target.id,
      attackerOwner,
      previousOwner,
      newOwner: attackerOwner,
      previousUnits,
      incomingUnits,
      remainingUnits,
      captured: true,
      reinforced: false,
    };
  }

  if (incomingUnits < defenseStrength) {
    // Defender repels the attack with remaining units
    const remainingUnits = getRemainingDefenders(target.type, defenseStrength - incomingUnits);
    return {
      targetId: target.id,
      attackerOwner,
      previousOwner,
      newOwner: previousOwner,
      previousUnits,
      incomingUnits,
      remainingUnits,
      captured: false,
      reinforced: false,
    };
  }

  // Exact tie: units cancel out to 0, owner remains unchanged
  return {
    targetId: target.id,
    attackerOwner,
    previousOwner,
    newOwner: previousOwner,
    previousUnits,
    incomingUnits,
    remainingUnits: 0,
    captured: false,
    reinforced: false,
  };
}
