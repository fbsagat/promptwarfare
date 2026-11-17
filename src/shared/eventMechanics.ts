import type {
  EventArchetype,
  EventParams,
  EventPhase,
  EventSignature,
} from './types.ts';
import type { EventSoundPatch } from './eventPresentation.ts';

/**
 * Metadados de assinatura de evento. A assinatura é a "lei física" do evento:
 * ela define escala, cadência, cor, cue sonoro, tremor de câmera e a
 * contra-jogada esperada. Nenhum evento pode reaproveitar a assinatura de outro.
 */
export interface SignatureMeta {
  scale: 'regional' | 'colossal' | 'apocaliptico';
  pulseSec: number;
  telegraphSec: number;
  colors: [string, string];
  sound: EventSoundPatch;
  cameraShake: number;
  counterplay: string[];
  reward: string;
}

export const SIGNATURE_META: Record<EventSignature, SignatureMeta> = {
  orbital_barrage: {
    scale: 'apocaliptico',
    pulseSec: 1.35,
    telegraphSec: 7,
    colors: ['#fb923c', '#7c2d12'],
    sound: 'whistle',
    cameraShake: 0.55,
    counterplay: ['sprint', 'high_ground', 'shelter'],
    reward: 'Núcleo incandescente',
  },
  whiteout: {
    scale: 'apocaliptico',
    pulseSec: 1.6,
    telegraphSec: 7,
    colors: ['#bae6fd', '#1e3a5f'],
    sound: 'wind',
    cameraShake: 0.25,
    counterplay: ['shelter', 'dig'],
    reward: 'Caverna de gelo',
  },
  acid_corrosion: {
    scale: 'apocaliptico',
    pulseSec: 1.5,
    telegraphSec: 7,
    colors: ['#a3e635', '#3f6212'],
    sound: 'sizzle',
    cameraShake: 0.18,
    counterplay: ['shelter', 'high_ground'],
    reward: 'Cristal tóxico',
  },
  quake_collapse: {
    scale: 'apocaliptico',
    pulseSec: 1.2,
    telegraphSec: 6,
    colors: ['#d6a26a', '#78350f'],
    sound: 'quake',
    cameraShake: 0.9,
    counterplay: ['sprint', 'high_ground'],
    reward: 'Cofre soterrado',
  },
  gravity_collapse: {
    scale: 'colossal',
    pulseSec: 2.2,
    telegraphSec: 8,
    colors: ['#c4b5fd', '#4c1d95'],
    sound: 'chime',
    cameraShake: 0.35,
    counterplay: ['sprint', 'grapple'],
    reward: 'Loot flutuante',
  },
  sand_wall: {
    scale: 'apocaliptico',
    pulseSec: 1.1,
    telegraphSec: 7,
    colors: ['#fcd34d', '#92400e'],
    sound: 'wind',
    cameraShake: 0.3,
    counterplay: ['high_ground', 'shelter'],
    reward: 'Ruínas expostas',
  },
  supercell: {
    scale: 'apocaliptico',
    pulseSec: 1.3,
    telegraphSec: 6,
    colors: ['#a78bfa', '#312e81'],
    sound: 'alert',
    cameraShake: 0.55,
    counterplay: ['shelter', 'sprint'],
    reward: 'Cristal de fulgurita',
  },
  hail_barrage: {
    scale: 'colossal',
    pulseSec: 1.15,
    telegraphSec: 6,
    colors: ['#e0f2fe', '#475569'],
    sound: 'hiss',
    cameraShake: 0.35,
    counterplay: ['shelter', 'sprint'],
    reward: 'Loot congelado',
  },
  multi_vortex: {
    scale: 'apocaliptico',
    pulseSec: 0.55,
    telegraphSec: 8,
    colors: ['#cbd5e1', '#334155'],
    sound: 'vortex',
    cameraShake: 0.85,
    counterplay: ['sprint', 'grapple', 'shelter'],
    reward: 'Destroços com loot',
  },
  volcano_birth: {
    scale: 'apocaliptico',
    pulseSec: 2.1,
    telegraphSec: 8,
    colors: ['#fb923c', '#7f1d1d'],
    sound: 'eruption',
    cameraShake: 0.95,
    counterplay: ['high_ground', 'sprint', 'shelter'],
    reward: 'Obsidiana',
  },
  canyon_tear: {
    scale: 'colossal',
    pulseSec: 2.4,
    telegraphSec: 7,
    colors: ['#a8a29e', '#292524'],
    sound: 'rumble',
    cameraShake: 0.7,
    counterplay: ['sprint', 'grapple'],
    reward: 'Veios de minério',
  },
  crystal_bloom: {
    scale: 'colossal',
    pulseSec: 2.6,
    telegraphSec: 6,
    colors: ['#67e8f9', '#0e7490'],
    sound: 'chime',
    cameraShake: 0.3,
    counterplay: ['high_ground', 'dig'],
    reward: 'Cristal',
  },
  tsunami_surge: {
    scale: 'apocaliptico',
    pulseSec: 1.8,
    telegraphSec: 8,
    colors: ['#38bdf8', '#0c4a6e'],
    sound: 'wave',
    cameraShake: 0.45,
    counterplay: ['high_ground', 'grapple'],
    reward: 'Caixas flutuantes',
  },
  sinkhole_maw: {
    scale: 'colossal',
    pulseSec: 1.7,
    telegraphSec: 7,
    colors: ['#78716c', '#1c1917'],
    sound: 'rumble',
    cameraShake: 0.75,
    counterplay: ['sprint', 'grapple'],
    reward: 'Loot na borda',
  },
  lava_river: {
    scale: 'colossal',
    pulseSec: 1.4,
    telegraphSec: 7,
    colors: ['#ef4444', '#7f1d1d'],
    sound: 'eruption',
    cameraShake: 0.55,
    counterplay: ['high_ground', 'sprint'],
    reward: 'Obsidiana',
  },
  glacier_advance: {
    scale: 'colossal',
    pulseSec: 1.9,
    telegraphSec: 7,
    colors: ['#bae6fd', '#1e3a5f'],
    sound: 'rumble',
    cameraShake: 0.5,
    counterplay: ['high_ground', 'dig'],
    reward: 'Loot na caverna',
  },
  overgrowth_titan: {
    scale: 'colossal',
    pulseSec: 2.3,
    telegraphSec: 7,
    colors: ['#4ade80', '#14532d'],
    sound: 'growl',
    cameraShake: 0.45,
    counterplay: ['high_ground', 'dig'],
    reward: 'Fruto e loot',
  },
  alpha_pack: {
    scale: 'regional',
    pulseSec: 2.8,
    telegraphSec: 6,
    colors: ['#ef4444', '#450a0a'],
    sound: 'growl',
    cameraShake: 0.2,
    counterplay: ['combat', 'high_ground'],
    reward: 'Pele do alpha',
  },
  stone_colossus: {
    scale: 'regional',
    pulseSec: 2.6,
    telegraphSec: 6,
    colors: ['#f59e0b', '#451a03'],
    sound: 'quake',
    cameraShake: 0.65,
    counterplay: ['combat', 'high_ground'],
    reward: 'Núcleo de golem',
  },
  panic_herd: {
    scale: 'regional',
    pulseSec: 3.2,
    telegraphSec: 5,
    colors: ['#22d3ee', '#164e63'],
    sound: 'chime',
    cameraShake: 0.12,
    counterplay: ['sprint', 'high_ground'],
    reward: 'Loot raro',
  },
  detonating_swarm: {
    scale: 'regional',
    pulseSec: 1.9,
    telegraphSec: 6,
    colors: ['#f97316', '#7c2d12'],
    sound: 'alert',
    cameraShake: 0.4,
    counterplay: ['combat', 'shelter'],
    reward: 'Glândula explosiva',
  },
  spider_nest: {
    scale: 'regional',
    pulseSec: 2.2,
    telegraphSec: 6,
    colors: ['#a3e635', '#1f2937'],
    sound: 'growl',
    cameraShake: 0.25,
    counterplay: ['combat', 'high_ground'],
    reward: 'Seda e veneno',
  },
  hunter_squad: {
    scale: 'regional',
    pulseSec: 2.0,
    telegraphSec: 6,
    colors: ['#38bdf8', '#0f172a'],
    sound: 'alert',
    cameraShake: 0.3,
    counterplay: ['shelter', 'combat'],
    reward: 'Núcleo de drone',
  },
  ice_titan: {
    scale: 'regional',
    pulseSec: 2.4,
    telegraphSec: 6,
    colors: ['#bae6fd', '#1e3a5f'],
    sound: 'growl',
    cameraShake: 0.5,
    counterplay: ['combat', 'high_ground'],
    reward: 'Núcleo de gelo',
  },
  serpent_nest: {
    scale: 'regional',
    pulseSec: 2.3,
    telegraphSec: 6,
    colors: ['#4ade80', '#14532d'],
    sound: 'hiss',
    cameraShake: 0.25,
    counterplay: ['high_ground', 'combat'],
    reward: 'Saco de veneno',
  },
  supply_barrage: {
    scale: 'regional',
    pulseSec: 3.5,
    telegraphSec: 5,
    colors: ['#fbbf24', '#0f766e'],
    sound: 'chime',
    cameraShake: 0.15,
    counterplay: ['sprint', 'combat'],
    reward: 'Loot variado',
  },
  armored_depot: {
    scale: 'regional',
    pulseSec: 3.6,
    telegraphSec: 5,
    colors: ['#94a3b8', '#1e293b'],
    sound: 'rumble',
    cameraShake: 0.3,
    counterplay: ['combat', 'shelter'],
    reward: 'Munição pesada',
  },
  legendary_drop: {
    scale: 'colossal',
    pulseSec: 4.0,
    telegraphSec: 6,
    colors: ['#c084fc', '#4c1d95'],
    sound: 'chime',
    cameraShake: 0.2,
    counterplay: ['combat', 'high_ground'],
    reward: 'Arma lendária',
  },
  treasure_vault: {
    scale: 'regional',
    pulseSec: 4.2,
    telegraphSec: 5,
    colors: ['#facc15', '#78350f'],
    sound: 'chime',
    cameraShake: 0.2,
    counterplay: ['dig', 'combat'],
    reward: 'Tesouro',
  },
  emergency_beacon: {
    scale: 'regional',
    pulseSec: 3.8,
    telegraphSec: 5,
    colors: ['#fb7185', '#7f1d1d'],
    sound: 'alert',
    cameraShake: 0.1,
    counterplay: ['combat', 'shelter'],
    reward: 'Cura total',
  },
  titan_tree: {
    scale: 'colossal',
    pulseSec: 3.0,
    telegraphSec: 6,
    colors: ['#4ade80', '#14532d'],
    sound: 'growl',
    cameraShake: 0.4,
    counterplay: ['high_ground', 'dig'],
    reward: 'Fruto de cura',
  },
  maze_grove: {
    scale: 'colossal',
    pulseSec: 3.2,
    telegraphSec: 6,
    colors: ['#22c55e', '#166534'],
    sound: 'chime',
    cameraShake: 0.2,
    counterplay: ['high_ground', 'shelter'],
    reward: 'Loot escondido',
  },
  rising_house: {
    scale: 'regional',
    pulseSec: 3.4,
    telegraphSec: 5,
    colors: ['#fbbf24', '#78350f'],
    sound: 'rumble',
    cameraShake: 0.35,
    counterplay: ['shelter', 'high_ground'],
    reward: 'Loot',
  },
  watchtower: {
    scale: 'regional',
    pulseSec: 3.4,
    telegraphSec: 5,
    colors: ['#cbd5e1', '#334155'],
    sound: 'rumble',
    cameraShake: 0.3,
    counterplay: ['high_ground', 'grapple'],
    reward: 'Loot de precisão',
  },
  colossal_tower: {
    scale: 'colossal',
    pulseSec: 3.0,
    telegraphSec: 6,
    colors: ['#67e8f9', '#0e7490'],
    sound: 'alert',
    cameraShake: 0.55,
    counterplay: ['high_ground', 'grapple'],
    reward: 'Loot raro',
  },
  lost_temple: {
    scale: 'colossal',
    pulseSec: 3.2,
    telegraphSec: 6,
    colors: ['#a8a29e', '#292524'],
    sound: 'rumble',
    cameraShake: 0.5,
    counterplay: ['shelter', 'combat'],
    reward: 'Relíquia',
  },
};

