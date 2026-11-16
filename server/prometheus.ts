import type { MetricsSnapshot } from './metrics.ts';

function escapeLabel(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"');
}

function labelPairs(labels: Record<string, string | number>): string {
  const entries = Object.entries(labels);
  if (entries.length === 0) return '';
  return `{${entries
    .map(([key, value]) => `${key}="${escapeLabel(String(value))}"`)
    .join(',')}}`;
}

/**
 * Exposition Prometheus (text/plain; version=0.0.4) para o scrape da stack
 * existente. Valores são gauges do snapshot atual, não contadores acumulados.
 */
export function renderPrometheusMetrics(
  snapshot: MetricsSnapshot,
  backend: string,
): string {
  const lines: string[] = [];

  const add = (
    name: string,
    help: string,
    type: 'gauge' | 'counter',
    samples: Array<{ labels?: Record<string, string | number>; value: number }>,
  ): void => {
    lines.push(`# HELP ${name} ${help}`);
    lines.push(`# TYPE ${name} ${type}`);
    for (const sample of samples) {
      lines.push(`${name}${labelPairs(sample.labels ?? {})} ${sample.value}`);
    }
  };

  add('promptwarfare_up', 'API do Prompt Warfare está respondendo.', 'gauge', [
    { value: 1 },
  ]);
  add(
    'promptwarfare_uptime_seconds',
    'Uptime do processo em segundos.',
    'gauge',
    [{ value: snapshot.uptimeSec }],
  );
  add(
    'promptwarfare_metrics_generated_at_seconds',
    'Timestamp Unix do snapshot de métricas.',
    'gauge',
    [{ value: Math.round(snapshot.generatedAt / 1000) }],
  );
  add('promptwarfare_rooms', 'Salas no processo.', 'gauge', [
    { labels: { state: 'total' }, value: snapshot.rooms.rooms },
    { labels: { state: 'playing' }, value: snapshot.rooms.playing },
    { labels: { state: 'lobby' }, value: snapshot.rooms.lobby },
  ]);
  add('promptwarfare_players', 'Jogadores conectados.', 'gauge', [
    { labels: { kind: 'human' }, value: snapshot.rooms.humans },
    { labels: { kind: 'bot' }, value: snapshot.rooms.bots },
  ]);
  add('promptwarfare_catalog_info', 'Versão do catálogo ativo.', 'gauge', [
    { labels: { version: snapshot.catalogVersion }, value: 1 },
  ]);
  add('promptwarfare_assets_info', 'Versão do manifesto de assets.', 'gauge', [
    { labels: { version: snapshot.assetVersion }, value: 1 },
  ]);
  add('promptwarfare_ledger_backend_info', 'Backend do ledger.', 'gauge', [
    { labels: { backend }, value: 1 },
  ]);

  add(
    'promptwarfare_prompts_submitted',
    'Prompts humanos na janela de métricas.',
    'gauge',
    [{ value: snapshot.loop.submitted }],
  );
  add(
    'promptwarfare_coverage_ratio',
    'Cobertura de catálogo na janela (0..1).',
    'gauge',
    [{ value: snapshot.loop.coverageRate }],
  );
  add(
    'promptwarfare_partial_prompts',
    'Prompts com cobertura duvidosa na janela.',
    'gauge',
    [{ value: snapshot.loop.partial }],
  );
  add(
    'promptwarfare_catalog_gaps',
    'Prompt events classificados como lacuna de catálogo.',
    'gauge',
    [{ value: snapshot.loop.gaps }],
  );
  add(
    'promptwarfare_pool_misses',
    'Prompt events fora do arsenal da sala.',
    'gauge',
    [{ value: snapshot.loop.poolMisses }],
  );
  add(
    'promptwarfare_pool_miss_ratio',
    'Proporção de prompts fora do pool (0..1).',
    'gauge',
    [{ value: snapshot.loop.poolMissRate }],
  );
  add('promptwarfare_loop_versions', 'Versões de catálogo observadas.', 'gauge', [
    { value: snapshot.loop.versions },
  ]);
  add('promptwarfare_items', 'Itens com demanda ou uso.', 'gauge', [
    { labels: { kind: 'demand' }, value: snapshot.loop.itemsWithDemand },
    { labels: { kind: 'usage' }, value: snapshot.loop.itemsWithUsage },
  ]);
  add('promptwarfare_gap_status', 'Lacunas por status.', 'gauge', [
    { labels: { status: 'closed' }, value: snapshot.loop.closedGaps },
    { labels: { status: 'persistent' }, value: snapshot.loop.persistentGaps },
    { labels: { status: 'regressed' }, value: snapshot.loop.regressedGaps },
  ]);

  add(
    'promptwarfare_alert_active',
    'Alerta agregado ativo no snapshot.',
    'gauge',
    snapshot.alerts.map((alert) => ({
      labels: { code: alert.code, severity: alert.severity },
      value: 1,
    })),
  );

  return `${lines.join('\n')}\n`;
}
