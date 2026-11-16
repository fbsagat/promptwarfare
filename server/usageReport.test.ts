import test from 'node:test';
import assert from 'node:assert/strict';
import type { ContentUsageRow } from './ledger.ts';
import { buildUsageReport, renderUsageReportMarkdown } from './usageReport.ts';

function row(
  itemId: string,
  role: 'equip' | 'kill' | 'damage' | 'survival' | 'event' | 'feedback',
  actor: string,
  actorType: 'human' | 'bot' = 'human',
  createdAt = 1,
  metadata: Record<string, unknown> | null = null,
): ContentUsageRow {
  return {
    id: createdAt,
    created_at: createdAt,
    item_id: itemId,
    kind: role === 'event' ? 'event' : 'weapon',
    role,
    actor_type: actorType,
    actor_ref: actor,
    room_id: 'R1',
    match_id: 'M1',
    target_ref: null,
    catalog_version: 'test',
    metadata_json: metadata ? JSON.stringify(metadata) : null,
  };
}

test('usage report groups human equips, kills and events by item', () => {
  const report = buildUsageReport(
    [
      row('wpn_pistol_ice', 'equip', 'p1', 'human', 1),
      row('wpn_pistol_ice', 'equip', 'p2', 'human', 2),
      row('wpn_pistol_ice', 'kill', 'p1', 'human', 3),
      row('wpn_pistol_ice', 'kill', 'p1', 'human', 4),
      row('wpn_pistol_ice', 'damage', 'p1', 'human', 5, { damage: 24 }),
      row('wpn_pistol_ice', 'survival', 'p1', 'human', 6, { survivedSec: 42, won: true }),
      row('wpn_pistol_ice', 'feedback', 'p2', 'human', 7, { rating: 1 }),
      row('evt_weather_blizzard', 'event', 'p2', 'human', 8),
      row('wpn_pistol_ice', 'equip', 'bot1', 'bot', 9),
    ],
    'test',
  );

  assert.equal(report.totals.equips, 2);
  assert.equal(report.totals.kills, 2);
  assert.equal(report.totals.damage, 24);
  assert.equal(report.totals.events, 1);
  assert.equal(report.totals.survivals, 1);
  assert.equal(report.totals.feedbackUp, 1);
  assert.equal(report.totals.uniqueItems, 2);
  assert.equal(report.totals.uniqueActors, 2);

  const pistol = report.items.find((item) => item.itemId === 'wpn_pistol_ice')!;
  assert.equal(pistol.equips, 2);
  assert.equal(pistol.kills, 2);
  assert.equal(pistol.damage, 24);
  assert.equal(pistol.damagePerEquip, 12);
  assert.equal(pistol.survivals, 1);
  assert.equal(pistol.avgSurvivalSec, 42);
  assert.equal(pistol.feedbackUp, 1);
  assert.equal(pistol.killPerEquip, 1);
  assert.equal(pistol.uniqueActors, 2);

  const event = report.items.find((item) => item.itemId === 'evt_weather_blizzard')!;
  assert.equal(event.events, 1);
  assert.equal(event.kind, 'event');

  const markdown = renderUsageReportMarkdown(report);
  assert.match(markdown, /Relatório de uso/);
  assert.match(markdown, /wpn_pistol_ice/);
});
