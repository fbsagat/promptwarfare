import type {
  EntityAiBehavior,
  EventArchetype,
  EventParams,
  InventorySlotItem,
  PaletteColor,
  ProjectileBehavior,
  SelfRiskFlag,
  StatusEffect,
  WeaponAllocation,
  WeaponBlueprint,
  WeaponModifiers,
  WeaponStats,
} from './types.ts';

export const WEAPON_POINT_BUDGET = 100;
export const EVENT_POINT_BUDGET = 100;
export const WEAPON_INITIAL_COOLDOWN_SEC = 10;
export const WEAPON_CYCLE_COOLDOWN_SEC = 30;
export const EVENT_CYCLE_COOLDOWN_SEC = 24;

export const BASE_PLAYER_MASS_KG = 70;
export const SHOVEL_MASS_KG = 3;
export const GRAPPLE_MASS_KG = 4;

export const DEFAULT_WEAPON_ALLOCATION: WeaponAllocation = {
  firepower: 35,
  cadence: 25,
  precision: 20,
  destruction: 20,
};

export function normalizeWeaponAllocation(
  raw?: Partial<WeaponAllocation> | null,
): WeaponAllocation {
  if (!raw) return { ...DEFAULT_WEAPON_ALLOCATION };
  const fp = Math.max(5, Number(raw.firepower) || 0);
  const cd = Math.max(5, Number(raw.cadence) || 0);
  const pr = Math.max(5, Number(raw.precision) || 0);
  const ds = Math.max(0, Number(raw.destruction) || 0);
  const sum = fp + cd + pr + ds;
  if (sum <= 0) return { ...DEFAULT_WEAPON_ALLOCATION };

  const firepower = Math.round((fp / sum) * 100);
  const cadence = Math.round((cd / sum) * 100);
  const precision = Math.round((pr / sum) * 100);
  const destruction = Math.max(0, 100 - firepower - cadence - precision);
  return { firepower, cadence, precision, destruction };
}

export interface WeaponPointBreakdown {
  firepowerPts: number;
  cadencePts: number;
  precisionPts: number;
  destructionPts: number;
  massOffsetPts: number;
  totalPts: number;
}

export function computeWeaponPointBreakdown(
  stats: WeaponStats,
  mods: WeaponModifiers,
): WeaponPointBreakdown {
  const effectiveVolleyDmg = stats.damage * (1 + Math.max(0, stats.projectiles - 1) * 0.65);
  const effectiveDps = effectiveVolleyDmg * Math.min(stats.fireRate, 8);
  const firepowerPts = Math.round((effectiveVolleyDmg * 0.72 + effectiveDps * 0.34) * 10) / 10;
  const cadencePts =
    Math.round((stats.fireRate * 1.4 + stats.ammoMax * 0.35 + stats.cooling * 1.1) * 10) / 10;
  const precisionPts =
    Math.round(
      (Math.max(0, 22 - stats.spreadDeg) * 0.55 + Math.max(0, stats.rangeMeters - 15) * 0.14) *
        10,
    ) / 10;
  const destructionPts =
    Math.round(
      (mods.voxelCraterRadius * 5.0 +
        (mods.statusEffect !== 'none' ? 5.5 : 0) +
        (mods.projectileBehavior !== 'standard' ? 4.5 : 0)) *
        10,
    ) / 10;
  const massOffsetPts = Math.round(-(stats.massKg - 4) * 0.45 * 10) / 10;
  const totalPts = Math.max(
    1,
    Math.round((firepowerPts + cadencePts + precisionPts + destructionPts + massOffsetPts) * 10) / 10,
  );
  return {
    firepowerPts,
    cadencePts,
    precisionPts,
    destructionPts,
    massOffsetPts,
    totalPts,
  };
}

export function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

