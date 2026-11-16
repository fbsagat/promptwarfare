/**
 * Presets de qualidade gráfica.
 *
 * A Fase 0 apenas resolve o perfil e aplica escala de render/sombras; os demais
 * campos (bloom, vfxScale, weatherCap, decals, hrtfSources) ficam disponíveis
 * para as fases seguintes sem alterar comportamento visual ainda.
 *
 * Meta: PC médio/iGPU. Por isso não há SSAO, SSR nem volumétricos em nenhum
 * perfil, e o perfil `low` reduz resolução e desliga sombras.
 */

export type QualityLevel = 'auto' | 'low' | 'medium' | 'high';
export type ResolvedQualityLevel = Exclude<QualityLevel, 'auto'>;
export type GpuTier = 'software' | 'integrated' | 'discrete' | 'unknown';

export interface QualityProfile {
  readonly level: ResolvedQualityLevel;
  /** Multiplicador de resolução do Babylon (>1 renderiza menos pixels). */
  readonly hardwareScaling: number;
  readonly shadows: boolean;
  readonly shadowMapSize: number;
  readonly bloom: boolean;
  readonly antialias: boolean;
  /** Reservado: escala de partículas/decals. */
  readonly vfxScale: number;
  readonly weatherCap: number;
  readonly decalCap: number;
  /** Reservado: máximo de fontes HRTF simultâneas. */
  readonly hrtfSources: number;
}

export const QUALITY_STORAGE_KEY = 'pw.quality.v1';

export const QUALITY_LEVELS: readonly QualityLevel[] = [
  'auto',
  'low',
  'medium',
  'high',
];

const PROFILES: Record<ResolvedQualityLevel, QualityProfile> = {
  low: {
    level: 'low',
    hardwareScaling: 1.25,
    shadows: false,
    shadowMapSize: 512,
    bloom: false,
    antialias: false,
    vfxScale: 0.5,
    weatherCap: 72,
    decalCap: 24,
    hrtfSources: 4,
  },
  medium: {
    level: 'medium',
    hardwareScaling: 1,
    shadows: true,
    shadowMapSize: 1024,
    bloom: true,
    antialias: true,
    vfxScale: 1,
    weatherCap: 120,
    decalCap: 48,
    hrtfSources: 8,
  },
  high: {
    level: 'high',
    hardwareScaling: 1,
    shadows: true,
    shadowMapSize: 2048,
    bloom: true,
    antialias: true,
    vfxScale: 1.35,
    weatherCap: 180,
    decalCap: 64,
    hrtfSources: 12,
  },
};

export function isQualityLevel(value: unknown): value is QualityLevel {
  return (
    typeof value === 'string' &&
    (QUALITY_LEVELS as readonly string[]).includes(value)
  );
}

/**
 * Heurística pelo nome do renderer. Serve só para o preset `auto`: iGPU cai em
 * `low` (60 fps), GPU dedicada/desconhecida fica em `medium`.
 */
export function detectGpuTier(rendererName: string): GpuTier {
  const name = rendererName ?? '';
  if (/SwiftShader|llvmpipe|Software|Mesa/i.test(name)) return 'software';
  if (/Intel|UHD|Iris|Radeon.*(Vega|Graphics)|Apple M[12]/i.test(name)) {
    return 'integrated';
  }
  if (/NVIDIA|GeForce|RTX|GTX|Radeon RX|Arc A/i.test(name)) return 'discrete';
  return 'unknown';
}

/**
 * Resolve o perfil efetivo. `auto` usa `low` em iGPU e `medium` em GPU
 * dedicada/desconhecida.
 */
export function resolveQuality(
  level: QualityLevel,
  opts: { isSoftwareGl?: boolean; gpuTier?: GpuTier } = {},
): QualityProfile {
  if (opts.isSoftwareGl || opts.gpuTier === 'software') return PROFILES.low;
  if (level === 'auto') {
    return opts.gpuTier === 'integrated' ? PROFILES.low : PROFILES.medium;
  }
  return PROFILES[level] ?? PROFILES.medium;
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

function defaultStorage(): StorageLike | null {
  try {
    if (typeof window === 'undefined') return null;
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

export function loadQualityLevel(storage: StorageLike | null = defaultStorage()): QualityLevel {
  if (!storage) return 'auto';
  try {
    const raw = storage.getItem(QUALITY_STORAGE_KEY);
    return isQualityLevel(raw) ? raw : 'auto';
  } catch {
    return 'auto';
  }
}

export function saveQualityLevel(
  level: QualityLevel,
  storage: StorageLike | null = defaultStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(QUALITY_STORAGE_KEY, level);
  } catch {
    // localStorage pode estar bloqueado (modo privado); ignora.
  }
}
