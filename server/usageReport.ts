import type { ContentUsageRow, LedgerPromptKind } from './ledger.ts';

export interface UsageItemSummary {
  itemId: string;
  kind: LedgerPromptKind;
  equips: number;
  kills: number;
  damage: number;
  events: number;
  survivals: number;
  avgSurvivalSec: number;
  feedbackUp: number;
  feedbackDown: number;
  uniqueActors: number;
  killPerEquip: number;
  damagePerEquip: number;
  lastUsedAt: number;
}

export interface UsageReport {
  generatedAt: number;
  catalogVersion: string;
  totals: {
    equips: number;
    kills: number;
    damage: number;
    events: number;
    survivals: number;
    feedbackUp: number;
    feedbackDown: number;
    uniqueItems: number;
    uniqueActors: number;
  };
  items: UsageItemSummary[];
}

function parseMetadata(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function buildUsageReport(
  rows: ContentUsageRow[],
  catalogVersion = '',
  opts: { includeBots?: boolean } = {},
): UsageReport {
  const includeBots = opts.includeBots ?? false;
  const filtered = rows.filter(
    (row) => includeBots || row.actor_type === 'human',
  );
  const items = new Map<
    string,
    UsageItemSummary & { actors: Set<string>; survivalSec: number }
  >();
  const actors = new Set<string>();

  for (const row of filtered) {
    if (row.actor_ref) actors.add(row.actor_ref);
    let item = items.get(row.item_id);
    if (!item) {
      item = {
        itemId: row.item_id,
        kind: row.kind,
        equips: 0,
        kills: 0,
        damage: 0,
        events: 0,
        survivals: 0,
        avgSurvivalSec: 0,
        feedbackUp: 0,
        feedbackDown: 0,
        uniqueActors: 0,
        killPerEquip: 0,
        damagePerEquip: 0,
        lastUsedAt: 0,
        actors: new Set<string>(),
        survivalSec: 0,
      };
      items.set(row.item_id, item);
    }
    const metadata = parseMetadata(row.metadata_json);
    if (row.role === 'equip') item.equips += 1;
    else if (row.role === 'kill') item.kills += 1;
    else if (row.role === 'damage') {
      item.damage += typeof metadata.damage === 'number' ? metadata.damage : 0;
    } else if (row.role === 'event') item.events += 1;
    else if (row.role === 'survival') {
      item.survivals += 1;
      item.survivalSec +=
        typeof metadata.survivedSec === 'number' ? metadata.survivedSec : 0;
    } else if (row.role === 'feedback') {
      if (metadata.rating === 1) item.feedbackUp += 1;
      else if (metadata.rating === -1) item.feedbackDown += 1;
    }
    if (row.actor_ref) item.actors.add(row.actor_ref);
    item.lastUsedAt = Math.max(item.lastUsedAt, row.created_at);
  }

  const summaries: UsageItemSummary[] = Array.from(items.values())
    .map((item) => ({
      itemId: item.itemId,
      kind: item.kind,
      equips: item.equips,
      kills: item.kills,
      damage: Math.round(item.damage * 10) / 10,
      events: item.events,
      survivals: item.survivals,
      avgSurvivalSec:
        item.survivals > 0
          ? Math.round((item.survivalSec / item.survivals) * 10) / 10
          : 0,
      feedbackUp: item.feedbackUp,
      feedbackDown: item.feedbackDown,
      uniqueActors: item.actors.size,
      killPerEquip:
        item.equips > 0 ? Math.round((item.kills / item.equips) * 1000) / 1000 : 0,
      damagePerEquip:
        item.equips > 0 ? Math.round((item.damage / item.equips) * 10) / 10 : 0,
      lastUsedAt: item.lastUsedAt,
    }))
    .sort(
      (a, b) =>
        b.damage - a.damage ||
        b.kills - a.kills ||
        b.events - a.events ||
        b.equips - a.equips ||
        b.lastUsedAt - a.lastUsedAt,
    );

  return {
    generatedAt: Date.now(),
    catalogVersion,
    totals: {
      equips: filtered.filter((row) => row.role === 'equip').length,
      kills: filtered.filter((row) => row.role === 'kill').length,
      damage:
        Math.round(
          summaries.reduce((sum, item) => sum + item.damage, 0) * 10,
        ) / 10,
      events: filtered.filter((row) => row.role === 'event').length,
      survivals: filtered.filter((row) => row.role === 'survival').length,
      feedbackUp: summaries.reduce((sum, item) => sum + item.feedbackUp, 0),
      feedbackDown: summaries.reduce((sum, item) => sum + item.feedbackDown, 0),
      uniqueItems: summaries.length,
      uniqueActors: actors.size,
    },
    items: summaries,
  };
}

export function renderUsageReportMarkdown(report: UsageReport): string {
  const lines = [
    '# Relatório de uso e qualidade',
    '',
    `- **Gerado em:** ${new Date(report.generatedAt).toISOString()}`,
    `- **Versão do catálogo:** ${report.catalogVersion || 'desconhecida'}`,
    `- **Equipes:** ${report.totals.equips} · **Abates:** ${report.totals.kills} · **Dano:** ${report.totals.damage} · **Eventos:** ${report.totals.events}`,
    `- **Sobrevivências:** ${report.totals.survivals} · **Feedback:** 👍 ${report.totals.feedbackUp} / 👎 ${report.totals.feedbackDown}`,
    `- **Itens usados:** ${report.totals.uniqueItems} · **Jogadores:** ${report.totals.uniqueActors}`,
    '',
    '| Item | Tipo | Equipes | Abates | Dano | Dano/equipe | Eventos | Sobrev. média | 👍 | 👎 |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
  ];
  for (const item of report.items) {
    lines.push(
      `| ${item.itemId} | ${item.kind} | ${item.equips} | ${item.kills} | ${item.damage} | ${item.damagePerEquip.toFixed(1)} | ${item.events} | ${item.avgSurvivalSec.toFixed(1)}s | ${item.feedbackUp} | ${item.feedbackDown} |`,
    );
  }
  return `${lines.join('\n')}\n`;
}
