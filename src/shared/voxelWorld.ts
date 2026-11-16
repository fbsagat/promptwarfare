import {
  MAT,
  VOXEL_SIZE,
  WATER_LEVEL_VOXEL,
  WATER_LEVEL_WORLD,
  type IslandMeta,
  type IslandZipline,
  type Vec3,
  type VoxelDelta,
} from './types.ts';

export class VoxelGrid {
  readonly dimX: number;
  readonly dimY: number;
  readonly dimZ: number;
  readonly data: Uint8Array;

  constructor(dimX: number, dimY: number, dimZ: number, data?: Uint8Array) {
    this.dimX = dimX;
    this.dimY = dimY;
    this.dimZ = dimZ;
    this.data = data ?? new Uint8Array(dimX * dimY * dimZ);
  }

  inBounds(vx: number, vy: number, vz: number): boolean {
    return (
      vx >= 0 &&
      vx < this.dimX &&
      vy >= 0 &&
      vy < this.dimY &&
      vz >= 0 &&
      vz < this.dimZ
    );
  }

  index(vx: number, vy: number, vz: number): number {
    return vx + vz * this.dimX + vy * this.dimX * this.dimZ;
  }

  get(vx: number, vy: number, vz: number): number {
    if (!this.inBounds(vx, vy, vz)) return MAT.AIR;
    return this.data[this.index(vx, vy, vz)];
  }

  set(vx: number, vy: number, vz: number, mat: number): boolean {
    if (!this.inBounds(vx, vy, vz)) return false;
    const i = this.index(vx, vy, vz);
    if (this.data[i] === mat) return false;
    this.data[i] = mat;
    return true;
  }

  isSolid(vx: number, vy: number, vz: number): boolean {
    return this.get(vx, vy, vz) !== MAT.AIR;
  }

  applyDeltas(deltas: VoxelDelta[]): void {
    for (const d of deltas) {
      this.set(d.vx, d.vy, d.vz, d.mat);
    }
  }
}

function hash2D(ix: number, iz: number, seed: number): number {
  let n = ix * 374761393 + iz * 668265263 + seed * 1442695041;
  n = (n ^ (n >> 13)) * 1274126177;
  n = n ^ (n >> 16);
  return (n >>> 0) / 4294967295;
}

function smoothNoise2D(x: number, z: number, seed: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uz = fz * fz * (3 - 2 * fz);

  const a = hash2D(ix, iz, seed);
  const b = hash2D(ix + 1, iz, seed);
  const c = hash2D(ix, iz + 1, seed);
  const d = hash2D(ix + 1, iz + 1, seed);

  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}

function fbm2D(x: number, z: number, seed: number): number {
  let val = 0;
  let amp = 0.55;
  let freq = 1;
  for (let o = 0; o < 4; o++) {
    val += amp * smoothNoise2D(x * freq, z * freq, seed + o * 7919);
    freq *= 2.02;
    amp *= 0.48;
  }
  return val;
}

type BiomeKind = 'desert' | 'forest' | 'swamp' | 'tundra' | 'volcanic';

function smoothstep01(t: number): number {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
}

function smoothstepRange(edge0: number, edge1: number, x: number): number {
  return smoothstep01((x - edge0) / (edge1 - edge0));
}

const BIOME_LIST: readonly BiomeKind[] = [
  'forest',
  'desert',
  'swamp',
  'tundra',
  'volcanic',
];

