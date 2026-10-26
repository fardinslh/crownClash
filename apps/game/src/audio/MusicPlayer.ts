/**
 * MusicPlayer - procedural background music on top of the shared Web Audio graph.
 * No audio files: tracks are data (chords + step patterns) scheduled a short
 * lookahead ahead of the audio clock, so the loop stays tight on weak WebViews
 * and costs only a handful of short-lived oscillators per step.
 */

export type MusicTrackId = 'hub' | 'battle';

interface MusicTrack {
  bpm: number;
  /** One chord per bar, eight eighth-note steps per bar. */
  chords: ReadonlyArray<{ bass: number; tones: readonly number[] }>;
  /** Index into chord.tones per step, -1 = rest. */
  arp: readonly number[];
  arpGain: number;
  arpLength: number;
  padGain: number;
  /** Bass note on these steps (0-7). */
  bassSteps: readonly number[];
  bassGain: number;
  kickSteps: readonly number[];
  tomSteps: readonly number[];
  /** Whole-track level under the master bus. */
  level: number;
}

// i - VI - III - VII in D minor / F / C: heroic without being busy.
const CHORDS = [
  { bass: 50, tones: [62, 65, 69, 74] }, // Dm
  { bass: 46, tones: [58, 62, 65, 70] }, // Bb
  { bass: 53, tones: [60, 65, 69, 72] }, // F
  { bass: 48, tones: [60, 64, 67, 72] }, // C
] as const;

export const MUSIC_TRACKS: Record<MusicTrackId, MusicTrack> = {
  hub: {
    bpm: 84,
    chords: CHORDS,
    arp: [0, -1, 2, -1, 1, -1, 3, 2],
    arpGain: 0.05,
    arpLength: 0.5,
    padGain: 0.05,
    bassSteps: [0, 4],
    bassGain: 0.09,
    kickSteps: [],
    tomSteps: [],
    level: 0.9,
  },
  battle: {
    bpm: 104,
    chords: CHORDS,
    arp: [0, 2, 1, 2, 3, 2, 1, 2],
    arpGain: 0.04,
    arpLength: 0.22,
    padGain: 0.035,
    bassSteps: [0, 1, 2, 3, 4, 5, 6, 7],
    bassGain: 0.075,
    kickSteps: [0, 4],
    tomSteps: [3, 6],
    level: 0.85,
  },
};

const LOOKAHEAD_SECONDS = 0.4;
const TICK_MS = 100;
const FADE_SECONDS = 0.5;

const midiToHz = (note: number): number => 440 * Math.pow(2, (note - 69) / 12);

export interface MusicHost {
  getContext(): AudioContext | null;
  output(ctx: AudioContext): AudioNode;
  isEnabled(): boolean;
}

export class MusicPlayer {
  private timer: ReturnType<typeof setInterval> | null = null;
  private trackId: MusicTrackId | null = null;
  /** Track the scene asked for; survives mute so unmuting can bring it back. */
  private wanted: MusicTrackId | null = null;
  private bus: GainNode | null = null;
  private nextTime = 0;
  private step = 0;
  private bar = 0;

  constructor(private readonly host: MusicHost) {}

  public get current(): MusicTrackId | null {
    return this.trackId;
  }

  /** Starts a track; no-op when it is already playing, crossfades when switching. */
  public play(id: MusicTrackId): void {
    this.wanted = id;
    if (!this.host.isEnabled() || this.trackId === id) return;
    this.releaseBus();
    this.trackId = id;
    this.step = 0;
    this.bar = 0;
    this.nextTime = 0;
    this.bus = null;
    if (this.timer === null) {
      this.timer = setInterval(() => this.tick(), TICK_MS);
    }
    this.tick();
  }

  /** Stops playback and forgets the track (scene no longer wants music). */
  public stop(): void {
    this.wanted = null;
    this.halt();
  }

  /** Silences playback but keeps the requested track, e.g. while muted. */
  public pause(): void {
    this.halt();
  }

  /** Restarts the requested track after a pause (unmute). */
  public resume(): void {
    if (this.wanted && this.trackId === null) this.play(this.wanted);
  }

  private halt(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.releaseBus();
    this.trackId = null;
  }

