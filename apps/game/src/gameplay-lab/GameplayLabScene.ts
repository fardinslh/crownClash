import Phaser from 'phaser';
import { dismissStartupLoadingShell } from '../ui/StartupLoadingShell.js';
import { GameplayLabController, GameplayLabStore, isGameplayLabRequested, type LabTrial } from './GameplayLabController.js';
import { GameplayLabUI } from './GameplayLabUI.js';
import type { EngagementVariant } from '@crown-clash/game-core';

export interface GameplayLabLaunch {
  controller: GameplayLabController;
  createUi(): GameplayLabUI;
  retry(): GameplayLabLaunch;
  exit(): void;
}

export function createGameplayLabLaunch(store: GameplayLabStore, participant: number, variant: EngagementVariant, retryOf?: string, kind: LabTrial['kind'] = 'practice'): GameplayLabLaunch {
  const controller = new GameplayLabController(store, participant, variant, retryOf, kind);
  return { controller, createUi: () => new GameplayLabUI(), exit: exitGameplayLab,
    retry: () => createGameplayLabLaunch(store, participant, variant, controller.trial.id, 'optional') };
}

export function exitGameplayLab(): void {
  // Leave without entering the production login/menu path in this session.
  window.location.assign('about:blank');
}

export class GameplayLabScene extends Phaser.Scene {
  constructor() { super('GameplayLabScene'); }
  create(): void {
    if (!isGameplayLabRequested(import.meta.env.DEV, window.location.search)) { this.scene.start('MenuScene'); return; }
    let store = this.registry.get('gameplayLabStore') as GameplayLabStore | undefined;
    if (!store) {
      let storage: Storage | undefined;
      try { storage = window.localStorage; } catch { /* Export remains usable without storage. */ }
      store = new GameplayLabStore(storage);
      this.registry.set('gameplayLabStore', store);
    }
    const ui = new GameplayLabUI();
    ui.selection(store, (participant, variant, kind, retryOf) => this.scene.start('GameScene', {
      gameplayLab: createGameplayLabLaunch(store!, participant, variant, retryOf, kind),
    }), exitGameplayLab);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => ui.destroy());
    dismissStartupLoadingShell();
  }
}
