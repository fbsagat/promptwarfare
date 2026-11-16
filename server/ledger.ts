import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { buildCanonicalKey, normalizePrompt } from '../src/shared/prompt.ts';

export type LedgerActorType = 'human' | 'bot' | 'dev' | 'preview' | 'system' | 'seed';
export type LedgerPhase = 'opened' | 'submitted' | 'cancelled' | 'timed_out';
export type LedgerPromptKind = 'weapon' | 'event';
export type LedgerReason = 'user' | 'timeout' | 'death' | 'disconnect' | 'invalid' | null;

export interface PromptLedgerEvent {
  sessionId: string;
  actorType: LedgerActorType;
  actorRef?: string | null;
  roomId?: string | null;
  matchId?: string | null;
  kind: LedgerPromptKind;
  phase: LedgerPhase;
  prompt?: string | null;
  itemId?: string | null;
  strategy?: string | null;
  catalogVersion: string;
  budgetUsed?: number | null;
  wasClamped?: boolean | null;
  elapsedMs?: number | null;
  reason?: LedgerReason;
  poolHash?: string | null;
  poolMiss?: boolean | null;
}

export interface PromptEventRow {
  id: number;
  created_at: number;
  session_id: string;
  actor_type: LedgerActorType;
  actor_ref: string | null;
  room_id: string | null;
  match_id: string | null;
  kind: LedgerPromptKind;
  phase: LedgerPhase;
  prompt: string | null;
  normalized_prompt: string | null;
  canonical_key: string | null;
  item_id: string | null;
  strategy: string | null;
  catalog_version: string;
  budget_used: number | null;
  was_clamped: number | null;
  elapsed_ms: number | null;
  reason: string | null;
  pool_hash: string | null;
  pool_miss: number | null;
}

export type ContentUsageRole = 'equip' | 'kill' | 'damage' | 'survival' | 'event' | 'feedback';

export interface ContentUsageEvent {
  itemId: string;
  kind: LedgerPromptKind;
  role: ContentUsageRole;
  actorType: LedgerActorType;
  actorRef?: string | null;
  roomId?: string | null;
  matchId?: string | null;
  targetRef?: string | null;
  catalogVersion: string;
  metadata?: Record<string, unknown> | null;
}

export interface ContentUsageRow {
  id: number;
  created_at: number;
  item_id: string;
  kind: LedgerPromptKind;
  role: ContentUsageRole;
  actor_type: LedgerActorType;
  actor_ref: string | null;
  room_id: string | null;
  match_id: string | null;
  target_ref: string | null;
  catalog_version: string;
  metadata_json: string | null;
}

const DEFAULT_DB_PATH = path.resolve(process.cwd(), 'data', 'prompt-ledger.db');

type QueuedPromptEvent = PromptLedgerEvent & { createdAt: number };
type QueuedUsageEvent = ContentUsageEvent & { createdAt: number };

export class PromptLedger {
  private db: DatabaseSync;
  private readonly dbPath: string;
  private queue: QueuedPromptEvent[] = [];
  private usageQueue: QueuedUsageEvent[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;

  constructor(dbPath?: string) {
    this.dbPath =
      dbPath ?? process.env.PROMPT_LEDGER_DB_PATH ?? DEFAULT_DB_PATH;
    if (this.dbPath !== ':memory:') {
      fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });
    }
    this.db = new DatabaseSync(this.dbPath);
    if (this.dbPath !== ':memory:') {
      this.db.exec('PRAGMA journal_mode = WAL;');
      this.db.exec('PRAGMA synchronous = NORMAL;');
    }
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS prompt_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at INTEGER NOT NULL,
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
        budget_used REAL,
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
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at INTEGER NOT NULL,
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
    `);
    this.ensureColumn('prompt_events', 'pool_hash', 'TEXT');
    this.ensureColumn('prompt_events', 'pool_miss', 'INTEGER');
  }

  private ensureColumn(table: string, column: string, definition: string): void {
    const columns = this.db
      .prepare(`PRAGMA table_info(${table})`)
      .all() as Array<{ name: string }>;
    if (!columns.some((entry) => entry.name === column)) {
      this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  }

  getPath(): string {
    return this.dbPath;
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
      this.flush();
    }, 100);
    this.flushTimer.unref?.();
  }

  flush(): void {
    if (this.closed || (this.queue.length === 0 && this.usageQueue.length === 0)) return;
    const events = this.queue.splice(0, this.queue.length);
    const usages = this.usageQueue.splice(0, this.usageQueue.length);
    const promptStmt = this.db.prepare(`
      INSERT INTO prompt_events
        (created_at, session_id, actor_type, actor_ref, room_id, match_id, kind, phase,
         prompt, normalized_prompt, canonical_key, item_id, strategy, catalog_version,
         budget_used, was_clamped, elapsed_ms, reason, pool_hash, pool_miss)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const usageStmt = this.db.prepare(`
      INSERT INTO content_usage
        (created_at, item_id, kind, role, actor_type, actor_ref, room_id, match_id,
         target_ref, catalog_version, metadata_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    try {
      this.db.exec('BEGIN');
      for (const event of events) {
        const prompt = event.prompt ?? null;
        promptStmt.run(
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
        );
      }
      for (const usage of usages) {
        usageStmt.run(
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
        );
      }
      this.db.exec('COMMIT');
    } catch (err) {
      try {
        this.db.exec('ROLLBACK');
      } catch {
        // ignore rollback failure
      }
      console.warn('[Ledger] Falha ao gravar eventos:', (err as Error).message);
    }
  }

  getEvents(limit = 5000, since = 0): PromptEventRow[] {
    this.flush();
    const rows = this.db
      .prepare(
        'SELECT * FROM prompt_events WHERE created_at >= ? ORDER BY id DESC LIMIT ?',
      )
      .all(since, limit) as unknown as PromptEventRow[];
    return rows.reverse();
  }

  getUsage(limit = 10000, since = 0): ContentUsageRow[] {
    this.flush();
    const rows = this.db
      .prepare(
        'SELECT * FROM content_usage WHERE created_at >= ? ORDER BY id DESC LIMIT ?',
      )
      .all(since, limit) as unknown as ContentUsageRow[];
    return rows.reverse();
  }

  close(): void {
    if (this.closed) return;
    this.flush();
    this.closed = true;
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    this.db.close();
  }
}

let sharedLedger: PromptLedger | null = null;

export function getPromptLedger(): PromptLedger {
  if (!sharedLedger) sharedLedger = new PromptLedger();
  return sharedLedger;
}

export function readPromptEvents(
  dbPath: string,
  limit = 100000,
  since = 0,
): PromptEventRow[] {
  const db = new DatabaseSync(dbPath);
  try {
    const rows = db
      .prepare(
        'SELECT * FROM prompt_events WHERE created_at >= ? ORDER BY id DESC LIMIT ?',
      )
      .all(since, limit) as unknown as PromptEventRow[];
    return rows.reverse();
  } finally {
    db.close();
  }
}

export function readContentUsage(
  dbPath: string,
  limit = 100000,
  since = 0,
): ContentUsageRow[] {
  const db = new DatabaseSync(dbPath);
  try {
    const rows = db
      .prepare(
        'SELECT * FROM content_usage WHERE created_at >= ? ORDER BY id DESC LIMIT ?',
      )
      .all(since, limit) as unknown as ContentUsageRow[];
    return rows.reverse();
  } finally {
    db.close();
  }
}
