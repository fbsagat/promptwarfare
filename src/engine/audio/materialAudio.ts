import { MAT, MATERIAL_COLORS } from '../../shared/types.ts';

export type FootstepGroup = 'stone' | 'loose' | 'soft';
export type ImpactGroup = 'stone' | 'wood' | 'metal' | 'ice' | 'terracotta' | 'soft';

export function footstepGroup(mat: number): FootstepGroup {
  switch (mat) {
    case MAT.STONE:
    case MAT.BASALT:
    case MAT.BEDROCK:
    case MAT.TERRACOTTA:
    case MAT.GOLD:
      return 'stone';
    case MAT.SAND:
    case MAT.DIRT:
    case MAT.SNOW:
    case MAT.SCORCHED:
      return 'loose';
    case MAT.GRASS:
    case MAT.MOSS:
    case MAT.SLUDGE:
    case MAT.LEAVES:
    case MAT.WOOD:
    case MAT.ICE:
    case MAT.CRYSTAL:
      return 'soft';
    default:
      return 'soft';
  }
}

export function impactGroup(mat: number): ImpactGroup {
  switch (mat) {
    case MAT.WOOD:
      return 'wood';
    case MAT.GOLD:
      return 'metal';
    case MAT.ICE:
    case MAT.CRYSTAL:
      return 'ice';
    case MAT.TERRACOTTA:
      return 'terracotta';
    case MAT.GRASS:
    case MAT.MOSS:
    case MAT.SLUDGE:
    case MAT.LEAVES:
    case MAT.SAND:
    case MAT.DIRT:
    case MAT.SNOW:
      return 'soft';
    default:
      return 'stone';
  }
}

function clampVariant(variant: number, max: number): number {
  const n = Math.round(Number.isFinite(variant) ? variant : 1);
  return Math.max(1, Math.min(max, n));
}

export function footstepAssetId(mat: number, variant: number): string {
  return `sfx:footstep:${footstepGroup(mat)}:${clampVariant(variant, 4)}`;
}

const IMPACT_VARIANTS: Record<ImpactGroup, readonly string[]> = {
  stone: ['short', 'medium'],
  wood: ['hollow', 'drop'],
  metal: ['clang', 'tap'],
  ice: ['small', 'big'],
  terracotta: ['clang'],
  soft: ['hit', 'drop'],
};

export function impactAssetId(mat: number, variant: number): string {
  const group = impactGroup(mat);
  const variants = IMPACT_VARIANTS[group];
  const index = clampVariant(variant, variants.length) - 1;
  return `sfx:impact:${group}:${variants[index]}`;
}

export function materialColor(mat: number): [number, number, number] {
  const rgb = MATERIAL_COLORS[mat] ?? [180, 180, 180];
  return [rgb[0] / 255, rgb[1] / 255, rgb[2] / 255];
}