export function computeIslandDimensions(playerCount: number): {
  dimX: number;
  dimY: number;
  dimZ: number;
} {
  const clamped = clamp(Math.round(playerCount), 4, 14);
  const t = (clamped - 4) / 10; // 0..1
  // High-res 0.3125m voxels (5m per chunk):
  // 4 players -> 384x80x384 (120x120m); 6 players -> 448x96x448 (140x140m); 14 players -> 672x112x672 (210x210m)
  const horizontalChunks = Math.round(24 + t * 18); // 24..42 chunks
  const horizontal = horizontalChunks * 16; // 384..672
  const dimY = clamped >= 12 ? 112 : clamped >= 6 ? 96 : 80;
  return { dimX: horizontal, dimY, dimZ: horizontal };
}

export function computeWeaponPoints(stats: WeaponStats, mods: WeaponModifiers): number {
  return computeWeaponPointBreakdown(stats, mods).totalPts;
}

const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?(previous|prior|above)/i,
  /9999/,
  /instakill|one[- ]?shot|kill\s+all|mata\s+todo|mate\s+todos/i,
  /infinite|infinit[ao]/i,
  /god\s*mode|imortal|invenc[ií]vel/i,
];

export function hasSuspiciousPrompt(prompt: string): boolean {
  return INJECTION_PATTERNS.some((rx) => rx.test(prompt));
}

export function applyWeaponAllocationToStats(
  stats: WeaponStats,
  mods: WeaponModifiers,
  allocation: WeaponAllocation,
): void {
  const alloc = normalizeWeaponAllocation(allocation);
  // Distribute 100 points across the 4 player-chosen attribute buckets cleanly within 100-pt budget
  const fpRatio = alloc.firepower / 100; // 0.05..0.75
  const cdRatio = alloc.cadence / 100;
  const prRatio = alloc.precision / 100;
  const dsRatio = alloc.destruction / 100;

  // Cadence governs fire rate, ammo pool, and cooling
  stats.fireRate = Math.round(clamp(0.8 + cdRatio * 9.0, 0.7, 7.0) * 10) / 10;
  stats.ammoMax = Math.round(clamp(10 + cdRatio * 54, 10, 52));
  stats.cooling = Math.round(clamp(2 + cdRatio * 10, 2, 10));

  // Firepower governs single-shot damage / pellets (balancing high fire-rate DPS cleanly)
  if (stats.projectiles > 1) {
    stats.projectiles = Math.round(clamp(2 + fpRatio * 7, 2, 6));
    const maxPerPellet = Math.max(5, Math.round((12 + fpRatio * 28 - cdRatio * 4) / (1 + (stats.projectiles - 1) * 0.65)));
    stats.damage = Math.round(clamp(maxPerPellet, 5, 16));
  } else {
    stats.damage = Math.round(clamp(9 + fpRatio * 48 - cdRatio * 6, 6, 42));
  }

  // Precision governs spread & range
  stats.spreadDeg = Math.round(clamp(15 - prRatio * 24, 1, 15) * 10) / 10;
  stats.rangeMeters = Math.round(clamp(32 + prRatio * 130, 28, 120));

  // Destruction governs crater size and adds realistic weight
  mods.voxelCraterRadius = Math.round(clamp(dsRatio * 7.5, 0, 4));
  stats.massKg = Math.round(clamp(4 + dsRatio * 15 + fpRatio * 8, 4, 24));

  // Fine-tune honest 100-pt allocation to sit cleanly <= 98 pts without triggering overheat self-risk
  let guard = 0;
  while (computeWeaponPoints(stats, mods) > WEAPON_POINT_BUDGET - 2 && guard++ < 25) {
    if (stats.fireRate > 1.8 && cdRatio < fpRatio) {
      stats.fireRate = Math.max(1.0, Math.round((stats.fireRate - 0.3) * 10) / 10);
    } else if (stats.damage > 6) {
      stats.damage = Math.max(5, stats.damage - 1);
    } else if (stats.fireRate > 1.0) {
      stats.fireRate = Math.max(0.8, Math.round((stats.fireRate - 0.3) * 10) / 10);
    } else if (stats.ammoMax > 10) {
      stats.ammoMax = Math.max(10, stats.ammoMax - 3);
    } else {
      break;
    }
  }
}

