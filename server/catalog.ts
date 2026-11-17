import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCanonicalKey, normalizePrompt } from '../src/shared/prompt.ts';
import { computeEventPoints, validateAndClampWeapon } from '../src/shared/budget.ts';
import type {
  DevCatalogPayload,
  EntityBlueprint,
  EventArchetype,
  EventFunContract,
  EventParams,
  MapEventComponent,
  MapEventState,
  ProjectileBehavior,
  StatusEffect,
  WeaponBlueprint,
} from '../src/shared/types.ts';
import { deriveEventFunContract } from '../src/shared/eventFun.ts';
import {
  validateCatalogIndex,
  type CatalogEventIndexEntry,
  type CatalogEventIndexSummary,
  type CatalogIndexFile,
  type CatalogWeaponIndexEntry,
  type CatalogWeaponIndexSummary,
} from './catalogArtifacts.ts';

export type CatalogItemStatus = 'approved' | 'deprecated';
export type CatalogProvenance =
  | 'authored'
  | 'ai_assisted'
  | 'procedural'
  | 'template'
  | 'seed';
export type CatalogResolutionStrategy =
  | 'alias'
  | 'canonical'
  | 'tags'
  | 'composition'
  | 'partial'
  /** Legado: o resolvedor não emite mais `default`; mantido para linhas antigas do ledger. */
  | 'default';

export interface CatalogItemMeta {
  status?: CatalogItemStatus;
  provenance?: CatalogProvenance;
  introducedIn?: string;
}

export interface CatalogWeaponItem extends CatalogItemMeta {
  id: string;
  name: string;
  tags: string[];
  aliases: string[];
  assets: string[];
  /** Presente quando o item veio do índice compacto. */
  summary?: CatalogWeaponIndexSummary;
  payload: WeaponBlueprint;
}

export interface CatalogEventPayload {
  archetype: EventArchetype;
  params: EventParams;
  entityBlueprint?: EntityBlueprint;
  fun?: EventFunContract;
  budgetUsed: number;
  wasClamped: boolean;
}

export interface CatalogEventItem extends CatalogItemMeta {
  id: string;
  name: string;
  tags: string[];
  aliases: string[];
  assets: string[];
  /** Presente quando o item veio do índice compacto. */
  summary?: CatalogEventIndexSummary;
  payload: CatalogEventPayload;
}

export interface CatalogFile {
  schemaVersion?: number;
  version: string;
  weapons: CatalogWeaponItem[];
  events: CatalogEventItem[];
}

export interface WeaponResolution {
  blueprint: WeaponBlueprint;
  itemId: string;
  strategy: CatalogResolutionStrategy;
  score: number;
  poolMiss?: boolean;
  fullItemId?: string;
}

export interface EventResolution {
  event: MapEventState;
  itemId: string;
  strategy: CatalogResolutionStrategy;
  score: number;
  poolMiss?: boolean;
  fullItemId?: string;
}

