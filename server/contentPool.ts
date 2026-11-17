import type { ContentUsageRow } from './ledger.ts';
import type {
  CatalogEventItem,
  CatalogFile,
  CatalogWeaponItem,
} from './catalog.ts';
import type { ContentPoolNetInfo } from '../src/shared/types.ts';

export const POOL_ALGORITHM_VERSION = 3;

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
  /** Assets referenciados pelo catálogo ativo (prefetch e diagnóstico). */
  assetIds: string[];
}

export type ContentPoolInfo = ContentPoolNetInfo;

export interface BuildContentPoolOptions {
  seed: number;
  targetPlayers: number;
  catalog: CatalogFile;
  /** Snapshot de uso humano; hoje é apenas diagnóstico (não filtra o arsenal). */
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

function activeWeapons(catalog: CatalogFile): CatalogWeaponItem[] {
  return catalog.weapons.filter((item) => item.status !== 'deprecated');
}

function activeEvents(catalog: CatalogFile): CatalogEventItem[] {
  return catalog.events.filter((item) => item.status !== 'deprecated');
}

function usageHash(usage: Record<string, number> | undefined): string {
  if (!usage) return 'none';
  const entries = Object.entries(usage).sort(([a], [b]) => a.localeCompare(b));
  return fnv1a(entries.map(([id, count]) => `${id}:${count}`).join('|')).toString(16);
}

/**
 * Arsenal da sala. A partir da versão 3 do algoritmo, toda partida recebe o
 * catálogo ativo inteiro: o pool não é mais uma curadoria por seed.
 *
 * Ele continua existindo para versionar/diagnosticar o arsenal e listar os
 * assets que podem aparecer. Payloads continuam vindo dos shards sob demanda e
 * assets só são buscados quando o item realmente entra em jogo.
 */
export function buildContentPool(options: BuildContentPoolOptions): ContentPool {
  const catalogWeapons = activeWeapons(options.catalog);
  const catalogEvents = activeEvents(options.catalog);
  const weaponIds = catalogWeapons.map((item) => item.id).sort();
  const eventIds = catalogEvents.map((item) => item.id).sort();
  const assetIds = Array.from(
    new Set([
      ...catalogWeapons.flatMap((item) => item.assets),
      ...catalogEvents.flatMap((item) => item.assets),
    ]),
  ).sort();
  // Hash content-addressed: o mesmo catálogo gera o mesmo arsenal em qualquer
  // sala. Seed/targetPlayers/uso ficam como proveniência, não mudam o conteúdo.
  const hash = fnv1a(
    [
      options.catalog.version,
      POOL_ALGORITHM_VERSION,
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
    usageHash: usageHash(options.usage),
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
 * O snapshot não remove itens do arsenal, mas alimenta relatórios e o
 * `usageHash` do pool.
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