const WEATHER_SIGNATURE: Record<string, EventSignature> = {
  meteor_shower: 'orbital_barrage',
  blizzard: 'whiteout',
  acid_rain: 'acid_corrosion',
  earthquake: 'quake_collapse',
  low_gravity: 'gravity_collapse',
  sandstorm: 'sand_wall',
  thunderstorm: 'supercell',
  hail: 'hail_barrage',
  tornado: 'multi_vortex',
};

const TERRAIN_SIGNATURE: Record<string, EventSignature> = {
  volcano: 'volcano_birth',
  fissure: 'canyon_tear',
  crystal_spires: 'crystal_bloom',
  rising_tide: 'tsunami_surge',
  sinkhole: 'sinkhole_maw',
  lava_river: 'lava_river',
  glacier: 'glacier_advance',
  overgrowth: 'overgrowth_titan',
};

const ENTITY_SIGNATURE_BY_ID: Record<string, EventSignature> = {
  evt_entity_aggressive_nearest: 'alpha_pack',
  evt_entity_territorial: 'stone_colossus',
  evt_entity_fleeing: 'panic_herd',
  evt_entity_explosive_kamikaze: 'detonating_swarm',
  evt_entity_spider_swarm: 'spider_nest',
  evt_entity_hunter_drones: 'hunter_squad',
  evt_entity_ice_colossus: 'ice_titan',
  evt_entity_venom_serpents: 'serpent_nest',
};

