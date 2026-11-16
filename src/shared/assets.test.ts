import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveAssetUrl, type AssetEntry, type AssetManifest } from './assets.ts';

const manifest: AssetManifest = {
  version: 'a1',
  baseUrl: 'https://cdn.example.com/pw/',
  assets: [],
};

function asset(url?: string): AssetEntry {
  return {
    id: 'texture:weapon:ice',
    type: 'texture',
    status: 'approved',
    tags: ['weapon', 'ice'],
    params: {},
    url,
  };
}

test('resolveAssetUrl handles absolute and relative CDN URLs', () => {
  assert.equal(
    resolveAssetUrl(asset('https://other.example.com/ice.png'), manifest),
    'https://other.example.com/ice.png',
  );
  assert.equal(
    resolveAssetUrl(asset('textures/ice.png'), manifest),
    'https://cdn.example.com/pw/textures/ice.png',
  );
  assert.equal(
    resolveAssetUrl(asset('/textures/ice.png'), manifest),
    'https://cdn.example.com/pw/textures/ice.png',
  );
});

test('resolveAssetUrl returns null without url or baseUrl', () => {
  assert.equal(resolveAssetUrl(asset(), manifest), null);
  assert.equal(resolveAssetUrl(asset('textures/ice.png'), null), null);
  assert.equal(
    resolveAssetUrl(asset('textures/ice.png'), { version: 'a1', assets: [] }),
    null,
  );
});
