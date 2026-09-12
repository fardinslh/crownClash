import Phaser from 'phaser';
import { LOGICAL_WIDTH } from '@crown-clash/game-core';
import { createPlatformAdapter, type PlatformAdapter } from '@crown-clash/platform';
import { trackEvent } from '../analytics/Analytics.js';
import { sounds } from '../audio/SoundEffects.js';
import { THEME } from '../theme.js';
import { CareerManager } from '../career/CareerManager.js';
import {
  isTutorialCompleted,
  markTutorialCompleted,
  type TutorialStepId,
} from '../tutorial/TutorialController.js';
import {
  bindSceneViewportResize,
  getSceneViewport,
  setupSceneCamera,
  type SceneViewport,
} from '../ui/Viewport.js';
import { computeTrainingLayout } from '../ui/HubLayouts.js';

const FONT_FAMILY = '"Segoe UI", -apple-system, BlinkMacSystemFont, Roboto, "Helvetica Neue", Arial, sans-serif';

interface Lesson {
  readonly id: TutorialStepId;
  readonly number: string;
  readonly title: string;
  readonly body: string;
  readonly tip: string;
}

const LESSONS: readonly Lesson[] = [
  {
    id: 'drag_to_attack',
    number: '01',
    title: 'DRAG TO COMMAND',
    body: 'Press your blue tower, then drag to another tower. Half its troops march immediately.',
    tip: 'Capture neutral towers early to grow your army.',
  },
  {
    id: 'preview_result',
    number: '02',
    title: 'READ THE OUTCOME',
    body: 'Before release, the battle badge predicts what your arriving army can achieve.',
    tip: 'WIN captures. TIE empties both sides. -N means you need N more troops.',
  },
  {
    id: 'tower_roles',
    number: '03',
    title: 'USE TOWER ROLES',
    body: 'Every captured tower adds a different tactical advantage to your realm.',
    tip: 'DEF resists attacks. PROD recruits faster. SPD launches faster armies.',
  },
  {
    id: 'multi_dispatch',
    number: '04',
    title: 'COMBINE YOUR FORCES',
    body: 'Drag across multiple friendly towers before choosing a target to coordinate one strike.',
    tip: 'Combined attacks break strong defenses before they can reinforce.',
  },
] as const;

export class TrainingScene extends Phaser.Scene {
  private platform!: PlatformAdapter;
  private lessonIndex = 0;
  private analyticsActive = false;
  private finished = false;
  private reducedMotion = false;
  private background!: Phaser.GameObjects.Rectangle;
  private lessonContainer!: Phaser.GameObjects.Container;
  private progressDots: Phaser.GameObjects.Arc[] = [];
  private previousButton!: Phaser.GameObjects.Rectangle;
  private previousText!: Phaser.GameObjects.Text;
  private nextButton!: Phaser.GameObjects.Rectangle;
  private nextText!: Phaser.GameObjects.Text;
  private menuBg!: Phaser.GameObjects.Rectangle;
  private menuText!: Phaser.GameObjects.Text;
  private backHandler?: () => void;
  private isExiting = false;

  constructor() {
    super({ key: 'TrainingScene' });
  }

  create(): void {
    this.isExiting = false;
    setupSceneCamera(this);
    bindSceneViewportResize(this, (vp) => this.applyLayout(vp));
    this.reducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
    this.platform = (this.registry.get('platform') as PlatformAdapter) || createPlatformAdapter();
    this.analyticsActive = !isTutorialCompleted(this.platform.getUser().id);
    if (this.analyticsActive) trackEvent({ name: 'tutorial_started' });

    this.backHandler = () => this.closeTraining();
    this.platform.showBackButton(this.backHandler);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.platform.hideBackButton());

