import Phaser from 'phaser';
import {
  COMMANDERS, getKingdomLevel, isCommanderUnlocked, LOGICAL_WIDTH,
  type CommanderDefinition, type CommanderId,
} from '@crown-clash/game-core';
import { createPlatformAdapter, type PlatformAdapter } from '@crown-clash/platform';
import { trackEvent } from '../analytics/Analytics.js';
import { sounds } from '../audio/SoundEffects.js';
import { CareerManager } from '../career/CareerManager.js';
import { THEME } from '../theme.js';

const FONT = '"Segoe UI", -apple-system, BlinkMacSystemFont, Roboto, Arial, sans-serif';

export class CommanderScene extends Phaser.Scene {
  private platform!: PlatformAdapter;
  private careerManager!: CareerManager;
  private active = true;
  private pending = false;
  private cards: Phaser.GameObjects.Container[] = [];
  private toast?: Phaser.GameObjects.Text;

  constructor() { super({ key: 'CommanderScene' }); }

  create(): void {
    const renderScale = (this.registry.get('renderScale') as number) || 1;
    this.cameras.main.setZoom(renderScale);
    this.cameras.main.centerOn(200, 360);
    this.platform = (this.registry.get('platform') as PlatformAdapter) || createPlatformAdapter();
    this.careerManager = CareerManager.getInstance(this.platform.getUser().id);
    this.active = true;
    this.buildScene();
    this.platform.showBackButton(() => this.close());
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.active = false;
      this.platform.hideBackButton();
    });
    trackEvent({ name: 'commander_panel_viewed' });
  }

  private buildScene(): void {
    this.add.rectangle(200, 360, 400, 720, THEME.background);
    const glow = this.add.graphics();
    glow.fillStyle(0x172554, 0.4).fillCircle(200, 72, 180);
    const back = this.add.rectangle(42, 42, 48, 44, 0x111827).setStrokeStyle(1.5, 0x475569);
    back.setInteractive({ useHandCursor: true }).on('pointerdown', () => this.close());
    this.add.text(42, 40, '<', { fontFamily: FONT, fontSize: '25px', fontStyle: 'bold', color: '#e2e8f0' }).setOrigin(0.5);
    this.add.text(200, 35, 'WAR COUNCIL', {
      fontFamily: FONT, fontSize: '25px', fontStyle: '900', color: '#f8fafc', stroke: '#000000', strokeThickness: 4,
    }).setOrigin(0.5);
    this.add.text(200, 68, 'Choose one battle doctrine', {
      fontFamily: FONT, fontSize: '12px', fontStyle: 'bold', color: '#93c5fd',
    }).setOrigin(0.5);
    const level = getKingdomLevel(this.careerManager.getCareer());
    this.add.text(200, 98, `KINGDOM POWER  ${level}`, {
      fontFamily: FONT, fontSize: '11px', fontStyle: '900', color: '#fbbf24', backgroundColor: '#1c1917', padding: { x: 12, y: 6 },
    }).setOrigin(0.5);
    COMMANDERS.forEach((commander, index) => this.createCard(commander, 188 + index * 157));
    this.add.text(200, 681, 'Sidegrades change strategy, not total power.', {
      fontFamily: FONT, fontSize: '11px', color: '#64748b', fontStyle: 'bold',
    }).setOrigin(0.5);
  }

  private createCard(commander: CommanderDefinition, y: number): void {
    const career = this.careerManager.getCareer();
    const unlocked = isCommanderUnlocked(commander.id, getKingdomLevel(career));
    const selected = career.selectedCommanderId === commander.id;
    const container = this.add.container(200, y);
    container.add(this.add.rectangle(0, 0, 356, 138, selected ? 0x14213d : 0x0f172a, 0.98)
      .setStrokeStyle(selected ? 2.5 : 1.5, selected ? commander.accent : unlocked ? 0x334155 : 0x1e293b));
    container.add(this.add.circle(-132, -20, 30, unlocked ? commander.accent : 0x334155, unlocked ? 0.22 : 0.35)
      .setStrokeStyle(2, unlocked ? commander.accent : 0x475569));
    const initials = commander.name.split(' ').map((word) => word[0]).join('');
    container.add(this.add.text(-132, -20, unlocked ? initials : 'X', {
      fontFamily: FONT, fontSize: '17px', fontStyle: '900', color: unlocked ? '#f8fafc' : '#64748b',
    }).setOrigin(0.5));
    container.add(this.add.text(-92, -54, commander.name.toUpperCase(), {
      fontFamily: FONT, fontSize: '15px', fontStyle: '900', color: unlocked ? '#f8fafc' : '#64748b',
    }));
    container.add(this.add.text(-92, -32, commander.role, {
      fontFamily: FONT, fontSize: '10px', fontStyle: 'bold', color: unlocked ? '#94a3b8' : '#475569',
    }));
    container.add(this.add.text(-92, -5, commander.strength, {
      fontFamily: FONT, fontSize: '11px', fontStyle: 'bold', color: unlocked ? '#86efac' : '#475569',
    }));
    container.add(this.add.text(-92, 15, commander.tradeoff, {
      fontFamily: FONT, fontSize: '11px', fontStyle: 'bold', color: unlocked ? '#fca5a5' : '#475569',
    }));
    const buttonLabel = selected ? 'EQUIPPED' : unlocked ? 'EQUIP' : `POWER ${commander.unlockKingdomLevel}`;
    const button = this.add.rectangle(92, 45, 142, 44, selected ? commander.accent : unlocked ? 0x2563eb : 0x1e293b)
      .setStrokeStyle(1.5, selected ? 0xf8fafc : unlocked ? 0x60a5fa : 0x334155);
    container.add(button);
    container.add(this.add.text(92, 45, buttonLabel, {
      fontFamily: FONT, fontSize: unlocked ? '11px' : '10px', fontStyle: '900', color: selected ? '#07111f' : unlocked ? '#ffffff' : '#64748b',
    }).setOrigin(0.5));
    if (unlocked && !selected) button.setInteractive({ useHandCursor: true }).on('pointerdown', () => void this.select(commander.id));
    this.cards.push(container);
  }

  private async select(commanderId: CommanderId): Promise<void> {
    if (this.pending) return;
    this.pending = true;
    try {
      const result = await this.careerManager.selectCommander(commanderId);
      if (!this.active) return;
      if (!result.success) return this.showToast('Commander is still locked.');
      sounds.playReinforce();
      this.platform.hapticNotification('success');
      trackEvent({ name: 'commander_selected', commanderId });
      this.cards.forEach((card) => card.destroy(true));
      this.cards = [];
      COMMANDERS.forEach((commander, index) => this.createCard(commander, 188 + index * 157));
    } catch (error) {
      console.error('[CommanderScene] Selection failed:', error);
      if (this.active) this.showToast('Could not equip. Try again.');
    } finally { this.pending = false; }
  }

  private showToast(message: string): void {
    this.toast?.destroy();
    this.toast = this.add.text(LOGICAL_WIDTH / 2, 650, message, {
      fontFamily: FONT, fontSize: '11px', fontStyle: 'bold', color: '#fecaca', backgroundColor: '#450a0a', padding: { x: 12, y: 7 },
    }).setOrigin(0.5).setDepth(20);
  }

  private close(): void {
    if (this.pending) return this.showToast('Equipping commander...');
    this.platform.hapticSelection();
    this.scene.start('MenuScene');
  }
}
