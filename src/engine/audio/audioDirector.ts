import { resolveAssetUrl, type AssetManifest } from '../../shared/assets.ts';
import {
  audioEngine,
  type AudioHandle,
  type SoundPosition,
} from './audioEngine.ts';
import { footstepAssetId, impactAssetId } from './materialAudio.ts';

type Occluder = (from: SoundPosition, to: SoundPosition) => boolean;

export interface AmbienceState {
  underwater: boolean;
  underground: boolean;
  nearWater: boolean;
  nearLava: boolean;
  nearSwamp: boolean;
  storm: boolean;
}

interface LoopEntry {
  handle: AudioHandle;
  volume: number;
}

interface DirectorStats {
  played: number;
  dropped: number;
  occluded: number;
  activeVoices: number;
  loops: string[];
  contextState: string;
  loadedSamples: number;
}

const CORE_SAMPLE_IDS = [
  'sfx:dig:shovel',
  'sfx:land:heavy',
  'sfx:water:splash',
  'sfx:water:drop',
  'sfx:pickup:gem',
  'sfx:ui:confirm',
  'sfx:ambience:wind',
  'sfx:ambience:water:river',
  'sfx:ambience:fire',
  'sfx:ambience:cave:drip',
  'sfx:ambience:swamp',
];

const FOOTSTEP_IDS = ['stone', 'loose', 'soft'].flatMap((group) =>
  [1, 2, 3, 4].map((n) => `sfx:footstep:${group}:${n}`),
);

const IMPACT_IDS = [
  'sfx:impact:stone:short',
  'sfx:impact:stone:medium',
  'sfx:impact:wood:hollow',
  'sfx:impact:wood:drop',
  'sfx:impact:metal:clang',
  'sfx:impact:metal:tap',
  'sfx:impact:ice:small',
  'sfx:impact:ice:big',
  'sfx:impact:terracotta:clang',
  'sfx:impact:soft:hit',
  'sfx:impact:soft:drop',
];

const AMBIENCE_IDS = {
  wind: 'sfx:ambience:wind',
  water: 'sfx:ambience:water:river',
  fire: 'sfx:ambience:fire',
  cave: 'sfx:ambience:cave:drip',
  swamp: 'sfx:ambience:swamp',
} as const;

/**
 * Orquestra sons espaciais e ambiência. Não conhece regra de jogo: recebe
 * posições e MATs já resolvidos, mantém o cache de samples e aplica distância,
 * oclusão e limite de vozes. A síntese local continua no `soundSynth`.
 */
class AudioDirector {
  private manifest: AssetManifest | null = null;
  private occluder: Occluder | null = null;
  private listener: SoundPosition = { x: 0, y: 0, z: 0 };
  private activeVoices = 0;
  private readonly maxVoices = 28;
  private played = 0;
  private dropped = 0;
  private occluded = 0;
  private loops = new Map<string, LoopEntry>();
  private occlusionCache = new Map<
    string,
    { at: number; gain: number; lowpassHz: number }
  >();

  public setManifest(manifest: AssetManifest | null): void {
    this.manifest = manifest;
    if (!manifest) return;
    const urls = [...CORE_SAMPLE_IDS, ...FOOTSTEP_IDS, ...IMPACT_IDS]
      .map((id) => this.resolve(id))
      .filter((url): url is string => Boolean(url));
    audioEngine.preloadSamples(urls);
  }

  public setOccluder(occluder: Occluder | null): void {
    this.occluder = occluder;
    this.occlusionCache.clear();
  }

  public updateListener(position: SoundPosition, forward: SoundPosition): void {
    this.listener = position;
    audioEngine.updateListener(position, forward, { x: 0, y: 1, z: 0 });
  }

  public getStats(): DirectorStats {
    return {
      played: this.played,
      dropped: this.dropped,
      occluded: this.occluded,
      activeVoices: this.activeVoices,
      loops: [...this.loops.keys()],
      contextState: audioEngine.getContext()?.state ?? 'none',
      loadedSamples: audioEngine.getLoadedSampleCount(),
    };
  }