    this.buildScene();
    this.renderLesson();
  }

  private buildScene(): void {
    const vp = getSceneViewport(this);
    this.background = this.add.rectangle(0, 0, 10, 10, 0x070b14);
    const glow = this.add.graphics();
    glow.fillStyle(THEME.gold, 0.08);
    glow.fillCircle(LOGICAL_WIDTH / 2, 150, 220);

    const backBg = this.add
      .rectangle(34, 34, 44, 44, 0x0f172a, 0.96)
      .setStrokeStyle(1.5, 0x334155, 1)
      .setInteractive({ useHandCursor: true });
    const backText = this.add
      .text(34, 34, '‹', {
        fontFamily: FONT_FAMILY,
        fontSize: '22px',
        fontStyle: '900',
        color: '#e2e8f0',
        resolution: 2,
      })
      .setOrigin(0.5);
    this.bindPressFeedback(backBg, backText);
    backBg.on('pointerdown', () => this.closeTraining());

    this.add
      .text(LOGICAL_WIDTH / 2, 34, 'WAR ACADEMY', {
        fontFamily: FONT_FAMILY,
        fontSize: '23px',
        fontStyle: '900',
        color: '#f8fafc',
        stroke: '#000000',
        strokeThickness: 4,
        resolution: 2,
      })
      .setOrigin(0.5);
    this.add
      .text(LOGICAL_WIDTH / 2, 61, 'MASTER THE BATTLEFIELD', {
        fontFamily: FONT_FAMILY,
        fontSize: '10px',
        fontStyle: 'bold',
        color: '#fbbf24',
        resolution: 2,
      })
      .setOrigin(0.5);

    this.lessonContainer = this.add.container(0, 0);
    this.progressDots = [];
    for (let index = 0; index < LESSONS.length; index += 1) {
      this.progressDots.push(this.add.circle(176 + index * 16, 0, 4, 0x334155, 1));
    }

    this.previousButton = this.add
      .rectangle(92, 0, 132, 46, 0x111827, 1)
      .setStrokeStyle(1.5, 0x475569, 1)
      .setInteractive({ useHandCursor: true });
    this.previousText = this.add
      .text(92, 0, 'PREVIOUS', {
        fontFamily: FONT_FAMILY,
        fontSize: '12px',
        fontStyle: '900',
        color: '#cbd5e1',
        resolution: 2,
      })
      .setOrigin(0.5);
    this.bindPressFeedback(this.previousButton, this.previousText);
    this.previousButton.on('pointerdown', () => this.showPrevious());

    this.nextButton = this.add
      .rectangle(276, 0, 216, 46, 0x2563eb, 1)
      .setStrokeStyle(2, 0x60a5fa, 1)
      .setInteractive({ useHandCursor: true });
    this.nextText = this.add
      .text(276, 0, 'NEXT  ›', {
        fontFamily: FONT_FAMILY,
        fontSize: '13px',
        fontStyle: '900',
        color: '#ffffff',
        stroke: '#000000',
        strokeThickness: 2,
        resolution: 2,
      })
      .setOrigin(0.5);
    this.bindPressFeedback(this.nextButton, this.nextText);
    this.nextButton.on('pointerdown', () => this.advance());

    this.menuBg = this.add
      .rectangle(LOGICAL_WIDTH / 2, 0, 316, 44, 0x0b1120, 1)
      .setStrokeStyle(1, 0x334155, 1)
      .setInteractive({ useHandCursor: true });
    this.menuText = this.add
      .text(LOGICAL_WIDTH / 2, 0, 'RETURN TO MAIN MENU', {
        fontFamily: FONT_FAMILY,
        fontSize: '11px',
        fontStyle: 'bold',
        color: '#94a3b8',
        resolution: 2,
      })
      .setOrigin(0.5);
    this.bindPressFeedback(this.menuBg, this.menuText);
    this.menuBg.on('pointerdown', () => this.closeTraining());

    this.applyLayout(vp);
  }

  applyLayout(vp: SceneViewport): void {
    const layout = computeTrainingLayout(vp.visibleHeight);
    this.background.setPosition(vp.visibleWidth / 2, vp.visibleHeight / 2).setSize(vp.visibleWidth, vp.visibleHeight);
    this.tweens.killTweensOf(this.lessonContainer);
    this.lessonContainer.setY(layout.cardOffset);
    for (const dot of this.progressDots) {
      dot.setY(layout.dotsY);
    }
    this.previousButton.setY(layout.navigationButtonsY);
    this.previousText.setY(layout.navigationButtonsY);
    this.nextButton.setY(layout.navigationButtonsY);
    this.nextText.setY(layout.navigationButtonsY);
    this.menuBg.setY(layout.menuButtonY);
    this.menuText.setY(layout.menuButtonY);
  }

  private renderLesson(): void {
    this.tweens.killTweensOf(this.lessonContainer);
    this.lessonContainer.removeAll(true);
    const lesson = LESSONS[this.lessonIndex];
    const card = this.add.graphics();
    card.fillStyle(0x0c1322, 0.98);
    card.fillRoundedRect(24, 88, 352, 438, 16);
    card.lineStyle(2, this.lessonIndex === 3 ? THEME.gold : 0x334155, 1);
    card.strokeRoundedRect(24, 88, 352, 438, 16);

    const number = this.add.text(48, 112, lesson.number, {
      fontFamily: FONT_FAMILY,
      fontSize: '12px',
      fontStyle: '900',
      color: '#fbbf24',
      resolution: 2,
    });
    const title = this.add.text(48, 136, lesson.title, {
      fontFamily: FONT_FAMILY,
      fontSize: '19px',
      fontStyle: '900',
      color: '#f8fafc',
      stroke: '#000000',
      strokeThickness: 3,
      resolution: 2,
    });
    const body = this.add.text(48, 174, lesson.body, {
      fontFamily: FONT_FAMILY,
      fontSize: '12px',
      fontStyle: 'bold',
      color: '#cbd5e1',
      lineSpacing: 5,
      wordWrap: { width: 304 },
      resolution: 2,
    });
    const diagram = this.add.graphics();
    this.lessonContainer.add([card, number, title, body, diagram]);
    this.drawLessonDiagram(diagram, lesson.id);
    const tipBg = this.add.rectangle(200, 466, 304, 74, 0x111c33, 0.95).setStrokeStyle(1, 0x334155, 1);
    const tipLabel = this.add.text(62, 444, 'FIELD NOTE', {
      fontFamily: FONT_FAMILY,
      fontSize: '9px',
      fontStyle: '900',
      color: '#60a5fa',
      resolution: 2,
    });
    const tip = this.add.text(62, 462, lesson.tip, {
      fontFamily: FONT_FAMILY,
      fontSize: '11px',
      fontStyle: 'bold',
      color: '#e2e8f0',
      wordWrap: { width: 276 },
      resolution: 2,
    });

    this.lessonContainer.add([tipBg, tipLabel, tip]);
    this.progressDots.forEach((dot, index) => {
      dot.setFillStyle(index === this.lessonIndex ? THEME.gold : 0x334155, 1);
      dot.setScale(index === this.lessonIndex ? 1.25 : 1);
    });
    this.previousButton.setAlpha(this.lessonIndex === 0 ? 0.35 : 1);
    this.previousText.setAlpha(this.lessonIndex === 0 ? 0.35 : 1);
    if (this.lessonIndex === 0) this.previousButton.disableInteractive();
    else this.previousButton.setInteractive({ useHandCursor: true });
    this.nextText.setText(this.lessonIndex === LESSONS.length - 1 ? 'PRACTICE BATTLE  ⚔' : 'NEXT  ›');

    const { visibleHeight } = getSceneViewport(this);
    const layout = computeTrainingLayout(visibleHeight);
    if (!this.reducedMotion) {
      this.lessonContainer.setAlpha(0).setY(layout.cardOffset + 10);
      this.tweens.add({
        targets: this.lessonContainer,
        alpha: 1,
        y: layout.cardOffset,
        duration: 220,
        ease: 'Cubic.easeOut',
      });
    } else {
      this.lessonContainer.setY(layout.cardOffset);
    }
  }

  private drawLessonDiagram(graphics: Phaser.GameObjects.Graphics, step: TutorialStepId): void {
    const tower = (x: number, y: number, color: number, label: string): void => {
      graphics.fillStyle(0x020617, 0.45);
      graphics.fillEllipse(x, y + 20, 62, 14);
      graphics.fillStyle(color, 1);
      graphics.fillRoundedRect(x - 24, y - 16, 48, 36, 6);
      graphics.fillStyle(0xcbd5e1, 1);
      graphics.fillTriangle(x - 28, y - 16, x, y - 38, x + 28, y - 16);
      graphics.fillStyle(0x0f172a, 1);
      graphics.fillRect(x - 5, y + 2, 10, 18);
      graphics.fillStyle(0xffffff, 0.9);
      graphics.fillCircle(x, y - 7, 3);
      this.lessonContainer.add(
        this.add
          .text(x, y + 34, label, {
            fontFamily: FONT_FAMILY,
            fontSize: '10px',
            fontStyle: '900',
            color: '#cbd5e1',
            resolution: 2,
          })
          .setOrigin(0.5)
      );
    };
    const arrow = (x1: number, y1: number, x2: number, y2: number): void => {
      graphics.lineStyle(4, THEME.gold, 0.95);
      graphics.lineBetween(x1, y1, x2, y2);
      graphics.fillStyle(THEME.gold, 1);
      graphics.fillTriangle(x2, y2, x2 - 13, y2 - 7, x2 - 13, y2 + 7);
    };

    if (step === 'drag_to_attack') {
      tower(105, 330, THEME.teams.player.primary, 'YOUR TOWER');
      tower(295, 330, THEME.teams.neutral.primary, 'TARGET');
      arrow(145, 330, 255, 330);
      return;
    }
    if (step === 'preview_result') {
      tower(105, 340, THEME.teams.player.primary, '28 TROOPS');
      tower(295, 340, THEME.teams.enemy.primary, '18 DEFENDERS');
      arrow(145, 340, 255, 340);
      graphics.fillStyle(0x052e16, 1);
      graphics.fillRoundedRect(164, 270, 72, 34, 8);
      graphics.lineStyle(2, 0x34d399, 1);
      graphics.strokeRoundedRect(164, 270, 72, 34, 8);
      this.lessonContainer.add(
        this.add
          .text(200, 287, 'WIN +10', {
            fontFamily: FONT_FAMILY,
            fontSize: '12px',
            fontStyle: '900',
            color: '#6ee7b7',
            resolution: 2,
          })
          .setOrigin(0.5)
      );
      return;
    }
    if (step === 'tower_roles') {
      const roles = [
        { x: 96, color: 0x60a5fa, label: 'DEF', detail: 'ARMOR' },
        { x: 200, color: 0x34d399, label: 'PROD', detail: 'RECRUIT' },
        { x: 304, color: 0xfbbf24, label: 'SPD', detail: 'MARCH' },
      ];
      for (const role of roles) {
        graphics.fillStyle(role.color, 0.16);
        graphics.fillRoundedRect(role.x - 42, 276, 84, 112, 10);
        graphics.lineStyle(2, role.color, 0.9);
        graphics.strokeRoundedRect(role.x - 42, 276, 84, 112, 10);
        graphics.fillStyle(role.color, 1);
        graphics.fillCircle(role.x, 314, 20);
        this.lessonContainer.add(
          this.add
            .text(role.x, 314, role.label, {
              fontFamily: FONT_FAMILY,
              fontSize: role.label === 'PROD' ? '10px' : '12px',
              fontStyle: '900',
              color: '#07111f',
              resolution: 2,
            })
            .setOrigin(0.5)
        );
        this.lessonContainer.add(
          this.add
            .text(role.x, 360, role.detail, {
              fontFamily: FONT_FAMILY,
              fontSize: '9px',
              fontStyle: '900',
              color: '#cbd5e1',
              resolution: 2,
            })
            .setOrigin(0.5)
        );
      }
      return;
    }

    tower(92, 290, THEME.teams.player.primary, 'SOURCE 1');
    tower(92, 380, THEME.teams.player.primary, 'SOURCE 2');
    tower(300, 335, THEME.teams.enemy.primary, 'TARGET');
    arrow(132, 290, 260, 327);
    arrow(132, 380, 260, 343);
  }

  private showPrevious(): void {
    if (this.lessonIndex === 0) return;
    this.lessonIndex -= 1;
    this.platform.hapticSelection();
    this.renderLesson();
  }

  private advance(): void {
    if (this.finished || this.isExiting) return;
    const lesson = LESSONS[this.lessonIndex];
    if (this.analyticsActive) {
      trackEvent({ name: 'tutorial_step_completed', stepId: lesson.id });
    }
    if (this.lessonIndex < LESSONS.length - 1) {
      this.lessonIndex += 1;
      this.platform.hapticSelection();
      this.renderLesson();
      return;
    }

    this.isExiting = true;
    this.finished = true;
    this.nextButton.disableInteractive();
    if (this.analyticsActive) {
      markTutorialCompleted(this.platform.getUser().id);
      trackEvent({ name: 'tutorial_completed' });
    }
    sounds.playDispatch();
    this.platform.hapticNotification('success');
    const careerManager = CareerManager.getInstance(this.platform.getUser().id);
    void careerManager
      .startBotMatch(this.platform)
      .then((botMatch) => {
        if (!this.scene.isActive()) return;
        this.scene.start('GameScene', { source: 'menu', botMatch });
      })
      .catch((error: unknown) => {
        console.warn('[TrainingScene] Post-tutorial match start fallback to menu:', error);
        if (!this.scene.isActive()) return;
        this.scene.start('MenuScene');
      });
  }

  private closeTraining(): void {
    if (this.isExiting) return;
    this.isExiting = true;
    if (this.analyticsActive && !this.finished) {
      trackEvent({
        name: 'tutorial_skipped',
        lastStepId: LESSONS[this.lessonIndex].id,
      });
    }
    this.scene.start('MenuScene');
  }

  private bindPressFeedback(
    background: Phaser.GameObjects.Rectangle,
    label: Phaser.GameObjects.Text
  ): void {
    const reset = (): void => {
      background.setScale(1);
      label.setScale(1);
    };
    background.on('pointerdown', () => {
      background.setScale(0.96);
      label.setScale(0.96);
    });
    background.on('pointerup', reset);
    background.on('pointerout', reset);
  }
}
