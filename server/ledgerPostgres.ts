import { buildCanonicalKey, normalizePrompt } from '../src/shared/prompt.ts';
import type {
  ContentUsageEvent,
  ContentUsageRow,
  LedgerRuntime,
  PromptEventRow,
  PromptLedgerEvent,
  QueuedPromptEvent,
  QueuedUsageEvent,
} from './ledger.ts';

export interface PgQueryResult {
  rows: Array<Record<string, unknown>>;
}

export interface PgClientLike {
  query(text: string, values?: unknown[]): Promise<PgQueryResult>;
  end?: () => Promise<void>;
}

export interface PostgresLedgerOptions {
  flushMs?: number;
}

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS prompt_events (
    id BIGSERIAL PRIMARY KEY,
    created_at BIGINT NOT NULL,
    session_id TEXT NOT NULL,
    actor_type TEXT NOT NULL,
    actor_ref TEXT,
    room_id TEXT,
    match_id TEXT,
    kind TEXT NOT NULL,
    phase TEXT NOT NULL,
    prompt TEXT,
    normalized_prompt TEXT,
    canonical_key TEXT,
    item_id TEXT,
    strategy TEXT,
    catalog_version TEXT NOT NULL,
    budget_used DOUBLE PRECISION,
    was_clamped INTEGER,
    elapsed_ms INTEGER,
    reason TEXT,
    pool_hash TEXT,
    pool_miss INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_prompt_events_actor ON prompt_events(actor_type, phase, created_at);
  CREATE INDEX IF NOT EXISTS idx_prompt_events_canonical ON prompt_events(canonical_key);
  CREATE INDEX IF NOT EXISTS idx_prompt_events_item ON prompt_events(item_id);
  CREATE INDEX IF NOT EXISTS idx_prompt_events_created ON prompt_events(created_at);

  CREATE TABLE IF NOT EXISTS content_usage (
    id BIGSERIAL PRIMARY KEY,
    created_at BIGINT NOT NULL,
    item_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    role TEXT NOT NULL,
    actor_type TEXT NOT NULL,
    actor_ref TEXT,
    room_id TEXT,
    match_id TEXT,
    target_ref TEXT,
    catalog_version TEXT NOT NULL,
    metadata_json TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_content_usage_item ON content_usage(item_id, role, created_at);
  CREATE INDEX IF NOT EXISTS idx_content_usage_match ON content_usage(match_id, actor_type);
  CREATE INDEX IF NOT EXISTS idx_content_usage_created ON content_usage(created_at);
`;

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  return Number(value);
}

/**
 * Ledger Postgres para deploys com múltiplas instâncias. O driver `pg` é
 * carregado dinamicamente apenas quando este backend é usado.
 */
export class PostgresPromptLedger implements LedgerRuntime {
  private readonly client: PgClientLike;
  private readonly flushMs: number;
  private queue: QueuedPromptEvent[] = [];
  private usageQueue: QueuedUsageEvent[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private flushChain: Promise<void> = Promise.resolve();
  private closed = false;

  constructor(client: PgClientLike, options: PostgresLedgerOptions = {}) {
    this.client = client;
    this.flushMs = Math.max(20, options.flushMs ?? 100);
  }

  static async connect(options: {
    connectionString: string;
    flushMs?: number;
  }): Promise<PostgresPromptLedger> {
    let pg: {
      Client?: new (config: { connectionString: string }) => PgClientLike;
      default?: {
        Client?: new (config: { connectionString: string }) => PgClientLike;
      };
    };
    try {
      const moduleName = 'pg';
      pg = (await import(moduleName)) as typeof pg;
    } catch {
      throw new Error(
        'Backend PROMPT_LEDGER_BACKEND=postgres exige o pacote "pg" instalado na VPS.',
      );
    }
    const Client = pg.Client ?? pg.default?.Client;
    if (!Client) throw new Error('Cliente Postgres do pacote "pg" não encontrado.');
    const client = new Client({ connectionString: options.connectionString });
    await client.query('SELECT 1');
    const ledger = new PostgresPromptLedger(client, { flushMs: options.flushMs });
    await ledger.init();
    return ledger;
  }

  async init(): Promise<void> {
    await this.client.query(SCHEMA_SQL);
  }

  record(event: PromptLedgerEvent): void {
    if (this.closed) return;
    this.queue.push({
      ...event,
      prompt: event.prompt?.trim().slice(0, 90) || null,
      createdAt: Date.now(),
    });
    this.scheduleFlush();
  }

  recordUsage(event: ContentUsageEvent): void {
    if (this.closed) return;
    this.usageQueue.push({ ...event, createdAt: Date.now() });
    this.scheduleFlush();
  }

  private scheduleFlush(): void {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flush();
    }, this.flushMs);
    this.flushTimer.unref?.();
  }

  flush(): Promise<void> {
    this.flushChain = this.flushChain.then(() => this.flushBatch());
    return this.flushChain;
  }

  private async flushBatch(): Promise<void> {
    if (this.closed || (this.queue.length === 0 && this.usageQueue.length === 0)) return;
    const events = this.queue.splice(0, this.queue.length);
    const usages = this.usageQueue.splice(0, this.usageQueue.length);
    try {
      await this.client.query('BEGIN');
      for (const event of events) {
        const prompt = event.prompt ?? null;
        await this.client.query(
          `INSERT INTO prompt_events
             (created_at, session_id, actor_type, actor_ref, room_id, match_id, kind, phase,
              prompt, normalized_prompt, canonical_key, item_id, strategy, catalog_version,
              budget_used, was_clamped, elapsed_ms, reason, pool_hash, pool_miss)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
          [
            event.createdAt,
            event.sessionId,
            event.actorType,
            event.actorRef ?? null,
            event.roomId ?? null,
            event.matchId ?? null,
            event.kind,
            event.phase,
            prompt,
            prompt ? normalizePrompt(prompt) : null,
            prompt ? buildCanonicalKey(prompt) : null,
            event.itemId ?? null,
            event.strategy ?? null,
            event.catalogVersion,
            event.budgetUsed ?? null,
            event.wasClamped === null || event.wasClamped === undefined
              ? null
              : event.wasClamped
                ? 1
                : 0,
            event.elapsedMs ?? null,
            event.reason ?? null,
            event.poolHash ?? null,
            event.poolMiss === null || event.poolMiss === undefined
              ? null
              : event.poolMiss
                ? 1
                : 0,
          ],
        );
      }
      for (const usage of usages) {
        await this.client.query(
          `INSERT INTO content_usage
             (created_at, item_id, kind, role, actor_type, actor_ref, room_id, match_id,
              target_ref, catalog_version, metadata_json)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [
            usage.createdAt,
            usage.itemId,
            usage.kind,
            usage.role,
            usage.actorType,
            usage.actorRef ?? null,
            usage.roomId ?? null,
            usage.matchId ?? null,
            usage.targetRef ?? null,
            usage.catalogVersion,
            usage.metadata ? JSON.stringify(usage.metadata) : null,
          ],
        );
      }
      await this.client.query('COMMIT');
    } catch (err) {
      try {
        await this.client.query('ROLLBACK');
      } catch {
        // ignore rollback failure
      }
      this.queue.unshift(...events);
      this.usageQueue.unshift(...usages);
      console.warn('[Ledger/Postgres] Falha ao gravar eventos:', (err as Error).message);
      this.scheduleFlush();
    }
  }

  async readPromptEvents(limit = 100000, since = 0): Promise<PromptEventRow[]> {
    await this.flush();
    const result = await this.client.query(
      'SELECT * FROM prompt_events WHERE created_at >= $1 ORDER BY id DESC LIMIT $2',
      [since, limit],
    );
    return result.rows
      .map((row) => ({
        ...row,
        id: Number(row.id),
        created_at: Number(row.created_at),
        was_clamped: numberOrNull(row.was_clamped),
        pool_miss: numberOrNull(row.pool_miss),
      }))
      .reverse() as unknown as PromptEventRow[];
  }

  async readContentUsage(limit = 100000, since = 0): Promise<ContentUsageRow[]> {
    await this.flush();
    const result = await this.client.query(
      'SELECT * FROM content_usage WHERE created_at >= $1 ORDER BY id DESC LIMIT $2',
      [since, limit],
    );
    return result.rows
      .map((row) => ({
        ...row,
        id: Number(row.id),
        created_at: Number(row.created_at),
      }))
      .reverse() as unknown as ContentUsageRow[];
  }

  async close(): Promise<void> {
    if (this.closed) return;
    await this.flush();
    this.closed = true;
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    await this.client.end?.();
  }
}
