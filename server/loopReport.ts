import type { ContentUsageRow, LedgerPromptKind, PromptEventRow } from './ledger.ts';
import { isCoveredStrategy } from './ledgerReport.ts';

export type LoopGapStatus = 'persistent' | 'closed' | 'regressed';

export interface LoopVersionMetrics {
  version: string;
  submitted: number;
  covered: number;
  partial: number;
  gaps: number;
  poolMisses: number;
  coverageRate: number;
  firstSeenAt: number;
  lastSeenAt: number;
}

export interface LoopPoolMiss {
  canonicalKey: string;
  kind: LedgerPromptKind;
  count: number;
  examples: string[];
  itemId: string | null;
  strategy: string | null;
  lastSeenAt: number;
}

export interface LoopGap {
  canonicalKey: string;
  kind: LedgerPromptKind;
  status: LoopGapStatus;
  count: number;
  examples: string[];
  itemId: string | null;
  strategy: string | null;
  firstGapVersion: string;
  lastGapVersion: string;
  lastSeenAt: number;
}

export interface LoopItemMetrics {
  itemId: string;
  kind: LedgerPromptKind;
  demand: number;
  partialDemand: number;
  equips: number;
  kills: number;
  damage: number;
  events: number;
  survivals: number;
  avgSurvivalSec: number;
  feedbackUp: number;
  feedbackDown: number;
  killPerEquip: number;
  damagePerEquip: number;
  lastDemandAt: number;
  lastUsageAt: number;
}

export interface LoopReport {
  generatedAt: number;
  catalogVersion: string;
  totals: {
    versions: number;
    submitted: number;
    covered: number;
    partial: number;
    gaps: number;
    poolMisses: number;
    poolMissRate: number;
    closedGaps: number;
    persistentGaps: number;
    regressedGaps: number;
    itemsWithDemand: number;
    itemsWithUsage: number;
    coverageRate: number;
  };
  versions: LoopVersionMetrics[];
  gaps: LoopGap[];
  poolMisses: LoopPoolMiss[];
  items: LoopItemMetrics[];
}

interface VersionAccumulator {
  submitted: number;
  covered: number;
  partial: number;
  gaps: number;
  poolMisses: number;
  firstSeenAt: number;
  lastSeenAt: number;
}

interface CanonicalHistory {
  canonicalKey: string;
  kind: LedgerPromptKind;
  count: number;
  examples: string[];
  versions: Map<string, 'covered' | 'gap'>;
  latestVersion: string;
  latestStrategy: string | null;
  latestItemId: string | null;
  lastSeenAt: number;
}

function parseMetadata(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function versionOf(row: PromptEventRow): string {
  return row.catalog_version || 'desconhecida';
}

function compareVersions(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true });
}

function coverageRate(covered: number, submitted: number): number {
  return submitted > 0 ? Math.round((covered / submitted) * 1000) / 1000 : 0;
}

function ensureItem(
  items: Map<string, LoopItemMetrics>,
  itemId: string,
  kind: LedgerPromptKind,
): LoopItemMetrics {
  let item = items.get(itemId);
  if (!item) {
    item = {
      itemId,
      kind,
      demand: 0,
      partialDemand: 0,
      equips: 0,
      kills: 0,
      damage: 0,
      events: 0,
      survivals: 0,
      avgSurvivalSec: 0,
      feedbackUp: 0,
      feedbackDown: 0,
      killPerEquip: 0,
      damagePerEquip: 0,
      lastDemandAt: 0,
      lastUsageAt: 0,
    };
    items.set(itemId, item);
  }
  return item;
}

