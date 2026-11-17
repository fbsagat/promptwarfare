import { MAT, type SceneryKind } from './types.ts';

export interface SceneryCell {
  vx: number;
  vy: number;
  vz: number;
  mat: number;
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Gera a estrutura em coordenadas absolutas de voxel. O servidor decide onde
 * apoiar (ground+1) e aplica as células em camadas por `vy`, produzindo o
 * efeito de "surgir do chão".
 */
export function buildSceneryCells(
  kind: SceneryKind,
  baseX: number,
  baseY: number,
  baseZ: number,
  seed: number,
  maxY: number,
): SceneryCell[] {
  const rand = mulberry32(seed);
  const cells = new Map<string, SceneryCell>();
  const limitY = Math.min(maxY - 1, baseY + 64);
  if (limitY <= baseY) return [];

  const put = (vx: number, vy: number, vz: number, mat: number): void => {
    if (vy <= 0 || vy >= limitY) return;
    const key = `${vx},${vy},${vz}`;
    if (!cells.has(key)) cells.set(key, { vx, vy, vz, mat });
  };

  const tree = (cx: number, cz: number, scale: number): void => {
    const trunkHeight = Math.max(3, Math.round((4 + rand() * 4) * scale));
    for (let dy = 0; dy < trunkHeight; dy++) put(cx, baseY + dy, cz, MAT.WOOD);
    const canopyBase = baseY + trunkHeight - 2;
    const radius = 2 + Math.round(rand() * 2);
    for (let dy = 0; dy <= 3; dy++) {
      const r = Math.max(0, radius - dy);
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (dx * dx + dz * dz > r * r + 1) continue;
          put(cx + dx, canopyBase + dy, cz + dz, dy === 3 ? MAT.MOSS : MAT.LEAVES);
        }
      }
    }
  };

  const walls = (
    min: number,
    max: number,
    height: number,
    wallMat: number,
    roofMat: number,
    windowEvery: number,
    doorSide: number,
  ): void => {
    for (let dy = 0; dy < height; dy++) {
      for (let dz = min; dz <= max; dz++) {
        for (let dx = min; dx <= max; dx++) {
          const edgeX = dx === min || dx === max;
          const edgeZ = dz === min || dz === max;
          if (!edgeX && !edgeZ) continue;
          const isDoor = dy <= 1 && ((doorSide === 0 && dz === max) || (doorSide === 1 && dz === min)) && dx === 0;
          const isWindow = windowEvery > 0 && dy > 1 && dy % windowEvery === 0 && !isDoor;
          if (isDoor || isWindow) continue;
          put(baseX + dx, baseY + dy, baseZ + dz, wallMat);
        }
      }
    }
    for (let dz = min; dz <= max; dz++) {
      for (let dx = min; dx <= max; dx++) {
        put(baseX + dx, baseY + height, baseZ + dz, roofMat);
      }
    }
  };

  if (kind === 'tree') {
    tree(baseX, baseZ, 1);
  } else if (kind === 'grove') {
    const count = 4 + Math.floor(rand() * 3);
    for (let i = 0; i < count; i++) {
      const angle = rand() * Math.PI * 2;
      const dist = 2 + rand() * 6;
      tree(
        baseX + Math.round(Math.cos(angle) * dist),
        baseZ + Math.round(Math.sin(angle) * dist),
        0.8 + rand() * 0.5,
      );
    }
  } else if (kind === 'house') {
    walls(-2, 2, 3 + Math.floor(rand() * 2), MAT.WOOD, MAT.TERRACOTTA, 0, rand() > 0.5 ? 0 : 1);
    // Janela de vidro improvisada com cristal nas laterais.
    put(baseX - 2, baseY + 2, baseZ, MAT.CRYSTAL);
    put(baseX + 2, baseY + 2, baseZ, MAT.CRYSTAL);
  } else if (kind === 'tower') {
    const height = 12 + Math.floor(rand() * 9);
    walls(-2, 2, height, MAT.STONE, MAT.TERRACOTTA, 4, 0);
    for (let dy = 1; dy < height; dy++) put(baseX, baseY + dy, baseZ, MAT.LADDER);
  } else if (kind === 'skyscraper') {
    const height = 26 + Math.floor(rand() * 15);
    walls(-3, 3, height, MAT.STONE, MAT.CRYSTAL, 3, 0);
    for (let dy = 1; dy < height; dy++) {
      put(baseX, baseY + dy, baseZ, MAT.LADDER);
      if (dy % 6 === 0) {
        for (let dz = -3; dz <= 3; dz++) {
          put(baseX + dz, baseY + dy, baseZ + 3, MAT.GOLD);
        }
      }
    }
  } else if (kind === 'ruins') {
    const pillars = 5 + Math.floor(rand() * 4);
    for (let i = 0; i < pillars; i++) {
      const angle = (i / pillars) * Math.PI * 2 + rand() * 0.4;
      const dist = 2 + rand() * 5;
      const px = baseX + Math.round(Math.cos(angle) * dist);
      const pz = baseZ + Math.round(Math.sin(angle) * dist);
      const h = 2 + Math.floor(rand() * 7);
      const mat = rand() > 0.35 ? MAT.STONE : MAT.MOSS;
      for (let dy = 0; dy < h; dy++) put(px, baseY + dy, pz, mat);
      if (rand() > 0.4) put(px, baseY + h, pz, MAT.TERRACOTTA);
    }
  }

  return Array.from(cells.values()).sort((a, b) => a.vy - b.vy || a.vz - b.vz || a.vx - b.vx);
}
