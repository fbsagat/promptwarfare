import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCanonicalKey, normalizePrompt } from '../src/shared/prompt.ts';
import type { PromptEventRow } from '../server/ledger.ts';
import {
  buildDemandReport,
  renderDemandReportMarkdown,
} from '../server/ledgerReport.ts';
import {
  getCatalogVersion,
  resolveEventFromCatalog,
  resolveWeaponFromCatalog,
} from '../server/catalog.ts';

interface SeedEntry {
  kind: 'weapon' | 'event';
  prompt: string;
  count: number;
}

interface SeedFile {
  version: string;
  description: string;
  prompts: SeedEntry[];
}

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const seedPath = path.resolve(
  ROOT,
  argValue('--seed') ?? path.join('content', 'seeds', 'initial-demand.json'),
);
const outBase = path.resolve(
  ROOT,
  argValue('--out') ?? path.join('content', 'seeds', 'initial-demand-report'),
);

const seed = JSON.parse(fs.readFileSync(seedPath, 'utf8')) as SeedFile;
const catalogVersion = getCatalogVersion();
const rows: PromptEventRow[] = [];
let nextId = 1;
let nextTime = Date.now() - 7 * 24 * 60 * 60 * 1000;

for (const entry of seed.prompts) {
  const count = Math.max(1, Math.min(50, Math.round(entry.count)));
  const prompt = entry.prompt.trim().slice(0, 90);
  const normalized = normalizePrompt(prompt);
  const canonical = buildCanonicalKey(prompt);
  const resolution =
    entry.kind === 'weapon'
      ? resolveWeaponFromCatalog(prompt)
      : resolveEventFromCatalog(prompt, 'seed', 'Demanda Inicial', [0, 10, 0]);
  const itemId = resolution.itemId;
  const strategy = resolution.strategy;
  const budgetUsed =
    entry.kind === 'weapon'
      ? (resolution as ReturnType<typeof resolveWeaponFromCatalog>).blueprint.budgetUsed
      : (resolution as ReturnType<typeof resolveEventFromCatalog>).event.budgetUsed;
  const wasClamped =
    entry.kind === 'weapon'
      ? (resolution as ReturnType<typeof resolveWeaponFromCatalog>).blueprint.wasClamped
      : (resolution as ReturnType<typeof resolveEventFromCatalog>).event.wasClamped;

  for (let i = 0; i < count; i++) {
    const openedAt = nextTime;
    const submittedAt = openedAt + 2500 + (i % 8) * 500;
    const sessionId = `seed_${entry.kind}_${nextId}`;
    rows.push({
      id: nextId++,
      created_at: openedAt,
      session_id: sessionId,
      actor_type: 'seed',
      actor_ref: 'seed',
      room_id: 'seed',
      match_id: 'seed',
      kind: entry.kind,
      phase: 'opened',
      prompt: null,
      normalized_prompt: null,
      canonical_key: null,
      item_id: null,
      strategy: null,
      catalog_version: catalogVersion,
      budget_used: null,
      was_clamped: null,
      elapsed_ms: null,
      reason: null,
    });
    rows.push({
      id: nextId++,
      created_at: submittedAt,
      session_id: sessionId,
      actor_type: 'seed',
      actor_ref: 'seed',
      room_id: 'seed',
      match_id: 'seed',
      kind: entry.kind,
      phase: 'submitted',
      prompt,
      normalized_prompt: normalized,
      canonical_key: canonical,
      item_id: itemId,
      strategy,
      catalog_version: catalogVersion,
      budget_used: budgetUsed,
      was_clamped: wasClamped ? 1 : 0,
      elapsed_ms: submittedAt - openedAt,
      reason: null,
    });
    nextTime += 60_000;
  }
}

const report = buildDemandReport(rows, catalogVersion);
const markdown = renderDemandReportMarkdown(report);
fs.mkdirSync(path.dirname(outBase), { recursive: true });
fs.writeFileSync(
  `${outBase}.json`,
  `${JSON.stringify({ ...report, seedVersion: seed.version, description: seed.description }, null, 2)}\n`,
  'utf8',
);
fs.writeFileSync(`${outBase}.md`, markdown, 'utf8');

console.log(`Demanda inicial: ${seed.prompts.length} intenções, ${report.totals.submitted} submissões sintéticas`);
console.log(`Cobertura: ${(report.totals.coverageRate * 100).toFixed(1)}% · lacunas: ${report.totals.gaps}`);
console.log(`  ${outBase}.json`);
console.log(`  ${outBase}.md`);
