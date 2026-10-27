/**
 * SoundEffects - Lightweight Web Audio synthesizer for instant responsive audio feedback.
 * Zero external audio files required, runs with ultra-low latency on mobile and desktop WebViews.
 */
import { MusicPlayer } from './MusicPlayer.js';
import { FeedbackThrottle } from '../feel/FeedbackThrottle.js';

type FilterKind = 'lowpass' | 'highpass' | 'bandpass';

interface ToneSpec {
  type: OscillatorType;
  from: number;
  to?: number;
  at?: number;
  duration: number;
  gain: number;
}

interface NoiseSpec {
  filter: FilterKind;
  freq: number;
  sweepTo?: number;
  q?: number;
  at?: number;
  duration: number;
  gain: number;
  attack?: number;
}

export class SoundEffects {
  private ctx: AudioContext | null = null;
  private enabled: boolean = true;
  private noiseBuffer: AudioBuffer | null = null;
  private readonly throttle = new FeedbackThrottle();
  private readonly now: () => number;
  private readonly music = new MusicPlayer({
    getContext: () => this.getContext(),
    output: (ctx) => this.output(ctx),
    isEnabled: () => this.enabled,
  });

  constructor(options: { now?: () => number } = {}) {
    this.now = options.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
    if (typeof window !== 'undefined') {
      const savedMute = window.localStorage?.getItem('crown_clash_muted');
      if (savedMute === 'true') {
        this.enabled = false;
      }
    }
  }

  private master: AudioNode | null = null;

  /**
   * Master bus: every voice goes through one gain and a gentle compressor,
   * so stacked combat sounds never clip on phone speakers.
   */
  private output(ctx: AudioContext): AudioNode {
    if (this.master) return this.master;
    try {
      const gain = ctx.createGain();
      gain.gain.value = 0.85;
      const compressor = ctx.createDynamicsCompressor();
      compressor.threshold.value = -14;
      compressor.knee.value = 12;
      compressor.ratio.value = 4;
      compressor.attack.value = 0.004;
      compressor.release.value = 0.18;
      gain.connect(compressor);
      compressor.connect(ctx.destination);
      this.master = gain;
    } catch {
      this.master = ctx.destination;
    }
    return this.master;
  }

  /** One oscillator voice with an exponential fade. */
  private tone(ctx: AudioContext, spec: ToneSpec): void {
    const start = ctx.currentTime + (spec.at ?? 0);
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = spec.type;
    osc.frequency.setValueAtTime(spec.from, start);
    if (spec.to !== undefined) osc.frequency.exponentialRampToValueAtTime(spec.to, start + spec.duration);
    gain.gain.setValueAtTime(spec.gain, start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + spec.duration);
    osc.connect(gain);
    gain.connect(this.output(ctx));
    osc.start(start);
    osc.stop(start + spec.duration + 0.02);
  }

  /** Half a second of white noise, built once and reused by every impact. */
  private getNoiseBuffer(ctx: AudioContext): AudioBuffer | null {
    if (this.noiseBuffer) return this.noiseBuffer;
    if (typeof ctx.createBuffer !== 'function') return null;
    const length = Math.floor(ctx.sampleRate * 0.5);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    this.noiseBuffer = buffer;
    return buffer;
  }

