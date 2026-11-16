import {
  audioEngine,
  type SoundPosition,
} from './audio/audioEngine.ts';

interface ProceduralOutput {
  node: AudioNode;
  dispose: () => void;
}

class SoundSynth {
  public get muted(): boolean {
    return audioEngine.isMuted();
  }

  public set muted(value: boolean) {
    audioEngine.setMuted(value);
  }

  private ensureContext(): AudioContext | null {
    if (audioEngine.isMuted()) return null;
    return audioEngine.ensureContext();
  }

  private output(
    ctx: AudioContext,
    opts: {
      position?: SoundPosition;
      hrtf?: boolean;
      refDistance?: number;
      maxDistance?: number;
      volume?: number;
      bus?: 'sfx' | 'ambience' | 'ui';
    } = {},
  ): ProceduralOutput {
    const chain = audioEngine.createProceduralOutput({
      ...opts,
      bus: opts.bus ?? 'sfx',
    });
    if (chain) {
      return { node: chain.input, dispose: () => chain.dispose() };
    }
    return {
      node: audioEngine.getBus('sfx') ?? ctx.destination,
      dispose: () => {},
    };
  }

  private playDigInternal(position?: SoundPosition): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const t = ctx.currentTime;
    const out = this.output(ctx, {
      position,
      hrtf: false,
      refDistance: 2,
      maxDistance: 45,
    });
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    const jitter = 0.92 + Math.random() * 0.16;
    osc.frequency.setValueAtTime(160 * jitter, t);
    osc.frequency.exponentialRampToValueAtTime(55, t + 0.09);
    gain.gain.setValueAtTime(0.16, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    osc.connect(gain).connect(out.node);
    osc.onended = () => out.dispose();
    osc.start(t);
    osc.stop(t + 0.11);
  }

  playDig(): void {
    this.playDigInternal();
  }

  playDigAt(position: SoundPosition): void {
    this.playDigInternal(position);
  }

  playGrapple(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const t = ctx.currentTime;
    const out = this.output(ctx);
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(240, t);
    osc.frequency.exponentialRampToValueAtTime(760, t + 0.14);
    gain.gain.setValueAtTime(0.1, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
    osc.connect(gain).connect(out.node);
    osc.onended = () => out.dispose();
    osc.start(t);
    osc.stop(t + 0.17);
  }

  private playShootInternal(
    massKg: number,
    assetId: string | undefined,
    assetUrl: string | null | undefined,
    position?: SoundPosition,
  ): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    if (assetUrl) {
      audioEngine.playSample(assetUrl, {
        bus: 'sfx',
        volume: 0.8,
        position,
        hrtf: true,
        refDistance: 6,
        maxDistance: 140,
      });
      return;
    }

    const t = ctx.currentTime;
    const profile = assetId?.split(':').pop() ?? '';
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    let type: OscillatorType = massKg > 12 ? 'sawtooth' : 'square';
    let pitch = 1;
    let loudness = 0.14;
    if (profile === 'ice') {
      type = 'sine';
      pitch = 1.18;
    } else if (profile === 'fire') {
      type = 'sawtooth';
      pitch = 0.9;
      loudness = 0.16;
    } else if (profile === 'toxic') {
      type = 'square';
      pitch = 0.82;
    } else if (profile === 'void') {
      type = 'sine';
      pitch = 0.68;
      loudness = 0.17;
    } else if (profile === 'electric') {
      type = 'square';
      pitch = 1.35;
      loudness = 0.12;
    }
    osc.type = type;
    const baseFreq =
      Math.max(120, 480 - massKg * 14) * pitch * (0.94 + Math.random() * 0.12);
    osc.frequency.setValueAtTime(baseFreq, t);
    osc.frequency.exponentialRampToValueAtTime(65 * pitch, t + 0.13);
    gain.gain.setValueAtTime(loudness, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
    const out = this.output(ctx, {
      position,
      hrtf: Boolean(position),
      refDistance: 6,
      maxDistance: 140,
    });
    osc.connect(gain).connect(out.node);
    osc.onended = () => out.dispose();
    osc.start(t);
    osc.stop(t + 0.15);
  }

  playShoot(massKg: number, assetId?: string, assetUrl?: string | null): void {
    this.playShootInternal(massKg, assetId, assetUrl);
  }

  playShootAt(
    massKg: number,
    assetId: string | undefined,
    position: SoundPosition,
    assetUrl?: string | null,
  ): void {
    this.playShootInternal(massKg, assetId, assetUrl, position);
  }

  private playExplosionInternal(position?: SoundPosition): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const t = ctx.currentTime;
    const out = this.output(ctx, {
      position,
      hrtf: Boolean(position),
      refDistance: 8,
      maxDistance: 180,
    });
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(110, t);
    osc.frequency.exponentialRampToValueAtTime(28, t + 0.34);
    gain.gain.setValueAtTime(0.24, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.36);
    osc.connect(gain).connect(out.node);
    osc.onended = () => out.dispose();
    osc.start(t);
    osc.stop(t + 0.37);
  }