  private resolve(id: string): string | null {
    if (!this.manifest) return null;
    const asset = this.manifest.assets.find((entry) => entry.id === id);
    return resolveAssetUrl(asset, this.manifest);
  }

  private acquireVoice(priority: number): boolean {
    if (this.activeVoices < this.maxVoices) {
      this.activeVoices += 1;
      return true;
    }
    if (priority >= 6) return true;
    this.dropped += 1;
    return false;
  }

  private releaseVoice(): void {
    this.activeVoices = Math.max(0, this.activeVoices - 1);
  }

  private occlusionFor(position: SoundPosition): {
    gain: number;
    lowpassHz: number;
  } {
    if (!this.occluder) return { gain: 1, lowpassHz: 20000 };
    const dx = position.x - this.listener.x;
    const dy = position.y - this.listener.y;
    const dz = position.z - this.listener.z;
    if (dx * dx + dy * dy + dz * dz < 9) {
      return { gain: 1, lowpassHz: 20000 };
    }
    const key = `${Math.round(position.x / 3)},${Math.round(position.y / 3)},${Math.round(position.z / 3)}`;
    const now = Date.now();
    const cached = this.occlusionCache.get(key);
    if (cached && now - cached.at < 220) {
      if (cached.gain < 1) this.occluded += 1;
      return { gain: cached.gain, lowpassHz: cached.lowpassHz };
    }
    const blocked = this.occluder(this.listener, position);
    const result = blocked
      ? { gain: 0.35, lowpassHz: 850 }
      : { gain: 1, lowpassHz: 20000 };
    this.occlusionCache.set(key, { at: now, ...result });
    if (blocked) this.occluded += 1;
    return result;
  }

  /** One-shot espacializado; retorna false se o sample não estiver pronto. */
  public playWorld(
    id: string,
    position: SoundPosition,
    opts: {
      volume?: number;
      rate?: number;
      priority?: number;
      hrtf?: boolean;
      occlusion?: boolean;
      maxDistance?: number;
    } = {},
  ): boolean {
    const url = this.resolve(id);
    if (!url) return false;
    const maxDistance = opts.maxDistance ?? 110;
    const dx = position.x - this.listener.x;
    const dy = position.y - this.listener.y;
    const dz = position.z - this.listener.z;
    if (dx * dx + dy * dy + dz * dz > maxDistance * maxDistance) {
      return false;
    }
    if (!this.acquireVoice(opts.priority ?? 3)) return false;
    const occlusion =
      opts.occlusion === false
        ? { gain: 1, lowpassHz: 20000 }
        : this.occlusionFor(position);
    const handle = audioEngine.playSample(url, {
      bus: 'sfx',
      volume: opts.volume ?? 0.7,
      rate: opts.rate ?? 1,
      position,
      hrtf: Boolean(opts.hrtf),
      refDistance: 4,
      maxDistance: opts.maxDistance ?? 110,
      lowpassHz: occlusion.lowpassHz,
      onEnded: () => this.releaseVoice(),
    });
    if (!handle) {
      this.releaseVoice();
      return false;
    }
    if (occlusion.gain < 1) {
      handle.setOcclusion(occlusion.gain, occlusion.lowpassHz);
    }
    this.played += 1;
    return true;
  }

  public playFootstep(
    mat: number,
    position: SoundPosition,
    opts: { local?: boolean; underwater?: boolean } = {},
  ): void {
    const jitter = 0.92 + Math.random() * 0.16;
    if (opts.local) {
      const id = opts.underwater
        ? 'sfx:water:splash'
        : footstepAssetId(mat, 1 + Math.floor(Math.random() * 4));
      const url = this.resolve(id);
      if (!url) return;
      audioEngine.playSample(url, {
        bus: 'sfx',
        volume: opts.underwater ? 0.5 : 0.42,
        rate: jitter,
      });
      return;
    }
    const id = opts.underwater
      ? 'sfx:water:drop'
      : footstepAssetId(mat, 1 + Math.floor(Math.random() * 4));
    this.playWorld(id, position, {
      volume: 0.55,
      rate: jitter,
      priority: 1,
      hrtf: false,
      occlusion: false,
      maxDistance: 45,
    });
  }

