import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MUSIC_TRACKS, MusicPlayer } from '../MusicPlayer.js';

function fakeParam() {
  return {
    value: 0,
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
    cancelScheduledValues: vi.fn(),
  };
}

function fakeContext(state: 'running' | 'suspended' = 'running') {
  const started: number[] = [];
  const ctx = {
    state,
    currentTime: 0,
    createGain: vi.fn(() => ({ gain: fakeParam(), connect: vi.fn(), disconnect: vi.fn() })),
    createOscillator: vi.fn(() => ({
      type: 'sine',
      frequency: fakeParam(),
      connect: vi.fn(),
      disconnect: vi.fn(),
      start: vi.fn((at: number) => started.push(at)),
      stop: vi.fn(),
      onended: null,
    })),
  };
  return { ctx, started };
}

describe('MusicPlayer', () => {
  let enabled: boolean;
  let env: ReturnType<typeof fakeContext>;
  let player: MusicPlayer;

  beforeEach(() => {
    vi.useFakeTimers();
    enabled = true;
    env = fakeContext();
    player = new MusicPlayer({
      getContext: () => env.ctx as unknown as AudioContext,
      output: () => ({ connect: vi.fn() }) as unknown as AudioNode,
      isEnabled: () => enabled,
    });
  });

  afterEach(() => {
    player.stop();
    vi.useRealTimers();
  });

  it('schedules notes ahead of the audio clock and keeps scheduling as time advances', () => {
    player.play('hub');
    const first = env.started.length;
    expect(first).toBeGreaterThan(0);
    // Nothing scheduled further than the lookahead window.
    expect(Math.max(...env.started)).toBeLessThan(0.5);

    env.ctx.currentTime = 2;
    vi.advanceTimersByTime(200);
    expect(env.started.length).toBeGreaterThan(first);
  });

  it('is a no-op when the same track is requested again', () => {
    player.play('hub');
    const count = env.started.length;
    player.play('hub');
    expect(env.started.length).toBe(count);
    expect(player.current).toBe('hub');
  });

  it('switches track and stops scheduling after stop()', () => {
    player.play('hub');
    player.play('battle');
    expect(player.current).toBe('battle');

    player.stop();
    expect(player.current).toBeNull();
    const count = env.started.length;
    env.ctx.currentTime = 5;
    vi.advanceTimersByTime(500);
    expect(env.started.length).toBe(count);
  });

  it('does not start while muted and resumes the wanted track on unmute', () => {
    enabled = false;
    player.play('battle');
    expect(env.started.length).toBe(0);
    expect(player.current).toBeNull();

    enabled = true;
    player.resume();
    expect(player.current).toBe('battle');
    expect(env.started.length).toBeGreaterThan(0);
  });

  it('forgets the track after stop() so resume does nothing', () => {
    player.play('hub');
    player.stop();
    player.resume();
    expect(player.current).toBeNull();
  });

  it('waits for a suspended AudioContext instead of scheduling notes', () => {
    env = fakeContext('suspended');
    player.play('hub');
    expect(env.started.length).toBe(0);
  });

  it('skips stale steps after a stall instead of bursting them', () => {
    player.play('battle');
    env.started.length = 0;
    env.ctx.currentTime = 60;
    vi.advanceTimersByTime(100);
    const window = LOOKAHEAD_STEPS(MUSIC_TRACKS.battle.bpm);
    expect(env.started.length).toBeLessThanOrEqual(window * 6);
    expect(Math.min(...env.started)).toBeGreaterThanOrEqual(60);
  });
});

/** Steps that fit the 0.4s lookahead, rounded up. */
function LOOKAHEAD_STEPS(bpm: number): number {
  return Math.ceil(0.4 / (60 / bpm / 2)) + 1;
}
