import {
  Color3,
  Mesh,
  MeshBuilder,
  Scene,
  StandardMaterial,
  Texture,
  TransformNode,
  VertexData,
} from '@babylonjs/core';
import { decodeRleVoxels } from '../shared/budget.ts';
import type { PaletteColor } from '../shared/types.ts';
import type { WeaponModuleRecipe } from '../shared/weaponVisuals.ts';

function hexToRgb01(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  if (clean.length !== 6) return [0.3, 0.8, 1.0];
  const n = parseInt(clean, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/**
 * Acrescenta peças modulares (cano, mira, carregador, coronha) ao grid do
 * modelo-base. Só ocupa células vazias e nunca sai dos limites 12×12×24.
 */
export function applyWeaponModules(
  grid: Uint8Array,
  w: number,
  h: number,
  d: number,
  recipe: WeaponModuleRecipe,
): void {
  const at = (x: number, y: number, z: number): number => {
    if (x < 0 || x >= w || y < 0 || y >= h || z < 0 || z >= d) return 0;
    return grid[x + z * w + y * w * d];
  };
  const put = (x: number, y: number, z: number, color: number): void => {
    if (x < 0 || x >= w || y < 0 || y >= h || z < 0 || z >= d) return;
    const index = x + z * w + y * w * d;
    if (grid[index] === 0) grid[index] = Math.max(1, Math.min(255, color));
  };

  let minX = w;
  let maxX = -1;
  let minY = h;
  let maxY = -1;
  let minZ = d;
  let maxZ = -1;
  for (let y = 0; y < h; y++) {
    for (let z = 0; z < d; z++) {
      for (let x = 0; x < w; x++) {
        if (at(x, y, z) === 0) continue;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        if (z < minZ) minZ = z;
        if (z > maxZ) maxZ = z;
      }
    }
  }
  if (maxZ < 0) return;

  const findAtZ = (z: number): { x: number; y: number } | null => {
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        if (at(x, y, z) !== 0) return { x, y };
      }
    }
    return null;
  };

  const barrelAnchor = findAtZ(maxZ);
  if (barrelAnchor) {
    for (let step = 1; step <= recipe.barrel; step++) {
      put(barrelAnchor.x, barrelAnchor.y, maxZ + step, recipe.accent);
    }
  }

  const stockAnchor = findAtZ(minZ);
  if (stockAnchor) {
    for (let step = 1; step <= recipe.stock; step++) {
      put(stockAnchor.x, stockAnchor.y, minZ - step, recipe.accent);
    }
  }

  const midZ = Math.floor((minZ + maxZ) / 2);
  if (recipe.scope) {
    for (let y = maxY; y >= minY; y--) {
      const x = Array.from({ length: maxX - minX + 1 }, (_, i) => minX + i).find(
        (candidate) => at(candidate, y, midZ) !== 0,
      );
      if (x !== undefined) {
        put(x, y + 1, midZ, recipe.accent);
        break;
      }
    }
  }

  if (recipe.magazine > 0) {
    for (let y = minY; y <= maxY; y++) {
      const x = Array.from({ length: maxX - minX + 1 }, (_, i) => minX + i).find(
        (candidate) => at(candidate, y, midZ) !== 0,
      );
      if (x !== undefined) {
        for (let step = 1; step <= recipe.magazine; step++) {
          put(x, y - step, midZ, recipe.accent);
        }
        break;
      }
    }
  }
}