  /** Fades the current bus out; its already-scheduled notes die with it. */
  private releaseBus(): void {
    const bus = this.bus;
    this.bus = null;
    if (!bus) return;
    try {
      const ctx = this.host.getContext();
      const now = ctx?.currentTime ?? 0;
      bus.gain.cancelScheduledValues(now);
      bus.gain.setValueAtTime(bus.gain.value, now);
      bus.gain.linearRampToValueAtTime(0, now + FADE_SECONDS);
      setTimeout(() => {
        try {
          bus.disconnect();
        } catch {}
      }, FADE_SECONDS * 1000 + 100);
    } catch {}
  }

  private tick(): void {
    if (!this.trackId) return;
    const ctx = this.host.getContext();
    if (!ctx || ctx.state !== 'running' || !this.host.isEnabled()) return;
    const track = MUSIC_TRACKS[this.trackId];
    const stepSeconds = 60 / track.bpm / 2;

    if (!this.bus) {
      this.bus = ctx.createGain();
      this.bus.gain.setValueAtTime(0, ctx.currentTime);
      this.bus.gain.linearRampToValueAtTime(track.level, ctx.currentTime + FADE_SECONDS);
      this.bus.connect(this.host.output(ctx));
    }
    // After a stall (hidden tab) restart from "now" instead of bursting old steps.
    if (this.nextTime < ctx.currentTime) this.nextTime = ctx.currentTime + 0.05;

    while (this.nextTime < ctx.currentTime + LOOKAHEAD_SECONDS) {
      this.scheduleStep(ctx, this.bus, track, this.nextTime, stepSeconds);
      this.nextTime += stepSeconds;
      this.step += 1;
      if (this.step === 8) {
        this.step = 0;
        this.bar = (this.bar + 1) % track.chords.length;
      }
    }
  }

  private scheduleStep(
    ctx: AudioContext,
    bus: GainNode,
    track: MusicTrack,
    at: number,
    stepSeconds: number
  ): void {
    const chord = track.chords[this.bar];
    const step = this.step;
    try {
      if (step === 0) {
        for (const note of chord.tones.slice(0, 3)) {
          this.voice(ctx, bus, 'triangle', midiToHz(note), at, stepSeconds * 8, track.padGain / 3, 0.35);
        }
      }
      if (track.bassSteps.includes(step)) {
        const accent = step === 0 ? 1 : 0.7;
        this.voice(ctx, bus, 'sine', midiToHz(chord.bass), at, stepSeconds * 1.6, track.bassGain * accent, 0.01);
      }
      const arpIndex = track.arp[step];
      if (arpIndex >= 0) {
        const note = chord.tones[arpIndex % chord.tones.length] + 12;
        this.voice(ctx, bus, 'triangle', midiToHz(note), at, stepSeconds * track.arpLength * 2, track.arpGain, 0.005);
      }
      if (track.kickSteps.includes(step)) this.drum(ctx, bus, at, 110, 42, 0.22, 0.2);
      if (track.tomSteps.includes(step)) this.drum(ctx, bus, at, 150, 80, 0.14, 0.09);
    } catch {}
  }

  /** One enveloped oscillator; cleans itself up when it ends. */
  private voice(
    ctx: AudioContext,
    bus: GainNode,
    type: OscillatorType,
    freq: number,
    at: number,
    length: number,
    gainValue: number,
    attack: number
  ): void {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, at);
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.linearRampToValueAtTime(gainValue, at + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + length);
    osc.connect(gain);
    gain.connect(bus);
    osc.onended = () => {
      try {
        osc.disconnect();
        gain.disconnect();
      } catch {}
    };
    osc.start(at);
    osc.stop(at + length + 0.02);
  }

  private drum(
    ctx: AudioContext,
    bus: GainNode,
    at: number,
    from: number,
    to: number,
    length: number,
    gainValue: number
  ): void {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(from, at);
    osc.frequency.exponentialRampToValueAtTime(to, at + length);
    gain.gain.setValueAtTime(gainValue, at);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + length);
    osc.connect(gain);
    gain.connect(bus);
    osc.onended = () => {
      try {
        osc.disconnect();
        gain.disconnect();
      } catch {}
    };
    osc.start(at);
    osc.stop(at + length + 0.02);
  }
}
