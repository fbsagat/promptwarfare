import { normalizeWeaponAllocation } from './budget.ts';
import {
  WATER_LEVEL_WORLD,
  type InventorySlotItem,
  type LootDropState,
  type PlayerNetState,
  type SpawnedEntityNetState,
  type Vec3,
  type WeaponAllocation,
} from './types.ts';
import { getGroundVoxelY, raycastVoxels, type VoxelGrid } from './voxelWorld.ts';
import { VOXEL_SIZE } from './types.ts';

export type BotArchetype =
  | 'berserker'
  | 'sniper'
  | 'demolisher'
  | 'tactician'
  | 'acrobat'
  | 'scavenger';

export interface BotPersonality {
  archetype: BotArchetype;
  label: string;
  handle: string;
  aggression: number; // 0..1
  caution: number; // 0..1
  aimSkill: number; // 0..1
  turnSpeedRad: number; // rad/s angular tracking speed
  reactionDelaySec: number; // human reaction lag on new threats
  strafeCadenceSec: number; // how often A/D strafe switches
  grappleAffinity: number; // 0..1
  shovelAffinity: number; // 0..1
  jumpAffinity: number; // 0..1
  preferredMinRange: number;
  preferredMaxRange: number;
  retreatHpThreshold: number;
  weaponAllocation: WeaponAllocation;
  weaponPrompts: string[];
  eventPrompts: string[];
}

export type BotIntentKind =
  | 'escape_water'
  | 'retreat'
  | 'loot_seek'
  | 'dig_obstacle'
  | 'grapple_move'
  | 'combat'
  | 'roam';

export interface BotBrainState {
  personality: BotPersonality;
  targetId: string | null;
  lastAttackerId: string | null;
  hurtReactionTimer: number;
  targetAttentionTimer: number;
  lastSeenPos: Vec3 | null;
  lastSeenAgoSec: number;
  hasLos: boolean;
  losCheckTimer: number;
  strafeSign: number;
  strafeTimer: number;
  burstCooldown: number;
  burstFireTimer: number;
  aimPhase: number;
  stallCheckTimer: number;
  stuckAccumSec: number;
  lastCheckPos: Vec3;
  avoidSign: number;
  avoidTimer: number;
  typingTimer: number;
  typingQueued: boolean;
  grappleCooldown: number;
  digCooldown: number;
  roamYaw: number;
  roamTimer: number;
}

const ARCHETYPE_LIST: BotArchetype[] = [
  'berserker',
  'sniper',
  'demolisher',
  'tactician',
  'acrobat',
  'scavenger',
];

const HANDLE_POOL = [
  'KuroBR',
  'Vex_99',
  'NyxFox',
  'CaioX',
  'Mirella7',
  'ZedK',
  'RiftWalker',
  'Kaelzin',
  'PyroTech',
  'SableV',
  'Dante_VX',
  'Torus88',
  'Lince',
  'Jinxed',
  'Orbis',
  'NoraGG',
  'Fenix_BR',
  'Breno404',
  'Valen_z',
  'DrakoPX',
];

interface ArchetypePreset {
  label: string;
  aggression: [number, number];
  caution: [number, number];
  aimSkill: [number, number];
  turnSpeedRad: [number, number];
  reactionDelaySec: [number, number];
  strafeCadenceSec: [number, number];
  grappleAffinity: [number, number];
  shovelAffinity: [number, number];
  jumpAffinity: [number, number];
  preferredMinRange: [number, number];
  preferredMaxRange: [number, number];
  retreatHpThreshold: [number, number];
  allocation: WeaponAllocation;
  weaponPrompts: string[];
  eventPrompts: string[];
}

