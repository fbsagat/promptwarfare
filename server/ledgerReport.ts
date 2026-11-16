import type { LedgerPromptKind, PromptEventRow } from './ledger.ts';

export interface DemandIntent {
  canonicalKey: string;
  kind: LedgerPromptKind;
  examples: string[];
  count: number;
  itemId: string | null;
  strategy: string | null;
  lastSeenAt: number;
  gap: boolean;
  poolMiss: boolean;
  priority: number;
}

export interface DemandReport {
  generatedAt: number;
  catalogVersion: string;
  totals: {
    submitted: number;
    covered: number;
    uniqueIntents: number;
    gaps: number;
    opened: number;
    abandoned: number;
    cancelled: number;
    timedOut: number;
    partial: number;
    poolMisses: number;
    poolMissRate: number;
    seed: number;
    coverageRate: number;
  };
  topIntents: DemandIntent[];
  gaps: DemandIntent[];
  poolMisses: DemandIntent[];
  byItem: Array<{ itemId: string; kind: LedgerPromptKind; count: number }>;
}

export function isCoveredStrategy(strategy: string | null | undefined): boolean {
  return (
    strategy === 'alias' ||
    strategy === 'canonical' ||
    strategy === 'tags' ||
    strategy === 'composition'
  );
}

export function buildDemandReport(
  rows: PromptEventRow[],
  catalogVersion = '',
): DemandReport {
  const human = rows.filter(
    (row) => row.actor_type === 'human' || row.actor_type === 'seed',
  );
  const seed = human.filter((row) => row.actor_type === 'seed');
  const submitted = human.filter(
    (row) => row.phase === 'submitted' && row.prompt && row.canonical_key,
  );
  const opened = human.filter((row) => row.phase === 'opened');
  const cancelled = human.filter((row) => row.phase === 'cancelled');
  const timedOut = human.filter((row) => row.phase === 'timed_out');
  const partial = submitted.filter(
    (row) => row.strategy === 'partial' && row.pool_miss !== 1,
  );

  const bySession = new Map<string, Set<string>>();
  for (const row of human) {
    if (!bySession.has(row.session_id)) bySession.set(row.session_id, new Set());
    bySession.get(row.session_id)!.add(row.phase);
  }
  const abandoned = Array.from(bySession.values()).filter(
    (phases) => phases.has('opened') && !phases.has('submitted'),
  ).length;

  const groups = new Map<string, DemandIntent>();
  for (const row of submitted) {
    const canonical = row.canonical_key ?? row.normalized_prompt ?? row.prompt ?? '';
    if (!canonical) continue;
    const poolMiss = row.pool_miss === 1;
    const covered = poolMiss || (Boolean(row.item_id) && isCoveredStrategy(row.strategy));
    const groupKey = poolMiss
      ? `pool:${canonical}`
      : covered
        ? `item:${row.item_id}`
        : `gap:${canonical}`;
    const existing = groups.get(groupKey);
    if (existing) {
      existing.count += 1;
      existing.lastSeenAt = Math.max(existing.lastSeenAt, row.created_at);
      existing.itemId = row.item_id ?? existing.itemId;
      existing.strategy = row.strategy ?? existing.strategy;
      existing.gap = !existing.poolMiss && (!isCoveredStrategy(existing.strategy) || !existing.itemId);
      if (row.prompt && existing.examples.length < 8 && !existing.examples.includes(row.prompt)) {
        existing.examples.push(row.prompt);
      }
    } else {
      groups.set(groupKey, {
        canonicalKey: canonical,
        kind: row.kind,
        examples: row.prompt ? [row.prompt] : [],
        count: 1,
        itemId: row.item_id,
        strategy: row.strategy,
        lastSeenAt: row.created_at,
        gap: !poolMiss && !covered,
        poolMiss,
        priority: 0,
      });
    }
  }

  const intents = Array.from(groups.values()).sort(
    (a, b) => b.count - a.count || b.lastSeenAt - a.lastSeenAt,
  );
  for (const intent of intents) {
    const ageDays = Math.max(0, (Date.now() - intent.lastSeenAt) / 86_400_000);
    const recency = 1 + Math.max(0, 1 - ageDays / 30);
    intent.priority =
      Math.round(intent.count * recency * (intent.gap ? 1.5 : 1) * 10) / 10;
  }
  const gaps = intents
    .filter((intent) => intent.gap)
    .sort((a, b) => b.priority - a.priority || b.count - a.count);
  const poolMisses = intents
    .filter((intent) => intent.poolMiss)
    .sort((a, b) => b.count - a.count || b.lastSeenAt - a.lastSeenAt);
  const byItemMap = new Map<string, { itemId: string; kind: LedgerPromptKind; count: number }>();
  for (const row of submitted) {
    if (!row.item_id || row.pool_miss === 1) continue;
    const existing = byItemMap.get(row.item_id);
    if (existing) existing.count += 1;
    else byItemMap.set(row.item_id, { itemId: row.item_id, kind: row.kind, count: 1 });
  }

  const covered = submitted.filter(
    (row) =>
      row.pool_miss === 1 ||
      (Boolean(row.item_id) && isCoveredStrategy(row.strategy)),
  ).length;
  const poolMissCount = submitted.filter((row) => row.pool_miss === 1).length;

  return {
    generatedAt: Date.now(),
    catalogVersion,
    totals: {
      submitted: submitted.length,
      covered,
      uniqueIntents: intents.length,
      gaps: gaps.length,
      opened: opened.length,
      abandoned,
      cancelled: cancelled.length,
      timedOut: timedOut.length,
      partial: partial.length,
      poolMisses: poolMissCount,
      poolMissRate:
        submitted.length > 0
          ? Math.round((poolMissCount / submitted.length) * 1000) / 1000
          : 0,
      seed: seed.length,
      coverageRate:
        submitted.length > 0
          ? Math.round((covered / submitted.length) * 1000) / 1000
          : 0,
    },
    topIntents: intents.slice(0, 50),
    gaps: gaps.slice(0, 50),
    poolMisses: poolMisses.slice(0, 50),
    byItem: Array.from(byItemMap.values()).sort((a, b) => b.count - a.count),
  };
}

