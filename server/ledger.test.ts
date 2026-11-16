import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PromptLedger, readPromptEvents } from './ledger.ts';
import {
  buildDemandReport,
  renderDemandReportMarkdown,
} from './ledgerReport.ts';

const VERSION = 'test-catalog';

test('PromptLedger stores append-only prompt events with normalization', () => {
  const ledger = new PromptLedger(':memory:');
  try {
    ledger.record({
      sessionId: 's1',
      actorType: 'human',
      actorRef: 'p1',
      roomId: 'ROOM1',
      matchId: 'm1',
      kind: 'weapon',
      phase: 'opened',
      catalogVersion: VERSION,
    });
    ledger.record({
      sessionId: 's1',
      actorType: 'human',
      actorRef: 'p1',
      roomId: 'ROOM1',
      matchId: 'm1',
      kind: 'weapon',
      phase: 'submitted',
      prompt: 'Pistola de Gelo',
      itemId: 'wpn_pistol_ice',
      strategy: 'alias',
      catalogVersion: VERSION,
      budgetUsed: 63.2,
      wasClamped: false,
      elapsedMs: 4200,
    });
    ledger.record({
      sessionId: 's2',
      actorType: 'human',
      actorRef: 'p2',
      roomId: 'ROOM1',
      matchId: 'm1',
      kind: 'event',
      phase: 'cancelled',
      catalogVersion: VERSION,
      elapsedMs: 1800,
      reason: 'user',
    });
    ledger.record({
      sessionId: 's3',
      actorType: 'bot',
      actorRef: 'bot1',
      roomId: 'ROOM1',
      matchId: 'm1',
      kind: 'weapon',
      phase: 'submitted',
      prompt: 'Rifle de fogo',
      itemId: 'wpn_rifle_fire',
      strategy: 'tags',
      catalogVersion: VERSION,
      budgetUsed: 95,
      wasClamped: false,
    });
    ledger.flush();

    const rows = ledger.getEvents();
    assert.equal(rows.length, 4);
    const submitted = rows.find((row) => row.phase === 'submitted')!;
    assert.equal(submitted.prompt, 'Pistola de Gelo');
    assert.equal(submitted.normalized_prompt, 'pistola de gelo');
    assert.equal(submitted.canonical_key, 'gelo|pistola');
    assert.equal(submitted.item_id, 'wpn_pistol_ice');
    assert.equal(submitted.strategy, 'alias');
    assert.equal(submitted.was_clamped, 0);
    assert.equal(submitted.elapsed_ms, 4200);

    const cancelled = rows.find((row) => row.phase === 'cancelled')!;
    assert.equal(cancelled.reason, 'user');
    assert.equal(cancelled.actor_ref, 'p2');
  } finally {
    ledger.close();
  }
});

test('PromptLedger records content usage separately from prompt events', () => {
  const ledger = new PromptLedger(':memory:');
  try {
    ledger.recordUsage({
      itemId: 'wpn_pistol_ice',
      kind: 'weapon',
      role: 'equip',
      actorType: 'human',
      actorRef: 'p1',
      roomId: 'R1',
      matchId: 'M1',
      catalogVersion: VERSION,
      metadata: { budgetUsed: 60 },
    });
    ledger.recordUsage({
      itemId: 'wpn_pistol_ice',
      kind: 'weapon',
      role: 'kill',
      actorType: 'human',
      actorRef: 'p1',
      roomId: 'R1',
      matchId: 'M1',
      targetRef: 'p2',
      catalogVersion: VERSION,
    });
    ledger.flush();

    const usage = ledger.getUsage();
    assert.equal(usage.length, 2);
    assert.equal(usage[0].role, 'equip');
    assert.equal(usage[1].role, 'kill');
    assert.equal(usage[1].target_ref, 'p2');
    assert.match(usage[0].metadata_json ?? '', /budgetUsed/);
    assert.equal(ledger.getEvents().length, 0);
  } finally {
    ledger.close();
  }
});

