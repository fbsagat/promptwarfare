import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildFallbackEntityVoxels,
  buildFallbackWeaponVoxels,
  encodeRleVoxels,
  validateAndClampEventParams,
  validateAndClampWeapon,
} from '../src/shared/budget.ts';
import type {
  EntityBlueprint,
  EventArchetype,
  EventParams,
  PaletteColor,
  ProjectileBehavior,
  SelfRiskFlag,
  StatusEffect,
  WeaponStats,
} from '../src/shared/types.ts';
import type { CatalogFile, CatalogWeaponItem, CatalogEventItem } from '../server/catalog.ts';
import { writeCatalogArtifacts } from '../server/catalogArtifacts.ts';
import { mergeCatalog } from './catalogMerge.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, '..', 'content', 'catalog');
const OUT_FILE = path.join(OUT_DIR, 'catalog.json');
const RESET = process.argv.includes('--reset');

function readExistingCatalog(): CatalogFile | null {
  if (RESET || !fs.existsSync(OUT_FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(OUT_FILE, 'utf8')) as CatalogFile;
  } catch {
    return null;
  }
}

const existingCatalog = readExistingCatalog();
const positionalVersion =
  process.argv.slice(2).find((arg) => !arg.startsWith('-'))?.trim() ?? '';
const CATALOG_VERSION =
  positionalVersion || existingCatalog?.version || '2026-11-16.1';

interface Archetype {
  key: string;
  label: string;
  aliases: string[];
  stats: WeaponStats;
  crater: number;
  selfRisk: string[];
}

interface Element {
  key: string;
  label: string;
  aliases: string[];
  tags: string[];
  palette: PaletteColor[];
  behavior: ProjectileBehavior;
  status: StatusEffect;
  damage: number;
  fireRate: number;
  spread: number;
  range: number;
  ammo: number;
  cooling: number;
  mass: number;
  crater: number;
}

