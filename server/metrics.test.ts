import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLoopReport } from './loopReport.ts';
import { buildMetricsSnapshot } from './metrics.ts';

test('metrics snapshot exposes aggregates without prompt text', () => {
  const loop = buildLoopReport([], [], 'v1');
  const snapshot = buildMetricsSnapshot({
    loop,
    rooms: { rooms: 2, playing: 1, lobby: 1, humans: 5, bots: 3 },
    uptimeSec: 12.6,
    catalogVersion: 'v1',
    assetVersion: 'a1',
    generatedAt: 123,
  });

  assert.equal(snapshot.generatedAt, 123);
  assert.equal(snapshot.uptimeSec, 13);
  assert.equal(snapshot.catalogVersion, 'v1');
  assert.equal(snapshot.assetVersion, 'a1');
  assert.deepEqual(snapshot.rooms, {
    rooms: 2,
    playing: 1,
    lobby: 1,
    humans: 5,
    bots: 3,
  });
  assert.equal(snapshot.loop.submitted, 0);
  assert.equal(snapshot.loop.coverageRate, 0);
  assert.equal('topGaps' in snapshot.loop, false);
});
