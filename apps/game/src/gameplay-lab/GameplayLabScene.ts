import Phaser from 'phaser';
import { dismissStartupLoadingShell } from '../ui/StartupLoadingShell.js';
import { GameplayLabController, GameplayLabStore, isGameplayLabRequested } from './GameplayLabController.js';
import { GameplayLabUI } from './GameplayLabUI.js';
import type { GameplayLabVariant } from '@crown-clash/game-core';

export interface GameplayLabLaunch {
  controller: GameplayLabController;
  createUi(): GameplayLabUI;
  retry(): GameplayLabLaunch;
  exit(): void;
}

export function createGameplayLabLaunch(store: GameplayLabStore, participant: number, variant: GameplayLabVariant, retryOf?: string): GameplayLabLaunch {
  const controller = new GameplayLabController(store, participant, variant, retryOf);
  return { controller, createUi: () => new GameplayLabUI(), exit: exitGameplayLab,
    retry: () => createGameplayLabLaunch(store, participant, variant, controller.trial.id) };
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
    ui.selection(store, (participant, variant) => this.scene.start('GameScene', {
      gameplayLab: createGameplayLabLaunch(store!, participant, variant),
    }), exitGameplayLab);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => ui.destroy());
    dismissStartupLoadingShell();
  }
}
