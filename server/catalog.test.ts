import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getCatalog,
  getCatalogDevIndex,
  getCatalogIndex,
  getCatalogItem,
  getCatalogItemName,
  getCatalogSummary,
  getCatalogRuntimeStats,
  getCatalogVersion,
  getResolverStats,
  hasCatalogItem,
  reloadCatalog,
  resolveEventFromCatalog,
  resolveWeaponFromCatalog,
} from './catalog.ts';
import { normalizePrompt } from '../src/shared/prompt.ts';
import {
  deriveEventFunContract,
  validateEventFunContract,
} from '../src/shared/eventFun.ts';
import {
  signatureForEvent,
  SIGNATURE_META,
} from '../src/shared/eventMechanics.ts';

test('catalog version and budgets are valid', () => {
  const catalog = getCatalog();
  assert.ok(catalog.version.length > 0);
  assert.equal(catalog.schemaVersion, 3);
  assert.equal(getCatalogVersion(), catalog.version);
  assert.ok(catalog.weapons.length >= 30);
  assert.ok(catalog.events.length >= 10);

  const index = getCatalogIndex();
  assert.ok(index, 'o runtime deve usar index.json quando ele existe');
  assert.equal(index.version, catalog.version);
  assert.equal(index.weapons.length, catalog.weapons.length);
  assert.equal(index.events.length, catalog.events.length);
  assert.ok(Object.keys(index.shards).length > 0);
  for (const item of [...catalog.weapons, ...catalog.events]) {
    assert.ok(item.summary, `${item.id} sem summary no índice`);
    assert.ok(item.summary.budgetUsed <= 100);
  }

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
  assert.equal(unknown.strategy, 'partial');
  assert.notEqual(unknown.strategy, 'default');
  assert.ok(getCatalog().weapons.some((item) => item.id === unknown.itemId));
});