export interface ResolutionOptions {
  allowedIds?: readonly string[];
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CATALOG_DIR = path.resolve(__dirname, '..', 'content', 'catalog');
const CATALOG_PATH = path.join(CATALOG_DIR, 'catalog.json');
const CATALOG_INDEX_PATH = path.join(CATALOG_DIR, 'index.json');
const CATALOG_SHARD_DIR = path.join(CATALOG_DIR, 'shards');
/** Shards mantidos em memória; cada um é imutável e content-addressed. */
const SHARD_CACHE_MAX = 8;
/** Itens-núcleo históricos (assets/core e relatórios antigos); não são mais fallback. */
export const DEFAULT_WEAPON_ID = 'wpn_rifle_standard';
export const DEFAULT_EVENT_ID = 'evt_weather_meteor_shower';const GENERIC_TAGS = new Set(['weapon', 'event', 'weather', 'terrain', 'entity']);
// Evita falsa cobertura: token overlap fraco não conta como match de catálogo.
const MIN_COVER_SCORE = 60;
// Abaixo disto o match existe, mas é ambíguo: registra como lacuna parcial.
const CONFIDENT_COVER_SCORE = 120;
const COVERED_STRATEGIES = new Set<CatalogResolutionStrategy>([
  'alias',
  'canonical',
  'tags',
  'composition',
]);
const WEAPON_ELEMENT_TAGS = ['standard', 'ice', 'fire', 'toxic', 'void', 'electric'];
const EVENT_CATEGORY_TAGS = ['weather', 'terrain', 'entity', 'supply'];
const NEGATION_RX = /\b(sem|nao|nunca|exceto|menos|evite|evitar)\b/;
const AMBIGUITY_GROUPS = {
  weapon: ['ice', 'fire', 'toxic', 'void', 'electric'],
  event: ['weather', 'terrain', 'entity', 'supply'],
} as const;

const WEAPON_TAG_WORDS: Record<string, string[]> = {
  pistol: ['pistola', 'pistol', 'revolver'],
  rifle: ['rifle', 'fuzil', 'carabina'],
  smg: ['smg', 'submetralhadora', 'metralhadora', 'metralha', 'rajada'],
  shotgun: ['escopeta', 'espingarda', 'shotgun', 'cartucho', 'dispersao', 'estilha'],
  sniper: ['sniper', 'franco', 'precisao', 'laser', 'feixe'],
  launcher: ['bazuca', 'lancador', 'canhao', 'missil', 'foguete', 'meteoro', 'explosivo'],
  crossbow: ['besta', 'ballesta', 'crossbow', 'virote'],
  bow: ['arco', 'bow', 'flecha'],
  gatling: ['metralhadora pesada', 'gatling', 'minigun', 'metralha pesada'],
  flamethrower: ['lanca chamas', 'flamethrower', 'jato de fogo', 'queimador', 'maçarico'],
  energy_cannon: ['canhao de energia', 'canhao de plasma', 'canhao de particulas', 'energy cannon'],
  harpoon: ['arpao', 'harpoon', 'arpoadora'],
  mortar: ['morteiro', 'mortar', 'obuseiro', 'lancador de granadas'],
  dual_pistols: ['pistolas duplas', 'pistola dupla', 'dual pistols'],
  railgun: ['canhao de trilho', 'railgun', 'trilho magnetico', 'canhao magnetico'],
  ice: ['gelo', 'congel', 'crio', 'neve', 'frost', 'glacial'],
  fire: ['fogo', 'lava', 'chama', 'incendi', 'solar', 'flamejante', 'explosiv'],
  toxic: ['toxic', 'veneno', 'acido', 'verde', 'radioativ'],
  void: ['vazio', 'gravit', 'buraco negro', 'sombrio', 'roxo', 'arcano', 'nebulosa'],
  electric: ['eletric', 'choque', 'raio', 'tesla', 'trovao', 'sonic'],
};

const WEAPON_CAPABILITY_WORDS: Record<string, string[]> = {
  freeze: ['congel', 'gelo', 'crio', 'neve', 'frost', 'glacial'],
  burn: ['fogo', 'lava', 'chama', 'incendi', 'flamejante', 'acido', 'toxico', 'veneno'],
  gravity_pull: ['vazio', 'gravit', 'buraco negro', 'nebulosa'],
  knockback: ['choque', 'eletric', 'raio', 'tesla', 'trovao', 'sonic', 'sonoro'],
  bouncing: ['ricochete', 'ricocheteia', 'quica', 'quicar', 'bounce'],
  piercing: ['perfur', 'atravessa', 'atravessar', 'penetra'],
  sticky_bomb: ['grudenta', 'grude', 'gruda', 'grudar', 'cola', 'adesiv', 'sticky'],
  homing_weak: ['teleguiad', 'persegue', 'perseguir', 'homing', 'guiado'],
};

type WeaponCapability =
  | 'freeze'
  | 'burn'
  | 'gravity_pull'
  | 'knockback'
  | 'bouncing'
  | 'piercing'
  | 'sticky_bomb'
  | 'homing_weak';

const weaponCapabilityCache = new WeakMap<CatalogWeaponItem, Set<WeaponCapability>>();

const STATUS_CAPABILITIES = new Set<WeaponCapability>([
  'freeze',
  'burn',
  'gravity_pull',
  'knockback',
]);

function requestedWeaponCapabilities(promptNorm: string): Set<WeaponCapability> {
  const requested = new Set<WeaponCapability>();
  for (const [capability, words] of Object.entries(WEAPON_CAPABILITY_WORDS)) {
    if (words.some((word) => promptNorm.includes(word))) {
      requested.add(capability as WeaponCapability);
    }
  }
  return requested;
}

function weaponCapabilitiesOf(item: CatalogWeaponItem): Set<WeaponCapability> {
  const cached = weaponCapabilityCache.get(item);
  if (cached) return cached;
  const caps = new Set<WeaponCapability>();
  if (item.payload.modifiers.statusEffect !== 'none') {
    caps.add(item.payload.modifiers.statusEffect as WeaponCapability);
  }
  if (item.payload.modifiers.projectileBehavior !== 'standard') {
    caps.add(item.payload.modifiers.projectileBehavior as WeaponCapability);
  }
  weaponCapabilityCache.set(item, caps);
  return caps;
}

function findCapabilityDonor(
  weapons: CatalogWeaponItem[],
  capability: WeaponCapability,
): CatalogWeaponItem | undefined {
  return weapons.find((item) => weaponCapabilitiesOf(item).has(capability));
}

/**
 * Compõe uma variação segura a partir de um item-base e de capacidades que já
 * existem em outro item do catálogo. Se o resultado estourar o orçamento ou
 * precisar de clamp, a composição é descartada e o prompt vira `partial`.
 */
function composeWeapon(
  base: CatalogWeaponItem,
  missing: WeaponCapability[],
  prompt: string,
  activeWeapons: CatalogWeaponItem[],
): WeaponBlueprint | null {
  const composed = cloneWeapon(base, prompt);
  let applied = false;
  for (const capability of missing) {
    const donor = findCapabilityDonor(activeWeapons, capability);
    if (!donor) continue;
    if (STATUS_CAPABILITIES.has(capability)) {
      composed.modifiers.statusEffect = capability as StatusEffect;
    } else {
      composed.modifiers.projectileBehavior = capability as ProjectileBehavior;
    }
    applied = true;
  }
  if (!applied) return null;

  composed.name = `${base.name} Composta`;
  const validated = validateAndClampWeapon(composed, prompt);
  if (validated.wasClamped || validated.budgetUsed > 100) return null;

  return {
    ...validated,
    catalogId: base.id,
    assets: [...base.assets],
    fromDatabase: false,
    fromCatalog: true,
    composed: true,
  };
}


const EVENT_TAG_WORDS: Record<string, string[]> = {
  acid_rain: ['acid', 'chuva acida', 'toxic'],
  blizzard: ['nevasca', 'neve', 'gelo', 'frio', 'congel'],
  meteor_shower: ['meteoro', 'meteorito', 'chuva de meteoros', 'flamejante'],
  low_gravity: ['gravidade', 'lua', 'flutuar', 'peso'],
  earthquake: ['terremoto', 'tremor', 'abal', 'sismo'],
  sandstorm: ['areia', 'deserto', 'siroco', 'poeira'],
  thunderstorm: ['raio', 'trovoada', 'relampago', 'tempestade eletrica'],
  hail: ['granizo', 'pedra de gelo', 'chuva de gelo'],
  tornado: ['tornado', 'ciclone', 'furacao', 'redemoinho', 'vortice'],
  volcano: ['vulc', 'lava', 'erupcao'],
  fissure: ['fissura', 'racha', 'abismo'],
  crystal_spires: ['cristal', 'pilar', 'montanha'],
  rising_tide: ['mare', 'enchente', 'agua', 'tsunami', 'inundacao'],
  sinkhole: ['sorvedouro', 'sumidouro', 'buraco enorme', 'cratera gigante'],
  lava_river: ['rio de lava', 'rio de magma', 'corrente de lava', 'rio de fogo'],
  glacier: ['geleira', 'glaciar', 'era do gelo', 'banquisa'],
  overgrowth: ['floresta', 'selva', 'vegetacao', 'crescimento'],
  aggressive_nearest: ['lobo', 'matilha', 'agressivo', 'zumbi', 'monstro', 'criatura'],
  territorial: ['guardi', 'territorio', 'torre', 'golem'],
  fleeing: ['foge', 'fugir', 'pasivo', 'coelho'],
  explosive_kamikaze: ['kamikaze', 'explosivo', 'bomba'],
  spider_swarm: ['aranha', 'aracnideo', 'enxame de aranhas'],
  hunter_drones: ['drone', 'robo voador', 'enxame de drones'],
  ice_colossus: ['colosso', 'gigante de gelo', 'sentinela de gelo'],
  venom_serpents: ['serpente', 'cobra', 'viper', 'venenosa'],
  supply: ['municao', 'caixa', 'suprimento', 'bala', 'ammo', 'cura', 'kit', 'tesouro'],
  scenery: ['cenario', 'estrutura', 'construcao', 'construir', 'surgir', 'surja', 'surjam', 'erguer'],
  tree: ['arvore', 'arvores', 'floresta', 'bosque'],
  grove: ['arvoredo', 'bosque'],
  house: ['casa', 'cabana', 'chale', 'predio pequeno'],
  tower: ['torre', 'predio', 'edificio'],
  skyscraper: ['arranha ceu', 'arranhaceu', 'edificio gigante', 'arranha-ceu'],
  ruins: ['ruina', 'ruinas', 'templo', 'escombros'],
  ammo_depot: ['deposito de municao', 'carga de municao', 'arsenal movel'],
  elite_supply: ['suprimento raro', 'carga rara', 'drop lendario', 'elite'],
  treasure_cache: ['cofre', 'bau', 'tesouro escondido', 'cache'],
  emergency_cache: ['caixa de emergencia', 'kit de emergencia', 'resgate'],
  weather: ['clima', 'tempo', 'tempestade'],
  terrain: ['terreno', 'chao', 'muta'],
  entity: ['criatura', 'monstro', 'bicho', 'inimigo'],
};

let cachedCatalog: CatalogFile | null = null;
let cachedIndex: CatalogIndexFile | null = null;
let cachedResolverIndex: ResolverIndex | null = null;
/** filename do shard -> payloads por id. LRU simples por ordem de inserção. */
const shardCache = new Map<string, Map<string, unknown>>();
const catalogStats = {
  shardLoads: 0,
  shardHits: 0,
  payloadLoads: 0,
  reloads: 0,
  lastReloadMs: 0,
  resolverCalls: 0,
  resolverPoolCalls: 0,
  resolverFullCalls: 0,
  resolverCandidatesTotal: 0,
  resolverLastCandidates: 0,
  resolverMsTotal: 0,
  resolverLastMs: 0,
  resolverMsMax: 0,
};

function assertCatalogShape(raw: unknown): CatalogFile {
  const data = raw as Partial<CatalogFile> | null;
  if (!data || typeof data.version !== 'string') {
    throw new Error('Catálogo inválido: versão ausente.');
  }
  if (data.schemaVersion !== undefined && data.schemaVersion !== 2 && data.schemaVersion !== 3) {
    throw new Error(`Catálogo inválido: schemaVersion não suportada (${data.schemaVersion}).`);
  }
  if (!Array.isArray(data.weapons) || data.weapons.length === 0) {
    throw new Error('Catálogo inválido: nenhuma arma.');
  }
  if (!Array.isArray(data.events) || data.events.length === 0) {
    throw new Error('Catálogo inválido: nenhum evento.');
  }
  for (const item of [...data.weapons, ...data.events]) {
    if (!item || typeof item.id !== 'string' || typeof item.name !== 'string') {
      throw new Error('Catálogo inválido: item sem id/nome.');
    }
    if (
      !Array.isArray(item.tags) ||
      !Array.isArray(item.aliases) ||
      !Array.isArray(item.assets) ||
      !item.payload
    ) {
      throw new Error(`Catálogo inválido: item ${item.id} incompleto.`);
    }
    if (
      item.status !== undefined &&
      item.status !== 'approved' &&
      item.status !== 'deprecated'
    ) {
      throw new Error(`Catálogo inválido: status desconhecido em ${item.id}.`);
    }
    if (
      item.provenance !== undefined &&
      !['authored', 'ai_assisted', 'procedural', 'template', 'seed'].includes(item.provenance)
    ) {
      throw new Error(`Catálogo inválido: provenance desconhecida em ${item.id}.`);
    }
    if (item.introducedIn !== undefined && typeof item.introducedIn !== 'string') {
      throw new Error(`Catálogo inválido: introducedIn inválido em ${item.id}.`);
    }
  }
  return data as CatalogFile;
}

function loadShard(filename: string): Map<string, unknown> {
  const cached = shardCache.get(filename);
  if (cached) {
    catalogStats.shardHits += 1;
    // Refresh LRU position.
    shardCache.delete(filename);
    shardCache.set(filename, cached);
    return cached;
  }
  const filePath = path.join(CATALOG_SHARD_DIR, filename);
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8')) as {
    items?: unknown;
  } | null;
  if (!raw || typeof raw.items !== 'object' || raw.items === null || Array.isArray(raw.items)) {
    throw new Error(`Shard inválido: ${filename}.`);
  }
  catalogStats.shardLoads += 1;
  const items = new Map(Object.entries(raw.items as Record<string, unknown>));
  shardCache.set(filename, items);
  if (shardCache.size > SHARD_CACHE_MAX) {
    const oldest = shardCache.keys().next().value;
    if (oldest) shardCache.delete(oldest);
  }
  return items;
}

