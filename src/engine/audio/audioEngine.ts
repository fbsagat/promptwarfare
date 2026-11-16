/**
 * Grafo de áudio compartilhado.
 *
 * Fase 0: cria contexto, limiter e buses (sfx/ambiência/UI). Os sons atuais do
 * `soundSynth` passam pelo bus `sfx`; a espacialização (PannerNode/HRTF) e as
 * camadas de ambiência entram na Fase 2 usando `updateListener`.
 */

export type AudioBusName = 'sfx' | 'ambience' | 'ui';

export interface SoundPosition {
  x: number;
  y: number;
  z: number;
}

export interface PlaybackOptions {
  bus?: AudioBusName;
  volume?: number;
  rate?: number;
  loop?: boolean;
  position?: SoundPosition;
  /** HRTF só para fontes críticas; o resto usa equalpower (mais barato). */
  hrtf?: boolean;
  refDistance?: number;
  maxDistance?: number;
  rolloff?: number;
  lowpassHz?: number;
  onEnded?: () => void;
}

export interface AudioHandle {
  stop(fadeSec?: number): void;
  setOcclusion(gain: number, lowpassHz: number): void;
  setVolume(volume: number, rampSec?: number): void;
}

export interface OutputChain {
  input: GainNode;
  setOcclusion(gain: number, lowpassHz: number): void;
  dispose(): void;
}

const BUS_NAMES: readonly AudioBusName[] = ['sfx', 'ambience', 'ui'];

type WindowWithWebkitAudio = Window & {
  webkitAudioContext?: typeof AudioContext;
};

