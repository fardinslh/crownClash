import { describe, expect, it, vi } from 'vitest';
import type { TerritoryType } from '@crown-clash/game-core';
import { TERRITORY_TYPE_PRESENTATION } from '@crown-clash/game-core';
import {
  computeTowerRoleIconGeometry,
  drawTowerRoleIcon,
  getTowerRoleAccessibleName,
  getTowerRoleIconKind,
  type RoleIconGraphics,
} from '../TowerRoleIcon.js';

describe('TowerRoleIcon', () => {
  it('maps TerritoryType to icon kind and accessible name', () => {
    const roles: TerritoryType[] = ['fortress', 'barracks', 'stable'];
    expect(roles.map(getTowerRoleIconKind)).toEqual(['defense', 'production', 'speed']);
    expect(roles.map(getTowerRoleAccessibleName)).toEqual(['Defense', 'Production', 'Speed']);
  });

  it.each([12, 16, 20])('keeps all icons inside bounds at %dx%d logical pixels', (size) => {
    for (const role of ['fortress', 'barracks', 'stable'] as const) {
      const { bounds, shapes } = computeTowerRoleIconGeometry(role, 20, 30, size);
      expect(bounds).toEqual({ x: 20, y: 30, width: size, height: size });
      expect(shapes.length).toBeGreaterThan(0);

      for (const shape of shapes) {
        if (shape.kind === 'polygon') {
          for (const pt of shape.points) {
            expect(pt.x).toBeGreaterThanOrEqual(bounds.x);
            expect(pt.x).toBeLessThanOrEqual(bounds.x + bounds.width);
            expect(pt.y).toBeGreaterThanOrEqual(bounds.y);
            expect(pt.y).toBeLessThanOrEqual(bounds.y + bounds.height);
          }
        } else if (shape.kind === 'circle') {
          expect(shape.cx - shape.radius).toBeGreaterThanOrEqual(bounds.x);
          expect(shape.cx + shape.radius).toBeLessThanOrEqual(bounds.x + bounds.width);
          expect(shape.cy - shape.radius).toBeGreaterThanOrEqual(bounds.y);
          expect(shape.cy + shape.radius).toBeLessThanOrEqual(bounds.y + bounds.height);
        } else {
          expect(Math.min(shape.x1, shape.x2)).toBeGreaterThanOrEqual(bounds.x);
          expect(Math.max(shape.x1, shape.x2)).toBeLessThanOrEqual(bounds.x + bounds.width);
          expect(Math.min(shape.y1, shape.y2)).toBeGreaterThanOrEqual(bounds.y);
          expect(Math.max(shape.y1, shape.y2)).toBeLessThanOrEqual(bounds.y + bounds.height);
        }
      }
    }
  });

  it('produces structurally distinct geometry across all three roles', () => {
    const defense = computeTowerRoleIconGeometry('fortress', 0, 0, 16);
    const production = computeTowerRoleIconGeometry('barracks', 0, 0, 16);
    const speed = computeTowerRoleIconGeometry('stable', 0, 0, 16);

    expect(defense.kind).toBe('defense');
    expect(production.kind).toBe('production');
    expect(speed.kind).toBe('speed');

    expect(defense.shapes.map((s) => s.kind)).toEqual(['polygon', 'line']);
    expect(production.shapes.map((s) => s.kind)).toEqual(['circle', 'polygon']);
    expect(speed.shapes.map((s) => s.kind)).toEqual(['polygon', 'line', 'line']);
  });

  it('safely handles non-positive and non-finite sizes', () => {
    for (const invalidSize of [0, -10, NaN, Infinity]) {
      const geom = computeTowerRoleIconGeometry('fortress', 10, 10, invalidSize);
      expect(geom.bounds).toEqual({ x: 10, y: 10, width: 0, height: 0 });
      expect(geom.shapes).toEqual([]);
    }
  });

  it('draws geometry into Phaser graphics with matching colors and commands', () => {
    const graphics: RoleIconGraphics = {
      fillStyle: vi.fn(),
      fillCircle: vi.fn(),
      lineStyle: vi.fn(),
      lineBetween: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      closePath: vi.fn(),
      fillPath: vi.fn(),
    };

    drawTowerRoleIcon(graphics, 'fortress', 0, 0, 16);
    expect(graphics.fillStyle).toHaveBeenCalledWith(TERRITORY_TYPE_PRESENTATION.fortress.color, 1);
    expect(graphics.fillPath).toHaveBeenCalled();
    expect(graphics.lineBetween).toHaveBeenCalledTimes(1);

    vi.clearAllMocks();
    drawTowerRoleIcon(graphics, 'barracks', 0, 0, 16);
    expect(graphics.fillStyle).toHaveBeenCalledWith(TERRITORY_TYPE_PRESENTATION.barracks.color, 1);
    expect(graphics.fillCircle).toHaveBeenCalled();
    expect(graphics.fillPath).toHaveBeenCalled();

    vi.clearAllMocks();
    drawTowerRoleIcon(graphics, 'stable', 0, 0, 16);
    expect(graphics.fillStyle).toHaveBeenCalledWith(TERRITORY_TYPE_PRESENTATION.stable.color, 1);
    expect(graphics.lineBetween).toHaveBeenCalledTimes(2);

    vi.clearAllMocks();
    drawTowerRoleIcon(graphics, 'fortress', 0, 0, 0);
    expect(graphics.fillPath).not.toHaveBeenCalled();
    expect(graphics.fillCircle).not.toHaveBeenCalled();
  });
});
