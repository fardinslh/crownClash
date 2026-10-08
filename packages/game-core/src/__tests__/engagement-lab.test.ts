import { describe, expect, it } from 'vitest';
import { ENGAGEMENT_VARIANTS, GameplayLabBattle, replayGameplayLab, getBattlefield, gameplayLabRules, chooseLabProductionUpgrade, evaluateTacticalLabMove, forecastLabBattle, stepSimulation } from '../index.js';
import type { GameState, Team } from '../types.js';
function incoming(state: GameState, targetId: string, owner: Team, units: number, seconds: number, progress = 0): void {
    const target = state.territories[targetId];
    state.armies.push({ id: `fixture_${state.armies.length}`, sourceId: owner === 'player' ? 'p_base' : 'e_base', targetId, owner, units,
        startX: 0, startY: 0, targetX: target.x, targetY: target.y, progress, speed: 1 / seconds, distance: 100 });
}
function threatFixture(): GameplayLabBattle {
    const b = new GameplayLabBattle('capture_recovery_tactical', false);
    for (const t of Object.values(b.state.territories)) {
        t.owner = 'neutral';
        t.units = 100;
        t.productionRate = 0;
    }
    Object.assign(b.state.territories.p_base, { owner: 'player', units: 20 });
    Object.assign(b.state.territories.e_base, { owner: 'enemy', units: 30 });
    Object.assign(b.state.territories.n_top_right, { owner: 'enemy', units: 2 });
    incoming(b.state, 'n_top_right', 'player', 12, 3);
    return b;
}
describe('engagement experiment', () => {
    it('keeps C mechanics for all variants and changes only D local territory values', () => {
        const before = JSON.stringify(getBattlefield('crown_cross'));
        const c = new GameplayLabBattle('capture_recovery', false), d = new GameplayLabBattle('capture_recovery_targets', false);
        for (const v of ENGAGEMENT_VARIANTS) {
            const b = new GameplayLabBattle(v, false);
            expect(b.state.territories.p_base.units).toBe(20);
            expect(b.state.territories.e_base.units).toBe(20);
            expect(b.state.timeLimitSeconds).toBe(90);
            expect(b.state.rules?.roadSpeedMultiplier).toBe(1);
            expect(b.state.rules?.captureProductionRecoveryTicks).toBe(150);
            expect(b.state.rules?.captureInitialProductionMultiplier).toBe(.5);
        }
        expect(d.state.territories.n_bot_left).toMatchObject({ units: 9, productionRate: 1.4 });
        expect(d.state.territories.n_top_right).toMatchObject({ units: 9, productionRate: 1.4 });
        expect(d.state.territories.n_bot_right).toMatchObject({ units: 6, productionRate: .9 });
        expect(d.state.territories.n_top_left).toMatchObject({ units: 6, productionRate: .9 });
        expect(d.state.territories.n_mid_left).toMatchObject({ units: 12, productionRate: 1.1 });
        expect(d.state.territories.n_mid_right).toMatchObject({ units: 12, productionRate: 1.1 });
        expect(d.state.territories.n_center).toMatchObject({ units: 16, productionRate: 1.4 });
        for (const [id, t] of Object.entries(d.state.territories))
            for (const field of ['x', 'y', 'radius', 'type', 'tier', 'maxUnits'] as const)
                expect(t[field]).toBe(c.state.territories[id][field]);
        expect(JSON.stringify(getBattlefield('crown_cross'))).toBe(before);
    });
    it.each(['player', 'enemy'] as const)('charges exactly 12 for %s, keeps one defender and rejects duplicate/invalid upgrades atomically', (owner) => {
        const b = new GameplayLabBattle('capture_recovery_upgrade', false), id = owner === 'player' ? 'p_base' : 'e_base';
        b.state.territories[id].units = 12;
        const before = structuredClone(b.state);
        expect(b.upgrade(id, owner)).toBe(false);
        expect(b.state).toEqual(before);
        b.state.territories[id].units = 13;
        expect(b.upgrade(id, owner)).toBe(true);
        expect(b.state.territories[id].units).toBe(1);
        const upgraded = structuredClone(b.state);
        expect(b.upgrade(id, owner)).toBe(false);
        expect(b.state).toEqual(upgraded);
        expect(b.upgrade('missing', owner)).toBe(false);
        expect(b.upgrade(id, owner === 'player' ? 'enemy' : 'player')).toBe(false);
        expect(b.record.actions).toEqual([{ type: 'upgrade', tick: 0, owner, territoryId: id }]);
        b.state.status = 'draw';
        expect(b.upgrade(owner === 'player' ? 'e_base' : 'p_base', owner)).toBe(false);
        expect(new GameplayLabBattle('capture_recovery', false).upgrade('p_base')).toBe(false);
    });
    it('multiplies upgrade by recovery and role, removes on capture, and permits the new owner to upgrade', () => {
        const b = new GameplayLabBattle('capture_recovery_upgrade', false), t = b.state.territories.n_bot_left;
        Object.assign(t, { owner: 'player', units: 30, productionRate: 40, maxUnits: 1000 });
        b.state.productionReadyTicks = { n_bot_left: 151 };
        b.state.simulationTick = 0;
        expect(b.upgrade(t.id)).toBe(true);
        const after = stepSimulation(b.state, {}, .02);
        // 40 * barracks 1.25 * upgrade 1.5 * recovery 0.5 * .02 = .75
        expect(after.accumulators[t.id]).toBe(.75);
        expect(after.state.territories[t.id].units).toBe(18);
        incoming(after.state, t.id, 'enemy', 100, 1, .99);
        const capture = stepSimulation(after.state, after.accumulators, .02);
        expect(capture.resolvedArrivals[0].captured).toBe(true);
        expect(capture.state.productionUpgrades?.[t.id]).toBeUndefined();
        expect(capture.state.productionReadyTicks?.[t.id]).toBe(151);
        b.state = capture.state;
        b.accumulators = capture.accumulators;
        expect(b.upgrade(t.id, 'enemy')).toBe(true);
        expect(b.state.territories[t.id].type).toBe('barracks');
        expect(b.state.territories[t.id].maxUnits).toBe(1000);
    });
    it('F bot picks quickest eligible payback and respects threats, time, units and one command cadence', () => {
        const b = new GameplayLabBattle('capture_recovery_upgrade');
        b.state.territories.e_base.units = 24;
        expect(chooseLabProductionUpgrade(b.state)).toBe('e_base');
        incoming(b.state, 'e_base', 'player', 2, 4);
        expect(chooseLabProductionUpgrade(b.state)).toBeNull();
        b.state.armies = [];
        b.state.elapsedTimeSeconds = 51;
        expect(chooseLabProductionUpgrade(b.state)).toBeNull();
        b.state.elapsedTimeSeconds = 0;
        b.state.territories.e_base.units = 23;
        expect(chooseLabProductionUpgrade(b.state)).toBeNull();
        b.state.territories.e_base.units = 24;
        for (let i = 0; i < 89; i++)
            b.step();
        expect(b.record.actions).toHaveLength(0);
        b.step();
        expect(b.record.actions).toHaveLength(1);
        expect(b.record.actions[0]).toMatchObject({ type: 'upgrade', tick: 90, owner: 'enemy' });
        expect(b.state.productionUpgrades?.e_base).toBe(true);
    });
    it('F ranks payback including recovery, then uses stable IDs for equal investments', () => {
        const b = new GameplayLabBattle('capture_recovery_upgrade', false);
        b.state.territories.e_base.units = 24;
        b.state.elapsedTimeSeconds = 49.5;
        expect(chooseLabProductionUpgrade(b.state)).toBe('e_base');
        b.state.productionReadyTicks = { e_base: 150 };
        expect(chooseLabProductionUpgrade(b.state)).toBeNull();
        b.state.elapsedTimeSeconds = 0;
        for (const id of ['n_top_right', 'n_mid_left'])
            Object.assign(b.state.territories[id], { owner: 'enemy', units: 24, productionRate: 2, type: 'barracks' });
        expect(chooseLabProductionUpgrade(b.state)).toBe('n_mid_left');
    });
    it('E defends before arrival, keeps sources safe and leaves input state untouched', () => {
        const b = threatFixture(), before = structuredClone(b.state);
        const move = evaluateTacticalLabMove(b.state, b.accumulators);
        expect(move).toEqual({ fromId: 'e_base', toId: 'n_top_right' });
        expect(b.state).toEqual(before);
        expect(b.accumulators).toEqual({});
        expect(b.dispatch([move!.fromId], move!.toId, 'enemy').armies).toHaveLength(1);
        for (let i = 0; i < 160; i++)
            b.step();
        expect(b.state.territories.n_top_right.owner).toBe('enemy');
    });
    it('E refuses late defense or defense that exposes its source', () => {
        const late = threatFixture();
        late.state.armies[0].progress = .9;
        expect(evaluateTacticalLabMove(late.state, {})).toBeNull();
        const risky = threatFixture();
        incoming(risky.state, 'e_base', 'player', 20, 2.5);
        expect(evaluateTacticalLabMove(risky.state, {})).toBeNull();
    });
    it('E checks exact fortress rounding across multiple incoming attacks before spending a source', () => {
        const b = threatFixture();
        incoming(b.state, 'e_base', 'player', 4, 1);
        incoming(b.state, 'e_base', 'player', 16, 2.5);
        // Baseline forecast has 28 defenders after the first attack. Subtracting
        // 15 would predict 13; the real withdrawn fortress retains only 12.
        expect(evaluateTacticalLabMove(b.state, {})).toBeNull();
        b.dispatch(['e_base'], 'n_top_right', 'enemy');
        for (let tick = 0; tick < 130; tick++) b.step();
        expect(b.state.territories.e_base.owner).toBe('player');
    });
    it('E prioritizes earliest threats, suppresses covered attacks and breaks ties by ID', () => {
        const b = threatFixture();
        Object.assign(b.state.territories.n_top_left, { owner: 'enemy', units: 2 });
        incoming(b.state, 'n_top_left', 'player', 12, 2);
        expect(evaluateTacticalLabMove(b.state, {})).toEqual({ fromId: 'e_base', toId: 'n_top_left' });
        const duplicate = threatFixture();
        duplicate.state.armies = [];
        duplicate.state.territories.n_top_right.owner = 'neutral';
        duplicate.state.territories.e_base.units = 100;
        incoming(duplicate.state, 'p_base', 'enemy', 100, 3);
        const move = evaluateTacticalLabMove(duplicate.state, {});
        expect(move?.toId).not.toBe('p_base');
        const reversed = { ...b.state, territories: Object.fromEntries(Object.entries(b.state.territories).reverse()) };
        expect(evaluateTacticalLabMove(reversed, {})).toEqual(evaluateTacticalLabMove(b.state, {}));
        expect(forecastLabBattle(b.state, {}).arrivals[0].arrival.targetId).toBe('n_top_left');
    });
    it.each(ENGAGEMENT_VARIANTS)('replays %s including both actors and upgrades to exact state and accumulator', (variant) => {
        const b = new GameplayLabBattle(variant);
        if (variant === 'capture_recovery_upgrade')
            expect(b.upgrade('p_base')).toBe(true);
        expect(b.dispatch(['p_base'], 'n_bot_right').armies).toHaveLength(1);
        for (let i = 0; i < 1000; i++)
            b.step();
        b.quit();
        expect(b.record.actions.some(a => a.owner === 'enemy')).toBe(true);
        const replay = replayGameplayLab(b.record);
        expect(replay.state).toEqual(b.state);
        expect(replay.accumulators).toEqual(b.accumulators);
        expect(replay.record).toEqual(b.record);
    });
    it('rejects invalid replay variants, ticks and duplicate upgrade commands', () => {
        const b = new GameplayLabBattle('capture_recovery_upgrade', false);
        expect(b.upgrade('p_base')).toBe(true);
        b.quit();
        expect(() => replayGameplayLab({ ...b.record, actions: [...b.record.actions, ...b.record.actions] })).toThrow('invalid_lab_replay_action');
        expect(() => replayGameplayLab({ ...b.record, durationSeconds: .01 })).toThrow('invalid_lab_replay_result');
    });
});
