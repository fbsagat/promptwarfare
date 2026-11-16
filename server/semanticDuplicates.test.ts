import test from 'node:test';
import assert from 'node:assert/strict';
import { findNearDuplicates } from './semanticDuplicates.ts';

test('findNearDuplicates finds semantic aliases with shared tags', () => {
  const pairs = findNearDuplicates([
    {
      id: 'wpn_pistol_ice',
      kind: 'weapon',
      tags: ['weapon', 'pistol', 'ice'],
      texts: ['Pistola de Gelo'],
    },
    {
      id: 'wpn_pistol_ice_alt',
      kind: 'weapon',
      tags: ['weapon', 'pistol', 'ice'],
      texts: ['Pistola congelante'],
    },
    {
      id: 'wpn_rifle_ice',
      kind: 'weapon',
      tags: ['weapon', 'rifle', 'ice'],
      texts: ['Rifle de Gelo'],
    },
    {
      id: 'wpn_pistol_fire',
      kind: 'weapon',
      tags: ['weapon', 'pistol', 'fire'],
      texts: ['Pistola de Fogo'],
    },
  ]);
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].a.id, 'wpn_pistol_ice');
  assert.equal(pairs[0].b.id, 'wpn_pistol_ice_alt');
  assert.ok(pairs[0].similarity >= 0.75);
  assert.deepEqual(pairs[0].sharedTags.sort(), ['ice', 'pistol']);
});

test('findNearDuplicates ignores different kinds, archetypes and thresholds', () => {
  const pairs = findNearDuplicates(
    [
      {
        id: 'evt_meteor',
        kind: 'event',
        tags: ['event', 'weather', 'meteor_shower'],
        texts: ['Chuva de meteoros'],
      },
      {
        id: 'wpn_meteor',
        kind: 'weapon',
        tags: ['weapon', 'launcher', 'fire'],
        texts: ['Chuva de meteoros'],
      },
      {
        id: 'evt_meteor_alt',
        kind: 'event',
        tags: ['event', 'weather', 'meteor_shower'],
        texts: ['Chuva de meteoros flamejantes'],
      },
      {
        id: 'wpn_pistol_ice',
        kind: 'weapon',
        tags: ['weapon', 'pistol', 'ice'],
        texts: ['Pistola de Gelo'],
      },
      {
        id: 'wpn_rifle_ice',
        kind: 'weapon',
        tags: ['weapon', 'rifle', 'ice'],
        texts: ['Rifle de Gelo'],
      },
    ],
    0.9,
  );
  assert.equal(pairs.length, 0);
});