test('weak prompts return the nearest catalog item instead of a default fallback', () => {
  const lavaRifle = resolveWeaponFromCatalog('Rifle de lava');
  assert.equal(lavaRifle.itemId, 'wpn_rifle_fire');
  assert.notEqual(lavaRifle.strategy, 'default');

  const typo = resolveWeaponFromCatalog('pistolaa de geloo');
  assert.notEqual(typo.strategy, 'default');
  assert.ok(getCatalog().weapons.some((item) => item.id === typo.itemId));

  const nonsense = resolveWeaponFromCatalog('zxqwv blorf');
  assert.equal(nonsense.strategy, 'partial');
  assert.ok(getCatalog().weapons.some((item) => item.id === nonsense.itemId));

  const unknownEvent = resolveEventFromCatalog(
    'evento zxqwv blorf',
    'p1',
    'Ana',
    [0, 0, 0],
  );
  assert.equal(unknownEvent.strategy, 'partial');
  assert.ok(getCatalog().events.some((item) => item.id === unknownEvent.itemId));
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
  assert.equal(unknown.strategy, 'partial');
  assert.notEqual(unknown.strategy, 'default');
  assert.ok(getCatalog().events.some((item) => item.id === unknown.itemId));
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

test('catalog summary reads the hot index without loading payload shards', () => {
  reloadCatalog();
  const before = getCatalogRuntimeStats();
  assert.equal(before.usingIndex, true);
  assert.equal(before.cachedShards, 0);

  const summary = getCatalogSummary();
  assert.ok(summary.stats.totalWeapons > 0);

  const after = getCatalogRuntimeStats();
  assert.equal(after.cachedShards, 0);
  assert.equal(after.shardCount, before.shardCount);
});

test('catalog dev index exposes ids without loading payload shards', () => {
  reloadCatalog();
  const before = getCatalogRuntimeStats();
  assert.equal(before.cachedShards, 0);

  const devIndex = getCatalogDevIndex();
  assert.equal(devIndex.catalogVersion, getCatalogVersion());
  assert.ok(devIndex.weapons.length > 0);
  assert.ok(devIndex.events.length > 0);
  assert.ok(devIndex.weapons.every((item) => item.id.length > 0));
  assert.ok(devIndex.events.every((item) => item.id.length > 0));
  assert.ok(devIndex.weapons.some((item) => item.id === 'wpn_pistol_ice'));

  const after = getCatalogRuntimeStats();
  assert.equal(after.cachedShards, 0);
});

test('every catalog event derives a valid fun contract', () => {
  const catalog = getCatalog();
  for (const event of catalog.events) {
    const fun = deriveEventFunContract(event.payload.archetype, event.payload.params);
    assert.deepEqual(
      validateEventFunContract(fun),
      [],
      `${event.id} com contrato de diversão inválido`,
    );
  }

  const tornado = resolveEventFromCatalog('Tornado', 'p1', 'Ana', [0, 0, 0]).event;
  assert.ok(tornado.fun);
  assert.ok(tornado.fun.counterplay.includes('sprint'));
  assert.equal(tornado.fun.fairness.unavoidableDamage, false);
});

test('resolver index resolves every catalog alias to one of its owners', () => {
  const catalog = getCatalog();
  const stats = getResolverStats();
  assert.ok(stats.weaponTokens > 0);
  assert.ok(stats.eventTokens > 0);

  const center: [number, number, number] = [0, 0, 0];
  for (const kind of ['weapon', 'event'] as const) {
    const items = kind === 'weapon' ? catalog.weapons : catalog.events;
    for (const item of items) {
      for (const alias of item.aliases) {
        const norm = normalizePrompt(alias);
        if (!norm) continue;
        const owners = new Set(
          items
            .filter((other) =>
              other.aliases.some((candidate) => normalizePrompt(candidate) === norm),
            )
            .map((other) => other.id),
        );
        const resolvedId =
          kind === 'weapon'
            ? resolveWeaponFromCatalog(alias).itemId
            : resolveEventFromCatalog(alias, 'p1', 'Ana', center).itemId;
        assert.ok(
          owners.has(resolvedId),
          `${item.id} alias "${alias}" resolveu para ${resolvedId}`,
        );
      }
    }
  }
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

test('every catalog event has an epic signature and the flagship events respect the scale rule', () => {
  const catalog = getCatalog();
  for (const event of catalog.events) {
    const signature = signatureForEvent(
      event.payload.archetype,
      event.payload.params,
      event.id,
    );
    assert.ok(SIGNATURE_META[signature], `${event.id} sem metadados épicos`);
    assert.ok(event.payload.budgetUsed <= 100, `${event.id} estourou o orçamento`);
  }

  const flagship = new Map(
    catalog.events
      .filter((event) =>
        [
          'evt_weather_tornado',
          'evt_weather_meteor_shower',
          'evt_terrain_volcano',
        ].includes(event.id),
      )
      .map((event) => [event.id, event]),
  );
  assert.equal(flagship.size, 3);
  for (const [id, event] of flagship) {
    assert.ok(event.payload.params.radiusMeters >= 60, `${id} não tem escala épica`);
    assert.ok(event.payload.params.durationSec >= 55, `${id} não sustenta o caos`);
    assert.ok(event.payload.wasClamped === false, `${id} foi clampado`);
  }

  // O lote de clima foi promovido inteiro: toda catástrofe aérea é map-wide.
  const weather = catalog.events.filter(
    (event) => event.payload.archetype === 'WEATHER_HAZARD',
  );
  assert.equal(weather.length, 9);
  for (const event of weather) {
    assert.ok(
      event.payload.params.radiusMeters >= 70,
      `${event.id} não cobre escala regional/ilha`,
    );
    assert.ok(event.payload.params.durationSec >= 55, `${event.id} é curto demais`);
  }

  // O lote de terreno também foi promovido: todas as mutações são colossais.
  const terrain = catalog.events.filter(
    (event) => event.payload.archetype === 'TERRAIN_MUTATION',
  );
  assert.equal(terrain.length, 8);
  for (const event of terrain) {
    assert.ok(
      event.payload.params.radiusMeters >= 60,
      `${event.id} não tem escala colossal`,
    );
    assert.ok(event.payload.params.durationSec >= 55, `${event.id} é curto demais`);
  }

  // O lote de entidades também foi promovido: bosses e matilhas regionais.
  const entities = catalog.events.filter(
    (event) => event.payload.archetype === 'ENTITY_SPAWN',
  );
  assert.equal(entities.length, 8);
  for (const event of entities) {
    assert.ok(
      event.payload.params.radiusMeters >= 40,
      `${event.id} não tem escala de caçada`,
    );
    assert.ok(event.payload.params.durationSec >= 50, `${event.id} é curto demais`);
    assert.ok(event.payload.params.quantity >= 3, `${event.id} precisa de grupo`);
  }

  // O lote de suprimentos também foi promovido: cápsulas de escala regional.
  const supplies = catalog.events.filter(
    (event) => event.payload.archetype === 'SUPPLY_DROP',
  );
  assert.equal(supplies.length, 5);
  for (const event of supplies) {
    assert.ok(
      event.payload.params.radiusMeters >= 40,
      `${event.id} não tem área de disputa`,
    );
    assert.ok(event.payload.params.durationSec >= 50, `${event.id} é curto demais`);
    assert.ok(
      (event.payload.params.ammoRestore ?? 0) >= 30,
      `${event.id} precisa de munição`,
    );
  }

  // O lote de cenário também foi promovido: estruturas colossais.
  const scenery = catalog.events.filter(
    (event) => event.payload.archetype === 'SCENERY_SPAWN',
  );
  assert.equal(scenery.length, 6);
  for (const event of scenery) {
    assert.ok(
      event.payload.params.radiusMeters >= 45,
      `${event.id} não tem escala colossal`,
    );
    assert.ok(event.payload.params.durationSec >= 50, `${event.id} é curto demais`);
    assert.equal(event.payload.params.quantity, 1);
  }
});
