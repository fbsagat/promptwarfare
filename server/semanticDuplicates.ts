import { textSetSimilarity } from './semantic.ts';
import {
  EVENT_CATEGORY_KEYS,
  WEAPON_ARCHETYPE_KEYS,
} from '../src/shared/catalogTaxonomy.ts';

const GENERIC_TAGS = new Set(['weapon', 'event', 'candidate']);
const WEAPON_ARCHETYPES: string[] = [...WEAPON_ARCHETYPE_KEYS];
const EVENT_CATEGORIES: string[] = [...EVENT_CATEGORY_KEYS];

export const SEMANTIC_DUPLICATE_THRESHOLD = 0.75;

export interface SemanticItem {
  id: string;
  kind: 'weapon' | 'event';
  texts: string[];
  tags: string[];
}

export interface SemanticPair {
  a: SemanticItem;
  b: SemanticItem;
  kind: 'weapon' | 'event';
  similarity: number;
  sharedTags: string[];
}

function archetypesFor(item: SemanticItem): string[] {
  const allowed = item.kind === 'weapon' ? WEAPON_ARCHETYPES : EVENT_CATEGORIES;
  return item.tags.filter((tag) => allowed.includes(tag));
}

function areComparable(a: SemanticItem, b: SemanticItem): string[] {
  const sharedTags = a.tags.filter(
    (tag) => !GENERIC_TAGS.has(tag) && b.tags.includes(tag),
  );
  if (sharedTags.length === 0) return [];
  const archetypesA = archetypesFor(a);
  const archetypesB = archetypesFor(b);
  if (
    archetypesA.length > 0 &&
    archetypesB.length > 0 &&
    !archetypesA.some((tag) => archetypesB.includes(tag))
  ) {
    return [];
  }
  return sharedTags;
}

/**
 * Encontra quase-duplicatas dentro do mesmo tipo. A similaridade é lexical
 * determinística (sinônimos do domínio + n-gramas), não um modelo externo.
 */
export function findNearDuplicates(
  items: SemanticItem[],
  threshold = SEMANTIC_DUPLICATE_THRESHOLD,
): SemanticPair[] {
  const pairs: SemanticPair[] = [];
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i];
      const b = items[j];
      if (a.kind !== b.kind) continue;
      const sharedTags = areComparable(a, b);
      if (sharedTags.length === 0) continue;
      const similarity = textSetSimilarity(a.texts, b.texts);
      if (similarity >= threshold) {
        pairs.push({ a, b, kind: a.kind, similarity, sharedTags });
      }
    }
  }
  return pairs.sort((a, b) => b.similarity - a.similarity);
}
