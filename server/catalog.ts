import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCanonicalKey, normalizePrompt } from '../src/shared/prompt.ts';
import { validateAndClampWeapon } from '../src/shared/budget.ts';
import type {
  EntityBlueprint,
  EventArchetype,
  EventParams,
  MapEventState,
  ProjectileBehavior,
  StatusEffect,
  WeaponBlueprint,
} from '../src/shared/types.ts';

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
  | 'default';

export interface CatalogItemMeta {
  status?: CatalogItemStatus;
  provenance?: CatalogProvenance;
}

export interface CatalogWeaponItem extends CatalogItemMeta {
  id: string;
  name: string;
  tags: string[];
  aliases: string[];
  assets: string[];
  payload: WeaponBlueprint;
}

export interface CatalogEventPayload {
  archetype: EventArchetype;
  params: EventParams;
  entityBlueprint?: EntityBlueprint;
  budgetUsed: number;
  wasClamped: boolean;
}

export interface CatalogEventItem extends CatalogItemMeta {
  id: string;
  name: string;
  tags: string[];
  aliases: string[];
  assets: string[];
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
const CATALOG_PATH = path.resolve(__dirname, '..', 'content', 'catalog', 'catalog.json');
export const DEFAULT_WEAPON_ID = 'wpn_rifle_standard';
export const DEFAULT_EVENT_ID = 'evt_weather_meteor_shower';
const GENERIC_TAGS = new Set(['weapon', 'event', 'weather', 'terrain', 'entity']);
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
  const caps = new Set<WeaponCapability>();
  if (item.payload.modifiers.statusEffect !== 'none') {
    caps.add(item.payload.modifiers.statusEffect as WeaponCapability);
  }
  if (item.payload.modifiers.projectileBehavior !== 'standard') {
    caps.add(item.payload.modifiers.projectileBehavior as WeaponCapability);
  }
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
  volcano: ['vulc', 'lava', 'erupcao'],
  fissure: ['fissura', 'racha', 'abismo'],
  crystal_spires: ['cristal', 'pilar', 'montanha'],
  rising_tide: ['mare', 'enchente', 'agua', 'tsunami', 'inundacao'],
  aggressive_nearest: ['lobo', 'matilha', 'agressivo', 'zumbi', 'monstro', 'criatura'],
  territorial: ['guardi', 'territorio', 'torre', 'golem'],
  fleeing: ['foge', 'fugir', 'pasivo', 'coelho'],
  explosive_kamikaze: ['kamikaze', 'explosivo', 'bomba'],
  supply: ['municao', 'caixa', 'suprimento', 'bala', 'ammo', 'cura', 'kit', 'tesouro'],
  weather: ['clima', 'tempo', 'tempestade'],
  terrain: ['terreno', 'chao', 'muta'],
  entity: ['criatura', 'monstro', 'bicho', 'inimigo'],
};

let cachedCatalog: CatalogFile | null = null;

function assertCatalogShape(raw: unknown): CatalogFile {
  const data = raw as Partial<CatalogFile> | null;
  if (!data || typeof data.version !== 'string') {
    throw new Error('Catálogo inválido: versão ausente.');
  }
  if (data.schemaVersion !== undefined && data.schemaVersion !== 2) {
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
  }
  return data as CatalogFile;
}

export function getCatalog(): CatalogFile {
  if (!cachedCatalog) cachedCatalog = loadCatalogFromDisk();
  return cachedCatalog;
}

function loadCatalogFromDisk(): CatalogFile {
  const raw = fs.readFileSync(CATALOG_PATH, 'utf8');
  return assertCatalogShape(JSON.parse(raw));
}

export interface CatalogReloadResult {
  version: string;
  weapons: number;
  events: number;
}

/**
 * Relê o catálogo do disco e troca o cache de forma atômica. Se o arquivo
 * estiver inválido, lança e mantém a versão anterior em memória.
 */
export function reloadCatalog(): CatalogReloadResult {
  const next = loadCatalogFromDisk();
  cachedCatalog = next;
  return {
    version: next.version,
    weapons: next.weapons.length,
    events: next.events.length,
  };
}

