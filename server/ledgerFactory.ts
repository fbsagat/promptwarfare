import path from 'node:path';
import {
  PromptLedger,
  readContentUsage,
  readPromptEvents,
  type ContentUsageRow,
  type LedgerRuntime,
  type PromptEventRow,
} from './ledger.ts';
import { PostgresPromptLedger } from './ledgerPostgres.ts';

export type LedgerBackend = 'sqlite' | 'postgres';

export interface LedgerReader {
  readPromptEvents(limit?: number, since?: number): Promise<PromptEventRow[]>;
  readContentUsage(limit?: number, since?: number): Promise<ContentUsageRow[]>;
  close(): Promise<void>;
}

export function ledgerBackendFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): LedgerBackend {
  const raw = (env.PROMPT_LEDGER_BACKEND ?? 'sqlite').trim().toLowerCase();
  if (raw === 'postgres' || raw === 'postgresql') return 'postgres';
  return 'sqlite';
}

function postgresUrl(env: NodeJS.ProcessEnv): string {
  const url = (env.PROMPT_LEDGER_POSTGRES_URL ?? env.DATABASE_URL ?? '').trim();
  if (!url) {
    throw new Error(
      'PROMPT_LEDGER_BACKEND=postgres exige PROMPT_LEDGER_POSTGRES_URL ou DATABASE_URL.',
    );
  }
  return url;
}

function sqlitePath(env: NodeJS.ProcessEnv, dbPath?: string): string {
  return (
    dbPath ??
    env.PROMPT_LEDGER_DB_PATH ??
    path.resolve(process.cwd(), 'data', 'prompt-ledger.db')
  );
}

export async function createLedgerRuntime(
  env: NodeJS.ProcessEnv = process.env,
): Promise<LedgerRuntime> {
  if (ledgerBackendFromEnv(env) === 'postgres') {
    return PostgresPromptLedger.connect({ connectionString: postgresUrl(env) });
  }
  return new PromptLedger(sqlitePath(env));
}

export async function openLedgerReader(
  options: {
    backend?: LedgerBackend;
    dbPath?: string;
    postgresUrl?: string;
    env?: NodeJS.ProcessEnv;
  } = {},
): Promise<LedgerReader> {
  const env = options.env ?? process.env;
  const backend = options.backend ?? ledgerBackendFromEnv(env);
  if (backend === 'postgres') {
    const url = options.postgresUrl?.trim() || postgresUrl(env);
    const ledger = await PostgresPromptLedger.connect({ connectionString: url });
    return {
      readPromptEvents: (limit, since) => ledger.readPromptEvents(limit, since),
      readContentUsage: (limit, since) => ledger.readContentUsage(limit, since),
      close: () => ledger.close(),
    };
  }

  const dbPath = sqlitePath(env, options.dbPath);
  return {
    async readPromptEvents(limit, since) {
      return readPromptEvents(dbPath, limit, since);
    },
    async readContentUsage(limit, since) {
      return readContentUsage(dbPath, limit, since);
    },
    async close() {
      // Leituras SQLite abrem e fecham a conexão por chamada.
    },
  };
}
