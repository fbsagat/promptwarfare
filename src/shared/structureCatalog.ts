import type { BiomeKind } from './types.ts';

/**
 * Catálogo declarativo de estruturas da geração procedural.
 *
 * Esta é a fonte da verdade sobre "o que pode existir em cada bioma". A geração
 * em `voxelWorld.ts` consome `getBiomeStructures()` na terceira passagem, e
 * novas estruturas devem ser registradas aqui antes de ganhar uma função de
 * colocação. Nenhuma dependência de DOM/Node: este módulo é compartilhado
 * entre servidor e cliente.
 */

export type StructureCategory =
  | 'relevo'
  | 'vegetacao'
  | 'construcao'
  | 'agua'
  | 'termico'
  | 'ruina';

export type StructurePlugin = 'native' | 'event';

export interface StructureDefinition {
  /** Identificador estável, usado por filtros e futuras ferramentas. */
  readonly id: string;
  /** Nome legível em pt-BR. */
  readonly label: string;
  /** Biomas onde a estrutura pode aparecer. 'all' = comum a todos. */
  readonly biomes: readonly (BiomeKind | 'all')[];
  readonly category: StructureCategory;
  /** Breve descrição visual/funcional, em pt-BR. */
  readonly description: string;
  /** Nome da função geradora em voxelWorld.ts (ou 'terrain' quando é relevo). */
  readonly generator: string;
  /** Origem: 'native' = geração base; 'event' = injection de evento catastrófico. */
  readonly source: StructurePlugin;
  /** Densidade relativa sugerida (0 = raro, 1 = comum). */
  readonly density: number;
}

