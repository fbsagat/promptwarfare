import type { ContentUsageRow } from './ledger.ts';
import type {
  CatalogEventItem,
  CatalogFile,
  CatalogWeaponItem,
} from './catalog.ts';
import type { ContentPoolNetInfo } from '../src/shared/types.ts';
import {
  EVENT_CATEGORY_KEYS,
  WEAPON_ARCHETYPE_KEYS,
  WEAPON_ELEMENT_KEYS,
} from '../src/shared/catalogTaxonomy.ts';

export const POOL_ALGORITHM_VERSION = 2;
export const DEFAULT_POOL_WEAPON_ID = 'wpn_rifle_standard';
export const DEFAULT_POOL_EVENT_ID = 'evt_weather_meteor_shower';

const WEAPON_ELEMENTS: string[] = [...WEAPON_ELEMENT_KEYS];
const WEAPON_ARCHETYPES: string[] = [...WEAPON_ARCHETYPE_KEYS];
const EVENT_CATEGORIES: string[] = [...EVENT_CATEGORY_KEYS];

export interface ContentPool {
  algorithmVersion: number;
  catalogVersion: string;
  seed: number;
  targetPlayers: number;
  hash: string;
  usageHash: string;
  weaponIds: string[];
  eventIds: string[];
  weaponCount: number;
  eventCount: number;
  /** Assets referenciados pelo arsenal/categorias da sala (prefetch). */
  assetIds: string[];
}

export type ContentPoolInfo = ContentPoolNetInfo;

export interface BuildContentPoolOptions {
  seed: number;
  targetPlayers: number;
  catalog: CatalogFile;
  usage?: Record<string, number>;
}

function fnv1a(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function weightedPick<T>(
  items: T[],
  weight: (item: T) => number,
  rng: () => number,
): T | undefined {
  if (items.length === 0) return undefined;
  let total = 0;
  const weights = items.map((item) => {
    const value = Math.max(0.0001, weight(item));
    total += value;
    return value;
  });
  if (total <= 0) return items[Math.floor(rng() * items.length)];
  let roll = rng() * total;
  for (let i = 0; i < items.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return items[i];
  }
  return items[items.length - 1];
}

function compareCatalogVersions(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true });
}

function isNovel(
  item: CatalogWeaponItem | CatalogEventItem,
  recentVersions: Set<string>,
): boolean {
  if (item.introducedIn) return recentVersions.has(item.introducedIn);
  return item.provenance === 'ai_assisted' || item.provenance === 'authored';
}

function hasTag(item: CatalogWeaponItem | CatalogEventItem, tag: string): boolean {
  return item.tags.includes(tag);
}

function activeWeapons(catalog: CatalogFile): CatalogWeaponItem[] {
  return catalog.weapons.filter((item) => item.status !== 'deprecated');
}

function activeEvents(catalog: CatalogFile): CatalogEventItem[] {
  return catalog.events.filter((item) => item.status !== 'deprecated');
}

function targetWeaponCount(targetPlayers: number): number {
  return Math.max(16, Math.min(26, Math.round(targetPlayers * 2.5)));
}

function targetEventCount(targetPlayers: number): number {
  return Math.max(7, Math.min(11, Math.round(targetPlayers * 1.2)));
}

export function poolUsageFactor(
  itemId: string,
  usage: Record<string, number> | undefined,
  activeCount: number,
): number {
  if (!usage) return 1;
  let total = 0;
  for (const value of Object.values(usage)) total += value;
  if (total <= 0) return 1;
  const share = (usage[itemId] ?? 0) / total;
  const relative = share * activeCount;
  const factor = 1 / (0.5 + relative);
  return Math.max(0.35, Math.min(1.6, factor));
}

function usageHash(usage: Record<string, number> | undefined): string {
  if (!usage) return 'none';
  const entries = Object.entries(usage).sort(([a], [b]) => a.localeCompare(b));
  return fnv1a(entries.map(([id, count]) => `${id}:${count}`).join('|')).toString(16);
}

function addWeapon(
  selected: Map<string, CatalogWeaponItem>,
  item: CatalogWeaponItem | undefined,
): void {
  if (item) selected.set(item.id, item);
}

function addEvent(
  selected: Map<string, CatalogEventItem>,
  item: CatalogEventItem | undefined,
): void {
  if (item) selected.set(item.id, item);
}

function elementCounts(selected: Map<string, CatalogWeaponItem>): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of selected.values()) {
    for (const element of WEAPON_ELEMENTS) {
      if (hasTag(item, element)) {
        counts.set(element, (counts.get(element) ?? 0) + 1);
      }
    }
  }
  return counts;
}