function sampleBiomeInfo(
  vx: number,
  vz: number,
  cx: number,
  cz: number,
  seed: number,
): { biome: BiomeKind; weights: Record<BiomeKind, number> } {
  const s = VOXEL_SIZE / 0.5;
  const angle = Math.atan2(vz - cz, vx - cx) + (seed % 11) * 0.55;
  const warp = (fbm2D(vx * 0.015 * s, vz * 0.015 * s, seed + 177) - 0.5) * 1.15;
  const sector = (((angle + warp) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  const pos = (sector / (Math.PI * 2)) * 5; // [0, 5)

  const weights: Record<BiomeKind, number> = {
    forest: 0,
    desert: 0,
    swamp: 0,
    tundra: 0,
    volcanic: 0,
  };

  let sum = 0;
  for (let i = 0; i < 5; i++) {
    const center = i + 0.5;
    let diff = Math.abs(pos - center);
    if (diff > 2.5) diff = 5 - diff;
    // Overlap width of 0.90 sectors creates gradual hills/ramps across biome seams
    const w = smoothstep01(1 - diff / 0.9);
    weights[BIOME_LIST[i]] = w;
    sum += w;
  }

  if (sum > 0) {
    for (const b of BIOME_LIST) {
      weights[b] /= sum;
    }
  } else {
    weights.forest = 1;
  }

  // Slight high-frequency edge dither so grass/snow/sand meet organically instead of in straight lines
  const dither = (fbm2D(vx * 0.09 * s, vz * 0.09 * s, seed + 991) - 0.5) * 0.24;
  const ditheredPos = (((pos + dither) % 5) + 5) % 5;
  const idx = Math.floor(ditheredPos) % 5;
  return { biome: BIOME_LIST[idx], weights };
}

export function createProceduralIsland(
  seed: number,
  dimX: number,
  dimY: number,
  dimZ: number,
  meta?: IslandMeta,
): VoxelGrid {
  const grid = new VoxelGrid(dimX, dimY, dimZ);
  const ziplineAnchors: Vec3[] = [];
  const cx = dimX * 0.5;
  const cz = dimZ * 0.5;
  const islandRadius = Math.min(dimX, dimZ) * 0.44;
  const resScale = 0.5 / VOXEL_SIZE; // 1.6 at 0.3125m
  const coordScale = VOXEL_SIZE / 0.5; // 0.625 at 0.3125m
  const maxTerrainH = Math.max(Math.round(24 * resScale), dimY - Math.round(11 * resScale));

  const biomeMap = new Array<BiomeKind>(dimX * dimZ);
  const topHeightMap = new Int16Array(dimX * dimZ);

  for (let vz = 0; vz < dimZ; vz++) {
    for (let vx = 0; vx < dimX; vx++) {
      const dx = (vx - cx) / islandRadius;
      const dz = (vz - cz) / islandRadius;
      const radial = Math.sqrt(dx * dx + dz * dz);
      const { biome, weights } = sampleBiomeInfo(vx, vz, cx, cz, seed);
      biomeMap[vx + vz * dimX] = biome;

      const sx = vx * coordScale;
      const sz = vz * coordScale;
      const n = fbm2D(sx * 0.017, sz * 0.017, seed);
      const detail = fbm2D(sx * 0.052, sz * 0.052, seed + 313);
      const fine = fbm2D(sx * 0.14, sz * 0.14, seed + 601);
      const ridge = Math.abs(detail - 0.5) * 2;
      const caveMask = fbm2D(sx * 0.075, sz * 0.075, seed + 719);

      // Peninsulas, coves, and smoothly blended high-resolution biome elevation
      const coastWarp = (n - 0.5) * 0.42 + (detail - 0.5) * 0.14;
      const distNorm = radial + coastWarp;
      const islandMask = Math.max(0, 1 - Math.pow(Math.max(0, distNorm), 2.15));

      const inlandBand =
        smoothstepRange(0.18, 0.34, radial) * smoothstepRange(0.92, 0.74, radial);
      const swampMod = (-3.6 + (detail - 0.5) * 2.6) * inlandBand;
      const desertMod = Math.sin(sx * 0.075 + sz * 0.04) * 2.0 + (fine - 0.5) * 0.9;
      const volcanicMod = (2.6 + (1 - ridge) * 3.6) * smoothstepRange(0.14, 0.36, radial);
      const tundraMod = (1.8 + n * 3.4) * smoothstepRange(0.14, 0.36, radial);

      const biomeHeightMod =
        weights.desert * desertMod +
        weights.swamp * swampMod +
        weights.tundra * tundraMod +
        weights.volcanic * volcanicMod;

      const poolStrength =
        weights.swamp *
        smoothstepRange(0.42, 0.22, detail) *
        smoothstepRange(0.22, 0.36, radial) *
        smoothstepRange(0.84, 0.7, radial);

      let topVy = Math.round(
        (2 +
          islandMask * (14 + n * 24 + (1 - ridge) * 10 + biomeHeightMod + (fine - 0.5) * 1.4) -
          poolStrength * 10) *
          resScale,
      );
      if (distNorm > 1.04) {
        topVy = Math.max(2, Math.round(2 * resScale)); // abyssal seabed
      }
      topVy = Math.max(1, Math.min(maxTerrainH, topVy));
      topHeightMap[vx + vz * dimX] = topVy;

      const caveMinVy = WATER_LEVEL_VOXEL + 2;
      const caveRoofPad = Math.round(4 * resScale);
      const caveBaseTop = Math.round(16 * resScale);
      const snowTop = Math.round(34 * resScale);
      const rockTop = Math.round(26 * resScale);
      const soilDepth = Math.round(3 * resScale);

      for (let vy = 0; vy <= topVy; vy++) {
        // Shallow caves under mid/high ridges
        if (
          topVy >= caveBaseTop &&
          vy >= caveMinVy &&
          vy <= topVy - caveRoofPad &&
          caveMask > 0.64 &&
          radial > 0.12 &&
          radial < 0.76
        ) {
          continue;
        }

        let mat: number = MAT.STONE;
        if (vy === 0) {
          mat = MAT.BEDROCK;
        } else if (topVy <= WATER_LEVEL_VOXEL + 3) {
          if (biome === 'swamp') {
            mat = vy === topVy ? MAT.MOSS : MAT.DIRT;
          } else if (biome === 'volcanic') {
            mat = vy === topVy ? MAT.BASALT : MAT.SCORCHED;
          } else if (biome === 'tundra') {
            mat = vy === topVy ? MAT.ICE : MAT.STONE;
          } else {
            mat = vy === topVy ? MAT.SAND : MAT.DIRT;
          }
        } else if (vy === topVy) {
          if (topVy >= snowTop) {
            mat = biome === 'volcanic' ? MAT.SCORCHED : MAT.ICE;
          } else if (topVy > rockTop) {
            mat =
              biome === 'desert'
                ? MAT.TERRACOTTA
                : biome === 'volcanic'
                  ? MAT.BASALT
                  : biome === 'tundra'
                    ? MAT.SNOW
                    : MAT.STONE;
          } else {
            switch (biome) {
              case 'desert':
                mat = detail > 0.64 ? MAT.TERRACOTTA : MAT.SAND;
                break;
              case 'swamp':
                mat = detail > 0.68 ? MAT.GRASS : MAT.MOSS;
                break;
              case 'tundra':
                mat = detail > 0.72 ? MAT.ICE : MAT.SNOW;
                break;
              case 'volcanic':
                mat = detail > 0.72 ? MAT.SCORCHED : MAT.BASALT;
                break;
              default:
                mat = MAT.GRASS;
            }
          }
        } else if (vy >= topVy - soilDepth) {
          if (biome === 'desert') mat = MAT.TERRACOTTA;
          else if (biome === 'volcanic') mat = MAT.BASALT;
          else mat = topVy > rockTop ? MAT.STONE : MAT.DIRT;
        } else {
          mat = biome === 'volcanic' ? MAT.BASALT : MAT.STONE;
        }
        grid.set(vx, vy, vz, mat);
      }

      // Rocky / basalt / terracotta outcrops on ridges & shores (higher density grid -> stepped organic boulders)
      if (
        topVy >= WATER_LEVEL_VOXEL + 2 &&
        topVy < dimY - 12 &&
        radial < 0.9 &&
        hash2D(vx, vz, seed + 443) > 0.9968
      ) {
        const rockMat =
          biome === 'desert'
            ? MAT.TERRACOTTA
            : biome === 'volcanic'
              ? MAT.BASALT
              : biome === 'tundra'
                ? MAT.ICE
                : MAT.STONE;
        for (let bx = -2; bx <= 2; bx++) {
          for (let bz = -2; bz <= 2; bz++) {
            const d2 = bx * bx + bz * bz;
            if (d2 > 5) continue;
            const bh = d2 <= 1 ? 4 : d2 <= 2 ? 3 : 2;
            for (let by = 1; by <= bh; by++) {
              grid.set(vx + bx, topVy + by, vz + bz, rockMat);
            }
          }
        }
      }

      // Scattered crystal / ice clusters on high ridges
      if (topVy >= Math.round(18 * resScale) && hash2D(vx, vz, seed + 901) > 0.9962) {
        const spireH = 6 + Math.floor(hash2D(vx, vz, seed + 907) * 10);
        const clusterMat = biome === 'volcanic' && topVy > Math.round(24 * resScale) ? MAT.LAVA : MAT.CRYSTAL;
        for (let h = 1; h <= spireH && topVy + h < dimY - 3; h++) {
          grid.set(vx, topVy + h, vz, h === spireH ? MAT.CRYSTAL : clusterMat);
          if (h <= 3) {
            grid.set(vx + 1, topVy + h, vz, clusterMat);
            grid.set(vx, topVy + h, vz + 1, clusterMat);
          }
        }
      }

      // (Flora & organic props are placed in Pass 3 after major architectural structures)
    }
  }

  // Track major structure centers & footprint exclusion mask to prevent overlaps with trees/buildings
  const placedCenters: Array<{ vx: number; vz: number; radius: number }> = [
    { vx: Math.floor(cx), vz: Math.floor(cz), radius: 22 },
  ];
  const structureMask = new Uint8Array(dimX * dimZ);

  const markStructureMask = (svx: number, svz: number, radius: number) => {
    const padR = radius + 4;
    const minX = Math.max(0, svx - padR);
    const maxX = Math.min(dimX - 1, svx + padR);
    const minZ = Math.max(0, svz - padR);
    const maxZ = Math.min(dimZ - 1, svz + padR);
    const rSq = padR * padR;
    for (let z = minZ; z <= maxZ; z++) {
      for (let x = minX; x <= maxX; x++) {
        const dx = x - svx;
        const dz = z - svz;
        if (dx * dx + dz * dz <= rSq) {
          structureMask[x + z * dimX] = 1;
        }
      }
    }
  };

  const canPlaceStructure = (vx: number, vz: number, radius: number): boolean => {
    if (vx <= radius + 8 || vx >= dimX - radius - 8 || vz <= radius + 8 || vz >= dimZ - radius - 8) {
      return false;
    }
    for (const c of placedCenters) {
      const minSep = c.radius + radius;
      const dx = vx - c.vx;
      const dz = vz - c.vz;
      if (dx * dx + dz * dz < minSep * minSep) return false;
    }
    return true;
  };

  const registerStructure = (vx: number, vz: number, radius: number) => {
    placedCenters.push({ vx, vz, radius });
    markStructureMask(vx, vz, radius);
  };

  // Validate that an entire structure footprint sits on dry ground without overhanging a steep cliff
  const checkFootprintFlatAndDry = (
    vx: number,
    vz: number,
    r: number,
    minDryY: number,
    maxCeilY: number,
    maxDrop = 6,
  ): { ok: boolean; minY: number; maxY: number; baseVy: number } => {
    if (vx - r < 8 || vx + r >= dimX - 8 || vz - r < 8 || vz + r >= dimZ - 8) {
      return { ok: false, minY: 0, maxY: 0, baseVy: 0 };
    }
    const step = Math.max(1, Math.floor(r / 2));
    let minY = dimY;
    let maxY = 0;
    for (let dz = -r; dz <= r; dz += step) {
      for (let dx = -r; dx <= r; dx += step) {
        const h = topHeightMap[vx + dx + (vz + dz) * dimX];
        if (h < minY) minY = h;
        if (h > maxY) maxY = h;
      }
    }
    // Explicitly include exact corners in case r is not evenly divisible by step
    for (const [cxOff, czOff] of [
      [-r, -r],
      [r, -r],
      [-r, r],
      [r, r],
      [0, 0],
    ]) {
      const h = topHeightMap[vx + cxOff + (vz + czOff) * dimX];
      if (h < minY) minY = h;
      if (h > maxY) maxY = h;
    }
    if (minY < minDryY || maxY >= maxCeilY || maxY - minY > maxDrop) {
      return { ok: false, minY, maxY, baseVy: 0 };
    }
    return { ok: true, minY, maxY, baseVy: maxY + 1 };
  };

  const tryFindPlacement = (
    baseAngle: number,
    baseDist: number,
    sepRadius: number,
    footRadius: number,
    minDryY: number,
    maxCeilY: number,
    maxDrop = 6,
  ): { lx: number; lz: number; minY: number; maxY: number; baseVy: number } | null => {
    const offsets = [
      [0, 1.0],
      [0.14, 0.96],
      [-0.14, 0.96],
      [0.26, 0.9],
      [-0.26, 0.9],
      [0, 0.85],
    ];
    for (const [angOff, distScale] of offsets) {
      const lx = Math.round(cx + Math.cos(baseAngle + angOff) * baseDist * distScale);
      const lz = Math.round(cz + Math.sin(baseAngle + angOff) * baseDist * distScale);
      if (!canPlaceStructure(lx, lz, sepRadius)) continue;
      const check = checkFootprintFlatAndDry(lx, lz, footRadius, minDryY, maxCeilY, maxDrop);
      if (check.ok) {
        return { lx, lz, minY: check.minY, maxY: check.maxY, baseVy: check.baseVy };
      }
    }
    return null;
  };

  // Central crystal & gold citadel landmark with walkable staircase ramps
  placeCentralCitadel(grid, Math.floor(cx), Math.floor(cz));
  markStructureMask(Math.floor(cx), Math.floor(cz), 14);

  // 1-2 Playable Castles with courtyard, battlements, keep, and internal stairs
  const castleCount = dimX >= 448 ? 2 : 1;
  for (let i = 0; i < castleCount; i++) {
    const angle = i * Math.PI + 0.55 + (seed % 9) * 0.27;
    const dist = islandRadius * 0.42;
    const spot = tryFindPlacement(angle, dist, 16, 12, WATER_LEVEL_VOXEL + 4, dimY - 26, 7);
    if (!spot) continue;
    const biome = biomeMap[spot.lx + spot.lz * dimX];
    placeVoxelCastle(grid, spot.lx, spot.baseVy, spot.lz, biome === 'volcanic');
    registerStructure(spot.lx, spot.lz, 16);
  }

  // 2-4 Underground Dungeons with stone crypt entrance & walkable descending stairs
  const dungeonCount = Math.min(4, 2 + Math.floor(dimX / 220));
  for (let i = 0; i < dungeonCount; i++) {
    const angle = (i / dungeonCount) * Math.PI * 2 + 1.15 + (seed % 11) * 0.19;
    const dist = islandRadius * 0.46;
    // Requires enough rock thickness beneath ground for excavated underground chamber
    const spot = tryFindPlacement(angle, dist, 13, 10, WATER_LEVEL_VOXEL + 11, dimY - 16, 5);
    if (!spot) continue;
    const biome = biomeMap[spot.lx + spot.lz * dimX];
    const centerGroundY = topHeightMap[spot.lx + spot.lz * dimX];
    placeDungeonCrypt(grid, spot.lx, centerGroundY, spot.lz, biome === 'volcanic' || biome === 'desert');
    registerStructure(spot.lx, spot.lz, 13);
  }

  // Multi-size Watchtowers (small, medium, tall) with internal staircases + Biome Landmarks
  const towerSizes: Array<'small' | 'medium' | 'tall'> = ['tall', 'medium', 'small', 'medium', 'tall'];
  const landmarkCount = Math.min(14, 7 + Math.floor(dimX / 80));
  for (let i = 0; i < landmarkCount; i++) {
    const angle = (i / landmarkCount) * Math.PI * 2 + (seed % 7) * 0.31;
    const dist = islandRadius * (i % 3 === 0 ? 0.34 : i % 3 === 1 ? 0.53 : 0.64);
    const footR = i % 3 === 0 ? 5 : 9;
    const spot = tryFindPlacement(angle, dist, 10, footR, WATER_LEVEL_VOXEL + 3, dimY - 30, 6);
    if (!spot) continue;
    const { lx, lz, baseVy } = spot;
    const biome = biomeMap[lx + lz * dimX];

    if (i % 3 === 0) {
      const size = towerSizes[i % towerSizes.length];
      const info = placeWatchtower(grid, lx, baseVy, lz, {
        icy: biome === 'tundra',
        volcanic: biome === 'volcanic',
        size,
      });
      ziplineAnchors.push({
        x: (lx + 0.5) * VOXEL_SIZE,
        y: (info.topVy + 1) * VOXEL_SIZE + 0.5,
        z: (lz + 0.5) * VOXEL_SIZE,
      });
      registerStructure(lx, lz, 10);
    } else if (biome === 'desert') {
      if (i % 2 === 0) placeDesertPyramid(grid, lx, baseVy, lz);
      else placeHouse(grid, lx, baseVy, lz, 'desert_adobe');
      registerStructure(lx, lz, 10);
    } else if (biome === 'forest') {
      placeHouse(grid, lx, baseVy, lz, i % 2 === 0 ? 'two_story' : 'cottage');
      registerStructure(lx, lz, 10);
    } else if (biome === 'swamp') {
      if (i % 2 === 0) placeGiantMushroom(grid, lx, baseVy, lz, true);
      else placeHouse(grid, lx, baseVy, lz, 'cottage');
      registerStructure(lx, lz, 9);
    } else if (biome === 'tundra') {
      placeHouse(grid, lx, baseVy, lz, i % 2 === 0 ? 'tundra_lodge' : 'two_story');
      registerStructure(lx, lz, 10);
    } else {
      placeVolcanicVent(grid, lx, baseVy, lz, true);
      registerStructure(lx, lz, 8);
    }
  }

  // Villages / Houses + Shrines + Bridges + Tactical Bunkers + Ruin Arches + Lantern Posts
  const propCount = Math.min(20, 10 + Math.floor(dimX / 55));
  for (let i = 0; i < propCount; i++) {
    const ringFactor = i % 3 === 0 ? 0.25 : i % 3 === 1 ? 0.48 : 0.67;
    const dist = islandRadius * ringFactor;
    const angle = (i / propCount) * Math.PI * 2 + (seed % 5) * 0.23;
    const kindMod = i % 5;
    const footR = kindMod === 0 ? 6 : kindMod === 4 ? 7 : 5;
    const spot = tryFindPlacement(angle, dist, 8, footR, WATER_LEVEL_VOXEL + 3, dimY - 22, 6);
    if (!spot) continue;
    const { lx: rx, lz: rz, baseVy } = spot;
    const biome = biomeMap[rx + rz * dimX];

    if (kindMod === 0) {
      const style =
        biome === 'desert'
          ? 'desert_adobe'
          : biome === 'tundra'
            ? 'tundra_lodge'
            : i % 2 === 0
              ? 'two_story'
              : 'cottage';
      placeHouse(grid, rx, baseVy, rz, style);
      registerStructure(rx, rz, 8);
    } else if (kindMod === 1) {
      placeTacticalBunker(grid, rx, baseVy, rz, i % 2 === 0);
      registerStructure(rx, rz, 6);
    } else if (kindMod === 2) {
      placeStoneRuinArch(grid, rx, baseVy, rz, i % 2 === 0);
      registerStructure(rx, rz, 7);
    } else if (kindMod === 3) {
      placeAncientShrine(grid, rx, baseVy, rz, biome === 'volcanic');
      registerStructure(rx, rz, 6);
    } else {
      placeStoneBridge(grid, rx, baseVy, rz, i % 2 === 0);
      registerStructure(rx, rz, 8);
    }
    const lanternX = rx + 9;
    if (lanternX < dimX - 6 && topHeightMap[lanternX + rz * dimX] > WATER_LEVEL_VOXEL + 2) {
      placeLanternPost(grid, lanternX, topHeightMap[lanternX + rz * dimX] + 1, rz);
      markStructureMask(lanternX, rz, 2);
    }
  }

  // Pass 3: Scatter biome-specific flora & organic props strictly outside structure footprints
  const rockTopFlora = Math.round(26 * resScale);
  for (let vz = 27; vz < dimZ - 22; vz += 9) {
    for (let vx = 27; vx < dimX - 22; vx += 9) {
      if (structureMask[vx + vz * dimX] !== 0) continue;
      // Ensure tree canopy / shrub edges won't brush against neighboring buildings
      let nearStructure = false;
      for (let oz = -4; oz <= 4 && !nearStructure; oz += 4) {
        for (let ox = -4; ox <= 4; ox += 4) {
          if (structureMask[vx + ox + (vz + oz) * dimX] !== 0) {
            nearStructure = true;
            break;
          }
        }
      }
      if (nearStructure) continue;

      const dx = (vx - cx) / islandRadius;
      const dz = (vz - cz) / islandRadius;
      const radial = Math.sqrt(dx * dx + dz * dz);
      if (radial <= 0.14) continue;

      const topVy = topHeightMap[vx + vz * dimX];
      if (topVy < WATER_LEVEL_VOXEL + 3 || topVy > rockTopFlora) continue;

      const biome = biomeMap[vx + vz * dimX];
      const roll = hash2D(vx, vz, seed + 557);
      if (biome === 'forest') {
        if (roll > 0.58) {
          placeVoxelTree(grid, vx, topVy + 1, vz, hash2D(vx, vz, seed + 613) > 0.58, false);
        } else if (roll < 0.14) {
          placeFallenLog(grid, vx, topVy + 1, vz, hash2D(vx, vz, seed + 617) > 0.5);
        } else if (roll < 0.24) {
          placeShrubCluster(grid, vx, topVy + 1, vz, MAT.LEAVES);
        }
      } else if (biome === 'tundra') {
        if (roll > 0.65) {
          if (roll > 0.85) {
            placeIceSpire(grid, vx, topVy + 1, vz);
          } else {
            placeVoxelTree(grid, vx, topVy + 1, vz, true, true);
          }
        } else if (roll < 0.12) {
          placeShrubCluster(grid, vx, topVy + 1, vz, MAT.SNOW);
        }
      } else if (biome === 'desert') {
        if (roll > 0.7) {
          placeCactus(grid, vx, topVy + 1, vz, 6 + Math.floor((roll * 10) % 5));
        } else if (roll < 0.11) {
          placeDesertRockPillar(grid, vx, topVy + 1, vz);
        }
      } else if (biome === 'swamp') {
        if (roll > 0.62) {
          if (roll > 0.8) {
            placeGiantMushroom(grid, vx, topVy + 1, vz);
          } else {
            placeVoxelTree(grid, vx, topVy + 1, vz, false, false, true);
          }
        } else if (roll < 0.16) {
          placeFallenLog(grid, vx, topVy + 1, vz, hash2D(vx, vz, seed + 619) > 0.5, true);
        }
      } else if (biome === 'volcanic') {
        if (roll > 0.8) {
          placeVolcanicVent(grid, vx, topVy + 1, vz);
        } else if (roll < 0.12) {
          placeDesertRockPillar(grid, vx, topVy + 1, vz, true);
        }
      }
    }
  }

  if (meta) {
    meta.ziplines = buildZiplineRoutes(ziplineAnchors);
  }

  return grid;
}

function buildZiplineRoutes(anchors: Vec3[]): IslandZipline[] {
  const routes: IslandZipline[] = [];
  const used = new Set<number>();
  for (let i = 0; i < anchors.length && routes.length < 4; i++) {
    if (used.has(i)) continue;
    const a = anchors[i];
    let best = -1;
    let bestScore = Number.POSITIVE_INFINITY;
    for (let j = i + 1; j < anchors.length; j++) {
      if (used.has(j)) continue;
      const b = anchors[j];
      const horizontal = Math.hypot(a.x - b.x, a.z - b.z);
      const vertical = Math.abs(a.y - b.y);
      if (horizontal < 14 || horizontal > 80 || vertical < 1) continue;
      const score = Math.abs(horizontal - 38) + vertical * 0.4;
      if (score < bestScore) {
        bestScore = score;
        best = j;
      }
    }
    if (best < 0) continue;
    used.add(i);
    used.add(best);
    const other = anchors[best];
    const from = a.y >= other.y ? a : other;
    const to = a.y >= other.y ? other : a;
    routes.push({
      id: `zip_${routes.length}`,
      from: { x: from.x, y: from.y, z: from.z },
      to: { x: to.x, y: to.y, z: to.z },
    });
  }
  return routes;
}

export function fillAnchoredPillar(
  grid: VoxelGrid,
  vx: number,
  vz: number,
  baseVy: number,
  height: number,
  mat: number,
): void {
  const slopeTop = getTerrainVoxelY(grid, vx, vz);
  let startY = Math.max(1, Math.min(baseVy, slopeTop + 1));
  while (
    startY > 1 &&
    (!grid.isSolid(vx, startY - 1, vz) ||
      grid.get(vx, startY - 1, vz) === MAT.LEAVES ||
      grid.get(vx, startY - 1, vz) === MAT.WOOD)
  ) {
    startY--;
  }
  for (let y = startY; y < baseVy + height; y++) {
    grid.set(vx, y, vz, mat);
  }
}

function placeCentralCitadel(grid: VoxelGrid, midVx: number, midVz: number): void {
  const peakVy = getGroundVoxelY(grid, midVx, midVz);
  for (let dx = -7; dx <= 7; dx++) {
    for (let dz = -7; dz <= 7; dz++) {
      const colTop = getGroundVoxelY(grid, midVx + dx, midVz + dz);
      for (let fy = colTop + 1; fy <= peakVy + 1; fy++) {
        grid.set(midVx + dx, fy, midVz + dz, MAT.STONE);
      }
      if (Math.abs(dx) <= 6 && Math.abs(dz) <= 6) {
        grid.set(midVx + dx, peakVy + 2, midVz + dz, MAT.STONE);
      }
      if (Math.abs(dx) <= 5 && Math.abs(dz) <= 5) {
        const edgeGold = Math.abs(dx) === 5 && Math.abs(dz) === 5;
        grid.set(midVx + dx, peakVy + 3, midVz + dz, edgeGold ? MAT.GOLD : MAT.STONE);
      }
      if (Math.abs(dx) <= 2 && Math.abs(dz) <= 2) {
        grid.set(midVx + dx, peakVy + 4, midVz + dz, MAT.GOLD);
      }
    }
  }
  for (const [ox, oz] of [
    [-5, -5],
    [5, -5],
    [-5, 5],
    [5, 5],
  ]) {
    for (let h = 4; h <= 14; h++) {
      grid.set(midVx + ox, peakVy + h, midVz + oz, h >= 13 ? MAT.CRYSTAL : MAT.STONE);
    }
  }
  for (let h = 4; h <= 28 && peakVy + h < grid.dimY - 2; h++) {
    grid.set(midVx, peakVy + h, midVz, MAT.CRYSTAL);
    if (h <= 18) {
      grid.set(midVx + 1, peakVy + h, midVz, MAT.CRYSTAL);
      grid.set(midVx, peakVy + h, midVz + 1, MAT.CRYSTAL);
      grid.set(midVx + 1, peakVy + h, midVz + 1, MAT.CRYSTAL);
    }
  }
}

function placeDesertPyramid(grid: VoxelGrid, vx: number, baseVy: number, vz: number): void {
  const layers = 9;
  for (let dy = 0; dy < layers; dy++) {
    const r = layers - dy;
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        const mat =
          dy >= layers - 2
            ? MAT.GOLD
            : dy % 2 === 0
              ? MAT.SAND
              : MAT.TERRACOTTA;
        if (dy === 0) {
          fillAnchoredPillar(grid, vx + dx, vz + dz, baseVy, 1, mat);
        } else {
          grid.set(vx + dx, baseVy + dy, vz + dz, mat);
        }
      }
    }
  }
  grid.set(vx, baseVy + layers, vz, MAT.CRYSTAL);
  grid.set(vx, baseVy + layers + 1, vz, MAT.CRYSTAL);
}

