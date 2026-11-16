import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getCatalog,
  getCatalogItem,
  getCatalogItemName,
  getCatalogSummary,
  getCatalogVersion,
  hasCatalogItem,
  reloadCatalog,
  resolveEventFromCatalog,
  resolveWeaponFromCatalog,
} from './catalog.ts';

test('catalog version and budgets are valid', () => {
  const catalog = getCatalog();
  assert.ok(catalog.version.length > 0);
  assert.equal(catalog.schemaVersion, 3);
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
    assert.equal(weapon.status, 'approved');
    assert.ok(weapon.provenance);
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
    assert.equal(event.status, 'approved');
    assert.ok(event.provenance);
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

test('catalog covers the expanded archetype and hazard library', () => {
  const catalog = getCatalog();
  const archetypes = [
    'crossbow',
    'bow',
    'gatling',
    'flamethrower',
    'energy_cannon',
    'harpoon',
    'mortar',
    'dual_pistols',
    'railgun',
  ];
  for (const archetype of archetypes) {
    const items = catalog.weapons.filter((item) => item.tags.includes(archetype));
    assert.equal(items.length, 6, `${archetype} deveria ter as 6 variações elementais`);
  }

  const crossbow = resolveWeaponFromCatalog('Besta de gelo');
  assert.equal(crossbow.itemId, 'wpn_crossbow_ice');
  assert.equal(crossbow.strategy, 'alias');

  const railgun = resolveWeaponFromCatalog('Railgun de choque');
  assert.equal(railgun.itemId, 'wpn_railgun_electric');
  assert.equal(railgun.strategy, 'alias');

  const center: [number, number, number] = [0, 0, 0];
  const tornado = resolveEventFromCatalog('Tornado', 'p1', 'Ana', center);
  assert.equal(tornado.itemId, 'evt_weather_tornado');
  assert.equal(tornado.event.params.weatherKind, 'tornado');

  const sinkhole = resolveEventFromCatalog('Sorvedouro', 'p1', 'Ana', center);
  assert.equal(sinkhole.itemId, 'evt_terrain_sinkhole');
  assert.equal(sinkhole.event.params.mutationKind, 'sinkhole');

  const spiders = resolveEventFromCatalog('Enxame de aranhas', 'p1', 'Ana', center);
  assert.equal(spiders.itemId, 'evt_entity_spider_swarm');
  assert.ok(spiders.event.entityBlueprint);
});

test('catalog lookup exposes governance metadata without trusting arbitrary ids', () => {
  assert.deepEqual(getCatalogItem('wpn_pistol_ice'), {
    kind: 'weapon',
    name: 'Pistola de Gelo',
    status: 'approved',
  });
  assert.equal(getCatalogItemName('evt_weather_meteor_shower'), 'Chuva de meteoros');
  assert.equal(hasCatalogItem('wpn_pistol_ice'), true);
  assert.equal(hasCatalogItem('wpn_pistol_ice', 'weapon'), true);
  assert.equal(hasCatalogItem('wpn_pistol_ice', 'event'), false);
  assert.equal(hasCatalogItem('item_inexistente'), false);
  assert.equal(getCatalogItem('item_inexistente'), null);
});

test('resolver composes safe capabilities and marks weak matches as partial', () => {
  const composed = resolveWeaponFromCatalog('Pistola de gelo que ricocheteia');
  assert.equal(composed.strategy, 'composition');
  assert.equal(composed.blueprint.composed, true);
  assert.equal(composed.blueprint.catalogId, composed.itemId);
  assert.equal(composed.blueprint.modifiers.statusEffect, 'freeze');
  assert.equal(composed.blueprint.modifiers.projectileBehavior, 'bouncing');
  assert.ok(composed.blueprint.budgetUsed <= 100);
  assert.equal(composed.blueprint.wasClamped, false);

  // Dois status não cabem no mesmo blueprint; vira lacuna, não composição.
  const twoStatuses = resolveWeaponFromCatalog('Arma de gelo e fogo');
  assert.equal(twoStatuses.strategy, 'partial');

  const weakWeapon = resolveWeaponFromCatalog('arma congelante de longo alcance');
  assert.equal(weakWeapon.strategy, 'partial');
  assert.ok(weakWeapon.score >= 60);

  const composedEvent = resolveEventFromCatalog(
    'Chuva de meteoros com matilha de lobos',
    'p1',
    'Ana',
    [0, 0, 0],
  );
  assert.equal(composedEvent.strategy, 'composition');
  assert.equal(composedEvent.event.components?.length, 2);
  assert.ok((composedEvent.event.budgetUsed ?? 101) <= 100);
  assert.deepEqual(
    composedEvent.event.components?.map((component) => component.archetype),
    ['WEATHER_HAZARD', 'ENTITY_SPAWN'],
  );

  const ambiguousEvent = resolveEventFromCatalog(
    'evento estranho de gelo',
    'p1',
    'Ana',
    [0, 0, 0],
  );
  assert.equal(ambiguousEvent.strategy, 'partial');

  // Alias exato continua sendo cobertura confiável.
  const exact = resolveWeaponFromCatalog('Pistola de Gelo');
  assert.equal(exact.strategy, 'alias');
});

test('reloadCatalog revalidates the artifact without losing the current version', () => {
  const before = getCatalog();
  const result = reloadCatalog();
  assert.equal(result.version, before.version);
  assert.equal(result.weapons, before.weapons.length);
  assert.equal(result.events, before.events.length);
  assert.equal(getCatalogVersion(), before.version);
  assert.equal(getCatalog().weapons.length, before.weapons.length);
});

test('exact prompts bypass the pool; fuzzy ones stay pool-bound', () => {
  const catalog = getCatalog();
  const allowedIds = catalog.weapons
    .filter((item) => item.id !== 'wpn_pistol_ice' && item.tags.includes('ice'))
    .map((item) => item.id);

  // Nome/alias exato é um pedido explícito: entrega o item mesmo fora do pool.
  const exact = resolveWeaponFromCatalog('Pistola de gelo', { allowedIds });
  assert.equal(exact.itemId, 'wpn_pistol_ice');
  assert.equal(exact.strategy, 'alias');
  assert.equal(exact.poolMiss, true);
  assert.equal(exact.fullItemId, 'wpn_pistol_ice');

  // Prompt vago continua preso ao arsenal e prefere o mesmo elemento do pool.
  const fuzzy = resolveWeaponFromCatalog('arma congelante', { allowedIds });
  assert.equal(fuzzy.strategy, 'partial');
  assert.equal(fuzzy.itemId === 'wpn_pistol_ice', false);
  assert.ok(fuzzy.blueprint.catalogId?.endsWith('_ice'));

  // Itens fora do pool mas citados pelo nome também valem para eventos.
  const eventIds = catalog.events
    .filter((item) => item.id !== 'evt_weather_thunderstorm')
    .map((item) => item.id);
  const thunderstorm = resolveEventFromCatalog(
    'Tempestade de raios',
    'p1',
    'Ana',
    [0, 0, 0],
    { allowedIds: eventIds },
  );
  assert.equal(thunderstorm.itemId, 'evt_weather_thunderstorm');
  assert.equal(thunderstorm.strategy, 'alias');
  assert.equal(thunderstorm.poolMiss, true);
});
