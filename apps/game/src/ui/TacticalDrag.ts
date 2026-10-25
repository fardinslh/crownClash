import type Phaser from 'phaser';
import { findDispatchRoute, previewOrder, type GameState } from '@crown-clash/game-core';
import { faBattle } from '../i18n/faBattle.js';

export function drawTacticalDrag(
  graphics: Phaser.GameObjects.Graphics, state: GameState, sourceIds: readonly string[], targetId: string | null,
  project: (x: number, y: number) => { u: number; v: number }, scale: number, speed: number,
  cursor?: { u: number; v: number },
  unitMultiplier = 1,
): { label: string; hint: string; color: number; x: number; y: number } {
  for (const target of Object.values(state.territories)) {
    if (sourceIds.includes(target.id)) continue;
    const legal = sourceIds.some(id => findDispatchRoute(state, id, target.id, 'player'));
    if (legal) {
      const p = project(target.x, target.y);
      graphics.lineStyle(2, target.owner === 'player' ? 0x34d399 : 0xfbbf24, .55)
        .strokeCircle(p.u, p.v, (target.radius + 8) * scale);
    }
  }
  const target = targetId ? state.territories[targetId] : undefined;
  const source = state.territories[sourceIds[0]];
  const point = project((target ?? source).x, (target ?? source).y);
  if (!target) {
    const end = cursor ?? point;
    for (const id of sourceIds) {
      const t = state.territories[id], from = project(t.x, t.y);
      graphics.lineStyle(6, 0x020617, .7).lineBetween(from.u, from.v, end.u, end.v);
      graphics.lineStyle(2.5, 0x93c5fd, .8).lineBetween(from.u, from.v, end.u, end.v);
    }
    return { label: faBattle.drag.towersSelected(sourceIds.length), hint: faBattle.drag.towersSelectedHint, color: 0x93c5fd, x: end.u, y: end.v - 58 };
  }
  const preview = previewOrder(state, sourceIds, target.id, 'player', speed, unitMultiplier);
  const sourceCount = sourceIds.length > 1 ? faBattle.drag.partialSources(preview.orders.length, sourceIds.length) : '';
  const unreachable = sourceIds.filter(id => !findDispatchRoute(state, id, target.id, 'player')).length;
  const missing = sourceIds.length - preview.orders.length;
  const excludedReason = unreachable
    ? faBattle.drag.noRoute(unreachable, target.owner === 'player')
    : faBattle.drag.tooFew(missing);
  const color = preview.orders.length ? target.owner === 'player' ? 0x34d399 : 0xfbbf24 : 0xf87171;
  for (const { army } of preview.orders) {
    const route = army.routeIds ?? [army.sourceId, target.id];
    for (let i = 0; i < route.length - 1; i++) {
      const from = state.territories[route[i]], to = state.territories[route[i + 1]];
      const a = project(from.x, from.y), b = project(to.x, to.y);
      graphics.lineStyle(7, 0x020617, .8).lineBetween(a.u, a.v, b.u, b.v);
      graphics.lineStyle(3, color, .95).lineBetween(a.u, a.v, b.u, b.v);
      const angle = Math.atan2(b.v - a.v, b.u - a.u), tip = { u: (a.u + b.u) / 2, v: (a.v + b.v) / 2 };
      graphics.fillStyle(color, 1).fillTriangle(tip.u + Math.cos(angle) * 7, tip.v + Math.sin(angle) * 7,
        tip.u + Math.cos(angle + 2.5) * 7, tip.v + Math.sin(angle + 2.5) * 7,
        tip.u + Math.cos(angle - 2.5) * 7, tip.v + Math.sin(angle - 2.5) * 7);
    }
  }
  const estimate = target.owner === 'player' ? faBattle.drag.estimateReinforce : preview.projected?.owner === 'player' ? faBattle.drag.estimateCapture : faBattle.drag.estimateDefense;
  return { label: preview.orders.length ? `${sourceCount}${faBattle.drag.sendStay(preview.sent, preview.left)}\n${estimate} · ${faBattle.drag.currentBoard}` : `${sourceCount}${excludedReason}`,
    hint: missing ? excludedReason : target.owner === 'player'
      ? faBattle.drag.releaseToReinforce
      : faBattle.drag.mayChange,
    color, x: point.u, y: point.v - 65 * scale };
}