  /**
   * Filtered noise burst: whooshes, thumps and clanks. Pure tones read as
   * beeps; noise is what makes an impact feel physical. Returns false when
   * the WebView lacks buffers or filters, so callers can fall back to a tone.
   */
  private noise(ctx: AudioContext, spec: NoiseSpec): boolean {
    if (typeof ctx.createBiquadFilter !== 'function' || typeof ctx.createBufferSource !== 'function') return false;
    const buffer = this.getNoiseBuffer(ctx);
    if (!buffer) return false;
    const start = ctx.currentTime + (spec.at ?? 0);
    const attack = spec.attack ?? 0.005;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = spec.filter;
    filter.frequency.setValueAtTime(spec.freq, start);
    if (spec.sweepTo !== undefined) filter.frequency.exponentialRampToValueAtTime(spec.sweepTo, start + spec.duration);
    filter.Q.value = spec.q ?? 0.8;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.001, start);
    gain.gain.exponentialRampToValueAtTime(spec.gain, start + attack);
    gain.gain.exponentialRampToValueAtTime(0.001, start + spec.duration);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.output(ctx));
    source.start(start);
    source.stop(start + spec.duration + 0.02);
    return true;
  }

  /** Context for a sound that may repeat rapidly; null when muted or throttled. */
  private voice(key: string, minGapMs: number): AudioContext | null {
    const ctx = this.getContext();
    if (!ctx || !this.enabled) return null;
    if (!this.throttle.allowGap(key, minGapMs, this.now())) return null;
    return ctx;
  }

  /** Picking up a tower: a soft wooden tick with a little lift. */
  public playSelect(): void {
    const ctx = this.voice('select', 40);
    if (!ctx) return;
    try {
      this.noise(ctx, { filter: 'bandpass', freq: 1800, q: 4, duration: 0.04, gain: 0.12, attack: 0.002 });
      this.tone(ctx, { type: 'triangle', from: 300, to: 420, duration: 0.07, gain: 0.07 });
    } catch {}
  }

  /** Countdown beat (3, 2, 1): a woodblock knock, slightly higher each step. */
  public playCountTick(step: number): void {
    const ctx = this.voice('count', 200);
    if (!ctx) return;
    try {
      const pitch = step === 1 ? 660 : step === 2 ? 587.33 : 523.25;
      this.noise(ctx, { filter: 'bandpass', freq: 1400, q: 6, duration: 0.05, gain: 0.14, attack: 0.002 });
      this.tone(ctx, { type: 'triangle', from: pitch, duration: 0.16, gain: 0.12 });
    } catch {}
  }

  /** Battle start: a short horn call over a rising swell. */
  public playGo(): void {
    const ctx = this.voice('go', 500);
    if (!ctx) return;
    try {
      this.noise(ctx, { filter: 'bandpass', freq: 400, sweepTo: 1600, q: 0.9, duration: 0.35, gain: 0.16, attack: 0.08 });
      for (const [freq, at] of [[392, 0], [523.25, 0.08], [783.99, 0.16]] as const) {
        this.tone(ctx, { type: 'sawtooth', from: freq, duration: 0.32, gain: 0.05, at });
        this.tone(ctx, { type: 'triangle', from: freq, duration: 0.36, gain: 0.08, at });
      }
    } catch {}
  }

  /** The battle just ended: a gong-like hit, neutral (no win/loss colour). */
  public playMatchEnd(): void {
    const ctx = this.voice('end', 800);
    if (!ctx) return;
    try {
      this.noise(ctx, { filter: 'lowpass', freq: 1200, sweepTo: 150, duration: 0.6, gain: 0.22 });
      this.tone(ctx, { type: 'sine', from: 196, to: 180, duration: 0.9, gain: 0.14 });
      this.tone(ctx, { type: 'triangle', from: 293.66, to: 285, duration: 0.7, gain: 0.06 });
    } catch {}
  }

  /** Short soft UI tick for buttons and navigation. */
  public playClick(): void {
    const ctx = this.getContext();
    if (!ctx || !this.enabled) return;
    try {
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, now);
      osc.frequency.exponentialRampToValueAtTime(620, now + 0.05);
      gain.gain.setValueAtTime(0.08, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.07);
      osc.connect(gain);
      gain.connect(this.output(ctx));
      osc.start(now);
      osc.stop(now + 0.08);
    } catch {}
  }

  private getContext(): AudioContext | null {
    if (!this.ctx && typeof window !== 'undefined') {
      const AudioContextClass =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioContextClass) {
        this.ctx = new AudioContextClass();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  public isMuted(): boolean {
    return !this.enabled;
  }

  public toggleMute(): boolean {
    this.enabled = !this.enabled;
    if (typeof window !== 'undefined') {
      try {
        window.localStorage?.setItem('crown_clash_muted', String(!this.enabled));
      } catch {}
    }
    if (this.enabled) {
      this.music.resume();
    } else {
      this.music.pause();
    }
    return !this.enabled;
  }

  /** Calm looping theme for the menu and hub scenes; a no-op if already playing. */
  public startHubMusic(): void {
    this.music.play('hub');
  }

  /** Driving loop for battles; crossfades from the hub theme. */
  public startBattleMusic(): void {
    this.music.play('battle');
  }

  /** Stops whichever track is playing (kept under its old name for existing callers). */
  public stopBattleMusic(): void {
    this.music.stop();
  }

  /**
   * Urgent visceral heartbeat for the final 15-second countdown.
   */
  public playHeartbeat(urgency: 'medium' | 'high' = 'medium'): void {
    const ctx = this.getContext();
    if (!ctx || !this.enabled) return;

    try {
      const now = ctx.currentTime;

      // Lub (First thump)
      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(74, now);
      osc1.frequency.exponentialRampToValueAtTime(42, now + 0.1);
      gain1.gain.setValueAtTime(urgency === 'high' ? 0.18 : 0.12, now);
      gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.11);
      osc1.connect(gain1);
      gain1.connect(this.output(ctx));
      osc1.start(now);
      osc1.stop(now + 0.12);

      // Dub (Second thump, slightly delayed)
      const dubTime = now + 0.13;
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(62, dubTime);
      osc2.frequency.exponentialRampToValueAtTime(36, dubTime + 0.12);
      gain2.gain.setValueAtTime(urgency === 'high' ? 0.15 : 0.09, dubTime);
      gain2.gain.exponentialRampToValueAtTime(0.001, dubTime + 0.13);
      osc2.connect(gain2);
      gain2.connect(this.output(ctx));
      osc2.start(dubTime);
      osc2.stop(dubTime + 0.14);

      // High-urgency crisp mechanical tick (< 6 seconds)
      if (urgency === 'high') {
        const tickOsc = ctx.createOscillator();
        const tickGain = ctx.createGain();
        tickOsc.type = 'triangle';
        tickOsc.frequency.setValueAtTime(1400, now + 0.35);
        tickGain.gain.setValueAtTime(0.06, now + 0.35);
        tickGain.gain.exponentialRampToValueAtTime(0.001, now + 0.39);
        tickOsc.connect(tickGain);
        tickGain.connect(this.output(ctx));
        tickOsc.start(now + 0.35);
        tickOsc.stop(now + 0.4);
      }
    } catch {}
  }

  /**
   * Troops leaving: a rising whoosh plus a short horn blip. Orders from
   * several towers at once sound bigger.
   */
  public playDispatch(towers = 1): void {
    const ctx = this.voice('dispatch', 50);
    if (!ctx) return;
    const big = towers > 1;
    try {
      const whoosh = this.noise(ctx, {
        filter: 'bandpass', freq: 600, sweepTo: 1800, q: 1.2,
        duration: big ? 0.22 : 0.16, gain: big ? 0.22 : 0.16, attack: 0.03,
      });
      if (!whoosh) {
        this.tone(ctx, { type: 'sine', from: 320, to: 580, duration: 0.1, gain: 0.12 });
      }
      this.tone(ctx, { type: 'square', from: big ? 392 : 440, duration: 0.07, gain: 0.035, at: 0.02 });
      if (big) this.tone(ctx, { type: 'square', from: 587.33, duration: 0.09, gain: 0.03, at: 0.08 });
    } catch {}
  }

  public playReinforce(): void {
    const ctx = this.getContext();
    if (!ctx || !this.enabled) return;

    try {
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';

      osc.frequency.setValueAtTime(523.25, now); // C5
      osc.frequency.setValueAtTime(659.25, now + 0.05); // E5

      gain.gain.setValueAtTime(0.14, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);

      osc.connect(gain);
      gain.connect(this.output(ctx));

      osc.start(now);
      osc.stop(now + 0.15);
    } catch {}
  }

  public playCapture(): void {
    const ctx = this.voice('capture', 80);
    if (!ctx) return;

    try {
      // Body under the chord so the take lands, not just chimes.
      this.noise(ctx, { filter: 'lowpass', freq: 900, sweepTo: 200, duration: 0.18, gain: 0.2 });
      const now = ctx.currentTime;
      const notes = [440, 554.37, 659.25, 880]; // A major triumphant chord

      notes.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';

        const startTime = now + idx * 0.04;
        osc.frequency.setValueAtTime(freq, startTime);

        gain.gain.setValueAtTime(0.12, startTime);
        gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.22);

        osc.connect(gain);
        gain.connect(this.output(ctx));

        osc.start(startTime);
        osc.stop(startTime + 0.25);
      });
    } catch {}
  }

  /**
   * Majestic Royal Fanfare when Center Crown Keep is conquered!
   */
  public playCrownCapture(): void {
    const ctx = this.getContext();
    if (!ctx || !this.enabled) return;

    try {
      const now = ctx.currentTime;
      const notes = [
        { f: 392.0, t: 0.0, d: 0.1 }, // G4
        { f: 523.25, t: 0.08, d: 0.1 }, // C5
        { f: 659.25, t: 0.16, d: 0.12 }, // E5
        { f: 783.99, t: 0.26, d: 0.25 }, // G5
        { f: 1046.5, t: 0.38, d: 0.4 }, // C6 (Crown Apex!)
      ];

      notes.forEach((n) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';

        const st = now + n.t;
        osc.frequency.setValueAtTime(n.f, st);
        gain.gain.setValueAtTime(0.18, st);
        gain.gain.exponentialRampToValueAtTime(0.001, st + n.d);

        osc.connect(gain);
        gain.connect(this.output(ctx));

        osc.start(st);
        osc.stop(st + n.d + 0.02);
      });
    } catch {}
  }

  /**
   * Armies clashing at a tower: a low thump, a body drop and a short metal
   * clank. Throttled so several simultaneous arrivals stay one clean hit.
   */
  public playCombatHit(): void {
    const ctx = this.voice('hit', 60);
    if (!ctx) return;

    try {
      const thump = this.noise(ctx, { filter: 'lowpass', freq: 700, sweepTo: 120, duration: 0.12, gain: 0.26 });
      this.tone(ctx, { type: 'sine', from: 120, to: 55, duration: 0.11, gain: 0.16 });
      if (thump) {
        this.noise(ctx, { filter: 'bandpass', freq: 2500, q: 8, duration: 0.05, gain: 0.08, at: 0.01, attack: 0.002 });
      } else {
        this.tone(ctx, { type: 'sawtooth', from: 180, to: 70, duration: 0.08, gain: 0.1 });
      }
    } catch {}
  }

  /** A fortress shrugging off an attack: a bright ring over a dull knock. */
  public playDeflect(): void {
    const ctx = this.voice('hit', 60);
    if (!ctx) return;
    try {
      this.noise(ctx, { filter: 'lowpass', freq: 500, duration: 0.08, gain: 0.16 });
      this.tone(ctx, { type: 'triangle', from: 1320, to: 1180, duration: 0.18, gain: 0.07, at: 0.01 });
    } catch {}
  }

  /** One of the player's towers fell: a falling, dull drop, distinct from a hit. */
  public playTowerLost(): void {
    const ctx = this.voice('lost', 120);
    if (!ctx) return;
    try {
      this.noise(ctx, { filter: 'lowpass', freq: 600, sweepTo: 90, duration: 0.3, gain: 0.24 });
      this.tone(ctx, { type: 'triangle', from: 330, to: 165, duration: 0.32, gain: 0.12 });
    } catch {}
  }

  public playVictory(): void {
    this.stopBattleMusic();
    const ctx = this.getContext();
    if (!ctx || !this.enabled) return;

    try {
      const now = ctx.currentTime;
      const fanfare = [
        { f: 523.25, t: 0.0, d: 0.12 }, // C5
        { f: 659.25, t: 0.12, d: 0.12 }, // E5
        { f: 783.99, t: 0.24, d: 0.14 }, // G5
        { f: 1046.5, t: 0.38, d: 0.35 }, // C6
      ];

      fanfare.forEach((n) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';

        const st = now + n.t;
        osc.frequency.setValueAtTime(n.f, st);
        gain.gain.setValueAtTime(0.2, st);
        gain.gain.exponentialRampToValueAtTime(0.001, st + n.d);

        osc.connect(gain);
        gain.connect(this.output(ctx));

        osc.start(st);
        osc.stop(st + n.d + 0.02);
      });
    } catch {}
  }

  public playDefeat(): void {
    this.stopBattleMusic();
    const ctx = this.getContext();
    if (!ctx || !this.enabled) return;

    try {
      const now = ctx.currentTime;
      const sadness = [
        { f: 440.0, t: 0.0, d: 0.18 }, // A4
        { f: 392.0, t: 0.18, d: 0.18 }, // G4
        { f: 349.23, t: 0.36, d: 0.22 }, // F4
        { f: 329.63, t: 0.58, d: 0.4 }, // E4
      ];

      sadness.forEach((n) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';

        const st = now + n.t;
        osc.frequency.setValueAtTime(n.f, st);
        gain.gain.setValueAtTime(0.18, st);
        gain.gain.exponentialRampToValueAtTime(0.001, st + n.d);

        osc.connect(gain);
        gain.connect(this.output(ctx));

        osc.start(st);
        osc.stop(st + n.d + 0.02);
      });
    } catch {}
  }

  public playCoin(): void {
    const ctx = this.getContext();
    if (!ctx || !this.enabled) return;

    try {
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';

      osc.frequency.setValueAtTime(987.77, now); // B5
      osc.frequency.exponentialRampToValueAtTime(1318.51, now + 0.08); // E6

      gain.gain.setValueAtTime(0.14, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);

      osc.connect(gain);
      gain.connect(this.output(ctx));

      osc.start(now);
      osc.stop(now + 0.13);
    } catch {}
  }

  public playTrophy(): void {
    const ctx = this.getContext();
    if (!ctx || !this.enabled) return;

    try {
      const now = ctx.currentTime;
      const chords = [
        { f: 587.33, t: 0.0, d: 0.1 }, // D5
        { f: 880.0, t: 0.08, d: 0.22 }, // A5
      ];

      chords.forEach((n) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';

        const st = now + n.t;
        osc.frequency.setValueAtTime(n.f, st);
        gain.gain.setValueAtTime(0.16, st);
        gain.gain.exponentialRampToValueAtTime(0.001, st + n.d);

        osc.connect(gain);
        gain.connect(this.output(ctx));

        osc.start(st);
        osc.stop(st + n.d + 0.02);
      });
    } catch {}
  }

  public playRankUp(): void {
    const ctx = this.getContext();
    if (!ctx || !this.enabled) return;

    try {
      const now = ctx.currentTime;
      const notes = [
        { f: 523.25, t: 0.0, d: 0.12 }, // C5
        { f: 659.25, t: 0.1, d: 0.12 }, // E5
        { f: 783.99, t: 0.2, d: 0.14 }, // G5
        { f: 987.77, t: 0.32, d: 0.16 }, // B5
        { f: 1046.5, t: 0.46, d: 0.45 }, // C6
      ];

      notes.forEach((n) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';

        const st = now + n.t;
        osc.frequency.setValueAtTime(n.f, st);
        gain.gain.setValueAtTime(0.22, st);
        gain.gain.exponentialRampToValueAtTime(0.001, st + n.d);

        osc.connect(gain);
        gain.connect(this.output(ctx));

        osc.start(st);
        osc.stop(st + n.d + 0.02);
      });
    } catch {}
  }
}

export const sounds = new SoundEffects();
