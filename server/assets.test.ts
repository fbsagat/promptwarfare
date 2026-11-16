import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getAssetIds, getAssetManifest, getAssetVersion } from './assets.ts';
import { getCatalog } from './catalog.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('asset manifest is valid and covers every catalog item', () => {
  const manifest = getAssetManifest();
  assert.ok(manifest.version.length > 0);
  assert.equal(getAssetVersion(), manifest.version);
  assert.ok(manifest.assets.length > 20);

  const ids = getAssetIds();
  assert.equal(ids.size, manifest.assets.length);

  for (const asset of manifest.assets) {
    assert.ok(
      ['texture', 'sound', 'effect', 'waypoint'].includes(asset.type),
      `Tipo inválido em ${asset.id}`,
    );
    assert.ok(asset.tags.length > 0);
  }

  const catalog = getCatalog();
  for (const item of [...catalog.weapons, ...catalog.events]) {
    assert.ok(item.assets.length > 0, `${item.id} sem assets`);
    for (const assetId of item.assets) {
      assert.ok(ids.has(assetId), `${item.id} referencia asset inexistente: ${assetId}`);
    }
  }
});

test('sound assets with url exist on disk and carry hash/mime', () => {
  const manifest = getAssetManifest();
  const withUrl = manifest.assets.filter((asset) => Boolean(asset.url));
  assert.ok(withUrl.length > 0, 'nenhum asset com URL para validar');

  for (const asset of withUrl) {
    assert.ok(asset.mimeType, `${asset.id} sem mimeType`);
    assert.match(asset.hash ?? '', /^sha256:[a-f0-9]{64}$/, `${asset.id} sem hash`);
    const filePath = path.join(ROOT, 'content', 'assets', 'files', ...asset.url!.split('/'));
    assert.ok(fs.existsSync(filePath), `${asset.id} aponta para arquivo ausente: ${asset.url}`);
  }
});
