/**
 * SoundEffects - Lightweight Web Audio synthesizer for instant responsive audio feedback.
 * Zero external audio files required, runs with ultra-low latency on mobile and desktop WebViews.
 */
export class SoundEffects {
  private ctx: AudioContext | null = null;
  private enabled: boolean = true;
  private musicIntervalId: ReturnType<typeof setInterval> | null = null;
  private currentBeat: number = 0;

  constructor() {
    if (typeof window !== 'undefined') {
      const savedMute = window.localStorage?.getItem('crown_clash_muted');
      if (savedMute === 'true') {
        this.enabled = false;
      }
    }
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
    if (!this.enabled) {
      this.stopBattleMusic();
    }
    return !this.enabled;
  }

  /**
   * Starts ambient procedural war-drum cadence (100 BPM).
   * Very low volume, providing tactical tension without masking sound effects.
   */
  public startBattleMusic(): void {
    if (!this.enabled || this.musicIntervalId !== null) return;

    this.currentBeat = 0;
    // 100 BPM = 600ms per beat
    this.musicIntervalId = setInterval(() => {
      this.playDrumStep();
    }, 600);
  }

  public stopBattleMusic(): void {
    if (this.musicIntervalId !== null) {
      clearInterval(this.musicIntervalId);
      this.musicIntervalId = null;
    }
  }

  private playDrumStep(): void {
    const ctx = this.getContext();
    if (!ctx || !this.enabled) return;

    try {
      const now = ctx.currentTime;
      const isStrongBeat = this.currentBeat % 2 === 0;
      const isMainAccent = this.currentBeat % 4 === 0;

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';

      const baseFreq = isMainAccent ? 68 : isStrongBeat ? 60 : 75;
      const targetFreq = 38;
      const volume = isMainAccent ? 0.07 : isStrongBeat ? 0.045 : 0.03;
      const duration = isMainAccent ? 0.22 : 0.15;

      osc.frequency.setValueAtTime(baseFreq, now);
      osc.frequency.exponentialRampToValueAtTime(targetFreq, now + duration);

      gain.gain.setValueAtTime(volume, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + duration + 0.02);

      this.currentBeat = (this.currentBeat + 1) % 8;
    } catch {}
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
      gain1.connect(ctx.destination);
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
      gain2.connect(ctx.destination);
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
        tickGain.connect(ctx.destination);
        tickOsc.start(now + 0.35);
        tickOsc.stop(now + 0.4);
      }
    } catch {}
  }

  public playDispatch(): void {
    const ctx = this.getContext();
    if (!ctx || !this.enabled) return;

    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';

      const now = ctx.currentTime;
      osc.frequency.setValueAtTime(320, now);
      osc.frequency.exponentialRampToValueAtTime(580, now + 0.09);

      gain.gain.setValueAtTime(0.12, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + 0.1);
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
      gain.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + 0.15);
    } catch {}
  }

  public playCapture(): void {
    const ctx = this.getContext();
    if (!ctx || !this.enabled) return;

    try {
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
        gain.connect(ctx.destination);

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
        gain.connect(ctx.destination);

        osc.start(st);
        osc.stop(st + n.d + 0.02);
      });
    } catch {}
  }

  public playCombatHit(): void {
    const ctx = this.getContext();
    if (!ctx || !this.enabled) return;

    try {
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';

      osc.frequency.setValueAtTime(180, now);
      osc.frequency.exponentialRampToValueAtTime(70, now + 0.07);

      gain.gain.setValueAtTime(0.1, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + 0.08);
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
        gain.connect(ctx.destination);

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
        gain.connect(ctx.destination);

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
      gain.connect(ctx.destination);

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
        gain.connect(ctx.destination);

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
        gain.connect(ctx.destination);

        osc.start(st);
        osc.stop(st + n.d + 0.02);
      });
    } catch {}
  }
}

export const sounds = new SoundEffects();