export function validateAndClampWeapon(
  raw: Partial<WeaponBlueprint> & {
    stats?: Partial<WeaponStats>;
    modifiers?: Partial<WeaponModifiers>;
  },
  prompt: string,
  allocation?: Partial<WeaponAllocation>,
): WeaponBlueprint {
  const suspicious = hasSuspiciousPrompt(prompt);

  const stats: WeaponStats = {
    damage: Math.round(clamp(raw.stats?.damage ?? 20, 5, 45)),
    fireRate: Math.round(clamp(raw.stats?.fireRate ?? 2.2, 0.5, 8) * 10) / 10,
    projectiles: Math.round(clamp(raw.stats?.projectiles ?? 1, 1, 8)),
    spreadDeg: Math.round(clamp(raw.stats?.spreadDeg ?? 6, 1, 25) * 10) / 10,
    rangeMeters: Math.round(clamp(raw.stats?.rangeMeters ?? 65, 20, 120)),
    ammoMax: Math.round(clamp(raw.stats?.ammoMax ?? 24, 6, 60)),
    cooling: Math.round(clamp(raw.stats?.cooling ?? 5, 1, 10)),
    massKg: Math.round(clamp(raw.stats?.massKg ?? 8, 2, 24)),
  };

  const validBehaviors: ProjectileBehavior[] = [
    'standard',
    'bouncing',
    'homing_weak',
    'sticky_bomb',
    'piercing',
  ];
  const validEffects: StatusEffect[] = [
    'none',
    'knockback',
    'burn',
    'freeze',
    'gravity_pull',
  ];

  const modifiers: WeaponModifiers = {
    voxelCraterRadius: Math.round(clamp(raw.modifiers?.voxelCraterRadius ?? 1, 0, 4)),
    projectileBehavior: validBehaviors.includes(raw.modifiers?.projectileBehavior as ProjectileBehavior)
      ? (raw.modifiers?.projectileBehavior as ProjectileBehavior)
      : 'standard',
    statusEffect: validEffects.includes(raw.modifiers?.statusEffect as StatusEffect)
      ? (raw.modifiers?.statusEffect as StatusEffect)
      : 'none',
  };

  const normalizedAlloc = allocation ? normalizeWeaponAllocation(allocation) : undefined;
  if (normalizedAlloc) {
    applyWeaponAllocationToStats(stats, modifiers, normalizedAlloc);
  }

  // Hard anti-one-shot cap: total direct volley max ~46 dmg regardless of pellet count
  const maxDirectVolley = stats.damage * stats.projectiles;
  if (maxDirectVolley > 48) {
    stats.damage = Math.max(5, Math.floor(48 / stats.projectiles));
  }

  const selfRiskSet = new Set<SelfRiskFlag>(
    (raw.selfRisk ?? []).filter((r): r is SelfRiskFlag =>
      r === 'recoil_launch' || r === 'overheat_explosion' || r === 'toxic_leak',
    ),
  );

  let budgetUsed = computeWeaponPoints(stats, modifiers);
  let wasClamped = false;

  if (budgetUsed > WEAPON_POINT_BUDGET || suspicious) {
    wasClamped = true;
    const scale = budgetUsed > WEAPON_POINT_BUDGET ? WEAPON_POINT_BUDGET / budgetUsed : 0.85;
    stats.damage = Math.max(5, Math.round(stats.damage * Math.sqrt(scale)));
    stats.fireRate = Math.max(0.5, Math.round(stats.fireRate * Math.sqrt(scale) * 10) / 10);
    stats.projectiles = Math.max(1, Math.round(1 + (stats.projectiles - 1) * scale));
    stats.ammoMax = Math.max(6, Math.round(stats.ammoMax * scale));
    stats.rangeMeters = Math.max(20, Math.round(stats.rangeMeters * Math.max(scale, 0.65)));
    stats.cooling = Math.max(1, Math.round(stats.cooling * Math.max(scale, 0.6)));
    modifiers.voxelCraterRadius = Math.min(modifiers.voxelCraterRadius, 3);
    stats.massKg = clamp(stats.massKg + 4, 2, 24);
    if (suspicious || scale < 0.78) {
      selfRiskSet.add('overheat_explosion');
    }
    if (suspicious || scale < 0.68) {
      selfRiskSet.add('recoil_launch');
    }
    budgetUsed = computeWeaponPoints(stats, modifiers);
  }

  // Secondary safety loop guaranteeing <= 100 points across every attribute
  let guard = 0;
  while (budgetUsed > WEAPON_POINT_BUDGET && guard++ < 40) {
    wasClamped = true;
    if (stats.damage > 6 && stats.fireRate > 1.2) {
      stats.damage = Math.max(5, stats.damage - 2);
      stats.fireRate = Math.max(0.5, Math.round((stats.fireRate - 0.3) * 10) / 10);
    } else if (stats.damage > 5) {
      stats.damage = Math.max(5, stats.damage - 2);
    } else if (stats.projectiles > 1) {
      stats.projectiles -= 1;
    } else if (stats.ammoMax > 6) {
      stats.ammoMax = Math.max(6, stats.ammoMax - 4);
    } else if (modifiers.voxelCraterRadius > 0) {
      modifiers.voxelCraterRadius -= 1;
    } else if (stats.cooling > 1) {
      stats.cooling -= 1;
    } else if (stats.spreadDeg < 22) {
      stats.spreadDeg = Math.min(22, stats.spreadDeg + 3);
    } else {
      break;
    }
    budgetUsed = computeWeaponPoints(stats, modifiers);
  }

  const palette = normalizePalette(raw.palette, [
    { hex: '#38bdf8', emissive: true },
    { hex: '#334155', emissive: false },
    { hex: '#94a3b8', emissive: false },
    { hex: '#f59e0b', emissive: true },
  ]);

  const expectedVoxelCount = 12 * 12 * 24;
  const decoded = decodeRleVoxels(raw.rleVoxels ?? [], 12, 12, 24);
  let nonEmpty = 0;
  for (let i = 0; i < decoded.length; i++) {
    if (decoded[i] > 0) nonEmpty++;
  }
  const finalRle =
    nonEmpty >= 16
      ? encodeRleVoxels(decoded)
      : encodeRleVoxels(buildFallbackWeaponVoxels(prompt, palette.length));

  if (finalRle.length === 0) {
    const fb = buildFallbackWeaponVoxels(prompt, palette.length);
    return {
      id: raw.id ?? `wpn_${Date.now()}`,
      name: (raw.name || prompt.slice(0, 28) || 'Arma Experimental').trim(),
      prompt: prompt.slice(0, 90),
      stats,
      modifiers,
      selfRisk: Array.from(selfRiskSet),
      budgetUsed: Math.min(WEAPON_POINT_BUDGET, budgetUsed),
      wasClamped,
      palette,
      rleVoxels: encodeRleVoxels(fb).slice(0, expectedVoxelCount * 2),
      gripPos: clampVec3Tuple(raw.gripPos, [6, 3, 6], [11, 11, 23]),
      muzzlePos: clampVec3Tuple(raw.muzzlePos, [6, 7, 22], [11, 11, 23]),
      allocation: normalizedAlloc,
    };
  }

  return {
    id: raw.id ?? `wpn_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    name: (raw.name || prompt.slice(0, 28) || 'Arma Experimental').trim(),
    prompt: prompt.slice(0, 90),
    stats,
    modifiers,
    selfRisk: Array.from(selfRiskSet),
    budgetUsed,
    wasClamped,
    palette,
    rleVoxels: finalRle,
    gripPos: clampVec3Tuple(raw.gripPos, [6, 3, 6], [11, 11, 23]),
    muzzlePos: clampVec3Tuple(raw.muzzlePos, [6, 7, 22], [11, 11, 23]),
    allocation: normalizedAlloc,
  };
}

export function computeEventPoints(params: EventParams, archetype: EventArchetype): number {
  const radiusPts = params.radiusMeters * 0.9;
  const durPts = params.durationSec * 0.45;
  const lethPts = params.lethality * 1.1;
  const qtyPts =
    archetype === 'ENTITY_SPAWN' || archetype === 'SUPPLY_DROP'
      ? params.quantity * 3.5
      : 0;
  return Math.round((radiusPts + durPts + lethPts + qtyPts) * 10) / 10;
}

export function validateAndClampEventParams(
  archetype: EventArchetype,
  raw: Partial<EventParams>,
  prompt: string,
): { params: EventParams; budgetUsed: number; wasClamped: boolean } {
  const suspicious = hasSuspiciousPrompt(prompt);
  const validBehaviors: EntityAiBehavior[] = [
    'aggressive_nearest',
    'territorial',
    'fleeing',
    'explosive_kamikaze',
    'static_pickup',
  ];

  const params: EventParams = {
    radiusMeters: Math.round(clamp(raw.radiusMeters ?? 18, 6, 45)),
    durationSec: Math.round(clamp(raw.durationSec ?? 30, 15, 90)),
    lethality: Math.round(clamp(raw.lethality ?? 18, 5, 45)),
    quantity: Math.round(clamp(raw.quantity ?? 4, 1, 14)),
    weatherKind: raw.weatherKind,
    mutationKind: raw.mutationKind,
    aiBehavior: validBehaviors.includes(raw.aiBehavior as EntityAiBehavior)
      ? (raw.aiBehavior as EntityAiBehavior)
      : archetype === 'SUPPLY_DROP'
        ? 'static_pickup'
        : 'aggressive_nearest',
    ammoRestore: Math.round(clamp(raw.ammoRestore ?? 28, 10, 60)),
  };

  let budgetUsed = computeEventPoints(params, archetype);
  let wasClamped = false;
  if (budgetUsed > EVENT_POINT_BUDGET || suspicious) {
    wasClamped = true;
    const scale = budgetUsed > EVENT_POINT_BUDGET ? EVENT_POINT_BUDGET / budgetUsed : 0.78;
    params.radiusMeters = Math.max(6, Math.round(params.radiusMeters * scale));
    params.durationSec = Math.max(15, Math.round(params.durationSec * scale));
    params.lethality = Math.max(5, Math.round(params.lethality * scale));
    params.quantity = Math.max(1, Math.round(params.quantity * scale));
    budgetUsed = computeEventPoints(params, archetype);
  }

  while (budgetUsed > EVENT_POINT_BUDGET && (params.lethality > 5 || params.radiusMeters > 6 || params.durationSec > 15)) {
    wasClamped = true;
    if (params.lethality > 5) params.lethality -= 1;
    else if (params.radiusMeters > 6) params.radiusMeters -= 1;
    else if (params.durationSec > 15) params.durationSec -= 2;
    budgetUsed = computeEventPoints(params, archetype);
  }

  return { params, budgetUsed, wasClamped };
}

function clampVec3Tuple(
  input: [number, number, number] | undefined,
  fallback: [number, number, number],
  max: [number, number, number],
): [number, number, number] {
  if (!Array.isArray(input) || input.length !== 3) return fallback;
  return [
    Math.round(clamp(input[0], 0, max[0])),
    Math.round(clamp(input[1], 0, max[1])),
    Math.round(clamp(input[2], 0, max[2])),
  ];
}

export function normalizePalette(
  raw: PaletteColor[] | undefined,
  defaults: PaletteColor[],
): PaletteColor[] {
  const source = Array.isArray(raw) && raw.length > 0 ? raw : defaults;
  return source.slice(0, 6).map((c) => ({
    hex: /^#[0-9a-fA-F]{6}$/.test(c?.hex ?? '') ? c.hex : '#38bdf8',
    emissive: Boolean(c?.emissive),
  }));
}

export function decodeRleVoxels(
  rle: number[],
  w: number,
  h: number,
  d: number,
): Uint8Array {
  const total = w * h * d;
  const out = new Uint8Array(total);
  let cursor = 0;
  for (let i = 0; i + 1 < rle.length && cursor < total; i += 2) {
    const colorIdx = clamp(Math.round(rle[i]), 0, 6);
    const count = clamp(Math.round(rle[i + 1]), 0, total - cursor);
    if (count > 0 && colorIdx > 0) {
      out.fill(colorIdx, cursor, cursor + count);
    }
    cursor += count;
  }
  return out;
}

export function encodeRleVoxels(voxels: Uint8Array): number[] {
  const out: number[] = [];
  if (voxels.length === 0) return out;
  let curr = voxels[0];
  let count = 1;
  for (let i = 1; i < voxels.length; i++) {
    if (voxels[i] === curr) {
      count++;
    } else {
      out.push(curr, count);
      curr = voxels[i];
      count = 1;
    }
  }
  out.push(curr, count);
  return out;
}

export function buildFallbackWeaponVoxels(prompt: string, paletteLen: number): Uint8Array {
  const w = 12;
  const h = 12;
  const d = 24;
  const v = new Uint8Array(w * h * d);
  const idx = (x: number, y: number, z: number) => x + z * w + y * w * d;
  const accentColor = Math.min(1, paletteLen);
  const bodyColor = Math.min(2, paletteLen);
  const trimColor = Math.min(3, paletteLen);
  const coreColor = Math.min(4, paletteLen);

  const lower = prompt.toLowerCase();
  const isHeavy = /bazuca|canh[aã]o|lan[çc]ador|rocket|m[ií]ssil|meteoro/i.test(lower);
  const isShotgun = /escopeta|shotgun|estilha|leque/i.test(lower);
  const isSniper = /sniper|lazer|laser|feixe|precis/i.test(lower);
  const isCompact = /pistola|sub|smg|compact|mini/i.test(lower);
  const isExotic = /cristal|vazio|buraco|gravidade|s[oô]nic|tesla|arco/i.test(lower);

  // Ergonomic grip
  for (let y = 1; y <= 4; y++) {
    for (let z = 4; z <= 6; z++) {
      for (let x = 5; x <= 6; x++) {
        v[idx(x, y, z)] = bodyColor;
      }
    }
  }

  if (isExotic) {
    // Twin floating energy prongs + glowing core reactor
    for (let y = 5; y <= 8; y++) {
      for (let z = 3; z <= 13; z++) {
        for (let x = 4; x <= 7; x++) {
          v[idx(x, y, z)] = z % 3 === 0 ? trimColor : bodyColor;
        }
      }
    }
    for (let z = 9; z <= 21; z++) {
      v[idx(3, 6, z)] = trimColor;
      v[idx(8, 6, z)] = trimColor;
      if (z % 2 === 1) {
        v[idx(5, 6, z)] = accentColor;
        v[idx(6, 7, z)] = coreColor;
      }
    }
    v[idx(2, 7, 15)] = accentColor;
    v[idx(9, 7, 15)] = accentColor;
    return v;
  }

  if (isHeavy) {
    // Broad shoulder launcher tube + flared muzzle ring
    for (let y = 4; y <= 9; y++) {
      for (let z = 2; z <= 19; z++) {
        for (let x = 3; x <= 8; x++) {
          const shell = x === 3 || x === 8 || y === 4 || y === 9;
          if (!shell && z > 15) continue;
          v[idx(x, y, z)] = z % 5 === 0 ? trimColor : bodyColor;
        }
      }
    }
    for (let x = 3; x <= 8; x++) {
      v[idx(x, 4, 20)] = accentColor;
      v[idx(x, 9, 20)] = accentColor;
    }
    for (let z = 6; z <= 16; z += 2) {
      v[idx(5, 9, z)] = coreColor;
      v[idx(6, 9, z)] = coreColor;
    }
    return v;
  }

  if (isShotgun) {
    // Wide receiver + twin barrels + underbarrel pump
    for (let y = 5; y <= 8; y++) {
      for (let z = 2; z <= 12; z++) {
        for (let x = 4; x <= 7; x++) {
          v[idx(x, y, z)] = bodyColor;
        }
      }
    }
    for (let z = 12; z <= 21; z++) {
      v[idx(4, 7, z)] = trimColor;
      v[idx(7, 7, z)] = trimColor;
      if (z <= 17) {
        v[idx(5, 5, z)] = accentColor;
        v[idx(6, 5, z)] = accentColor;
      }
    }
    return v;
  }

  if (isCompact) {
    // Sleek pistol / SMG with extended lower magazine
    for (let y = 5; y <= 7; y++) {
      for (let z = 4; z <= 14; z++) {
        for (let x = 4; x <= 7; x++) {
          v[idx(x, y, z)] = z >= 12 ? trimColor : bodyColor;
        }
      }
    }
    for (let y = 2; y <= 4; y++) {
      for (let z = 9; z <= 11; z++) {
        v[idx(5, y, z)] = accentColor;
        v[idx(6, y, z)] = accentColor;
      }
    }
    for (let z = 14; z <= 17; z++) {
      v[idx(5, 6, z)] = coreColor;
      v[idx(6, 6, z)] = coreColor;
    }
    return v;
  }

  // Precision Rifle / Laser (optional sniper scope when isSniper)
  for (let y = 5; y <= 8; y++) {
    for (let z = 2; z <= 14; z++) {
      for (let x = 4; x <= 7; x++) {
        v[idx(x, y, z)] = z % 4 === 0 ? trimColor : bodyColor;
      }
    }
  }
  for (let y = 6; y <= 7; y++) {
    for (let z = 14; z <= 23; z++) {
      for (let x = 5; x <= 6; x++) {
        v[idx(x, y, z)] = z >= 20 ? coreColor : trimColor;
      }
    }
  }
  if (isSniper) {
    for (let z = 7; z <= 13; z++) {
      v[idx(5, 9, z)] = trimColor;
      v[idx(6, 9, z)] = trimColor;
      v[idx(5, 10, z)] = accentColor;
      v[idx(6, 10, z)] = accentColor;
    }
  } else {
    for (let z = 7; z <= 18; z += 2) {
      v[idx(5, 8, z)] = accentColor;
      v[idx(6, 8, z)] = accentColor;
    }
  }
  return v;
}

export function buildFallbackEntityVoxels(
  kind: 'creature' | 'supply_crate',
  paletteLen: number,
  prompt = '',
): Uint8Array {
  const s = 16;
  const v = new Uint8Array(s * s * s);
  const idx = (x: number, y: number, z: number) => x + z * s + y * s * s;
  const c1 = Math.min(1, paletteLen);
  const c2 = Math.min(2, paletteLen);
  const c3 = Math.min(3, paletteLen);

  if (kind === 'supply_crate') {
    for (let y = 1; y <= 11; y++) {
      for (let z = 3; z <= 12; z++) {
        for (let x = 3; x <= 12; x++) {
          const edge = x === 3 || x === 12 || y === 1 || y === 11 || z === 3 || z === 12;
          v[idx(x, y, z)] = edge ? c2 : c1;
        }
      }
    }
    // Glowing beacon band on top + cross trim
    for (let x = 6; x <= 9; x++) {
      for (let z = 6; z <= 9; z++) {
        v[idx(x, 12, z)] = c3;
      }
    }
    return v;
  }

  const lower = prompt.toLowerCase();
  if (/aranha|escorpi|inseto|spider/i.test(lower)) {
    // Low wide thorax + 6 splayed legs + glowing eyes
    for (let y = 4; y <= 7; y++) {
      for (let z = 4; z <= 11; z++) {
        for (let x = 5; x <= 10; x++) {
          v[idx(x, y, z)] = c2;
        }
      }
    }
    for (const lz of [4, 7, 10]) {
      for (let step = 0; step < 4; step++) {
        v[idx(3 - Math.floor(step / 2), 5 - step, lz)] = c3;
        v[idx(12 + Math.floor(step / 2), 5 - step, lz)] = c3;
      }
    }
    v[idx(6, 6, 12)] = c1;
    v[idx(9, 6, 12)] = c1;
    return v;
  }

  if (/drone|rob[oô]|nave|voador|torre/i.test(lower)) {
    // Hovering core + 4 rotor arms
    for (let y = 6; y <= 11; y++) {
      for (let z = 5; z <= 10; z++) {
        for (let x = 5; x <= 10; x++) {
          v[idx(x, y, z)] = y === 8 ? c1 : c2;
        }
      }
    }
    for (const [ax, az] of [
      [3, 3],
      [12, 3],
      [3, 12],
      [12, 12],
    ]) {
      v[idx(ax, 10, az)] = c3;
      v[idx(ax + (ax < 8 ? 1 : -1), 9, az + (az < 8 ? 1 : -1))] = c3;
    }
    v[idx(7, 9, 11)] = c1;
    v[idx(8, 9, 11)] = c1;
    return v;
  }

  if (/golem|tit[aã]|gigante|coloss/i.test(lower)) {
    // Broad bipedal golem with massive shoulders and glowing chest rune
    for (let y = 0; y <= 5; y++) {
      for (const lx of [5, 6, 9, 10]) {
        v[idx(lx, y, 7)] = c3;
        v[idx(lx, y, 8)] = c3;
      }
    }
    for (let y = 6; y <= 12; y++) {
      for (let z = 5; z <= 10; z++) {
        for (let x = 3; x <= 12; x++) {
          v[idx(x, y, z)] = c2;
        }
      }
    }
    v[idx(7, 9, 11)] = c1;
    v[idx(8, 9, 11)] = c1;
    for (let y = 13; y <= 15; y++) {
      for (let x = 6; x <= 9; x++) {
        for (let z = 6; z <= 9; z++) {
          v[idx(x, y, z)] = c3;
        }
      }
    }
    v[idx(7, 14, 10)] = c1;
    v[idx(8, 14, 10)] = c1;
    return v;
  }

  // Stylized agile voxel beast/wolf/dragon
  for (let y = 4; y <= 9; y++) {
    for (let z = 4; z <= 11; z++) {
      for (let x = 5; x <= 10; x++) {
        v[idx(x, y, z)] = c2;
      }
    }
  }
  for (let y = 0; y <= 3; y++) {
    for (const lx of [5, 10]) {
      for (const lz of [4, 11]) {
        v[idx(lx, y, lz)] = c3;
      }
    }
  }
  for (let y = 7; y <= 11; y++) {
    for (let z = 11; z <= 14; z++) {
      for (let x = 6; x <= 9; x++) {
        v[idx(x, y, z)] = c2;
      }
    }
  }
  v[idx(6, 10, 14)] = c1;
  v[idx(9, 10, 14)] = c1;
  return v;
}

export function computePlayerMassKg(slots: (InventorySlotItem | null)[]): number {
  let total = BASE_PLAYER_MASS_KG;
  for (const s of slots) {
    if (s) total += s.massKg;
  }
  return Math.round(total * 10) / 10;
}

export interface GrappleOutcome {
  /** 'pull_self' = puller moves toward target; 'pull_target' = target moves toward puller */
  mode: 'pull_self' | 'pull_target';
  impulseSpeed: number;
}

export function computeGrappleOutcome(
  pullerMassKg: number,
  targetMassKg: number,
  isTerrainAnchor: boolean,
): GrappleOutcome {
  if (isTerrainAnchor || targetMassKg > pullerMassKg) {
    const ratio = isTerrainAnchor
      ? 1.25
      : clamp(targetMassKg / Math.max(1, pullerMassKg), 1, 2.2);
    return {
      mode: 'pull_self',
      impulseSpeed: Math.round((15 + ratio * 5) * 10) / 10,
    };
  }
  const ratio = clamp(pullerMassKg / Math.max(1, targetMassKg), 1, 3.0);
  return {
    mode: 'pull_target',
    impulseSpeed: Math.round((14 + ratio * 4.5) * 10) / 10,
  };
}
