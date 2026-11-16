import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CatalogFile } from '../server/catalog.ts';
import type { CatalogCandidate } from './catalog-candidates.ts';
import { promoteCandidates } from './catalogPromote.ts';

interface CandidateFile {
  generatedAt: number;
  sourceReport: string;
  candidates: CatalogCandidate[];
}

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const candidatesPath = path.resolve(
  ROOT,
  argValue('--file') ?? path.join('content', 'catalog', 'candidates.json'),
);
const catalogPath = path.resolve(
  ROOT,
  argValue('--catalog') ?? path.join('content', 'catalog', 'catalog.json'),
);
const version = argValue('--version')?.trim();
const approveAll = process.argv.includes('--all');
const idsArg = argValue('--ids');

if (!version) {
  console.error('Informe --version <nova-versão> para publicar o catálogo.');
  process.exit(1);
}
if (!approveAll && !idsArg) {
  console.error('Informe --ids id1,id2 ou --all após revisar os candidatos.');
  process.exit(1);
}

const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8')) as CatalogFile;
const candidateFile = JSON.parse(
  fs.readFileSync(candidatesPath, 'utf8'),
) as CandidateFile;
const ids = approveAll
  ? candidateFile.candidates.map((candidate) => candidate.id)
  : idsArg!.split(',').map((id) => id.trim()).filter(Boolean);

const result = promoteCandidates(catalog, candidateFile.candidates, ids, version);
fs.writeFileSync(catalogPath, `${JSON.stringify(result.catalog, null, 2)}\n`, 'utf8');
fs.writeFileSync(
  candidatesPath,
  `${JSON.stringify({ ...candidateFile, candidates: result.candidates }, null, 2)}\n`,
  'utf8',
);

console.log(`Catálogo publicado como ${version}.`);
console.log(`Promovidos: ${result.promoted.length}`);
for (const id of result.promoted) console.log(`  + ${id}`);
console.log(`Aliases mesclados em itens existentes: ${result.merged.length}`);
for (const id of result.merged) console.log(`  ~ ${id}`);
if (result.skipped.length > 0) {
  console.log('Ignorados:');
  for (const skip of result.skipped) console.log(`  - ${skip.id}: ${skip.reason}`);
}