class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private buses = new Map<AudioBusName, GainNode>();
  private volumes: Record<AudioBusName, number> = {
    sfx: 1,
    ambience: 1,
    ui: 1,
  };
  private muted = false;
  private masterVolume = 1;
  private reverbWet = 0;
  private reverbGain: GainNode | null = null;
  private reverb: ConvolverNode | null = null;
  private samples = new Map<string, AudioBuffer>();
  private sampleLoads = new Map<string, Promise<AudioBuffer | null>>();
  private gestureUnlockInstalled = false;

  public ensureContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.ctx) {
      const Ctor =
        window.AudioContext ||
        (window as WindowWithWebkitAudio).webkitAudioContext;
      if (!Ctor) return null;
      const ctx = new Ctor();
      this.ctx = ctx;
      this.buildGraph(ctx);
      this.installGestureUnlock();
    }
    return this.ctx;
  }

  private installGestureUnlock(): void {
    if (this.gestureUnlockInstalled || typeof window === 'undefined') return;
    this.gestureUnlockInstalled = true;
    const unlock = () => {
      if (this.ctx?.state === 'suspended') void this.ctx.resume();
    };
    window.addEventListener('pointerdown', unlock, { passive: true });
    window.addEventListener('keydown', unlock);
  }

  private buildGraph(ctx: AudioContext): void {
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -3;
    limiter.knee.value = 0;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.25;

    const master = ctx.createGain();
    master.gain.value = this.muted ? 0 : this.masterVolume;
    master.connect(limiter);
    limiter.connect(ctx.destination);
    this.master = master;

    for (const name of BUS_NAMES) {
      const bus = ctx.createGain();
      bus.gain.value = this.volumes[name];
      bus.connect(master);
      this.buses.set(name, bus);
    }

    const sfx = this.buses.get('sfx');
    if (sfx) {
      const wet = ctx.createGain();
      wet.gain.value = this.reverbWet;
      const convolver = ctx.createConvolver();
      convolver.buffer = this.createReverbImpulse(ctx);
      sfx.connect(wet);
      wet.connect(convolver);
      convolver.connect(master);
      this.reverbGain = wet;
      this.reverb = convolver;
    }
  }

  private createReverbImpulse(ctx: AudioContext): AudioBuffer {
    const seconds = 1.4;
    const length = Math.max(1, Math.floor(ctx.sampleRate * seconds));
    const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
    for (let channel = 0; channel < 2; channel++) {
      const data = buffer.getChannelData(channel);
      for (let i = 0; i < length; i++) {
        const envelope = Math.pow(1 - i / length, 3.2);
        data[i] = (Math.random() * 2 - 1) * envelope * 0.45;
      }
    }
    return buffer;
  }

  public getContext(): AudioContext | null {
    return this.ctx;
  }

  public getBus(name: AudioBusName): GainNode | null {
    return this.buses.get(name) ?? null;
  }

  public setMuted(muted: boolean): void {
    this.muted = muted;
    this.applyMasterGain();
  }

  public isMuted(): boolean {
    return this.muted;
  }

  public setMasterVolume(volume: number): void {
    const clamped = Math.max(0, Math.min(1, Number.isFinite(volume) ? volume : 1));
    this.masterVolume = clamped;
    this.applyMasterGain();
  }

  public getMasterVolume(): number {
    return this.masterVolume;
  }

  /** Ajusta o send de reverb do bus `sfx` (cavernas/interiores). */
  public setReverb(wet: number): void {
    const clamped = Math.max(0, Math.min(0.5, Number.isFinite(wet) ? wet : 0));
    this.reverbWet = clamped;
    if (this.reverbGain && this.ctx) {
      this.reverbGain.gain.setTargetAtTime(clamped, this.ctx.currentTime, 0.25);
    }
  }

  private applyMasterGain(): void {
    if (this.master) {
      this.master.gain.value = this.muted ? 0 : this.masterVolume;
    }
  }

  public setBusVolume(name: AudioBusName, volume: number): void {
    const clamped = Math.max(0, Math.min(1, Number.isFinite(volume) ? volume : 1));
    this.volumes[name] = clamped;
    const bus = this.buses.get(name);
    if (bus) bus.gain.value = clamped;
  }

  public getBusVolume(name: AudioBusName): number {
    return this.volumes[name];
  }

  public loadSample(url: string): Promise<AudioBuffer | null> {
    const cached = this.samples.get(url);
    if (cached) return Promise.resolve(cached);
    const pending = this.sampleLoads.get(url);
    if (pending) return pending;
    const ctx = this.ensureContext();
    if (!ctx) return Promise.resolve(null);

    const promise = fetch(url)
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.arrayBuffer();
      })
      .then((buffer) => ctx.decodeAudioData(buffer))
      .then((decoded) => {
        this.samples.set(url, decoded);
        this.sampleLoads.delete(url);
        return decoded;
      })
      .catch(() => {
        this.sampleLoads.delete(url);
        return null;
      });
    this.sampleLoads.set(url, promise);
    return promise;
  }

  public preloadSamples(urls: readonly string[]): void {
    for (const url of urls) void this.loadSample(url);
  }

  public getLoadedSampleCount(): number {
    return this.samples.size;
  }

  public playSample(url: string, opts: PlaybackOptions = {}): AudioHandle | null {
    const ctx = this.ensureContext();
    if (!ctx) return null;
    const buffer = this.samples.get(url);
    if (!buffer) {
      void this.loadSample(url);
      return null;
    }
    return this.playBuffer(buffer, opts);
  }

  public playBuffer(
    buffer: AudioBuffer,
    opts: PlaybackOptions = {},
  ): AudioHandle | null {
    const ctx = this.ensureContext();
    if (!ctx) return null;
    const output = this.buildOutput(ctx, opts);
    if (!output) return null;

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = Boolean(opts.loop);
    source.playbackRate.value = Math.max(0.25, Math.min(4, opts.rate ?? 1));
    source.connect(output.input);
    source.onended = () => {
      output.dispose();
      opts.onEnded?.();
    };
    source.start();

    return {
      stop: (fadeSec = 0.08) => {
        const now = ctx.currentTime;
        const gain = output.input.gain;
        gain.cancelScheduledValues(now);
        gain.setValueAtTime(gain.value, now);
        gain.linearRampToValueAtTime(0, now + Math.max(0.01, fadeSec));
        try {
          source.stop(now + Math.max(0.01, fadeSec) + 0.02);
        } catch {
          // já parado
        }
      },
      setOcclusion: output.setOcclusion,
      setVolume: (volume: number, rampSec = 0.2) => {
        const now = ctx.currentTime;
        const gain = output.input.gain;
        const target = Math.max(0, Math.min(4, volume));
        gain.cancelScheduledValues(now);
        gain.setValueAtTime(gain.value, now);
        if (rampSec <= 0.01) {
          gain.value = target;
        } else {
          gain.linearRampToValueAtTime(target, now + rampSec);
        }
      },
    };
  }

  /** Saída para osciladores procedurais, com panning opcional. */
  public createProceduralOutput(opts: PlaybackOptions = {}): OutputChain | null {
    const ctx = this.ensureContext();
    if (!ctx) return null;
    return this.buildOutput(ctx, opts);
  }

  private buildOutput(
    ctx: AudioContext,
    opts: PlaybackOptions,
  ): OutputChain | null {
    const bus = this.getBus(opts.bus ?? 'sfx') ?? this.master;
    if (!bus) return null;

    const input = ctx.createGain();
    input.gain.value = Math.max(0, Math.min(4, opts.volume ?? 1));

    if (!opts.position) {
      input.connect(bus);
      return {
        input,
        setOcclusion: () => {},
        dispose: () => input.disconnect(),
      };
    }

    const occlusionGain = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = Math.max(600, opts.lowpassHz ?? 20000);
    filter.Q.value = 0.7;

    const panner = ctx.createPanner();
    panner.panningModel = opts.hrtf ? 'HRTF' : 'equalpower';
    panner.distanceModel = 'inverse';
    panner.refDistance = Math.max(0.5, opts.refDistance ?? 3);
    panner.maxDistance = Math.max(1, opts.maxDistance ?? 90);
    panner.rolloffFactor = Math.max(0.1, opts.rolloff ?? 1.4);
    this.setPannerPosition(panner, opts.position);

    input.connect(occlusionGain);
    occlusionGain.connect(filter);
    filter.connect(panner);
    panner.connect(bus);

    return {
      input,
      setOcclusion: (gain: number, lowpassHz: number) => {
        const now = ctx.currentTime;
        occlusionGain.gain.setTargetAtTime(
          Math.max(0.05, Math.min(1, gain)),
          now,
          0.05,
        );
        filter.frequency.setTargetAtTime(
          Math.max(400, Math.min(20000, lowpassHz)),
          now,
          0.08,
        );
      },
      dispose: () => {
        input.disconnect();
        occlusionGain.disconnect();
        filter.disconnect();
        panner.disconnect();
      },
    };
  }

  private setPannerPosition(panner: PannerNode, position: SoundPosition): void {
    if (typeof panner.positionX !== 'undefined') {
      panner.positionX.value = position.x;
      panner.positionY.value = position.y;
      panner.positionZ.value = position.z;
      return;
    }
    const legacy = panner as unknown as {
      setPosition?: (x: number, y: number, z: number) => void;
    };
    legacy.setPosition?.(position.x, position.y, position.z);
  }

  /**
   * Posiciona o ouvinte na câmera. Reservado para a Fase 2 (áudio espacial).
   */
  public updateListener(
    position: { x: number; y: number; z: number },
    forward: { x: number; y: number; z: number },
    up: { x: number; y: number; z: number },
  ): void {
    const listener = this.ctx?.listener;
    if (!listener) return;

    if (typeof listener.positionX !== 'undefined') {
      listener.positionX.value = position.x;
      listener.positionY.value = position.y;
      listener.positionZ.value = position.z;
      listener.forwardX.value = forward.x;
      listener.forwardY.value = forward.y;
      listener.forwardZ.value = forward.z;
      listener.upX.value = up.x;
      listener.upY.value = up.y;
      listener.upZ.value = up.z;
      return;
    }

    const legacy = listener as unknown as {
      setPosition?: (x: number, y: number, z: number) => void;
      setOrientation?: (
        fx: number,
        fy: number,
        fz: number,
        ux: number,
        uy: number,
        uz: number,
      ) => void;
    };
    legacy.setPosition?.(position.x, position.y, position.z);
    legacy.setOrientation?.(
      forward.x,
      forward.y,
      forward.z,
      up.x,
      up.y,
      up.z,
    );
  }

  public dispose(): void {
    for (const bus of this.buses.values()) bus.disconnect();
    this.buses.clear();
    this.reverbGain?.disconnect();
    this.reverbGain = null;
    this.reverb?.disconnect();
    this.reverb = null;
    this.master?.disconnect();
    this.master = null;
    this.samples.clear();
    this.sampleLoads.clear();
    if (this.ctx) {
      void this.ctx.close();
      this.ctx = null;
    }
  }
}

export const audioEngine = new AudioEngine();