function archetypeCounts(selected: Map<string, CatalogWeaponItem>): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of selected.values()) {
    for (const archetype of WEAPON_ARCHETYPES) {
      if (hasTag(item, archetype)) {
        counts.set(archetype, (counts.get(archetype) ?? 0) + 1);
      }
    }
  }
  return counts;
}

function fillWeapons(
  selected: Map<string, CatalogWeaponItem>,
  catalog: CatalogWeaponItem[],
  target: number,
  usage: Record<string, number> | undefined,
  recentVersions: Set<string>,
  rng: () => number,
): void {
  const maxPerElement = Math.max(3, Math.ceil((target / WEAPON_ELEMENTS.length) * 1.5));
  const maxPerArchetype = Math.max(3, Math.ceil((target / WEAPON_ARCHETYPES.length) * 1.5));
  while (selected.size < target) {
    const elements = elementCounts(selected);
    const archetypes = archetypeCounts(selected);
    const eligible = catalog.filter((item) => {
      if (selected.has(item.id)) return false;
      const elementOk = WEAPON_ELEMENTS.every(
        (element) => !hasTag(item, element) || (elements.get(element) ?? 0) < maxPerElement,
      );
      const archetypeOk = WEAPON_ARCHETYPES.every(
        (archetype) =>
          !hasTag(item, archetype) || (archetypes.get(archetype) ?? 0) < maxPerArchetype,
      );
      return elementOk && archetypeOk;
    });
    const pick =
      weightedPick(
        eligible,
        (item) => poolUsageFactor(item.id, usage, catalog.length) * (isNovel(item, recentVersions) ? 1.5 : 1),
        rng,
      ) ?? weightedPick(
        catalog.filter((item) => !selected.has(item.id)),
        (item) => poolUsageFactor(item.id, usage, catalog.length) * (isNovel(item, recentVersions) ? 1.5 : 1),
        rng,
      );
    if (!pick) break;
    addWeapon(selected, pick);
  }
}

function fillEvents(
  selected: Map<string, CatalogEventItem>,
  catalog: CatalogEventItem[],
  target: number,
  usage: Record<string, number> | undefined,
  recentVersions: Set<string>,
  rng: () => number,
): void {
  while (selected.size < target) {
    const pick = weightedPick(
      catalog.filter((item) => !selected.has(item.id)),
      (item) => poolUsageFactor(item.id, usage, catalog.length) * (isNovel(item, recentVersions) ? 1.5 : 1),
      rng,
    );
    if (!pick) break;
    addEvent(selected, pick);
  }
}

/**
 * Monta um arsenal determinístico por sala. O mesmo seed + catálogo + snapshot
 * de uso gera o mesmo pool. Itens com uso alto perdem peso; itens novos ganham
 * uma pequena quota de exploração.
 */
