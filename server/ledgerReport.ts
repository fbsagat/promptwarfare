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
}

export interface DemandReport {
  generatedAt: number;
  catalogVersion: string;
  totals: {
    submitted: number;
    uniqueIntents: number;
    gaps: number;
    opened: number;
    abandoned: number;
    cancelled: number;
    timedOut: number;
    seed: number;
    coverageRate: number;
  };
  topIntents: DemandIntent[];
  gaps: DemandIntent[];
  byItem: Array<{ itemId: string; kind: LedgerPromptKind; count: number }>;
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
    const covered = Boolean(row.item_id) && row.strategy !== 'default';
    const groupKey = covered ? `item:${row.item_id}` : `gap:${canonical}`;
    const existing = groups.get(groupKey);
    if (existing) {
      existing.count += 1;
      existing.lastSeenAt = Math.max(existing.lastSeenAt, row.created_at);
      existing.itemId = row.item_id ?? existing.itemId;
      existing.strategy = row.strategy ?? existing.strategy;
      existing.gap = existing.strategy === 'default' || !existing.itemId;
      if (row.prompt && existing.examples.length < 5 && !existing.examples.includes(row.prompt)) {
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
        gap: !covered,
      });
    }
  }

  const intents = Array.from(groups.values()).sort(
    (a, b) => b.count - a.count || b.lastSeenAt - a.lastSeenAt,
  );
  const gaps = intents.filter((intent) => intent.gap);
  const byItemMap = new Map<string, { itemId: string; kind: LedgerPromptKind; count: number }>();
  for (const row of submitted) {
    if (!row.item_id) continue;
    const existing = byItemMap.get(row.item_id);
    if (existing) existing.count += 1;
    else byItemMap.set(row.item_id, { itemId: row.item_id, kind: row.kind, count: 1 });
  }

  const covered = submitted.filter(
    (row) => Boolean(row.item_id) && row.strategy !== 'default',
  ).length;

  return {
    generatedAt: Date.now(),
    catalogVersion,
    totals: {
      submitted: submitted.length,
      uniqueIntents: intents.length,
      gaps: gaps.length,
      opened: opened.length,
      abandoned,
      cancelled: cancelled.length,
      timedOut: timedOut.length,
      seed: seed.length,
      coverageRate:
        submitted.length > 0
          ? Math.round((covered / submitted.length) * 1000) / 1000
          : 0,
    },
    topIntents: intents.slice(0, 50),
    gaps: gaps.slice(0, 50),
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
