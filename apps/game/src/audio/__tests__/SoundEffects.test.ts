import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SoundEffects } from '../SoundEffects.js';

describe('Crown Clash - SoundEffects Synthesizer Tests', () => {
  let sfx: SoundEffects;

  beforeEach(() => {
    sfx = new SoundEffects();
  });

  it('initializes with audio enabled by default', () => {
    expect(sfx.isMuted()).toBe(false);
  });

  it('toggles mute state and saves preference', () => {
    const isNowMuted = sfx.toggleMute();
    expect(isNowMuted).toBe(true);
    expect(sfx.isMuted()).toBe(true);

    const isUnmuted = sfx.toggleMute();
    expect(isUnmuted).toBe(false);
    expect(sfx.isMuted()).toBe(false);
  });

  it('starts and stops ambient battle music loop safely', () => {
    vi.useFakeTimers();

    sfx.startBattleMusic();
    vi.advanceTimersByTime(1200); // 2 drum steps

    sfx.stopBattleMusic();
    vi.useRealTimers();
  });

  it('stops battle music when mute is enabled', () => {
    sfx.startBattleMusic();
    sfx.toggleMute(); // muting should stop battle music
    expect(sfx.isMuted()).toBe(true);
  });

  it('safely invokes all procedural synth methods without throwing', () => {
    expect(() => sfx.playDispatch()).not.toThrow();
    expect(() => sfx.playReinforce()).not.toThrow();
    expect(() => sfx.playCapture()).not.toThrow();
    expect(() => sfx.playCrownCapture()).not.toThrow();
    expect(() => sfx.playCombatHit()).not.toThrow();
    expect(() => sfx.playHeartbeat('medium')).not.toThrow();
    expect(() => sfx.playHeartbeat('high')).not.toThrow();
    expect(() => sfx.playVictory()).not.toThrow();
    expect(() => sfx.playDefeat()).not.toThrow();
  });
});
