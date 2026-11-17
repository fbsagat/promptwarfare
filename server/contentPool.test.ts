import test from 'node:test';
import assert from 'node:assert/strict';
import type {
  CatalogEventItem,
  CatalogFile,
  CatalogWeaponItem,
} from './catalog.ts';
import { aggregateUsageWeights, buildContentPool } from './contentPool.ts';
import { getCatalog } from './catalog.ts';
import type { ContentUsageRow } from './ledger.ts';

const ARCHETYPES = ['pistol', 'rifle', 'smg', 'shotgun', 'sniper', 'launcher'];
const ELEMENTS = ['standard', 'ice', 'fire', 'toxic', 'void', 'electric'];
const EVENT_CATEGORIES = ['weather', 'terrain', 'entity', 'supply'];

function weapon(
  archetype: string,
  element: string,
  extra: Partial<CatalogWeaponItem> = {},
): CatalogWeaponItem {
  return {
    id: `wpn_${archetype}_${element}`,
    name: `${archetype} ${element}`,
    tags: ['weapon', archetype, element],
    aliases: [`${archetype} de ${element}`],
    assets: [],
    status: 'approved',
    provenance: 'procedural',
    payload: {} as CatalogWeaponItem['payload'],
    ...extra,
  };
}

function event(
  category: string,
  key: string,
  extra: Partial<CatalogEventItem> = {},
): CatalogEventItem {
  return {
    id: `evt_${category}_${key}`,
    name: `${category} ${key}`,
    tags: ['event', category, key],
    aliases: [`${category} ${key}`],
    assets: [],
    status: 'approved',
    provenance: 'procedural',
    payload: {} as CatalogEventItem['payload'],
    ...extra,
  };
}

function makeCatalog(): CatalogFile {
  const weapons: CatalogWeaponItem[] = [];
  for (const archetype of ARCHETYPES) {
    for (const element of ELEMENTS) weapons.push(weapon(archetype, element));
  }
  const events: CatalogEventItem[] = [
    event('weather', 'meteor_shower'),
    event('weather', 'blizzard'),
    event('weather', 'acid_rain'),
    event('weather', 'earthquake'),
    event('weather', 'low_gravity'),
    event('terrain', 'volcano'),
    event('terrain', 'fissure'),
    event('terrain', 'crystal_spires'),
    event('terrain', 'rising_tide'),
    event('entity', 'aggressive'),
    event('entity', 'territorial'),
    event('entity', 'fleeing'),
    event('entity', 'kamikaze'),
    event('supply', 'supply'),
  ];
  return { schemaVersion: 3, version: 'test-1', weapons, events };
}

function activeWeapons(catalog: CatalogFile): CatalogWeaponItem[] {
  return catalog.weapons.filter((item) => item.status !== 'deprecated');
}

function activeEvents(catalog: CatalogFile): CatalogEventItem[] {
  return catalog.events.filter((item) => item.status !== 'deprecated');
}

function usage(
  itemId: string,
  role: ContentUsageRow['role'] = 'equip',
  actorType: ContentUsageRow['actor_type'] = 'human',
): ContentUsageRow {
  return {
    id: 1,
    created_at: 1,
    item_id: itemId,
    kind: 'weapon',
    role,
    actor_type: actorType,
    actor_ref: 'p1',
    room_id: 'R1',
    match_id: 'M1',
    target_ref: null,
    catalog_version: 'test-1',
    metadata_json: null,
  };
}

