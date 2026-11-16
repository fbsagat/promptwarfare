import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  resolveAssetUrl,
  type AssetManifest,
} from '../src/shared/assets.ts';

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const manifestPath = path.resolve(
  ROOT,
  argValue('--manifest') ?? path.join('content', 'assets', 'manifest.json'),
);
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as AssetManifest;
const baseUrl =
  argValue('--base-url')?.trim() ||
  process.env.ASSET_BASE_URL?.trim() ||
  manifest.baseUrl ||
  '';
const remote = process.argv.includes('--remote');

const withUrls = manifest.assets.filter((asset) => Boolean(asset.url));
const resolved = withUrls.map((asset) => ({
  asset,
  url: resolveAssetUrl(asset, { ...manifest, baseUrl }),
}));

let failures = 0;
for (const entry of resolved) {
  if (!entry.url) {
    failures += 1;
    console.error(`✗ ${entry.asset.id}: url relativa sem base URL`);
    continue;
  }
  if (!remote) {
    console.log(`✓ ${entry.asset.id} → ${entry.url}`);
    continue;
  }
  try {
    let response = await fetch(entry.url, { method: 'HEAD' });
    if (response.status === 405) {
      response = await fetch(entry.url, { method: 'GET' });
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    console.log(`✓ ${entry.asset.id} → ${entry.url} (${response.status})`);
  } catch (err) {
    failures += 1;
    console.error(`✗ ${entry.asset.id}: ${(err as Error).message}`);
  }
}

console.log(
  `Assets: ${manifest.assets.length} no manifesto · ${withUrls.length} com URL · base=${baseUrl || '—'} · falhas=${failures}`,
);
if (failures > 0) process.exit(1);
