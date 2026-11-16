import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getCatalogVersion } from '../server/catalog.ts';
import type { PromptEventRow } from '../server/ledger.ts';
import { ledgerBackendFromEnv, openLedgerReader } from '../server/ledgerFactory.ts';
import {
  buildDemandReport,
  renderDemandReportMarkdown,
} from '../server/ledgerReport.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

const backend = ledgerBackendFromEnv();
const dbPath =
  argValue('--db') ??
  process.env.PROMPT_LEDGER_DB_PATH ??
  path.resolve(ROOT, 'data', 'prompt-ledger.db');
const outDir = path.resolve(ROOT, argValue('--out') ?? path.join('content', 'reports'));
const limit = Math.max(1, Number(argValue('--limit') ?? 100000));
const days = Math.max(0, Number(argValue('--days') ?? 0));
const since = days > 0 ? Date.now() - days * 24 * 60 * 60 * 1000 : 0;

if (backend === 'sqlite' && !fs.existsSync(dbPath)) {
  console.error(`Ledger não encontrado em ${dbPath}. Jogue algumas partidas ou defina --db.`);
  process.exit(1);
}

const reader = await openLedgerReader({ backend, dbPath });
let rows: PromptEventRow[] = [];
try {
  rows = await reader.readPromptEvents(limit, since);
} finally {
  await reader.close();
}
let catalogVersion = '';
try {
  catalogVersion = getCatalogVersion();
} catch {
  catalogVersion = rows[rows.length - 1]?.catalog_version ?? '';
}

const report = buildDemandReport(rows, catalogVersion);
fs.mkdirSync(outDir, { recursive: true });
const stamp = new Date(report.generatedAt)
  .toISOString()
  .replace(/[:.]/g, '-')
  .replace('T', '_')
  .slice(0, 19);
const jsonPath = path.join(outDir, `demand-${stamp}.json`);
const mdPath = path.join(outDir, `demand-${stamp}.md`);
fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
fs.writeFileSync(mdPath, renderDemandReportMarkdown(report), 'utf8');

console.log(`Relatório gerado:`);
console.log(`  ${jsonPath}`);
console.log(`  ${mdPath}`);
console.log(
  `Prompts: ${report.totals.submitted} · intenções: ${report.totals.uniqueIntents} · lacunas: ${report.totals.gaps} · cobertura: ${(report.totals.coverageRate * 100).toFixed(1)}%`,
);
