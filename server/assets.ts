import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AssetEntry, AssetManifest, AssetType } from '../src/shared/assets.ts';

export type { AssetEntry, AssetManifest, AssetType } from '../src/shared/assets.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MANIFEST_PATH = path.resolve(__dirname, '..', 'content', 'assets', 'manifest.json');
const VALID_TYPES = new Set<AssetType>(['texture', 'sound', 'effect', 'waypoint']);

let cached: AssetManifest | null = null;
let assetIndex: Map<string, AssetEntry> | null = null;
let coreAssetIds: string[] | null = null;

const CORE_ASSET_PREFIXES = [
  'sfx:footstep:',
  'sfx:impact:',
  'sfx:ambience:',
  'sfx:water:',
  'sfx:ui:',
  'sfx:dig:',
  'sfx:land:',
  'sfx:pickup:',
  'sfx:equip:',
  'sfx:drop:',
  'sfx:traversal:',
  'sfx:grapple:',
  'waypoint:',
];
const CORE_ASSET_IDS = new Set(['sfx:forge', 'fx:shockwave']);

function isCoreAsset(id: string): boolean {
  if (CORE_ASSET_IDS.has(id)) return true;
  return CORE_ASSET_PREFIXES.some((prefix) => id.startsWith(prefix));
}

function assertManifest(raw: unknown): AssetManifest {
  const data = raw as Partial<AssetManifest> | null;
  if (!data || typeof data.version !== 'string' || !Array.isArray(data.assets)) {
    throw new Error('Manifesto de assets inválido: versão ou lista ausente.');
  }
  if (data.baseUrl !== undefined && typeof data.baseUrl !== 'string') {
    throw new Error('Manifesto de assets inválido: baseUrl deve ser string.');
  }
  if (data.assets.length === 0) {
    throw new Error('Manifesto de assets inválido: lista vazia.');
  }
  const ids = new Set<string>();
  for (const asset of data.assets) {
    if (!asset || typeof asset.id !== 'string' || ids.has(asset.id)) {
      throw new Error(`Manifesto de assets inválido: id duplicado/ausente (${asset?.id}).`);
    }
    if (!VALID_TYPES.has(asset.type)) {
      throw new Error(`Asset ${asset.id} com tipo inválido: ${asset.type}`);
    }
    if (asset.status !== 'approved' && asset.status !== 'deprecated') {
      throw new Error(`Asset ${asset.id} com status inválido: ${asset.status}`);
    }
    if (!Array.isArray(asset.tags) || typeof asset.params !== 'object' || asset.params === null) {
      throw new Error(`Asset ${asset.id} incompleto.`);
    }
    if (asset.url !== undefined && typeof asset.url !== 'string') {
      throw new Error(`Asset ${asset.id} com url inválida.`);
    }
    if (asset.mimeType !== undefined && typeof asset.mimeType !== 'string') {
      throw new Error(`Asset ${asset.id} com mimeType inválido.`);
    }
    if (asset.hash !== undefined && typeof asset.hash !== 'string') {
      throw new Error(`Asset ${asset.id} com hash inválido.`);
    }
    ids.add(asset.id);
  }
  return data as AssetManifest;
}

export function getAssetManifest(): AssetManifest {
  if (!cached) {
    const manifest = assertManifest(
      JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8')),
    );
    const baseUrl = process.env.ASSET_BASE_URL?.trim();
    if (baseUrl) {
      cached = { ...manifest, baseUrl };
    } else {
      const relativeBase =
        manifest.baseUrl !== undefined && !/^https?:\/\//i.test(manifest.baseUrl);
      if (relativeBase && process.env.SERVE_CLIENT === 'false') {
        console.warn(
          '[assets] ASSET_BASE_URL ausente em deploy API-only: o cliente vai resolver assets contra a origem do frontend.',
        );
      }
      cached = manifest;
    }
  }
  return cached;
}

export function getAssetVersion(): string {
  return getAssetManifest().version;
}

export function getAssetIds(): Set<string> {
  return new Set(getAssetManifest().assets.map((asset) => asset.id));
}

/** Índice por id; evita `.find()` linear em cada consulta de manifest. */
export function getAssetIndex(): Map<string, AssetEntry> {
  if (!assetIndex) {
    assetIndex = new Map(getAssetManifest().assets.map((asset) => [asset.id, asset]));
  }
  return assetIndex;
}

export function getCoreAssetIds(): string[] {
  if (!coreAssetIds) {
    coreAssetIds = getAssetManifest()
      .assets.filter((asset) => isCoreAsset(asset.id))
      .map((asset) => asset.id);
  }
  return coreAssetIds;
}

/**
 * Manifesto com apenas os assets pedidos. Ids desconhecidos são ignorados para
 * tolerar conteúdo antigo/novo durante deploy; a ordem segue o manifesto.
 */
export function getAssetManifestByIds(ids: Iterable<string>): AssetManifest {
  const manifest = getAssetManifest();
  const wanted = new Set(ids);
  return {
    version: manifest.version,
    baseUrl: manifest.baseUrl,
    assets: manifest.assets.filter((asset) => wanted.has(asset.id)),
  };
}

export function getCoreAssetManifest(): AssetManifest {
  return getAssetManifestByIds(getCoreAssetIds());
}
