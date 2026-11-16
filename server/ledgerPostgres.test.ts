import test from 'node:test';
import assert from 'node:assert/strict';
import type { PgClientLike, PgQueryResult } from './ledgerPostgres.ts';
import { PostgresPromptLedger } from './ledgerPostgres.ts';
import { ledgerBackendFromEnv } from './ledgerFactory.ts';

class FakePgClient implements PgClientLike {
  queries: Array<{ sql: string; params?: unknown[] }> = [];
  promptRows: Array<Record<string, unknown>> = [];
  usageRows: Array<Record<string, unknown>> = [];
  ended = false;

  async query(sql: string, params?: unknown[]): Promise<PgQueryResult> {
    this.queries.push({ sql, params });
    if (sql.includes('FROM prompt_events')) return { rows: this.promptRows };
    if (sql.includes('FROM content_usage')) return { rows: this.usageRows };
    return { rows: [] };
  }

  async end(): Promise<void> {
    this.ended = true;
  }
}

test('Postgres ledger queues, flushes and maps rows', async () => {
  const client = new FakePgClient();
  const ledger = new PostgresPromptLedger(client, { flushMs: 20 });
  await ledger.init();

  ledger.record({
    sessionId: 's1',
    actorType: 'human',
    actorRef: 'p1',
    roomId: 'R1',
    matchId: 'M1',
    kind: 'weapon',
    phase: 'submitted',
    prompt: 'Pistola de gelo',
    itemId: 'wpn_pistol_ice',
    strategy: 'alias',
    catalogVersion: 'v1',
    poolHash: 'pool-abc',
    poolMiss: false,
  });
  ledger.recordUsage({
    itemId: 'wpn_pistol_ice',
    kind: 'weapon',
    role: 'equip',
    actorType: 'human',
    actorRef: 'p1',
    roomId: 'R1',
    matchId: 'M1',
    catalogVersion: 'v1',
  });
  await ledger.flush();

  const sqls = client.queries.map((entry) => entry.sql.trim());
  assert.ok(sqls.includes('BEGIN'));
  assert.ok(sqls.some((sql) => sql.startsWith('INSERT INTO prompt_events')));
  assert.ok(sqls.some((sql) => sql.startsWith('INSERT INTO content_usage')));
  assert.ok(sqls.includes('COMMIT'));

  const promptInsert = client.queries.find((entry) =>
    entry.sql.includes('INSERT INTO prompt_events'),
  );
  assert.equal(promptInsert?.params?.[8], 'Pistola de gelo');
  assert.equal(promptInsert?.params?.[9], 'pistola de gelo');
  assert.equal(promptInsert?.params?.[18], 'pool-abc');
  assert.equal(promptInsert?.params?.[19], 0);

  client.promptRows = [
    {
      id: '7',
      created_at: '1000',
      session_id: 's1',
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
      pool_miss: 1,
    },
  ];
  const rows = await ledger.readPromptEvents(5, 0);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, 7);
  assert.equal(rows[0].created_at, 1000);
  assert.equal(rows[0].pool_miss, 1);
  const select = client.queries.find((entry) =>
    entry.sql.includes('FROM prompt_events'),
  );
  assert.deepEqual(select?.params, [0, 5]);

  await ledger.close();
  assert.equal(client.ended, true);
});

test('ledger backend selection defaults to sqlite and accepts postgres aliases', () => {
  assert.equal(ledgerBackendFromEnv({}), 'sqlite');
  assert.equal(ledgerBackendFromEnv({ PROMPT_LEDGER_BACKEND: 'sqlite' }), 'sqlite');
  assert.equal(ledgerBackendFromEnv({ PROMPT_LEDGER_BACKEND: 'postgres' }), 'postgres');
  assert.equal(ledgerBackendFromEnv({ PROMPT_LEDGER_BACKEND: 'postgresql' }), 'postgres');
  assert.equal(ledgerBackendFromEnv({ PROMPT_LEDGER_BACKEND: 'POSTGRES' }), 'postgres');
});