const PRESETS: Record<BotArchetype, ArchetypePreset> = {
  berserker: {
    label: 'Frenético',
    aggression: [0.8, 0.98],
    caution: [0.12, 0.3],
    aimSkill: [0.55, 0.78],
    turnSpeedRad: [7.2, 10.2],
    reactionDelaySec: [0.16, 0.28],
    strafeCadenceSec: [0.45, 0.85],
    grappleAffinity: [0.55, 0.82],
    shovelAffinity: [0.45, 0.75],
    jumpAffinity: [0.55, 0.85],
    preferredMinRange: [3.5, 6.0],
    preferredMaxRange: [11, 16],
    retreatHpThreshold: [14, 24],
    allocation: { firepower: 40, cadence: 24, precision: 10, destruction: 26 },
    weaponPrompts: [
      'Escopeta flamejante de impacto brutal',
      'Lanca-chamas pesado de magma rapido',
      'Canhao de plasma curto com explosao',
      'Metralhadora de serras incendiarias',
    ],
    eventPrompts: [
      'Chuva de meteoros flamejantes',
      'Matilha de lobos robos agressivos',
      'Vulcao em erupcao no centro',
    ],
  },
  sniper: {
    label: 'Vigia',
    aggression: [0.35, 0.58],
    caution: [0.58, 0.85],
    aimSkill: [0.76, 0.94],
    turnSpeedRad: [5.4, 7.8],
    reactionDelaySec: [0.22, 0.38],
    strafeCadenceSec: [0.8, 1.45],
    grappleAffinity: [0.6, 0.85],
    shovelAffinity: [0.25, 0.5],
    jumpAffinity: [0.2, 0.45],
    preferredMinRange: [20, 26],
    preferredMaxRange: [44, 56],
    retreatHpThreshold: [36, 52],
    allocation: { firepower: 32, cadence: 16, precision: 44, destruction: 8 },
    weaponPrompts: [
      'Rifle sniper laser de alta precisao',
      'Canhao eletromagnetico perfurante de longa distancia',
      'Carabina de cristal teleguiada precisa',
      'Rifle de plasma azul cirurgico',
    ],
    eventPrompts: [
      'Nevasca congelante na ilha',
      'Pilares gigantes de cristal surgindo do chao',
      'Gravidade lunar baixa na arena',
    ],
  },
  demolisher: {
    label: 'Demolidor',
    aggression: [0.62, 0.84],
    caution: [0.28, 0.48],
    aimSkill: [0.5, 0.72],
    turnSpeedRad: [5.2, 7.5],
    reactionDelaySec: [0.24, 0.4],
    strafeCadenceSec: [0.7, 1.25],
    grappleAffinity: [0.3, 0.58],
    shovelAffinity: [0.72, 0.96],
    jumpAffinity: [0.3, 0.55],
    preferredMinRange: [8.5, 12],
    preferredMaxRange: [22, 30],
    retreatHpThreshold: [22, 34],
    allocation: { firepower: 28, cadence: 16, precision: 10, destruction: 46 },
    weaponPrompts: [
      'Bazuca pesada de meteoros explosivos',
      'Morteiro sismico que abre grandes crateras',
      'Lanca-granadas pegajosas de obsidiana',
      'Canhao demolidor de bombas vulcanicas',
    ],
    eventPrompts: [
      'Terremoto devastador na ilha',
      'Fissura gigante rasgando o terreno',
      'Chuva intensa de meteoros',
    ],
  },
  tactician: {
    label: 'Tático',
    aggression: [0.55, 0.76],
    caution: [0.5, 0.72],
    aimSkill: [0.68, 0.86],
    turnSpeedRad: [6.4, 9.0],
    reactionDelaySec: [0.18, 0.3],
    strafeCadenceSec: [0.5, 0.95],
    grappleAffinity: [0.5, 0.76],
    shovelAffinity: [0.55, 0.8],
    jumpAffinity: [0.42, 0.68],
    preferredMinRange: [11, 15],
    preferredMaxRange: [26, 34],
    retreatHpThreshold: [32, 44],
    allocation: { firepower: 26, cadence: 34, precision: 28, destruction: 12 },
    weaponPrompts: [
      'Rifle tatico de rajadas criogenicas',
      'Submetralhadora de plasma estabilizada',
      'Pistola ricochete de energia tatica',
      'Carabina de pulso gravitacional',
    ],
    eventPrompts: [
      'Caixas de suprimentos caindo de paraquedas',
      'Chuva acida corrosiva na ilha',
      'Drones robos de patrulha',
    ],
  },
  acrobat: {
    label: 'Acrobata',
    aggression: [0.66, 0.88],
    caution: [0.38, 0.6],
    aimSkill: [0.62, 0.82],
    turnSpeedRad: [7.6, 10.6],
    reactionDelaySec: [0.16, 0.28],
    strafeCadenceSec: [0.4, 0.75],
    grappleAffinity: [0.84, 0.98],
    shovelAffinity: [0.35, 0.62],
    jumpAffinity: [0.76, 0.96],
    preferredMinRange: [7, 11],
    preferredMaxRange: [20, 28],
    retreatHpThreshold: [28, 40],
    allocation: { firepower: 24, cadence: 38, precision: 24, destruction: 14 },
    weaponPrompts: [
      'Submetralhadora leve de vento e raios',
      'Pistola dupla ricochete agil',
      'Arco energetico de cristal rapido',
      'Lanca-dardos de gelo veloz',
    ],
    eventPrompts: [
      'Gravidade baixa na ilha inteira',
      'Mare alta subindo ao redor da ilha',
      'Pilares de cristal para escalada',
    ],
  },
  scavenger: {
    label: 'Saqueador',
    aggression: [0.38, 0.62],
    caution: [0.65, 0.92],
    aimSkill: [0.6, 0.8],
    turnSpeedRad: [6.0, 8.6],
    reactionDelaySec: [0.2, 0.34],
    strafeCadenceSec: [0.55, 1.05],
    grappleAffinity: [0.65, 0.88],
    shovelAffinity: [0.62, 0.86],
    jumpAffinity: [0.45, 0.72],
    preferredMinRange: [12, 16],
    preferredMaxRange: [28, 36],
    retreatHpThreshold: [40, 56],
    allocation: { firepower: 28, cadence: 30, precision: 18, destruction: 24 },
    weaponPrompts: [
      'Escopeta leve de cristal reciclado',
      'Rifle compacto de fogo corrosivo',
      'Besta explosiva de sucata energetica',
      'Pistola pesada de impacto repulsor',
    ],
    eventPrompts: [
      'Caixas de municao e cura de paraquedas',
      'Enxame de aranhas mecanicas',
      'Chuva acida toxica',
    ],
  },
};

