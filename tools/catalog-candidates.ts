import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizePrompt } from '../src/shared/prompt.ts';
import { expandAliases } from './aliasExpansion.ts';
import type {
  EntityBlueprint,
  EventArchetype,
  EventParams,
  WeaponBlueprint,
} from '../src/shared/types.ts';
import type { CatalogEventPayload } from '../server/catalog.ts';
import { generateAiMapEvent, generateAiWeapon } from './aiGenerator.ts';

interface DemandGap {
  canonicalKey: string;
  kind: 'weapon' | 'event';
  examples: string[];
  count: number;
  itemId: string | null;
  strategy: string | null;
  gap: boolean;
  priority?: number;
}

interface DemandReport {
  generatedAt: number;
  catalogVersion: string;
  gaps: DemandGap[];
}

export interface CatalogCandidate {
  id: string;
  kind: 'weapon' | 'event';
  status: 'candidate' | 'approved';
  provenance: 'ai_assisted' | 'procedural';
  prompt: string;
  tags: string[];
  aliases: string[];
  payload: WeaponBlueprint | CatalogEventPayload;
  budgetUsed: number;
  wasClamped: boolean;
  sourceKey: string;
  createdAt: number;
  approvedAt?: number;
}

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

function latestReport(reportsDir: string): string {
  if (!fs.existsSync(reportsDir)) {
    throw new Error(`Diretório de relatórios não encontrado: ${reportsDir}. Rode ledger:report antes.`);
  }
  const files = fs
    .readdirSync(reportsDir)
    .filter((file) => file.startsWith('demand-') && file.endsWith('.json'))
    .sort();
  if (files.length === 0) throw new Error(`Nenhum relatório em ${reportsDir}.`);
  return path.join(reportsDir, files[files.length - 1]);
}

function slugify(prompt: string): string {
  const tokens = normalizePrompt(prompt)
    .split(/\s+/)
    .filter((token) => token.length >= 3)
    .slice(0, 6);
  return tokens.join('_') || 'item';
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.map((v) => v.trim()).filter(Boolean)));
}

function candidateTags(
  prompt: string,
  kind: 'weapon' | 'event',
  extra: string[] = [],
): string[] {
  const tokens = normalizePrompt(prompt)
    .split(/\s+/)
    .filter((token) => token.length >= 3)
    .slice(0, 10);
  return unique([kind, 'candidate', ...tokens, ...extra]);
}

function weaponStyleTags(prompt: string): string[] {
  const p = normalizePrompt(prompt);
  const tags: string[] = [];
  const archetypes: Array<[string, RegExp]> = [
    ['pistol', /pistola|pistol|revolver/],
    ['rifle', /rifle|fuzil|carabina/],
    ['smg', /smg|submetralhadora|metralhadora|metralha/],
    ['shotgun', /escopeta|espingarda|shotgun|cartucho|estilha/],
    ['sniper', /sniper|precisao|franco|laser|feixe/],
    ['launcher', /bazuca|lancador|canhao|missil|foguete|meteoro/],
  ];
  for (const [tag, rx] of archetypes) if (rx.test(p)) tags.push(tag);
  const elements: Array<[string, RegExp]> = [
    ['ice', /gelo|congel|crio|neve|frost|glacial/],
    ['fire', /fogo|lava|chama|incendi|solar|flamejante|explosiv/],
    ['toxic', /toxic|veneno|acido|radioativ/],
    ['void', /vazio|gravit|sombrio|arcano|nebulosa/],
    ['electric', /eletric|choque|raio|tesla|trovao|sonic/],
  ];
  for (const [tag, rx] of elements) if (rx.test(p)) tags.push(tag);
  return tags;
}