export function placeWatchtower(
  grid: VoxelGrid,
  vx: number,
  baseVy: number,
  vz: number,
  opts: { icy?: boolean; volcanic?: boolean; size?: 'small' | 'medium' | 'tall' } = {},
): { topVy: number; radius: number } {
  const wallMat = opts.icy ? MAT.ICE : opts.volcanic ? MAT.BASALT : MAT.STONE;
  const trimMat = opts.icy ? MAT.SNOW : opts.volcanic ? MAT.SCORCHED : MAT.WOOD;
  const accentMat = opts.volcanic ? MAT.LAVA : opts.icy ? MAT.CRYSTAL : MAT.GOLD;
  const size = opts.size ?? 'medium';
  const r = size === 'small' ? 3 : size === 'medium' ? 4 : 5;
  const h = size === 'small' ? 15 : size === 'medium' ? 21 : 28;
  const floorSpacing = 7;

  // Build foundation, walls, clear interior, and windows
  for (let dx = -r; dx <= r; dx++) {
    for (let dz = -r; dz <= r; dz++) {
      const isCorner = Math.abs(dx) === r && Math.abs(dz) === r;
      const isWall = Math.abs(dx) === r || Math.abs(dz) === r;
      fillAnchoredPillar(grid, vx + dx, vz + dz, baseVy, 1, wallMat);
      for (let y = 1; y < h; y++) {
        // Wide ground doorway on +Z
        if (dz === r && dx >= -1 && dx <= 1 && y <= 6) {
          grid.set(vx + dx, baseVy + y, vz + dz, MAT.AIR);
          continue;
        }
        if (y === h - 1) {
          // Battlements + solid roof floor at y = h - 2
          if (!isWall || isCorner || (dx + dz) % 2 === 0) {
            grid.set(vx + dx, baseVy + y, vz + dz, wallMat);
          } else {
            grid.set(vx + dx, baseVy + y, vz + dz, MAT.AIR);
          }
        } else if (y === h - 2) {
          grid.set(vx + dx, baseVy + y, vz + dz, trimMat);
        } else if (isWall) {
          // Arrow-slit windows every floor
          const inWindowBand = y % floorSpacing >= 3 && y % floorSpacing <= 5;
          if (inWindowBand && Math.abs(dx) <= 1 && Math.abs(dz) === r && y > 6) {
            grid.set(vx + dx, baseVy + y, vz + dz, MAT.AIR);
          } else if (inWindowBand && Math.abs(dz) <= 1 && Math.abs(dx) === r) {
            grid.set(vx + dx, baseVy + y, vz + dz, MAT.AIR);
          } else {
            grid.set(vx + dx, baseVy + y, vz + dz, y % floorSpacing === 0 ? trimMat : wallMat);
          }
        } else {
          // Intermediate floor decks (with central/edge stairwell cutout left open later)
          if (y > 2 && y < h - 4 && y % floorSpacing === 0) {
            grid.set(vx + dx, baseVy + y, vz + dz, trimMat);
          } else {
            grid.set(vx + dx, baseVy + y, vz + dz, MAT.AIR);
          }
        }
      }
    }
  }

  // Carve walkable interior spiral staircase climbing along the inner perimeter (1 voxel per step)
  const ir = r - 1;
  const path: Array<[number, number]> = [];
  for (let x = -ir; x <= ir; x++) path.push([x, -ir]);
  for (let z = -ir + 1; z <= ir; z++) path.push([ir, z]);
  for (let x = ir - 1; x >= -ir; x--) path.push([x, ir]);
  for (let z = ir - 1; z > -ir; z--) path.push([-ir, z]);

  const topStairY = h - 2;
  for (let y = 1; y <= topStairY; y++) {
    const [sx, sz] = path[(y * 1) % path.length];
    const [nx, nz] = path[(y + 1) % path.length];
    // Stair tread + wider inner support step
    grid.set(vx + sx, baseVy + y, vz + sz, trimMat);
    grid.set(vx + nx, baseVy + y, vz + nz, trimMat);
    // Guarantee >= 6 voxels vertical headroom above every stair step through floor decks
    for (let cy = y + 1; cy <= Math.min(h - 1, y + 6); cy++) {
      grid.set(vx + sx, baseVy + cy, vz + sz, MAT.AIR);
      grid.set(vx + nx, baseVy + cy, vz + nz, MAT.AIR);
    }
  }

  // Rooftop beacon / banner
  grid.set(vx, baseVy + h - 1, vz, wallMat);
  grid.set(vx, baseVy + h, vz, accentMat);
  grid.set(vx, baseVy + h + 1, vz, accentMat);

  // Exterior ladder on -Z, plus openings at floor decks/roof.
  const ladderX = vx;
  const ladderZ = vz - r - 1;
  fillAnchoredPillar(grid, ladderX, ladderZ, baseVy, 1, wallMat);
  for (let y = 1; y < h - 1; y++) {
    grid.set(ladderX, baseVy + y, ladderZ, MAT.LADDER);
  }
  for (let y = floorSpacing; y < h - 1; y += floorSpacing) {
    grid.set(vx, baseVy + y, vz - r, MAT.AIR);
    grid.set(vx, baseVy + y + 1, vz - r, MAT.AIR);
  }
  grid.set(vx, baseVy + h - 2, vz - r, MAT.AIR);

  return { topVy: baseVy + h - 1, radius: r };
}