const ARCHETYPES: Archetype[] = [
  {
    key: 'pistol',
    label: 'Pistola',
    aliases: ['pistola', 'pistol', 'revolver'],
    stats: { damage: 14, fireRate: 3.2, projectiles: 1, spreadDeg: 4, rangeMeters: 55, ammoMax: 24, cooling: 5, massKg: 5 },
    crater: 0,
    selfRisk: [],
  },
  {
    key: 'rifle',
    label: 'Rifle',
    aliases: ['rifle', 'fuzil', 'carabina'],
    stats: { damage: 16, fireRate: 4.5, projectiles: 1, spreadDeg: 3, rangeMeters: 78, ammoMax: 30, cooling: 6, massKg: 8 },
    crater: 1,
    selfRisk: [],
  },
  {
    key: 'smg',
    label: 'Submetralhadora',
    aliases: ['submetralhadora', 'smg', 'metralhadora', 'metralha'],
    stats: { damage: 9, fireRate: 7.5, projectiles: 1, spreadDeg: 7, rangeMeters: 55, ammoMax: 48, cooling: 7, massKg: 6 },
    crater: 0,
    selfRisk: [],
  },
  {
    key: 'shotgun',
    label: 'Escopeta',
    aliases: ['escopeta', 'shotgun', 'cartucho', 'estilha'],
    stats: { damage: 8, fireRate: 1.2, projectiles: 6, spreadDeg: 13, rangeMeters: 40, ammoMax: 18, cooling: 5, massKg: 11 },
    crater: 2,
    selfRisk: [],
  },
  {
    key: 'sniper',
    label: 'Rifle de Precisão',
    aliases: ['sniper', 'rifle de precisao', 'franco', 'laser'],
    stats: { damage: 40, fireRate: 0.75, projectiles: 1, spreadDeg: 1, rangeMeters: 110, ammoMax: 11, cooling: 5, massKg: 12 },
    crater: 1,
    selfRisk: [],
  },
  {
    key: 'launcher',
    label: 'Lançador',
    aliases: ['bazuca', 'lancador', 'canhao', 'missil', 'foguete'],
    stats: { damage: 34, fireRate: 0.7, projectiles: 1, spreadDeg: 4, rangeMeters: 85, ammoMax: 8, cooling: 4, massKg: 18 },
    crater: 3,
    selfRisk: ['recoil_launch'],
  },
  {
    key: 'crossbow',
    label: 'Besta',
    aliases: ['besta', 'crossbow', 'ballesta', 'besta de pregao'],
    stats: { damage: 24, fireRate: 1.1, projectiles: 1, spreadDeg: 2, rangeMeters: 72, ammoMax: 12, cooling: 4, massKg: 7 },
    crater: 0,
    selfRisk: [],
  },
  {
    key: 'bow',
    label: 'Arco',
    aliases: ['arco', 'bow', 'arco composto', 'arco longo'],
    stats: { damage: 20, fireRate: 1.6, projectiles: 1, spreadDeg: 3, rangeMeters: 80, ammoMax: 16, cooling: 3, massKg: 4 },
    crater: 0,
    selfRisk: [],
  },
  {
    key: 'gatling',
    label: 'Metralhadora Pesada',
    aliases: ['metralhadora pesada', 'gatling', 'minigun', 'metralha pesada'],
    stats: { damage: 6, fireRate: 8, projectiles: 1, spreadDeg: 9, rangeMeters: 62, ammoMax: 60, cooling: 9, massKg: 16 },
    crater: 0,
    selfRisk: [],
  },
  {
    key: 'flamethrower',
    label: 'Lança-Chamas',
    aliases: ['lanca chamas', 'lanca-chamas', 'flamethrower', 'jato de fogo', 'queimador'],
    stats: { damage: 5, fireRate: 8, projectiles: 1, spreadDeg: 12, rangeMeters: 26, ammoMax: 60, cooling: 6, massKg: 14 },
    crater: 1,
    selfRisk: [],
  },
  {
    key: 'energy_cannon',
    label: 'Desintegrador',
    aliases: ['desintegrador', 'canhao de energia', 'canhao de plasma'],
    stats: { damage: 26, fireRate: 1.3, projectiles: 1, spreadDeg: 3, rangeMeters: 88, ammoMax: 14, cooling: 6, massKg: 14 },
    crater: 1,
    selfRisk: [],
  },
  {
    key: 'harpoon',
    label: 'Arpão',
    aliases: ['arpao', 'arpao magnetico', 'harpoon', 'arpoadora'],
    stats: { damage: 22, fireRate: 1, projectiles: 1, spreadDeg: 2, rangeMeters: 58, ammoMax: 10, cooling: 4, massKg: 9 },
    crater: 0,
    selfRisk: [],
  },
  {
    key: 'mortar',
    label: 'Morteiro',
    aliases: ['morteiro', 'mortar', 'obuseiro', 'lancador de granadas'],
    stats: { damage: 30, fireRate: 0.6, projectiles: 1, spreadDeg: 5, rangeMeters: 96, ammoMax: 8, cooling: 5, massKg: 20 },
    crater: 3,
    selfRisk: ['recoil_launch'],
  },
  {
    key: 'dual_pistols',
    label: 'Akimbo',
    aliases: ['akimbo', 'pistolas duplas', 'pistola dupla', 'dual pistols'],
    stats: { damage: 9, fireRate: 4, projectiles: 2, spreadDeg: 6, rangeMeters: 50, ammoMax: 36, cooling: 5, massKg: 7 },
    crater: 0,
    selfRisk: [],
  },
  {
    key: 'railgun',
    label: 'Railgun',
    aliases: ['railgun', 'canhao de trilho', 'trilho magnetico'],
    stats: { damage: 40, fireRate: 0.6, projectiles: 1, spreadDeg: 1, rangeMeters: 120, ammoMax: 8, cooling: 4, massKg: 18 },
    crater: 1,
    selfRisk: ['recoil_launch'],
  },
];

