import test from 'node:test';
import assert from 'node:assert/strict';
import { getAssetIds, getAssetManifest, getAssetVersion } from './assets.ts';
import { getCatalog } from './catalog.ts';

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
