import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildCatalogIndex,
  validateCatalogIndex,
  writeCatalogArtifacts,
  type CatalogShardFile,
} from './catalogArtifacts.ts';
import type { CatalogFile } from './catalog.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CATALOG_PATH = path.join(ROOT, 'content', 'catalog', 'catalog.json');

function readFullCatalog(): CatalogFile {
  return JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8')) as CatalogFile;
}

test('catalog index is deterministic, validated and content-addressed', () => {
  const catalog = readFullCatalog();
  const first = buildCatalogIndex(catalog);
  const second = buildCatalogIndex(catalog);

  assert.deepEqual(first.index, second.index);
  assert.deepEqual(
    first.shards.map((shard) => shard.filename),
    second.shards.map((shard) => shard.filename),
  );

  const index = validateCatalogIndex(first.index);
  assert.equal(index.version, catalog.version);
  assert.equal(index.weapons.length, catalog.weapons.length);
  assert.equal(index.events.length, catalog.events.length);
  assert.ok(first.shards.length > 1);
  for (const shard of first.shards) {
    assert.match(shard.filename, /^(weapons|events)-\d{2}-[a-f0-9]{12}\.json$/);
  }

  const shardByFilename = new Map(first.shards.map((shard) => [path.basename(shard.filename), shard]));
  for (const item of catalog.weapons) {
    const entry = index.weapons.find((candidate) => candidate.id === item.id);
    assert.ok(entry);
    const filename = index.shards[entry.shard];
    const shard = shardByFilename.get(filename);
    assert.ok(shard, `${item.id} aponta para shard inexistente`);
    const parsed = JSON.parse(shard.content) as CatalogShardFile;
    const payload = parsed.items[item.id] as { budgetUsed: number; id: string };
    assert.equal(payload.id, item.id);
    assert.equal(payload.budgetUsed, item.payload.budgetUsed);
    assert.equal(entry.summary.budgetUsed, item.payload.budgetUsed);
  }
});

test('catalog index validation rejects duplicate ids and missing shard refs', () => {
  const catalog = readFullCatalog();
  const { index } = buildCatalogIndex(catalog);

  const duplicated = structuredClone(index);
  duplicated.weapons.push({ ...duplicated.weapons[0] });
  assert.throws(() => validateCatalogIndex(duplicated), /id duplicado/);

  const missing = structuredClone(index);
  delete missing.shards[missing.weapons[0].shard];
  assert.throws(() => validateCatalogIndex(missing), /shard ausente/);
});

test('writeCatalogArtifacts creates an atomic index plus immutable shards', () => {
  const catalog = readFullCatalog();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-catalog-'));
  try {
    const result = writeCatalogArtifacts(catalog, dir);
    assert.ok(fs.existsSync(result.indexPath));
    assert.ok(result.shardCount > 1);

    const written = validateCatalogIndex(
      JSON.parse(fs.readFileSync(result.indexPath, 'utf8')),
    );
    assert.equal(written.version, catalog.version);
    for (const filename of new Set(Object.values(written.shards))) {
      assert.ok(
        fs.existsSync(path.join(dir, 'shards', filename)),
        `shard não gravado: ${filename}`,
      );
    }

    // Reexecutar não deve quebrar nem trocar nomes content-addressed.
    const again = writeCatalogArtifacts(catalog, dir);
    assert.equal(again.shardCount, result.shardCount);
    assert.deepEqual(
      JSON.parse(fs.readFileSync(result.indexPath, 'utf8')),
      written,
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
