/**
 * Importa o pacote "400 Sounds Pack" (Chequered Ink) de `material/` para o
 * manifesto versionado.
 *
 * - A pasta `material/` é ignorada pelo git; apenas os .ogg convertidos entram
 *   em `content/assets/files/`.
 * - Converte para opus mono, normaliza loudness e grava hash sha256.
 * - Atualiza `content/assets/manifest.json` e o bloco de créditos em
 *   `docs/ASSETS.md` entre os marcadores `sfx-import`.
 *
 * Uso:
 *   npm run assets:import
 *   npm run assets:import -- --force
 *   npm run assets:import -- --dry
 *   npm run assets:import -- --source "material/400 Sounds Pack"
 *
 * Requer ffmpeg no PATH (apenas em tempo de desenvolvimento).
 */

import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AssetEntry, AssetManifest } from '../src/shared/assets.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function argValue(name: string, fallback: string): string {
  const index = process.argv.indexOf(name);
  const value = index === -1 ? undefined : process.argv[index + 1];
  return value?.trim() || fallback;
}

const sourceRoot = path.resolve(
  ROOT,
  argValue('--source', path.join('material', '400 Sounds Pack')),
);
const outRoot = path.resolve(ROOT, argValue('--out', path.join('content', 'assets', 'files')));
const manifestPath = path.resolve(
  ROOT,
  argValue('--manifest', path.join('content', 'assets', 'manifest.json')),
);
const docsPath = path.resolve(ROOT, path.join('docs', 'ASSETS.md'));
const bitrate = argValue('--bitrate', '96k');
const loudness = argValue('--loudness', '-18');
const force = process.argv.includes('--force');
const dryRun = process.argv.includes('--dry');

const SOURCE_PACK = 'chequered-ink:400-sounds-pack';

interface CurationItem {
  id: string;
  /** Caminho relativo dentro de `material/400 Sounds Pack`. */
  source: string;
  group: string;
  tags: string[];
  material?: string;
  loop?: boolean;
  /** Corta o loop em N segundos (evita arquivos longos). */
  maxSeconds?: number;
}

