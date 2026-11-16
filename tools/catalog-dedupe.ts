import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CatalogFile } from '../server/catalog.ts';
import {
  findNearDuplicates,
  SEMANTIC_DUPLICATE_THRESHOLD,
  type SemanticItem,
} from '../server/semanticDuplicates.ts';
import type { CatalogCandidate } from './catalog-candidates.ts';

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const catalogPath = path.resolve(
  ROOT,
  argValue('--catalog') ?? path.join('content', 'catalog', 'catalog.json'),
);
const candidatesPath = argValue('--candidates')
  ? path.resolve(ROOT, argValue('--candidates')!)
  : path.resolve(ROOT, 'content', 'catalog', 'candidates.json');
const outDir = path.resolve(ROOT, argValue('--out') ?? path.join('content', 'reports'));
const threshold = Math.max(
  0,
  Math.min(1, Number(argValue('--threshold') ?? SEMANTIC_DUPLICATE_THRESHOLD)),
);

const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8')) as CatalogFile;
const items: SemanticItem[] = [
  ...catalog.weapons.map((item) => ({
    id: item.id,
    kind: 'weapon' as const,
    tags: item.tags,
    texts: [item.name, ...item.aliases],
  })),
  ...catalog.events.map((item) => ({
    id: item.id,
    kind: 'event' as const,
    tags: item.tags,
    texts: [item.name, ...item.aliases],
  })),
];

if (fs.existsSync(candidatesPath)) {
  const file = JSON.parse(fs.readFileSync(candidatesPath, 'utf8')) as {
    candidates: CatalogCandidate[];
  };
  for (const candidate of file.candidates) {
    if (candidate.status === 'approved') continue;
    items.push({
      id: candidate.id,
      kind: candidate.kind,
      tags: candidate.tags,
      texts: [candidate.prompt, ...candidate.aliases],
    });
  }
}

const pairs = findNearDuplicates(items, threshold);
const report = {
  generatedAt: Date.now(),
  catalogVersion: catalog.version,
  threshold,
  itemCount: items.length,
  pairCount: pairs.length,
  pairs: pairs.map((pair) => ({
    kind: pair.kind,
    a: { id: pair.a.id, texts: pair.a.texts },
    b: { id: pair.b.id, texts: pair.b.texts },
    similarity: Math.round(pair.similarity * 1000) / 1000,
    sharedTags: pair.sharedTags,
  })),
};

fs.mkdirSync(outDir, { recursive: true });
const stamp = new Date(report.generatedAt)
  .toISOString()
  .replace(/[:.]/g, '-')
  .replace('T', '_')
  .slice(0, 19);
const jsonPath = path.join(outDir, `dedupe-${stamp}.json`);
const mdPath = path.join(outDir, `dedupe-${stamp}.md`);
fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

const lines = [
  '# Quase-duplicatas semânticas',
  '',
  `- **Gerado em:** ${new Date(report.generatedAt).toISOString()}`,
  `- **Versão do catálogo:** ${report.catalogVersion}`,
  `- **Itens analisados:** ${report.itemCount}`,
  `- **Threshold:** ${report.threshold}`,
  `- **Pares:** ${report.pairCount}`,
  '',
  '| Tipo | A | B | Similaridade | Tags |',
  '| --- | --- | --- | ---: | --- |',
];
for (const pair of report.pairs) {
  lines.push(
    `| ${pair.kind} | ${pair.a.id}: ${pair.a.texts[0] ?? ''} | ${pair.b.id}: ${pair.b.texts[0] ?? ''} | ${pair.similarity} | ${pair.sharedTags.join(', ')} |`,
  );
}
fs.writeFileSync(mdPath, `${lines.join('\n')}\n`, 'utf8');

console.log('Relatório de quase-duplicatas gerado:');
console.log(`  ${jsonPath}`);
console.log(`  ${mdPath}`);
console.log(`Itens: ${report.itemCount} · pares: ${report.pairCount} · threshold: ${threshold}`);
