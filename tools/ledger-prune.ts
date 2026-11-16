import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

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