  public playImpact(
    mat: number,
    position: SoundPosition,
    opts: { local?: boolean } = {},
  ): void {
    const id = impactAssetId(mat, 1 + Math.floor(Math.random() * 2));
    if (opts.local) {
      const url = this.resolve(id);
      if (!url) return;
      audioEngine.playSample(url, {
        bus: 'sfx',
        volume: 0.7,
        rate: 0.94 + Math.random() * 0.12,
      });
      return;
    }
    this.playWorld(id, position, {
      volume: 0.8,
      rate: 0.94 + Math.random() * 0.12,
      priority: 4,
      hrtf: false,
      maxDistance: 80,
    });
  }

  public playDig(mat: number, position: SoundPosition, local = false): void {
    if (local) {
      const url = this.resolve('sfx:dig:shovel');
      if (url) audioEngine.playSample(url, { bus: 'sfx', volume: 0.6 });
      this.playImpact(mat, position, { local: true });
      return;
    }
    this.playWorld('sfx:dig:shovel', position, {
      volume: 0.75,
      priority: 3,
      hrtf: false,
      maxDistance: 55,
    });
  }

  public playLanding(mat: number, position: SoundPosition, local = false): void {
    if (local) {
      const url = this.resolve('sfx:land:heavy');
      if (url) audioEngine.playSample(url, { bus: 'sfx', volume: 0.55 });
      this.playImpact(mat, position, { local: true });
      return;
    }
    this.playWorld('sfx:land:heavy', position, {
      volume: 0.65,
      priority: 3,
      hrtf: false,
      maxDistance: 45,
    });
  }

  public playPickup(position: SoundPosition): void {
    this.playWorld('sfx:pickup:gem', position, {
      volume: 0.55,
      priority: 2,
      hrtf: false,
      maxDistance: 35,
    });
  }

  public playEvent(position: SoundPosition): void {
    this.playWorld('sfx:ui:confirm', position, {
      volume: 0.5,
      priority: 3,
      hrtf: false,
      maxDistance: 120,
    });
  }

  /**
   * Atualiza as camadas de ambiência com crossfade. Chamado a cada frame, mas o
   * estado do mundo só é recalculado pelo arena a cada ~0.5 s.
   */
  public updateAmbience(
    dt: number,
    state: AmbienceState,
  ): void {
    const targets: Record<keyof typeof AMBIENCE_IDS, number> = {
      wind: state.storm
        ? 0.32
        : state.underwater || state.underground
          ? 0.06
          : 0.2,
      water: state.underwater ? 0.4 : state.nearWater ? 0.24 : 0,
      fire: state.nearLava ? 0.32 : 0,
      cave: state.underground ? 0.26 : 0,
      swamp: state.nearSwamp ? 0.22 : 0,
    };

    audioEngine.setReverb(state.underground ? 0.2 : 0);

    for (const key of Object.keys(AMBIENCE_IDS) as Array<
      keyof typeof AMBIENCE_IDS
    >) {
      const target = targets[key];
      const current = this.loops.get(key);
      if (target > 0.01) {
        if (!current) {
          const url = this.resolve(AMBIENCE_IDS[key]);
          if (!url) continue;
          const handle = audioEngine.playSample(url, {
            bus: 'ambience',
            volume: 0.001,
            loop: true,
          });
          if (handle) {
            this.loops.set(key, { handle, volume: 0.001 });
            handle.setVolume(target, 1.4);
          }
        } else if (Math.abs(current.volume - target) > 0.02) {
          current.volume = target;
          current.handle.setVolume(target, 1.0);
        }
      } else if (current) {
        current.handle.stop(1.2);
        this.loops.delete(key);
      }
    }

    // Mantém o cache de oclusão pequeno.
    if (this.occlusionCache.size > 64) this.occlusionCache.clear();
    if (dt <= 0) return;
  }
}

export const audioDirector = new AudioDirector();

if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as { __pwAudio?: AudioDirector }).__pwAudio = audioDirector;
}
