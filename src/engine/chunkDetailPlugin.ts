import {
  MaterialPluginBase,
  type AbstractMesh,
  type Material,
  type Nullable,
  type Scene,
} from '@babylonjs/core';
import { MAT } from '../shared/types.ts';

/**
 * Dá identidade visual por material aos chunks sem quebrar o greedy meshing:
 * - o worker envia `matId` por vértice (faces mescladas têm um único MAT);
 * - o fragment shader usa posição de mundo + MAT para detalhe procedural,
 *   brilho emissivo (lava/cristal) e uma borda tipo Fresnel (gelo/ouro).
 *
 * Não usa texturas nem samplers: menos bindings e nada para baixar.
 * Custo: ~20 ALU por fragmento de terreno, aceitável para iGPU.
 * Em renderer de software o plugin não é anexado (ver babylonArena).
 */
const FRAGMENT_CODE = `
  vec3 pwPos = vPositionW;
  int pwMat = int(floor(vMatId + 0.5));
  float pwCell = fract(sin(dot(floor(pwPos * 2.0), vec3(12.9898, 78.233, 37.719))) * 43758.5453);
  float pwFine = fract(sin(dot(floor(pwPos * 6.0), vec3(39.346, 11.135, 83.155))) * 24634.6345);
  float pwRim = pow(1.0 - clamp(dot(viewDirectionW, normalW), 0.0, 1.0), 3.0);
  float pwDetail = 1.0;
  float pwGlow = 0.0;

  if (pwMat == ${MAT.STONE} || pwMat == ${MAT.BASALT} || pwMat == ${MAT.BEDROCK} || pwMat == ${MAT.TERRACOTTA}) {
    // STONE, BASALT, BEDROCK, TERRACOTTA
    pwDetail = 0.92 + pwCell * 0.12 + pwFine * 0.04;
  } else if (pwMat == ${MAT.SAND} || pwMat == ${MAT.SNOW}) {
    // SAND, SNOW
    pwDetail = 0.98 + 0.02 * sin((pwPos.x + pwPos.z) * 1.2) + pwFine * 0.03;
  } else if (pwMat == ${MAT.GRASS} || pwMat == ${MAT.MOSS} || pwMat == ${MAT.LEAVES}) {
    // GRASS, MOSS, LEAVES
    pwDetail = 0.93 + pwFine * 0.12;
  } else if (pwMat == ${MAT.WOOD}) {
    // WOOD
    pwDetail = 0.95 + 0.08 * sin((pwPos.x + pwPos.z) * 6.0 + pwCell * 2.0);
  } else if (pwMat == ${MAT.ICE}) {
    // ICE
    pwDetail = 0.97 + pwFine * 0.05;
    pwGlow = 0.05 + pwRim * 0.18;
  } else if (pwMat == ${MAT.CRYSTAL}) {
    // CRYSTAL
    pwDetail = 0.94 + pwFine * 0.10;
    pwGlow = 0.35 + pwRim * 0.85;
  } else if (pwMat == ${MAT.LAVA}) {
    // LAVA
    pwDetail = 0.97 + 0.06 * sin((pwPos.x - pwPos.z) * 4.0 + pwPos.y * 3.0);
    pwGlow = 0.85 + pwCell * 0.55;
  } else if (pwMat == ${MAT.GOLD}) {
    // GOLD
    pwGlow = 0.03 + pwRim * 0.22;
  } else if (pwMat == ${MAT.SCORCHED}) {
    // SCORCHED
    pwDetail = 0.90 + pwCell * 0.12;
  } else if (pwMat == ${MAT.SLUDGE}) {
    // SLUDGE: lama tóxica, borbulha e brilha de leve
    pwDetail = 0.88 + pwFine * 0.16;
    pwGlow = 0.06 + pwRim * 0.16;
  }

  color.rgb *= clamp(pwDetail, 0.82, 1.12);
  color.rgb += baseColor.rgb * pwGlow;
`;

export class ChunkDetailPlugin extends MaterialPluginBase {
  constructor(material: Material) {
    super(material, 'VoxelDetail', 200, undefined, true, true);
    this.doNotSerialize = true;
  }

  public getClassName(): string {
    return 'ChunkDetailPlugin';
  }

  public getAttributes(
    attributes: string[],
    _scene: Scene,
    _mesh: AbstractMesh,
  ): void {
    attributes.push('matId');
  }

  public getCustomCode(
    shaderType: string,
  ): Nullable<{ [pointName: string]: string }> {
    if (shaderType === 'vertex') {
      return {
        CUSTOM_VERTEX_DEFINITIONS:
          'attribute float matId;\nvarying float vMatId;',
        CUSTOM_VERTEX_MAIN_BEGIN: 'vMatId = matId;',
      };
    }
    if (shaderType === 'fragment') {
      return {
        CUSTOM_FRAGMENT_DEFINITIONS: 'varying float vMatId;',
        CUSTOM_FRAGMENT_BEFORE_FOG: FRAGMENT_CODE,
      };
    }
    return null;
  }
}
