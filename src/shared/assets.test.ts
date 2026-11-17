import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mergeAssetManifests,
  resolveAssetUrl,
  type AssetEntry,
  type AssetManifest,
} from './assets.ts';

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

test('resolveAssetUrl appends a content hash to relative URLs', () => {
  const versioned = asset('textures/ice.png');
  versioned.hash = 'sha256:abcdef0123456789';
  assert.equal(
    resolveAssetUrl(versioned, manifest),
    'https://cdn.example.com/pw/textures/ice.png?v=abcdef0123456789',
  );
});

test('mergeAssetManifests unions by id and keeps the newest version', () => {
  const first: AssetManifest = {
    version: 'a1',
    baseUrl: '/assets/files',
    assets: [asset('textures/ice.png')],
  };
  const second: AssetManifest = {
    version: 'a2',
    baseUrl: '/assets/files',
    assets: [
      { ...asset('textures/ice.png'), tags: ['weapon', 'ice', 'updated'] },
      { ...asset('textures/fire.png'), id: 'texture:weapon:fire' },
    ],
  };
  const merged = mergeAssetManifests(first, second)!;
  assert.equal(merged.version, 'a2');
  assert.equal(merged.assets.length, 2);
  assert.deepEqual(
    merged.assets.find((entry) => entry.id === 'texture:weapon:ice')?.tags,
    ['weapon', 'ice', 'updated'],
  );
  assert.equal(mergeAssetManifests(first, null), first);
});

test('resolveAssetUrl returns null without url or baseUrl', () => {
  assert.equal(resolveAssetUrl(asset(), manifest), null);
  assert.equal(resolveAssetUrl(asset('textures/ice.png'), null), null);
  assert.equal(
    resolveAssetUrl(asset('textures/ice.png'), { version: 'a1', assets: [] }),
    null,
  );
});