test('buildContentPool gives every match the full active catalog', () => {
  const catalog = makeCatalog();
  const a = buildContentPool({ seed: 42, targetPlayers: 6, catalog });
  const b = buildContentPool({ seed: 42, targetPlayers: 6, catalog });

  assert.deepEqual(a.weaponIds, b.weaponIds);
  assert.deepEqual(a.eventIds, b.eventIds);
  assert.equal(a.hash, b.hash);
  assert.equal(a.weaponCount, activeWeapons(catalog).length);
  assert.equal(a.eventCount, activeEvents(catalog).length);
  assert.deepEqual(
    a.weaponIds,
    activeWeapons(catalog).map((item) => item.id).sort(),
  );
  assert.deepEqual(
    a.eventIds,
    activeEvents(catalog).map((item) => item.id).sort(),
  );
  assert.equal(new Set(a.assetIds).size, a.assetIds.length);
  assert.ok(a.weaponIds.includes('wpn_rifle_standard'));
  assert.ok(a.eventIds.includes('evt_weather_meteor_shower'));

  for (const element of ELEMENTS) {
    assert.ok(
      a.weaponIds.some((id) => id.endsWith(`_${element}`)),
      `pool sem elemento ${element}`,
    );
  }
  for (const archetype of ARCHETYPES) {
    assert.ok(
      a.weaponIds.some((id) => id.startsWith(`wpn_${archetype}_`)),
      `pool sem arquétipo ${archetype}`,
    );
  }
  for (const category of EVENT_CATEGORIES) {
    assert.ok(
      a.eventIds.some((id) => id.startsWith(`evt_${category}_`)),
      `pool sem categoria ${category}`,
    );
  }
});

test('pool content is content-addressed: seed and player count do not shrink it', () => {
  const catalog = makeCatalog();
  const a = buildContentPool({ seed: 1, targetPlayers: 4, catalog });
  const b = buildContentPool({ seed: 2, targetPlayers: 14, catalog });
  assert.deepEqual(a.weaponIds, b.weaponIds);
  assert.deepEqual(a.eventIds, b.eventIds);
  assert.equal(a.hash, b.hash);
  assert.notEqual(a.seed, b.seed);
  assert.notEqual(a.targetPlayers, b.targetPlayers);
});

test('usage snapshot is diagnostic and never removes items from the arsenal', () => {
  const catalog = makeCatalog();
  const plain = buildContentPool({ seed: 7, targetPlayers: 6, catalog });
  const withUsage = buildContentPool({
    seed: 7,
    targetPlayers: 6,
    catalog,
    usage: { wpn_pistol_ice: 1000 },
  });
  assert.deepEqual(withUsage.weaponIds, plain.weaponIds);
  assert.deepEqual(withUsage.eventIds, plain.eventIds);
  assert.equal(withUsage.hash, plain.hash);
  assert.notEqual(withUsage.usageHash, plain.usageHash);
});

test('real catalog pool exposes every approved weapon and event', () => {
  const catalog = getCatalog();
  for (const targetPlayers of [4, 8, 14]) {
    const pool = buildContentPool({ seed: 7, targetPlayers, catalog });
    assert.equal(pool.weaponCount, activeWeapons(catalog).length);
    assert.equal(pool.eventCount, activeEvents(catalog).length);
    assert.equal(new Set(pool.weaponIds).size, pool.weaponIds.length);
    assert.equal(new Set(pool.eventIds).size, pool.eventIds.length);
    assert.ok(pool.assetIds.length > 0);
    assert.equal(new Set(pool.assetIds).size, pool.assetIds.length);
    assert.ok(pool.assetIds.some((id) => id.startsWith('texture:weapon:')));
    for (const category of EVENT_CATEGORIES) {
      assert.ok(
        pool.eventIds.some((id) => id.startsWith(`evt_${category}_`)),
        `pool sem categoria ${category}`,
      );
    }
  }
});

test('pool skips deprecated items', () => {
  const catalog = makeCatalog();
  const pool = buildContentPool({ seed: 9, targetPlayers: 6, catalog });
  const id = pool.weaponIds[0];
  const deprecated = makeCatalog();
  const item = deprecated.weapons.find((entry) => entry.id === id)!;
  item.status = 'deprecated';
  const next = buildContentPool({ seed: 9, targetPlayers: 6, catalog: deprecated });
  assert.equal(next.weaponIds.includes(id), false);
  assert.equal(next.weaponCount, pool.weaponCount - 1);
  assert.notEqual(next.hash, pool.hash);
});

test('aggregateUsageWeights counts only human equip/event exposure', () => {
  const weights = aggregateUsageWeights([
    usage('wpn_a', 'equip', 'human'),
    usage('wpn_a', 'equip', 'human'),
    usage('evt_b', 'event', 'human'),
    usage('wpn_a', 'kill', 'human'),
    usage('wpn_c', 'equip', 'bot'),
    usage('wpn_d', 'equip', 'dev'),
  ]);
  assert.deepEqual(weights, { wpn_a: 2, evt_b: 1 });
});
