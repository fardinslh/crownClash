import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SoundEffects } from '../SoundEffects.js';

/** Counts the Web Audio nodes each sound builds. */
class FakeAudioContext {
  static instances: FakeAudioContext[] = [];
  static filters = true;
  readonly counts = { oscillator: 0, buffer: 0, bufferSource: 0, filter: 0 };
  currentTime = 0;
  sampleRate = 8000;
  state = 'running';
  destination = { connect() {} };
  constructor() {
    FakeAudioContext.instances.push(this);
    if (!FakeAudioContext.filters) {
      (this as { createBiquadFilter?: unknown }).createBiquadFilter = undefined;
    }
  }
  resume() { return Promise.resolve(); }
  private param() {
    return { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {}, linearRampToValueAtTime() {} };
  }
  private node() {
    return { connect() {}, disconnect() {} };
  }
  createGain() { return { ...this.node(), gain: this.param() }; }
  createDynamicsCompressor() {
    return { ...this.node(), threshold: this.param(), knee: this.param(), ratio: this.param(), attack: this.param(), release: this.param() };
  }
  createOscillator() {
    this.counts.oscillator++;
    return { ...this.node(), type: 'sine', frequency: this.param(), start() {}, stop() {} };
  }
  createBuffer(_channels: number, length: number) {
    this.counts.buffer++;
    const data = new Float32Array(length);
    return { getChannelData: () => data };
  }
  createBufferSource() {
    this.counts.bufferSource++;
    return { ...this.node(), buffer: null, start() {}, stop() {} };
  }
  createBiquadFilter() {
    this.counts.filter++;
    return { ...this.node(), type: 'lowpass', frequency: this.param(), Q: this.param() };
  }
}

describe('SoundEffects synthesized impacts', () => {
  let clock = 0;

  beforeEach(() => {
    FakeAudioContext.instances = [];
    FakeAudioContext.filters = true;
    clock = 1000;
    vi.stubGlobal('window', { AudioContext: FakeAudioContext });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const make = () => new SoundEffects({ now: () => clock });
  const ctx = () => FakeAudioContext.instances[0];

  it('builds the noise buffer once and reuses it for every impact', () => {
    const sfx = make();
    sfx.playCombatHit();
    clock += 100;
    sfx.playDispatch(2);
    clock += 100;
    sfx.playTowerLost();
    expect(ctx().counts.buffer).toBe(1);
    expect(ctx().counts.bufferSource).toBeGreaterThanOrEqual(3);
  });

  it('collapses hits that land within 60 ms into one voice', () => {
    const sfx = make();
    sfx.playCombatHit();
    const afterFirst = { ...ctx().counts };
    clock += 30;
    sfx.playCombatHit();
    sfx.playDeflect();
    expect(ctx().counts).toEqual(afterFirst);
    clock += 60;
    sfx.playCombatHit();
    expect(ctx().counts.oscillator).toBeGreaterThan(afterFirst.oscillator);
  });

  it('builds no audio nodes while muted', () => {
    const sfx = make();
    sfx.toggleMute();
    sfx.playSelect();
    sfx.playDispatch(3);
    sfx.playCombatHit();
    sfx.playCapture();
    const created = FakeAudioContext.instances.reduce((n, c) => n + c.counts.oscillator + c.counts.bufferSource, 0);
    expect(created).toBe(0);
  });

  it('falls back to tones on WebViews without filters', () => {
    FakeAudioContext.filters = false;
    const sfx = make();
    expect(() => {
      sfx.playSelect();
      clock += 100;
      sfx.playDispatch();
      clock += 100;
      sfx.playCombatHit();
      clock += 100;
      sfx.playDeflect();
      clock += 200;
      sfx.playTowerLost();
      clock += 200;
      sfx.playCapture();
    }).not.toThrow();
    expect(ctx().counts.bufferSource).toBe(0);
    // Dispatch and hit replace their noise layer with a tone.
    expect(ctx().counts.oscillator).toBeGreaterThanOrEqual(8);
  });

  it('makes a multi-tower order sound bigger than a single send', () => {
    const single = make();
    single.playDispatch(1);
    const singleOsc = ctx().counts.oscillator;
    FakeAudioContext.instances = [];
    const multi = make();
    multi.playDispatch(3);
    expect(ctx().counts.oscillator).toBeGreaterThan(singleOsc);
  });
});