const SUPPLY_SIGNATURE_BY_ID: Record<string, EventSignature> = {
  evt_supply_supply: 'supply_barrage',
  evt_supply_ammo_depot: 'armored_depot',
  evt_supply_elite_supply: 'legendary_drop',
  evt_supply_treasure_cache: 'treasure_vault',
  evt_supply_emergency_cache: 'emergency_beacon',
};

const SCENERY_SIGNATURE: Record<string, EventSignature> = {
  tree: 'titan_tree',
  grove: 'maze_grove',
  house: 'rising_house',
  tower: 'watchtower',
  skyscraper: 'colossal_tower',
  ruins: 'lost_temple',
};

const ENTITY_SIGNATURE_BY_BEHAVIOR: Record<string, EventSignature> = {
  aggressive_nearest: 'alpha_pack',
  territorial: 'stone_colossus',
  fleeing: 'panic_herd',
  explosive_kamikaze: 'detonating_swarm',
  static_pickup: 'supply_barrage',
};

/** Resolve a assinatura de um evento do catálogo ou de um componente composto. */
export function signatureForEvent(
  archetype: EventArchetype,
  params: EventParams,
  catalogId?: string,
): EventSignature {
  if (catalogId) {
    if (ENTITY_SIGNATURE_BY_ID[catalogId]) return ENTITY_SIGNATURE_BY_ID[catalogId];
    if (SUPPLY_SIGNATURE_BY_ID[catalogId]) return SUPPLY_SIGNATURE_BY_ID[catalogId];
  }
  if (archetype === 'WEATHER_HAZARD') {
    return WEATHER_SIGNATURE[params.weatherKind ?? 'meteor_shower'] ?? 'orbital_barrage';
  }
  if (archetype === 'TERRAIN_MUTATION') {
    return TERRAIN_SIGNATURE[params.mutationKind ?? 'crystal_spires'] ?? 'crystal_bloom';
  }
  if (archetype === 'ENTITY_SPAWN') {
    return ENTITY_SIGNATURE_BY_BEHAVIOR[params.aiBehavior ?? 'aggressive_nearest'] ?? 'alpha_pack';
  }
  if (archetype === 'SUPPLY_DROP') return 'supply_barrage';
  return SCENERY_SIGNATURE[params.sceneryKind ?? 'tree'] ?? 'titan_tree';
}

