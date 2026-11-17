import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CatalogFile } from '../server/catalog.ts';
import { writeCatalogArtifacts } from '../server/catalogArtifacts.ts';

/**
 * Regenera `index.json` + `shards/` a partir do `catalog.json` existente,
 * sem rebuildar o conteúdo procedural. Use depois de editar/promover itens
 * manualmente ou para migrar um artefato antigo.
 */

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const catalogPath = path.resolve(
  ROOT,
  argValue('--file') ?? path.join('content', 'catalog', 'catalog.json'),
);

const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8')) as CatalogFile;
const result = writeCatalogArtifacts(catalog, path.dirname(catalogPath));
console.log(
  `Índice ${catalog.version}: ${catalog.weapons.length} armas, ${catalog.events.length} eventos`,
);
console.log(`Escrito: ${result.indexPath} (${result.shardCount} shards)`);