export function renderDemandReportMarkdown(report: DemandReport): string {
  const lines: string[] = [
    '# Relatório de demanda',
    '',
    `- **Gerado em:** ${new Date(report.generatedAt).toISOString()}`,
    `- **Versão do catálogo:** ${report.catalogVersion || 'desconhecida'}`,
    `- **Prompts enviados:** ${report.totals.submitted}`,
    `- **Intenções únicas:** ${report.totals.uniqueIntents}`,
    `- **Lacunas:** ${report.totals.gaps}`,
    `- **Cobertura duvidosa:** ${report.totals.partial}`,
    `- **Fora do arsenal da sala:** ${report.totals.poolMisses} (${(report.totals.poolMissRate * 100).toFixed(1)}%)`,
    `- **Cobertura:** ${(report.totals.coverageRate * 100).toFixed(1)}%`,
    `- **Abertos:** ${report.totals.opened} · **Abandonados:** ${report.totals.abandoned} · **Cancelados:** ${report.totals.cancelled} · **Timeout:** ${report.totals.timedOut}`,
    `- **Demanda inicial sintética:** ${report.totals.seed} eventos`,
    '',
    '## Intenções mais pedidas',
    '',
    '| Intenção | Pedidos | Item | Estratégia | Exemplos |',
    '| --- | ---: | --- | --- | --- |',
  ];

  for (const intent of report.topIntents) {
    lines.push(
      `| ${intent.kind}: ${intent.canonicalKey.replace(/\|/g, ' · ')} | ${intent.count} | ${
        intent.itemId ?? '—'
      } | ${intent.strategy ?? '—'} | ${intent.examples.join(' · ')} |`,
    );
  }

  lines.push('', '## Lacunas para produzir', '');
  if (report.gaps.length === 0) {
    lines.push('Nenhuma lacuna registrada.');
  } else {
    lines.push('| Intenção | Pedidos | Exemplos |', '| --- | ---: | --- |');
    for (const gap of report.gaps) {
      lines.push(
        `| ${gap.kind}: ${gap.canonicalKey.replace(/\|/g, ' · ')} | ${gap.count} | ${gap.examples.join(' · ')} |`,
      );
    }
  }

  lines.push('', '## Fora do arsenal da sala (não é lacuna de catálogo)', '');
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

  lines.push('', '## Itens mais servidos', '');
  if (report.byItem.length === 0) {
    lines.push('Nenhum item servido.');
  } else {
    lines.push('| Item | Tipo | Usos |', '| --- | --- | ---: |');
    for (const item of report.byItem) {
      lines.push(`| ${item.itemId} | ${item.kind} | ${item.count} |`);
    }
  }

  return `${lines.join('\n')}\n`;
}
