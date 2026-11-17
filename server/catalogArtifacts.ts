import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { EventArchetype } from '../src/shared/types.ts';
import type {
  CatalogEventItem,
  CatalogFile,
  CatalogItemMeta,
  CatalogWeaponItem,
} from './catalog.ts';

/**
 * Artefatos de catálogo para milhares de itens.
 *
 * `catalog.json` continua sendo o artefato completo (build, testes e
 * ferramentas offline). O runtime usa `index.json` + `shards/*.json`:
 *
 * - o índice é quente, pequeno e carrega no boot;
 * - cada shard guarda só payloads, é imutável e tem nome content-addressed;
 * - o runtime carrega shards sob demanda em um LRU;
 * - o reload troca o índice atomicamente e mantém shards antigos intactos.
 */

export const CATALOG_INDEX_VERSION = 1;
export const CATALOG_SHARD_BUCKETS = 32;

export interface CatalogWeaponIndexSummary {
  budgetUsed: number;
  primaryColor: string;
  damage: number;
  projectiles: number;
}

export interface CatalogEventIndexSummary {
  archetype: EventArchetype;
  budgetUsed: number;
}

export interface CatalogWeaponIndexEntry extends CatalogItemMeta {
  id: string;
  name: string;
  tags: string[];
  aliases: string[];
  assets: string[];
  shard: string;
  summary: CatalogWeaponIndexSummary;
}

export interface CatalogEventIndexEntry extends CatalogItemMeta {
  id: string;
  name: string;
  tags: string[];
  aliases: string[];
  assets: string[];
  shard: string;
  summary: CatalogEventIndexSummary;
}

export interface CatalogIndexFile {
  schemaVersion: number;
  indexVersion: number;
  version: string;
  shards: Record<string, string>;
  weapons: CatalogWeaponIndexEntry[];
  events: CatalogEventIndexEntry[];
}

export interface CatalogShardFile {
  schemaVersion: number;
  version: string;
  kind: 'weapon' | 'event';
  items: Record<string, unknown>;
}

export interface CatalogArtifactBuild {
  index: CatalogIndexFile;
  shards: Array<{ filename: string; content: string }>;
}

const VALID_PROVENANCE = new Set([
  'authored',
  'ai_assisted',
  'procedural',
  'template',
  'seed',
]);

function shardKeyFor(kind: 'weapon' | 'event', id: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  const bucket = String((hash >>> 0) % CATALOG_SHARD_BUCKETS).padStart(2, '0');
  return `${kind === 'weapon' ? 'weapons' : 'events'}-${bucket}`;
}

function contentHash(value: string): string {
  return crypto.createHash('sha1').update(value).digest('hex').slice(0, 12);
}

function weaponSummary(item: CatalogWeaponItem): CatalogWeaponIndexSummary {
  return {
    budgetUsed: item.payload.budgetUsed,
    primaryColor: item.payload.palette[0]?.hex ?? '#38bdf8',
    damage: item.payload.stats.damage,
    projectiles: item.payload.stats.projectiles,
  };
}

function eventSummary(item: CatalogEventItem): CatalogEventIndexSummary {
  return {
    archetype: item.payload.archetype,
    budgetUsed: item.payload.budgetUsed,
  };
}

function shardFilename(key: string, shard: CatalogShardFile): string {
  return `${key}-${contentHash(JSON.stringify(shard))}.json`;
}

/**
 * Monta índice + shards determinísticos a partir do catálogo completo.
 * Os shards são content-addressed: um novo build nunca sobrescreve o arquivo
 * que uma versão anterior do índice ainda referencia.
 */
export function buildCatalogIndex(catalog: CatalogFile): CatalogArtifactBuild {
  const used = new Set<string>();
  const shardMaps = new Map<
    string,
    { kind: 'weapon' | 'event'; items: Record<string, unknown> }
  >();
  const shards = new Map<string, string>();
  const weapons: CatalogWeaponIndexEntry[] = [];
  const events: CatalogEventIndexEntry[] = [];

  const remember = (
    kind: 'weapon' | 'event',
    id: string,
    payload: unknown,
  ): string => {
    if (used.has(id)) throw new Error(`Catálogo com id duplicado: ${id}`);
    used.add(id);
    const key = shardKeyFor(kind, id);
    let shard = shardMaps.get(key);
    if (!shard) {
      shard = { kind, items: {} };
      shardMaps.set(key, shard);
    }
    shard.items[id] = payload;
    return key;
  };

  for (const item of catalog.weapons) {
    const shard = remember('weapon', item.id, item.payload);
    weapons.push({
      id: item.id,
      name: item.name,
      tags: [...item.tags],
      aliases: [...item.aliases],
      assets: [...item.assets],
      status: item.status,
      provenance: item.provenance,
      introducedIn: item.introducedIn,
      shard,
      summary: weaponSummary(item),
    });
  }
  for (const item of catalog.events) {
    const shard = remember('event', item.id, item.payload);
    events.push({
      id: item.id,
      name: item.name,
      tags: [...item.tags],
      aliases: [...item.aliases],
      assets: [...item.assets],
      status: item.status,
      provenance: item.provenance,
      introducedIn: item.introducedIn,
      shard,
      summary: eventSummary(item),
    });
  }

  const shardFiles: Array<{ filename: string; content: string }> = [];
  const shardRefs: Record<string, string> = {};
  for (const key of Array.from(shardMaps.keys()).sort()) {
    const shard = shardMaps.get(key)!;
    const sortedItems = Object.fromEntries(
      Object.entries(shard.items).sort(([a], [b]) => a.localeCompare(b)),
    );
    const file: CatalogShardFile = {
      schemaVersion: catalog.schemaVersion ?? 3,
      version: catalog.version,
      kind: shard.kind,
      items: sortedItems,
    };
    const content = `${JSON.stringify(file)}\n`;
    const filename = shardFilename(key, file);
    shardRefs[key] = filename;
    shardFiles.push({ filename, content });
  }

  return {
    index: {
      schemaVersion: catalog.schemaVersion ?? 3,
      indexVersion: CATALOG_INDEX_VERSION,
      version: catalog.version,
      shards: shardRefs,
      weapons,
      events,
    },
    shards: shardFiles,
  };
}

