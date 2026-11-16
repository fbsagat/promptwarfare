import type { LoopReport } from './loopReport.ts';

export interface RuntimeStats {
  rooms: number;
  playing: number;
  lobby: number;
  humans: number;
  bots: number;
}

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
  generatedAt?: number;
}): MetricsSnapshot {
  return {
    generatedAt: input.generatedAt ?? Date.now(),
    uptimeSec: Math.round(input.uptimeSec),
    catalogVersion: input.catalogVersion,
    assetVersion: input.assetVersion,
    rooms: input.rooms,
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