function eventStyleTags(event: {
  archetype: string;
  params: { weatherKind?: string; mutationKind?: string; aiBehavior?: string };
}): string[] {
  const category =
    event.archetype === 'WEATHER_HAZARD'
      ? 'weather'
      : event.archetype === 'TERRAIN_MUTATION'
        ? 'terrain'
        : event.archetype === 'ENTITY_SPAWN'
          ? 'entity'
          : 'supply';
  const tags = [category];
  if (event.archetype === 'WEATHER_HAZARD' && event.params.weatherKind) {
    tags.push(event.params.weatherKind);
  } else if (event.archetype === 'TERRAIN_MUTATION' && event.params.mutationKind) {
    tags.push(event.params.mutationKind);
  } else if (event.archetype === 'ENTITY_SPAWN' && event.params.aiBehavior) {
    tags.push(event.params.aiBehavior);
  }
  return tags;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const reportsDir = path.resolve(ROOT, 'content', 'reports');
const reportPath = argValue('--report')
  ? path.resolve(ROOT, argValue('--report')!)
  : latestReport(reportsDir);
const outPath = path.resolve(
  ROOT,
  argValue('--out') ?? path.join('content', 'catalog', 'candidates.json'),
);
const limit = Math.max(1, Number(argValue('--limit') ?? 10));
const useLlm = !process.argv.includes('--no-llm');

const report = JSON.parse(fs.readFileSync(reportPath, 'utf8')) as DemandReport;
const gaps = report.gaps.slice(0, limit);
if (gaps.length === 0) {
  console.log('O relatório não tem lacunas. Nada a gerar.');
  process.exit(0);
}

const candidates: CatalogCandidate[] = [];
for (let index = 0; index < gaps.length; index++) {
  const gap = gaps[index];
  const prompt = gap.examples[0] || gap.canonicalKey.replace(/\|/g, ' ');
  const id = `cand_${gap.kind}_${slugify(prompt)}_${index + 1}`;
  const aliases = expandAliases(prompt, gap.canonicalKey, gap.examples);

  if (gap.kind === 'weapon') {
    const blueprint = await generateAiWeapon(prompt, { useLlm });
    candidates.push({
      id,
      kind: 'weapon',
      status: 'candidate',
      provenance: blueprint.fromDatabase ? 'procedural' : useLlm ? 'ai_assisted' : 'procedural',
      prompt,
      tags: candidateTags(prompt, 'weapon', weaponStyleTags(prompt)),
      aliases,
      payload: blueprint,
      budgetUsed: blueprint.budgetUsed,
      wasClamped: blueprint.wasClamped,
      sourceKey: gap.canonicalKey,
      createdAt: Date.now(),
    });
  } else {
    const event = await generateAiMapEvent(
      prompt,
      'catalog',
      'Forja Offline',
      [0, 10, 0],
      { useLlm },
    );
    const payload: CatalogEventPayload = {
      archetype: event.archetype as EventArchetype,
      params: { ...event.params } as EventParams,
      entityBlueprint: event.entityBlueprint
        ? ({
            name: event.entityBlueprint.name,
            palette: event.entityBlueprint.palette.map((color) => ({ ...color })),
            rleVoxels: [...event.entityBlueprint.rleVoxels],
          } satisfies EntityBlueprint)
        : undefined,
      budgetUsed: event.budgetUsed,
      wasClamped: event.wasClamped,
    };
    candidates.push({
      id,
      kind: 'event',
      status: 'candidate',
      provenance: event.fromDatabase ? 'procedural' : useLlm ? 'ai_assisted' : 'procedural',
      prompt,
      tags: candidateTags(prompt, 'event', eventStyleTags(event)),
      aliases,
      payload,
      budgetUsed: event.budgetUsed,
      wasClamped: event.wasClamped,
      sourceKey: gap.canonicalKey,
      createdAt: Date.now(),
    });
  }
}

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(
  outPath,
  `${JSON.stringify(
    {
      generatedAt: Date.now(),
      sourceReport: path.relative(ROOT, reportPath),
      candidates,
    },
    null,
    2,
  )}\n`,
  'utf8',
);

console.log(`Candidatos gerados: ${candidates.length}`);
console.log(`  ${outPath}`);
for (const candidate of candidates) {
  console.log(
    `  ${candidate.id} · ${candidate.kind} · ${candidate.prompt} · ${candidate.budgetUsed}/100 pts${candidate.wasClamped ? ' (clamp)' : ''}`,
  );
}