export function placeHouse(
  grid: VoxelGrid,
  vx: number,
  baseVy: number,
  vz: number,
  style: 'cottage' | 'two_story' | 'desert_adobe' | 'tundra_lodge',
): void {
  const halfX = style === 'two_story' ? 6 : 5;
  const halfZ = style === 'two_story' || style === 'desert_adobe' ? 5 : 4;
  const wallH = style === 'two_story' ? 14 : 7;
  const wallMat =
    style === 'desert_adobe'
      ? MAT.TERRACOTTA
      : style === 'tundra_lodge'
        ? MAT.STONE
        : MAT.WOOD;
  const floorMat = style === 'desert_adobe' ? MAT.SAND : MAT.WOOD;
  const roofMat =
    style === 'desert_adobe'
      ? MAT.SAND
      : style === 'tundra_lodge'
        ? MAT.SNOW
        : MAT.MOSS;

  for (let dx = -halfX; dx <= halfX; dx++) {
    for (let dz = -halfZ; dz <= halfZ; dz++) {
      fillAnchoredPillar(grid, vx + dx, vz + dz, baseVy, 1, MAT.STONE);
      const isCorner = Math.abs(dx) === halfX && Math.abs(dz) === halfZ;
      const isEdge = Math.abs(dx) === halfX || Math.abs(dz) === halfZ;

      for (let y = 1; y <= wallH; y++) {
        // Front doorway (+Z) & optional back doorway (-Z)
        if (Math.abs(dz) === halfZ && dx >= -1 && dx <= 1 && y <= 6) {
          grid.set(vx + dx, baseVy + y, vz + dz, MAT.AIR);
          continue;
        }
        // Windows on side walls
        if (Math.abs(dx) === halfX && Math.abs(dz) <= 1 && ((y >= 3 && y <= 5) || (y >= 10 && y <= 12))) {
          grid.set(vx + dx, baseVy + y, vz + dz, MAT.AIR);
          continue;
        }
        if (isEdge) {
          grid.set(vx + dx, baseVy + y, vz + dz, isCorner ? MAT.STONE : wallMat);
        } else if (style === 'two_story' && y === 7) {
          grid.set(vx + dx, baseVy + y, vz + dz, floorMat);
        } else {
          grid.set(vx + dx, baseVy + y, vz + dz, MAT.AIR);
        }
      }

      if (style === 'desert_adobe') {
        // Flat walkable roof terrace with crenellated parapet
        grid.set(vx + dx, baseVy + wallH + 1, vz + dz, roofMat);
        if (isEdge && (dx + dz) % 2 === 0) {
          grid.set(vx + dx, baseVy + wallH + 2, vz + dz, MAT.TERRACOTTA);
        }
      } else {
        // Pitched timber/snow/moss roof
        const peak = Math.max(0, halfZ - Math.abs(dz));
        for (let ry = 1; ry <= peak + 1; ry++) {
          const mat = ry === peak + 1 ? roofMat : MAT.WOOD;
          grid.set(vx + dx, baseVy + wallH + ry, vz + dz, mat);
        }
      }
    }
  }

  // Interior table & glowing hearth/lantern
  grid.set(vx - 2, baseVy + 1, vz - 1, MAT.WOOD);
  grid.set(vx - 2, baseVy + 2, vz - 1, MAT.GOLD);

  // Walkable internal wooden staircase in two-story houses & rooftop stairs in desert adobe
  if (style === 'two_story' || style === 'desert_adobe') {
    const topY = style === 'two_story' ? 7 : wallH + 1;
    const stairZ = -halfZ + 2;
    const startX = -halfX + 2;
    for (let s = 0; s < topY; s++) {
      const sx = Math.min(halfX - 2, startX + s);
      const sy = baseVy + 1 + s;
      grid.set(vx + sx, sy, vz + stairZ, MAT.WOOD);
      grid.set(vx + sx, sy, vz + stairZ + 1, MAT.WOOD);
      for (let cy = sy + 1; cy <= sy + 6; cy++) {
        grid.set(vx + sx, cy, vz + stairZ, MAT.AIR);
        grid.set(vx + sx, cy, vz + stairZ + 1, MAT.AIR);
      }
    }
  }
}

