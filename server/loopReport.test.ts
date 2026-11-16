import test from 'node:test';
import assert from 'node:assert/strict';
import type {
  ContentUsageRow,
  PromptEventRow,
} from './ledger.ts';
import { buildLoopReport, renderLoopReportMarkdown } from './loopReport.ts';

let nextId = 1;

function promptRow(overrides: Partial<PromptEventRow>): PromptEventRow {
  const id = nextId++;
  return {
    id,
    created_at: 1000 + id,
    session_id: `s${id}`,
    actor_type: 'human',
    actor_ref: 'p1',
    room_id: 'R1',
    match_id: 'M1',
    kind: 'weapon',
    phase: 'submitted',
    prompt: 'Pistola de gelo',
    normalized_prompt: 'pistola de gelo',
    canonical_key: 'gelo|pistola',
    item_id: 'wpn_pistol_ice',
    strategy: 'alias',
    catalog_version: 'v1',
    budget_used: 60,
    was_clamped: 0,
    elapsed_ms: 1000,
    reason: null,
    pool_hash: null,
    pool_miss: null,
    ...overrides,
  };
}

function usageRow(overrides: Partial<ContentUsageRow>): ContentUsageRow {
  const id = nextId++;
  return {
    id,
    created_at: 1000 + id,
    item_id: 'wpn_pistol_ice',
    kind: 'weapon',
    role: 'equip',
    actor_type: 'human',
    actor_ref: 'p1',
    room_id: 'R1',
    match_id: 'M1',
    target_ref: null,
    catalog_version: 'v2',
    metadata_json: null,
    ...overrides,
  };
}

