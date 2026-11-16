export type AssetType = 'texture' | 'sound' | 'effect' | 'waypoint';

export interface AssetEntry {
  id: string;
  type: AssetType;
  status: 'approved' | 'deprecated';
  tags: string[];
  params: Record<string, unknown>;
}

export interface AssetManifest {
  version: string;
  assets: AssetEntry[];
}