export function placeVoxelCastle(
  grid: VoxelGrid,
  vx: number,
  baseVy: number,
  vz: number,
  dark = false,
): void {
  const half = 11; // 23x23 footprint (~7.2m x 7.2m)
  const wallH = 12;
  const wallMat = dark ? MAT.BASALT : MAT.STONE;
  const trimMat = dark ? MAT.SCORCHED : MAT.WOOD;
  const accentMat = dark ? MAT.LAVA : MAT.GOLD;

  // Stone courtyard floor & outer curtain walls
  for (let dx = -half; dx <= half; dx++) {
    for (let dz = -half; dz <= half; dz++) {
      fillAnchoredPillar(grid, vx + dx, vz + dz, baseVy, 1, wallMat);
      const onOuter = Math.abs(dx) === half || Math.abs(dz) === half;
      const onWalkway = Math.abs(dx) >= half - 2 || Math.abs(dz) >= half - 2;
      const inGateway =
        (Math.abs(dz) === half && Math.abs(dx) <= 2) ||
        (Math.abs(dx) === half && Math.abs(dz) <= 2);

      for (let y = 1; y <= wallH + 2; y++) {
        if (inGateway && y <= 7) {
          grid.set(vx + dx, baseVy + y, vz + dz, MAT.AIR);
          continue;
        }
        if (onOuter && y <= wallH) {
          grid.set(vx + dx, baseVy + y, vz + dz, wallMat);
        } else if (onOuter && y === wallH + 1 && (dx + dz) % 2 === 0) {
          grid.set(vx + dx, baseVy + y, vz + dz, wallMat);
        } else if (onWalkway && y === wallH - 1) {
          grid.set(vx + dx, baseVy + y, vz + dz, trimMat);
        } else {
          grid.set(vx + dx, baseVy + y, vz + dz, MAT.AIR);
        }
      }
    }
  }

  // 4 Corner Bastion Towers rising above curtain wall (solid foundations down to terrain)
  for (const [cxOff, czOff] of [
    [-half + 1, -half + 1],
    [half - 1, -half + 1],
    [-half + 1, half - 1],
    [half - 1, half - 1],
  ]) {
    for (let tx = -2; tx <= 2; tx++) {
      for (let tz = -2; tz <= 2; tz++) {
        const bx = vx + cxOff + tx;
        const bz = vz + czOff + tz;
        fillAnchoredPillar(grid, bx, bz, baseVy, 1, wallMat);
        const isEdge = Math.abs(tx) === 2 || Math.abs(tz) === 2;
        const isInnerCorner =
          (cxOff < 0 ? tx === 2 : tx === -2) && (czOff < 0 ? tz === 2 : tz === -2);
        for (let y = 1; y <= wallH + 7; y++) {
          if (isEdge) {
            if (y <= wallH - 2 && isInnerCorner) {
              grid.set(bx, baseVy + y, bz, MAT.AIR);
            } else if (y <= wallH + 5 || (y === wallH + 6 && (tx + tz) % 2 === 0)) {
              grid.set(bx, baseVy + y, bz, wallMat);
            }
          } else if (y === wallH + 4) {
            grid.set(bx, baseVy + y, bz, trimMat);
          } else if (y <= wallH + 3) {
            grid.set(bx, baseVy + y, bz, MAT.AIR);
          }
        }
      }
    }
    grid.set(vx + cxOff, baseVy + wallH + 5, vz + czOff, wallMat);
    grid.set(vx + cxOff, baseVy + wallH + 6, vz + czOff, accentMat);
  }

  // Central Keep tower inside courtyard with balcony & anchored crystal spire
  for (let kx = -3; kx <= 3; kx++) {
    for (let kz = -3; kz <= 3; kz++) {
      const isEdge = Math.abs(kx) === 3 || Math.abs(kz) === 3;
      for (let y = 1; y <= wallH + 8; y++) {
        if (kz === 3 && Math.abs(kx) <= 1 && y <= 6) {
          grid.set(vx + kx, baseVy + y, vz + kz, MAT.AIR);
          continue;
        }
        if (isEdge) {
          if (y === wallH + 8 && (kx + kz) % 2 !== 0) continue;
          grid.set(vx + kx, baseVy + y, vz + kz, y % 6 === 0 ? accentMat : wallMat);
        } else if (y === 8 || y === wallH + 6) {
          grid.set(vx + kx, baseVy + y, vz + kz, trimMat);
        }
      }
    }
  }
  // Keep interior walkable staircase to second deck
  for (let s = 0; s < 8; s++) {
    const sx = -2 + Math.min(4, s);
    const sz = s < 4 ? -2 : -2 + (s - 3);
    const sy = baseVy + 1 + s;
    grid.set(vx + sx, sy, vz + sz, trimMat);
    for (let cy = sy + 1; cy <= sy + 6; cy++) {
      grid.set(vx + sx, cy, vz + sz, MAT.AIR);
    }
  }
  grid.set(vx, baseVy + wallH + 7, vz, wallMat);
  grid.set(vx, baseVy + wallH + 8, vz, MAT.CRYSTAL);
  grid.set(vx, baseVy + wallH + 9, vz, MAT.CRYSTAL);

  // Two courtyard staircases rising cleanly onto the perimeter ramparts (1 voxel per step)
  for (let s = 0; s < wallH - 1; s++) {
    const sy = baseVy + 1 + s;
    const stairX = -7 + s;
    grid.set(vx + stairX, sy, vz - 8, trimMat);
    grid.set(vx + stairX, sy, vz - 7, trimMat);
    for (let cy = sy + 1; cy <= sy + 6; cy++) {
      grid.set(vx + stairX, cy, vz - 8, MAT.AIR);
      grid.set(vx + stairX, cy, vz - 7, MAT.AIR);
    }
  }
}

export function placeDungeonCrypt(
  grid: VoxelGrid,
  vx: number,
  groundVy: number,
  vz: number,
  volcanic = false,
): void {
  const wallMat = volcanic ? MAT.BASALT : MAT.STONE;
  const trimMat = volcanic ? MAT.SCORCHED : MAT.MOSS;
  const chamberFloorVy = Math.max(WATER_LEVEL_VOXEL + 2, groundVy - 9);
  const chamberHalf = 6;
  const chamberCeilingVy = Math.min(groundVy - 2, chamberFloorVy + 7);

  // 1. Excavate underground vaulted dungeon room
  for (let dx = -chamberHalf; dx <= chamberHalf; dx++) {
    for (let dz = -chamberHalf; dz <= chamberHalf; dz++) {
      grid.set(vx + dx, chamberFloorVy, vz + dz, wallMat);
      const isCorner = Math.abs(dx) === 3 && Math.abs(dz) === 3;
      const isOuter = Math.abs(dx) === chamberHalf || Math.abs(dz) === chamberHalf;
      for (let vy = chamberFloorVy + 1; vy <= chamberCeilingVy; vy++) {
        if (isOuter) {
          grid.set(vx + dx, vy, vz + dz, wallMat);
        } else if (isCorner) {
          grid.set(vx + dx, vy, vz + dz, vy === chamberFloorVy + 3 ? MAT.CRYSTAL : wallMat);
        } else {
          grid.set(vx + dx, vy, vz + dz, MAT.AIR);
        }
      }
    }
  }

  // 2. Carve descending walkable stone staircase from surface portal (+Z side) down to chamber floor
  const depth = groundVy - chamberFloorVy;
  for (let s = 0; s <= depth; s++) {
    const sz = vz + chamberHalf + 3 - s;
    const stepVy = groundVy - s;
    if (stepVy >= chamberFloorVy) {
      for (let sx = -1; sx <= 1; sx++) {
        grid.set(vx + sx, stepVy, sz, wallMat);
        for (let cy = stepVy + 1; cy <= Math.min(grid.dimY - 2, stepVy + 7); cy++) {
          grid.set(vx + sx, cy, sz, MAT.AIR);
        }
      }
    }
  }

  // Treasure altar + glowing embers at the far end of the dungeon chamber
  grid.set(vx, chamberFloorVy + 1, vz - 2, MAT.GOLD);
  grid.set(vx + 1, chamberFloorVy + 1, vz - 2, MAT.GOLD);
  grid.set(vx, chamberFloorVy + 2, vz - 2, MAT.CRYSTAL);

  // 3. Above-ground dungeon crypt portal arch anchored cleanly to terrain
  const portalZ = vz + chamberHalf + 4;
  for (let px = -3; px <= 3; px++) {
    fillAnchoredPillar(grid, vx + px, portalZ, groundVy, 1, wallMat);
    for (let py = 1; py <= 8; py++) {
      if (Math.abs(px) <= 1 && py <= 6) {
        grid.set(vx + px, groundVy + py, portalZ, MAT.AIR);
      } else if (py === 8) {
        grid.set(vx + px, groundVy + py, portalZ, trimMat);
      } else {
        grid.set(vx + px, groundVy + py, portalZ, wallMat);
      }
    }
  }
  // Clear unobstructed approach threshold outside portal
  for (let az = portalZ + 1; az <= portalZ + 2; az++) {
    for (let ax = -1; ax <= 1; ax++) {
      for (let py = 1; py <= 6; py++) {
        grid.set(vx + ax, groundVy + py, az, MAT.AIR);
      }
    }
  }
  grid.set(vx - 3, groundVy + 9, portalZ, MAT.CRYSTAL);
  grid.set(vx + 3, groundVy + 9, portalZ, MAT.CRYSTAL);
}

