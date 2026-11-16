import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLoopReport } from './loopReport.ts';
import { buildMetricsSnapshot } from './metrics.ts';
import { renderPrometheusMetrics } from './prometheus.ts';

test('renderPrometheusMetrics exposes gauges, labels and active alerts', () => {
  const loop = buildLoopReport([], [], '2026-11-16.3');
  const snapshot = buildMetricsSnapshot({
    loop,
    rooms: { rooms: 2, playing: 1, lobby: 1, humans: 5, bots: 3 },
    uptimeSec: 12,
    catalogVersion: '2026-11-16.3',
    assetVersion: '2026-11-16.1',
    generatedAt: 1_700_000_000_000,
  });
  const text = renderPrometheusMetrics(snapshot, 'sqlite');

  assert.match(text, /# TYPE promptwarfare_up gauge/);
  assert.match(text, /promptwarfare_up 1/);
  assert.match(text, /promptwarfare_rooms\{state="playing"\} 1/);
  assert.match(text, /promptwarfare_players\{kind="human"\} 5/);
  assert.match(text, /promptwarfare_catalog_info\{version="2026-11-16\.3"\} 1/);
  assert.match(text, /promptwarfare_ledger_backend_info\{backend="sqlite"\} 1/);
  assert.match(text, /promptwarfare_metrics_generated_at_seconds 1700000000/);
  assert.match(text, /# TYPE promptwarfare_alert_active gauge/);
  assert.doesNotMatch(text, /promptwarfare_alert_active\{/);
});

test('renderPrometheusMetrics includes alert samples and escapes labels', () => {
  const loop = buildLoopReport([], [], 'v1');
  const snapshot = buildMetricsSnapshot({
    loop: {
      ...loop,
      totals: {
        ...loop.totals,
        submitted: 25,
        coverageRate: 0.2,
        poolMissRate: 0.4,
        regressedGaps: 1,
        partial: 10,
        covered: 5,
        itemsWithUsage: 0,
      },
    },
    rooms: { rooms: 0, playing: 0, lobby: 0, humans: 0, bots: 0 },
    uptimeSec: 1,
    catalogVersion: 'v"1',
    assetVersion: 'a1',
    generatedAt: 1_700_000_000_000,
  });
  const text = renderPrometheusMetrics(snapshot, 'postgres');
  assert.match(text, /promptwarfare_catalog_info\{version="v\\"1"\} 1/);
  assert.match(
    text,
    /promptwarfare_alert_active\{code="LOW_COVERAGE",severity="warning"\} 1/,
  );
  assert.match(text, /promptwarfare_alert_active\{code="REGRESSED_GAPS"/);
});