const ELEMENTS: Element[] = [
  {
    key: 'standard',
    label: 'Padrão',
    aliases: ['padrao', 'comum', 'basica'],
    tags: ['standard'],
    palette: [
      { hex: '#38bdf8', emissive: true },
      { hex: '#334155', emissive: false },
      { hex: '#94a3b8', emissive: false },
      { hex: '#f59e0b', emissive: true },
    ],
    behavior: 'standard',
    status: 'none',
    damage: 0,
    fireRate: 0,
    spread: 0,
    range: 0,
    ammo: 0,
    cooling: 0,
    mass: 0,
    crater: 0,
  },
  {
    key: 'ice',
    label: 'de Gelo',
    aliases: ['gelo', 'congelante', 'glacial', 'criogenico', 'crio'],
    tags: ['ice', 'freeze'],
    palette: [
      { hex: '#67e8f9', emissive: true },
      { hex: '#1e3a5f', emissive: false },
      { hex: '#bae6fd', emissive: false },
      { hex: '#e0f2fe', emissive: true },
    ],
    behavior: 'piercing',
    status: 'freeze',
    damage: -2,
    fireRate: -0.2,
    spread: 0,
    range: 5,
    ammo: -2,
    cooling: 0,
    mass: 1,
    crater: 0,
  },
  {
    key: 'fire',
    label: 'de Fogo',
    aliases: ['fogo', 'incendiaria', 'flamejante', 'solar', 'lava'],
    tags: ['fire', 'burn'],
    palette: [
      { hex: '#fb923c', emissive: true },
      { hex: '#27272a', emissive: false },
      { hex: '#71717a', emissive: false },
      { hex: '#facc15', emissive: true },
    ],
    behavior: 'standard',
    status: 'burn',
    damage: 4,
    fireRate: -0.2,
    spread: 0,
    range: 0,
    ammo: -2,
    cooling: -1,
    mass: 1,
    crater: 1,
  },
  {
    key: 'toxic',
    label: 'de Ácido',
    aliases: ['toxica', 'venenosa', 'acida', 'radioativa'],
    tags: ['toxic', 'burn'],
    palette: [
      { hex: '#4ade80', emissive: true },
      { hex: '#1f2937', emissive: false },
      { hex: '#3f6212', emissive: false },
      { hex: '#a3e635', emissive: true },
    ],
    behavior: 'sticky_bomb',
    status: 'burn',
    damage: 1,
    fireRate: 0.2,
    spread: 1,
    range: 0,
    ammo: -4,
    cooling: 0,
    mass: 1,
    crater: 1,
  },
  {
    key: 'void',
    label: 'do Vazio',
    aliases: ['vazio', 'gravitacional', 'sombria', 'arcana', 'nebulosa'],
    tags: ['void', 'gravity_pull'],
    palette: [
      { hex: '#c084fc', emissive: true },
      { hex: '#1e1b4b', emissive: false },
      { hex: '#4c1d95', emissive: false },
      { hex: '#f472b6', emissive: true },
    ],
    behavior: 'homing_weak',
    status: 'gravity_pull',
    damage: 2,
    fireRate: -0.3,
    spread: 1,
    range: 10,
    ammo: 0,
    cooling: 0,
    mass: 2,
    crater: 1,
  },
  {
    key: 'electric',
    label: 'de Choque',
    aliases: ['eletrica', 'choque', 'tesla', 'sônica', 'sonica'],
    tags: ['electric', 'knockback'],
    palette: [
      { hex: '#facc15', emissive: true },
      { hex: '#1e293b', emissive: false },
      { hex: '#38bdf8', emissive: false },
      { hex: '#fef08a', emissive: true },
    ],
    behavior: 'bouncing',
    status: 'knockback',
    damage: -1,
    fireRate: 0.6,
    spread: 2,
    range: 5,
    ammo: 2,
    cooling: 1,
    mass: -1,
    crater: 0,
  },
];

interface EventDef {
  key: string;
  label: string;
  aliases: string[];
  category: 'weather' | 'terrain' | 'entity' | 'supply';
  archetype: EventArchetype;
  tags: string[];
  params: Partial<EventParams>;
  palette: PaletteColor[];
  entityKind?: 'creature' | 'supply_crate';
}