function payloadFromIndex(
  index: CatalogIndexFile,
  entry: { id: string; shard: string },
): unknown {
  const filename = index.shards[entry.shard];
  if (!filename) throw new Error(`Shard ausente no índice: ${entry.shard}.`);
  const payload = loadShard(filename).get(entry.id);
  if (!payload) throw new Error(`Payload ausente no shard: ${entry.id}.`);
  catalogStats.payloadLoads += 1;
  return payload;
}

function buildCatalogFromIndex(index: CatalogIndexFile): CatalogFile {
  const weapons: CatalogWeaponItem[] = index.weapons.map((entry) => ({
    id: entry.id,
    name: entry.name,
    tags: entry.tags,
    aliases: entry.aliases,
    assets: entry.assets,
    status: entry.status,
    provenance: entry.provenance,
    introducedIn: entry.introducedIn,
    summary: entry.summary,
    get payload(): WeaponBlueprint {
      return payloadFromIndex(index, entry as CatalogWeaponIndexEntry) as WeaponBlueprint;
    },
  }));
  const events: CatalogEventItem[] = index.events.map((entry) => ({
    id: entry.id,
    name: entry.name,
    tags: entry.tags,
    aliases: entry.aliases,
    assets: entry.assets,
    status: entry.status,
    provenance: entry.provenance,
    introducedIn: entry.introducedIn,
    summary: entry.summary,
    get payload(): CatalogEventPayload {
      return payloadFromIndex(index, entry as CatalogEventIndexEntry) as CatalogEventPayload;
    },
  }));
  return {
    schemaVersion: index.schemaVersion,
    version: index.version,
    weapons,
    events,
  };
}

function readIndexFromDisk(): CatalogIndexFile {
  const raw = JSON.parse(fs.readFileSync(CATALOG_INDEX_PATH, 'utf8'));
  const index = validateCatalogIndex(raw);
  for (const filename of new Set(Object.values(index.shards))) {
    if (!fs.existsSync(path.join(CATALOG_SHARD_DIR, filename))) {
      throw new Error(`Shard ausente para o índice ${index.version}: ${filename}.`);
    }
  }
  return index;
}

interface LoadedCatalog {
  catalog: CatalogFile;
  index: CatalogIndexFile | null;
}

function loadCatalogFromDisk(): LoadedCatalog {
  if (fs.existsSync(CATALOG_INDEX_PATH)) {
    const index = readIndexFromDisk();
    return { catalog: buildCatalogFromIndex(index), index };
  }
  // Compatibilidade: catálogo completo sem índice (artefato antigo/testes).
  const raw = fs.readFileSync(CATALOG_PATH, 'utf8');
  return { catalog: assertCatalogShape(JSON.parse(raw)), index: null };
}

export function getCatalog(): CatalogFile {
  if (!cachedCatalog) {
    const loaded = loadCatalogFromDisk();
    cachedCatalog = loaded.catalog;
    cachedIndex = loaded.index;
  }
  return cachedCatalog;
}

/** Índice compacto em uso; `null` quando o runtime caiu no catálogo completo. */
export function getCatalogIndex(): CatalogIndexFile | null {
  getCatalog();
  return cachedIndex;
}

export interface CatalogRuntimeStats {
  usingIndex: boolean;
  shardCount: number;
  cachedShards: number;
  shardCacheMax: number;
  shardLoads: number;
  shardHits: number;
  shardHitRate: number;
  payloadLoads: number;
  reloads: number;
  lastReloadMs: number;
}

/** Diagnóstico para métricas/testes; não força o carregamento de payloads. */
export function getCatalogRuntimeStats(): CatalogRuntimeStats {
  getCatalog();
  const totalShardAccess = catalogStats.shardLoads + catalogStats.shardHits;
  return {
    usingIndex: cachedIndex !== null,
    shardCount: cachedIndex ? Object.keys(cachedIndex.shards).length : 0,
    cachedShards: shardCache.size,
    shardCacheMax: SHARD_CACHE_MAX,
    shardLoads: catalogStats.shardLoads,
    shardHits: catalogStats.shardHits,
    shardHitRate:
      totalShardAccess > 0
        ? Math.round((catalogStats.shardHits / totalShardAccess) * 1000) / 1000
        : 0,
    payloadLoads: catalogStats.payloadLoads,
    reloads: catalogStats.reloads,
    lastReloadMs: catalogStats.lastReloadMs,
  };
}

export interface CatalogReloadResult {
  version: string;
  weapons: number;
  events: number;
}

/**
 * Relê o índice do disco e troca o cache de forma atômica. Se o índice ou
 * algum shard estiver inválido, lança e mantém a versão anterior em memória.
 */
export function reloadCatalog(): CatalogReloadResult {
  const startedAt = performance.now();
  const loaded = loadCatalogFromDisk();
  cachedCatalog = loaded.catalog;
  cachedIndex = loaded.index;
  cachedResolverIndex = null;
  shardCache.clear();
  catalogStats.reloads += 1;
  catalogStats.lastReloadMs = Math.round((performance.now() - startedAt) * 100) / 100;
  return {
    version: loaded.catalog.version,
    weapons: loaded.catalog.weapons.length,
    events: loaded.catalog.events.length,
  };
}

let catalogWatcherActive = false;
let watchedCatalogPaths: string[] = [];