export function buildLoopReport(
  promptRows: PromptEventRow[],
  usageRows: ContentUsageRow[],
  catalogVersion = '',
  opts: { includeBots?: boolean } = {},
): LoopReport {
  const includeBots = opts.includeBots ?? false;
  const human = promptRows.filter(
    (row) => row.actor_type === 'human' || row.actor_type === 'seed',
  );
  const submitted = human.filter(
    (row) => row.phase === 'submitted' && row.prompt && row.canonical_key,
  );
  const usage = usageRows.filter((row) => includeBots || row.actor_type === 'human');

  const versions = new Map<string, VersionAccumulator>();
  const histories = new Map<string, CanonicalHistory>();
  const poolMissGroups = new Map<string, LoopPoolMiss>();
  const items = new Map<string, LoopItemMetrics>();
  let coveredTotal = 0;
  let partialTotal = 0;
  let gapTotal = 0;
  let poolMissTotal = 0;

  for (const row of submitted) {
    const version = versionOf(row);
    const poolMiss = row.pool_miss === 1;
    const covered = poolMiss || isCoveredStrategy(row.strategy);
    const partial = !poolMiss && row.strategy === 'partial';
    const versionEntry =
      versions.get(version) ??
      ({
        submitted: 0,
        covered: 0,
        partial: 0,
        gaps: 0,
        poolMisses: 0,
        firstSeenAt: row.created_at,
        lastSeenAt: row.created_at,
      } satisfies VersionAccumulator);
    versionEntry.submitted += 1;
    if (covered) versionEntry.covered += 1;
    else if (partial) versionEntry.partial += 1;
    else versionEntry.gaps += 1;
    if (poolMiss) versionEntry.poolMisses += 1;
    versionEntry.firstSeenAt = Math.min(versionEntry.firstSeenAt, row.created_at);
    versionEntry.lastSeenAt = Math.max(versionEntry.lastSeenAt, row.created_at);
    versions.set(version, versionEntry);

    if (covered) coveredTotal += 1;
    else if (partial) partialTotal += 1;
    else gapTotal += 1;
    if (poolMiss) poolMissTotal += 1;

    const canonical = row.canonical_key ?? row.normalized_prompt ?? row.prompt ?? '';
    if (!canonical) continue;

    if (poolMiss) {
      const miss =
        poolMissGroups.get(canonical) ??
        ({
          canonicalKey: canonical,
          kind: row.kind,
          count: 0,
          examples: [],
          itemId: row.item_id,
          strategy: row.strategy,
          lastSeenAt: row.created_at,
        } satisfies LoopPoolMiss);
      miss.count += 1;
      miss.lastSeenAt = Math.max(miss.lastSeenAt, row.created_at);
      miss.itemId = row.item_id ?? miss.itemId;
      miss.strategy = row.strategy ?? miss.strategy;
      if (row.prompt && miss.examples.length < 8 && !miss.examples.includes(row.prompt)) {
        miss.examples.push(row.prompt);
      }
      poolMissGroups.set(canonical, miss);
      continue;
    }

    const history =
      histories.get(canonical) ??
      ({
        canonicalKey: canonical,
        kind: row.kind,
        count: 0,
        examples: [],
        versions: new Map<string, 'covered' | 'gap'>(),
        latestVersion: version,
        latestStrategy: row.strategy,
        latestItemId: row.item_id,
        lastSeenAt: row.created_at,
      } satisfies CanonicalHistory);
    history.count += 1;
    history.versions.set(version, covered ? 'covered' : 'gap');
    if (
      compareVersions(version, history.latestVersion) > 0 ||
      (version === history.latestVersion && row.created_at >= history.lastSeenAt)
    ) {
      history.latestVersion = version;
      history.latestStrategy = row.strategy;
      history.latestItemId = row.item_id;
      history.lastSeenAt = row.created_at;
    }
    if (
      row.prompt &&
      history.examples.length < 8 &&
      !history.examples.includes(row.prompt)
    ) {
      history.examples.push(row.prompt);
    }
    histories.set(canonical, history);

    if (row.item_id) {
      const item = ensureItem(items, row.item_id, row.kind);
      if (covered) item.demand += 1;
      else if (partial) item.partialDemand += 1;
      item.lastDemandAt = Math.max(item.lastDemandAt, row.created_at);
    }
  }

  for (const row of usage) {
    const item = ensureItem(items, row.item_id, row.kind);
    const metadata = parseMetadata(row.metadata_json);
    if (row.role === 'equip') item.equips += 1;
    else if (row.role === 'kill') item.kills += 1;
    else if (row.role === 'damage') {
      item.damage += typeof metadata.damage === 'number' ? metadata.damage : 0;
    } else if (row.role === 'event') item.events += 1;
    else if (row.role === 'survival') {
      item.survivals += 1;
      const survivedSec =
        typeof metadata.survivedSec === 'number' ? metadata.survivedSec : 0;
      item.avgSurvivalSec += survivedSec;
    } else if (row.role === 'feedback') {
      if (metadata.rating === 1) item.feedbackUp += 1;
      else if (metadata.rating === -1) item.feedbackDown += 1;
    }
    item.lastUsageAt = Math.max(item.lastUsageAt, row.created_at);
  }

  const gaps: LoopGap[] = [];
  for (const history of histories.values()) {
    const seenVersions = Array.from(history.versions.keys()).sort(compareVersions);
    if (seenVersions.length === 0) continue;
    const latestStatus = history.versions.get(seenVersions[seenVersions.length - 1]);
    if (latestStatus !== 'gap') {
      const hadGap = seenVersions.some((version) => history.versions.get(version) === 'gap');
      if (hadGap) {
        gaps.push({
          canonicalKey: history.canonicalKey,
          kind: history.kind,
          status: 'closed',
          count: history.count,
          examples: history.examples,
          itemId: history.latestItemId,
          strategy: history.latestStrategy,
          firstGapVersion:
            seenVersions.find((version) => history.versions.get(version) === 'gap') ?? '',
          lastGapVersion:
            [...seenVersions]
              .reverse()
              .find((version) => history.versions.get(version) === 'gap') ?? '',
          lastSeenAt: history.lastSeenAt,
        });
      }
      continue;
    }
    const earlierCovered = seenVersions
      .slice(0, -1)
      .some((version) => history.versions.get(version) === 'covered');
    gaps.push({
      canonicalKey: history.canonicalKey,
      kind: history.kind,
      status: earlierCovered ? 'regressed' : 'persistent',
      count: history.count,
      examples: history.examples,
      itemId: history.latestItemId,
      strategy: history.latestStrategy,
      firstGapVersion:
        seenVersions.find((version) => history.versions.get(version) === 'gap') ?? '',
      lastGapVersion:
        [...seenVersions]
          .reverse()
          .find((version) => history.versions.get(version) === 'gap') ?? '',
      lastSeenAt: history.lastSeenAt,
    });
  }

  for (const item of items.values()) {
    item.killPerEquip = item.equips > 0 ? Math.round((item.kills / item.equips) * 100) / 100 : 0;
    item.damagePerEquip =
      item.equips > 0 ? Math.round((item.damage / item.equips) * 10) / 10 : 0;
    if (item.survivals > 0) {
      item.avgSurvivalSec = Math.round(item.avgSurvivalSec / item.survivals);
    }
  }

  const versionList = Array.from(versions.entries())
    .map(([version, entry]) => ({
      version,
      submitted: entry.submitted,
      covered: entry.covered,
      partial: entry.partial,
      gaps: entry.gaps,
      poolMisses: entry.poolMisses,
      coverageRate: coverageRate(entry.covered, entry.submitted),
      firstSeenAt: entry.firstSeenAt,
      lastSeenAt: entry.lastSeenAt,
    }))
    .sort((a, b) => compareVersions(a.version, b.version));

  const itemList = Array.from(items.values()).sort(
    (a, b) =>
      b.demand - a.demand ||
      b.equips - a.equips ||
      b.kills - a.kills ||
      a.itemId.localeCompare(b.itemId),
  );

  return {
    generatedAt: Date.now(),
    catalogVersion,
    totals: {
      versions: versionList.length,
      submitted: submitted.length,
      covered: coveredTotal,
      partial: partialTotal,
      gaps: gapTotal,
      poolMisses: poolMissTotal,
      poolMissRate: coverageRate(poolMissTotal, submitted.length),
      closedGaps: gaps.filter((gap) => gap.status === 'closed').length,
      persistentGaps: gaps.filter((gap) => gap.status === 'persistent').length,
      regressedGaps: gaps.filter((gap) => gap.status === 'regressed').length,
      itemsWithDemand: itemList.filter((item) => item.demand + item.partialDemand > 0).length,
      itemsWithUsage: itemList.filter(
        (item) => item.equips + item.events + item.survivals > 0,
      ).length,
      coverageRate: coverageRate(coveredTotal, submitted.length),
    },
    versions: versionList,
    gaps: gaps.sort(
      (a, b) =>
        (a.status === 'regressed' ? -1 : a.status === 'persistent' ? 0 : 1) -
          (b.status === 'regressed' ? -1 : b.status === 'persistent' ? 0 : 1) ||
        b.count - a.count ||
        b.lastSeenAt - a.lastSeenAt,
    ),
    poolMisses: Array.from(poolMissGroups.values()).sort(
      (a, b) => b.count - a.count || b.lastSeenAt - a.lastSeenAt,
    ),
    items: itemList,
  };
}