const EVENTS: EventDef[] = [
  {
    key: 'meteor_shower',
    label: 'Chuva de meteoros',
    aliases: ['chuva de meteoros', 'meteoros', 'meteorito', 'chuva flamejante'],
    category: 'weather',
    archetype: 'WEATHER_HAZARD',
    tags: ['weather', 'meteor_shower'],
    params: { radiusMeters: 26, durationSec: 34, lethality: 24, quantity: 3, weatherKind: 'meteor_shower' },
    palette: [
      { hex: '#f97316', emissive: true },
      { hex: '#3f3f46', emissive: false },
      { hex: '#facc15', emissive: true },
    ],
  },
  {
    key: 'blizzard',
    label: 'Nevasca congelante',
    aliases: ['nevasca', 'neve', 'tempestade de gelo', 'congelante'],
    category: 'weather',
    archetype: 'WEATHER_HAZARD',
    tags: ['weather', 'blizzard'],
    params: { radiusMeters: 28, durationSec: 36, lethality: 18, quantity: 2, weatherKind: 'blizzard' },
    palette: [
      { hex: '#67e8f9', emissive: true },
      { hex: '#1e3a5f', emissive: false },
      { hex: '#e0f2fe', emissive: false },
    ],
  },
  {
    key: 'acid_rain',
    label: 'Chuva ácida',
    aliases: ['chuva acida', 'acido', 'chuva toxica', 'corrosao'],
    category: 'weather',
    archetype: 'WEATHER_HAZARD',
    tags: ['weather', 'acid_rain'],
    params: { radiusMeters: 27, durationSec: 32, lethality: 20, quantity: 2, weatherKind: 'acid_rain' },
    palette: [
      { hex: '#4ade80', emissive: true },
      { hex: '#1f2937', emissive: false },
      { hex: '#a3e635', emissive: false },
    ],
  },
  {
    key: 'earthquake',
    label: 'Terremoto',
    aliases: ['terremoto', 'tremor', 'sismo', 'abalos'],
    category: 'weather',
    archetype: 'WEATHER_HAZARD',
    tags: ['weather', 'earthquake'],
    params: { radiusMeters: 30, durationSec: 28, lethality: 22, quantity: 2, weatherKind: 'earthquake' },
    palette: [
      { hex: '#a16207', emissive: false },
      { hex: '#3f3f46', emissive: false },
      { hex: '#facc15', emissive: true },
    ],
  },
  {
    key: 'low_gravity',
    label: 'Gravidade baixa',
    aliases: ['gravidade baixa', 'baixa gravidade', 'lua', 'flutuar'],
    category: 'weather',
    archetype: 'WEATHER_HAZARD',
    tags: ['weather', 'low_gravity'],
    params: { radiusMeters: 34, durationSec: 40, lethality: 8, quantity: 1, weatherKind: 'low_gravity' },
    palette: [
      { hex: '#c084fc', emissive: true },
      { hex: '#1e1b4b', emissive: false },
      { hex: '#f472b6', emissive: false },
    ],
  },
  {
    key: 'volcano',
    label: 'Erupção vulcânica',
    aliases: ['vulcao', 'erupcao', 'lava', 'vulcanico'],
    category: 'terrain',
    archetype: 'TERRAIN_MUTATION',
    tags: ['terrain', 'volcano'],
    params: { radiusMeters: 30, durationSec: 26, lethality: 22, quantity: 2, mutationKind: 'volcano' },
    palette: [
      { hex: '#fb923c', emissive: true },
      { hex: '#27272a', emissive: false },
      { hex: '#facc15', emissive: true },
    ],
  },
  {
    key: 'fissure',
    label: 'Fissura no terreno',
    aliases: ['fissura', 'racha', 'abismo', 'rachadura'],
    category: 'terrain',
    archetype: 'TERRAIN_MUTATION',
    tags: ['terrain', 'fissure'],
    params: { radiusMeters: 28, durationSec: 24, lethality: 18, quantity: 2, mutationKind: 'fissure' },
    palette: [
      { hex: '#71717a', emissive: false },
      { hex: '#18181b', emissive: false },
      { hex: '#f97316', emissive: true },
    ],
  },
  {
    key: 'crystal_spires',
    label: 'Pilares de cristal',
    aliases: ['pilares de cristal', 'cristais', 'montanhas de cristal', 'spires'],
    category: 'terrain',
    archetype: 'TERRAIN_MUTATION',
    tags: ['terrain', 'crystal_spires'],
    params: { radiusMeters: 26, durationSec: 24, lethality: 16, quantity: 2, mutationKind: 'crystal_spires' },
    palette: [
      { hex: '#38bdf8', emissive: true },
      { hex: '#1e293b', emissive: false },
      { hex: '#a855f7', emissive: true },
    ],
  },
  {
    key: 'rising_tide',
    label: 'Maré crescente',
    aliases: ['mare crescente', 'enchente', 'tsunami', 'inundacao'],
    category: 'terrain',
    archetype: 'TERRAIN_MUTATION',
    tags: ['terrain', 'rising_tide'],
    params: { radiusMeters: 32, durationSec: 30, lethality: 14, quantity: 2, mutationKind: 'rising_tide' },
    palette: [
      { hex: '#22d3ee', emissive: true },
      { hex: '#0f172a', emissive: false },
      { hex: '#e2e8f0', emissive: false },
    ],
  },
  {
    key: 'aggressive_nearest',
    label: 'Matilha agressiva',
    aliases: ['matilha de lobos', 'lobos', 'zumbis', 'criaturas agressivas', 'monstros'],
    category: 'entity',
    archetype: 'ENTITY_SPAWN',
    tags: ['entity', 'aggressive_nearest'],
    params: { radiusMeters: 24, durationSec: 36, lethality: 20, quantity: 5, aiBehavior: 'aggressive_nearest' },
    palette: [
      { hex: '#ef4444', emissive: true },
      { hex: '#3f3f46', emissive: false },
      { hex: '#a1a1aa', emissive: false },
    ],
    entityKind: 'creature',
  },
  {
    key: 'territorial',
    label: 'Golem territorial',
    aliases: ['golem', 'guarda territorial', 'torre viva', 'colosso'],
    category: 'entity',
    archetype: 'ENTITY_SPAWN',
    tags: ['entity', 'territorial'],
    params: { radiusMeters: 22, durationSec: 40, lethality: 24, quantity: 3, aiBehavior: 'territorial' },
    palette: [
      { hex: '#a16207', emissive: false },
      { hex: '#3f3f46', emissive: false },
      { hex: '#facc15', emissive: true },
    ],
    entityKind: 'creature',
  },
  {
    key: 'fleeing',
    label: 'Criaturas fugitivas',
    aliases: ['criaturas fugitivas', 'coelhos', 'animais pasivos', 'fugir'],
    category: 'entity',
    archetype: 'ENTITY_SPAWN',
    tags: ['entity', 'fleeing'],
    params: { radiusMeters: 26, durationSec: 30, lethality: 8, quantity: 6, aiBehavior: 'fleeing' },
    palette: [
      { hex: '#4ade80', emissive: false },
      { hex: '#1f2937', emissive: false },
      { hex: '#e2e8f0', emissive: false },
    ],
    entityKind: 'creature',
  },
  {
    key: 'explosive_kamikaze',
    label: 'Enxame kamikaze',
    aliases: ['enxame kamikaze', 'kamikaze', 'drones explosivos', 'bombas vivas'],
    category: 'entity',
    archetype: 'ENTITY_SPAWN',
    tags: ['entity', 'explosive_kamikaze'],
    params: { radiusMeters: 24, durationSec: 28, lethality: 26, quantity: 5, aiBehavior: 'explosive_kamikaze' },
    palette: [
      { hex: '#f97316', emissive: true },
      { hex: '#18181b', emissive: false },
      { hex: '#ef4444', emissive: true },
    ],
    entityKind: 'creature',
  },
  {
    key: 'supply',
    label: 'Caixa de suprimentos',
    aliases: ['caixa de municao', 'suprimentos', 'municao', 'tesouro', 'kit de cura'],
    category: 'supply',
    archetype: 'SUPPLY_DROP',
    tags: ['supply'],
    params: { radiusMeters: 18, durationSec: 28, lethality: 5, quantity: 4, ammoRestore: 30 },
    palette: [
      { hex: '#f59e0b', emissive: false },
      { hex: '#334155', emissive: false },
      { hex: '#22d3ee', emissive: true },
    ],
    entityKind: 'supply_crate',
  },
  {
    key: 'sandstorm',
    label: 'Tempestade de areia',
    aliases: ['tempestade de areia', 'areia', 'deserto', 'siroco', 'poeira'],
    category: 'weather',
    archetype: 'WEATHER_HAZARD',
    tags: ['weather', 'sandstorm'],
    params: { radiusMeters: 30, durationSec: 34, lethality: 14, quantity: 2, weatherKind: 'sandstorm' },
    palette: [
      { hex: '#e7cb92', emissive: false },
      { hex: '#b45309', emissive: false },
      { hex: '#fde68a', emissive: true },
    ],
  },
  {
    key: 'thunderstorm',
    label: 'Tempestade de raios',
    aliases: ['tempestade de raios', 'trovoada', 'relampagos', 'raios', 'tempestade eletrica'],
    category: 'weather',
    archetype: 'WEATHER_HAZARD',
    tags: ['weather', 'thunderstorm'],
    params: { radiusMeters: 32, durationSec: 30, lethality: 26, quantity: 3, weatherKind: 'thunderstorm' },
    palette: [
      { hex: '#facc15', emissive: true },
      { hex: '#1e293b', emissive: false },
      { hex: '#93c5fd', emissive: true },
    ],
  },
  {
    key: 'hail',
    label: 'Tempestade de granizo',
    aliases: ['tempestade de granizo', 'granizo', 'chuva de gelo', 'pedras de gelo'],
    category: 'weather',
    archetype: 'WEATHER_HAZARD',
    tags: ['weather', 'hail'],
    params: { radiusMeters: 26, durationSec: 32, lethality: 18, quantity: 3, weatherKind: 'hail' },
    palette: [
      { hex: '#bae6fd', emissive: true },
      { hex: '#1e3a5f', emissive: false },
      { hex: '#e0f2fe', emissive: false },
    ],
  },
  {
    key: 'tornado',
    label: 'Tornado',
    aliases: ['tornado', 'ciclone', 'furacao', 'redemoinho', 'vortice'],
    category: 'weather',
    archetype: 'WEATHER_HAZARD',
    tags: ['weather', 'tornado'],
    params: { radiusMeters: 26, durationSec: 30, lethality: 20, quantity: 1, weatherKind: 'tornado' },
    palette: [
      { hex: '#cbd5e1', emissive: false },
      { hex: '#475569', emissive: false },
      { hex: '#f1f5f9', emissive: true },
    ],
  },
  {
    key: 'sinkhole',
    label: 'Sorvedouro',
    aliases: ['sorvedouro', 'sumidouro', 'buraco enorme', 'cratera gigante'],
    category: 'terrain',
    archetype: 'TERRAIN_MUTATION',
    tags: ['terrain', 'sinkhole'],
    params: { radiusMeters: 24, durationSec: 24, lethality: 18, quantity: 2, mutationKind: 'sinkhole' },
    palette: [
      { hex: '#71717a', emissive: false },
      { hex: '#18181b', emissive: false },
      { hex: '#a1a1aa', emissive: false },
    ],
  },
  {
    key: 'lava_river',
    label: 'Rio de lava',
    aliases: ['rio de lava', 'rio de magma', 'corrente de lava', 'rio de fogo'],
    category: 'terrain',
    archetype: 'TERRAIN_MUTATION',
    tags: ['terrain', 'lava_river'],
    params: { radiusMeters: 28, durationSec: 26, lethality: 22, quantity: 2, mutationKind: 'lava_river' },
    palette: [
      { hex: '#fb923c', emissive: true },
      { hex: '#27272a', emissive: false },
      { hex: '#facc15', emissive: true },
    ],
  },
  {
    key: 'glacier',
    label: 'Geleira',
    aliases: ['geleira', 'glaciar', 'era do gelo', 'banquisa'],
    category: 'terrain',
    archetype: 'TERRAIN_MUTATION',
    tags: ['terrain', 'glacier'],
    params: { radiusMeters: 26, durationSec: 26, lethality: 16, quantity: 2, mutationKind: 'glacier' },
    palette: [
      { hex: '#bae6fd', emissive: true },
      { hex: '#1e3a5f', emissive: false },
      { hex: '#e0f2fe', emissive: false },
    ],
  },
  {
    key: 'overgrowth',
    label: 'Floresta voraz',
    aliases: ['floresta voraz', 'vegetacao densa', 'selva', 'crescimento selvagem'],
    category: 'terrain',
    archetype: 'TERRAIN_MUTATION',
    tags: ['terrain', 'overgrowth'],
    params: { radiusMeters: 26, durationSec: 28, lethality: 14, quantity: 2, mutationKind: 'overgrowth' },
    palette: [
      { hex: '#4ade80', emissive: false },
      { hex: '#14532d', emissive: false },
      { hex: '#a3e635', emissive: false },
    ],
  },
  {
    key: 'spider_swarm',
    label: 'Enxame de aranhas',
    aliases: ['enxame de aranhas', 'aranhas', 'aranhas gigantes', 'aracnideos'],
    category: 'entity',
    archetype: 'ENTITY_SPAWN',
    tags: ['entity', 'spider_swarm'],
    params: { radiusMeters: 24, durationSec: 34, lethality: 16, quantity: 7, aiBehavior: 'aggressive_nearest' },
    palette: [
      { hex: '#a3e635', emissive: true },
      { hex: '#1f2937', emissive: false },
      { hex: '#4d7c0f', emissive: false },
    ],
    entityKind: 'creature',
  },
  {
    key: 'hunter_drones',
    label: 'Drones caçadores',
    aliases: ['drones cacadores', 'drones', 'robos voadores', 'enxame de drones'],
    category: 'entity',
    archetype: 'ENTITY_SPAWN',
    tags: ['entity', 'hunter_drones'],
    params: { radiusMeters: 26, durationSec: 30, lethality: 18, quantity: 6, aiBehavior: 'explosive_kamikaze' },
    palette: [
      { hex: '#38bdf8', emissive: true },
      { hex: '#1e293b', emissive: false },
      { hex: '#ef4444', emissive: true },
    ],
    entityKind: 'creature',
  },
  {
    key: 'ice_colossus',
    label: 'Colosso de Gelo',
    aliases: ['colosso de gelo', 'gigante de gelo', 'golens de gelo', 'sentinela de gelo'],
    category: 'entity',
    archetype: 'ENTITY_SPAWN',
    tags: ['entity', 'ice_colossus'],
    params: { radiusMeters: 22, durationSec: 40, lethality: 24, quantity: 3, aiBehavior: 'territorial' },
    palette: [
      { hex: '#bae6fd', emissive: true },
      { hex: '#1e3a5f', emissive: false },
      { hex: '#e0f2fe', emissive: true },
    ],
    entityKind: 'creature',
  },
  {
    key: 'venom_serpents',
    label: 'Serpentes venenosas',
    aliases: ['serpentes venenosas', 'cobras', 'serpentes', 'vipers'],
    category: 'entity',
    archetype: 'ENTITY_SPAWN',
    tags: ['entity', 'venom_serpents'],
    params: { radiusMeters: 24, durationSec: 32, lethality: 18, quantity: 6, aiBehavior: 'aggressive_nearest' },
    palette: [
      { hex: '#4ade80', emissive: true },
      { hex: '#14532d', emissive: false },
      { hex: '#a3e635', emissive: false },
    ],
    entityKind: 'creature',
  },
  {
    key: 'ammo_depot',
    label: 'Depósito de munição',
    aliases: ['deposito de municao', 'carga de municao', 'municao pesada', 'arsenal movel'],
    category: 'supply',
    archetype: 'SUPPLY_DROP',
    tags: ['supply', 'ammo_depot'],
    params: { radiusMeters: 20, durationSec: 30, lethality: 5, quantity: 5, ammoRestore: 45 },
    palette: [
      { hex: '#f59e0b', emissive: false },
      { hex: '#27272a', emissive: false },
      { hex: '#facc15', emissive: true },
    ],
    entityKind: 'supply_crate',
  },
  {
    key: 'elite_supply',
    label: 'Suprimentos de elite',
    aliases: ['suprimentos de elite', 'suprimento raro', 'carga rara', 'drop lendario'],
    category: 'supply',
    archetype: 'SUPPLY_DROP',
    tags: ['supply', 'elite_supply'],
    params: { radiusMeters: 18, durationSec: 28, lethality: 5, quantity: 4, ammoRestore: 55 },
    palette: [
      { hex: '#c084fc', emissive: true },
      { hex: '#1e1b4b', emissive: false },
      { hex: '#facc15', emissive: true },
    ],
    entityKind: 'supply_crate',
  },
  {
    key: 'treasure_cache',
    label: 'Cache do tesouro',
    aliases: ['cache do tesouro', 'cofre', 'bau do tesouro', 'tesouro escondido'],
    category: 'supply',
    archetype: 'SUPPLY_DROP',
    tags: ['supply', 'treasure_cache'],
    params: { radiusMeters: 22, durationSec: 26, lethality: 6, quantity: 3, ammoRestore: 50 },
    palette: [
      { hex: '#facc15', emissive: true },
      { hex: '#78350f', emissive: false },
      { hex: '#fde68a', emissive: true },
    ],
    entityKind: 'supply_crate',
  },
  {
    key: 'emergency_cache',
    label: 'Caixa de emergência',
    aliases: ['caixa de emergencia', 'kit de emergencia', 'suprimento de emergencia', 'resgate'],
    category: 'supply',
    archetype: 'SUPPLY_DROP',
    tags: ['supply', 'emergency_cache'],
    params: { radiusMeters: 18, durationSec: 24, lethality: 5, quantity: 3, ammoRestore: 35 },
    palette: [
      { hex: '#ef4444', emissive: true },
      { hex: '#334155', emissive: false },
      { hex: '#f8fafc', emissive: true },
    ],
    entityKind: 'supply_crate',
  },
];

