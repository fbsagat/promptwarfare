import type {
  EventSignature,
  InventorySlotItem,
  RelicId,
} from './types.ts';

export interface RelicDef {
  id: RelicId;
  name: string;
  description: string;
  color: string;
  durationSec: number;
  /** Efeito aplicado no servidor e/ou no HUD. */
  effect:
    | 'wind_immune'
    | 'acid_immune'
    | 'thermal_immune'
    | 'frost_immune'
    | 'storm_immune'
    | 'seismic_immune'
    | 'void_sight'
    | 'shield';
}

export const RELICS: Record<RelicId, RelicDef> = {
  wind_anchor: {
    id: 'wind_anchor',
    name: 'Âncora de Vento',
    description: 'Resiste a tornado, areia e ventos laterais por 25s.',
    color: '#cbd5e1',
    durationSec: 25,
    effect: 'wind_immune',
  },
  acid_mask: {
    id: 'acid_mask',
    name: 'Máscara Ácida',
    description: 'Imunidade a chuva ácida, gêiseres e veneno por 25s.',
    color: '#a3e635',
    durationSec: 25,
    effect: 'acid_immune',
  },
  thermal_core: {
    id: 'thermal_core',
    name: 'Núcleo Térmico',
    description: 'Imunidade a lava, fogo e bombas vulcânicas por 25s.',
    color: '#fb923c',
    durationSec: 25,
    effect: 'thermal_immune',
  },
  frost_heart: {
    id: 'frost_heart',
    name: 'Coração Glacial',
    description: 'Imunidade a nevasca, granizo e congelamento por 25s.',
    color: '#bae6fd',
    durationSec: 25,
    effect: 'frost_immune',
  },
  storm_rod: {
    id: 'storm_rod',
    name: 'Para-raios',
    description: 'Redireciona raios e lasers de drone por 20s.',
    color: '#a78bfa',
    durationSec: 20,
    effect: 'storm_immune',
  },
  seismic_boots: {
    id: 'seismic_boots',
    name: 'Botas Sísmicas',
    description: 'Imunidade a terremoto, fissura e colapso por 25s.',
    color: '#d6a26a',
    durationSec: 25,
    effect: 'seismic_immune',
  },
  void_eye: {
    id: 'void_eye',
    name: 'Olho do Caos',
    description: 'Enxerga através de areia e nevasca por 25s.',
    color: '#c4b5fd',
    durationSec: 25,
    effect: 'void_sight',
  },
  titan_heart: {
    id: 'titan_heart',
    name: 'Coração de Titã',
    description: 'Concede 60 de escudo e cura 25 HP imediatamente.',
    color: '#fbbf24',
    durationSec: 20,
    effect: 'shield',
  },
};

const SIGNATURE_RELIC: Partial<Record<EventSignature, RelicId>> = {
  multi_vortex: 'wind_anchor',
  sand_wall: 'wind_anchor',
  whiteout: 'frost_heart',
  hail_barrage: 'frost_heart',
  glacier_advance: 'frost_heart',
  acid_corrosion: 'acid_mask',
  serpent_nest: 'acid_mask',
  volcano_birth: 'thermal_core',
  lava_river: 'thermal_core',
  orbital_barrage: 'thermal_core',
  supercell: 'storm_rod',
  hunter_squad: 'storm_rod',
  quake_collapse: 'seismic_boots',
  canyon_tear: 'seismic_boots',
  sinkhole_maw: 'seismic_boots',
  stone_colossus: 'seismic_boots',
  gravity_collapse: 'void_eye',
  crystal_bloom: 'void_eye',
  lost_temple: 'void_eye',
  alpha_pack: 'titan_heart',
  panic_herd: 'titan_heart',
  detonating_swarm: 'titan_heart',
  spider_nest: 'titan_heart',
  ice_titan: 'titan_heart',
  supply_barrage: 'titan_heart',
  armored_depot: 'titan_heart',
  legendary_drop: 'titan_heart',
  treasure_vault: 'titan_heart',
  emergency_beacon: 'titan_heart',
  titan_tree: 'titan_heart',
  maze_grove: 'void_eye',
  rising_house: 'titan_heart',
  watchtower: 'void_eye',
  colossal_tower: 'wind_anchor',
  overgrowth_titan: 'titan_heart',
};

export function relicForSignature(signature: EventSignature): RelicId {
  return SIGNATURE_RELIC[signature] ?? 'titan_heart';
}

export function relicDurationMs(id: RelicId): number {
  return RELICS[id].durationSec * 1000;
}

export function createRelicItem(id: RelicId): InventorySlotItem {
  const def = RELICS[id];
  return {
    id: `relic_${id}_${Math.random().toString(36).slice(2, 8)}`,
    kind: 'relic',
    name: def.name,
    massKg: 1.5,
    relicId: id,
  };
}

export function relicColor(id: RelicId): string {
  return RELICS[id]?.color ?? '#fbbf24';
}