let catalogWatcherActive = false;

export function startCatalogWatcher(pollMs = 1000): void {
  if (catalogWatcherActive) return;
  catalogWatcherActive = true;
  fs.watchFile(CATALOG_PATH, { interval: pollMs, persistent: false }, (curr, prev) => {
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

export function stopCatalogWatcher(): void {
  if (!catalogWatcherActive) return;
  fs.unwatchFile(CATALOG_PATH);
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

function keywordScore(promptNorm: string, tags: string[], words: Record<string, string[]>): number {
  let score = 0;
  for (const tag of tags) {
    if (GENERIC_TAGS.has(tag)) continue;
    const candidates = words[tag];
    if (!candidates) continue;
    if (candidates.some((word) => promptNorm.includes(word))) {
      score += 60;
    }
  }
  return score;
}

const EVENT_CATEGORY_WORDS: Record<string, string[]> = {
  weather: ['acid_rain', 'blizzard', 'meteor_shower', 'low_gravity', 'earthquake', 'weather'],
  terrain: ['volcano', 'fissure', 'crystal_spires', 'rising_tide', 'terrain'],
  entity: [
    'aggressive_nearest',
    'territorial',
    'fleeing',
    'explosive_kamikaze',
    'entity',
  ],
  supply: ['supply'],
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

function isAmbiguousIntent(promptNorm: string, kind: 'weapon' | 'event'): boolean {
  return NEGATION_RX.test(promptNorm) || countIntentGroups(promptNorm, kind) >= 2;
}

interface ScoredItem<T> {
  item: T;
  score: number;
  strategy: CatalogResolutionStrategy;
}

function scoreWeapon(
  promptNorm: string,
  promptCanonical: string,
  promptTokens: Set<string>,
  item: CatalogWeaponItem,
): ScoredItem<CatalogWeaponItem> {
  const aliasNorms = item.aliases.map(normalizePrompt);
  if (aliasNorms.includes(promptNorm)) {
    return { item, score: 1000, strategy: 'alias' };
  }
  if (promptCanonical && item.aliases.some((a) => buildCanonicalKey(a) === promptCanonical)) {
    return { item, score: 800, strategy: 'canonical' };
  }

  const itemTokens = tokenSet([item.name, ...item.tags, ...item.aliases]);
  let score = 0;
  for (const token of promptTokens) {
    if (itemTokens.has(token)) score += 15;
  }
  for (const tag of item.tags) {
    if (GENERIC_TAGS.has(tag)) continue;
    const tagNorm = normalizePrompt(tag);
    if (tagNorm.length >= 3 && promptNorm.includes(tagNorm)) score += 25;
  }
  score += keywordScore(promptNorm, item.tags, WEAPON_TAG_WORDS);

  return { item, score, strategy: score > 0 ? 'tags' : 'default' };
}

function scoreEvent(
  promptNorm: string,
  promptCanonical: string,
  promptTokens: Set<string>,
  item: CatalogEventItem,
): ScoredItem<CatalogEventItem> {
  const aliasNorms = item.aliases.map(normalizePrompt);
  if (aliasNorms.includes(promptNorm)) {
    return { item, score: 1000, strategy: 'alias' };
  }
  if (promptCanonical && item.aliases.some((a) => buildCanonicalKey(a) === promptCanonical)) {
    return { item, score: 800, strategy: 'canonical' };
  }

  const itemTokens = tokenSet([item.name, ...item.tags, ...item.aliases]);
  let score = 0;
  for (const token of promptTokens) {
    if (itemTokens.has(token)) score += 15;
  }
  for (const tag of item.tags) {
    if (GENERIC_TAGS.has(tag)) continue;
    const tagNorm = normalizePrompt(tag);
    if (tagNorm.length >= 3 && promptNorm.includes(tagNorm)) score += 25;
  }
  score += keywordScore(promptNorm, item.tags, EVENT_TAG_WORDS);

  return { item, score, strategy: score > 0 ? 'tags' : 'default' };
}

function pickBest<T>(
  items: T[],
  scorer: (item: T) => ScoredItem<T>,
  defaultId: string,
  ambiguous: boolean,
): ScoredItem<T> {
  let best: ScoredItem<T> | null = null;
  for (const item of items) {
    const scored = scorer(item);
    if (!best || scored.score > best.score) best = scored;
  }
  if (best && best.score >= MIN_COVER_SCORE) {
    if (best.strategy === 'alias' || best.strategy === 'canonical') return best;
    if (best.score >= CONFIDENT_COVER_SCORE && !ambiguous) return best;
    return { ...best, strategy: 'partial' };
  }
  const fallback = items.find((item) => (item as { id?: string }).id === defaultId) ?? items[0];
  return { item: fallback, score: 0, strategy: 'default' };
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
  const cleanPrompt = prompt.trim().slice(0, 90) || 'Rifle de plasma';
  const promptNorm = normalizePrompt(cleanPrompt);
  const promptCanonical = buildCanonicalKey(cleanPrompt);
  const promptTokens = tokenSet([cleanPrompt]);
  const ambiguous = isAmbiguousIntent(promptNorm, 'weapon');
  const fullCatalog = getCatalog();
  const poolWeapons = getActiveWeapons(fullCatalog).filter(
    (item) => !allowedIds || allowedIds.has(item.id),
  );
  const activeWeapons =
    allowedIds && poolWeapons.length === 0 ? getActiveWeapons(fullCatalog) : poolWeapons;
  const picked = pickBest(
    activeWeapons,
    (item) => scoreWeapon(promptNorm, promptCanonical, promptTokens, item),
    DEFAULT_WEAPON_ID,
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
    const composed = composeWeapon(picked.item, missing, cleanPrompt, activeWeapons);
    if (composed) {
      return {
        blueprint: composed,
        itemId: picked.item.id,
        strategy: 'composition',
        score: picked.score,
      };
    }
    return {
      blueprint: cloneWeapon(picked.item, cleanPrompt),
      itemId: picked.item.id,
      strategy: 'partial',
      score: picked.score,
    };
  }

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
      if (preferredResolution.strategy !== 'default') result = preferredResolution;
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
  const cleanPrompt = prompt.trim().slice(0, 90) || 'Chuva de meteoros de cristal';
  const promptNorm = normalizePrompt(cleanPrompt);
  const promptCanonical = buildCanonicalKey(cleanPrompt);
  const promptTokens = tokenSet([cleanPrompt]);
  const ambiguous = isAmbiguousIntent(promptNorm, 'event');
  const fullCatalog = getCatalog();
  const poolEvents = getActiveEvents(fullCatalog).filter(
    (item) => !allowedIds || allowedIds.has(item.id),
  );
  const activeEvents =
    allowedIds && poolEvents.length === 0 ? getActiveEvents(fullCatalog) : poolEvents;
  const picked = pickBest(
    activeEvents,
    (item) => scoreEvent(promptNorm, promptCanonical, promptTokens, item),
    DEFAULT_EVENT_ID,
    ambiguous,
  );
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
      if (preferredResolution.strategy !== 'default') result = preferredResolution;
    }
  }
  return { ...result, poolMiss, fullItemId: full.itemId };
}

export function getCatalogSummary() {
  const catalog = getCatalog();
  const weapons = getActiveWeapons(catalog);
  const events = getActiveEvents(catalog);
  return {
    weapons: weapons.map((item) => ({
      prompt: item.aliases[0] ?? item.name,
      name: item.name,
      budgetUsed: item.payload.budgetUsed,
      source: 'catalog' as const,
      hitCount: 0,
      primaryColor: item.payload.palette[0]?.hex ?? '#38bdf8',
      damage: item.payload.stats.damage,
      projectiles: item.payload.stats.projectiles,
    })),
    events: events.map((item) => ({
      prompt: item.aliases[0] ?? item.name,
      archetype: item.payload.archetype,
      budgetUsed: item.payload.budgetUsed,
      source: 'catalog' as const,
      hitCount: 0,
    })),
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
