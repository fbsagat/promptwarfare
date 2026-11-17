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
import {
  deriveEventFunContract,
  validateEventFunContract,
} from '../src/shared/eventFun.ts';
import { buildCanonicalKey, normalizePrompt } from '../src/shared/prompt.ts';
import { textSetSimilarity } from '../server/semantic.ts';
import {
  EVENT_CATEGORY_KEYS,
  WEAPON_ARCHETYPE_KEYS,
} from '../src/shared/catalogTaxonomy.ts';

const GENERIC_TAGS = new Set(['weapon', 'event', 'candidate']);
const WEAPON_ARCHETYPES: string[] = [...WEAPON_ARCHETYPE_KEYS];
const EVENT_CATEGORIES: string[] = [...EVENT_CATEGORY_KEYS];
const SEMANTIC_DUPLICATE_THRESHOLD = 0.75;

export interface PromoteResult {
  catalog: CatalogFile;
  candidates: CatalogCandidate[];
  promoted: string[];
  merged: string[];
  skipped: Array<{ id: string; reason: string }>;
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function aliasKeys(texts: string[]): Set<string> {
  const keys = new Set<string>();
  for (const text of texts) {
    if (!text.trim()) continue;
    keys.add(`n:${normalizePrompt(text)}`);
    keys.add(`c:${buildCanonicalKey(text)}`);
  }
  return keys;
}

function findDuplicateIndex(next: CatalogFile, candidate: CatalogCandidate): number {
  const pool = candidate.kind === 'weapon' ? next.weapons : next.events;
  const candidateKeys = aliasKeys([candidate.prompt, ...candidate.aliases]);
  for (let index = 0; index < pool.length; index++) {
    const keys = aliasKeys([pool[index].name, ...pool[index].aliases]);
    for (const key of keys) {
      if (candidateKeys.has(key)) return index;
    }
  }
  return -1;
}

function findSemanticDuplicateIndex(
  next: CatalogFile,
  candidate: CatalogCandidate,
): number {
  const pool = candidate.kind === 'weapon' ? next.weapons : next.events;
  const candidateTags = candidate.tags.filter((tag) => !GENERIC_TAGS.has(tag));
  const candidateArchetype =
    (candidate.kind === 'weapon' ? WEAPON_ARCHETYPES : EVENT_CATEGORIES).find((tag) =>
      candidateTags.includes(tag),
    ) ?? '';
  const candidateTexts = [candidate.prompt, ...candidate.aliases];

  for (let index = 0; index < pool.length; index++) {
    const item = pool[index];
    const itemTags = item.tags.filter((tag) => !GENERIC_TAGS.has(tag));
    if (!candidateTags.some((tag) => itemTags.includes(tag))) continue;
    const itemArchetype =
      (candidate.kind === 'weapon' ? WEAPON_ARCHETYPES : EVENT_CATEGORIES).find((tag) =>
        itemTags.includes(tag),
      ) ?? '';
    if (candidateArchetype && itemArchetype && candidateArchetype !== itemArchetype) {
      continue;
    }
    const similarity = textSetSimilarity(candidateTexts, [item.name, ...item.aliases]);
    if (similarity >= SEMANTIC_DUPLICATE_THRESHOLD) return index;
  }
  return -1;
}

function findAnyDuplicateIndex(next: CatalogFile, candidate: CatalogCandidate): number {
  const exact = findDuplicateIndex(next, candidate);
  if (exact !== -1) return exact;
  return findSemanticDuplicateIndex(next, candidate);
}

function mergeAliases<T extends { aliases: string[]; tags: string[] }>(
  item: T,
  candidate: CatalogCandidate,
): T {
  return {
    ...item,
    aliases: unique([...item.aliases, ...candidate.aliases]),
    tags: unique([...item.tags, ...candidate.tags]),
  };
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
  const merged: string[] = [];
  const skipped: Array<{ id: string; reason: string }> = [];
  const used = new Set([
    ...catalog.weapons.map((item) => item.id),
    ...catalog.events.map((item) => item.id),
  ]);
  const next: CatalogFile = {
    schemaVersion: 3,
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
      if (blueprint.wasClamped) {
        skipped.push({ id: candidate.id, reason: 'clamp aplicado — revisar manualmente' });
        continue;
      }
      const duplicateIndex = findAnyDuplicateIndex(next, candidate);
      if (duplicateIndex !== -1) {
        next.weapons[duplicateIndex] = mergeAliases(
          next.weapons[duplicateIndex],
          candidate,
        );
        candidate.status = 'approved';
        candidate.approvedAt = Date.now();
        merged.push(candidate.id);
        continue;
      }
      const id = uniqueId(catalogId(candidate), used);
      const item: CatalogWeaponItem = {
        id,
        name: blueprint.name,
        tags: candidate.tags,
        aliases: candidate.aliases,
        assets: candidateAssets(candidate),
        status: 'approved',
        provenance: candidate.provenance,
        introducedIn: version,
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
    if (validated.wasClamped) {
      skipped.push({ id: candidate.id, reason: 'clamp aplicado — revisar manualmente' });
      continue;
    }
    const duplicateIndex = findDuplicateIndex(next, candidate);
    if (duplicateIndex !== -1) {
      next.events[duplicateIndex] = mergeAliases(
        next.events[duplicateIndex],
        candidate,
      );
      candidate.status = 'approved';
      candidate.approvedAt = Date.now();
      merged.push(candidate.id);
      continue;
    }
    const id = uniqueId(catalogId(candidate), used);
    const fun = payload.fun ?? deriveEventFunContract(payload.archetype, validated.params);
    const funIssues = validateEventFunContract(fun);
    if (funIssues.length > 0) {
      skipped.push({ id: candidate.id, reason: `contrato de diversão: ${funIssues[0]}` });
      continue;
    }
    const item: CatalogEventItem = {
      id,
      name: candidate.prompt.slice(0, 60),
      tags: candidate.tags,
      aliases: candidate.aliases,
      assets: candidateAssets(candidate),
      status: 'approved',
      provenance: candidate.provenance,
      introducedIn: version,
      payload: {
        archetype: payload.archetype,
        params: validated.params,
        entityBlueprint: payload.entityBlueprint,
        fun,
        budgetUsed: validated.budgetUsed,
        wasClamped: validated.wasClamped,
      },
    };
    next.events.push(item);
    candidate.status = 'approved';
    candidate.approvedAt = Date.now();
    promoted.push(candidate.id);
  }

  return { catalog: next, candidates: nextCandidates, promoted, merged, skipped };
}
