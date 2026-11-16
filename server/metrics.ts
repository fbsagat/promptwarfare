import type { LoopReport } from './loopReport.ts';

export interface RuntimeStats {
  rooms: number;
  playing: number;
  lobby: number;
  humans: number;
  bots: number;
}

export interface MetricsSnapshot {
  generatedAt: number;
  uptimeSec: number;
  catalogVersion: string;
  assetVersion: string;
  rooms: RuntimeStats;
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