export function buildBlueprintVoxelMesh(
  scene: Scene,
  name: string,
  rleVoxels: number[],
  palette: PaletteColor[],
  w: number,
  h: number,
  d: number,
  voxelScale: number,
  pivot: [number, number, number],
  textureUrl?: string | null,
  modules?: WeaponModuleRecipe | null,
): Mesh {
  const grid = decodeRleVoxels(rleVoxels, w, h, d);
  if (modules) applyWeaponModules(grid, w, h, d, modules);
  const get = (x: number, y: number, z: number) => {
    if (x < 0 || x >= w || y < 0 || y >= h || z < 0 || z >= d) return 0;
    return grid[x + z * w + y * w * d];
  };

  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];

  const dirs: Array<{
    n: [number, number, number];
    verts: [number, number, number][];
    shade: number;
  }> = [
    {
      n: [1, 0, 0],
      verts: [
        [1, 0, 0],
        [1, 1, 0],
        [1, 1, 1],
        [1, 0, 1],
      ],
      shade: 0.88,
    },
    {
      n: [-1, 0, 0],
      verts: [
        [0, 0, 1],
        [0, 1, 1],
        [0, 1, 0],
        [0, 0, 0],
      ],
      shade: 0.82,
    },
    {
      n: [0, 1, 0],
      verts: [
        [0, 1, 0],
        [0, 1, 1],
        [1, 1, 1],
        [1, 1, 0],
      ],
      shade: 1.0,
    },
    {
      n: [0, -1, 0],
      verts: [
        [0, 0, 1],
        [0, 0, 0],
        [1, 0, 0],
        [1, 0, 1],
      ],
      shade: 0.65,
    },
    {
      n: [0, 0, 1],
      verts: [
        [1, 0, 1],
        [1, 1, 1],
        [0, 1, 1],
        [0, 0, 1],
      ],
      shade: 0.94,
    },
    {
      n: [0, 0, -1],
      verts: [
        [0, 0, 0],
        [0, 1, 0],
        [1, 1, 0],
        [1, 0, 0],
      ],
      shade: 0.78,
    },
  ];

  const ox = -pivot[0] * voxelScale;
  const oy = -pivot[1] * voxelScale;
  const oz = -pivot[2] * voxelScale;

  for (let y = 0; y < h; y++) {
    for (let z = 0; z < d; z++) {
      for (let x = 0; x < w; x++) {
        const cIdx = get(x, y, z);
        if (cIdx === 0) continue;
        const pal = palette[(cIdx - 1) % Math.max(1, palette.length)] ?? {
          hex: '#38bdf8',
          emissive: false,
        };
        const [r, g, b] = hexToRgb01(pal.hex);
        const boost = pal.emissive ? 1.45 : 1.0;

        for (const face of dirs) {
          if (get(x + face.n[0], y + face.n[1], z + face.n[2]) !== 0) continue;
          const vBase = positions.length / 3;
          for (const v of face.verts) {
            positions.push(
              ox + (x + v[0]) * voxelScale,
              oy + (y + v[1]) * voxelScale,
              oz + (z + v[2]) * voxelScale,
            );
            normals.push(face.n[0], face.n[1], face.n[2]);
            colors.push(
              Math.min(1, r * face.shade * boost),
              Math.min(1, g * face.shade * boost),
              Math.min(1, b * face.shade * boost),
              1,
            );
          }
          indices.push(vBase, vBase + 2, vBase + 1, vBase, vBase + 3, vBase + 2);
        }
      }
    }
  }

  const mesh = new Mesh(name, scene);
  const vData = new VertexData();
  vData.positions = positions;
  vData.normals = normals;
  vData.colors = colors;
  vData.indices = indices;
  vData.applyToMesh(mesh);

  const mat = new StandardMaterial(`${name}_mat`, scene);
  mat.specularColor = new Color3(0.15, 0.15, 0.18);
  mat.emissiveColor = new Color3(0.08, 0.08, 0.1);
  if (textureUrl) {
    const texture = new Texture(textureUrl, scene);
    texture.hasAlpha = false;
    mat.diffuseTexture = texture;
    mat.diffuseColor = Color3.White();
  }
  mesh.material = mat;
  mesh.hasVertexAlpha = false;
  return mesh;
}

export function buildStarterToolMesh(
  scene: Scene,
  kind: 'shovel' | 'grapple',
  name: string,
): TransformNode {
  const root = new TransformNode(name, scene);

  if (kind === 'shovel') {
    const woodMat = new StandardMaterial(`${name}_wood`, scene);
    woodMat.diffuseColor = Color3.FromHexString('#8b5a2b');
    woodMat.specularColor = new Color3(0.05, 0.05, 0.05);

    const steelMat = new StandardMaterial(`${name}_steel`, scene);
    steelMat.diffuseColor = Color3.FromHexString('#cbd5e1');
    steelMat.specularColor = new Color3(0.4, 0.45, 0.5);

    const shaft = MeshBuilder.CreateBox(`${name}_shaft`, { width: 0.045, height: 0.045, depth: 0.55 }, scene);
    shaft.position.set(0, 0, 0.28);
    shaft.material = woodMat;
    shaft.parent = root;

    const collar = MeshBuilder.CreateBox(`${name}_collar`, { width: 0.075, height: 0.06, depth: 0.08 }, scene);
    collar.position.set(0, -0.005, 0.52);
    collar.material = steelMat;
    collar.parent = root;

    const blade = MeshBuilder.CreateBox(`${name}_blade`, { width: 0.19, height: 0.03, depth: 0.2 }, scene);
    blade.position.set(0, -0.02, 0.62);
    blade.rotation.x = 0.22;
    blade.material = steelMat;
    blade.parent = root;

    const tip = MeshBuilder.CreateBox(`${name}_tip`, { width: 0.13, height: 0.026, depth: 0.06 }, scene);
    tip.position.set(0, -0.038, 0.72);
    tip.rotation.x = 0.22;
    tip.material = steelMat;
    tip.parent = root;

    const grip = MeshBuilder.CreateBox(`${name}_grip`, { width: 0.12, height: 0.04, depth: 0.045 }, scene);
    grip.position.set(0, 0.01, 0.02);
    grip.material = steelMat;
    grip.parent = root;
  } else {
    const bodyMat = new StandardMaterial(`${name}_body`, scene);
    bodyMat.diffuseColor = Color3.FromHexString('#1e293b');

    const cyanMat = new StandardMaterial(`${name}_cyan`, scene);
    cyanMat.diffuseColor = Color3.FromHexString('#06b6d4');
    cyanMat.emissiveColor = Color3.FromHexString('#0891b2');

    const receiver = MeshBuilder.CreateBox(`${name}_rec`, { width: 0.1, height: 0.12, depth: 0.32 }, scene);
    receiver.position.set(0, 0.01, 0.2);
    receiver.material = bodyMat;
    receiver.parent = root;

    const core = MeshBuilder.CreateBox(`${name}_core`, { width: 0.055, height: 0.055, depth: 0.16 }, scene);
    core.position.set(0, 0.065, 0.22);
    core.material = cyanMat;
    core.parent = root;

    const clawL = MeshBuilder.CreateBox(`${name}_cl`, { width: 0.045, height: 0.045, depth: 0.18 }, scene);
    clawL.position.set(-0.06, 0.02, 0.38);
    clawL.rotation.y = -0.35;
    clawL.material = cyanMat;
    clawL.parent = root;

    const clawR = MeshBuilder.CreateBox(`${name}_cr`, { width: 0.045, height: 0.045, depth: 0.18 }, scene);
    clawR.position.set(0.06, 0.02, 0.38);
    clawR.rotation.y = 0.35;
    clawR.material = cyanMat;
    clawR.parent = root;
  }

  return root;
}