test('readPromptEvents returns the newest rows, not the oldest window', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-ledger-'));
  const dbPath = path.join(dir, 'ledger.db');
  const ledger = new PromptLedger(dbPath);
  try {
    for (let i = 0; i < 3; i++) {
      ledger.record({
        sessionId: `s${i}`,
        actorType: 'human',
        actorRef: 'p1',
        roomId: 'R1',
        matchId: 'M1',
        kind: 'weapon',
        phase: 'opened',
        catalogVersion: VERSION,
      });
    }
    ledger.flush();
  } finally {
    ledger.close();
  }

  try {
    const rows = readPromptEvents(dbPath, 2);
    assert.equal(rows.length, 2);
    assert.deepEqual(
      rows.map((row) => row.session_id),
      ['s1', 's2'],
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('demand report treats partial coverage as a gap', () => {
  const ledger = new PromptLedger(':memory:');
  try {
    const base = {
      actorType: 'human' as const,
      actorRef: 'p1',
      roomId: 'ROOM1',
      matchId: 'm1',
      catalogVersion: VERSION,
      kind: 'weapon' as const,
      phase: 'submitted' as const,
      budgetUsed: 60,
      wasClamped: false,
    };
    ledger.record({
      ...base,
      sessionId: 'ok',
      prompt: 'Pistola de gelo',
      itemId: 'wpn_pistol_ice',
      strategy: 'alias',
    });
    ledger.record({
      ...base,
      sessionId: 'partial',
      prompt: 'Arma de gelo e fogo',
      itemId: 'wpn_pistol_ice',
      strategy: 'partial',
    });
    ledger.flush();

    const report = buildDemandReport(ledger.getEvents(), VERSION);
    assert.equal(report.totals.submitted, 2);
    assert.equal(report.totals.partial, 1);
    assert.equal(report.totals.gaps, 1);
    assert.equal(report.totals.coverageRate, 0.5);
    assert.equal(report.gaps[0].strategy, 'partial');
    assert.match(renderDemandReportMarkdown(report), /Cobertura duvidosa/);
  } finally {
    ledger.close();
  }
});

test('PromptLedger records pool hash and pool misses separately', () => {
  const ledger = new PromptLedger(':memory:');
  try {
    ledger.record({
      sessionId: 's1',
      actorType: 'human',
      actorRef: 'p1',
      roomId: 'R1',
      matchId: 'M1',
      kind: 'weapon',
      phase: 'submitted',
      prompt: 'Bazuca do Vazio',
      itemId: 'wpn_launcher_fire',
      strategy: 'partial',
      catalogVersion: VERSION,
      poolHash: 'pool-abc',
      poolMiss: true,
    });
    ledger.flush();
    const rows = ledger.getEvents();
    assert.equal(rows[0].pool_hash, 'pool-abc');
    assert.equal(rows[0].pool_miss, 1);
  } finally {
    ledger.close();
  }
});

test('demand report separates pool misses from catalog gaps', () => {
  const ledger = new PromptLedger(':memory:');
  try {
    const base = {
      actorType: 'human' as const,
      actorRef: 'p1',
      roomId: 'ROOM1',
      matchId: 'm1',
      catalogVersion: VERSION,
      kind: 'weapon' as const,
      phase: 'submitted' as const,
      budgetUsed: 60,
      wasClamped: false,
    };
    ledger.record({
      ...base,
      sessionId: 'ok',
      prompt: 'Pistola de gelo',
      itemId: 'wpn_pistol_ice',
      strategy: 'alias',
    });
    ledger.record({
      ...base,
      sessionId: 'pool',
      prompt: 'Bazuca do Vazio',
      itemId: 'wpn_launcher_fire',
      strategy: 'partial',
      poolHash: 'pool-abc',
      poolMiss: true,
    });
    ledger.flush();

    const report = buildDemandReport(ledger.getEvents(), VERSION);
    assert.equal(report.totals.submitted, 2);
    assert.equal(report.totals.covered, 2);
    assert.equal(report.totals.gaps, 0);
    assert.equal(report.totals.partial, 0);
    assert.equal(report.totals.poolMisses, 1);
    assert.equal(report.totals.poolMissRate, 0.5);
    assert.equal(report.poolMisses[0].canonicalKey, 'bazuca|vazio');
    assert.match(renderDemandReportMarkdown(report), /Fora do arsenal/);
  } finally {
    ledger.close();
  }
});

test('demand report groups human intents, gaps, and abandonment', () => {
  const ledger = new PromptLedger(':memory:');
  try {
    const base = {
      actorType: 'human' as const,
      actorRef: 'p1',
      roomId: 'ROOM1',
      matchId: 'm1',
      catalogVersion: VERSION,
    };
    ledger.record({
      ...base,
      sessionId: 'a',
      kind: 'weapon',
      phase: 'submitted',
      prompt: 'Pistola de gelo',
      itemId: 'wpn_pistol_ice',
      strategy: 'alias',
      budgetUsed: 60,
      wasClamped: false,
    });
    ledger.record({
      ...base,
      sessionId: 'b',
      kind: 'weapon',
      phase: 'submitted',
      prompt: 'pistola congelante',
      itemId: 'wpn_pistol_ice',
      strategy: 'tags',
      budgetUsed: 62,
      wasClamped: false,
    });
    ledger.record({
      ...base,
      sessionId: 'c',
      kind: 'event',
      phase: 'submitted',
      prompt: 'Evento sem nome conhecido',
      itemId: 'evt_weather_meteor_shower',
      strategy: 'default',
      budgetUsed: 70,
      wasClamped: false,
    });
    ledger.record({
      ...base,
      sessionId: 'd',
      kind: 'weapon',
      phase: 'opened',
    });
    ledger.record({
      ...base,
      sessionId: 'd',
      kind: 'weapon',
      phase: 'cancelled',
      reason: 'user',
    });
    ledger.record({
      ...base,
      sessionId: 'e',
      kind: 'event',
      phase: 'timed_out',
      reason: 'timeout',
    });
    ledger.record({
      ...base,
      actorType: 'bot',
      actorRef: 'bot1',
      sessionId: 'f',
      kind: 'weapon',
      phase: 'submitted',
      prompt: 'Rifle de fogo',
      itemId: 'wpn_rifle_fire',
      strategy: 'tags',
      budgetUsed: 90,
      wasClamped: false,
    });
    ledger.record({
      ...base,
      actorType: 'preview',
      actorRef: null,
      sessionId: 'g',
      kind: 'weapon',
      phase: 'submitted',
      prompt: 'Pistola de gelo',
      itemId: 'wpn_pistol_ice',
      strategy: 'alias',
      budgetUsed: 60,
      wasClamped: false,
    });
    ledger.flush();

    const report = buildDemandReport(ledger.getEvents(), VERSION);
    assert.equal(report.totals.submitted, 3);
    assert.equal(report.totals.uniqueIntents, 2);
    assert.equal(report.totals.gaps, 1);
    assert.equal(report.totals.opened, 1);
    assert.equal(report.totals.abandoned, 1);
    assert.equal(report.totals.cancelled, 1);
    assert.equal(report.totals.timedOut, 1);
    assert.equal(report.totals.coverageRate, 0.667);
    assert.equal(report.topIntents[0].count, 2);
    assert.equal(report.topIntents[0].itemId, 'wpn_pistol_ice');
    assert.equal(report.gaps[0].canonicalKey, 'conhecido|evento|nome');
    assert.ok(report.byItem.some((item) => item.itemId === 'wpn_pistol_ice' && item.count === 2));

    const markdown = renderDemandReportMarkdown(report);
    assert.match(markdown, /Relatório de demanda/);
    assert.match(markdown, /Lacunas para produzir/);
    assert.match(markdown, /wpn_pistol_ice/);
  } finally {
    ledger.close();
  }
});
