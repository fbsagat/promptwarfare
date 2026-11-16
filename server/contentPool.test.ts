import test from 'node:test';
import assert from 'node:assert/strict';
import type {
  CatalogEventItem,
  CatalogFile,
  CatalogWeaponItem,
} from './catalog.ts';
import {
  aggregateUsageWeights,
  buildContentPool,
  poolUsageFactor,
} from './contentPool.ts';
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

test('buildContentPool is deterministic and keeps the mandatory core', () => {
  const catalog = makeCatalog();
  const a = buildContentPool({ seed: 42, targetPlayers: 6, catalog });
  const b = buildContentPool({ seed: 42, targetPlayers: 6, catalog });

  assert.deepEqual(a.weaponIds, b.weaponIds);
  assert.deepEqual(a.eventIds, b.eventIds);
  assert.equal(a.hash, b.hash);
  assert.ok(a.weaponCount >= 16 && a.weaponCount <= 26);
  assert.ok(a.eventCount >= 7 && a.eventCount <= 11);
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

test('different seeds produce different pools', () => {
  const catalog = makeCatalog();
  const a = buildContentPool({ seed: 1, targetPlayers: 6, catalog });
  const b = buildContentPool({ seed: 2, targetPlayers: 6, catalog });
  assert.notEqual(a.hash, b.hash);
});

test('real catalog pool stays within targets and covers every event category', () => {
  const catalog = getCatalog();
  for (const targetPlayers of [4, 8, 14]) {
    const pool = buildContentPool({ seed: 7, targetPlayers, catalog });
    assert.ok(
      pool.weaponCount >= 16 && pool.weaponCount <= 26,
      `${targetPlayers} jogadores: ${pool.weaponCount} armas no pool`,
    );
    assert.ok(
      pool.eventCount >= 7 && pool.eventCount <= 11,
      `${targetPlayers} jogadores: ${pool.eventCount} eventos no pool`,
    );
    assert.equal(new Set(pool.weaponIds).size, pool.weaponIds.length);
    assert.equal(new Set(pool.eventIds).size, pool.eventIds.length);
    for (const category of EVENT_CATEGORIES) {
      assert.ok(
        pool.eventIds.some((id) => id.startsWith(`evt_${category}_`)),
        `pool sem categoria ${category}`,
      );
    }
  }
});

test('pool usage factor penalizes used items and boosts unused ones', () => {
  const usageMap = { wpn_pistol_ice: 100 };
  const used = poolUsageFactor('wpn_pistol_ice', usageMap, 36);
  const unused = poolUsageFactor('wpn_sniper_void', usageMap, 36);
  assert.ok(used < 0.5);
  assert.ok(unused > 1);
  assert.equal(poolUsageFactor('wpn_sniper_void', undefined, 36), 1);
});

test('pool includes introducedIn novelty outside the core', () => {
  const catalog = makeCatalog();
  catalog.weapons.push({
    ...weapon('pistol', 'ice'),
    id: 'wpn_novidade_especial',
    tags: ['weapon', 'especial'],
    provenance: 'procedural',
    introducedIn: catalog.version,
  });
  const pool = buildContentPool({ seed: 7, targetPlayers: 6, catalog });
  assert.ok(pool.weaponIds.includes('wpn_novidade_especial'));
});

test('pool includes legacy ai_assisted novelty outside the core', () => {
  const catalog = makeCatalog();
  catalog.weapons.push({
    ...weapon('pistol', 'ice'),
    id: 'wpn_novidade_legacy',
    tags: ['weapon', 'especial'],
    provenance: 'ai_assisted',
  });
  const pool = buildContentPool({ seed: 8, targetPlayers: 6, catalog });
  assert.ok(pool.weaponIds.includes('wpn_novidade_legacy'));
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