function placeAncientShrine(
  grid: VoxelGrid,
  vx: number,
  baseVy: number,
  vz: number,
  volcanic = false,
): void {
  const mat = volcanic ? MAT.BASALT : MAT.STONE;
  for (let dx = -3; dx <= 3; dx++) {
    for (let dz = -3; dz <= 3; dz++) {
      if (Math.abs(dx) === 3 && Math.abs(dz) === 3) continue;
      fillAnchoredPillar(grid, vx + dx, vz + dz, baseVy, 1, mat);
      if (Math.abs(dx) <= 1 && Math.abs(dz) <= 1) {
        grid.set(vx + dx, baseVy + 1, vz + dz, MAT.GOLD);
      }
    }
  }
  for (const [px, pz] of [
    [-2, -2],
    [2, -2],
    [-2, 2],
    [2, 2],
  ]) {
    for (let y = 1; y <= 6; y++) {
      grid.set(vx + px, baseVy + y, vz + pz, y === 6 ? MAT.CRYSTAL : mat);
    }
  }
  grid.set(vx, baseVy + 2, vz, MAT.CRYSTAL);
  grid.set(vx, baseVy + 3, vz, MAT.CRYSTAL);
}

function placeStoneBridge(
  grid: VoxelGrid,
  vx: number,
  baseVy: number,
  vz: number,
  alongX: boolean,
): void {
  const len = 7;
  for (let s = -len; s <= len; s++) {
    const archY = Math.round(Math.cos((s / len) * Math.PI * 0.5) * 3);
    for (let w = -2; w <= 2; w++) {
      const bx = alongX ? vx + s : vx + w;
      const bz = alongX ? vz + w : vz + s;
      const deckY = baseVy + archY;
      if (Math.abs(s) >= len - 1 || Math.abs(s) === 0) {
        fillAnchoredPillar(grid, bx, bz, deckY, 1, MAT.STONE);
      } else {
        grid.set(bx, deckY, bz, MAT.STONE);
      }
      if (Math.abs(w) === 2) {
        grid.set(bx, deckY + 1, bz, Math.abs(s) % 3 === 0 ? MAT.WOOD : MAT.STONE);
      }
    }
  }
}

function placeFallenLog(
  grid: VoxelGrid,
  vx: number,
  baseVy: number,
  vz: number,
  alongX: boolean,
  mossy = false,
): void {
  for (let s = -3; s <= 3; s++) {
    const lx = alongX ? vx + s : vx;
    const lz = alongX ? vz : vz + s;
    const gy = getTerrainVoxelY(grid, lx, lz);
    if (Math.abs(gy + 1 - baseVy) > 2) continue;
    fillAnchoredPillar(grid, lx, lz, baseVy, 1, MAT.WOOD);
    grid.set(lx, baseVy + 1, lz, mossy && s % 2 === 0 ? MAT.MOSS : MAT.WOOD);
  }
}

function placeShrubCluster(
  grid: VoxelGrid,
  vx: number,
  baseVy: number,
  vz: number,
  mat: number,
): void {
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      fillAnchoredPillar(grid, vx + dx, vz + dz, baseVy, 1, mat);
      if (dx === 0 || dz === 0) {
        grid.set(vx + dx, baseVy + 1, vz + dz, mat);
      }
    }
  }
}

function placeDesertRockPillar(
  grid: VoxelGrid,
  vx: number,
  baseVy: number,
  vz: number,
  volcanic = false,
): void {
  const mat = volcanic ? MAT.BASALT : MAT.TERRACOTTA;
  const h = 6;
  for (let dy = 0; dy < h; dy++) {
    const r = dy >= 4 ? 2 : 1;
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        if (Math.abs(dx) === 2 && Math.abs(dz) === 2) continue;
        if (dy === 0) {
          fillAnchoredPillar(grid, vx + dx, vz + dz, baseVy, 1, mat);
        } else {
          grid.set(vx + dx, baseVy + dy, vz + dz, mat);
        }
      }
    }
  }
}

function placeTacticalBunker(
  grid: VoxelGrid,
  vx: number,
  baseVy: number,
  vz: number,
  alongX: boolean,
): void {
  for (let s = -5; s <= 5; s++) {
    for (let d = -2; d <= 2; d++) {
      const bx = alongX ? vx + s : vx + d;
      const bz = alongX ? vz + d : vz + s;
      fillAnchoredPillar(grid, bx, bz, baseVy, 1, MAT.STONE);
      if (Math.abs(d) === 2 && Math.abs(s) >= 2) {
        grid.set(bx, baseVy + 1, bz, MAT.STONE);
        grid.set(bx, baseVy + 2, bz, MAT.STONE);
        if (Math.abs(s) === 5) {
          grid.set(bx, baseVy + 3, bz, MAT.WOOD);
        }
      }
    }
  }
}

function placeLanternPost(grid: VoxelGrid, vx: number, baseVy: number, vz: number): void {
  if (!grid.inBounds(vx, baseVy + 7, vz)) return;
  fillAnchoredPillar(grid, vx, vz, baseVy, 6, MAT.WOOD);
  grid.set(vx, baseVy + 6, vz, MAT.GOLD);
  grid.set(vx, baseVy + 7, vz, MAT.GOLD);
}

function placeCactus(
  grid: VoxelGrid,
  vx: number,
  baseVy: number,
  vz: number,
  height: number,
): void {
  fillAnchoredPillar(grid, vx, vz, baseVy, height, MAT.LEAVES);
  grid.set(vx - 1, baseVy + 3, vz, MAT.LEAVES);
  grid.set(vx - 2, baseVy + 3, vz, MAT.LEAVES);
  grid.set(vx - 2, baseVy + 4, vz, MAT.LEAVES);
  grid.set(vx - 2, baseVy + 5, vz, MAT.LEAVES);
  grid.set(vx + 1, baseVy + 2, vz, MAT.LEAVES);
  grid.set(vx + 2, baseVy + 2, vz, MAT.LEAVES);
  grid.set(vx + 2, baseVy + 3, vz, MAT.LEAVES);
  grid.set(vx + 2, baseVy + 4, vz, MAT.LEAVES);
}

function placeGiantMushroom(
  grid: VoxelGrid,
  vx: number,
  baseVy: number,
  vz: number,
  mega = false,
): void {
  const stalkH = mega ? 11 : 8;
  const rCap = mega ? 5 : 3;
  fillAnchoredPillar(grid, vx, vz, baseVy, stalkH, MAT.SNOW);
  if (mega) {
    fillAnchoredPillar(grid, vx + 1, vz, baseVy, stalkH, MAT.SNOW);
  }
  for (let dz = -rCap; dz <= rCap; dz++) {
    for (let dx = -rCap; dx <= rCap; dx++) {
      if (dx * dx + dz * dz > rCap * rCap + 2) continue;
      const isSpot = Math.abs(dx + dz) % 3 === 0;
      grid.set(vx + dx, baseVy + stalkH, vz + dz, isSpot ? MAT.CRYSTAL : MAT.TERRACOTTA);
      if (Math.abs(dx) < rCap && Math.abs(dz) < rCap) {
        grid.set(vx + dx, baseVy + stalkH + 1, vz + dz, isSpot ? MAT.CRYSTAL : MAT.TERRACOTTA);
      }
      if (Math.abs(dx) <= Math.max(1, rCap - 2) && Math.abs(dz) <= Math.max(1, rCap - 2)) {
        grid.set(vx + dx, baseVy + stalkH + 2, vz + dz, MAT.TERRACOTTA);
      }
    }
  }
}

function placeIceSpire(grid: VoxelGrid, vx: number, baseVy: number, vz: number): void {
  for (let dy = 0; dy < 11; dy++) {
    const r = dy < 4 ? 2 : dy < 8 ? 1 : 0;
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (r === 2 && Math.abs(dx) === 2 && Math.abs(dz) === 2) continue;
        if (dy === 0) {
          fillAnchoredPillar(grid, vx + dx, vz + dz, baseVy, 1, MAT.ICE);
        } else {
          grid.set(vx + dx, baseVy + dy, vz + dz, dy >= 8 ? MAT.CRYSTAL : MAT.ICE);
        }
      }
    }
  }
}

function placeVolcanicVent(
  grid: VoxelGrid,
  vx: number,
  baseVy: number,
  vz: number,
  large = false,
): void {
  const h = large ? 10 : 7;
  const rOut = large ? 5 : 3;
  for (let dy = 0; dy < h; dy++) {
    const r = Math.max(1, rOut - Math.floor(dy / 2));
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        const d2 = dx * dx + dz * dz;
        if (d2 > r * r) continue;
        if (dx === 0 && dz === 0 && dy >= 1) {
          grid.set(vx, baseVy + dy, vz, MAT.LAVA);
        } else if (dy === 0) {
          fillAnchoredPillar(grid, vx + dx, vz + dz, baseVy, 1, MAT.BASALT);
        } else {
          grid.set(vx + dx, baseVy + dy, vz + dz, dy === h - 1 ? MAT.SCORCHED : MAT.BASALT);
        }
      }
    }
  }
}

function placeStoneRuinArch(
  grid: VoxelGrid,
  vx: number,
  baseVy: number,
  vz: number,
  alongX: boolean,
): void {
  const height = 13;
  const span = 5;
  const p1x = alongX ? vx - span : vx;
  const p1z = alongX ? vz : vz - span;
  const p2x = alongX ? vx + span : vx;
  const p2z = alongX ? vz : vz + span;

  for (const [px, pz] of [
    [p1x, p1z],
    [p2x, p2z],
  ]) {
    for (let dx = 0; dx <= 2; dx++) {
      for (let dz = 0; dz <= 2; dz++) {
        fillAnchoredPillar(grid, px + dx, pz + dz, baseVy, height - 1, MAT.STONE);
        grid.set(px + dx, baseVy + height - 1, pz + dz, MAT.CRYSTAL);
      }
    }
  }
  for (let s = -span; s <= span + 2; s++) {
    for (let w = 0; w <= 2; w++) {
      const bx = alongX ? vx + s : vx + w;
      const bz = alongX ? vz + w : vz + s;
      grid.set(bx, baseVy + height - 3, bz, MAT.STONE);
      grid.set(bx, baseVy + height - 2, bz, MAT.STONE);
      grid.set(bx, baseVy + height - 1, bz, MAT.MOSS);
    }
  }
}

