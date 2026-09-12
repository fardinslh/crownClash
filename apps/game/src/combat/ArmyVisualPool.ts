import type Phaser from 'phaser';
import type { MarchingArmy, TerritoryType } from '@crown-clash/game-core';
import { TERRITORY_TYPE_PRESENTATION } from '@crown-clash/game-core';

const FONT_FAMILY = '"Segoe UI", -apple-system, BlinkMacSystemFont, Roboto, "Helvetica Neue", Arial, sans-serif';

export interface ArmyFollower {
  shadow: Phaser.GameObjects.Image;
  sprite: Phaser.GameObjects.Image;
  relX: number;
  relY: number;
  delaySeconds: number;
}

export interface ArmyVisual {
  id: string;
  container: Phaser.GameObjects.Container;
  leaderSprite: Phaser.GameObjects.Image;
  leaderShadow: Phaser.GameObjects.Image;
  roleAura: Phaser.GameObjects.Arc;
  badgeBg: Phaser.GameObjects.Rectangle;
  badgeText: Phaser.GameObjects.Text;
  followers: ArmyFollower[];
  rearOffset: { x: number; y: number };
  dustTimer: number;
  dustInterval: number;
  dustColor: number;
  roleLabel: string;
  phaseSeconds: number;
  activeFollowerCount: number;
}

export const MAX_FOLLOWERS_PER_ARMY = 4;

export class ArmyVisualPool {
  private freeList: ArmyVisual[] = [];
  private allVisuals: ArmyVisual[] = [];

  constructor(
    private readonly scene: Phaser.Scene,
    initialCapacity = 16
  ) {
    for (let i = 0; i < initialCapacity; i++) {
      this.allocateOne();
    }
  }

  private allocateOne(): ArmyVisual {
    const scene = this.scene;
    const container = scene.add.container(0, 0).setDepth(35).setVisible(false);
    if (typeof (container as any).removeFromDisplayList === 'function') {
      (container as any).removeFromDisplayList();
    }

    // Role Aura Circle
    const roleAura = scene.add.circle(0, 1, 15, 0x3b82f6, 0.1);
    container.add(roleAura);

    // Followers (pre-allocated up to MAX_FOLLOWERS_PER_ARMY)
    const followers: ArmyFollower[] = [];
    for (let fIdx = 0; fIdx < MAX_FOLLOWERS_PER_ARMY; fIdx++) {
      const shadow = scene.add.image(0, 7, 'unit_shadow_texture').setDisplaySize(16, 8).setAlpha(0.4).setVisible(false);
      const sprite = scene.add.image(0, 0, 'unit_follower_player').setScale(0.19).setVisible(false);
      container.add([shadow, sprite]);
      followers.push({
        shadow,
        sprite,
        relX: 0,
        relY: 0,
        delaySeconds: 0,
      });
    }

    // Leader Unit
    const leaderShadow = scene.add.image(0, 9, 'unit_shadow_texture').setDisplaySize(22, 10).setAlpha(0.45);
    const leaderSprite = scene.add.image(0, 0, 'unit_leader_player').setScale(0.25);

    // Troop Count Badge
    const badgeBg = scene.add.rectangle(0, -19, 42, 18, 0x090d16, 0.94);
    const badgeText = scene.add
      .text(0, -19, '', {
        fontFamily: FONT_FAMILY,
        fontSize: '12px',
        fontStyle: 'bold',
        color: '#ffffff',
        stroke: '#000000',
        strokeThickness: 2.5,
        resolution: 2,
      })
      .setOrigin(0.5);

    container.add([leaderShadow, leaderSprite, badgeBg, badgeText]);

    const visual: ArmyVisual = {
      id: '',
      container,
      leaderSprite,
      leaderShadow,
      roleAura,
      badgeBg,
      badgeText,
      followers,
      rearOffset: { x: 0, y: 0 },
      dustTimer: 0.05,
      dustInterval: 0.14,
      dustColor: 0x3b82f6,
      roleLabel: '',
      phaseSeconds: 0,
      activeFollowerCount: 0,
    };

    this.freeList.push(visual);
    this.allVisuals.push(visual);
    return visual;
  }