  playExplosion(): void {
    this.playExplosionInternal();
  }

  playExplosionAt(position: SoundPosition): void {
    this.playExplosionInternal(position);
  }

  playAlert(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const t = ctx.currentTime;
    const out = this.output(ctx, { bus: 'ui' });
    for (let i = 0; i < 2; i++) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(i === 0 ? 520 : 680, t + i * 0.13);
      gain.gain.setValueAtTime(0.12, t + i * 0.13);
      gain.gain.exponentialRampToValueAtTime(0.001, t + i * 0.13 + 0.11);
      osc.connect(gain).connect(out.node);
      osc.onended = () => out.dispose();
      osc.start(t + i * 0.13);
      osc.stop(t + i * 0.13 + 0.12);
    }
  }

  playForgeComplete(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const t = ctx.currentTime;
    const out = this.output(ctx, { bus: 'ui' });
    [440, 554, 659].forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, t + idx * 0.06);
      gain.gain.setValueAtTime(0.1, t + idx * 0.06);
      gain.gain.exponentialRampToValueAtTime(0.001, t + idx * 0.06 + 0.15);
      osc.connect(gain).connect(out.node);
      osc.onended = () => out.dispose();
      osc.start(t + idx * 0.06);
      osc.stop(t + idx * 0.06 + 0.16);
    });
  }

  playHitConfirm(heavy = false): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const t = ctx.currentTime;
    const out = this.output(ctx);
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = heavy ? 'triangle' : 'sine';
    osc.frequency.setValueAtTime(heavy ? 920 : 780, t);
    osc.frequency.exponentialRampToValueAtTime(heavy ? 320 : 520, t + 0.07);
    gain.gain.setValueAtTime(heavy ? 0.18 : 0.11, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    osc.connect(gain).connect(out.node);
    osc.onended = () => out.dispose();
    osc.start(t);
    osc.stop(t + 0.09);
  }

  playDamageTaken(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const t = ctx.currentTime;
    const out = this.output(ctx);
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(140, t);
    osc.frequency.exponentialRampToValueAtTime(42, t + 0.16);
    gain.gain.setValueAtTime(0.16, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.17);
    osc.connect(gain).connect(out.node);
    osc.onended = () => out.dispose();
    osc.start(t);
    osc.stop(t + 0.18);
  }

  playPickup(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const t = ctx.currentTime;
    const out = this.output(ctx, { bus: 'ui' });
    [523, 698].forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, t + idx * 0.055);
      gain.gain.setValueAtTime(0.11, t + idx * 0.055);
      gain.gain.exponentialRampToValueAtTime(0.001, t + idx * 0.055 + 0.1);
      osc.connect(gain).connect(out.node);
      osc.onended = () => out.dispose();
      osc.start(t + idx * 0.055);
      osc.stop(t + idx * 0.055 + 0.11);
    });
  }

  playOverheat(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const t = ctx.currentTime;
    const out = this.output(ctx);
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(420, t);
    osc.frequency.exponentialRampToValueAtTime(140, t + 0.24);
    gain.gain.setValueAtTime(0.09, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    osc.connect(gain).connect(out.node);
    osc.onended = () => out.dispose();
    osc.start(t);
    osc.stop(t + 0.26);
  }
}

export const soundSynth = new SoundSynth();
