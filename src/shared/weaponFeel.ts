import type { WeaponStats } from './types.ts';

/**
 * Chute de mira por tiro. Dano alto e arma pesada chutam mais; cadência alta
 * reduz o chute por tiro para não transformar metralhadora em torre de escalada.
 *
 * Puro e determinístico (RNG injetável) para testar sem engine.
 */
export interface RecoilImpulse {
  /** Quanto a mira sobe, em radianos (aplicar como `pitch -= pitch`). */
  pitch: number;
  /** Desvio lateral, em radianos. */
  yaw: number;
  /** Quanto o viewmodel recua (0..1.3). */
  viewKick: number;
  /** Trauma de câmera somado (0..0.12). */
  trauma: number;
}

export const MAX_RECOIL_PITCH = 0.022;

type RecoilStats = Pick<WeaponStats, 'damage' | 'fireRate' | 'massKg'>;

function clamp(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

export function recoilImpulseFor(
  stats: RecoilStats,
  random: () => number = Math.random,
): RecoilImpulse {
  const damage = clamp(stats.damage, 1, 100, 10);
  const fireRate = clamp(stats.fireRate, 0.5, 15, 4);
  const mass = clamp(stats.massKg, 1, 30, 5);

  const heavy = Math.min(1.6, damage / 45);
  const cadence = 1 / Math.max(0.75, Math.sqrt(fireRate / 5));
  const pitch = Math.min(
    MAX_RECOIL_PITCH,
    (0.0045 + heavy * 0.0075) * cadence * (0.85 + mass / 120),
  );
  const lateral = random();
  const yaw = (Math.max(0, Math.min(1, lateral)) - 0.5) * 0.006 * heavy * cadence;

  return {
    pitch,
    yaw,
    viewKick: Math.min(1.3, 0.55 + heavy * 0.4),
    trauma: Math.min(0.12, 0.04 + heavy * 0.05),
  };
}