test('loop report joins demand, usage and catalog versions', () => {
  const prompts: PromptEventRow[] = [
    // Fechada: gap em v1, coberta em v2.
    promptRow({
      created_at: 1000,
      canonical_key: 'congelante|pistola',
      prompt: 'pistola congelante',
      item_id: 'wpn_rifle_standard',
      strategy: 'default',
      catalog_version: 'v1',
    }),
    promptRow({
      created_at: 2000,
      canonical_key: 'congelante|pistola',
      prompt: 'pistola congelante',
      item_id: 'wpn_pistol_ice',
      strategy: 'alias',
      catalog_version: 'v2',
    }),
    // Persistente: gap em v1 e v2.
    promptRow({
      created_at: 1100,
      canonical_key: 'arco|gelo',
      prompt: 'arco de gelo',
      item_id: 'wpn_rifle_standard',
      strategy: 'default',
      catalog_version: 'v1',
    }),
    promptRow({
      created_at: 2100,
      canonical_key: 'arco|gelo',
      prompt: 'arco de gelo',
      item_id: 'wpn_rifle_standard',
      strategy: 'default',
      catalog_version: 'v2',
    }),
    // Regredida: coberta em v1, gap em v2.
    promptRow({
      created_at: 1200,
      canonical_key: 'chamas|lancador',
      prompt: 'lancador de chamas',
      item_id: 'wpn_launcher_fire',
      strategy: 'alias',
      catalog_version: 'v1',
    }),
    promptRow({
      created_at: 2200,
      canonical_key: 'chamas|lancador',
      prompt: 'lancador de chamas',
      item_id: 'wpn_launcher_standard',
      strategy: 'partial',
      catalog_version: 'v2',
    }),
    // Bots não entram na demanda humana.
    promptRow({
      actor_type: 'bot',
      canonical_key: 'bot|teste',
      prompt: 'teste de bot',
      item_id: 'wpn_rifle_standard',
      strategy: 'default',
      catalog_version: 'v2',
    }),
  ];

  const usage: ContentUsageRow[] = [
    usageRow({ role: 'equip' }),
    usageRow({ role: 'kill' }),
    usageRow({ role: 'damage', metadata_json: JSON.stringify({ damage: 30 }) }),
    usageRow({ role: 'survival', metadata_json: JSON.stringify({ survivedSec: 120 }) }),
    usageRow({ role: 'feedback', metadata_json: JSON.stringify({ rating: 1 }) }),
    usageRow({
      role: 'event',
      kind: 'event',
      item_id: 'evt_weather_meteor_shower',
      metadata_json: JSON.stringify({ archetype: 'WEATHER_HAZARD' }),
    }),
    usageRow({ role: 'equip', actor_type: 'bot', item_id: 'wpn_rifle_fire' }),
  ];

  const report = buildLoopReport(prompts, usage, 'v2');
  assert.equal(report.totals.versions, 2);
  assert.equal(report.totals.submitted, 6);
  assert.equal(report.totals.covered, 2);
  assert.equal(report.totals.partial, 1);
  assert.equal(report.totals.gaps, 3);
  assert.equal(report.totals.coverageRate, 0.333);
  assert.equal(report.totals.closedGaps, 1);
  assert.equal(report.totals.persistentGaps, 1);
  assert.equal(report.totals.regressedGaps, 1);

  const closed = report.gaps.find((gap) => gap.canonicalKey === 'congelante|pistola');
  assert.equal(closed?.status, 'closed');
  assert.equal(closed?.firstGapVersion, 'v1');
  assert.equal(closed?.lastGapVersion, 'v1');

  const persistent = report.gaps.find((gap) => gap.canonicalKey === 'arco|gelo');
  assert.equal(persistent?.status, 'persistent');
  assert.equal(persistent?.lastGapVersion, 'v2');

  const regressed = report.gaps.find((gap) => gap.canonicalKey === 'chamas|lancador');
  assert.equal(regressed?.status, 'regressed');
  assert.equal(regressed?.lastGapVersion, 'v2');

  const ice = report.items.find((item) => item.itemId === 'wpn_pistol_ice')!;
  assert.equal(ice.demand, 1);
  assert.equal(ice.equips, 1);
  assert.equal(ice.kills, 1);
  assert.equal(ice.damage, 30);
  assert.equal(ice.survivals, 1);
  assert.equal(ice.avgSurvivalSec, 120);
  assert.equal(ice.feedbackUp, 1);
  assert.equal(ice.killPerEquip, 1);
  assert.equal(ice.damagePerEquip, 30);

  const meteor = report.items.find((item) => item.itemId === 'evt_weather_meteor_shower')!;
  assert.equal(meteor.events, 1);

  assert.equal(
    report.items.some((item) => item.itemId === 'wpn_rifle_fire'),
    false,
    'uso de bot deve ficar fora por padrão',
  );

  const markdown = renderLoopReportMarkdown(report);
  assert.match(markdown, /Relatório do loop/);
  assert.match(markdown, /Lacunas: fechadas/);
  assert.match(markdown, /Demanda x uso/);
  assert.match(markdown, /wpn_pistol_ice/);
});

test('loop report separates pool misses from catalog gaps', () => {
  const prompts: PromptEventRow[] = [
    promptRow({
      canonical_key: 'bazuca|vazio',
      prompt: 'Bazuca do Vazio',
      item_id: 'wpn_launcher_fire',
      strategy: 'partial',
      pool_miss: 1,
      pool_hash: 'pool-abc',
    }),
  ];
  const report = buildLoopReport(prompts, [], 'v2');
  assert.equal(report.totals.submitted, 1);
  assert.equal(report.totals.covered, 1);
  assert.equal(report.totals.gaps, 0);
  assert.equal(report.totals.poolMisses, 1);
  assert.equal(report.totals.poolMissRate, 1);
  assert.equal(report.poolMisses[0].canonicalKey, 'bazuca|vazio');
  assert.equal(report.items.length, 0);
  assert.match(renderLoopReportMarkdown(report), /Fora do arsenal/);
});

test('loop report can include bots for auditing', () => {
  const report = buildLoopReport(
    [
      promptRow({
        actor_type: 'bot',
        canonical_key: 'bot|teste',
        item_id: 'wpn_rifle_standard',
        strategy: 'default',
      }),
    ],
    [usageRow({ role: 'equip', actor_type: 'bot', item_id: 'wpn_rifle_fire' })],
    'v2',
    { includeBots: true },
  );
  assert.equal(report.totals.submitted, 0);
  assert.equal(report.totals.gaps, 0);
  assert.equal(report.items.some((item) => item.itemId === 'wpn_rifle_fire'), true);
});
