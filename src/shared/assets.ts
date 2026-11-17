export type AssetType = 'texture' | 'sound' | 'effect' | 'waypoint';

export interface AssetEntry {
  id: string;
  type: AssetType;
  status: 'approved' | 'deprecated';
  tags: string[];
  params: Record<string, unknown>;
  /** URL absoluta ou caminho relativo a `baseUrl`. */
  url?: string;
  mimeType?: string;
  hash?: string;
}

export interface AssetManifest {
  version: string;
  /** Origem pública dos assets relativos (ex.: CDN/MinIO). */
  baseUrl?: string;
  assets: AssetEntry[];
}

function assetHashQuery(asset: AssetEntry): string {
  const hash = asset.hash?.trim();
  if (!hash) return '';
  const value = hash.replace(/^sha256:/i, '').slice(0, 16);
  return value ? `?v=${value}` : '';
}

export function resolveAssetUrl(
  asset: AssetEntry | null | undefined,
  manifest: AssetManifest | null | undefined,
): string | null {
  if (!asset?.url) return null;
  if (/^https?:\/\//i.test(asset.url)) return asset.url;
  if (!manifest?.baseUrl) return null;
  const base = manifest.baseUrl.replace(/\/+$/, '');
  const relative = asset.url.replace(/^\/+/, '');
  return `${base}/${relative}${assetHashQuery(asset)}`;
}

/**
 * Une manifests par id, preservando a versão/baseUrl mais recente. O cliente
 * baixa um núcleo pequeno e acrescenta assets sob demanda; o índice de render
 * é reconstruído a partir do resultado.
 */
export function mergeAssetManifests(
  current: AssetManifest | null,
  incoming: AssetManifest | null,
): AssetManifest | null {
  if (!incoming) return current;
  if (!current) return incoming;
  const merged = new Map<string, AssetEntry>();
  for (const asset of current.assets) merged.set(asset.id, asset);
  for (const asset of incoming.assets) merged.set(asset.id, asset);
  return {
    version: incoming.version || current.version,
    baseUrl: incoming.baseUrl ?? current.baseUrl,
    assets: Array.from(merged.values()),
  };
}

