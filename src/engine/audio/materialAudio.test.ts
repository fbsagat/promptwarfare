import test from 'node:test';
import assert from 'node:assert/strict';
import { MAT } from '../../shared/types.ts';
import {
  footstepAssetId,
  footstepGroup,
  impactAssetId,
  impactGroup,
  materialColor,
} from './materialAudio.ts';

test('footstep groups follow the surface material', () => {
  assert.equal(footstepGroup(MAT.STONE), 'stone');
  assert.equal(footstepGroup(MAT.GOLD), 'stone');
  assert.equal(footstepGroup(MAT.SAND), 'loose');
  assert.equal(footstepGroup(MAT.SNOW), 'loose');
  assert.equal(footstepGroup(MAT.GRASS), 'soft');
  assert.equal(footstepGroup(MAT.WOOD), 'soft');
  assert.equal(footstepGroup(MAT.ICE), 'soft');
});

test('footstep ids clamp variants to the four imported samples', () => {
  assert.equal(footstepAssetId(MAT.STONE, 3), 'sfx:footstep:stone:3');
  assert.equal(footstepAssetId(MAT.SAND, 0), 'sfx:footstep:loose:1');
  assert.equal(footstepAssetId(MAT.GRASS, 99), 'sfx:footstep:soft:4');
  assert.equal(footstepAssetId(MAT.GRASS, Number.NaN), 'sfx:footstep:soft:1');
});

test('impact groups and variants map to existing manifest ids', () => {
  assert.equal(impactGroup(MAT.WOOD), 'wood');
  assert.equal(impactGroup(MAT.GOLD), 'metal');
  assert.equal(impactGroup(MAT.ICE), 'ice');
  assert.equal(impactGroup(MAT.CRYSTAL), 'ice');
  assert.equal(impactGroup(MAT.TERRACOTTA), 'terracotta');
  assert.equal(impactGroup(MAT.LEAVES), 'soft');
  assert.equal(impactGroup(MAT.BASALT), 'stone');

  assert.equal(impactAssetId(MAT.STONE, 1), 'sfx:impact:stone:short');
  assert.equal(impactAssetId(MAT.STONE, 2), 'sfx:impact:stone:medium');
  assert.equal(impactAssetId(MAT.STONE, 9), 'sfx:impact:stone:medium');
  assert.equal(impactAssetId(MAT.WOOD, 2), 'sfx:impact:wood:drop');
  assert.equal(impactAssetId(MAT.TERRACOTTA, 2), 'sfx:impact:terracotta:clang');
});

test('materialColor normalizes the shared palette', () => {
  const stone = materialColor(MAT.STONE);
  assert.equal(stone.length, 3);
  assert.ok(stone.every((c) => c >= 0 && c <= 1));
  assert.deepEqual(materialColor(999), [180 / 255, 180 / 255, 180 / 255]);
});
