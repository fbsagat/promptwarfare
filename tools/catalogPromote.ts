import type {
  CatalogEventItem,
  CatalogEventPayload,
  CatalogFile,
  CatalogWeaponItem,
} from '../server/catalog.ts';
import type { CatalogCandidate } from './catalog-candidates.ts';
import {
  validateAndClampEventParams,
  validateAndClampWeapon,
} from '../src/shared/budget.ts';
import type { WeaponBlueprint } from '../src/shared/types.ts';

export interface PromoteResult {
  catalog: CatalogFile;
  candidates: CatalogCandidate[];
  promoted: string[];
  skipped: Array<{ id: string; reason: string }>;
}

function uniqueId(base: string, used: Set<string>): string {
  let id = base;
  let suffix = 2;
  while (used.has(id)) {
    id = `${base}_${suffix}`;
    suffix += 1;
  }
  used.add(id);
  return id;
}

function catalogId(candidate: CatalogCandidate): string {
  const base = candidate.id.replace(/^cand_(weapon|event)_/, '');
  return candidate.kind === 'weapon' ? `wpn_${base}` : `evt_${base}`;
}

function candidateAssets(candidate: CatalogCandidate): string[] {
  if (candidate.kind === 'weapon') {
    const element =
      ['standard', 'ice', 'fire', 'toxic', 'void', 'electric'].find((tag) =>
        candidate.tags.includes(tag),
      ) ?? 'standard';
    return [
      `texture:weapon:${element}`,
      `sfx:weapon:${element}`,
      `fx:weapon:${element}`,
      'sfx:forge',
    ];
  }
  const category =
    ['weather', 'terrain', 'entity', 'supply'].find((tag) =>
      candidate.tags.includes(tag),
    ) ?? 'weather';
  return [
    `texture:event:${category}`,
    `sfx:event:${category}`,
    `fx:event:${category}`,
    'waypoint:event',
  ];
}

export function promoteCandidates(
  catalog: CatalogFile,
  candidates: CatalogCandidate[],
  ids: string[],
  version: string,
): PromoteResult {
  const selected = new Set(ids);
  const promoted: string[] = [];
  const skipped: Array<{ id: string; reason: string }> = [];
  const used = new Set([
    ...catalog.weapons.map((item) => item.id),
    ...catalog.events.map((item) => item.id),
  ]);
  const next: CatalogFile = {
    version,
    weapons: [...catalog.weapons],
    events: [...catalog.events],
  };
  const nextCandidates = candidates.map((candidate) => ({ ...candidate }));

  for (const candidate of nextCandidates) {
    if (!selected.has(candidate.id)) continue;
    if (candidate.status === 'approved') {
      skipped.push({ id: candidate.id, reason: 'já aprovado' });
      continue;
    }

    if (candidate.kind === 'weapon') {
      const blueprint = validateAndClampWeapon(
        candidate.payload as WeaponBlueprint,
        candidate.prompt,
      );
      if (blueprint.budgetUsed > 100) {
        skipped.push({ id: candidate.id, reason: 'orçamento > 100' });
        continue;
      }
      if (blueprint.stats.damage * blueprint.stats.projectiles > 48) {
        skipped.push({ id: candidate.id, reason: 'volley direto > 48' });
        continue;
      }
      const id = uniqueId(catalogId(candidate), used);
      const item: CatalogWeaponItem = {
        id,
        name: blueprint.name,
        tags: candidate.tags,
        aliases: candidate.aliases,
        assets: candidateAssets(candidate),
        payload: {
          ...blueprint,
          id,
          prompt: candidate.prompt,
          fromCatalog: undefined,
          fromDatabase: undefined,
        },
      };
      next.weapons.push(item);
      candidate.status = 'approved';
      candidate.approvedAt = Date.now();
      promoted.push(candidate.id);
      continue;
    }

    const payload = candidate.payload as CatalogEventPayload;
    const validated = validateAndClampEventParams(
      payload.archetype,
      payload.params,
      candidate.prompt,
    );
    if (validated.budgetUsed > 100) {
      skipped.push({ id: candidate.id, reason: 'orçamento > 100' });
      continue;
    }
    const id = uniqueId(catalogId(candidate), used);
    const item: CatalogEventItem = {
      id,
      name: candidate.prompt.slice(0, 60),
      tags: candidate.tags,
      aliases: candidate.aliases,
      assets: candidateAssets(candidate),
      payload: {
        archetype: payload.archetype,
        params: validated.params,
        entityBlueprint: payload.entityBlueprint,
        budgetUsed: validated.budgetUsed,
        wasClamped: validated.wasClamped,
      },
    };
    next.events.push(item);
    candidate.status = 'approved';
    candidate.approvedAt = Date.now();
    promoted.push(candidate.id);
  }

  return { catalog: next, candidates: nextCandidates, promoted, skipped };
}