export function renderLoopReportMarkdown(report: LoopReport): string {
  const lines: string[] = [
    '# Relatório do loop de conteúdo',
    '',
    `- **Gerado em:** ${new Date(report.generatedAt).toISOString()}`,
    `- **Versão do catálogo:** ${report.catalogVersion || 'desconhecida'}`,
    `- **Versões observadas:** ${report.totals.versions}`,
    `- **Prompts enviados:** ${report.totals.submitted}`,
    `- **Cobertura:** ${(report.totals.coverageRate * 100).toFixed(1)}%`,
    `- **Cobertura duvidosa:** ${report.totals.partial}`,
    `- **Fora do arsenal da sala:** ${report.totals.poolMisses} (${(report.totals.poolMissRate * 100).toFixed(1)}%)`,
    `- **Lacunas fechadas:** ${report.totals.closedGaps} · **persistentes:** ${report.totals.persistentGaps} · **regredidas:** ${report.totals.regressedGaps}`,
    '',
    '## Cobertura por versão',
    '',
    '| Versão | Prompts | Cobertos | Duvidosos | Lacunas | Fora do pool | Taxa |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: |',
  ];

  for (const version of report.versions) {
    lines.push(
      `| ${version.version} | ${version.submitted} | ${version.covered} | ${version.partial} | ${version.gaps} | ${version.poolMisses} | ${(version.coverageRate * 100).toFixed(1)}% |`,
    );
  }

  lines.push('', '## Lacunas: fechadas, persistentes e regredidas', '');
  if (report.gaps.length === 0) {
    lines.push('Nenhuma lacuna observada.');
  } else {
    lines.push(
      '| Status | Intenção | Pedidos | Item atual | Última versão | Exemplos |',
      '| --- | --- | ---: | --- | --- | --- |',
    );
    for (const gap of report.gaps) {
      lines.push(
        `| ${gap.status} | ${gap.kind}: ${gap.canonicalKey.replace(/\|/g, ' · ')} | ${gap.count} | ${gap.itemId ?? '—'} | ${gap.lastGapVersion} | ${gap.examples.join(' · ')} |`,
      );
    }
  }

  lines.push('', '## Fora do arsenal da sala', '');
  if (report.poolMisses.length === 0) {
    lines.push('Nenhum pedido ficou fora do pool.');
  } else {
    lines.push(
      '| Intenção | Pedidos | Item servido no pool | Exemplos |',
      '| --- | ---: | --- | --- |',
    );
    for (const miss of report.poolMisses) {
      lines.push(
        `| ${miss.kind}: ${miss.canonicalKey.replace(/\|/g, ' · ')} | ${miss.count} | ${miss.itemId ?? '—'} | ${miss.examples.join(' · ')} |`,
      );
    }
  }

  lines.push('', '## Demanda x uso por item', '');
  if (report.items.length === 0) {
    lines.push('Nenhum item com demanda ou uso.');
  } else {
    lines.push(
      '| Item | Tipo | Demanda | Duvidosa | Equips | Abates | Dano | Eventos | Sobrevivência | Feedback |',
      '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    );
    for (const item of report.items) {
      lines.push(
        `| ${item.itemId} | ${item.kind} | ${item.demand} | ${item.partialDemand} | ${item.equips} | ${item.kills} | ${item.damage} | ${item.events} | ${item.survivals} (${item.avgSurvivalSec}s) | +${item.feedbackUp}/-${item.feedbackDown} |`,
      );
    }
  }

  lines.push('', '## Qualidade por item', '');
  if (report.items.length === 0) {
    lines.push('Sem dados de qualidade.');
  } else {
    lines.push(
      '| Item | Abates/equip | Dano/equip |',
      '| --- | ---: | ---: |',
    );
    for (const item of report.items) {
      if (item.equips === 0) continue;
      lines.push(`| ${item.itemId} | ${item.killPerEquip} | ${item.damagePerEquip} |`);
    }
  }

  return `${lines.join('\n')}\n`;
}