export function buildContentPool(options: BuildContentPoolOptions): ContentPool {
  const catalogWeapons = activeWeapons(options.catalog);
  const catalogEvents = activeEvents(options.catalog);
  const weaponIdSet = new Set(catalogWeapons.map((item) => item.id));
  const eventIdSet = new Set(catalogEvents.map((item) => item.id));
  const weaponUsage = options.usage
    ? Object.fromEntries(
        Object.entries(options.usage).filter(([id]) => weaponIdSet.has(id)),
      )
    : undefined;
  const eventUsage = options.usage
    ? Object.fromEntries(
        Object.entries(options.usage).filter(([id]) => eventIdSet.has(id)),
      )
    : undefined;
  const introducedVersions = new Set<string>([options.catalog.version]);
  for (const item of [...catalogWeapons, ...catalogEvents]) {
    if (item.introducedIn) introducedVersions.add(item.introducedIn);
  }
  const recentVersions = new Set(
    Array.from(introducedVersions)
      .sort(compareCatalogVersions)
      .slice(-2),
  );
  const rng = mulberry32(
    fnv1a(
      `${options.seed}|${options.catalog.version}|${POOL_ALGORITHM_VERSION}|${options.targetPlayers}`,
    ),
  );

  const weaponTarget = Math.min(catalogWeapons.length, targetWeaponCount(options.targetPlayers));
  const eventTarget = Math.min(catalogEvents.length, targetEventCount(options.targetPlayers));
  const selectedWeapons = new Map<string, CatalogWeaponItem>();
  const selectedEvents = new Map<string, CatalogEventItem>();

  addWeapon(
    selectedWeapons,
    catalogWeapons.find((item) => item.id === DEFAULT_POOL_WEAPON_ID) ??
      catalogWeapons[0],
  );
  addEvent(
    selectedEvents,
    catalogEvents.find((item) => item.id === DEFAULT_POOL_EVENT_ID) ??
      catalogEvents[0],
  );

  for (const element of WEAPON_ELEMENTS) {
    addWeapon(
      selectedWeapons,
      weightedPick(
        catalogWeapons.filter(
          (item) => hasTag(item, element) && !selectedWeapons.has(item.id),
        ),
        (item) => poolUsageFactor(item.id, weaponUsage, catalogWeapons.length),
        rng,
      ),
    );
  }
  // Arquétipos entram em ordem sorteada (determinística pelo seed) e param no
  // alvo. Salas pequenas recebem um subconjunto rotativo; salas grandes cobrem
  // todos os arquétipos sem inflar o pool além do alvo.
  const archetypeOrder = [...WEAPON_ARCHETYPES];
  for (let i = archetypeOrder.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [archetypeOrder[i], archetypeOrder[j]] = [archetypeOrder[j], archetypeOrder[i]];
  }
  for (const archetype of archetypeOrder) {
    if (selectedWeapons.size >= weaponTarget) break;
    addWeapon(
      selectedWeapons,
      weightedPick(
        catalogWeapons.filter(
          (item) => hasTag(item, archetype) && !selectedWeapons.has(item.id),
        ),
        (item) => poolUsageFactor(item.id, weaponUsage, catalogWeapons.length),
        rng,
      ),
    );
  }
  for (const category of EVENT_CATEGORIES) {
    addEvent(
      selectedEvents,
      weightedPick(
        catalogEvents.filter(
          (item) => hasTag(item, category) && !selectedEvents.has(item.id),
        ),
        (item) => poolUsageFactor(item.id, eventUsage, catalogEvents.length),
        rng,
      ),
    );
  }

  const noveltyWeaponsNeeded = Math.min(
    3,
    catalogWeapons.filter((item) => isNovel(item, recentVersions) && !selectedWeapons.has(item.id)).length,
  );
  for (let i = 0; i < noveltyWeaponsNeeded; i++) {
    addWeapon(
      selectedWeapons,
      weightedPick(
        catalogWeapons.filter((item) => isNovel(item, recentVersions) && !selectedWeapons.has(item.id)),
        () => 1,
        rng,
      ),
    );
  }
  const noveltyEventNeeded = Math.min(
    1,
    catalogEvents.filter((item) => isNovel(item, recentVersions) && !selectedEvents.has(item.id)).length,
  );
  for (let i = 0; i < noveltyEventNeeded; i++) {
    addEvent(
      selectedEvents,
      weightedPick(
        catalogEvents.filter((item) => isNovel(item, recentVersions) && !selectedEvents.has(item.id)),
        () => 1,
        rng,
      ),
    );
  }

  fillWeapons(
    selectedWeapons,
    catalogWeapons,
    weaponTarget,
    weaponUsage,
    recentVersions,
    rng,
  );
  fillEvents(
    selectedEvents,
    catalogEvents,
    eventTarget,
    eventUsage,
    recentVersions,
    rng,
  );

  const weaponIds = Array.from(selectedWeapons.keys()).sort();
  const eventIds = Array.from(selectedEvents.keys()).sort();
  const assetIds = Array.from(
    new Set(
      [
        ...Array.from(selectedWeapons.values(), (item) => item.assets),
        ...Array.from(selectedEvents.values(), (item) => item.assets),
      ].flat(),
    ),
  ).sort();
  const usageDigest = usageHash(options.usage);
  const hash = fnv1a(
    [
      options.catalog.version,
      POOL_ALGORITHM_VERSION,
      options.seed,
      options.targetPlayers,
      usageDigest,
      weaponIds.join(','),
      eventIds.join(','),
    ].join('|'),
  ).toString(16);

  return {
    algorithmVersion: POOL_ALGORITHM_VERSION,
    catalogVersion: options.catalog.version,
    seed: options.seed,
    targetPlayers: options.targetPlayers,
    hash,
    usageHash: usageDigest,
    weaponIds,
    eventIds,
    weaponCount: weaponIds.length,
    eventCount: eventIds.length,
    assetIds,
  };
}

export function summarizeContentPool(
  pool: ContentPool | null,
  includeAssets = false,
): ContentPoolInfo | null {
  if (!pool) return null;
  return {
    hash: pool.hash,
    algorithmVersion: pool.algorithmVersion,
    catalogVersion: pool.catalogVersion,
    weaponCount: pool.weaponCount,
    eventCount: pool.eventCount,
    ...(includeAssets ? { assetIds: pool.assetIds } : {}),
  };
}

/**
 * Conta exposição humana por item. Equipar arma e disparar evento são os
 * sinais de oferta; abates/dano não entram para não pesar duas vezes.
 */
export function aggregateUsageWeights(
  rows: ContentUsageRow[],
): Record<string, number> {
  const weights: Record<string, number> = {};
  for (const row of rows) {
    if (row.actor_type !== 'human') continue;
    if (row.role !== 'equip' && row.role !== 'event') continue;
    weights[row.item_id] = (weights[row.item_id] ?? 0) + 1;
  }
  return weights;
}
