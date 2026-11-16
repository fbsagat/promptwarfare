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

export function resolveAssetUrl(
  asset: AssetEntry | null | undefined,
  manifest: AssetManifest | null | undefined,
): string | null {
  if (!asset?.url) return null;
  if (/^https?:\/\//i.test(asset.url)) return asset.url;
  if (!manifest?.baseUrl) return null;
  return `${manifest.baseUrl.replace(/\/+$/, '')}/${asset.url.replace(/^\/+/, '')}`;
}

