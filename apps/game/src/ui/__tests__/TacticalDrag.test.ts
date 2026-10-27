import { describe, expect, it, vi } from 'vitest';
import { createInitialGameState } from '@crown-clash/game-core';
import { drawTacticalDrag } from '../TacticalDrag.js';
import { faBattle } from '../../i18n/faBattle.js';

function fakeGraphics() {
  const rings: number[] = [];
  const graphics = {
    lineStyle: vi.fn((_w: number, color: number) => { graphics.color = color; return graphics; }),
    strokeCircle: vi.fn(() => { rings.push(graphics.color); return graphics; }),
    lineBetween: vi.fn(() => graphics),
    fillStyle: vi.fn(() => graphics),
    fillTriangle: vi.fn(() => graphics),
    color: 0,
  };
  return { graphics, rings };
}

const project = (x: number, y: number) => ({ u: x, v: y });
const RED = 0xf87171;

function training() {
  const state = createInitialGameState({ gameplayRulesVersion: 3 });
  state.territories.n_bot_left.owner = 'player';
  state.territories.n_bot_left.units = 14;
  state.territories.p_base.units = 40;
  return state;
}

describe('drawTacticalDrag partial multi-tower attacks', () => {
  it('explains on the badge which tower has no direct road and rings it', () => {
    // p_base and n_bot_left share only n_center; n_bot_right is next to p_base alone.
    const state = training();
    const { graphics, rings } = fakeGraphics();
    const view = drawTacticalDrag(graphics as never, state, ['p_base', 'n_bot_left'], 'n_bot_right', project, 1, 1);
    expect(view.label).toContain(faBattle.drag.partialSources(1, 2));
    expect(view.label).toContain(faBattle.drag.noRoute(1, false));
    expect(rings).toContain(RED);
  });

  it('shows no exclusion when both towers have a road to the target', () => {
    const state = training();
    const { graphics, rings } = fakeGraphics();
    const view = drawTacticalDrag(graphics as never, state, ['p_base', 'n_bot_left'], 'n_center', project, 1, 1);
    expect(view.label).toContain(faBattle.drag.partialSources(2, 2));
    expect(view.label).not.toContain(faBattle.drag.noRoute(1, false));
    expect(rings).not.toContain(RED);
  });

  it('reports a tower that is too weak separately from one without a road', () => {
    const state = training();
    state.territories.n_bot_left.units = 1;
    const { graphics } = fakeGraphics();
    const view = drawTacticalDrag(graphics as never, state, ['p_base', 'n_bot_left'], 'n_center', project, 1, 1);
    expect(view.label).toContain(faBattle.drag.tooFew(1));
    expect(view.label).not.toContain(faBattle.drag.noRoute(1, false));
  });
});