const CURATED: readonly CurationItem[] = [
  // Passos
  ...[1, 2, 3, 4].map((n) => ({
    id: `sfx:footstep:stone:${n}`,
    source: `Footsteps/foley_footstep_concrete_${n}.wav`,
    group: 'footstep:stone',
    tags: ['footstep', 'stone'],
    material: 'stone',
  })),
  ...[1, 2, 3, 4].map((n) => ({
    id: `sfx:footstep:loose:${n}`,
    source: `Footsteps/foley_footstep_gravel_${n}.wav`,
    group: 'footstep:loose',
    tags: ['footstep', 'sand'],
    material: 'sand',
  })),
  ...[1, 2, 3, 4].map((n) => ({
    id: `sfx:footstep:soft:${n}`,
    source: `Footsteps/foley_footstep_carpet_${n}.wav`,
    group: 'footstep:soft',
    tags: ['footstep', 'grass'],
    material: 'grass',
  })),

  // Impactos por material
  {
    id: 'sfx:impact:stone:short',
    source: 'Materials/stone_push_short.wav',
    group: 'impact:stone',
    tags: ['impact', 'stone'],
    material: 'stone',
  },
  {
    id: 'sfx:impact:stone:medium',
    source: 'Materials/stone_push_medium.wav',
    group: 'impact:stone',
    tags: ['impact', 'stone'],
    material: 'stone',
  },
  {
    id: 'sfx:impact:wood:hollow',
    source: 'Materials/wood_small_hollow.wav',
    group: 'impact:wood',
    tags: ['impact', 'wood'],
    material: 'wood',
  },
  {
    id: 'sfx:impact:wood:drop',
    source: 'Materials/wood_small_drop.wav',
    group: 'impact:wood',
    tags: ['impact', 'wood'],
    material: 'wood',
  },
  {
    id: 'sfx:impact:metal:clang',
    source: 'Materials/metal_clang.wav',
    group: 'impact:metal',
    tags: ['impact', 'metal'],
    material: 'gold',
  },
  {
    id: 'sfx:impact:metal:tap',
    source: 'Materials/metal_blunt_tap.wav',
    group: 'impact:metal',
    tags: ['impact', 'metal'],
    material: 'gold',
  },
  {
    id: 'sfx:impact:ice:small',
    source: 'Materials/glass_ping_small.wav',
    group: 'impact:ice',
    tags: ['impact', 'ice'],
    material: 'ice',
  },
  {
    id: 'sfx:impact:ice:big',
    source: 'Materials/glass_ping_big.wav',
    group: 'impact:ice',
    tags: ['impact', 'ice'],
    material: 'ice',
  },
  {
    id: 'sfx:impact:terracotta:clang',
    source: 'Materials/pottery_clang.wav',
    group: 'impact:terracotta',
    tags: ['impact', 'terracotta'],
    material: 'terracotta',
  },
  {
    id: 'sfx:impact:soft:hit',
    source: 'Materials/cardboard_hit.wav',
    group: 'impact:soft',
    tags: ['impact', 'soft'],
    material: 'leaves',
  },
  {
    id: 'sfx:impact:soft:drop',
    source: 'Materials/cardboard_drop.wav',
    group: 'impact:soft',
    tags: ['impact', 'soft'],
    material: 'leaves',
  },

  // Itens e inventário
  {
    id: 'sfx:dig:shovel',
    source: 'Items/shovel_dig.wav',
    group: 'dig',
    tags: ['dig', 'tool'],
  },
  {
    id: 'sfx:pickup:gem',
    source: 'Items/gem_collect.wav',
    group: 'pickup',
    tags: ['pickup', 'loot'],
  },
  {
    id: 'sfx:pickup:coin',
    source: 'Items/coin_collect.wav',
    group: 'pickup',
    tags: ['pickup', 'loot'],
  },
  {
    id: 'sfx:equip:item',
    source: 'Items/item_equip.wav',
    group: 'equip',
    tags: ['equip', 'inventory'],
  },

  // Armas e corpo
  {
    id: 'sfx:land:heavy',
    source: 'Weapons/harsh_thud.wav',
    group: 'land',
    tags: ['land', 'impact'],
  },
  {
    id: 'sfx:equip:weapon',
    source: 'Weapons/weapon_equip.wav',
    group: 'equip:weapon',
    tags: ['equip', 'weapon'],
  },
  {
    id: 'sfx:pickup:weapon',
    source: 'Weapons/weapon_pick_up.wav',
    group: 'pickup:weapon',
    tags: ['pickup', 'weapon'],
  },
  {
    id: 'sfx:drop:weapon',
    source: 'Weapons/weapon_drop.wav',
    group: 'drop:weapon',
    tags: ['drop', 'weapon'],
  },

  // Traversal
  {
    id: 'sfx:traversal:whoosh:1',
    source: 'Other/whoosh_1.wav',
    group: 'traversal:whoosh',
    tags: ['traversal', 'slide'],
  },
  {
    id: 'sfx:traversal:whoosh:2',
    source: 'Other/whoosh_2.wav',
    group: 'traversal:whoosh',
    tags: ['traversal', 'slide'],
  },
  {
    id: 'sfx:grapple:twang',
    source: 'Other/elastic_twang.wav',
    group: 'grapple',
    tags: ['grapple', 'traversal'],
  },

  // Ambiência e água
  {
    id: 'sfx:ambience:wind',
    source: 'Environment/ambient_wind.wav',
    group: 'ambience:wind',
    tags: ['ambience', 'wind'],
    loop: true,
  },
  {
    id: 'sfx:ambience:water:river',
    source: 'Environment/water_babbling_loop.wav',
    group: 'ambience:water',
    tags: ['ambience', 'water'],
    loop: true,
  },
  {
    id: 'sfx:water:splash',
    source: 'Environment/water_splashing.wav',
    group: 'water:splash',
    tags: ['water', 'impact'],
  },
  {
    id: 'sfx:ambience:water:drip',
    source: 'Environment/water_dripping.wav',
    group: 'ambience:cave',
    tags: ['ambience', 'cave', 'water'],
    loop: true,
    maxSeconds: 8,
  },
  {
    id: 'sfx:ambience:fire',
    source: 'Environment/fire_lighting.wav',
    group: 'ambience:fire',
    tags: ['ambience', 'fire'],
    loop: true,
  },
  {
    id: 'sfx:ambience:swamp',
    source: 'Environment/gurgling.wav',
    group: 'ambience:swamp',
    tags: ['ambience', 'swamp'],
    loop: true,
  },
  {
    id: 'sfx:water:ice',
    source: 'Environment/ice_in_water.wav',
    group: 'water:ice',
    tags: ['water', 'ice'],
    material: 'ice',
  },
  {
    id: 'sfx:water:drop',
    source: 'Environment/water_drop_medium.wav',
    group: 'water:drop',
    tags: ['water', 'drip'],
  },

  // UI
  {
    id: 'sfx:ui:select',
    source: 'UI/sci_fi_select.wav',
    group: 'ui:select',
    tags: ['ui'],
  },
  {
    id: 'sfx:ui:confirm',
    source: 'UI/synth_confirmation.wav',
    group: 'ui:confirm',
    tags: ['ui'],
  },
  {
    id: 'sfx:ui:cancel',
    source: 'UI/synth_cancel.wav',
    group: 'ui:cancel',
    tags: ['ui'],
  },
  {
    id: 'sfx:ui:error',
    source: 'UI/synth_error.wav',
    group: 'ui:error',
    tags: ['ui'],
  },
];