export function startCatalogWatcher(pollMs = 1000): void {
  if (catalogWatcherActive) return;
  catalogWatcherActive = true;
  // O índice é o contrato do runtime, mas observar o catálogo completo também
  // cobre o primeiro `catalog:index` em um ambiente que ainda não tinha índice.
  watchedCatalogPaths = [CATALOG_INDEX_PATH, CATALOG_PATH];
  for (const watchedPath of watchedCatalogPaths) {
    fs.watchFile(watchedPath, { interval: pollMs, persistent: false }, (curr, prev) => {
      if (curr.mtimeMs === prev.mtimeMs && curr.size === prev.size) return;
      try {
        const result = reloadCatalog();
        console.log(
          `[Catálogo] recarregado: ${result.version} (${result.weapons} armas, ${result.events} eventos)`,
        );
      } catch (err) {
        console.warn(
          `[Catálogo] recarga ignorada; mantendo a versão anterior: ${(err as Error).message}`,
        );
      }
    });
  }
}

export function stopCatalogWatcher(): void {
  if (!catalogWatcherActive) return;
  for (const watchedPath of watchedCatalogPaths) fs.unwatchFile(watchedPath);
  watchedCatalogPaths = [];
  catalogWatcherActive = false;
}

export function getCatalogVersion(): string {
  return getCatalog().version;
}

export function getActiveWeapons(
  catalog: CatalogFile = getCatalog(),
  allowedIds?: ReadonlySet<string> | null,
): CatalogWeaponItem[] {
  const active = catalog.weapons.filter(
    (item) =>
      item.status !== 'deprecated' && (!allowedIds || allowedIds.has(item.id)),
  );
  if (active.length === 0) throw new Error('Catálogo sem armas aprovadas.');
  return active;
}

export function getActiveEvents(
  catalog: CatalogFile = getCatalog(),
  allowedIds?: ReadonlySet<string> | null,
): CatalogEventItem[] {
  const active = catalog.events.filter(
    (item) =>
      item.status !== 'deprecated' && (!allowedIds || allowedIds.has(item.id)),
  );
  if (active.length === 0) throw new Error('Catálogo sem eventos aprovados.');
  return active;
}

export function getCatalogItem(
  itemId: string,
): { kind: 'weapon' | 'event'; name: string; status: CatalogItemStatus } | null {
  const catalog = getCatalog();
  const weapon = catalog.weapons.find((item) => item.id === itemId);
  if (weapon) {
    return { kind: 'weapon', name: weapon.name, status: weapon.status ?? 'approved' };
  }
  const event = catalog.events.find((item) => item.id === itemId);
  if (event) {
    return { kind: 'event', name: event.name, status: event.status ?? 'approved' };
  }
  return null;
}

export function getCatalogItemName(itemId: string): string | null {
  return getCatalogItem(itemId)?.name ?? null;
}

function getCatalogItemTags(itemId: string): string[] {
  const catalog = getCatalog();
  return (
    [...catalog.weapons, ...catalog.events].find((item) => item.id === itemId)?.tags ?? []
  );
}

function preferredPoolIds(
  allowedIds: ReadonlySet<string>,
  tags: string[],
  kind: 'weapon' | 'event',
): string[] {
  const catalog = getCatalog();
  const preferredTag =
    (kind === 'weapon' ? WEAPON_ELEMENT_TAGS : EVENT_CATEGORY_TAGS).find((tag) =>
      tags.includes(tag),
    ) ?? '';
  if (!preferredTag || (kind === 'weapon' && preferredTag === 'standard')) return [];
  const items = kind === 'weapon' ? catalog.weapons : catalog.events;
  return items
    .filter((item) => allowedIds.has(item.id) && item.tags.includes(preferredTag))
    .map((item) => item.id);
}

export function hasCatalogItem(itemId: string, kind?: 'weapon' | 'event'): boolean {
  const item = getCatalogItem(itemId);
  if (!item || item.status === 'deprecated') return false;
  return kind ? item.kind === kind : true;
}

const TOKEN_STOP_WORDS = new Set([
  'a',
  'as',
  'o',
  'os',
  'um',
  'uma',
  'uns',
  'umas',
  'de',
  'da',
  'do',
  'das',
  'dos',
  'com',
  'sem',
  'para',
  'por',
  'em',
  'no',
  'na',
  'nos',
  'nas',
  'que',
  'e',
  'the',
  'an',
  'of',
  'with',
  'for',
]);

function tokenSet(texts: string[]): Set<string> {
  const tokens = new Set<string>();
  for (const text of texts) {
    const norm = normalizePrompt(text);
    for (const token of norm.split(/\s+/)) {
      if (token.length >= 2 && !TOKEN_STOP_WORDS.has(token)) tokens.add(token);
    }
  }
  return tokens;
}

const EVENT_CATEGORY_WORDS: Record<string, string[]> = {
  weather: [
    'acid_rain',
    'blizzard',
    'meteor_shower',
    'low_gravity',
    'earthquake',
    'sandstorm',
    'thunderstorm',
    'hail',
    'tornado',
    'weather',
  ],
  terrain: [
    'volcano',
    'fissure',
    'crystal_spires',
    'rising_tide',
    'sinkhole',
    'lava_river',
    'glacier',
    'overgrowth',
    'terrain',
    'cenario',
    'estrutura',
    'arvore',
    'predio',
    'torre',
    'casa',
    'ruina',
  ],
  entity: [
    'aggressive_nearest',
    'territorial',
    'fleeing',
    'explosive_kamikaze',
    'spider_swarm',
    'hunter_drones',
    'ice_colossus',
    'venom_serpents',
    'entity',
  ],
  supply: ['supply', 'ammo_depot', 'elite_supply', 'treasure_cache', 'emergency_cache'],
};

function matchesAnyWord(promptNorm: string, keys: string[]): boolean {
  return keys.some((key) =>
    (EVENT_TAG_WORDS[key] ?? []).some((word) => promptNorm.includes(word)),
  );
}

function countIntentGroups(promptNorm: string, kind: 'weapon' | 'event'): number {
  if (kind === 'weapon') {
    let groups = 0;
    for (const group of AMBIGUITY_GROUPS.weapon) {
      if ((WEAPON_TAG_WORDS[group] ?? []).some((word) => promptNorm.includes(word))) {
        groups += 1;
      }
    }
    return groups;
  }
  let groups = 0;
  for (const group of AMBIGUITY_GROUPS.event) {
    if (matchesAnyWord(promptNorm, EVENT_CATEGORY_WORDS[group] ?? [])) groups += 1;
  }
  return groups;
}

type EventCategory = 'weather' | 'terrain' | 'entity' | 'supply';

function requestedEventCategories(promptNorm: string): Set<EventCategory> {
  const categories = new Set<EventCategory>();
  for (const category of AMBIGUITY_GROUPS.event) {
    if (matchesAnyWord(promptNorm, EVENT_CATEGORY_WORDS[category] ?? [])) {
      categories.add(category as EventCategory);
    }
  }
  return categories;
}

function eventCategoryOf(item: CatalogEventItem): EventCategory | null {
  return (
    (AMBIGUITY_GROUPS.event as readonly EventCategory[]).find((category) =>
      item.tags.includes(category),
    ) ?? null
  );
}

function isAmbiguousIntent(promptNorm: string, kind: 'weapon' | 'event'): boolean {
  return NEGATION_RX.test(promptNorm) || countIntentGroups(promptNorm, kind) >= 2;
}

interface ResolverEntry<T extends CatalogWeaponItem | CatalogEventItem> {
  item: T;
  ordinal: number;
  aliasNorms: Set<string>;
  canonicalKeys: Set<string>;
  tokens: Set<string>;
  tagNorms: string[];
  keywordEntries: Array<{ tag: string; words: string[] }>;
  /** Trigramas de nome+aliases+tags+sinônimos; usados só no desempate por proximidade. */
  searchGrams: Set<string>;
}

interface ResolverWordPosting<T extends CatalogWeaponItem | CatalogEventItem> {
  word: string;
  entries: ResolverEntry<T>[];
}