  /**
   * Acquires and reconfigures a visual from the pool without allocating new GameObjects.
   */
  public acquire(
    army: MarchingArmy,
    sourceType: TerritoryType,
    reducedEffects = false
  ): ArmyVisual {
    let visual = this.freeList.pop();
    if (!visual) {
      visual = this.allocateOne();
      this.freeList.pop(); // remove newly added from freeList
    }

    const currentX = army.startX + (army.targetX - army.startX) * army.progress;
    const currentY = army.startY + (army.targetY - army.startY) * army.progress;
    const roleStyle = TERRITORY_TYPE_PRESENTATION[sourceType] ?? TERRITORY_TYPE_PRESENTATION.barracks;

    visual.id = `${army.owner}:${army.id}`;
    if (typeof (visual.container as any).addToDisplayList === 'function') {
      (visual.container as any).addToDisplayList();
    }
    visual.container.setPosition(currentX, currentY).setVisible(true);

    const angle = Math.atan2(army.targetY - army.startY, army.targetX - army.startX);
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const perpX = -sin;
    const perpY = cos;
    const isFacingLeft = cos < -0.05;

    // Determine follower configuration
    const followerTexture = army.owner === 'player' ? 'unit_follower_player' : 'unit_follower_enemy';
    const leaderTexture = army.owner === 'player' ? 'unit_leader_player' : 'unit_leader_enemy';

    // Role Aura
    visual.roleAura
      .setFillStyle(roleStyle.color, 0.1)
      .setStrokeStyle(sourceType === 'fortress' ? 3 : 1.5, roleStyle.color, 0.82);

    // Leader
    if (visual.leaderSprite.texture.key !== leaderTexture) {
      visual.leaderSprite.setTexture(leaderTexture);
    }
    visual.leaderSprite.setFlipX(isFacingLeft).setScale(0.25).setPosition(0, 0);

    // Follower Formation Setup
    let targetFollowerCount = 1;
    if (!reducedEffects) {
      if (army.units >= 15) targetFollowerCount = sourceType === 'barracks' ? 4 : 3;
      else if (army.units >= 6) targetFollowerCount = 2;
    }
    visual.activeFollowerCount = Math.min(targetFollowerCount, MAX_FOLLOWERS_PER_ARMY);

    const offsets: Array<{ x: number; y: number; delay: number }> = [];
    if (targetFollowerCount >= 4) {
      offsets.push(
        { x: -14 * cos + 7 * perpX, y: -14 * sin + 7 * perpY, delay: 45 },
        { x: -22 * cos - 7 * perpX, y: -22 * sin - 7 * perpY, delay: 90 },
        { x: -30 * cos, y: -30 * sin, delay: 135 },
        { x: -38 * cos + 9 * perpX, y: -38 * sin + 9 * perpY, delay: 150 }
      );
    } else if (targetFollowerCount === 3) {
      offsets.push(
        { x: -14 * cos + 7 * perpX, y: -14 * sin + 7 * perpY, delay: 45 },
        { x: -22 * cos - 7 * perpX, y: -22 * sin - 7 * perpY, delay: 90 },
        { x: -30 * cos, y: -30 * sin, delay: 135 }
      );
    } else if (targetFollowerCount === 2) {
      offsets.push(
        { x: -15 * cos + 6 * perpX, y: -15 * sin + 6 * perpY, delay: 50 },
        { x: -24 * cos - 6 * perpX, y: -24 * sin - 6 * perpY, delay: 100 }
      );
    } else {
      offsets.push({ x: -16 * cos, y: -16 * sin, delay: 60 });
    }

    for (let fIdx = 0; fIdx < MAX_FOLLOWERS_PER_ARMY; fIdx++) {
      const f = visual.followers[fIdx];
      if (fIdx < visual.activeFollowerCount) {
        const off = offsets[fIdx];
        f.relX = off.x;
        f.relY = off.y;
        f.delaySeconds = off.delay / 1000;
        if (f.sprite.texture.key !== followerTexture) {
          f.sprite.setTexture(followerTexture);
        }
        f.sprite.setPosition(off.x, off.y).setFlipX(isFacingLeft).setScale(0.19).setVisible(true);
        f.shadow.setPosition(off.x, off.y + 7).setVisible(true);
      } else {
        f.sprite.setVisible(false);
        f.shadow.setVisible(false);
      }
    }

    const lastOffset = offsets[offsets.length - 1] ?? { x: 0, y: 0 };
    visual.rearOffset.x = lastOffset.x;
    visual.rearOffset.y = lastOffset.y;

    // Badge
    const unitsStr = `${roleStyle.label} ${army.units}`;
    const badgeWidth = Math.max(42, unitsStr.length * 7 + 14);
    visual.badgeBg.setSize(badgeWidth, 18).setStrokeStyle(1.5, roleStyle.color, 1);
    visual.badgeText.setText(unitsStr);
    visual.roleLabel = roleStyle.label;
    visual.dustColor = roleStyle.color;
    visual.dustInterval = sourceType === 'stable' ? 0.09 : sourceType === 'barracks' ? 0.14 : 0.18;
    visual.dustTimer = 0.05;
    visual.phaseSeconds = 0;

    return visual;
  }

  /**
   * Returns visual to the pool and resets visibility.
   */
  public release(visual: ArmyVisual): void {
    visual.id = '';
    visual.container.setVisible(false);
    if (typeof (visual.container as any).removeFromDisplayList === 'function') {
      (visual.container as any).removeFromDisplayList();
    }
    this.scene.tweens.killTweensOf(visual.container);
    visual.container.setScale(1).setAlpha(1);
    this.freeList.push(visual);
  }

  public getPoolStats(): { total: number; free: number; active: number } {
    return {
      total: this.allVisuals.length,
      free: this.freeList.length,
      active: this.allVisuals.length - this.freeList.length,
    };
  }

  public destroy(): void {
    for (const visual of this.allVisuals) {
      this.scene.tweens.killTweensOf(visual.container);
      for (const f of visual.followers) {
        f.sprite.destroy();
        f.shadow.destroy();
      }
      visual.leaderSprite.destroy();
      visual.leaderShadow.destroy();
      visual.roleAura.destroy();
      visual.badgeText.destroy();
      visual.badgeBg.destroy();
      visual.container.destroy();
    }
    this.freeList = [];
    this.allVisuals = [];
  }
}
