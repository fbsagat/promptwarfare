/**
 * Taxonomia compartilhada do catálogo.
 *
 * As chaves de arquétipo, elemento e categoria são estáveis: aparecem em tags
 * do `catalog.json`, no pool por sala, na deduplicação semântica e na
 * promoção de candidatos. Manter uma lista única evita que um item novo fique
 * invisível para alguma dessas etapas.
 */

export const WEAPON_ARCHETYPE_KEYS = [
  'pistol',
  'rifle',
  'smg',
  'shotgun',
  'sniper',
  'launcher',
  'crossbow',
  'bow',
  'gatling',
  'flamethrower',
  'energy_cannon',
  'harpoon',
  'mortar',
  'dual_pistols',
  'railgun',
] as const;

export const WEAPON_ELEMENT_KEYS = [
  'standard',
  'ice',
  'fire',
  'toxic',
  'void',
  'electric',
] as const;

export const EVENT_CATEGORY_KEYS = ['weather', 'terrain', 'entity', 'supply'] as const;

export type WeaponArchetypeKey = (typeof WEAPON_ARCHETYPE_KEYS)[number];
export type WeaponElementKey = (typeof WEAPON_ELEMENT_KEYS)[number];
export type EventCategoryKey = (typeof EVENT_CATEGORY_KEYS)[number];
