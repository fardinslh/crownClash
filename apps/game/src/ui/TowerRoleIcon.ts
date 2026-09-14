import type Phaser from 'phaser';
import type { TerritoryType } from '@crown-clash/game-core';
import { TERRITORY_TYPE_PRESENTATION } from '@crown-clash/game-core';

export type TowerRoleIconKind = 'defense' | 'production' | 'speed';

const ROLE_KIND_MAP: Record<TerritoryType, TowerRoleIconKind> = {
  fortress: 'defense',
  barracks: 'production',
  stable: 'speed',
};

const ACCESSIBLE_NAME_MAP: Record<TerritoryType, 'Defense' | 'Production' | 'Speed'> = {
  fortress: 'Defense',
  barracks: 'Production',
  stable: 'Speed',
};

export function getTowerRoleIconKind(type: TerritoryType): TowerRoleIconKind {
  return ROLE_KIND_MAP[type];
}

export function getTowerRoleAccessibleName(type: TerritoryType): 'Defense' | 'Production' | 'Speed' {
  return ACCESSIBLE_NAME_MAP[type];
}

export interface IconPoint {
  readonly x: number;
  readonly y: number;
}

export type IconShape =
  | { readonly kind: 'polygon'; readonly points: readonly IconPoint[]; readonly fillColor: number }
  | { readonly kind: 'circle'; readonly cx: number; readonly cy: number; readonly radius: number; readonly fillColor: number }
  | { readonly kind: 'line'; readonly x1: number; readonly y1: number; readonly x2: number; readonly y2: number; readonly strokeColor: number; readonly strokeWidth: number };

export interface TowerRoleIconGeometry {
  readonly kind: TowerRoleIconKind;
  readonly bounds: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
  readonly shapes: readonly IconShape[];
}

export function computeTowerRoleIconGeometry(
  type: TerritoryType,
  x: number,
  y: number,
  size: number
): TowerRoleIconGeometry {
  const kind = ROLE_KIND_MAP[type];
  if (!Number.isFinite(size) || size <= 0) {
    return { kind, bounds: { x, y, width: 0, height: 0 }, shapes: [] };
  }

  const bounds = { x, y, width: size, height: size };
  const color = TERRITORY_TYPE_PRESENTATION[type].color;
  const pad = Math.max(0.5, Math.round(size * 0.08 * 10) / 10);
  const x0 = x + pad;
  const y0 = y + pad;
  const w = size - 2 * pad;
  const h = size - 2 * pad;

  if (kind === 'defense') {
    return {
      kind,
      bounds,
      shapes: [
        {
          kind: 'polygon',
          points: [
            { x: x0, y: y0 },
            { x: x0 + w, y: y0 },
            { x: x0 + w, y: y0 + h * 0.52 },
            { x: x0 + w * 0.5, y: y0 + h },
            { x: x0, y: y0 + h * 0.52 },
          ],
          fillColor: color,
        },
        {
          kind: 'line',
          x1: x0 + w * 0.5,
          y1: y0 + h * 0.14,
          x2: x0 + w * 0.5,
          y2: y0 + h * 0.84,
          strokeColor: 0x070d1a,
          strokeWidth: Math.max(1, Math.round(size * 0.07)),
        },
      ],
    };
  }

  if (kind === 'production') {
    return {
      kind,
      bounds,
      shapes: [
        {
          kind: 'circle',
          cx: x + size / 2,
          cy: y0 + h * 0.2,
          radius: Math.max(1, h * 0.16),
          fillColor: color,
        },
        {
          kind: 'polygon',
          points: [
            { x: x + size / 2, y: y0 + h * 0.44 },
            { x: x0 + w * 0.95, y: y0 + h * 0.74 },
            { x: x0 + w * 0.84, y: y0 + h },
            { x: x + size / 2, y: y0 + h * 0.72 },
            { x: x0 + w * 0.16, y: y0 + h },
            { x: x0 + w * 0.05, y: y0 + h * 0.74 },
          ],
          fillColor: color,
        },
      ],
    };
  }

  return {
    kind,
    bounds,
    shapes: [
      {
        kind: 'polygon',
        points: [
          { x: x0 + w, y: y + size / 2 },
          { x: x0 + w * 0.48, y: y0 + h * 0.14 },
          { x: x0 + w * 0.6, y: y + size / 2 },
          { x: x0 + w * 0.48, y: y0 + h * 0.86 },
        ],
        fillColor: color,
      },
      {
        kind: 'line',
        x1: x0,
        y1: y0 + h * 0.32,
        x2: x0 + w * 0.42,
        y2: y0 + h * 0.32,
        strokeColor: color,
        strokeWidth: Math.max(1, Math.round(size * 0.08)),
      },
      {
        kind: 'line',
        x1: x0,
        y1: y0 + h * 0.68,
        x2: x0 + w * 0.42,
        y2: y0 + h * 0.68,
        strokeColor: color,
        strokeWidth: Math.max(1, Math.round(size * 0.08)),
      },
    ],
  };
}

export type RoleIconGraphics = Pick<
  Phaser.GameObjects.Graphics,
  'fillStyle' | 'fillCircle' | 'lineStyle' | 'lineBetween' | 'beginPath' | 'moveTo' | 'lineTo' | 'closePath' | 'fillPath'
>;

export function drawTowerRoleIcon(
  graphics: RoleIconGraphics,
  type: TerritoryType,
  x: number,
  y: number,
  size: number
): void {
  const geom = computeTowerRoleIconGeometry(type, x, y, size);
  for (const s of geom.shapes) {
    if (s.kind === 'circle') {
      graphics.fillStyle(s.fillColor, 1);
      graphics.fillCircle(s.cx, s.cy, s.radius);
    } else if (s.kind === 'line') {
      graphics.lineStyle(s.strokeWidth, s.strokeColor, 1);
      graphics.lineBetween(s.x1, s.y1, s.x2, s.y2);
    } else {
      graphics.fillStyle(s.fillColor, 1);
      graphics.beginPath();
      graphics.moveTo(s.points[0].x, s.points[0].y);
      for (let i = 1; i < s.points.length; i++) {
        graphics.lineTo(s.points[i].x, s.points[i].y);
      }
      graphics.closePath();
      graphics.fillPath();
    }
  }
}
