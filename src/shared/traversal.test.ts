import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createProceduralIsland,
  getGroundVoxelY,
  isNearLadder,
  overlapsSolid,
  VoxelGrid,
} from './voxelWorld.ts';
import { MAT, VOXEL_SIZE, type IslandMeta } from './types.ts';

test('procedural island generates deterministic ladder/zipline metadata', () => {
  const first: IslandMeta = { ziplines: [] };
  const second: IslandMeta = { ziplines: [] };
  const gridA = createProceduralIsland(4242, 384, 80, 384, first);
  const gridB = createProceduralIsland(4242, 384, 80, 384, second);

  assert.ok(first.ziplines.length >= 1 && first.ziplines.length <= 4);
  assert.deepEqual(first.ziplines, second.ziplines);

  for (const route of first.ziplines) {
    assert.ok(route.from.y > route.to.y, 'tirolesa deve descer');
    const horizontal = Math.hypot(
      route.from.x - route.to.x,
      route.from.z - route.to.z,
    );
    assert.ok(horizontal >= 14 && horizontal <= 80);
  }

  let ladders = 0;
  for (let y = 0; y < gridA.dimY; y++) {
    for (let z = 0; z < gridA.dimZ; z++) {
      for (let x = 0; x < gridA.dimX; x++) {
        if (gridA.get(x, y, z) === MAT.LADDER) ladders++;
      }
    }
  }
  assert.ok(ladders > 0, 'deve existir pelo menos uma escada');

  // Grids continuam determinísticos mesmo com meta.
  for (let i = 0; i < gridA.data.length; i += 4097) {
    assert.equal(gridA.data[i], gridB.data[i]);
  }
});

test('ladders are climbable but not collision solids', () => {
  const grid = new VoxelGrid(8, 12, 8);
  grid.set(2, 1, 2, MAT.STONE);
  grid.set(2, 2, 2, MAT.LADDER);
  grid.set(2, 3, 2, MAT.LADDER);

  assert.equal(
    overlapsSolid(
      grid,
      2 * VOXEL_SIZE + 0.1,
      2 * VOXEL_SIZE + 0.1,
      2 * VOXEL_SIZE + 0.1,
      0.1,
      0.1,
    ),
    false,
  );
  assert.equal(
    isNearLadder(grid, {
      x: 2 * VOXEL_SIZE + 0.1,
      y: 2 * VOXEL_SIZE,
      z: 2 * VOXEL_SIZE + 0.1,
    }),
    true,
  );
  assert.equal(getGroundVoxelY(grid, 2, 2), 1);
});

test('getGroundVoxelY ignores ladder support and keeps terrain floor', () => {
  const grid = new VoxelGrid(4, 16, 4);
  grid.set(1, 1, 1, MAT.DIRT);
  grid.set(1, 2, 1, MAT.LADDER);
  grid.set(1, 3, 1, MAT.LADDER);
  assert.equal(getGroundVoxelY(grid, 1, 1), 1);
});
