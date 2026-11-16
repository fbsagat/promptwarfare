import test from 'node:test';
import assert from 'node:assert/strict';
import { computeWeaponPoints, decodeRleVoxels } from '../src/shared/budget.ts';
import { generateAiMapEvent, generateAiWeapon } from './aiGenerator.ts';
import {
  BlueprintDatabase,
  buildCanonicalKey,
  normalizePrompt,
} from './blueprintDb.ts';

test('normalizePrompt and buildCanonicalKey match accents, punctuation, and word order', () => {
  assert.equal(normalizePrompt('Canhão de Plasma!'), 'canhao de plasma');
  assert.equal(
    buildCanonicalKey('Um canhão congelante de plasma!!'),
    buildCanonicalKey('Canhao de plasma congelante'),
  );
  assert.equal(
    buildCanonicalKey('Chuva de meteoros flamejantes'),
    buildCanonicalKey('Meteoros flamejantes com chuva'),
  );
});

test('generateAiWeapon persists to SQLite and reuses canonical matches without calling LLM', async () => {
  const db = new BlueprintDatabase(':memory:');
  const prevKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = '';
  try {
    const first = await generateAiWeapon('Bazuca de gelo congelante explosiva', {
      useLlm: false,
      db,
    });
    assert.equal(first.fromDatabase, false);
    assert.ok(first.budgetUsed <= 100, `Expected <= 100, got ${first.budgetUsed}`);
    assert.ok(computeWeaponPoints(first.stats, first.modifiers) <= 100);
    assert.equal(first.modifiers.statusEffect, 'freeze');
    const voxels = decodeRleVoxels(first.rleVoxels, 12, 12, 24);
    assert.equal(voxels.length, 12 * 12 * 24);
    assert.ok(voxels.some((v) => v > 0));

    // Reorder words + change accents/articles -> should hit canonical key in DB
    const reused = await generateAiWeapon('Uma bazuca explosiva congelante de gelo', {
      useLlm: false,
      db,
    });
    assert.equal(reused.fromDatabase, true);
    assert.notEqual(reused.id, first.id);
    assert.equal(reused.name, first.name);
    assert.deepEqual(reused.rleVoxels, first.rleVoxels);

    const catalog = db.getCatalog(10);
    assert.equal(catalog.stats.totalWeapons, 1);
    assert.equal(catalog.stats.totalReuses, 1);
    assert.equal(catalog.weapons[0].hitCount, 2);
  } finally {
    db.close();
    if (prevKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = prevKey;
  }
});

test('stored AI weapons are never overwritten by procedural fallbacks and skip Gemini calls', async () => {
  const db = new BlueprintDatabase(':memory:');
  const prevKey = process.env.GEMINI_API_KEY;
  try {
    const seed = await generateAiWeapon('Canhao de cristal lunar', { useLlm: false, db });
    const aiCrafted = { ...seed, name: 'Canhão Lunar IA' };
    db.saveWeapon('Canhao de cristal lunar', aiCrafted, 'ai');

    // Attempted procedural save must NOT overwrite the existing 'ai' entry
    const proceduralOverwrite = { ...seed, name: 'Fallback Generico' };
    db.saveWeapon('Canhao de cristal lunar', proceduralOverwrite, 'procedural');

    // Even with useLlm: true and an arbitrary key, stored 'ai' record must be returned from DB immediately
    process.env.GEMINI_API_KEY = 'unused-when-db-has-ai';
    const loaded = await generateAiWeapon('Canhão de cristal lunar', { useLlm: true, db });
    assert.equal(loaded.fromDatabase, true);
    assert.equal(loaded.name, 'Canhão Lunar IA');
  } finally {
    db.close();
    if (prevKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = prevKey;
  }
});

test('generateAiMapEvent persists and reuses map events from SQLite with catalog stats', async () => {
  const db = new BlueprintDatabase(':memory:');
  const prevKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = '';
  try {
    const evt = await generateAiMapEvent(
      'Caixas de suprimentos de municao',
      'bot_1',
      'Bot Alpha',
      [24, 10, 24],
      { useLlm: false, db },
    );

    assert.equal(evt.fromDatabase ?? false, false);
    assert.equal(evt.archetype, 'SUPPLY_DROP');
    assert.ok(evt.budgetUsed <= 100, `Expected <= 100, got ${evt.budgetUsed}`);
    assert.ok(evt.entityBlueprint);
    const voxels = decodeRleVoxels(evt.entityBlueprint!.rleVoxels, 16, 16, 16);
    assert.equal(voxels.length, 16 * 16 * 16);
    assert.ok(voxels.some((v) => v > 0));

    const reusedEvt = await generateAiMapEvent(
      'Suprimentos de munição em caixas',
      'p_2',
      'Jogador 2',
      [40, 12, 40],
      { useLlm: false, db },
    );
    assert.equal(reusedEvt.fromDatabase, true);
    assert.equal(reusedEvt.authorId, 'p_2');
    assert.deepEqual(reusedEvt.center, [40, 12, 40]);
    assert.equal(reusedEvt.archetype, 'SUPPLY_DROP');

    const catalog = db.getCatalog(10);
    assert.equal(catalog.stats.totalEvents, 1);
    assert.equal(catalog.stats.totalReuses, 1);
    assert.equal(catalog.events[0].hitCount, 2);
  } finally {
    db.close();
    if (prevKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = prevKey;
  }
});

test('generateAiWeapon caches per allocation and preserves anti-overpower limits', async () => {
  const db = new BlueprintDatabase(':memory:');
  const prevKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = '';
  try {
    const heavyFire = await generateAiWeapon('Rifle de plasma', {
      useLlm: false,
      db,
      allocation: { firepower: 65, cadence: 15, precision: 15, destruction: 5 },
    });
    const heavyCadence = await generateAiWeapon('Rifle de plasma', {
      useLlm: false,
      db,
      allocation: { firepower: 15, cadence: 65, precision: 15, destruction: 5 },
    });

    assert.equal(heavyFire.fromDatabase, false);
    assert.equal(heavyCadence.fromDatabase, false);
    assert.ok(heavyFire.budgetUsed <= 100);
    assert.ok(heavyCadence.budgetUsed <= 100);
    assert.ok(heavyFire.stats.damage > heavyCadence.stats.damage);
    assert.ok(heavyCadence.stats.fireRate > heavyFire.stats.fireRate);

    const hitAgain = await generateAiWeapon('Rifle de plasma', {
      useLlm: false,
      db,
      allocation: { firepower: 65, cadence: 15, precision: 15, destruction: 5 },
    });
    assert.equal(hitAgain.fromDatabase, true);
  } finally {
    db.close();
    if (prevKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = prevKey;
  }
});

