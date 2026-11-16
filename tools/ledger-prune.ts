import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { ledgerBackendFromEnv } from '../server/ledgerFactory.ts';

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const dbPath =
  argValue('--db') ??
  process.env.PROMPT_LEDGER_DB_PATH ??
  path.resolve(ROOT, 'data', 'prompt-ledger.db');
const days = Math.max(1, Number(argValue('--days') ?? 90));
const dryRun = process.argv.includes('--dry-run');
const redactPrompts = process.argv.includes('--redact-prompts');
const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;

if (ledgerBackendFromEnv() === 'postgres') {
  const url = (process.env.PROMPT_LEDGER_POSTGRES_URL ?? process.env.DATABASE_URL ?? '').trim();
  if (!url) {
    console.error(
      'PROMPT_LEDGER_BACKEND=postgres exige PROMPT_LEDGER_POSTGRES_URL ou DATABASE_URL.',
    );
    process.exit(1);
  }
  const moduleName = 'pg';
  const pg = (await import(moduleName)) as {
    Client?: new (config: { connectionString: string }) => {
      query(text: string, params?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
      end?: () => Promise<void>;
    };
  };
  if (!pg.Client) {
    console.error('Pacote "pg" não encontrado. Instale com npm install pg.');
    process.exit(1);
  }
  const client = new pg.Client({ connectionString: url });
  try {
    await client.query('SELECT 1');
    const promptCount = Number(
      (
        await client.query(
          'SELECT COUNT(*)::int AS count FROM prompt_events WHERE created_at < $1',
          [cutoff],
        )
      ).rows[0]?.count ?? 0,
    );
    const usageCount = Number(
      (
        await client.query(
          'SELECT COUNT(*)::int AS count FROM content_usage WHERE created_at < $1',
          [cutoff],
        )
      ).rows[0]?.count ?? 0,
    );
    console.log(
      `Política: ${days} dias · corte ${new Date(cutoff).toISOString()} · ${promptCount} eventos de prompt · ${usageCount} usos`,
    );
    if (dryRun) {
      console.log('Dry-run: nenhuma linha removida.');
    } else if (redactPrompts) {
      await client.query(
        `UPDATE prompt_events
         SET prompt = NULL, normalized_prompt = NULL, canonical_key = NULL
         WHERE created_at < $1`,
        [cutoff],
      );
      console.log(`Prompts redigidos: ${promptCount} (agregados preservados).`);
    } else {
      await client.query('BEGIN');
      try {
        await client.query('DELETE FROM prompt_events WHERE created_at < $1', [cutoff]);
        await client.query('DELETE FROM content_usage WHERE created_at < $1', [cutoff]);
        await client.query('COMMIT');
        console.log(`Linhas removidas: ${promptCount} prompts · ${usageCount} usos.`);
      } catch (err) {
        try {
          await client.query('ROLLBACK');
        } catch {
          // ignore rollback failure
        }
        throw err;
      }
    }
  } finally {
    await client.end?.();
  }
  process.exit(0);
}

if (!fs.existsSync(dbPath)) {
  console.error(`Ledger não encontrado em ${dbPath}.`);
  process.exit(1);
}

const db = new DatabaseSync(dbPath);
try {
  const promptCount = (
    db.prepare('SELECT COUNT(*) AS count FROM prompt_events WHERE created_at < ?').get(cutoff) as {
      count: number;
    }
  ).count;
  const usageCount = (
    db.prepare('SELECT COUNT(*) AS count FROM content_usage WHERE created_at < ?').get(cutoff) as {
      count: number;
    }
  ).count;

  console.log(
    `Política: ${days} dias · corte ${new Date(cutoff).toISOString()} · ${promptCount} eventos de prompt · ${usageCount} usos`,
  );
  if (dryRun) {
    console.log('Dry-run: nenhuma linha removida.');
    process.exit(0);
  }

  db.exec('BEGIN');
  try {
    if (redactPrompts) {
      db.prepare(
        `UPDATE prompt_events
         SET prompt = NULL, normalized_prompt = NULL, canonical_key = NULL
         WHERE created_at < ?`,
      ).run(cutoff);
      console.log(`Prompts redigidos: ${promptCount} (agregados preservados).`);
    } else {
      db.prepare('DELETE FROM prompt_events WHERE created_at < ?').run(cutoff);
      db.prepare('DELETE FROM content_usage WHERE created_at < ?').run(cutoff);
      console.log(`Linhas removidas: ${promptCount} prompts · ${usageCount} usos.`);
    }
    db.exec('COMMIT');
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // ignore rollback failure
    }
    throw err;
  }
} finally {
  db.close();
}
