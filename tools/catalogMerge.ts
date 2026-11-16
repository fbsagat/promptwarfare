import type {
  CatalogEventItem,
  CatalogFile,
  CatalogWeaponItem,
} from '../server/catalog.ts';

export interface CatalogMergeResult {
  catalog: CatalogFile;
  keptWeapons: CatalogWeaponItem[];
  keptEvents: CatalogEventItem[];
}

/**
 * Mistura a base procedural recém-gerada com o catálogo existente.
 *
 * - Itens promovidos/artesanais fora da base são preservados.
 * - Itens gerados mantêm `deprecated` e `provenance` de uma versão anterior.
 * - A versão e o schema são sempre atualizados para o novo release.
 */
export function mergeCatalog(
  existing: CatalogFile | null,
  generatedWeapons: CatalogWeaponItem[],
  generatedEvents: CatalogEventItem[],
  version: string,
): CatalogMergeResult {
  const generatedIds = new Set([
    ...generatedWeapons.map((item) => item.id),
    ...generatedEvents.map((item) => item.id),
  ]);
  const existingById = new Map(
    existing
      ? [...existing.weapons, ...existing.events].map((item) => [item.id, item])
      : [],
  );

  for (const item of [...generatedWeapons, ...generatedEvents]) {
    const prior = existingById.get(item.id);
    if (prior?.status === 'deprecated') item.status = 'deprecated';
    if (prior?.provenance) item.provenance = prior.provenance;
  }

  const keptWeapons = existing
    ? existing.weapons.filter((item) => !generatedIds.has(item.id))
    : [];
  const keptEvents = existing
    ? existing.events.filter((item) => !generatedIds.has(item.id))
    : [];

  return {
    catalog: {
      schemaVersion: 2,
      version,
      weapons: [...generatedWeapons, ...keptWeapons],
      events: [...generatedEvents, ...keptEvents],
    },
    keptWeapons,
    keptEvents,
  };
}
