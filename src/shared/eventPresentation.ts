import type { EventArchetype, EventParams } from './types.ts';

export type EventSoundPatch = 'alert' | 'rumble' | 'growl' | 'hiss' | 'wind' | 'chime';

/**
 * Receita visual/sonora derivada do evento. Não substitui assets dedicados:
 * garante identidade imediata (cor, anel, feixe e cue procedural) enquanto o
 * banco de assets por evento é produzido.
 */
export interface EventPresentation {
  primaryColor: string;
  secondaryColor: string;
  particleCount: number;
  ringRadius: number;
  ringThickness: number;
  beamHeight: number;
  sound: EventSoundPatch;
}

const WEATHER_COLORS: Record<string, [string, string, EventSoundPatch]> = {
  acid_rain: ['#a3e635', '#3f6212', 'hiss'],
  blizzard: ['#bae6fd', '#1e3a5f', 'wind'],
  hail: ['#e0f2fe', '#475569', 'hiss'],
  meteor_shower: ['#fb923c', '#7c2d12', 'rumble'],
  low_gravity: ['#c4b5fd', '#4c1d95', 'chime'],
  earthquake: ['#d6a26a', '#78350f', 'rumble'],
  sandstorm: ['#fcd34d', '#92400e', 'wind'],
  thunderstorm: ['#a78bfa', '#312e81', 'alert'],
  tornado: ['#cbd5e1', '#334155', 'wind'],
};

const TERRAIN_COLORS: Record<string, [string, string, EventSoundPatch]> = {
  volcano: ['#fb923c', '#7f1d1d', 'rumble'],
  fissure: ['#a8a29e', '#292524', 'rumble'],
  crystal_spires: ['#67e8f9', '#0e7490', 'chime'],
  rising_tide: ['#38bdf8', '#0c4a6e', 'wind'],
  sinkhole: ['#78716c', '#1c1917', 'rumble'],
  lava_river: ['#ef4444', '#7f1d1d', 'rumble'],
  glacier: ['#bae6fd', '#1e3a5f', 'chime'],
  overgrowth: ['#4ade80', '#14532d', 'growl'],
};

const ENTITY_COLORS: Record<string, [string, string, EventSoundPatch]> = {
  aggressive_nearest: ['#ef4444', '#450a0a', 'growl'],
  territorial: ['#f59e0b', '#451a03', 'growl'],
  fleeing: ['#22d3ee', '#164e63', 'chime'],
  explosive_kamikaze: ['#f97316', '#7c2d12', 'alert'],
  static_pickup: ['#fbbf24', '#0f766e', 'chime'],
};

const SUPPLY_COLORS: [string, string, EventSoundPatch] = ['#fbbf24', '#0f766e', 'chime'];

const SCENERY_COLORS: Record<string, [string, string, EventSoundPatch]> = {
  tree: ['#4ade80', '#14532d', 'chime'],
  grove: ['#22c55e', '#166534', 'chime'],
  house: ['#fbbf24', '#78350f', 'rumble'],
  tower: ['#cbd5e1', '#334155', 'rumble'],
  skyscraper: ['#67e8f9', '#0e7490', 'alert'],
  ruins: ['#a8a29e', '#292524', 'rumble'],
};

export function presentationForEvent(
  archetype: EventArchetype,
  params: EventParams,
): EventPresentation {
  let colors: [string, string, EventSoundPatch] = ['#f59e0b', '#334155', 'alert'];

  if (archetype === 'WEATHER_HAZARD') {
    colors = WEATHER_COLORS[params.weatherKind ?? 'meteor_shower'] ?? colors;
  } else if (archetype === 'TERRAIN_MUTATION') {
    colors = TERRAIN_COLORS[params.mutationKind ?? 'crystal_spires'] ?? colors;
  } else if (archetype === 'ENTITY_SPAWN') {
    colors = ENTITY_COLORS[params.aiBehavior ?? 'aggressive_nearest'] ?? colors;
  } else if (archetype === 'SUPPLY_DROP') {
    colors = SUPPLY_COLORS;
  } else if (archetype === 'SCENERY_SPAWN') {
    colors = SCENERY_COLORS[params.sceneryKind ?? 'tree'] ?? colors;
  }

  const lethality = Math.max(0, Math.min(45, params.lethality || 0));
  const radius = Math.max(6, Math.min(45, params.radiusMeters || 18));
  const baseCount =
    archetype === 'WEATHER_HAZARD'
      ? 36
      : archetype === 'TERRAIN_MUTATION'
        ? 28
        : archetype === 'ENTITY_SPAWN'
          ? 20
          : archetype === 'SCENERY_SPAWN'
            ? 24
            : 12;

  return {
    primaryColor: colors[0],
    secondaryColor: colors[1],
    particleCount: Math.round(baseCount + lethality * 0.6),
    ringRadius: Math.min(6, Math.max(2.2, radius * 0.18)),
    ringThickness: Math.min(0.18, 0.08 + lethality * 0.002),
    beamHeight: Math.min(18, 2.5 + radius * 0.32),
    sound: colors[2],
  };
}
