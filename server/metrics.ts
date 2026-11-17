import type { CatalogRuntimeStats, ResolverStats } from './catalog.ts';
import type { LoopReport } from './loopReport.ts';

export interface RuntimeStats {
  rooms: number;
  playing: number;
  lobby: number;
  humans: number;
  bots: number;
  /** Bloqueios de dano climático por teto/abrigo desde o boot. */
  counterplayBlocks?: number;
  /** Cache/prefetch de assets reportado pelos clientes. */
  clientAssets?: {
    loadedMax: number;
    requests: number;
    fetched: number;
    failed: number;
    bytes: number;
    reporters: number;
  };
}

export interface AssetRequestStats {
  coreRequests: number;
  subsetRequests: number;
  fullRequests: number;
  requestedIds: number;
  servedAssets: number;
  rejectedRequests: number;
}

export interface EventMetrics {
  tracked: number;
  triggered: number;
  kills: number;
  feedbackUp: number;
  feedbackDown: number;
  feedbackScore: number;
  top: Array<{
    itemId: string;
    events: number;
    kills: number;
    feedbackUp: number;
    feedbackDown: number;
    avgSurvivalSec: number;
  }>;
}

const EMPTY_CATALOG: CatalogRuntimeStats = {
  usingIndex: false,
  shardCount: 0,
  cachedShards: 0,
  shardCacheMax: 0,
  shardLoads: 0,
  shardHits: 0,
  shardHitRate: 0,
  payloadLoads: 0,
  reloads: 0,
  lastReloadMs: 0,
};

const EMPTY_RESOLVER: ResolverStats = {
  built: false,
  weaponEntries: 0,
  eventEntries: 0,
  weaponTokens: 0,
  eventTokens: 0,
  calls: 0,
  poolCalls: 0,
  fullCalls: 0,
  avgMs: 0,
  lastMs: 0,
  maxMs: 0,
  avgCandidates: 0,
  lastCandidates: 0,
};

const EMPTY_ASSETS: AssetRequestStats = {
  coreRequests: 0,
  subsetRequests: 0,
  fullRequests: 0,
  requestedIds: 0,
  servedAssets: 0,
  rejectedRequests: 0,
};

export type MetricsAlertCode =
  | 'LOW_COVERAGE'
  | 'HIGH_POOL_MISS'
  | 'REGRESSED_GAPS'
  | 'HIGH_PARTIAL'
  | 'NO_USAGE';

export interface MetricsAlert {
  code: MetricsAlertCode;
  severity: 'warning' | 'critical';
  message: string;
  value: number;
}

export interface MetricsSnapshot {
  generatedAt: number;
  uptimeSec: number;
  catalogVersion: string;
  assetVersion: string;
  rooms: RuntimeStats;
  catalog: CatalogRuntimeStats;
  resolver: ResolverStats;
  assets: AssetRequestStats;
  events: EventMetrics;
  alerts: MetricsAlert[];
  loop: {
    versions: number;
    submitted: number;
    covered: number;
    partial: number;
    gaps: number;
    poolMisses: number;
    poolMissRate: number;
    coverageRate: number;
    closedGaps: number;
    persistentGaps: number;
    regressedGaps: number;
    itemsWithDemand: number;
    itemsWithUsage: number;
    uniqueGapIntents: number;
  };
}

export function buildMetricsAlerts(loop: LoopReport): MetricsAlert[] {
  const alerts: MetricsAlert[] = [];
  const minSample = 20;
  if (loop.totals.submitted < minSample) return alerts;

  if (loop.totals.coverageRate < 0.35) {
    alerts.push({
      code: 'LOW_COVERAGE',
      severity: 'warning',
      message: 'Cobertura de catálogo abaixo de 35%.',
      value: loop.totals.coverageRate,
    });
  }
  if (loop.totals.poolMissRate > 0.35) {
    alerts.push({
      code: 'HIGH_POOL_MISS',
      severity: 'warning',
      message: 'Muitos pedidos caem fora do arsenal da sala; revisar tamanho/núcleo do pool.',
      value: loop.totals.poolMissRate,
    });
  }
  if (loop.totals.regressedGaps > 0) {
    alerts.push({
      code: 'REGRESSED_GAPS',
      severity: 'critical',
      message: 'Lacunas que estavam cobertas voltaram a aparecer.',
      value: loop.totals.regressedGaps,
    });
  }
  if (loop.totals.partial > loop.totals.covered) {
    alerts.push({
      code: 'HIGH_PARTIAL',
      severity: 'warning',
      message: 'Cobertura duvidosa supera a cobertura confiável.',
      value: loop.totals.partial,
    });
  }
  if (loop.totals.itemsWithUsage === 0) {
    alerts.push({
      code: 'NO_USAGE',
      severity: 'warning',
      message: 'Há demanda registrada, mas nenhum uso de item no período.',
      value: 0,
    });
  }
  return alerts;
}

export function buildMetricsSnapshot(input: {
  loop: LoopReport;
  rooms: RuntimeStats;
  uptimeSec: number;
  catalogVersion: string;
  assetVersion: string;
  catalog?: CatalogRuntimeStats;
  resolver?: ResolverStats;
  assets?: AssetRequestStats;
  generatedAt?: number;
}): MetricsSnapshot {
  const eventItems = input.loop.items.filter((item) => item.kind === 'event');
  const feedbackUp = eventItems.reduce((sum, item) => sum + item.feedbackUp, 0);
  const feedbackDown = eventItems.reduce((sum, item) => sum + item.feedbackDown, 0);
  const feedbackTotal = feedbackUp + feedbackDown;
  return {
    generatedAt: input.generatedAt ?? Date.now(),
    uptimeSec: Math.round(input.uptimeSec),
    catalogVersion: input.catalogVersion,
    assetVersion: input.assetVersion,
    rooms: input.rooms,
    catalog: input.catalog ?? EMPTY_CATALOG,
    resolver: input.resolver ?? EMPTY_RESOLVER,
    assets: input.assets ?? EMPTY_ASSETS,
    events: {
      tracked: eventItems.length,
      triggered: eventItems.reduce((sum, item) => sum + item.events, 0),
      kills: eventItems.reduce((sum, item) => sum + item.kills, 0),
      feedbackUp,
      feedbackDown,
      feedbackScore:
        feedbackTotal > 0 ? Math.round(((feedbackUp - feedbackDown) / feedbackTotal) * 100) / 100 : 0,
      top: eventItems
        .slice()
        .sort((a, b) => b.events - a.events || b.kills - a.kills)
        .slice(0, 5)
        .map((item) => ({
          itemId: item.itemId,
          events: item.events,
          kills: item.kills,
          feedbackUp: item.feedbackUp,
          feedbackDown: item.feedbackDown,
          avgSurvivalSec: item.avgSurvivalSec,
        })),
    },
    alerts: buildMetricsAlerts(input.loop),
    loop: {
      versions: input.loop.totals.versions,
      submitted: input.loop.totals.submitted,
      covered: input.loop.totals.covered,
      partial: input.loop.totals.partial,
      gaps: input.loop.totals.gaps,
      poolMisses: input.loop.totals.poolMisses,
      poolMissRate: input.loop.totals.poolMissRate,
      coverageRate: input.loop.totals.coverageRate,
      closedGaps: input.loop.totals.closedGaps,
      persistentGaps: input.loop.totals.persistentGaps,
      regressedGaps: input.loop.totals.regressedGaps,
      itemsWithDemand: input.loop.totals.itemsWithDemand,
      itemsWithUsage: input.loop.totals.itemsWithUsage,
      uniqueGapIntents: input.loop.gaps.length,
    },
  };
}
