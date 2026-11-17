import { MAT, MATERIAL_COLORS } from './types.ts';

/**
 * Reação visual de impacto por material.
 *
 * O servidor só informa o MAT atingido; esta tabela decide quantos fragmentos
 * saem, com que energia, se brilham como faísca e se deixam marca. É pura e
 * determinística (sem DOM/Babylon) para poder ser testada offline e reutilizada
 * por qualquer renderer.
 */
export const IMPACT_REACTION_KINDS = [
  'stone',
  'metal',
  'wood',
  'granular',
  'frost',
  'crystal',
  'lava',
  'organic',
  'generic',
] as const;

export type ImpactReactionKind = (typeof IMPACT_REACTION_KINDS)[number];

export interface ImpactReaction {
  kind: ImpactReactionKind;
  /** Fragmentos base, antes do multiplicador de qualidade (`vfxScale`). */
  particles: number;
  /** Tamanho de cada fragmento em metros (aprox.). */
  scale: number;
  /** Velocidade radial de saída em m/s. */
  speed: number;
  /** Faísca brilhante (metal/cristal/gelo/lava) em vez de detrito opaco. */
  sparks: boolean;
  /** Cor dos fragmentos, 0..1. */
  color: [number, number, number];
  /** Se deixa marca no ponto de impacto. */
  decal: boolean;
  decalScale: number;
  /** Cor da marca, 0..1. */
  decalTint: [number, number, number];
  decalAlpha: number;
}

interface ReactionRecipe {
  kind: ImpactReactionKind;
  particles: number;
  scale: number;
  speed: number;
  sparks: boolean;
  decal: boolean;
  decalScale: number;
  decalAlpha: number;
  /** Brilho aplicado à cor-base do material. */
  colorBoost: number;
  /** Escurecimento da cor-base para a marca no chão. */
  decalDim: number;
}

const RECIPES: Record<ImpactReactionKind, ReactionRecipe> = {
  stone: {
    kind: 'stone',
    particles: 5,
    scale: 0.45,
    speed: 2.6,
    sparks: false,
    decal: true,
    decalScale: 0.9,
    decalAlpha: 0.55,
    colorBoost: 1,
    decalDim: 0.4,
  },
  metal: {
    kind: 'metal',
    particles: 6,
    scale: 0.36,
    speed: 3.6,
    sparks: true,
    decal: false,
    decalScale: 0.6,
    decalAlpha: 0.4,
    colorBoost: 1.35,
    decalDim: 0.45,
  },
  wood: {
    kind: 'wood',
    particles: 4,
    scale: 0.42,
    speed: 2.4,
    sparks: false,
    decal: false,
    decalScale: 0.7,
    decalAlpha: 0.4,
    colorBoost: 1,
    decalDim: 0.4,
  },
  granular: {
    kind: 'granular',
    particles: 5,
    scale: 0.3,
    speed: 1.7,
    sparks: false,
    // Areia/neve/dirt não deixam cicatriz legível: só puff e grãos.
    decal: false,
    decalScale: 0.8,
    decalAlpha: 0.35,
    colorBoost: 1.05,
    decalDim: 0.5,
  },
  frost: {
    kind: 'frost',
    particles: 6,
    scale: 0.34,
    speed: 3.1,
    sparks: true,
    decal: false,
    decalScale: 0.7,
    decalAlpha: 0.4,
    colorBoost: 1.2,
    decalDim: 0.5,
  },
  crystal: {
    kind: 'crystal',
    particles: 7,
    scale: 0.4,
    speed: 3.6,
    sparks: true,
    decal: true,
    decalScale: 0.7,
    decalAlpha: 0.45,
    colorBoost: 1.3,
    decalDim: 0.45,
  },
  lava: {
    kind: 'lava',
    particles: 8,
    scale: 0.5,
    speed: 3.9,
    sparks: true,
    decal: true,
    decalScale: 1.15,
    decalAlpha: 0.68,
    colorBoost: 1.15,
    decalDim: 0.6,
  },
  organic: {
    kind: 'organic',
    particles: 4,
    scale: 0.3,
    speed: 2.0,
    sparks: false,
    decal: false,
    decalScale: 0.6,
    decalAlpha: 0.35,
    colorBoost: 1,
    decalDim: 0.45,
  },
  generic: {
    kind: 'generic',
    particles: 4,
    scale: 0.4,
    speed: 2.4,
    sparks: false,
    decal: false,
    decalScale: 0.7,
    decalAlpha: 0.4,
    colorBoost: 1,
    decalDim: 0.45,
  },
};

const MAT_REACTIONS: Record<number, ImpactReactionKind> = {
  [MAT.BEDROCK]: 'stone',
  [MAT.STONE]: 'stone',
  [MAT.BASALT]: 'stone',
  [MAT.TERRACOTTA]: 'stone',
  [MAT.SCORCHED]: 'stone',
  [MAT.GOLD]: 'metal',
  [MAT.WOOD]: 'wood',
  [MAT.LADDER]: 'wood',
  [MAT.LEAVES]: 'wood',
  [MAT.SAND]: 'granular',
  [MAT.SNOW]: 'granular',
  [MAT.DIRT]: 'granular',
  [MAT.ICE]: 'frost',
  [MAT.CRYSTAL]: 'crystal',
  [MAT.LAVA]: 'lava',
  [MAT.GRASS]: 'organic',
  [MAT.MOSS]: 'organic',
  [MAT.SLUDGE]: 'organic',
};

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function tint(
  rgb: readonly [number, number, number] | undefined,
  boost: number,
): [number, number, number] {
  const base = rgb ?? [160, 160, 160];
  return [
    clamp01((base[0] / 255) * boost),
    clamp01((base[1] / 255) * boost),
    clamp01((base[2] / 255) * boost),
  ];
}

export function reactionKindFor(mat: number): ImpactReactionKind {
  return MAT_REACTIONS[mat] ?? 'generic';
}

export function impactReactionFor(mat: number): ImpactReaction {
  const recipe = RECIPES[reactionKindFor(mat)];
  const base = MATERIAL_COLORS[mat];
  return {
    kind: recipe.kind,
    particles: recipe.particles,
    scale: recipe.scale,
    speed: recipe.speed,
    sparks: recipe.sparks,
    color: tint(base, recipe.colorBoost),
    decal: recipe.decal,
    decalScale: recipe.decalScale,
    decalTint: tint(base, recipe.decalDim),
    decalAlpha: recipe.decalAlpha,
  };
}