function unique(values: string[]): string[] {
  return Array.from(new Set(values.map((v) => v.trim()).filter(Boolean)));
}

function buildWeapons(): CatalogWeaponItem[] {
  const weapons = [];
  for (const archetype of ARCHETYPES) {
    for (const element of ELEMENTS) {
      const name = `${archetype.label} ${element.label}`;
      const prompt = name;
      const stats: WeaponStats = {
        damage: archetype.stats.damage + element.damage,
        fireRate: Math.round((archetype.stats.fireRate + element.fireRate) * 10) / 10,
        projectiles: archetype.stats.projectiles,
        spreadDeg: archetype.stats.spreadDeg + element.spread,
        rangeMeters: archetype.stats.rangeMeters + element.range,
        ammoMax: archetype.stats.ammoMax + element.ammo,
        cooling: archetype.stats.cooling + element.cooling,
        massKg: archetype.stats.massKg + element.mass,
      };
      const crater = Math.max(0, Math.min(4, archetype.crater + element.crater));
      const blueprint = validateAndClampWeapon(
        {
          name,
          stats,
          modifiers: {
            voxelCraterRadius: crater,
            projectileBehavior: element.behavior,
            statusEffect: element.status,
          },
          selfRisk: archetype.selfRisk as SelfRiskFlag[],
          palette: element.palette,
          rleVoxels: encodeRleVoxels(buildFallbackWeaponVoxels(prompt, element.palette.length)),
          gripPos: [6, 3, 6],
          muzzlePos: [6, 7, 22],
        },
        prompt,
      );
      const elementAliases =
        element.key === 'standard'
          ? archetype.aliases.map((a) => `${a} ${element.aliases[0]}`)
          : [
              ...archetype.aliases.map((a) => `${a} ${element.label.toLowerCase()}`),
              ...element.aliases.map((e) => `${archetype.aliases[0]} de ${e}`),
            ];
      const aliases = unique([
        name,
        archetype.label,
        ...elementAliases,
      ]);
      weapons.push({
        id: `wpn_${archetype.key}_${element.key}`,
        name,
        tags: unique(['weapon', archetype.key, element.key, ...element.tags]),
        aliases,
        assets: [
          `texture:weapon:${element.key}`,
          `sfx:weapon:${element.key}`,
          `fx:weapon:${element.key}`,
          'sfx:forge',
        ],
        status: 'approved' as const,
        provenance: 'procedural' as const,
        payload: {
          ...blueprint,
          id: `wpn_${archetype.key}_${element.key}`,
          prompt,
        },
      });
    }
  }
  return weapons;
}

