import { findDispatchRoute, previewOrder, type GameState } from '@crown-clash/game-core';
import type { TutorialStepId } from './TutorialController.js';
import type { TrainingGuidance } from './trainingGuidance.js';

export function resolveTacticalTrainingGuidance(state: GameState, step: TutorialStepId): TrainingGuidance {
  const owned = Object.values(state.territories).filter(t => t.owner === 'player' && t.units > 1)
    .sort((a, b) => b.units - a.units || a.id.localeCompare(b.id));
  const result = (path: string[]): TrainingGuidance => ({ spotlightIds: path, hintPath: path });
  if (step === 'multi_dispatch') {
    for (const source of owned) for (const target of owned) {
      const route = findDispatchRoute(state, source.id, target.id, 'player');
      if (route && route.length >= 3) return result([source.id, target.id]);
    }
    for (const source of owned) for (const target of owned) if (findDispatchRoute(state, source.id, target.id, 'player')) return result([source.id, target.id]);
  }
  const targets = Object.values(state.territories).filter(t => t.owner !== 'player' && (step === 'destroy_base' || t.id !== 'e_base'))
    .sort((a, b) => (step === 'destroy_base' ? a.y - b.y : b.y - a.y) || a.id.localeCompare(b.id));
  for (const target of targets) {
    const sources = owned.filter(s => findDispatchRoute(state, s.id, target.id, 'player')).map(s => s.id);
    if (previewOrder(state, sources, target.id, 'player').projected?.owner === 'player') return result([...sources, target.id]);
  }
  // Concentrate rear troops at a legal frontier instead of demonstrating an illegal attack.
  for (const target of targets) for (const front of owned) {
    if (!findDispatchRoute(state, front.id, target.id, 'player')) continue;
    const rear = owned.find(t => t.id !== front.id && findDispatchRoute(state, t.id, front.id, 'player'));
    if (rear) return result([rear.id, front.id]);
    return result([front.id, target.id]);
  }
  return result([]);
}