/** Catálogo completo. Manter ordenado por bioma e categoria. */
export const STRUCTURE_CATALOG = [
  // ---------------------------------------------------------------- comuns
  {
    id: 'outcrop',
    label: 'Afloramento rochoso',
    biomes: ['all'],
    category: 'relevo',
    description: 'Pedras salientes em cumes e costas, com material do bioma.',
    generator: 'outcrop',
    source: 'native',
    density: 0.35,
  },
  {
    id: 'house',
    label: 'Casa / cabana',
    biomes: ['forest', 'desert', 'tundra'],
    category: 'construcao',
    description: 'Moradia com estilo adaptado ao bioma (madeira, adobe, madeira com neve).',
    generator: 'placeHouse',
    source: 'native',
    density: 0.5,
  },
  {
    id: 'watchtower',
    label: 'Torre de vigia',
    biomes: ['forest', 'tundra', 'volcanic'],
    category: 'construcao',
    description: 'Torre com escada interna e plataforma de vigia.',
    generator: 'placeWatchtower',
    source: 'native',
    density: 0.4,
  },
  {
    id: 'castle',
    label: 'Castelo',
    biomes: ['forest', 'volcanic'],
    category: 'construcao',
    description: 'Fortaleza com muralhas, quatro torres e pátio.',
    generator: 'placeVoxelCastle',
    source: 'native',
    density: 0.25,
  },
  {
    id: 'skyscraper',
    label: 'Prédio (Skyscraper)',
    biomes: ['city'],
    category: 'construcao',
    description: 'Um arranha-céu modular.',
    generator: 'placeSkyscraper',
    source: 'native',
    density: 0.15,
  },
  {
    id: 'lantern',
    label: 'Poste de lanterna',
    biomes: ['forest', 'desert', 'tundra'],
    category: 'construcao',
    description: 'Poste de madeira com tocha de ouro no topo.',
    generator: 'placeLanternPost',
    source: 'native',
    density: 0.55,
  },

  // ---------------------------------------------------------------- forest
  {
    id: 'forest_hills',
    label: 'Colinas suaves',
    biomes: ['forest'],
    category: 'relevo',
    description: 'Relevo de colinas baixas e vales arredondados.',
    generator: 'forestHeight',
    source: 'native',
    density: 1,
  },
  {
    id: 'river',
    label: 'Rio',
    biomes: ['forest'],
    category: 'agua',
    description: 'Canal serpenteante de água corrente que corta o mapa.',
    generator: 'riverMask',
    source: 'native',
    density: 0.8,
  },
  {
    id: 'tall_tree',
    label: 'Árvore alta',
    biomes: ['forest'],
    category: 'vegetacao',
    description: 'Árvore de tronco alto com copa densa.',
    generator: 'placeVoxelTree',
    source: 'native',
    density: 0.9,
  },
  {
    id: 'shrub',
    label: 'Arbusto',
    biomes: ['forest'],
    category: 'vegetacao',
    description: 'Moita baixa de folhagem.',
    generator: 'placeShrubCluster',
    source: 'native',
    density: 0.7,
  },
  {
    id: 'gray_rock',
    label: 'Rocha cinza',
    biomes: ['forest'],
    category: 'relevo',
    description: 'Afloramento de granito cinza.',
    generator: 'outcrop',
    source: 'native',
    density: 0.45,
  },
  {
    id: 'banana_tree',
    label: 'Bananeira',
    biomes: ['forest'],
    category: 'vegetacao',
    description: 'Árvore tropical de folhas largas e tronco curto.',
    generator: 'placePalmTree',
    source: 'native',
    density: 0.35,
  },
  {
    id: 'palm_tree',
    label: 'Palmeira',
    biomes: ['forest', 'desert'],
    category: 'vegetacao',
    description: 'Palmeira alta com copa radial.',
    generator: 'placePalmTree',
    source: 'native',
    density: 0.4,
  },

  // ---------------------------------------------------------------- desert
  {
    id: 'desert_dunes',
    label: 'Dunas senoidais',
    biomes: ['desert'],
    category: 'relevo',
    description: 'Ondulações amplas e planícies arenosas modeladas por senoide.',
    generator: 'desertHeight',
    source: 'native',
    density: 1,
  },
  {
    id: 'canyon',
    label: 'Cânion',
    biomes: ['desert'],
    category: 'relevo',
    description: 'entalhe profundo e estreito na planície, com paredes de terracota.',
    generator: 'canyonMask',
    source: 'native',
    density: 0.7,
  },
  {
    id: 'rock_pillar',
    label: 'Pilar de rocha',
    biomes: ['desert'],
    category: 'relevo',
    description: 'Coluna de arenito que se destaca no horizonte.',
    generator: 'placeDesertRockPillar',
    source: 'native',
    density: 0.55,
  },
  {
    id: 'cactus',
    label: 'Cacto',
    biomes: ['desert'],
    category: 'vegetacao',
    description: 'Cacto colunar com braços laterais.',
    generator: 'placeCactus',
    source: 'native',
    density: 0.65,
  },
  {
    id: 'pyramid',
    label: 'Pirâmide',
    biomes: ['desert'],
    category: 'construcao',
    description: 'Pirâmide de arenito com câmara interna.',
    generator: 'placeDesertPyramid',
    source: 'native',
    density: 0.3,
  },
  {
    id: 'obelisk',
    label: 'Obelisco',
    biomes: ['desert'],
    category: 'construcao',
    description: 'Monolito alto de terracota com topo de ouro.',
    generator: 'placeObelisk',
    source: 'native',
    density: 0.4,
  },

  // ---------------------------------------------------------------- swamp
  {
    id: 'swamp_basins',
    label: 'Depressões alagadas',
    biomes: ['swamp'],
    category: 'relevo',
    description: 'Terreno rebaixado com poças e musgo.',
    generator: 'swampHeight',
    source: 'native',
    density: 1,
  },
  {
    id: 'dark_lake',
    label: 'Lago escuro',
    biomes: ['swamp'],
    category: 'agua',
    description: 'Depressão preenchida com lama e água escura.',
    generator: 'lakeMask',
    source: 'native',
    density: 0.75,
  },
  {
    id: 'giant_mushroom',
    label: 'Cogumelo gigante',
    biomes: ['swamp'],
    category: 'vegetacao',
    description: 'Cogumelo de caule branco e chapéu avermelhado.',
    generator: 'placeGiantMushroom',
    source: 'native',
    density: 0.6,
  },
  {
    id: 'fallen_log',
    label: 'Tronco caído',
    biomes: ['swamp', 'forest'],
    category: 'vegetacao',
    description: 'Tronco deitado no solo, frequentemente musgoso.',
    generator: 'placeFallenLog',
    source: 'native',
    density: 0.6,
  },
  {
    id: 'dead_tree',
    label: 'Árvore morta',
    biomes: ['swamp'],
    category: 'vegetacao',
    description: 'Árvore sem folhas, apenas tronco e galhos.',
    generator: 'placeVoxelTree',
    source: 'native',
    density: 0.5,
  },
  {
    id: 'stone_ruin',
    label: 'Ruína de construção',
    biomes: ['swamp'],
    category: 'ruina',
    description: 'Arco de pedra coberto de musgo.',
    generator: 'placeStoneRuinArch',
    source: 'native',
    density: 0.4,
  },

  // ---------------------------------------------------------------- tundra
  {
    id: 'tundra_peaks',
    label: 'Picos elevados',
    biomes: ['tundra'],
    category: 'relevo',
    description: 'Elevação acentuada com picos angulosos e planaltos de neve.',
    generator: 'tundraHeight',
    source: 'native',
    density: 1,
  },
  {
    id: 'frozen_lake',
    label: 'Lago congelado',
    biomes: ['tundra'],
    category: 'agua',
    description: 'Depressão rasa preenchida com gelo.',
    generator: 'lakeMask',
    source: 'native',
    density: 0.7,
  },
  {
    id: 'igloo',
    label: 'Iglu',
    biomes: ['tundra'],
    category: 'construcao',
    description: 'Domo de neve com túnel de entrada.',
    generator: 'placeIgloo',
    source: 'native',
    density: 0.5,
  },
  {
    id: 'ice_spire',
    label: 'Agulha de gelo',
    biomes: ['tundra'],
    category: 'relevo',
    description: 'Torre de gelo com ponta de cristal.',
    generator: 'placeIceSpire',
    source: 'native',
    density: 0.5,
  },
  {
    id: 'snow_pine',
    label: 'Pinheiro nevado',
    biomes: ['tundra'],
    category: 'vegetacao',
    description: 'Pinheiro alto com copa coberta de neve.',
    generator: 'placeVoxelTree',
    source: 'native',
    density: 0.6,
  },
  {
    id: 'cave',
    label: 'Gruta',
    biomes: ['tundra'],
    category: 'relevo',
    description: 'Cavidade sob o terreno, preservada da geração base.',
    generator: 'caveMask',
    source: 'native',
    density: 0.5,
  },

  // ---------------------------------------------------------------- volcanic
  {
    id: 'volcanic_ridges',
    label: 'Terreno acidentado',
    biomes: ['volcanic'],
    category: 'relevo',
    description: 'Cristas angulosas, basalto e cinzas.',
    generator: 'volcanicHeight',
    source: 'native',
    density: 1,
  },
  {
    id: 'volcano',
    label: 'Vulcão',
    biomes: ['volcanic'],
    category: 'termico',
    description: 'Grande cone com cratera e coluna de cinzas, fora do centro do mapa.',
    generator: 'placeVolcano',
    source: 'native',
    density: 0.9,
  },
  {
    id: 'lava_river',
    label: 'Rio de lava',
    biomes: ['volcanic'],
    category: 'termico',
    description: 'Canal de lava incandescente cortando o terreno.',
    generator: 'lavaRiverMask',
    source: 'native',
    density: 0.8,
  },
  {
    id: 'basalt_boulders',
    label: 'Rochas enormes de basalto',
    biomes: ['volcanic'],
    category: 'relevo',
    description: 'Blocos gigantes de basalto.',
    generator: 'outcrop',
    source: 'native',
    density: 0.6,
  },
  {
    id: 'volcanic_vent',
    label: 'Respiradouro térmico',
    biomes: ['volcanic'],
    category: 'termico',
    description: 'Chaminé de basalto com lava no topo.',
    generator: 'placeVolcanicVent',
    source: 'native',
    density: 0.6,
  },
  {
    id: 'dark_castle',
    label: 'Castelo de basalto',
    biomes: ['volcanic'],
    category: 'construcao',
    description: 'Fortaleza negra com acentos de lava.',
    generator: 'placeVoxelCastle',
    source: 'native',
    density: 0.25,
  },
] as const satisfies readonly StructureDefinition[];

export type StructureId = (typeof STRUCTURE_CATALOG)[number]['id'];

/** Estruturas aplicáveis a um bioma (inclui as comuns a todos). */
export function getBiomeStructures(biome: BiomeKind): readonly StructureDefinition[] {
  return STRUCTURE_CATALOG.filter((entry) => {
    const biomes = entry.biomes as readonly string[];
    return biomes.includes('all') || biomes.includes(biome);
  });
}

/** Consulta pontual, útil para ferramentas e testes. */
export function getStructureById(id: StructureId): StructureDefinition {
  const entry = STRUCTURE_CATALOG.find((item) => item.id === id);
  if (!entry) throw new Error(`Estrutura desconhecida: ${id}`);
  return entry;
}
