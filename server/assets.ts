import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AssetManifest, AssetType } from '../src/shared/assets.ts';

export type { AssetEntry, AssetManifest, AssetType } from '../src/shared/assets.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MANIFEST_PATH = path.resolve(__dirname, '..', 'content', 'assets', 'manifest.json');
const VALID_TYPES = new Set<AssetType>(['texture', 'sound', 'effect', 'waypoint']);

let cached: AssetManifest | null = null;

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
    cached = baseUrl ? { ...manifest, baseUrl } : manifest;
  }
  return cached;
}

export function getAssetVersion(): string {
  return getAssetManifest().version;
}

export function getAssetIds(): Set<string> {
  return new Set(getAssetManifest().assets.map((asset) => asset.id));
}
