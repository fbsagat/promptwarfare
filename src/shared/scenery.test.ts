import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSceneryCells } from './scenery.ts';
import { MAT } from './types.ts';

test('scenery generator builds deterministic trees and houses inside bounds', () => {
  const tree = buildSceneryCells('tree', 20, 10, 20, 42, 64);
  const again = buildSceneryCells('tree', 20, 10, 20, 42, 64);
  assert.deepEqual(tree, again);
  assert.ok(tree.length > 10);
  assert.ok(tree.some((cell) => cell.mat === MAT.WOOD));
  assert.ok(tree.some((cell) => cell.mat === MAT.LEAVES));

  const house = buildSceneryCells('house', 20, 10, 20, 7, 64);
  assert.ok(house.some((cell) => cell.mat === MAT.WOOD));
  assert.ok(house.some((cell) => cell.mat === MAT.TERRACOTTA));
  for (const cell of house) {
    assert.ok(cell.vy >= 10 && cell.vy < 64);
    assert.ok(Math.abs(cell.vx - 20) <= 3);
    assert.ok(Math.abs(cell.vz - 20) <= 3);
  }
});

test('skyscraper is taller than tower and grove has multiple tree canopies', () => {
  const tower = buildSceneryCells('tower', 20, 10, 20, 1, 96);
  const skyscraper = buildSceneryCells('skyscraper', 20, 10, 20, 1, 96);
  const grove = buildSceneryCells('grove', 20, 10, 20, 1, 96);

  const towerTop = Math.max(...tower.map((cell) => cell.vy));
  const skyTop = Math.max(...skyscraper.map((cell) => cell.vy));
  assert.ok(skyTop > towerTop);
  assert.ok(skyscraper.some((cell) => cell.mat === MAT.LADDER));
  assert.ok(grove.filter((cell) => cell.mat === MAT.LEAVES).length > 20);
});