export interface PlayerAvatarRig {
  root: TransformNode;
  bodyGroup: TransformNode;
  head: Mesh;
  handSocket: TransformNode;
  leftLeg: Mesh;
  rightLeg: Mesh;
  primaryMat: StandardMaterial;
  baseColor: Color3;
  dispose: () => void;
}

export function buildPlayerAvatarMesh(
  scene: Scene,
  id: string,
  colorHex: string,
): PlayerAvatarRig {
  const root = new TransformNode(`avatar_${id}`, scene);
  const bodyGroup = new TransformNode(`avatar_body_${id}`, scene);
  bodyGroup.parent = root;

  const baseColor = Color3.FromHexString(colorHex);
  const primaryMat = new StandardMaterial(`pmat_${id}`, scene);
  primaryMat.diffuseColor = baseColor.clone();
  primaryMat.specularColor = new Color3(0.15, 0.15, 0.15);

  const darkMat = new StandardMaterial(`dmat_${id}`, scene);
  darkMat.diffuseColor = Color3.FromHexString('#1e293b');
  darkMat.specularColor = new Color3(0.1, 0.1, 0.1);

  const packMat = new StandardMaterial(`pkmat_${id}`, scene);
  packMat.diffuseColor = Color3.FromHexString('#334155');
  packMat.specularColor = new Color3(0.12, 0.12, 0.12);

  const visorMat = new StandardMaterial(`vmat_${id}`, scene);
  visorMat.diffuseColor = Color3.FromHexString('#e2e8f0');
  visorMat.emissiveColor = new Color3(0.25, 0.65, 0.85);

  const torso = MeshBuilder.CreateBox(`torso_${id}`, { width: 0.56, height: 0.66, depth: 0.32 }, scene);
  torso.position.set(0, 0.92, 0);
  torso.material = primaryMat;
  torso.parent = bodyGroup;

  // Tactical voxel backpack
  const pack = MeshBuilder.CreateBox(`pack_${id}`, { width: 0.38, height: 0.44, depth: 0.16 }, scene);
  pack.position.set(0, 0.94, -0.24);
  pack.material = packMat;
  pack.parent = bodyGroup;

  // Shoulder pauldrons for clearer combat silhouette
  const pauldronL = MeshBuilder.CreateBox(`paulL_${id}`, { width: 0.22, height: 0.14, depth: 0.26 }, scene);
  pauldronL.position.set(-0.38, 1.18, 0);
  pauldronL.material = primaryMat;
  pauldronL.parent = bodyGroup;

  const pauldronR = MeshBuilder.CreateBox(`paulR_${id}`, { width: 0.22, height: 0.14, depth: 0.26 }, scene);
  pauldronR.position.set(0.38, 1.18, 0);
  pauldronR.material = primaryMat;
  pauldronR.parent = bodyGroup;

  const head = MeshBuilder.CreateBox(`head_${id}`, { width: 0.44, height: 0.44, depth: 0.44 }, scene);
  head.position.set(0, 1.48, 0);
  head.material = primaryMat;
  head.parent = bodyGroup;

  const visor = MeshBuilder.CreateBox(`visor_${id}`, { width: 0.34, height: 0.14, depth: 0.08 }, scene);
  visor.position.set(0, 0.04, 0.21);
  visor.material = visorMat;
  visor.parent = head;

  const leftArm = MeshBuilder.CreateBox(`larm_${id}`, { width: 0.18, height: 0.58, depth: 0.18 }, scene);
  leftArm.position.set(-0.38, 0.92, 0);
  leftArm.material = darkMat;
  leftArm.parent = bodyGroup;

  const rightArm = MeshBuilder.CreateBox(`rarm_${id}`, { width: 0.18, height: 0.58, depth: 0.18 }, scene);
  rightArm.position.set(0.38, 0.92, 0.12);
  rightArm.rotation.x = -0.8;
  rightArm.material = darkMat;
  rightArm.parent = bodyGroup;

  const handSocket = new TransformNode(`hand_${id}`, scene);
  handSocket.parent = rightArm;
  handSocket.position.set(0, -0.26, 0.08);
  handSocket.rotation.x = 0.8;

  const leftLeg = MeshBuilder.CreateBox(`lleg_${id}`, { width: 0.22, height: 0.58, depth: 0.22 }, scene);
  leftLeg.position.set(-0.15, 0.29, 0);
  leftLeg.material = darkMat;
  leftLeg.parent = bodyGroup;

  const rightLeg = MeshBuilder.CreateBox(`rleg_${id}`, { width: 0.22, height: 0.58, depth: 0.22 }, scene);
  rightLeg.position.set(0.15, 0.29, 0);
  rightLeg.material = darkMat;
  rightLeg.parent = bodyGroup;

  const belt = MeshBuilder.CreateBox(`belt_${id}`, { width: 0.58, height: 0.1, depth: 0.34 }, scene);
  belt.position.set(0, 0.62, 0);
  belt.material = packMat;
  belt.parent = bodyGroup;

  const shadowDisc = MeshBuilder.CreateDisc(`shadow_${id}`, { radius: 0.44, tessellation: 12 }, scene);
  shadowDisc.rotation.x = Math.PI / 2;
  shadowDisc.position.set(0, 0.03, 0);
  const shadowMat = new StandardMaterial(`smat_${id}`, scene);
  shadowMat.diffuseColor = Color3.Black();
  shadowMat.specularColor = Color3.Black();
  shadowMat.alpha = 0.36;
  shadowMat.disableLighting = true;
  shadowDisc.material = shadowMat;
  shadowDisc.isPickable = false;
  shadowDisc.parent = bodyGroup;

  return {
    root,
    bodyGroup,
    head,
    handSocket,
    leftLeg,
    rightLeg,
    primaryMat,
    baseColor,
    dispose: () => {
      root.dispose(false, true);
    },
  };
}