interface ResolverKindIndex<T extends CatalogWeaponItem | CatalogEventItem> {
  entries: ResolverEntry<T>[];
  activeEntries: ResolverEntry<T>[];
  byId: Map<string, ResolverEntry<T>>;
  /** alias normalizado -> itens, em ordem de catálogo. */
  alias: Map<string, ResolverEntry<T>[]>;
  /** chave canônica -> itens, em ordem de catálogo. */
  canonical: Map<string, ResolverEntry<T>[]>;
  /** token de nome/tag/alias -> itens. */
  tokens: Map<string, ResolverEntry<T>[]>;
  /** tag normalizada -> itens (só tags que pontuam). */
  tagWords: ResolverWordPosting<T>[];
  /** palavra-chave de domínio -> itens com a tag correspondente. */
  keywordWords: ResolverWordPosting<T>[];
}

interface ResolverIndex {
  catalog: CatalogFile;
  weapons: ResolverKindIndex<CatalogWeaponItem>;
  events: ResolverKindIndex<CatalogEventItem>;
}

interface ScoredEntry<T extends CatalogWeaponItem | CatalogEventItem> {
  item: T;
  entry: ResolverEntry<T>;
  score: number;
  strategy: CatalogResolutionStrategy;
}

interface CandidateCollection<T extends CatalogWeaponItem | CatalogEventItem> {
  entries: ResolverEntry<T>[];
  exactAliasIds: Set<string>;
  canonicalIds: Set<string>;
}

function pushPosting<T extends CatalogWeaponItem | CatalogEventItem>(
  map: Map<string, ResolverEntry<T>[]>,
  key: string,
  entry: ResolverEntry<T>,
): void {
  const list = map.get(key);
  if (!list) {
    map.set(key, [entry]);
    return;
  }
  if (list[list.length - 1] !== entry) list.push(entry);
}

function addWordPosting<T extends CatalogWeaponItem | CatalogEventItem>(
  map: Map<string, Set<ResolverEntry<T>>>,
  word: string,
  entry: ResolverEntry<T>,
): void {
  const set = map.get(word);
  if (set) {
    set.add(entry);
  } else {
    map.set(word, new Set([entry]));
  }
}

function buildResolverEntries<T extends CatalogWeaponItem | CatalogEventItem>(
  items: T[],
  words: Record<string, string[]>,
): ResolverEntry<T>[] {
  return items.map((item, ordinal) => {
    const aliasNorms = new Set(item.aliases.map((alias) => normalizePrompt(alias)));
    const canonicalKeys = new Set(
      item.aliases
        .map((alias) => buildCanonicalKey(alias))
        .filter((key) => key.length > 0),
    );
    const tokens = tokenSet([item.name, ...item.tags, ...item.aliases]);
    const tagNorms = Array.from(
      new Set(
        item.tags
          .map((tag) => normalizePrompt(tag))
          .filter((tag) => tag.length >= 3 && !GENERIC_TAGS.has(tag)),
      ),
    );
    const keywordEntries = item.tags
      .filter((tag) => !GENERIC_TAGS.has(tag) && (words[tag]?.length ?? 0) > 0)
      .map((tag) => ({
        tag,
        words: words[tag]
          .map((word) => normalizePrompt(word))
          .filter((word) => word.length > 0),
      }));
    const searchText = normalizePrompt(
      [item.name, ...item.aliases, ...item.tags, ...keywordEntries.flatMap((entry) => entry.words)].join(
        ' ',
      ),
    );
    return {
      item,
      ordinal,
      aliasNorms,
      canonicalKeys,
      tokens,
      tagNorms,
      keywordEntries,
      searchGrams: buildTrigrams(searchText),
    };
  });
}

function buildResolverKind<T extends CatalogWeaponItem | CatalogEventItem>(
  items: T[],
  words: Record<string, string[]>,
): ResolverKindIndex<T> {
  const entries = buildResolverEntries(items, words);
  const byId = new Map(entries.map((entry) => [entry.item.id, entry]));
  const alias = new Map<string, ResolverEntry<T>[]>();
  const canonical = new Map<string, ResolverEntry<T>[]>();
  const tokens = new Map<string, ResolverEntry<T>[]>();
  const tagPostings = new Map<string, Set<ResolverEntry<T>>>();
  const keywordPostings = new Map<string, Set<ResolverEntry<T>>>();

  for (const entry of entries) {
    for (const aliasNorm of entry.aliasNorms) pushPosting(alias, aliasNorm, entry);
    for (const key of entry.canonicalKeys) pushPosting(canonical, key, entry);
    for (const token of entry.tokens) pushPosting(tokens, token, entry);
    for (const tagNorm of entry.tagNorms) addWordPosting(tagPostings, tagNorm, entry);
    for (const keywordEntry of entry.keywordEntries) {
      for (const word of keywordEntry.words) addWordPosting(keywordPostings, word, entry);
    }
  }

  return {
    entries,
    activeEntries: entries.filter((entry) => entry.item.status !== 'deprecated'),
    byId,
    alias,
    canonical,
    tokens,
    tagWords: Array.from(tagPostings, ([word, set]) => ({ word, entries: [...set] })),
    keywordWords: Array.from(keywordPostings, ([word, set]) => ({
      word,
      entries: [...set],
    })),
  };
}

function getResolverIndex(catalog: CatalogFile): ResolverIndex {
  if (cachedResolverIndex?.catalog === catalog) return cachedResolverIndex;
  cachedResolverIndex = {
    catalog,
    weapons: buildResolverKind(catalog.weapons, WEAPON_TAG_WORDS),
    events: buildResolverKind(catalog.events, EVENT_TAG_WORDS),
  };
  return cachedResolverIndex;
}

export interface ResolverStats {
  built: boolean;
  weaponEntries: number;
  eventEntries: number;
  weaponTokens: number;
  eventTokens: number;
  calls: number;
  poolCalls: number;
  fullCalls: number;
  avgMs: number;
  lastMs: number;
  maxMs: number;
  avgCandidates: number;
  lastCandidates: number;
}

/** Diagnóstico do índice de resolução; usado por métricas e testes. */
export function getResolverStats(): ResolverStats {
  const catalog = getCatalog();
  const index = getResolverIndex(catalog);
  return {
    built: true,
    weaponEntries: index.weapons.entries.length,
    eventEntries: index.events.entries.length,
    weaponTokens: index.weapons.tokens.size,
    eventTokens: index.events.tokens.size,
    calls: catalogStats.resolverCalls,
    poolCalls: catalogStats.resolverPoolCalls,
    fullCalls: catalogStats.resolverFullCalls,
    avgMs:
      catalogStats.resolverCalls > 0
        ? Math.round((catalogStats.resolverMsTotal / catalogStats.resolverCalls) * 1000) / 1000
        : 0,
    lastMs: Math.round(catalogStats.resolverLastMs * 1000) / 1000,
    maxMs: Math.round(catalogStats.resolverMsMax * 1000) / 1000,
    avgCandidates:
      catalogStats.resolverCalls > 0
        ? Math.round(catalogStats.resolverCandidatesTotal / catalogStats.resolverCalls)
        : 0,
    lastCandidates: catalogStats.resolverLastCandidates,
  };
}

function recordResolverCall(
  scoped: boolean,
  candidates: number,
  startedAt: number,
): void {
  const elapsed = performance.now() - startedAt;
  catalogStats.resolverCalls += 1;
  if (scoped) catalogStats.resolverPoolCalls += 1;
  else catalogStats.resolverFullCalls += 1;
  catalogStats.resolverCandidatesTotal += candidates;
  catalogStats.resolverLastCandidates = candidates;
  catalogStats.resolverMsTotal += elapsed;
  catalogStats.resolverLastMs = elapsed;
  if (elapsed > catalogStats.resolverMsMax) catalogStats.resolverMsMax = elapsed;
}