function outputRelPath(id: string): string {
  const parts = id.split(':');
  const variant = parts[parts.length - 1];
  return path.posix.join(...parts.slice(0, -1), `${variant}.ogg`);
}

function sha256(filePath: string): string {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return `sha256:${hash.digest('hex')}`;
}

function ensureFfmpeg(): void {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
  } catch {
    console.error(
      '✗ ffmpeg não encontrado no PATH. Instale o ffmpeg para converter o pacote de sons.',
    );
    process.exit(1);
  }
}

function convert(sourcePath: string, outPath: string, item: CurationItem): void {
  const filters = [`loudnorm=I=${loudness}:TP=-1.5:LRA=11`];
  const args = [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-i',
    sourcePath,
    '-vn',
    '-sn',
    '-dn',
    '-af',
    filters.join(','),
    '-ac',
    '1',
    '-ar',
    '48000',
    '-c:a',
    'libopus',
    '-b:a',
    bitrate,
  ];
  if (item.maxSeconds) {
    args.push('-t', String(item.maxSeconds));
  }
  args.push(outPath);
  execFileSync('ffmpeg', args, { stdio: 'inherit' });
}

function humanSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function nextVersion(current: string): string {
  const today = new Date().toISOString().slice(0, 10);
  const match = /^(\d{4}-\d{2}-\d{2})\.(\d+)$/.exec(current);
  if (match && match[1] === today) {
    return `${today}.${Number(match[2]) + 1}`;
  }
  return `${today}.1`;
}

function renderDocsSection(items: readonly CurationItem[], totalBytes: number): string {
  const groups = new Map<string, number>();
  for (const item of items) {
    groups.set(item.group, (groups.get(item.group) ?? 0) + 1);
  }
  const rows = [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([group, count]) => `| \`${group}\` | ${count} |`)
    .join('\n');

  return [
    '<!-- sfx-import:start -->',
    'Importado de `material/400 Sounds Pack` (ignorado pelo git) por `npm run assets:import`.',
    'Não edite esta seção à mão; rode o script novamente.',
    '',
    '- Pacote: **400 Sounds Pack** — [Chequered Ink](https://ci.itch.io/400-sounds-pack)',
    '- Licença: uso comercial permitido; vedada a revenda/redistribuição dos WAVs sem alteração.',
    `- Arquivos versionados: ${items.length} (.ogg mono, ~${humanSize(totalBytes)}), em \`content/assets/files/sfx/\`.`,
    '- Formato: opus 48 kHz, loudness normalizada; fallback procedural permanece quando o sample não carrega.',
    '',
    '| Grupo | Arquivos |',
    '| --- | --- |',
    rows,
    '<!-- sfx-import:end -->',
  ].join('\n');
}