function placeVoxelTree(
  grid: VoxelGrid,
  vx: number,
  baseVy: number,
  vz: number,
  tallPine = false,
  snowy = false,
  swampMoss = false,
): void {
  const trunkH = tallPine ? 11 : 8;
  for (let y = 0; y < trunkH; y++) {
    grid.set(vx, baseVy + y, vz, MAT.WOOD);
    if (y < 3) {
      grid.set(vx + 1, baseVy + y, vz, MAT.WOOD);
    }
  }
  const crownCenterY = baseVy + trunkH;
  const foliageMat = swampMoss ? MAT.MOSS : MAT.LEAVES;
  if (tallPine) {
    for (let dy = -3; dy <= 6; dy++) {
      const r = dy >= 5 ? 0 : dy >= 3 ? 1 : dy >= 0 ? 2 : 3;
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (r >= 2 && Math.abs(dx) === r && Math.abs(dz) === r) continue;
          const mat = snowy && dy >= 3 ? MAT.SNOW : foliageMat;
          grid.set(vx + dx, crownCenterY + dy, vz + dz, mat);
        }
      }
    }
    return;
  }
  for (let dy = -2; dy <= 3; dy++) {
    const r = dy === 3 ? 1 : dy === 2 || dy === -2 ? 2 : 3;
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dz * dz > r * r + 1) continue;
        if (dx === 0 && dz === 0 && dy < 0) continue;
        grid.set(vx + dx, crownCenterY + dy, vz + dz, foliageMat);
      }
    }
  }
}

export function getTerrainVoxelY(grid: VoxelGrid, vx: number, vz: number): number {
  for (let vy = grid.dimY - 1; vy >= 0; vy--) {
    const m = grid.get(vx, vy, vz);
    if (
      m !== MAT.AIR &&
      m !== MAT.LEAVES &&
      m !== MAT.WOOD &&
      m !== MAT.CRYSTAL &&
      m !== MAT.GOLD &&
      m !== MAT.LADDER
    ) {
      return vy;
    }
  }
  return 0;
}

export function getGroundVoxelY(grid: VoxelGrid, vx: number, vz: number): number {
  for (let vy = grid.dimY - 1; vy >= 0; vy--) {
    if (grid.isSolid(vx, vy, vz) && grid.get(vx, vy, vz) !== MAT.LADDER) {
      return vy;
    }
  }
  return 0;
}

/** Detecta se há uma escada (MAT.LADDER) no volume do jogador. */
export function isNearLadder(
  grid: VoxelGrid,
  pos: Vec3,
  radius = 0.9,
): boolean {
  const minVx = Math.floor((pos.x - radius) / VOXEL_SIZE);
  const maxVx = Math.floor((pos.x + radius) / VOXEL_SIZE);
  const minVy = Math.floor((pos.y + 0.05) / VOXEL_SIZE);
  const maxVy = Math.floor((pos.y + 1.45) / VOXEL_SIZE);
  const minVz = Math.floor((pos.z - radius) / VOXEL_SIZE);
  const maxVz = Math.floor((pos.z + radius) / VOXEL_SIZE);
  for (let vy = minVy; vy <= maxVy; vy++) {
    for (let vz = minVz; vz <= maxVz; vz++) {
      for (let vx = minVx; vx <= maxVx; vx++) {
        if (grid.get(vx, vy, vz) === MAT.LADDER) return true;
      }
    }
  }
  return false;
}

export function findSafeSpawnPositions(
  grid: VoxelGrid,
  count: number,
  seed: number,
): Vec3[] {
  const cx = grid.dimX * 0.5;
  const cz = grid.dimZ * 0.5;
  const ringRadius = Math.min(grid.dimX, grid.dimZ) * 0.34;
  const results: Vec3[] = [];

  for (let i = 0; i < count; i++) {
    const angle = (i / Math.max(1, count)) * Math.PI * 2 + (seed % 7) * 0.25;
    let bestPos: Vec3 | null = null;

    for (let radiusScale = 1.0; radiusScale >= 0.2 && !bestPos; radiusScale -= 0.08) {
      for (let jitter = 0; jitter <= 8 && !bestPos; jitter++) {
        const jx = jitter % 3 === 1 ? jitter : jitter % 3 === 2 ? -jitter : 0;
        const jz = jitter >= 3 ? (jitter % 2 === 0 ? jitter : -jitter) : 0;
        const vx = Math.round(cx + Math.cos(angle) * ringRadius * radiusScale) + jx;
        const vz = Math.round(cz + Math.sin(angle) * ringRadius * radiusScale) + jz;
        if (vx < 10 || vx >= grid.dimX - 10 || vz < 10 || vz >= grid.dimZ - 10) continue;
        const topY = getGroundVoxelY(grid, vx, vz);
        const topMat = grid.get(vx, topY, vz);
        if (
          topY > WATER_LEVEL_VOXEL + 2 &&
          topY < grid.dimY - 8 &&
          topMat !== MAT.LEAVES &&
          topMat !== MAT.WOOD &&
          topMat !== MAT.LAVA &&
          topMat !== MAT.CRYSTAL &&
          topMat !== MAT.GOLD
        ) {
          // Verify open headroom (6 voxels clear) and solid footing around spawn
          let clearHeadroom = true;
          for (let cy = topY + 1; cy <= topY + 6; cy++) {
            if (grid.isSolid(vx, cy, vz)) {
              clearHeadroom = false;
              break;
            }
          }
          if (!clearHeadroom) continue;
          bestPos = {
            x: (vx + 0.5) * VOXEL_SIZE,
            y: (topY + 1) * VOXEL_SIZE,
            z: (vz + 0.5) * VOXEL_SIZE,
          };
          break;
        }
      }
    }

    if (!bestPos) {
      const fallbackVx = Math.round(cx);
      const fallbackVz = Math.round(cz);
      const topY = Math.max(WATER_LEVEL_VOXEL + 2, getGroundVoxelY(grid, fallbackVx, fallbackVz));
      bestPos = {
        x: (fallbackVx + 0.5) * VOXEL_SIZE,
        y: (topY + 1) * VOXEL_SIZE,
        z: (fallbackVz + 0.5) * VOXEL_SIZE,
      };
    }

    results.push(bestPos);
  }

  return results;
}

export interface RemovedVoxel {
  vx: number;
  vy: number;
  vz: number;
  mat: number;
}

export function carveSphere(
  grid: VoxelGrid,
  worldX: number,
  worldY: number,
  worldZ: number,
  radiusVoxels: number,
  scorchShell: boolean,
): { removed: RemovedVoxel[]; deltas: VoxelDelta[] } {
  const cvx = Math.floor(worldX / VOXEL_SIZE);
  const cvy = Math.floor(worldY / VOXEL_SIZE);
  const cvz = Math.floor(worldZ / VOXEL_SIZE);
  const r = Math.max(1, Math.round(radiusVoxels));
  const rSq = r * r;
  const shellSq = (r + 0.85) * (r + 0.85);

  const removed: RemovedVoxel[] = [];
  const deltas: VoxelDelta[] = [];

  for (let dy = -r - 1; dy <= r + 1; dy++) {
    for (let dz = -r - 1; dz <= r + 1; dz++) {
      for (let dx = -r - 1; dx <= r + 1; dx++) {
        const vx = cvx + dx;
        const vy = cvy + dy;
        const vz = cvz + dz;
        if (!grid.inBounds(vx, vy, vz) || vy <= 0) continue;
        const mat = grid.get(vx, vy, vz);
        if (mat === MAT.AIR || mat === MAT.BEDROCK) continue;

        const dSq = dx * dx + dy * dy + dz * dz;
        if (dSq <= rSq) {
          grid.set(vx, vy, vz, MAT.AIR);
          removed.push({ vx, vy, vz, mat });
          deltas.push({ vx, vy, vz, mat: MAT.AIR });
        } else if (scorchShell && dSq <= shellSq && mat !== MAT.SCORCHED) {
          grid.set(vx, vy, vz, MAT.SCORCHED);
          deltas.push({ vx, vy, vz, mat: MAT.SCORCHED });
        }
      }
    }
  }

  return { removed, deltas };
}

/**
 * Bounded local BFS around a blast/dig site to detect small unsupported floating
 * voxel clusters and collapse them cleanly into falling debris.
 */