function seededFloat(seed: number): () => number {
  let s = (Math.floor(seed) ^ 0x9e3779b9) >>> 0;
  if (s === 0) s = 1337;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function lerpRange(rng: () => number, [min, max]: [number, number]): number {
  return min + rng() * (max - min);
}

export function createBotPersonality(
  seed = Math.floor(Math.random() * 1e9),
  usedNames?: Set<string>,
  forcedArchetype?: BotArchetype,
): BotPersonality {
  const rng = seededFloat(seed);
  const archetype =
    forcedArchetype ?? ARCHETYPE_LIST[Math.floor(rng() * ARCHETYPE_LIST.length)];
  const p = PRESETS[archetype];

  // Pick a unique human-like handle
  const shuffledHandles = [...HANDLE_POOL];
  for (let i = shuffledHandles.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [shuffledHandles[i], shuffledHandles[j]] = [shuffledHandles[j], shuffledHandles[i]];
  }
  let handle = shuffledHandles.find((n) => !usedNames?.has(n)) ?? '';
  if (!handle) {
    const base = shuffledHandles[0] ?? 'Player';
    let suffix = Math.floor(10 + rng() * 89);
    while (usedNames?.has(`${base}${suffix}`)) suffix += 1;
    handle = `${base}${suffix}`;
  }
  usedNames?.add(handle);

  // Add slight unique personal variation to 100-pt allocation
  const rawAlloc: WeaponAllocation = {
    firepower: Math.max(5, p.allocation.firepower + Math.round((rng() - 0.5) * 10)),
    cadence: Math.max(5, p.allocation.cadence + Math.round((rng() - 0.5) * 10)),
    precision: Math.max(5, p.allocation.precision + Math.round((rng() - 0.5) * 10)),
    destruction: Math.max(5, p.allocation.destruction + Math.round((rng() - 0.5) * 10)),
  };

  return {
    archetype,
    label: p.label,
    handle,
    aggression: lerpRange(rng, p.aggression),
    caution: lerpRange(rng, p.caution),
    aimSkill: lerpRange(rng, p.aimSkill),
    turnSpeedRad: lerpRange(rng, p.turnSpeedRad),
    reactionDelaySec: lerpRange(rng, p.reactionDelaySec),
    strafeCadenceSec: lerpRange(rng, p.strafeCadenceSec),
    grappleAffinity: lerpRange(rng, p.grappleAffinity),
    shovelAffinity: lerpRange(rng, p.shovelAffinity),
    jumpAffinity: lerpRange(rng, p.jumpAffinity),
    preferredMinRange: lerpRange(rng, p.preferredMinRange),
    preferredMaxRange: lerpRange(rng, p.preferredMaxRange),
    retreatHpThreshold: lerpRange(rng, p.retreatHpThreshold),
    weaponAllocation: normalizeWeaponAllocation(rawAlloc),
    weaponPrompts: p.weaponPrompts,
    eventPrompts: p.eventPrompts,
  };
}

export function createBotBrainState(personality: BotPersonality, startPos: Vec3): BotBrainState {
  return {
    personality,
    targetId: null,
    lastAttackerId: null,
    hurtReactionTimer: 0,
    targetAttentionTimer: 0,
    lastSeenPos: null,
    lastSeenAgoSec: 99,
    hasLos: false,
    losCheckTimer: Math.random() * 0.12,
    strafeSign: Math.random() < 0.5 ? -1 : 1,
    strafeTimer: 0.4 + Math.random() * personality.strafeCadenceSec,
    burstCooldown: 0,
    burstFireTimer: 0.55 + Math.random() * 0.5,
    aimPhase: Math.random() * Math.PI * 2,
    stallCheckTimer: 0.5,
    stuckAccumSec: 0,
    lastCheckPos: { ...startPos },
    avoidSign: Math.random() < 0.5 ? -1 : 1,
    avoidTimer: 0,
    typingTimer: 0,
    typingQueued: false,
    grappleCooldown: 1.5 + Math.random() * 2.5,
    digCooldown: 0,
    roamYaw: Math.random() * Math.PI * 2,
    roamTimer: 2 + Math.random() * 3,
  };
}

export function notifyBotDamaged(brain: BotBrainState | null, attackerId: string | null): void {
  if (!brain || !attackerId) return;
  if (brain.lastAttackerId !== attackerId) {
    brain.lastAttackerId = attackerId;
    brain.hurtReactionTimer = brain.personality.reactionDelaySec;
  } else {
    brain.hurtReactionTimer = Math.min(brain.hurtReactionTimer, 0.05);
  }
}

export function normalizeAngleDiff(diff: number): number {
  let d = diff;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export function rotateAngleTowards(current: number, target: number, maxStep: number): number {
  const diff = normalizeAngleDiff(target - current);
  if (Math.abs(diff) <= maxStep) return target;
  return current + Math.sign(diff) * maxStep;
}

export function computeLeadAimPoint(
  shooterPos: Vec3,
  targetPos: Vec3,
  targetVel: Vec3,
  projSpeed: number,
  aimSkill: number,
  aimPhase: number,
): Vec3 {
  const dx = targetPos.x - shooterPos.x;
  const dy = targetPos.y + 0.95 - (shooterPos.y + 1.45);
  const dz = targetPos.z - shooterPos.z;
  const dist = Math.hypot(dx, dy, dz);
  const effectiveSpeed = Math.max(18, projSpeed);
  const flightTime = Math.min(1.15, dist / effectiveSpeed);
  const leadWeight = 0.35 + aimSkill * 0.6;

  // Natural human micro-sway decreases at higher aimSkill
  const swayAmp = (1 - aimSkill) * (0.28 + dist * 0.014);
  const swayX = Math.sin(aimPhase * 2.1) * swayAmp;
  const swayY = Math.cos(aimPhase * 1.7) * swayAmp * 0.55;
  const swayZ = Math.cos(aimPhase * 2.3) * swayAmp;

  return {
    x: targetPos.x + targetVel.x * flightTime * leadWeight + swayX,
    y: targetPos.y + 0.95 + targetVel.y * flightTime * leadWeight * 0.55 + swayY,
    z: targetPos.z + targetVel.z * flightTime * leadWeight + swayZ,
  };
}

export function selectBotTarget<
  T extends Pick<PlayerNetState, 'id' | 'alive' | 'position' | 'hp' | 'isTypingPrompt'>,
>(
  bot: Pick<PlayerNetState, 'id' | 'position' | 'hp' | 'slots'>,
  candidates: T[],
  brain: BotBrainState,
  waterLevelWorld: number,
): T | null {
  let best: T | null = null;
  let bestScore = -Infinity;

  for (const c of candidates) {
    if (!c.alive || c.id === bot.id) continue;
    const dist = Math.hypot(
      c.position.x - bot.position.x,
      c.position.y - bot.position.y,
      c.position.z - bot.position.z,
    );
    if (dist > 82) continue;

    let score = 60 - dist * 0.72;

    // Stickiness prevents erratic target ping-ponging
    if (c.id === brain.targetId) {
      score += 12;
    }

    // Human-like focus on whoever just shot us (once reaction timer elapsed)
    if (c.id === brain.lastAttackerId && brain.hurtReactionTimer <= 0) {
      score += 24;
    }

    // Scavengers & tacticians prioritize wounded or distracted enemies
    if (c.hp < 50) {
      score += (1 - c.hp / 100) * (16 + brain.personality.caution * 14);
    }
    if (c.isTypingPrompt) {
      score += 10;
    }

    // Sniper slightly favors mid-to-long range open targets
    if (brain.personality.archetype === 'sniper' && dist >= 16 && dist <= 52) {
      score += 14;
    }
    // Berserker strongly favors close targets
    if (brain.personality.archetype === 'berserker' && dist <= 16) {
      score += 18;
    }
    // Slight penalty for targeting enemies deep underwater
    if (c.position.y < waterLevelWorld - 0.5) {
      score -= 10;
    }

    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }

  return best;
}

export interface BotDecisionContext {
  bot: Pick<
    PlayerNetState,
    'id' | 'position' | 'velocity' | 'yaw' | 'pitch' | 'hp' | 'heat' | 'overheatedUntil' | 'slots' | 'activeSlot' | 'canForgeWeapon' | 'massKg' | 'isTypingPrompt'
  >;
  grid: VoxelGrid;
  enemies: Array<Pick<PlayerNetState, 'id' | 'alive' | 'position' | 'velocity' | 'hp' | 'isTypingPrompt' | 'massKg'>>;
  lootDrops: LootDropState[];
  entities: SpawnedEntityNetState[];
  waterLevelWorld: number;
  elapsedSec: number;
  nowMs: number;
  dt: number;
}

export interface BotActionOutput {
  intent: BotIntentKind;
  moveX: number;
  moveZ: number;
  jump: boolean;
  targetYaw: number;
  targetPitch: number;
  activeSlot: number;
  firePrimary: boolean;
  startTypingPrompt: boolean;
  finishTypingPrompt: boolean;
}

export function stepBotBrain(brain: BotBrainState, ctx: BotDecisionContext): BotActionOutput {
  const { bot, grid, enemies, lootDrops, entities, waterLevelWorld, elapsedSec, nowMs, dt } = ctx;
  const p = brain.personality;

  brain.aimPhase += dt * (1.8 + p.aimSkill * 0.9);
  brain.hurtReactionTimer = Math.max(0, brain.hurtReactionTimer - dt);
  brain.targetAttentionTimer = Math.max(0, brain.targetAttentionTimer - dt);
  brain.burstCooldown = Math.max(0, brain.burstCooldown - dt);
  brain.grappleCooldown = Math.max(0, brain.grappleCooldown - dt);
  brain.digCooldown = Math.max(0, brain.digCooldown - dt);
  brain.avoidTimer = Math.max(0, brain.avoidTimer - dt);
  brain.lastSeenAgoSec += dt;

  // Periodic strafe direction switch (human-like A/D unpredictability)
  brain.strafeTimer -= dt;
  if (brain.strafeTimer <= 0) {
    brain.strafeSign = Math.random() < 0.78 ? -brain.strafeSign : 0;
    if (brain.strafeSign === 0) brain.strafeSign = Math.random() < 0.5 ? -1 : 1;
    brain.strafeTimer = p.strafeCadenceSec * (0.65 + Math.random() * 0.75);
  }

  // Stuck detection every 0.55s
  let jump = false;
  let justGotStuck = false;
  brain.stallCheckTimer -= dt;
  if (brain.stallCheckTimer <= 0) {
    const moved = Math.hypot(
      bot.position.x - brain.lastCheckPos.x,
      bot.position.z - brain.lastCheckPos.z,
    );
    if (moved < 0.35 && !bot.isTypingPrompt) {
      brain.stuckAccumSec += 0.55;
      if (brain.stuckAccumSec >= 0.55) {
        justGotStuck = true;
        jump = true;
        brain.avoidSign = Math.random() < 0.5 ? -1 : 1;
        brain.avoidTimer = 0.85;
      }
    } else {
      brain.stuckAccumSec = 0;
    }
    brain.lastCheckPos = { ...bot.position };
    brain.stallCheckTimer = 0.55;
  }

  const weaponSlotIdx = bot.slots.findIndex((s) => s?.kind === 'weapon' && (s.ammo ?? 0) > 0);
  const weaponItem: InventorySlotItem | null = weaponSlotIdx !== -1 ? bot.slots[weaponSlotIdx] : null;
  const hasWeapon = weaponItem !== null;

  // Find target
  const target = selectBotTarget(bot, enemies, brain, waterLevelWorld);
  if (target && target.id !== brain.targetId) {
    brain.targetId = target.id;
    brain.targetAttentionTimer = p.reactionDelaySec;
    brain.hasLos = false;
  } else if (!target) {
    brain.targetId = null;
    brain.hasLos = false;
  }

  const eyeOrigin: Vec3 = { x: bot.position.x, y: bot.position.y + 1.45, z: bot.position.z };

  // Line-of-sight check throttled cleanly (~6–8 Hz)
  brain.losCheckTimer -= dt;
  if (target && brain.losCheckTimer <= 0) {
    brain.losCheckTimer = 0.14 + Math.random() * 0.05;
    const tdx = target.position.x - eyeOrigin.x;
    const tdy = target.position.y + 1.0 - eyeOrigin.y;
    const tdz = target.position.z - eyeOrigin.z;
    const tDist = Math.hypot(tdx, tdy, tdz) || 1;
    const ray = raycastVoxels(
      grid,
      eyeOrigin.x,
      eyeOrigin.y,
      eyeOrigin.z,
      tdx / tDist,
      tdy / tDist,
      tdz / tDist,
      Math.min(72, tDist),
    );
    brain.hasLos = !ray.hit || ray.distance >= tDist - 0.85;
    if (brain.hasLos) {
      brain.lastSeenPos = { ...target.position };
      brain.lastSeenAgoSec = 0;
    }
  }

  const centerWorldX = (grid.dimX * VOXEL_SIZE) / 2;
  const centerWorldZ = (grid.dimZ * VOXEL_SIZE) / 2;
  const distToTarget = target
    ? Math.hypot(target.position.x - bot.position.x, target.position.z - bot.position.z)
    : 999;

  // Human-like prompt forging pause: if eligible and not under immediate point-blank melee pressure
  let startTypingPrompt = false;
  let finishTypingPrompt = false;
  const immediateThreat = Boolean(target && distToTarget < 7.5 && brain.hasLos);

  if (bot.isTypingPrompt || brain.typingQueued) {
    brain.typingTimer -= dt;
    if (immediateThreat && bot.hp < 55) {
      // Cancel typing pause reflexively if rushed up close!
      brain.typingQueued = false;
    } else if (brain.typingTimer <= 0) {
      brain.typingQueued = false;
      finishTypingPrompt = true;
    }
  } else if (
    bot.canForgeWeapon &&
    (!immediateThreat || !hasWeapon) &&
    bot.position.y > waterLevelWorld + 0.5
  ) {
    brain.typingQueued = true;
    brain.typingTimer = 1.05 + Math.random() * 1.15;
    startTypingPrompt = true;
  }

  // 1. Urgent water / rising-tide escape
  if (bot.position.y < waterLevelWorld + 0.45) {
    // Look toward higher ground / center and try grapple if available
    const toCenterYaw = Math.atan2(centerWorldX - bot.position.x, centerWorldZ - bot.position.z);
    let useGrapple = false;
    let aimPitch = -0.35; // aim slightly up toward shoreline
    if (brain.grappleCooldown <= 0) {
      const lookDirX = Math.sin(toCenterYaw) * Math.cos(aimPitch);
      const lookDirY = -Math.sin(aimPitch);
      const lookDirZ = Math.cos(toCenterYaw) * Math.cos(aimPitch);
      const grHit = raycastVoxels(grid, eyeOrigin.x, eyeOrigin.y, eyeOrigin.z, lookDirX, lookDirY, lookDirZ, 36);
      if (grHit.hit && grHit.point.y > waterLevelWorld + 0.9) {
        useGrapple = true;
        brain.grappleCooldown = 3.2;
      }
    }
    return {
      intent: 'escape_water',
      moveX: brain.avoidTimer > 0 ? brain.avoidSign * 0.6 : 0,
      moveZ: 1,
      jump: true,
      targetYaw: toCenterYaw,
      targetPitch: aimPitch,
      activeSlot: useGrapple ? 1 : weaponSlotIdx !== -1 ? weaponSlotIdx : 0,
      firePrimary: useGrapple,
      startTypingPrompt,
      finishTypingPrompt,
    };
  }

  // 2. Determine whether to seek a nearby Supply Crate or Weapon Loot Drop
  let bestLootPos: Vec3 | null = null;
  let bestLootDist = hasWeapon ? (bot.hp < 65 ? 24 : 13) : 42;
  for (const ent of entities) {
    if (ent.kind !== 'supply_crate') continue;
    const d = Math.hypot(ent.position.x - bot.position.x, ent.position.z - bot.position.z);
    if (d < bestLootDist && ent.position.y >= waterLevelWorld) {
      bestLootDist = d;
      bestLootPos = ent.position;
    }
  }
  const hasEmptySlot = bot.slots.some((s) => s === null);
  if (!hasWeapon || hasEmptySlot) {
    for (const drop of lootDrops) {
      if (drop.item.kind !== 'weapon') continue;
      const d = Math.hypot(drop.position.x - bot.position.x, drop.position.z - bot.position.z);
      if (d < bestLootDist && drop.position.y >= waterLevelWorld) {
        bestLootDist = d;
        bestLootPos = drop.position;
      }
    }
  }

  // 3. Check retreat condition when wounded & cautious
  const shouldRetreat =
    target !== null &&
    bot.hp < p.retreatHpThreshold &&
    (brain.hurtReactionTimer <= 0 || distToTarget < 18) &&
    p.aggression < 0.92;

  if (shouldRetreat && target) {
    const awayYaw = Math.atan2(bot.position.x - target.position.x, bot.position.z - target.position.z);
    let activeSlot = weaponSlotIdx !== -1 ? weaponSlotIdx : 0;
    let firePrimary = false;
    let aimYaw = awayYaw;
    let aimPitch = -0.25;

    // Acrobats/Scavengers/Snipers try grappling away to high terrain
    if (brain.grappleCooldown <= 0 && Math.random() < p.grappleAffinity) {
      const lookDirX = Math.sin(awayYaw) * Math.cos(aimPitch);
      const lookDirY = -Math.sin(aimPitch);
      const lookDirZ = Math.cos(awayYaw) * Math.cos(aimPitch);
      const gh = raycastVoxels(grid, eyeOrigin.x, eyeOrigin.y, eyeOrigin.z, lookDirX, lookDirY, lookDirZ, 40);
      if (gh.hit && gh.distance > 9 && gh.point.y >= waterLevelWorld + 0.8) {
        activeSlot = 1;
        firePrimary = true;
        brain.grappleCooldown = 3.8;
      }
    } else if (justGotStuck && brain.digCooldown <= 0 && p.shovelAffinity > 0.5) {
      // Dig a hasty foxhole or tunnel through wall when cornered
      activeSlot = 0;
      aimPitch = 0.25;
      firePrimary = true;
      brain.digCooldown = 0.45;
    }

    if (bot.position.y < waterLevelWorld + 1.8) {
      // Never retreat backward into the sea — angle toward island center
      aimYaw = Math.atan2(centerWorldX - bot.position.x, centerWorldZ - bot.position.z);
    }

    return {
      intent: 'retreat',
      moveX: brain.strafeSign * 0.45,
      moveZ: 1,
      jump: jump || Math.random() < p.jumpAffinity * 0.04,
      targetYaw: aimYaw,
      targetPitch: aimPitch,
      activeSlot,
      firePrimary,
      startTypingPrompt,
      finishTypingPrompt,
    };
  }

  // 4. Seek weapon drop or supply crate when unarmed or needing resources (and not actively pressed <9m)
  if (bestLootPos && (!target || !hasWeapon || (distToTarget > 12 && bestLootDist < distToTarget))) {
    const lx = bestLootPos.x - bot.position.x;
    const ly = bestLootPos.y - bot.position.y;
    const lz = bestLootPos.z - bot.position.z;
    const ld = Math.hypot(lx, lz) || 1;
    const lootYaw = Math.atan2(lx, lz);
    const lootPitch = Math.max(-0.7, Math.min(0.7, -Math.atan2(ly, ld)));

    // Use shovel if blocked by wall while pathing to crate
    let activeSlot = weaponSlotIdx !== -1 ? weaponSlotIdx : 0;
    let firePrimary = false;
    if (justGotStuck && brain.digCooldown <= 0) {
      activeSlot = 0;
      firePrimary = true;
      brain.digCooldown = 0.4;
    }

    return {
      intent: 'loot_seek',
      moveX: brain.avoidTimer > 0 ? brain.avoidSign * 0.75 : 0,
      moveZ: 1,
      jump,
      targetYaw: lootYaw,
      targetPitch: lootPitch,
      activeSlot,
      firePrimary,
      startTypingPrompt,
      finishTypingPrompt,
    };
  }

  // 5. Combat engagement with target
  if (target && elapsedSec > 4.5) {
    const wp = weaponItem?.weapon;
    const projSpeed = wp ? Math.max(22, Math.min(95, wp.stats.rangeMeters * 0.95)) : 40;
    const leadPoint = computeLeadAimPoint(
      bot.position,
      target.position,
      target.velocity,
      projSpeed,
      p.aimSkill,
      brain.aimPhase,
    );

    const dx = leadPoint.x - eyeOrigin.x;
    const dy = leadPoint.y - eyeOrigin.y;
    const dz = leadPoint.z - eyeOrigin.z;
    const horiz = Math.hypot(dx, dz) || 1;
    let desiredYaw = Math.atan2(dx, dz);
    let desiredPitch = Math.max(-1.05, Math.min(1.05, -Math.atan2(dy, horiz)));

    // If bot has no LoS and is stuck or close to blocking cover, dig/grapple!
    if (!brain.hasLos) {
      // Check if an obstacle is right in front (< 4m)
      const fwdRay = raycastVoxels(
        grid,
        eyeOrigin.x,
        eyeOrigin.y - 0.35,
        eyeOrigin.z,
        Math.sin(desiredYaw),
        0,
        Math.cos(desiredYaw),
        3.8,
      );

      if (fwdRay.hit && (justGotStuck || (distToTarget < 12 && p.shovelAffinity > 0.55)) && brain.digCooldown <= 0) {
        brain.digCooldown = 0.35;
        return {
          intent: 'dig_obstacle',
          moveX: 0,
          moveZ: 0.7,
          jump: false,
          targetYaw: desiredYaw,
          targetPitch: 0.15,
          activeSlot: 0, // Shovel
          firePrimary: true,
          startTypingPrompt,
          finishTypingPrompt,
        };
      }

      // Acrobat / Sniper / Berserker tries grappling onto elevated vantage point to regain LoS
      if (
        distToTarget > 13 &&
        brain.grappleCooldown <= 0 &&
        Math.random() < p.grappleAffinity * 0.15
      ) {
        const upPitch = -0.45;
        const gRay = raycastVoxels(
          grid,
          eyeOrigin.x,
          eyeOrigin.y,
          eyeOrigin.z,
          Math.sin(desiredYaw) * Math.cos(upPitch),
          -Math.sin(upPitch),
          Math.cos(desiredYaw) * Math.cos(upPitch),
          40,
        );
        if (gRay.hit && gRay.distance > 8 && gRay.point.y > bot.position.y + 1.5) {
          brain.grappleCooldown = 4.2;
          return {
            intent: 'grapple_move',
            moveX: 0,
            moveZ: 1,
            jump: true,
            targetYaw: desiredYaw,
            targetPitch: upPitch,
            activeSlot: 1, // Grapple
            firePrimary: true,
            startTypingPrompt,
            finishTypingPrompt,
          };
        }
      }

      // Flank smoothly around cover toward last seen position
      return {
        intent: 'combat',
        moveX: brain.avoidTimer > 0 ? brain.avoidSign * 0.85 : brain.strafeSign * 0.65,
        moveZ: bot.isTypingPrompt ? 0.3 : 1,
        jump: jump || (Math.random() < p.jumpAffinity * 0.03),
        targetYaw: desiredYaw,
        targetPitch: desiredPitch,
        activeSlot: weaponSlotIdx !== -1 ? weaponSlotIdx : 0,
        firePrimary: false,
        startTypingPrompt,
        finishTypingPrompt,
      };
    }

    // Target IS in Line of Sight!
    // Tactically yank exposed enemy if grapple is off cooldown & archetype likes grappling
    if (
      brain.grappleCooldown <= 0 &&
      distToTarget >= 11 &&
      distToTarget <= 36 &&
      Math.random() < p.grappleAffinity * 0.045 &&
      (p.archetype === 'acrobat' || p.archetype === 'berserker' || !hasWeapon)
    ) {
      brain.grappleCooldown = 4.5;
      return {
        intent: 'grapple_move',
        moveX: brain.strafeSign * 0.6,
        moveZ: hasWeapon ? 0.4 : 1,
        jump: p.archetype === 'acrobat',
        targetYaw: desiredYaw,
        targetPitch: desiredPitch,
        activeSlot: 1,
        firePrimary: true,
        startTypingPrompt,
        finishTypingPrompt,
      };
    }

    // No weapon yet -> rush with shovel or grab nearby ground if close
    if (!hasWeapon || !wp) {
      if (distToTarget < 4.2 && brain.digCooldown <= 0) {
        // Dig terrain right under enemy's feet!
        brain.digCooldown = 0.45;
        desiredPitch = Math.min(0.9, desiredPitch + 0.35);
        return {
          intent: 'dig_obstacle',
          moveX: brain.strafeSign * 0.5,
          moveZ: 0.8,
          jump,
          targetYaw: desiredYaw,
          targetPitch: desiredPitch,
          activeSlot: 0,
          firePrimary: true,
          startTypingPrompt,
          finishTypingPrompt,
        };
      }
      return {
        intent: 'combat',
        moveX: brain.strafeSign * 0.65,
        moveZ: 1,
        jump: jump || Math.random() < p.jumpAffinity * 0.04,
        targetYaw: desiredYaw,
        targetPitch: desiredPitch,
        activeSlot: 0,
        firePrimary: false,
        startTypingPrompt,
        finishTypingPrompt,
      };
    }

    // Combat footwork tailored to weapon + personality range
    const craterRad = wp.modifiers.voxelCraterRadius ?? 0;
    const safeMinRange = Math.max(p.preferredMinRange, craterRad >= 2 ? 7.2 : 0);
    const maxWeaponRange = Math.min(p.preferredMaxRange, wp.stats.rangeMeters * 0.92);

    let moveZ = 0;
    if (distToTarget < safeMinRange) {
      moveZ = -0.9; // back up cleanly to safe distance
    } else if (distToTarget > maxWeaponRange) {
      moveZ = 1; // close distance
    } else {
      moveZ = (p.aggression - 0.5) * 0.5;
    }

    if (bot.isTypingPrompt) {
      moveZ *= 0.25;
    }

    const moveX =
      brain.avoidTimer > 0
        ? brain.avoidSign * 0.85
        : brain.strafeSign * (0.55 + p.jumpAffinity * 0.35);

    // Avoid walking backward off cliff into ocean
    const aheadX = bot.position.x + Math.sin(desiredYaw) * moveZ * 2.5;
    const aheadZ = bot.position.z + Math.cos(desiredYaw) * moveZ * 2.5;
    const aheadGy = getGroundVoxelY(
      grid,
      Math.max(1, Math.min(grid.dimX - 2, Math.floor(aheadX / VOXEL_SIZE))),
      Math.max(1, Math.min(grid.dimZ - 2, Math.floor(aheadZ / VOXEL_SIZE))),
    );
    if (aheadGy * VOXEL_SIZE <= waterLevelWorld + 0.25) {
      moveZ = 0.5;
      desiredYaw = Math.atan2(centerWorldX - bot.position.x, centerWorldZ - bot.position.z);
    }

    // Burst fire & overheat discipline (humans release trigger when hot or finishing a burst)
    const heatHigh = bot.heat >= 84 && wp.selfRisk.includes('overheat_explosion');
    const overheated = nowMs < bot.overheatedUntil;
    const tooCloseForBlast = distToTarget < 4.5 && craterRad >= 2;
    const alignedEnough = Math.abs(normalizeAngleDiff(desiredYaw - bot.yaw)) < 0.32;
    const canShoot =
      !bot.isTypingPrompt &&
      brain.targetAttentionTimer <= 0 &&
      !overheated &&
      !heatHigh &&
      !tooCloseForBlast &&
      distToTarget <= wp.stats.rangeMeters * 1.02 &&
      alignedEnough &&
      brain.burstCooldown <= 0;

    if (canShoot) {
      brain.burstFireTimer -= dt;
      if (brain.burstFireTimer <= 0) {
        // Brief human burst reset pause proportional to weapon kick
        brain.burstCooldown = wp.stats.fireRate >= 5 ? 0.16 + Math.random() * 0.2 : 0.08 + Math.random() * 0.16;
        brain.burstFireTimer = wp.stats.fireRate >= 5 ? 0.55 + Math.random() * 0.65 : 0.35 + Math.random() * 0.45;
      }
    }

    const combatJump =
      jump ||
      (distToTarget < 24 && Math.random() < p.jumpAffinity * 0.035);

    return {
      intent: 'combat',
      moveX,
      moveZ,
      jump: combatJump,
      targetYaw: desiredYaw,
      targetPitch: desiredPitch,
      activeSlot: weaponSlotIdx,
      firePrimary: canShoot,
      startTypingPrompt,
      finishTypingPrompt,
    };
  }

  // 6. Natural exploration / high-ground patrolling when no target is visible
  brain.roamTimer -= dt;
  if (brain.roamTimer <= 0 || justGotStuck) {
    brain.roamTimer = 2.4 + Math.random() * 2.8;
    // Bias roam angle inward toward center of island / high ground so bots stay in the fight
    const toCenter = Math.atan2(centerWorldX - bot.position.x, centerWorldZ - bot.position.z);
    const distFromCenter = Math.hypot(bot.position.x - centerWorldX, bot.position.z - centerWorldZ);
    const maxSpan = grid.dimX * VOXEL_SIZE * 0.26;
    if (distFromCenter > maxSpan) {
      brain.roamYaw = toCenter + (Math.random() - 0.5) * 0.7;
    } else {
      brain.roamYaw = toCenter + (Math.random() - 0.5) * 2.4;
    }
  }

  return {
    intent: 'roam',
    moveX: brain.avoidTimer > 0 ? brain.avoidSign * 0.6 : 0,
    moveZ: bot.isTypingPrompt ? 0.2 : 0.85,
    jump,
    targetYaw: brain.roamYaw,
    targetPitch: Math.sin(brain.aimPhase * 0.5) * 0.08,
    activeSlot: weaponSlotIdx !== -1 ? weaponSlotIdx : 0,
    firePrimary: false,
    startTypingPrompt,
    finishTypingPrompt,
  };
}
