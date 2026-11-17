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
import { validateEventFunContract } from '../src/shared/eventFun.ts';
import type { WeaponBlueprint } from '../src/shared/types.ts';

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
  assert.equal(first.catalog.schemaVersion, 3);
  assert.equal(first.catalog.weapons.length, 1);
  assert.equal(first.catalog.events.length, 1);
  assert.equal(first.catalog.weapons[0].id, 'wpn_teste_1');
  assert.equal(first.catalog.weapons[0].status, 'approved');
  assert.equal(first.catalog.weapons[0].provenance, 'ai_assisted');
  assert.equal(first.catalog.weapons[0].introducedIn, '2');
  assert.equal(first.catalog.events[0].status, 'approved');
  assert.equal(first.catalog.events[0].provenance, 'ai_assisted');
  assert.equal(first.catalog.events[0].introducedIn, '2');
  assert.equal(first.catalog.events[0].id, 'evt_teste_1');
  assert.ok(first.catalog.events[0].payload.fun);
  assert.deepEqual(
    validateEventFunContract(first.catalog.events[0].payload.fun!),
    [],
  );
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

test('promoteCandidates merges aliases into an existing item instead of duplicating', () => {
  const base = weaponCandidate();
  const existing: CatalogFile = {
    schemaVersion: 3,
    version: '1',
    weapons: [
      {
        id: 'wpn_pistola_existente',
        name: 'Pistola de Teste',
        tags: ['weapon', 'pistol'],
        aliases: ['Pistola de teste'],
        assets: [],
        status: 'approved',
        provenance: 'procedural',
        introducedIn: '1',
        payload: base.payload as WeaponBlueprint,
      },
    ],
    events: [],
  };
  const candidate: CatalogCandidate = {
    ...base,
    id: 'cand_weapon_alias_1',
    aliases: ['Pistola de teste', 'pistola de teste turbinada'],
  };

  const result = promoteCandidates(existing, [candidate], [candidate.id], '2');
  assert.equal(result.promoted.length, 0);
  assert.equal(result.merged.length, 1);
  assert.equal(result.catalog.weapons.length, 1);
  assert.equal(result.catalog.weapons[0].id, 'wpn_pistola_existente');
  assert.equal(result.catalog.weapons[0].introducedIn, '1');
  assert.ok(
    result.catalog.weapons[0].aliases.includes('pistola de teste turbinada'),
  );
  assert.equal(result.candidates[0].status, 'approved');
});

test('promoteCandidates merges semantic near-duplicates with shared tags', () => {
  const base = weaponCandidate();
  const existing: CatalogFile = {
    schemaVersion: 3,
    version: '1',
    weapons: [
      {
        id: 'wpn_pistola_gelo',
        name: 'Pistola de Gelo',
        tags: ['weapon', 'pistol', 'ice'],
        aliases: ['Pistola de Gelo'],
        assets: [],
        status: 'approved',
        provenance: 'procedural',
        introducedIn: '1',
        payload: base.payload as WeaponBlueprint,
      },
    ],
    events: [],
  };
  const candidate: CatalogCandidate = {
    ...base,
    id: 'cand_weapon_semantic_1',
    prompt: 'Pistola congelante',
    tags: ['weapon', 'candidate', 'pistol', 'ice'],
    aliases: ['Pistola congelante'],
  };

  const result = promoteCandidates(existing, [candidate], [candidate.id], '2');
  assert.equal(result.promoted.length, 0);
  assert.equal(result.merged.length, 1);
  assert.equal(result.catalog.weapons.length, 1);
  assert.ok(result.catalog.weapons[0].aliases.includes('Pistola congelante'));
});

test('semantic dedup does not merge different archetypes', () => {
  const base = weaponCandidate();
  const existing: CatalogFile = {
    schemaVersion: 3,
    version: '1',
    weapons: [
      {
        id: 'wpn_pistola_gelo',
        name: 'Pistola de Gelo',
        tags: ['weapon', 'pistol', 'ice'],
        aliases: ['Pistola de Gelo'],
        assets: [],
        status: 'approved',
        provenance: 'procedural',
        introducedIn: '1',
        payload: base.payload as WeaponBlueprint,
      },
    ],
    events: [],
  };
  const candidate: CatalogCandidate = {
    ...base,
    id: 'cand_weapon_rifle_gelo',
    prompt: 'Rifle de Gelo',
    tags: ['weapon', 'candidate', 'rifle', 'ice'],
    aliases: ['Rifle de Gelo'],
  };

  const result = promoteCandidates(existing, [candidate], [candidate.id], '2');
  assert.equal(result.promoted.length, 1);
  assert.equal(result.merged.length, 0);
  assert.equal(result.catalog.weapons.length, 2);
});

test('promoteCandidates rejects clamped candidates until they are reviewed', () => {
  const prompt = 'instakill infinito';
  const blueprint = validateAndClampWeapon(
    {
      name: 'Arma Instável',
      stats: {
        damage: 999,
        fireRate: 20,
        projectiles: 8,
        spreadDeg: 0,
        rangeMeters: 500,
        ammoMax: 999,
        cooling: 20,
        massKg: 1,
      },
      modifiers: { voxelCraterRadius: 9, projectileBehavior: 'standard', statusEffect: 'none' },
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
  assert.equal(blueprint.wasClamped, true);

  const candidate: CatalogCandidate = {
    ...weaponCandidate(),
    id: 'cand_weapon_clamped_1',
    prompt,
    payload: blueprint,
  };
  const result = promoteCandidates(emptyCatalog, [candidate], [candidate.id], '2');
  assert.equal(result.promoted.length, 0);
  assert.equal(result.skipped[0].reason.includes('clamp'), true);
  assert.equal(result.catalog.weapons.length, 0);
});
