import { describe, expect, it } from 'vitest';
import { LOGICAL_WIDTH } from '@crown-clash/game-core';
import { computeLevelsLayout } from '../LevelsLayout.js';

const HEIGHTS = [640, 720, 800, 932, 1400];

describe('computeLevelsLayout', () => {
  it('starts level 1 at the bottom right and zigzags up the road', () => {
    const { nodes } = computeLevelsLayout(10, 720);
    expect(nodes).toHaveLength(10);
    expect(nodes[0].x).toBeGreaterThan(LOGICAL_WIDTH / 2);
    expect(nodes[1].x).toBeLessThan(LOGICAL_WIDTH / 2);
    expect(nodes[0].labelSide).toBe('right');
    expect(nodes[1].labelSide).toBe('left');
    for (let i = 1; i < nodes.length; i++) expect(nodes[i].y).toBeLessThan(nodes[i - 1].y);
  });

  it('keeps every node, with its label side free, inside the viewport', () => {
    for (const height of HEIGHTS) {
      const layout = computeLevelsLayout(10, height);
      for (const node of layout.nodes) {
        expect(node.x - layout.nodeRadius, `height ${height}`).toBeGreaterThanOrEqual(0);
        expect(node.x + layout.nodeRadius, `height ${height}`).toBeLessThanOrEqual(LOGICAL_WIDTH);
        expect(node.y - layout.nodeRadius, `height ${height}`).toBeGreaterThanOrEqual(96);
        expect(node.y + layout.nodeRadius, `height ${height}`).toBeLessThanOrEqual(height);
      }
    }
  });

  it('keeps the weekly button below the road and the progress line, inside the viewport', () => {
    for (const height of HEIGHTS) {
      const layout = computeLevelsLayout(10, height);
      const first = layout.nodes[0];
      expect(layout.progressY, `height ${height}`).toBeGreaterThan(first.y + layout.nodeRadius);
      expect(layout.weeklyY - layout.weeklyHeight / 2, `height ${height}`).toBeGreaterThan(layout.progressY + 8);
      expect(layout.weeklyY + layout.weeklyHeight / 2, `height ${height}`).toBeLessThanOrEqual(height);
      expect(layout.weeklyHeight).toBeGreaterThanOrEqual(44);
    }
  });

  it('keeps nodes tappable and never overlapping their neighbours', () => {
    for (const height of HEIGHTS) {
      const layout = computeLevelsLayout(10, height);
      expect(layout.nodeRadius * 2, `height ${height}`).toBeGreaterThanOrEqual(44);
      for (let i = 1; i < layout.nodes.length; i++) {
        const a = layout.nodes[i - 1], b = layout.nodes[i];
        expect(Math.hypot(a.x - b.x, a.y - b.y), `height ${height}`).toBeGreaterThan(layout.nodeRadius * 2);
      }
    }
  });

  it('handles an empty or odd level count', () => {
    expect(computeLevelsLayout(0, 720).nodes).toEqual([]);
    expect(computeLevelsLayout(3, 720).nodes).toHaveLength(3);
  });
});