function buildEvents(): CatalogEventItem[] {
  const events = [];
  for (const def of EVENTS) {
    const prompt = def.label;
    const { params, budgetUsed, wasClamped } = validateAndClampEventParams(
      def.archetype,
      def.params,
      prompt,
    );
    let entityBlueprint: EntityBlueprint | undefined;
    if (def.entityKind) {
      entityBlueprint = {
        name: def.label,
        palette: def.palette,
        rleVoxels: encodeRleVoxels(
          buildFallbackEntityVoxels(def.entityKind, def.palette.length, prompt),
        ),
      };
    }
    const aliases = unique([def.label, ...def.aliases]);
    events.push({
      id: `evt_${def.category}_${def.key}`,
      name: def.label,
      tags: unique(['event', def.category, def.key]),
      aliases,
      assets: [
        `texture:event:${def.category}`,
        `sfx:event:${def.category}`,
        `fx:event:${def.category}`,
        'waypoint:event',
      ],
      status: 'approved' as const,
      provenance: 'procedural' as const,
      payload: {
        archetype: def.archetype,
        params,
        entityBlueprint,
        budgetUsed,
        wasClamped,
      },
    });
  }
  return events;
}

const generatedWeapons = buildWeapons();
const generatedEvents = buildEvents();
const { catalog, keptWeapons, keptEvents } = mergeCatalog(
  existingCatalog,
  generatedWeapons,
  generatedEvents,
  CATALOG_VERSION,
);
const { weapons, events } = catalog;

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(OUT_FILE, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');
const artifacts = writeCatalogArtifacts(catalog, OUT_DIR);

const clampedWeapons = weapons.filter((w) => w.payload.wasClamped);
const clampedEvents = events.filter((e) => e.payload.wasClamped);
console.log(`Catálogo ${CATALOG_VERSION}: ${weapons.length} armas, ${events.length} eventos`);
console.log(
  `Índice/sharding: ${artifacts.indexPath} (${artifacts.shardCount} shards)`,
);
console.log(`Itens preservados fora da base: ${keptWeapons.length} armas, ${keptEvents.length} eventos`);
console.log(`Armas com clamp: ${clampedWeapons.length}`, clampedWeapons.map((w) => `${w.id}:${w.payload.budgetUsed}`));
console.log(`Eventos com clamp: ${clampedEvents.length}`, clampedEvents.map((e) => `${e.id}:${e.payload.budgetUsed}`));
console.log(`Maior orçamento de arma: ${Math.max(...weapons.map((w) => w.payload.budgetUsed))}`);
console.log(`Maior orçamento de evento: ${Math.max(...events.map((e) => e.payload.budgetUsed))}`);
