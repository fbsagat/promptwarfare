import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCanonicalKey, normalizePrompt } from '../src/shared/prompt.ts';
import type {
  EntityBlueprint,
  EventArchetype,
  EventParams,
  MapEventState,
  WeaponBlueprint,
} from '../src/shared/types.ts';

export interface CatalogWeaponItem {
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

export interface CatalogEventItem {
  id: string;
  name: string;
  tags: string[];
  aliases: string[];
  assets: string[];
  payload: CatalogEventPayload;
}

export interface CatalogFile {
  version: string;
  weapons: CatalogWeaponItem[];
  events: CatalogEventItem[];
}

export interface WeaponResolution {
  blueprint: WeaponBlueprint;
  itemId: string;
  strategy: 'alias' | 'canonical' | 'tags' | 'default';
  score: number;
}

export interface EventResolution {
  event: MapEventState;
  itemId: string;
  strategy: 'alias' | 'canonical' | 'tags' | 'default';
  score: number;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CATALOG_PATH = path.resolve(__dirname, '..', 'content', 'catalog', 'catalog.json');
const DEFAULT_WEAPON_ID = 'wpn_rifle_standard';
const DEFAULT_EVENT_ID = 'evt_weather_meteor_shower';
const GENERIC_TAGS = new Set(['weapon', 'event', 'weather', 'terrain', 'entity']);
// Evita falsa cobertura: token overlap fraco não conta como match de catálogo.
const MIN_COVER_SCORE = 60;

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
  }
  return data as CatalogFile;
}

export function getCatalog(): CatalogFile {
  if (!cachedCatalog) {
    const raw = fs.readFileSync(CATALOG_PATH, 'utf8');
    cachedCatalog = assertCatalogShape(JSON.parse(raw));
  }
  return cachedCatalog;
}

export function getCatalogVersion(): string {
  return getCatalog().version;
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

interface ScoredItem<T> {
  item: T;
  score: number;
  strategy: 'alias' | 'canonical' | 'tags' | 'default';
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
): ScoredItem<T> {
  let best: ScoredItem<T> | null = null;
  for (const item of items) {
    const scored = scorer(item);
    if (!best || scored.score > best.score) best = scored;
  }
  if (best && best.score >= MIN_COVER_SCORE) return best;
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
  prompt: string,
  authorId: string,
  authorName: string,
  center: [number, number, number],
): MapEventState {
  const payload = item.payload;
  return {
    id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    authorId,
    authorName,
    prompt: prompt.slice(0, 90),
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

export function resolveWeaponFromCatalog(prompt: string): WeaponResolution {
  const cleanPrompt = prompt.trim().slice(0, 90) || 'Rifle de plasma';
  const promptNorm = normalizePrompt(cleanPrompt);
  const promptCanonical = buildCanonicalKey(cleanPrompt);
  const promptTokens = tokenSet([cleanPrompt]);
  const picked = pickBest(
    getCatalog().weapons,
    (item) => scoreWeapon(promptNorm, promptCanonical, promptTokens, item),
    DEFAULT_WEAPON_ID,
  );
  return {
    blueprint: cloneWeapon(picked.item, cleanPrompt),
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
): EventResolution {
  const cleanPrompt = prompt.trim().slice(0, 90) || 'Chuva de meteoros de cristal';
  const promptNorm = normalizePrompt(cleanPrompt);
  const promptCanonical = buildCanonicalKey(cleanPrompt);
  const promptTokens = tokenSet([cleanPrompt]);
  const picked = pickBest(
    getCatalog().events,
    (item) => scoreEvent(promptNorm, promptCanonical, promptTokens, item),
    DEFAULT_EVENT_ID,
  );
  return {
    event: cloneEvent(picked.item, cleanPrompt, authorId, authorName, center),
    itemId: picked.item.id,
    strategy: picked.strategy,
    score: picked.score,
  };
}

export function getCatalogSummary() {
  const catalog = getCatalog();
  return {
    weapons: catalog.weapons.map((item) => ({
      prompt: item.aliases[0] ?? item.name,
      name: item.name,
      budgetUsed: item.payload.budgetUsed,
      source: 'catalog' as const,
      hitCount: 0,
      primaryColor: item.payload.palette[0]?.hex ?? '#38bdf8',
      damage: item.payload.stats.damage,
      projectiles: item.payload.stats.projectiles,
    })),
    events: catalog.events.map((item) => ({
      prompt: item.aliases[0] ?? item.name,
      archetype: item.payload.archetype,
      budgetUsed: item.payload.budgetUsed,
      source: 'catalog' as const,
      hitCount: 0,
    })),
    stats: {
      totalWeapons: catalog.weapons.length,
      totalEvents: catalog.events.length,
      totalReuses: 0,
      catalogVersion: catalog.version,
    },
  };
}
