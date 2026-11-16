import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildFallbackWeaponVoxels,
  encodeRleVoxels,
  validateAndClampWeapon,
} from '../src/shared/budget.ts';
import type { CatalogFile } from '../server/catalog.ts';
import type { CatalogCandidate } from './catalog-candidates.ts';
import { promoteCandidates } from './catalogPromote.ts';

const emptyCatalog: CatalogFile = { version: '1', weapons: [], events: [] };

function weaponCandidate(): CatalogCandidate {
  const prompt = 'Pistola de teste';
  const blueprint = validateAndClampWeapon(
    {
      name: 'Pistola de Teste',
      stats: { damage: 12, fireRate: 3, projectiles: 1, spreadDeg: 4, rangeMeters: 50, ammoMax: 20, cooling: 5, massKg: 5 },
      modifiers: { voxelCraterRadius: 0, projectileBehavior: 'standard', statusEffect: 'none' },
      selfRisk: [],
      palette: [
        { hex: '#38bdf8', emissive: true },
        { hex: '#334155', emissive: false },
      ],
      rleVoxels: encodeRleVoxels(buildFallbackWeaponVoxels(prompt, 2)),
      gripPos: [6, 3, 6],
      muzzlePos: [6, 7, 22],
    },
    prompt,
  );
  return {
    id: 'cand_weapon_teste_1',
    kind: 'weapon',
    status: 'candidate',
    provenance: 'ai_assisted',
    prompt,
    tags: ['weapon', 'pistol', 'teste'],
    aliases: [prompt],
    payload: blueprint,
    budgetUsed: blueprint.budgetUsed,
    wasClamped: blueprint.wasClamped,
    sourceKey: 'pistola|teste',
    createdAt: Date.now(),
  };
}

function eventCandidate(): CatalogCandidate {
  return {
    id: 'cand_event_teste_1',
    kind: 'event',
    status: 'candidate',
    provenance: 'ai_assisted',
    prompt: 'Chuva de teste',
    tags: ['event', 'weather', 'teste'],
    aliases: ['Chuva de teste'],
    payload: {
      archetype: 'WEATHER_HAZARD',
      params: {
        radiusMeters: 20,
        durationSec: 30,
        lethality: 15,
        quantity: 2,
        weatherKind: 'meteor_shower',
      },
      budgetUsed: 50,
      wasClamped: false,
    },
    budgetUsed: 50,
    wasClamped: false,
    sourceKey: 'chuva|teste',
    createdAt: Date.now(),
  };
}

test('promoteCandidates validates, publishes, and skips approved candidates', () => {
  const candidates = [weaponCandidate(), eventCandidate()];
  const first = promoteCandidates(
    emptyCatalog,
    candidates,
    ['cand_weapon_teste_1', 'cand_event_teste_1'],
    '2',
  );

  assert.equal(first.catalog.version, '2');
  assert.equal(first.catalog.weapons.length, 1);
  assert.equal(first.catalog.events.length, 1);
  assert.equal(first.catalog.weapons[0].id, 'wpn_teste_1');
  assert.equal(first.catalog.events[0].id, 'evt_teste_1');
  assert.equal(first.promoted.length, 2);
  assert.equal(first.candidates[0].status, 'approved');
  assert.equal(first.candidates[1].status, 'approved');
  assert.ok(first.catalog.weapons[0].payload.budgetUsed <= 100);

  const second = promoteCandidates(
    first.catalog,
    first.candidates,
    ['cand_weapon_teste_1', 'cand_event_teste_1'],
    '3',
  );
  assert.equal(second.promoted.length, 0);
  assert.equal(second.skipped.length, 2);
  assert.equal(second.catalog.weapons.length, 1);
  assert.equal(second.catalog.version, '3');
});
