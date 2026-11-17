import type { PaletteColor, WeaponBlueprint } from './types.ts';

/**
 * Receita modular de arma: peças e acento derivados do item, não do acaso da
 * partida. O cliente usa isso para montar uma silhueta/acabamento distinto em
 * cima do modelo-base do arquétipo.
 */
export interface WeaponModuleRecipe {
  barrel: number;
  scope: boolean;
  magazine: number;
  stock: number;
  accent: number;
  seed: number;
}

function fnv1a(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function weaponSeed(weapon: Pick<WeaponBlueprint, 'id' | 'name' | 'catalogId'>): number {
  return fnv1a(`${weapon.catalogId ?? weapon.id}|${weapon.name}`);
}

function shiftHex(hex: string, amount: number): string {
  const clean = hex.replace('#', '');
  if (clean.length !== 6) return hex;
  const value = parseInt(clean, 16);
  if (!Number.isFinite(value)) return hex;
  const clamp = (channel: number): number => Math.max(0, Math.min(255, channel + amount));
  const r = clamp((value >> 16) & 255);
  const g = clamp((value >> 8) & 255);
  const b = clamp(value & 255);
  return `#${[r, g, b]
    .map((channel) => channel.toString(16).padStart(2, '0'))
    .join('')}`;
}

/**
 * Paleta de exibição: mantém as cores do elemento e acrescenta um acento
 * determinístico por arma. O índice extra é usado pelas peças modulares.
 */
export function weaponDisplayPalette(
  weapon: Pick<WeaponBlueprint, 'id' | 'name' | 'catalogId' | 'palette'>,
): PaletteColor[] {
  const seed = weaponSeed(weapon);
  const base = weapon.palette.map((color) => ({ ...color }));
  const anchor = base[0]?.hex ?? '#38bdf8';
  const accent = shiftHex(anchor, ((seed % 41) - 20) | 0);
  return [...base, { hex: accent, emissive: true }];
}

export function weaponModuleRecipe(
  weapon: Pick<WeaponBlueprint, 'id' | 'name' | 'catalogId' | 'palette'>,
  accentIndex = weapon.palette.length + 1,
): WeaponModuleRecipe {
  const seed = weaponSeed(weapon);
  const archetype = (weapon.catalogId ?? '').split('_')[1] ?? '';
  const scopeBias = ['sniper', 'railgun', 'crossbow', 'bow'].includes(archetype);
  return {
    barrel: 1 + (seed % 3),
    scope: scopeBias || (seed >>> 3) % 4 === 0,
    magazine: (seed >>> 5) % 3,
    stock: (seed >>> 7) % 3,
    accent: accentIndex,
    seed,
  };
}
