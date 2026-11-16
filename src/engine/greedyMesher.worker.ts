import { MATERIAL_COLORS } from '../shared/types.ts';

interface MesherRequest {
  jobId: number;
  cx: number;
  cy: number;
  cz: number;
  chunkSize: number;
  voxelSize: number;
  // Padded (chunkSize + 2)^3 buffer so boundary faces & AO check neighbors in O(1)
  padded: Uint8Array;
}

const FACE_SHADE = [0.88, 0.78, 1.0, 0.56, 0.92, 0.74]; // +X, -X, +Y, -Y, +Z, -Z
const AO_CURVE = [1.0, 0.78, 0.58, 0.4];

function vertexAO(side1: boolean, side2: boolean, corner: boolean): number {
  if (side1 && side2) return 3;
  return (side1 ? 1 : 0) + (side2 ? 1 : 0) + (corner ? 1 : 0);
}

self.onmessage = (e: MessageEvent<MesherRequest>) => {
  const { jobId, cx, cy, cz, chunkSize, voxelSize, padded } = e.data;
  const pSize = chunkSize + 2;
  const get = (x: number, y: number, z: number): number =>
    padded[x + 1 + (z + 1) * pSize + (y + 1) * pSize * pSize];

  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const matIds: number[] = [];
  const indices: number[] = [];

  const dims = [chunkSize, chunkSize, chunkSize];
  const maskMat = new Uint16Array(chunkSize * chunkSize);
  const maskAO = new Uint16Array(chunkSize * chunkSize);

  const worldOriginX = cx * chunkSize * voxelSize;
  const worldOriginY = cy * chunkSize * voxelSize;
  const worldOriginZ = cz * chunkSize * voxelSize;

  // Sweep along each of the 3 axes, both positive and negative face directions
  for (let d = 0; d < 3; d++) {
    const u = (d + 1) % 3;
    const v = (d + 2) % 3;
    const x = [0, 0, 0];
    const q = [0, 0, 0];

    for (const dirSign of [1, -1]) {
      q[0] = 0;
      q[1] = 0;
      q[2] = 0;
      q[d] = dirSign;

      const faceIdx = d * 2 + (dirSign === 1 ? 0 : 1);
      const shade = FACE_SHADE[faceIdx];

      for (x[d] = 0; x[d] < dims[d]; x[d]++) {
        // Build mask for slice x[d]
        let n = 0;
        for (x[v] = 0; x[v] < dims[v]; x[v]++) {
          for (x[u] = 0; x[u] < dims[u]; x[u]++) {
            const mat = get(x[0], x[1], x[2]);
            const neighbor = get(x[0] + q[0], x[1] + q[1], x[2] + q[2]);

            if (mat !== 0 && neighbor === 0) {
              // Compute 4 corner AO values on the exposed face plane
              const fx = x[0] + q[0];
              const fy = x[1] + q[1];
              const fz = x[2] + q[2];

              const solidAt = (du: number, dv: number) => {
                const c = [fx, fy, fz];
                c[u] += du;
                c[v] += dv;
                return get(c[0], c[1], c[2]) !== 0;
              };

              const sNegU = solidAt(-1, 0);
              const sPosU = solidAt(1, 0);
              const sNegV = solidAt(0, -1);
              const sPosV = solidAt(0, 1);

              const ao00 = vertexAO(sNegU, sNegV, solidAt(-1, -1));
              const ao10 = vertexAO(sPosU, sNegV, solidAt(1, -1));
              const ao01 = vertexAO(sNegU, sPosV, solidAt(-1, 1));
              const ao11 = vertexAO(sPosU, sPosV, solidAt(1, 1));

              maskMat[n] = mat;
              maskAO[n] = ao00 | (ao10 << 2) | (ao01 << 4) | (ao11 << 6);
            } else {
              maskMat[n] = 0;
              maskAO[n] = 0;
            }
            n++;
          }
        }

        // Greedy merge faces with identical (mat, ao)
        n = 0;
        for (let j = 0; j < dims[v]; j++) {
          for (let i = 0; i < dims[u]; ) {
            const mat = maskMat[n];
            if (mat !== 0) {
              const aoPacked = maskAO[n];
              let w = 1;
              while (
                i + w < dims[u] &&
                maskMat[n + w] === mat &&
                maskAO[n + w] === aoPacked
              ) {
                w++;
              }

              let h = 1;
              outer: while (j + h < dims[v]) {
                for (let k = 0; k < w; k++) {
                  const idx = n + k + h * dims[u];
                  if (maskMat[idx] !== mat || maskAO[idx] !== aoPacked) {
                    break outer;
                  }
                }
                h++;
              }

              // Emit merged quad
              const planeOffset = dirSign === 1 ? x[d] + 1 : x[d];
              const p = [0, 0, 0];
              p[d] = planeOffset;
              p[u] = i;
              p[v] = j;

              const du = [0, 0, 0];
              du[u] = w;
              const dv = [0, 0, 0];
              dv[v] = h;

              const vBase = positions.length / 3;
              const corners = [
                [p[0], p[1], p[2]],
                [p[0] + du[0], p[1] + du[1], p[2] + du[2]],
                [p[0] + du[0] + dv[0], p[1] + du[1] + dv[1], p[2] + du[2] + dv[2]],
                [p[0] + dv[0], p[1] + dv[1], p[2] + dv[2]],
              ];

              const aoVals = [
                AO_CURVE[aoPacked & 3],
                AO_CURVE[(aoPacked >> 2) & 3],
                AO_CURVE[(aoPacked >> 6) & 3],
                AO_CURVE[(aoPacked >> 4) & 3],
              ];

              // MAT.CRYSTAL = 6, MAT.LAVA = 11, MAT.GOLD = 16
              const isGlowMat = mat === 6 || mat === 11;
              const isGoldMat = mat === 16;
              const isTopFace = d === 1 && dirSign === 1;
              const effShade = isGlowMat ? Math.max(0.96, shade) : shade;
              const rgb = MATERIAL_COLORS[mat] ?? [160, 160, 160];
              const warmR = isTopFace && !isGlowMat ? 1.04 : 1.0;
              const warmG = isTopFace && !isGlowMat ? 1.02 : 1.0;
              const coolB = !isTopFace && !isGlowMat ? 1.05 : 0.98;
              const boost = isGlowMat ? 1.32 : isGoldMat ? 1.15 : 1.0;
              const rBase = Math.min(1, (rgb[0] / 255) * effShade * warmR * boost);
              const gBase = Math.min(1, (rgb[1] / 255) * effShade * warmG * boost);
              const bBase = Math.min(1, (rgb[2] / 255) * effShade * coolB * boost);

              for (let cIdx = 0; cIdx < 4; cIdx++) {
                const c = corners[cIdx];
                positions.push(
                  worldOriginX + c[0] * voxelSize,
                  worldOriginY + c[1] * voxelSize,
                  worldOriginZ + c[2] * voxelSize,
                );
                normals.push(q[0], q[1], q[2]);
                matIds.push(mat);
                const ao = isGlowMat ? Math.max(0.92, aoVals[cIdx]) : aoVals[cIdx];
                colors.push(rBase * ao, gBase * ao, bBase * ao, 1);
              }

              // Winding order matched to Babylon.js left-handed CW front-facing rule
              if (dirSign === 1) {
                indices.push(vBase, vBase + 2, vBase + 1, vBase, vBase + 3, vBase + 2);
              } else {
                indices.push(vBase, vBase + 1, vBase + 2, vBase, vBase + 2, vBase + 3);
              }

              // Clear merged mask region
              for (let l = 0; l < h; l++) {
                for (let k = 0; k < w; k++) {
                  maskMat[n + k + l * dims[u]] = 0;
                }
              }

              i += w;
              n += w;
            } else {
              i++;
              n++;
            }
          }
        }
      }
    }
  }

  const posArr = new Float32Array(positions);
  const normArr = new Float32Array(normals);
  const colArr = new Float32Array(colors);
  const matArr = new Float32Array(matIds);
  const idxArr = new Uint32Array(indices);

  (self as unknown as Worker).postMessage(
    {
      jobId,
      cx,
      cy,
      cz,
      positions: posArr,
      normals: normArr,
      colors: colArr,
      matIds: matArr,
      indices: idxArr,
    },
    [posArr.buffer, normArr.buffer, colArr.buffer, matArr.buffer, idxArr.buffer],
  );
};