function updateDocs(section: string): void {
  if (!fs.existsSync(docsPath)) {
    console.warn('! docs/ASSETS.md não encontrado; créditos não atualizados.');
    return;
  }
  const current = fs.readFileSync(docsPath, 'utf8');
  const start = '<!-- sfx-import:start -->';
  const end = '<!-- sfx-import:end -->';
  const startIndex = current.indexOf(start);
  const endIndex = current.indexOf(end);
  if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
    console.warn('! Marcadores sfx-import ausentes em docs/ASSETS.md; créditos não atualizados.');
    return;
  }
  const next = current.slice(0, startIndex) + section + current.slice(endIndex + end.length);
  if (!dryRun) fs.writeFileSync(docsPath, next, 'utf8');
}

function main(): void {
  if (!fs.existsSync(sourceRoot)) {
    console.error(`✗ Pacote de sons não encontrado em ${sourceRoot}`);
    process.exit(1);
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as AssetManifest;
  const existing = new Map(manifest.assets.map((asset) => [asset.id, asset]));
  if (!dryRun) ensureFfmpeg();

  let converted = 0;
  let reused = 0;
  let totalBytes = 0;

  for (const item of CURATED) {
    const sourcePath = path.join(sourceRoot, ...item.source.split('/'));
    if (!fs.existsSync(sourcePath)) {
      console.error(`✗ Origem ausente: ${item.source}`);
      process.exit(1);
    }
    const relPath = outputRelPath(item.id);
    const outPath = path.join(outRoot, ...relPath.split('/'));

    if (dryRun) {
      console.log(`· ${item.id} → ${relPath}${item.loop ? ' (loop)' : ''}`);
      continue;
    }

    fs.mkdirSync(path.dirname(outPath), { recursive: true });

    if (force || !fs.existsSync(outPath)) {
      convert(sourcePath, outPath, item);
      converted += 1;
    } else {
      reused += 1;
    }

    const hash = sha256(outPath);
    const size = fs.statSync(outPath).size;
    totalBytes += size;

    const entry: AssetEntry = {
      id: item.id,
      type: 'sound',
      status: 'approved',
      tags: [...item.tags],
      params: {
        kind: 'sample',
        group: item.group,
        variant: item.id.split(':').pop(),
        sourcePack: SOURCE_PACK,
        source: item.source,
        ...(item.material ? { material: item.material } : {}),
        ...(item.loop ? { loop: true } : {}),
      },
      url: relPath,
      mimeType: 'audio/ogg',
      hash,
    };
    existing.set(item.id, entry);
    console.log(`✓ ${item.id} → ${relPath} (${humanSize(size)})`);
  }

  if (dryRun) {
    console.log(`Dry-run: ${CURATED.length} arquivos seriam importados.`);
    return;
  }

  const curatedIds = new Set(CURATED.map((item) => item.id));
  const kept = [...existing.values()].filter(
    (asset) =>
      curatedIds.has(asset.id) ||
      asset.params?.sourcePack !== SOURCE_PACK,
  );

  const changed = JSON.stringify(kept) !== JSON.stringify(manifest.assets);
  const nextManifest: AssetManifest = {
    ...manifest,
    baseUrl: manifest.baseUrl ?? '/assets/files',
    version: changed ? nextVersion(manifest.version) : manifest.version,
    assets: kept,
  };
  fs.writeFileSync(manifestPath, `${JSON.stringify(nextManifest, null, 2)}\n`, 'utf8');
  updateDocs(renderDocsSection(CURATED, totalBytes));

  console.log(
    `\nManifesto: ${nextManifest.version} · ${kept.length} assets (${CURATED.length} SFX) · ${converted} convertidos, ${reused} reaproveitados · ${humanSize(totalBytes)}`,
  );
}

main();