export interface GrassTuftOptions {
  height?: number;
  width?: number;
}

/**
 * Tufo de grama: duas lâminas cruzadas com gradiente escuro→claro na base dos
 * vértices. Pensado para ThinInstance (uma malha, centenas de instâncias) e
 * sem textura. A cor por instância entra pelo buffer `color`.
 */
export function buildGrassTuftMesh(
  scene: Scene,
  name = 'grassTuft',
  options: GrassTuftOptions = {},
): Mesh {
  const height = options.height ?? 0.46;
  const half = (options.width ?? 0.28) / 2;
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];

  const pushQuad = (
    ax: number,
    az: number,
    bx: number,
    bz: number,
    nx: number,
    ny: number,
    nz: number,
  ): void => {
    const base = positions.length / 3;
    positions.push(
      ax, 0, az,
      bx, 0, bz,
      bx, height, bz,
      ax, height, az,
    );
    for (let i = 0; i < 4; i++) normals.push(nx, ny, nz);
    colors.push(
      0.58, 0.58, 0.58, 1,
      0.58, 0.58, 0.58, 1,
      1, 1, 1, 1,
      1, 1, 1, 1,
    );
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };

  // Lâmina no plano XY e outra no plano ZY, com normais levemente para cima
  // para pegar sol/hemisférica em vez de ficarem pretas de lado.
  pushQuad(-half, 0, half, 0, 0, 0.94, 0.34);
  pushQuad(0, -half, 0, half, 0.34, 0.94, 0);

  const mesh = new Mesh(name, scene);
  const vData = new VertexData();
  vData.positions = positions;
  vData.normals = normals;
  vData.colors = colors;
  vData.indices = indices;
  vData.applyToMesh(mesh);
  mesh.isPickable = false;
  mesh.hasVertexAlpha = false;
  return mesh;
}
