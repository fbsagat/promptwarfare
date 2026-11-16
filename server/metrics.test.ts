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
  assert.deepEqual(snapshot.alerts, []);
  assert.equal('topGaps' in snapshot.loop, false);
});

test('metrics alerts flag low coverage, pool misses and regressions', () => {
  const base = buildLoopReport([], [], 'v1');
  const loop = {
    ...base,
    totals: {
      ...base.totals,
      submitted: 25,
      coverageRate: 0.2,
      poolMissRate: 0.4,
      regressedGaps: 2,
      partial: 10,
      covered: 5,
      itemsWithUsage: 0,
    },
  };
  const snapshot = buildMetricsSnapshot({
    loop,
    rooms: { rooms: 0, playing: 0, lobby: 0, humans: 0, bots: 0 },
    uptimeSec: 1,
    catalogVersion: 'v1',
    assetVersion: 'a1',
  });
  const codes = snapshot.alerts.map((alert) => alert.code);
  assert.ok(codes.includes('LOW_COVERAGE'));
  assert.ok(codes.includes('HIGH_POOL_MISS'));
  assert.ok(codes.includes('REGRESSED_GAPS'));
  assert.ok(codes.includes('HIGH_PARTIAL'));
  assert.ok(codes.includes('NO_USAGE'));
});
