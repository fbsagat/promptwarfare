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
  add(
    'promptwarfare_counterplay_blocks_total',
    'Dano climático bloqueado por teto/abrigo desde o boot.',
    'counter',
    [{ value: snapshot.rooms.counterplayBlocks ?? 0 }],
  );
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

  add('promptwarfare_catalog_index_loaded', 'Runtime usando índice quente.', 'gauge', [
    { value: snapshot.catalog.usingIndex ? 1 : 0 },
  ]);
  add('promptwarfare_catalog_shards', 'Shards do catálogo.', 'gauge', [
    { labels: { state: 'total' }, value: snapshot.catalog.shardCount },
    { labels: { state: 'cached' }, value: snapshot.catalog.cachedShards },
  ]);
  add('promptwarfare_catalog_shard_requests', 'Acessos a shards por resultado.', 'counter', [
    { labels: { result: 'hit' }, value: snapshot.catalog.shardHits },
    { labels: { result: 'load' }, value: snapshot.catalog.shardLoads },
  ]);
  add('promptwarfare_catalog_shard_hit_ratio', 'Taxa de acerto do LRU de shards.', 'gauge', [
    { value: snapshot.catalog.shardHitRate },
  ]);
  add('promptwarfare_catalog_payload_loads_total', 'Payloads materializados.', 'counter', [
    { value: snapshot.catalog.payloadLoads },
  ]);
  add('promptwarfare_catalog_reloads_total', 'Recargas de catálogo.', 'counter', [
    { value: snapshot.catalog.reloads },
  ]);
  add('promptwarfare_catalog_last_reload_ms', 'Duração da última recarga.', 'gauge', [
    { value: snapshot.catalog.lastReloadMs },
  ]);

  add('promptwarfare_resolver_calls_total', 'Chamadas do resolvedor por escopo.', 'counter', [
    { labels: { scope: 'pool' }, value: snapshot.resolver.poolCalls },
    { labels: { scope: 'full' }, value: snapshot.resolver.fullCalls },
  ]);
  add('promptwarfare_resolver_duration_ms', 'Duração do resolvedor.', 'gauge', [
    { labels: { stat: 'avg' }, value: snapshot.resolver.avgMs },
    { labels: { stat: 'last' }, value: snapshot.resolver.lastMs },
    { labels: { stat: 'max' }, value: snapshot.resolver.maxMs },
  ]);
  add('promptwarfare_resolver_candidates', 'Candidatos pontuados por prompt.', 'gauge', [
    { labels: { stat: 'avg' }, value: snapshot.resolver.avgCandidates },
    { labels: { stat: 'last' }, value: snapshot.resolver.lastCandidates },
  ]);

  add('promptwarfare_asset_requests_total', 'Requisições de manifesto por tipo.', 'counter', [
    { labels: { kind: 'core' }, value: snapshot.assets.coreRequests },
    { labels: { kind: 'subset' }, value: snapshot.assets.subsetRequests },
    { labels: { kind: 'full' }, value: snapshot.assets.fullRequests },
  ]);
  add('promptwarfare_asset_requested_ids', 'Ids de asset pedidos ao servidor.', 'counter', [
    { value: snapshot.assets.requestedIds },
  ]);
  add('promptwarfare_asset_served', 'Assets servidos em subsets.', 'counter', [
    { value: snapshot.assets.servedAssets },
  ]);
  add('promptwarfare_asset_rejected_requests', 'Requisições de asset recusadas.', 'counter', [
    { value: snapshot.assets.rejectedRequests },
  ]);
  add(
    'promptwarfare_client_assets_loaded',
    'Maior working set de assets reportado por um cliente.',
    'gauge',
    [{ value: snapshot.rooms.clientAssets?.loadedMax ?? 0 }],
  );
  add(
    'promptwarfare_client_asset_fetches_total',
    'Buscas de assets reportadas pelos clientes.',
    'counter',
    [
      { labels: { result: 'request' }, value: snapshot.rooms.clientAssets?.requests ?? 0 },
      { labels: { result: 'fetched' }, value: snapshot.rooms.clientAssets?.fetched ?? 0 },
      { labels: { result: 'failed' }, value: snapshot.rooms.clientAssets?.failed ?? 0 },
    ],
  );
  add(
    'promptwarfare_client_asset_bytes',
    'Bytes de manifestos de assets baixados pelos clientes.',
    'counter',
    [{ value: snapshot.rooms.clientAssets?.bytes ?? 0 }],
  );

  add('promptwarfare_events_tracked', 'Eventos com uso/feedback na janela.', 'gauge', [
    { value: snapshot.events.tracked },
  ]);
  add('promptwarfare_event_triggers_total', 'Eventos acionados na janela.', 'counter', [
    { value: snapshot.events.triggered },
  ]);
  add('promptwarfare_event_kills_total', 'Abates causados por eventos.', 'counter', [
    { value: snapshot.events.kills },
  ]);
  add('promptwarfare_event_feedback', 'Feedback de eventos por rating.', 'gauge', [
    { labels: { rating: 'up' }, value: snapshot.events.feedbackUp },
    { labels: { rating: 'down' }, value: snapshot.events.feedbackDown },
  ]);
  add('promptwarfare_event_feedback_score', 'Feedback líquido de eventos (-1..1).', 'gauge', [
    { value: snapshot.events.feedbackScore },
  ]);
  add('promptwarfare_event_item_events', 'Top eventos por acionamentos.', 'gauge', [
    ...snapshot.events.top.map((event) => ({
      labels: { item: event.itemId },
      value: event.events,
    })),
  ]);
  add('promptwarfare_event_item_kills', 'Top eventos por abates.', 'gauge', [
    ...snapshot.events.top.map((event) => ({
      labels: { item: event.itemId },
      value: event.kills,
    })),
  ]);
  add('promptwarfare_event_item_feedback', 'Top eventos por feedback.', 'gauge', [
    ...snapshot.events.top.map((event) => ({
      labels: { item: event.itemId, rating: 'up' },
      value: event.feedbackUp,
    })),
    ...snapshot.events.top.map((event) => ({
      labels: { item: event.itemId, rating: 'down' },
      value: event.feedbackDown,
    })),
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
