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

test('metrics snapshot aggregates event feedback, kills and runtime stats', () => {
  const base = buildLoopReport([], [], 'v1');
  const loop = {
    ...base,
    items: [
      {
        itemId: 'evt_tornado',
        kind: 'event',
        demand: 10,
        partialDemand: 1,
        equips: 0,
        kills: 3,
        damage: 0,
        events: 5,
        survivals: 0,
        avgSurvivalSec: 0,
        feedbackUp: 4,
        feedbackDown: 1,
        killPerEquip: 0,
        damagePerEquip: 0,
        lastDemandAt: 0,
        lastUsageAt: 0,
      },
    ],
  } as typeof base;
  const snapshot = buildMetricsSnapshot({
    loop,
    rooms: { rooms: 1, playing: 1, lobby: 0, humans: 2, bots: 2, counterplayBlocks: 7 },
    uptimeSec: 5,
    catalogVersion: 'v1',
    assetVersion: 'a1',
    catalog: {
      usingIndex: true,
      shardCount: 10,
      cachedShards: 2,
      shardCacheMax: 8,
      shardLoads: 4,
      shardHits: 6,
      shardHitRate: 0.6,
      payloadLoads: 8,
      reloads: 1,
      lastReloadMs: 3.5,
    },
    resolver: {
      built: true,
      weaponEntries: 90,
      eventEntries: 30,
      weaponTokens: 98,
      eventTokens: 176,
      calls: 10,
      poolCalls: 6,
      fullCalls: 4,
      avgMs: 0.02,
      lastMs: 0.01,
      maxMs: 0.05,
      avgCandidates: 4,
      lastCandidates: 3,
    },
    assets: {
      coreRequests: 2,
      subsetRequests: 5,
      fullRequests: 0,
      requestedIds: 20,
      servedAssets: 18,
      rejectedRequests: 0,
    },
  });

  assert.equal(snapshot.events.tracked, 1);
  assert.equal(snapshot.events.triggered, 5);
  assert.equal(snapshot.events.kills, 3);
  assert.equal(snapshot.events.feedbackUp, 4);
  assert.equal(snapshot.events.feedbackScore, 0.6);
  assert.equal(snapshot.events.top[0].itemId, 'evt_tornado');
  assert.equal(snapshot.rooms.counterplayBlocks, 7);
  assert.equal(snapshot.catalog.shardHitRate, 0.6);
  assert.equal(snapshot.resolver.lastCandidates, 3);
  assert.equal(snapshot.assets.servedAssets, 18);
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
