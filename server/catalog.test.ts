import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getCatalog,
  getCatalogSummary,
  getCatalogVersion,
  resolveEventFromCatalog,
  resolveWeaponFromCatalog,
} from './catalog.ts';

test('catalog version and budgets are valid', () => {
  const catalog = getCatalog();
  assert.ok(catalog.version.length > 0);
  assert.equal(getCatalogVersion(), catalog.version);
  assert.ok(catalog.weapons.length >= 30);
  assert.ok(catalog.events.length >= 10);

  for (const weapon of catalog.weapons) {
    assert.ok(
      weapon.payload.budgetUsed <= 100,
      `${weapon.id} estourou o orçamento: ${weapon.payload.budgetUsed}`,
    );
    assert.equal(
      weapon.payload.wasClamped,
      false,
      `${weapon.id} deveria estar aprovado sem clamp`,
    );
    assert.ok(weapon.payload.rleVoxels.length > 0);
  }

  for (const event of catalog.events) {
    assert.ok(
      event.payload.budgetUsed <= 100,
      `${event.id} estourou o orçamento: ${event.payload.budgetUsed}`,
    );
    assert.equal(
      event.payload.wasClamped,
      false,
      `${event.id} deveria estar aprovado sem clamp`,
    );
  }

  const summary = getCatalogSummary();
  assert.equal(summary.stats.totalWeapons, catalog.weapons.length);
  assert.equal(summary.stats.totalEvents, catalog.events.length);
});

test('weapon resolver matches archetypes and elements deterministically', () => {
  const icePistol = resolveWeaponFromCatalog('Pistola de gelo');
  assert.equal(icePistol.itemId, 'wpn_pistol_ice');
  assert.equal(icePistol.strategy, 'alias');
  assert.equal(icePistol.blueprint.fromCatalog, true);
  assert.equal(icePistol.blueprint.prompt, 'Pistola de gelo');
  assert.ok(icePistol.blueprint.budgetUsed <= 100);

  const fireShotgun = resolveWeaponFromCatalog('Escopeta de fogo');
  assert.equal(fireShotgun.itemId, 'wpn_shotgun_fire');

  const iceLauncher = resolveWeaponFromCatalog('Bazuca de gelo');
  assert.equal(iceLauncher.itemId, 'wpn_launcher_ice');

  const again = resolveWeaponFromCatalog('Pistola de gelo');
  assert.equal(again.itemId, icePistol.itemId);

  const unknown = resolveWeaponFromCatalog('Arma totalmente desconhecida xyz');
  assert.equal(unknown.strategy, 'default');
  assert.equal(unknown.itemId, 'wpn_rifle_standard');
});

test('event resolver matches weather, terrain, entity, and supply', () => {
  const center: [number, number, number] = [10, 10, 10];
  const meteors = resolveEventFromCatalog('Chuva de meteoros flamejantes', 'p1', 'Ana', center);
  assert.equal(meteors.itemId, 'evt_weather_meteor_shower');
  assert.equal(meteors.event.fromCatalog, true);
  assert.equal(meteors.event.center[0], 10);

  const volcano = resolveEventFromCatalog('Vulcão', 'p1', 'Ana', center);
  assert.equal(volcano.itemId, 'evt_terrain_volcano');

  const wolves = resolveEventFromCatalog('Matilha de lobos', 'p1', 'Ana', center);
  assert.equal(wolves.itemId, 'evt_entity_aggressive_nearest');
  assert.ok(wolves.event.entityBlueprint);

  const supply = resolveEventFromCatalog('Caixa de munição', 'p1', 'Ana', center);
  assert.equal(supply.itemId, 'evt_supply_supply');
  assert.equal(supply.event.archetype, 'SUPPLY_DROP');

  const unknown = resolveEventFromCatalog('Evento sem nome conhecido', 'p1', 'Ana', center);
  assert.equal(unknown.strategy, 'default');
  assert.equal(unknown.itemId, 'evt_weather_meteor_shower');
});