function buildTrigrams(text: string): Set<string> {
  const padded = ` ${text} `;
  const grams = new Set<string>();
  for (let i = 0; i + 3 <= padded.length; i++) {
    grams.add(padded.slice(i, i + 3));
  }
  return grams;
}

function trigramSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const gram of a) {
    if (b.has(gram)) shared += 1;
  }
  return shared / Math.sqrt(a.size * b.size);
}

function promptHash(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * "Mais próximo" quando o prompt não gera nenhum candidato pelo índice
 * invertido (typo, palavra inventada, sinônimo fora do domínio). Compara
 * trigramas contra nome+aliases+tags+sinônimos de todos os itens ativos e
 * desempata pela ordem do catálogo. Se absolutamente nada compartilha
 * trigramas, usa o hash do prompt para espalhar a escolha — assim não existe
 * um "default" fixo para textos sem sinal algum.
 */
function nearestEntry<T extends CatalogWeaponItem | CatalogEventItem>(
  activeEntries: ResolverEntry<T>[],
  promptGrams: Set<string>,
  promptNorm: string,
): ScoredEntry<T> | null {
  let bestEntry: ResolverEntry<T> | null = null;
  let bestScore = -1;
  for (const entry of activeEntries) {
    const score = trigramSimilarity(promptGrams, entry.searchGrams);
    if (
      bestEntry === null ||
      score > bestScore + 1e-9 ||
      (Math.abs(score - bestScore) <= 1e-9 && entry.ordinal < bestEntry.ordinal)
    ) {
      bestEntry = entry;
      bestScore = score;
    }
  }
  if (!bestEntry) return null;
  if (bestScore <= 1e-9) {
    bestEntry = activeEntries[promptHash(promptNorm) % activeEntries.length];
    bestScore = 0;
  }
  return {
    item: bestEntry.item,
    entry: bestEntry,
    score: Math.round(bestScore * 1000) / 10,
    strategy: 'partial',
  };
}

function scoreEntry<T extends CatalogWeaponItem | CatalogEventItem>(
  entry: ResolverEntry<T>,
  promptNorm: string,
  promptTokens: Set<string>,
): ScoredEntry<T> {
  let score = 0;
  for (const token of promptTokens) {
    if (entry.tokens.has(token)) score += 15;
  }
  for (const tagNorm of entry.tagNorms) {
    if (promptNorm.includes(tagNorm)) score += 25;
  }
  for (const keywordEntry of entry.keywordEntries) {
    if (keywordEntry.words.some((word) => promptNorm.includes(word))) score += 60;
  }
  return { item: entry.item, entry, score, strategy: score > 0 ? 'tags' : 'partial' };
}

function collectCandidates<T extends CatalogWeaponItem | CatalogEventItem>(
  index: ResolverKindIndex<T>,
  promptNorm: string,
  promptCanonical: string,
  promptTokens: Set<string>,
  restrictIds: ReadonlySet<string> | null,
): CandidateCollection<T> {
  const candidates = new Map<string, ResolverEntry<T>>();
  const exactAliasIds = new Set<string>();
  const canonicalIds = new Set<string>();
  const add = (entries: ResolverEntry<T>[] | undefined): void => {
    if (!entries) return;
    for (const entry of entries) {
      if (entry.item.status === 'deprecated') continue;
      if (restrictIds && !restrictIds.has(entry.item.id)) continue;
      candidates.set(entry.item.id, entry);
    }
  };

  const aliasEntries = index.alias.get(promptNorm);
  if (aliasEntries) {
    for (const entry of aliasEntries) exactAliasIds.add(entry.item.id);
    add(aliasEntries);
  }
  if (promptCanonical) {
    const canonicalEntries = index.canonical.get(promptCanonical);
    if (canonicalEntries) {
      for (const entry of canonicalEntries) canonicalIds.add(entry.item.id);
      add(canonicalEntries);
    }
  }
  for (const token of promptTokens) add(index.tokens.get(token));
  for (const posting of index.tagWords) {
    if (promptNorm.includes(posting.word)) add(posting.entries);
  }
  for (const posting of index.keywordWords) {
    if (promptNorm.includes(posting.word)) add(posting.entries);
  }

  return {
    entries: Array.from(candidates.values()).sort((a, b) => a.ordinal - b.ordinal),
    exactAliasIds,
    canonicalIds,
  };
}

function pickBestEntry<T extends CatalogWeaponItem | CatalogEventItem>(
  candidates: CandidateCollection<T>,
  promptNorm: string,
  promptTokens: Set<string>,
  promptGrams: Set<string>,
  activeEntries: ResolverEntry<T>[],
  ambiguous: boolean,
): ScoredEntry<T> {
  let best: ScoredEntry<T> | null = null;
  for (const entry of candidates.entries) {
    let scored: ScoredEntry<T>;
    if (candidates.exactAliasIds.has(entry.item.id)) {
      scored = { item: entry.item, entry, score: 1000, strategy: 'alias' };
    } else if (candidates.canonicalIds.has(entry.item.id)) {
      scored = { item: entry.item, entry, score: 800, strategy: 'canonical' };
    } else {
      scored = scoreEntry(entry, promptNorm, promptTokens);
    }
    if (!best || scored.score > best.score) best = scored;
  }
  if (best && best.score >= MIN_COVER_SCORE) {
    if (best.strategy === 'alias' || best.strategy === 'canonical') return best;
    if (best.score >= CONFIDENT_COVER_SCORE && !ambiguous) return best;
    return { ...best, strategy: 'partial' };
  }
  // Nunca cai em item default: se algum candidato pontuou, ele é o mais
  // próximo; se nenhum pontuou, usa similaridade de trigramas sobre o catálogo
  // inteiro. Em ambos os casos a lacuna fica marcada como `partial`.
  if (best) return { ...best, strategy: 'partial' };
  const nearest = nearestEntry(activeEntries, promptGrams, promptNorm);
  if (nearest) return nearest;
  const first = activeEntries[0] ?? candidates.entries[0];
  return { item: first.item, entry: first, score: 0, strategy: 'partial' };
}

function cloneWeapon(item: CatalogWeaponItem, prompt: string): WeaponBlueprint {
  const bp = item.payload;
  return {
    ...bp,
    id: `wpn_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    prompt: prompt.slice(0, 90),
    stats: { ...bp.stats },
    modifiers: { ...bp.modifiers },
    selfRisk: [...bp.selfRisk],
    palette: bp.palette.map((color) => ({ ...color })),
    rleVoxels: [...bp.rleVoxels],
    gripPos: [...bp.gripPos] as [number, number, number],
    muzzlePos: [...bp.muzzlePos] as [number, number, number],
    catalogId: item.id,
    assets: [...item.assets],
    fromDatabase: false,
    fromCatalog: true,
  };
}

function scaleEventParamsToBudget(
  params: EventParams,
  archetype: EventArchetype,
  maxBudget: number,
): { params: EventParams; budgetUsed: number } | null {
  const scaled: EventParams = { ...params };
  let budget = computeEventPoints(scaled, archetype);
  let guard = 0;
  while (budget > maxBudget && guard++ < 200) {
    if (scaled.lethality > 3) scaled.lethality -= 1;
    else if (scaled.quantity > 1) scaled.quantity -= 1;
    else if (scaled.radiusMeters > 3) scaled.radiusMeters -= 1;
    else if (scaled.durationSec > 6) scaled.durationSec -= 1;
    else break;
    budget = computeEventPoints(scaled, archetype);
  }
  if (budget > maxBudget) return null;
  return { params: scaled, budgetUsed: budget };
}

function composeEvent(
  base: CatalogEventItem,
  missingCategories: EventCategory[],
  activeEvents: CatalogEventItem[],
): { components: MapEventComponent[]; budgetUsed: number } | null {
  const primaryBudget =
    base.payload.budgetUsed ?? computeEventPoints(base.payload.params, base.payload.archetype);
  const components: MapEventComponent[] = [
    {
      archetype: base.payload.archetype,
      params: { ...base.payload.params },
      entityBlueprint: base.payload.entityBlueprint,
      budgetUsed: primaryBudget,
    },
  ];
  let remaining = 100 - primaryBudget;
  if (remaining < 15) return null;

  for (const category of missingCategories) {
    const donor = activeEvents.find(
      (item) => item.id !== base.id && eventCategoryOf(item) === category,
    );
    if (!donor) return null;
    const scaled = scaleEventParamsToBudget(
      donor.payload.params,
      donor.payload.archetype,
      remaining,
    );
    if (!scaled) return null;
    components.push({
      archetype: donor.payload.archetype,
      params: scaled.params,
      entityBlueprint: donor.payload.entityBlueprint,
      budgetUsed: scaled.budgetUsed,
    });
    remaining -= scaled.budgetUsed;
  }

  return {
    components,
    budgetUsed: Math.round((100 - remaining) * 10) / 10,
  };
}

function cloneEvent(
  item: CatalogEventItem,
  authorId: string,
  authorName: string,
  center: [number, number, number],
): MapEventState {
  const payload = item.payload;
  return {
    id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    authorId,
    authorName,
    // O estado do evento é transmitido para a sala inteira. Usamos o nome do
    // item aprovado em vez do texto cru do jogador para evitar abuso/PII no HUD.
    prompt: item.name,
    archetype: payload.archetype,
    fun: payload.fun ?? deriveEventFunContract(payload.archetype, payload.params),
    warningRemainingSec: 5,
    durationRemainingSec: payload.params.durationSec,
    totalDurationSec: payload.params.durationSec,
    params: { ...payload.params },
    center: [...center] as [number, number, number],
    entityBlueprint: payload.entityBlueprint
      ? {
          name: payload.entityBlueprint.name,
          palette: payload.entityBlueprint.palette.map((color) => ({ ...color })),
          rleVoxels: [...payload.entityBlueprint.rleVoxels],
        }
      : undefined,
    budgetUsed: payload.budgetUsed,
    wasClamped: payload.wasClamped,
    catalogId: item.id,
    assets: [...item.assets],
    fromDatabase: false,
    fromCatalog: true,
  };
}

function resolveWeaponInternal(
  prompt: string,
  allowedIds?: ReadonlySet<string> | null,
): WeaponResolution {
  const startedAt = performance.now();
  const cleanPrompt = prompt.trim().slice(0, 90) || 'Rifle de plasma';
  const promptNorm = normalizePrompt(cleanPrompt);
  const promptCanonical = buildCanonicalKey(cleanPrompt);
  const promptTokens = tokenSet([cleanPrompt]);
  const promptGrams = buildTrigrams(promptNorm);
  const ambiguous = isAmbiguousIntent(promptNorm, 'weapon');
  const fullCatalog = getCatalog();
  const resolver = getResolverIndex(fullCatalog).weapons;
  const poolEntries = allowedIds
    ? Array.from(allowedIds)
        .map((id) => resolver.byId.get(id))
        .filter(
          (entry): entry is ResolverEntry<CatalogWeaponItem> =>
            Boolean(entry && entry.item.status !== 'deprecated'),
        )
        .sort((a, b) => a.ordinal - b.ordinal)
    : null;
  const activeEntries =
    poolEntries && poolEntries.length > 0 ? poolEntries : resolver.activeEntries;
  const restrictIds =
    poolEntries && poolEntries.length > 0
      ? new Set(activeEntries.map((entry) => entry.item.id))
      : null;
  const candidates = collectCandidates(
    resolver,
    promptNorm,
    promptCanonical,
    promptTokens,
    restrictIds,
  );
  const picked = pickBestEntry(
    candidates,
    promptNorm,
    promptTokens,
    promptGrams,
    activeEntries,
    ambiguous,
  );

  const requested = requestedWeaponCapabilities(promptNorm);
  const requestedStatuses = Array.from(requested).filter((capability) =>
    STATUS_CAPABILITIES.has(capability),
  );
  const requestedBehaviors = Array.from(requested).filter(
    (capability) => !STATUS_CAPABILITIES.has(capability),
  );
  const baseCapabilities = weaponCapabilitiesOf(picked.item);
  const coveredByBase = Array.from(requested).filter((capability) =>
    baseCapabilities.has(capability),
  );
  const missing = Array.from(requested).filter(
    (capability) => !baseCapabilities.has(capability),
  );
  if (
    picked.strategy !== 'alias' &&
    picked.strategy !== 'canonical' &&
    requested.size >= 2 &&
    requestedStatuses.length <= 1 &&
    requestedBehaviors.length <= 1 &&
    coveredByBase.length > 0 &&
    missing.length > 0
  ) {
    const composed = composeWeapon(
      picked.item,
      missing,
      cleanPrompt,
      activeEntries.map((entry) => entry.item),
    );
    if (composed) {
      recordResolverCall(allowedIds != null, candidates.entries.length, startedAt);
      return {
        blueprint: composed,
        itemId: picked.item.id,
        strategy: 'composition',
        score: picked.score,
      };
    }
    recordResolverCall(allowedIds != null, candidates.entries.length, startedAt);
    return {
      blueprint: cloneWeapon(picked.item, cleanPrompt),
      itemId: picked.item.id,
      strategy: 'partial',
      score: picked.score,
    };
  }

  recordResolverCall(allowedIds != null, candidates.entries.length, startedAt);
  return {
    blueprint: cloneWeapon(picked.item, cleanPrompt),
    itemId: picked.item.id,
    strategy: picked.strategy,
    score: picked.score,
  };
}

export function resolveWeaponFromCatalog(
  prompt: string,
  options: ResolutionOptions = {},
): WeaponResolution {
  const allowedIds = options.allowedIds ? new Set(options.allowedIds) : null;
  const pooled = resolveWeaponInternal(prompt, allowedIds);
  if (!allowedIds) return pooled;

  const full = resolveWeaponInternal(prompt, null);
  // Pedido explícito (nome/alias exato) vence o arsenal da sala; o desvio fica
  // registrado como pool_miss para a curadoria ajustar o pool.
  if (full.strategy === 'alias' || full.strategy === 'canonical') {
    return {
      ...full,
      poolMiss: full.itemId !== pooled.itemId,
      fullItemId: full.itemId,
    };
  }
  const fullCovered = COVERED_STRATEGIES.has(full.strategy);
  const modifiersDiffer =
    full.blueprint.modifiers.statusEffect !== pooled.blueprint.modifiers.statusEffect ||
    full.blueprint.modifiers.projectileBehavior !==
      pooled.blueprint.modifiers.projectileBehavior;
  const poolMiss =
    fullCovered &&
    (full.itemId !== pooled.itemId ||
      (full.strategy === 'composition' && pooled.strategy !== 'composition') ||
      modifiersDiffer);
  let result = pooled;
  if (poolMiss) {
    const preferred = preferredPoolIds(
      allowedIds,
      getCatalogItemTags(full.itemId),
      'weapon',
    );
    if (preferred.length > 0) {
      const preferredResolution = resolveWeaponInternal(prompt, new Set(preferred));
      result = preferredResolution;
    }
  }
  return { ...result, poolMiss, fullItemId: full.itemId };
}

function resolveEventInternal(
  prompt: string,
  authorId: string,
  authorName: string,
  center: [number, number, number],
  allowedIds?: ReadonlySet<string> | null,
): EventResolution {
  const startedAt = performance.now();
  const cleanPrompt = prompt.trim().slice(0, 90) || 'Chuva de meteoros de cristal';
  const promptNorm = normalizePrompt(cleanPrompt);
  const promptCanonical = buildCanonicalKey(cleanPrompt);
  const promptTokens = tokenSet([cleanPrompt]);
  const promptGrams = buildTrigrams(promptNorm);
  const ambiguous = isAmbiguousIntent(promptNorm, 'event');
  const fullCatalog = getCatalog();
  const resolver = getResolverIndex(fullCatalog).events;
  const poolEntries = allowedIds
    ? Array.from(allowedIds)
        .map((id) => resolver.byId.get(id))
        .filter(
          (entry): entry is ResolverEntry<CatalogEventItem> =>
            Boolean(entry && entry.item.status !== 'deprecated'),
        )
        .sort((a, b) => a.ordinal - b.ordinal)
    : null;
  const activeEntries =
    poolEntries && poolEntries.length > 0 ? poolEntries : resolver.activeEntries;
  const restrictIds =
    poolEntries && poolEntries.length > 0
      ? new Set(activeEntries.map((entry) => entry.item.id))
      : null;
  const candidates = collectCandidates(
    resolver,
    promptNorm,
    promptCanonical,
    promptTokens,
    restrictIds,
  );
  const picked = pickBestEntry(
    candidates,
    promptNorm,
    promptTokens,
    promptGrams,
    activeEntries,
    ambiguous,
  );

  const requestedCategories = requestedEventCategories(promptNorm);
  const baseCategory = eventCategoryOf(picked.item);
  if (
    picked.strategy !== 'alias' &&
    picked.strategy !== 'canonical' &&
    requestedCategories.size >= 2 &&
    baseCategory !== null &&
    requestedCategories.has(baseCategory)
  ) {
    const missingCategories = Array.from(requestedCategories).filter(
      (category) => category !== baseCategory,
    );
    const composed = composeEvent(
      picked.item,
      missingCategories,
      activeEntries.map((entry) => entry.item),
    );
    if (composed) {
      const event = cloneEvent(picked.item, authorId, authorName, center);
      event.components = composed.components;
      event.budgetUsed = composed.budgetUsed;
      recordResolverCall(allowedIds != null, candidates.entries.length, startedAt);
      return {
        event,
        itemId: picked.item.id,
        strategy: 'composition',
        score: picked.score,
      };
    }
    recordResolverCall(allowedIds != null, candidates.entries.length, startedAt);
    return {
      event: cloneEvent(picked.item, authorId, authorName, center),
      itemId: picked.item.id,
      strategy: 'partial',
      score: picked.score,
    };
  }

  recordResolverCall(allowedIds != null, candidates.entries.length, startedAt);
  return {
    event: cloneEvent(picked.item, authorId, authorName, center),
    itemId: picked.item.id,
    strategy: picked.strategy,
    score: picked.score,
  };
}

export function resolveEventFromCatalog(
  prompt: string,
  authorId: string,
  authorName: string,
  center: [number, number, number],
  options: ResolutionOptions = {},
): EventResolution {
  const allowedIds = options.allowedIds ? new Set(options.allowedIds) : null;
  const pooled = resolveEventInternal(prompt, authorId, authorName, center, allowedIds);
  if (!allowedIds) return pooled;

  const full = resolveEventInternal(prompt, authorId, authorName, center, null);
  // Pedido explícito (nome/alias exato) vence o arsenal da sala; o desvio fica
  // registrado como pool_miss para a curadoria ajustar o pool.
  if (full.strategy === 'alias' || full.strategy === 'canonical') {
    return {
      ...full,
      poolMiss: full.itemId !== pooled.itemId,
      fullItemId: full.itemId,
    };
  }
  const poolMiss = COVERED_STRATEGIES.has(full.strategy) && full.itemId !== pooled.itemId;
  let result = pooled;
  if (poolMiss) {
    const preferred = preferredPoolIds(
      allowedIds,
      getCatalogItemTags(full.itemId),
      'event',
    );
    if (preferred.length > 0) {
      const preferredResolution = resolveEventInternal(
        prompt,
        authorId,
        authorName,
        center,
        new Set(preferred),
      );
      result = preferredResolution;
    }
  }
  return { ...result, poolMiss, fullItemId: full.itemId };
}

export function getCatalogSummary() {
  const catalog = getCatalog();
  const weapons = getActiveWeapons(catalog);
  const events = getActiveEvents(catalog);
  return {
    weapons: weapons.map((item) => {
      const summary = item.summary;
      return {
        prompt: item.aliases[0] ?? item.name,
        name: item.name,
        budgetUsed: summary?.budgetUsed ?? item.payload.budgetUsed,
        source: 'catalog' as const,
        hitCount: 0,
        primaryColor: summary?.primaryColor ?? item.payload.palette[0]?.hex ?? '#38bdf8',
        damage: summary?.damage ?? item.payload.stats.damage,
        projectiles: summary?.projectiles ?? item.payload.stats.projectiles,
      };
    }),
    events: events.map((item) => {
      const summary = item.summary;
      return {
        prompt: item.aliases[0] ?? item.name,
        archetype: summary?.archetype ?? item.payload.archetype,
        budgetUsed: summary?.budgetUsed ?? item.payload.budgetUsed,
        source: 'catalog' as const,
        hitCount: 0,
      };
    }),
    stats: {
      totalWeapons: weapons.length,
      totalEvents: events.length,
      deprecatedWeapons: catalog.weapons.length - weapons.length,
      deprecatedEvents: catalog.events.length - events.length,
      totalReuses: 0,
      catalogVersion: catalog.version,
    },
  };
}

/**
 * Lista compacta usada pelo painel de desenvolvimento (F8). Lê apenas o índice
 * quente: não carrega shards de payload, então abrir o painel não tem custo de
 * memória nem risco de bloquear o tick de 20 Hz.
 */
export function getCatalogDevIndex(): DevCatalogPayload {
  const catalog = getCatalog();
  return {
    catalogVersion: catalog.version,
    weapons: catalog.weapons.map((item) => ({
      id: item.id,
      name: item.name,
      aliases: item.aliases.slice(0, 3),
      tags: item.tags.slice(0, 6),
      status: item.status ?? 'approved',
      budgetUsed: item.summary?.budgetUsed ?? 0,
      damage: item.summary?.damage ?? 0,
      projectiles: item.summary?.projectiles ?? 0,
    })),
    events: catalog.events.map((item) => ({
      id: item.id,
      name: item.name,
      aliases: item.aliases.slice(0, 3),
      tags: item.tags.slice(0, 6),
      status: item.status ?? 'approved',
      budgetUsed: item.summary?.budgetUsed ?? 0,
      archetype: item.summary?.archetype ?? '',
    })),
  };
}

/**
 * Resolve um item exato por id, sem passar pela pontuação de prompts. Usado
 * apenas pelo dev mode para testar uma arma/evento específico do catálogo.
 */
export function resolveWeaponById(itemId: string): WeaponResolution | null {
  const item = getCatalog().weapons.find((entry) => entry.id === itemId);
  if (!item || item.status === 'deprecated') return null;
  return {
    blueprint: cloneWeapon(item, item.name),
    itemId: item.id,
    strategy: 'alias',
    score: 1000,
  };
}

/** Igual a `resolveWeaponById`, mas para eventos de mapa. */
export function resolveEventById(
  itemId: string,
  authorId: string,
  authorName: string,
  center: [number, number, number],
): EventResolution | null {
  const item = getCatalog().events.find((entry) => entry.id === itemId);
  if (!item || item.status === 'deprecated') return null;
  return {
    event: cloneEvent(item, authorId, authorName, center),
    itemId: item.id,
    strategy: 'alias',
    score: 1000,
  };
}