export function collapseFloatingClusters(
  grid: VoxelGrid,
  centerWorldX: number,
  centerWorldY: number,
  centerWorldZ: number,
  boxHalfExtentVoxels = 7,
): { collapsed: RemovedVoxel[]; deltas: VoxelDelta[] } {
  const cx = Math.floor(centerWorldX / VOXEL_SIZE);
  const cy = Math.floor(centerWorldY / VOXEL_SIZE);
  const cz = Math.floor(centerWorldZ / VOXEL_SIZE);

  const minX = Math.max(0, cx - boxHalfExtentVoxels);
  const maxX = Math.min(grid.dimX - 1, cx + boxHalfExtentVoxels);
  const minY = Math.max(1, cy - boxHalfExtentVoxels);
  const maxY = Math.min(grid.dimY - 1, cy + boxHalfExtentVoxels);
  const minZ = Math.max(0, cz - boxHalfExtentVoxels);
  const maxZ = Math.min(grid.dimZ - 1, cz + boxHalfExtentVoxels);

  const sx = maxX - minX + 1;
  const sy = maxY - minY + 1;
  const sz = maxZ - minZ + 1;
  const total = sx * sy * sz;
  const visited = new Uint8Array(total);
  const localIdx = (x: number, y: number, z: number) =>
    x - minX + (z - minZ) * sx + (y - minY) * sx * sz;

  const queue: number[] = [];
  const dirs = [
    [1, 0, 0],
    [-1, 0, 0],
    [0, 1, 0],
    [0, -1, 0],
    [0, 0, 1],
    [0, 0, -1],
  ];

  // Seed flood-fill from grounded voxels (vy <= 1) or solid voxels touching outside boundary
  for (let y = minY; y <= maxY; y++) {
    for (let z = minZ; z <= maxZ; z++) {
      for (let x = minX; x <= maxX; x++) {
        if (!grid.isSolid(x, y, z)) continue;
        const onGroundedEdge =
          y <= 1 ||
          (y === minY && grid.isSolid(x, y - 1, z)) ||
          x === minX ||
          x === maxX ||
          z === minZ ||
          z === maxZ;
        if (onGroundedEdge) {
          const li = localIdx(x, y, z);
          if (!visited[li]) {
            visited[li] = 1;
            queue.push(x, y, z);
          }
        }
      }
    }
  }

  let head = 0;
  while (head < queue.length) {
    const x = queue[head++];
    const y = queue[head++];
    const z = queue[head++];
    for (const [dx, dy, dz] of dirs) {
      const nx = x + dx;
      const ny = y + dy;
      const nz = z + dz;
      if (nx < minX || nx > maxX || ny < minY || ny > maxY || nz < minZ || nz > maxZ) {
        continue;
      }
      if (!grid.isSolid(nx, ny, nz)) continue;
      const li = localIdx(nx, ny, nz);
      if (!visited[li]) {
        visited[li] = 1;
        queue.push(nx, ny, nz);
      }
    }
  }

  const collapsed: RemovedVoxel[] = [];
  const deltas: VoxelDelta[] = [];

  for (let y = minY; y <= maxY; y++) {
    for (let z = minZ; z <= maxZ; z++) {
      for (let x = minX; x <= maxX; x++) {
        const mat = grid.get(x, y, z);
        if (mat === MAT.AIR || mat === MAT.BEDROCK) continue;
        if (!visited[localIdx(x, y, z)]) {
          grid.set(x, y, z, MAT.AIR);
          collapsed.push({ vx: x, vy: y, vz: z, mat });
          deltas.push({ vx: x, vy: y, vz: z, mat: MAT.AIR });
        }
      }
    }
  }

  return { collapsed, deltas };
}

export interface VoxelRayHit {
  hit: boolean;
  vx: number;
  vy: number;
  vz: number;
  nx: number;
  ny: number;
  nz: number;
  distance: number;
  point: Vec3;
  material: number;
}

export function raycastVoxels(
  grid: VoxelGrid,
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  maxDistMeters: number,
): VoxelRayHit {
  const len = Math.hypot(dx, dy, dz) || 1;
  const rdx = dx / len;
  const rdy = dy / len;
  const rdz = dz / len;

  // Convert to voxel-space coordinates
  let x = ox / VOXEL_SIZE;
  let y = oy / VOXEL_SIZE;
  let z = oz / VOXEL_SIZE;

  let vx = Math.floor(x);
  let vy = Math.floor(y);
  let vz = Math.floor(z);

  const stepX = rdx >= 0 ? 1 : -1;
  const stepY = rdy >= 0 ? 1 : -1;
  const stepZ = rdz >= 0 ? 1 : -1;

  const tDeltaX = rdx === 0 ? 1e9 : Math.abs(1 / rdx);
  const tDeltaY = rdy === 0 ? 1e9 : Math.abs(1 / rdy);
  const tDeltaZ = rdz === 0 ? 1e9 : Math.abs(1 / rdz);

  let tMaxX =
    rdx === 0
      ? 1e9
      : (stepX > 0 ? vx + 1 - x : x - vx) * tDeltaX;
  let tMaxY =
    rdy === 0
      ? 1e9
      : (stepY > 0 ? vy + 1 - y : y - vy) * tDeltaY;
  let tMaxZ =
    rdz === 0
      ? 1e9
      : (stepZ > 0 ? vz + 1 - z : z - vz) * tDeltaZ;

  const maxVoxels = maxDistMeters / VOXEL_SIZE;
  let t = 0;
  let nx = 0;
  let ny = 0;
  let nz = 0;

  // Check if starting inside solid
  if (grid.isSolid(vx, vy, vz)) {
    return {
      hit: true,
      vx,
      vy,
      vz,
      nx: 0,
      ny: 1,
      nz: 0,
      distance: 0,
      point: { x: ox, y: oy, z: oz },
      material: grid.get(vx, vy, vz),
    };
  }

  const maxIter = Math.max(1200, Math.ceil(maxVoxels * 3) + 64);
  for (let iter = 0; iter < maxIter && t <= maxVoxels; iter++) {
    if (tMaxX < tMaxY) {
      if (tMaxX < tMaxZ) {
        vx += stepX;
        t = tMaxX;
        tMaxX += tDeltaX;
        nx = -stepX;
        ny = 0;
        nz = 0;
      } else {
        vz += stepZ;
        t = tMaxZ;
        tMaxZ += tDeltaZ;
        nx = 0;
        ny = 0;
        nz = -stepZ;
      }
    } else {
      if (tMaxY < tMaxZ) {
        vy += stepY;
        t = tMaxY;
        tMaxY += tDeltaY;
        nx = 0;
        ny = -stepY;
        nz = 0;
      } else {
        vz += stepZ;
        t = tMaxZ;
        tMaxZ += tDeltaZ;
        nx = 0;
        ny = 0;
        nz = -stepZ;
      }
    }

    if (t > maxVoxels) break;
    const mat = grid.get(vx, vy, vz);
    if (mat !== MAT.AIR) {
      const dist = t * VOXEL_SIZE;
      return {
        hit: true,
        vx,
        vy,
        vz,
        nx,
        ny,
        nz,
        distance: dist,
        point: {
          x: ox + rdx * dist,
          y: oy + rdy * dist,
          z: oz + rdz * dist,
        },
        material: mat,
      };
    }
  }

  return {
    hit: false,
    vx: 0,
    vy: 0,
    vz: 0,
    nx: 0,
    ny: 0,
    nz: 0,
    distance: maxDistMeters,
    point: {
      x: ox + rdx * maxDistMeters,
      y: oy + rdy * maxDistMeters,
      z: oz + rdz * maxDistMeters,
    },
    material: MAT.AIR,
  };
}

export function overlapsSolid(
  grid: VoxelGrid,
  px: number,
  py: number,
  pz: number,
  halfW: number,
  height: number,
): boolean {
  const minVx = Math.floor((px - halfW) / VOXEL_SIZE);
  const maxVx = Math.floor((px + halfW) / VOXEL_SIZE);
  const minVy = Math.floor((py + 0.01) / VOXEL_SIZE);
  const maxVy = Math.floor((py + height - 0.01) / VOXEL_SIZE);
  const minVz = Math.floor((pz - halfW) / VOXEL_SIZE);
  const maxVz = Math.floor((pz + halfW) / VOXEL_SIZE);

  for (let vy = minVy; vy <= maxVy; vy++) {
    for (let vz = minVz; vz <= maxVz; vz++) {
      for (let vx = minVx; vx <= maxVx; vx++) {
        const mat = grid.get(vx, vy, vz);
        if (mat !== MAT.AIR && mat !== MAT.LADDER) return true;
      }
    }
  }
  return false;
}

export function resolvePlayerMovement(
  grid: VoxelGrid,
  pos: Vec3,
  vel: Vec3,
  dt: number,
  halfW = 0.34,
  height = 1.65,
  gravity = 24,
  waterLevelWorld = WATER_LEVEL_WORLD,
): { grounded: boolean; inWater: boolean } {
  const inWater = pos.y < waterLevelWorld - 0.15;
  const effGravity = inWater ? gravity * 0.22 : gravity;
  vel.y -= effGravity * dt;

  // Water buoyancy / vertical damping
  if (inWater) {
    vel.y *= Math.pow(0.25, dt);
    if (pos.y < waterLevelWorld - 0.65) {
      vel.y += 14 * dt;
    }
  }

  // Horizontal X with 0.5m micro-voxel step-up
  const nextX = pos.x + vel.x * dt;
  if (!overlapsSolid(grid, nextX, pos.y, pos.z, halfW, height)) {
    pos.x = nextX;
  } else if (!overlapsSolid(grid, nextX, pos.y + VOXEL_SIZE + 0.05, pos.z, halfW, height)) {
    pos.x = nextX;
    pos.y += VOXEL_SIZE + 0.05;
  } else {
    vel.x = 0;
  }

  // Horizontal Z with 0.5m micro-voxel step-up
  const nextZ = pos.z + vel.z * dt;
  if (!overlapsSolid(grid, pos.x, pos.y, nextZ, halfW, height)) {
    pos.z = nextZ;
  } else if (!overlapsSolid(grid, pos.x, pos.y + VOXEL_SIZE + 0.05, nextZ, halfW, height)) {
    pos.z = nextZ;
    pos.y += VOXEL_SIZE + 0.05;
  } else {
    vel.z = 0;
  }

  // Clamp to world boundaries so players cannot leave the ocean border
  const worldMaxX = (grid.dimX - 1) * VOXEL_SIZE;
  const worldMaxZ = (grid.dimZ - 1) * VOXEL_SIZE;
  pos.x = Math.max(1.0, Math.min(worldMaxX - 1.0, pos.x));
  pos.z = Math.max(1.0, Math.min(worldMaxZ - 1.0, pos.z));

  // Vertical Y
  let grounded = false;
  const nextY = pos.y + vel.y * dt;
  if (!overlapsSolid(grid, pos.x, nextY, pos.z, halfW, height)) {
    pos.y = nextY;
  } else {
    if (vel.y < 0) {
      grounded = true;
      const footVy = Math.floor(nextY / VOXEL_SIZE);
      pos.y = (footVy + 1) * VOXEL_SIZE;
    }
    vel.y = 0;
  }

  if (pos.y < VOXEL_SIZE) {
    pos.y = VOXEL_SIZE;
    vel.y = 0;
    grounded = true;
  }

  return { grounded, inWater };
}
