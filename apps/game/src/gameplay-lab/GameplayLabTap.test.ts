import { expect, it } from 'vitest';
import { GameplayLabTap } from './GameplayLabTap.js';
it('accepts a short CSS-pixel tap and rejects movement, long press, dispatch and stale release', () => {
    const tap = new GameplayLabTap();
    tap.begin('p_base', 10, 10, 0);
    expect(tap.finish(19.9, 10, 250, false)).toBe('p_base');
    tap.begin('p_base', 10, 10, 0);
    expect(tap.finish(20, 10, 100, false)).toBeUndefined();
    tap.begin('p_base', 10, 10, 0);
    tap.move(30, 10);
    expect(tap.finish(10, 10, 100, false)).toBeUndefined();
    tap.begin('p_base', 10, 10, 0);
    expect(tap.finish(10, 10, 251, false)).toBeUndefined();
    tap.begin('p_base', 10, 10, 0);
    expect(tap.finish(10, 10, 100, true)).toBeUndefined();
    tap.begin('p_base', 10, 10, 0);
    tap.cancel();
    expect(tap.finish(10, 10, 100, false)).toBeUndefined();
});