/** Progresso 0..1 (sem contar o aviso) para a fase visível. */
export function phaseForProgress(progress: number): EventPhase {
  const p = Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0));
  if (p < 0.14) return 'impact';
  if (p < 0.62) return 'sustain';
  if (p < 0.86) return 'climax';
  return 'dissipate';
}

/** Intensidade 0..1 usada por VFX, câmera, áudio e HUD. */
export function intensityForEvent(params: EventParams): number {
  const lethality = Math.max(0, Math.min(45, params.lethality || 0)) / 45;
  const radius = Math.max(0, Math.min(130, params.radiusMeters || 0)) / 130;
  const quantity = Math.max(0, Math.min(20, params.quantity || 0)) / 20;
  return Math.max(0.15, Math.min(1, lethality * 0.5 + radius * 0.35 + quantity * 0.15));
}

/** Escala épica 0..1: raio e duração dominam; usada para fog/vinheta/partículas. */
export function epicScaleForEvent(params: EventParams): number {
  const radius = Math.max(0, Math.min(130, params.radiusMeters || 0)) / 130;
  const duration = Math.max(0, Math.min(120, params.durationSec || 0)) / 120;
  return Math.max(0.1, Math.min(1, radius * 0.7 + duration * 0.3));
}

/** Intervalo de pulso da assinatura, acelerando no clímax e desacelerando no rescaldo. */
export function pulseIntervalForSignature(
  signature: EventSignature,
  phase: EventPhase,
): number {
  const base = SIGNATURE_META[signature]?.pulseSec ?? 1.4;
  if (phase === 'impact') return base * 1.15;
  if (phase === 'climax') return base * 0.62;
  if (phase === 'dissipate') return base * 1.45;
  return base;
}

/** Fase de um evento ativo a partir do tempo restante. */
export function phaseForEvent(event: {
  durationRemainingSec: number;
  totalDurationSec: number;
}): EventPhase {
  const total = Math.max(1, event.totalDurationSec || 1);
  const progress = 1 - Math.max(0, event.durationRemainingSec) / total;
  return phaseForProgress(progress);
}
