import {
  audioEngine,
  type SoundPosition,
} from './audio/audioEngine.ts';
import type { EventSoundPatch } from '../shared/eventPresentation.ts';

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

  /**
   * Cue curto e distinto por tipo de evento. É procedural de propósito: dá
   * identidade sonora imediata sem exigir um arquivo novo por evento.
   */
  playEventCue(patch: EventSoundPatch, position?: SoundPosition): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const t = ctx.currentTime;
    const out = this.output(ctx, {
      bus: 'sfx',
      position,
      hrtf: false,
      maxDistance: 140,
      volume: 0.8,
    });

    const noise = (duration: number, filterType: BiquadFilterType, frequency: number): void => {
      const frames = Math.max(1, Math.floor(ctx.sampleRate * duration));
      const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
      const channel = buffer.getChannelData(0);
      for (let i = 0; i < frames; i++) channel[i] = Math.random() * 2 - 1;
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      const filter = ctx.createBiquadFilter();
      filter.type = filterType;
      filter.frequency.setValueAtTime(frequency, t);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.18, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
      source.connect(filter).connect(gain).connect(out.node);
      source.onended = () => out.dispose();
      source.start(t);
      source.stop(t + duration);
    };

    if (patch === 'hiss') {
      noise(0.32, 'highpass', 1500);
      return;
    }
    if (patch === 'wind') {
      noise(0.7, 'bandpass', 620);
      return;
    }

    const tones =
      patch === 'chime'
        ? [{ f: 880, type: 'triangle' as OscillatorType, d: 0.26, gap: 0.08 }]
        : patch === 'alert'
          ? [
              { f: 520, type: 'square' as OscillatorType, d: 0.11, gap: 0.13 },
              { f: 760, type: 'square' as OscillatorType, d: 0.11, gap: 0.13 },
            ]
          : patch === 'growl'
            ? [{ f: 130, type: 'sawtooth' as OscillatorType, d: 0.42, gap: 0 }]
            : [
                { f: 46, type: 'sawtooth' as OscillatorType, d: 0.5, gap: 0 },
                { f: 68, type: 'sine' as OscillatorType, d: 0.5, gap: 0.02 },
              ];

    let remaining = tones.length;
    const done = (): void => {
      remaining -= 1;
      if (remaining <= 0) out.dispose();
    };
    for (const tone of tones) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = tone.type;
      osc.frequency.setValueAtTime(tone.f, t + tone.gap);
      if (patch === 'growl') {
        osc.frequency.exponentialRampToValueAtTime(tone.f * 0.62, t + tone.gap + tone.d);
      }
      gain.gain.setValueAtTime(patch === 'rumble' ? 0.16 : 0.1, t + tone.gap);
      gain.gain.exponentialRampToValueAtTime(0.001, t + tone.gap + tone.d);
      osc.connect(gain).connect(out.node);
      osc.onended = done;
      osc.start(t + tone.gap);
      osc.stop(t + tone.gap + tone.d + 0.02);
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