function assertItemMeta(
  item: { id: string; status?: string; provenance?: string; introducedIn?: unknown },
): void {
  if (item.status !== undefined && item.status !== 'approved' && item.status !== 'deprecated') {
    throw new Error(`Índice inválido: status desconhecido em ${item.id}.`);
  }
  if (item.provenance !== undefined && !VALID_PROVENANCE.has(item.provenance)) {
    throw new Error(`Índice inválido: provenance desconhecida em ${item.id}.`);
  }
  if (item.introducedIn !== undefined && typeof item.introducedIn !== 'string') {
    throw new Error(`Índice inválido: introducedIn inválido em ${item.id}.`);
  }
}

function assertStringArray(value: unknown, label: string): asserts value is string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new Error(`Índice inválido: ${label} deve ser string[].`);
  }
}

export function validateCatalogIndex(raw: unknown): CatalogIndexFile {
  const data = raw as Partial<CatalogIndexFile> | null;
  if (!data || typeof data.version !== 'string' || data.version.length === 0) {
    throw new Error('Índice inválido: versão ausente.');
  }
  if (data.schemaVersion !== 2 && data.schemaVersion !== 3) {
    throw new Error(`Índice inválido: schemaVersion não suportada (${data.schemaVersion}).`);
  }
  if (data.indexVersion !== CATALOG_INDEX_VERSION) {
    throw new Error(`Índice inválido: indexVersion não suportada (${data.indexVersion}).`);
  }
  if (!data.shards || typeof data.shards !== 'object' || Array.isArray(data.shards)) {
    throw new Error('Índice inválido: mapa de shards ausente.');
  }
  for (const [key, filename] of Object.entries(data.shards)) {
    if (typeof filename !== 'string' || !filename.trim()) {
      throw new Error(`Índice inválido: shard ${key} sem arquivo.`);
    }
  }
  if (!Array.isArray(data.weapons) || data.weapons.length === 0) {
    throw new Error('Índice inválido: nenhuma arma.');
  }
  if (!Array.isArray(data.events) || data.events.length === 0) {
    throw new Error('Índice inválido: nenhum evento.');
  }

  const seen = new Set<string>();
  for (const item of [...data.weapons, ...data.events]) {
    if (!item || typeof item.id !== 'string' || typeof item.name !== 'string') {
      throw new Error('Índice inválido: item sem id/nome.');
    }
    if (seen.has(item.id)) throw new Error(`Índice inválido: id duplicado (${item.id}).`);
    seen.add(item.id);
    assertStringArray(item.tags, `${item.id}.tags`);
    assertStringArray(item.aliases, `${item.id}.aliases`);
    assertStringArray(item.assets, `${item.id}.assets`);
    if (typeof item.shard !== 'string' || !data.shards[item.shard]) {
      throw new Error(`Índice inválido: shard ausente em ${item.id}.`);
    }
    assertItemMeta(item);
    if (!item.summary || typeof item.summary !== 'object') {
      throw new Error(`Índice inválido: summary ausente em ${item.id}.`);
    }
    if (typeof item.summary.budgetUsed !== 'number') {
      throw new Error(`Índice inválido: budgetUsed inválido em ${item.id}.`);
    }
  }

  return data as CatalogIndexFile;
}

function writeFileAtomic(filePath: string, content: string): void {
  const tempPath = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(tempPath, content, 'utf8');
  try {
    fs.renameSync(tempPath, filePath);
  } catch {
    // Windows pode recusar rename sobre um arquivo existente.
    fs.rmSync(filePath, { force: true });
    fs.renameSync(tempPath, filePath);
  }
}

export interface CatalogArtifactWriteResult {
  indexPath: string;
  shardCount: number;
}

/**
 * Grava shards primeiro e o índice por último. Um leitor concorrente vê o
 * índice antigo até o rename final; os shards antigos continuam existindo.
 */
export function writeCatalogArtifacts(
  catalog: CatalogFile,
  outDir: string,
): CatalogArtifactWriteResult {
  const build = buildCatalogIndex(catalog);
  const shardsDir = path.join(outDir, 'shards');
  fs.mkdirSync(shardsDir, { recursive: true });
  for (const shard of build.shards) {
    const target = path.join(shardsDir, shard.filename);
    if (!fs.existsSync(target)) writeFileAtomic(target, shard.content);
  }
  const indexPath = path.join(outDir, 'index.json');
  writeFileAtomic(indexPath, `${JSON.stringify(build.index)}\n`);
  return { indexPath, shardCount: build.shards.length };
}
