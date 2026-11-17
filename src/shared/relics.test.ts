import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createRelicItem,
  RELICS,
  relicColor,
  relicDurationMs,
  relicForSignature,
} from './relics.ts';
import { SIGNATURE_META } from './eventMechanics.ts';
import type { EventSignature, RelicId } from './types.ts';

test('every relic has identity, color, duration and effect', () => {
  const ids = Object.keys(RELICS) as RelicId[];
  assert.equal(ids.length, 8);
  for (const id of ids) {
    const def = RELICS[id];
    assert.equal(def.id, id);
    assert.ok(def.name.trim().length > 0);
    assert.ok(def.description.trim().length > 0);
    assert.match(def.color, /^#[0-9a-f]{6}$/i);
    assert.ok(def.durationSec >= 15 && def.durationSec <= 40);
    assert.ok(def.effect.trim().length > 0);
    assert.equal(relicDurationMs(id), def.durationSec * 1000);
    assert.equal(relicColor(id), def.color);
  }
});

test('every event signature maps to a valid relic', () => {
  for (const signature of Object.keys(SIGNATURE_META) as EventSignature[]) {
    const id = relicForSignature(signature);
    assert.ok(RELICS[id], `${signature} apontou para relíquia inexistente ${id}`);
  }
});

test('createRelicItem produces a usable inventory item', () => {
  const item = createRelicItem('wind_anchor');
  assert.equal(item.kind, 'relic');
  assert.equal(item.relicId, 'wind_anchor');
  assert.equal(item.name, RELICS.wind_anchor.name);
  assert.ok(item.massKg > 0);
  assert.ok(item.id.startsWith('relic_wind_anchor_'));
});
