import test from 'node:test';
import assert from 'node:assert/strict';
import type {
  CatalogEventItem,
  CatalogFile,
  CatalogWeaponItem,
} from '../server/catalog.ts';
import { mergeCatalog } from './catalogMerge.ts';

function weapon(
  id: string,
  extra: Partial<CatalogWeaponItem> = {},
): CatalogWeaponItem {
  return {
    id,
    name: id,
    tags: ['weapon'],
    aliases: [id],
    assets: [],
    payload: {} as CatalogWeaponItem['payload'],
    ...extra,
  };
}

function event(
  id: string,
  extra: Partial<CatalogEventItem> = {},
): CatalogEventItem {
  return {
    id,
    name: id,
    tags: ['event'],
    aliases: [id],
    assets: [],
    payload: {} as CatalogEventItem['payload'],
    ...extra,
  };
}

test('mergeCatalog preserves promoted items and deprecated state', () => {
  const existing: CatalogFile = {
    schemaVersion: 3,
    version: 'old',
    weapons: [
      weapon('wpn_base', { status: 'deprecated', provenance: 'authored' }),
      weapon('wpn_extra', { provenance: 'ai_assisted' }),
    ],
    events: [event('evt_extra', { provenance: 'authored' })],
  };

  const result = mergeCatalog(
    existing,
    [weapon('wpn_base', { provenance: 'procedural' })],
    [event('evt_base')],
    'new',
  );

  assert.equal(result.catalog.version, 'new');
  assert.equal(result.catalog.schemaVersion, 3);
  assert.deepEqual(
    result.catalog.weapons.map((item) => item.id),
    ['wpn_base', 'wpn_extra'],
  );
  assert.equal(result.catalog.weapons[0].status, 'deprecated');
  assert.equal(result.catalog.weapons[0].provenance, 'authored');
  assert.equal(result.catalog.weapons[1].provenance, 'ai_assisted');
  assert.equal(result.catalog.events[0].id, 'evt_base');
  assert.equal(result.catalog.events[1].id, 'evt_extra');
  assert.equal(result.keptWeapons.length, 1);
  assert.equal(result.keptEvents.length, 1);
});

test('mergeCatalog with no existing catalog rebuilds only the procedural base', () => {
  const result = mergeCatalog(
    null,
    [weapon('wpn_base')],
    [event('evt_base')],
    'first',
  );

  assert.equal(result.catalog.version, 'first');
  assert.equal(result.catalog.schemaVersion, 3);
  assert.deepEqual(result.catalog.weapons.map((item) => item.id), ['wpn_base']);
  assert.deepEqual(result.catalog.events.map((item) => item.id), ['evt_base']);
  assert.equal(result.keptWeapons.length, 0);
  assert.equal(result.keptEvents.length, 0);
});
