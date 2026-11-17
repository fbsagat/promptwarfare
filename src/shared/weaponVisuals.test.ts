import test from 'node:test';
import assert from 'node:assert/strict';
import {
  weaponDisplayPalette,
  weaponModuleRecipe,
} from './weaponVisuals.ts';
import type { WeaponBlueprint } from './types.ts';

function weapon(catalogId: string, name: string): Pick<
  WeaponBlueprint,
  'id' | 'name' | 'catalogId' | 'palette'
> {
  return {
    id: `${catalogId}_instance`,
    name,
    catalogId,
    palette: [
      { hex: '#38bdf8', emissive: true },
      { hex: '#334155', emissive: false },
      { hex: '#94a3b8', emissive: false },
      { hex: '#f59e0b', emissive: true },
    ],
  };
}

test('weapon display palette appends a deterministic accent', () => {
  const pistol = weapon('wpn_pistol_ice', 'Pistola de Gelo');
  const first = weaponDisplayPalette(pistol);
  const second = weaponDisplayPalette(pistol);
  assert.deepEqual(first, second);
  assert.equal(first.length, pistol.palette.length + 1);
  assert.match(first[first.length - 1].hex, /^#[0-9a-f]{6}$/);
  assert.equal(first[first.length - 1].emissive, true);
});

test('weapon module recipe is stable per item and varies across items', () => {
  const a = weapon('wpn_rifle_ice', 'Rifle de Gelo');
  const b = weapon('wpn_rifle_fire', 'Rifle de Fogo');
  const recipeA = weaponModuleRecipe(a, 5);
  const recipeB = weaponModuleRecipe(b, 5);

  assert.deepEqual(recipeA, weaponModuleRecipe(a, 5));
  assert.notDeepEqual(
    [recipeA.barrel, recipeA.scope, recipeA.magazine, recipeA.stock],
    [recipeB.barrel, recipeB.scope, recipeB.magazine, recipeB.stock],
  );
  assert.equal(recipeA.accent, 5);
  assert.ok(recipeA.barrel >= 1 && recipeA.barrel <= 3);
});

test('sniper and railgun recipes bias toward a scope', () => {
  const sniper = weaponModuleRecipe(weapon('wpn_sniper_void', 'Sniper do Vazio'), 5);
  const railgun = weaponModuleRecipe(weapon('wpn_railgun_electric', 'Railgun de Choque'), 5);
  assert.equal(sniper.scope, true);
  assert.equal(railgun.scope, true);
});
