import {
  MAT,
  VOXEL_SIZE,
  WATER_LEVEL_WORLD,
  type EventPulse,
  type EventPhase,
  type EventSignature,
  type MapEventState,
  type RelicId,
  type Vec3,
  type VoxelDelta,
} from '../src/shared/types.ts';
import {
  epicScaleForEvent,
  intensityForEvent,
  phaseForEvent,
  pulseIntervalForSignature,
  signatureForEvent,
} from '../src/shared/eventMechanics.ts';
import { getGroundVoxelY, type VoxelGrid } from '../src/shared/voxelWorld.ts';

/**
 * Contrato mínimo que o motor de eventos precisa do RoomManager. O motor não
 * conhece ledger, bots, sockets nem a máquina de fases do ciclo global.
 */
export interface EventPlayerLike {
  id: string;
  alive: boolean;
  position: Vec3;
  velocity: Vec3;
  hp: number;
  freezeUntil?: number;
  relicBuff?: { id: RelicId } | null;
}

export interface EventEntityLike {
  id: string;
  eventId: string;
  name: string;
  hp: number;
  maxHp: number;
  aiBehavior: string;
  position: Vec3;
  velocity: Vec3;
}

export interface EventRoomLike {
  dimX: number;
  dimY: number;
  dimZ: number;
  grid: VoxelGrid;
  players: Map<string, EventPlayerLike>;
  entities: EventEntityLike[];
  deltas: VoxelDelta[];
  pendingTickDeltas: VoxelDelta[];
  elapsedSec: number;
}

export interface EventEngineDeps {
  damage(
    room: EventRoomLike,
    event: MapEventState,
    player: EventPlayerLike,
    amount: number,
    reason: string,
  ): void;
  carve(
    room: EventRoomLike,
    worldX: number,
    worldY: number,
    worldZ: number,
    radiusVoxels: number,
    scorchShell: boolean,
  ): void;
  spawnCore(
    room: EventRoomLike,
    event: MapEventState,
    position: Vec3,
    name: string,
    ammoRestore: number,
    hp?: number,
    relicId?: RelicId | null,
  ): void;
  pulse(room: EventRoomLike, event: MapEventState, pulse: EventPulse): void;
}

interface PendingImpact {
  dueElapsedSec: number;
  position: Vec3;
  radius: number;
  amount: number;
}

interface EventRuntime {
  pulseAccum: number;
  phase: EventPhase;
  coreSpawned: boolean;
  giantSpawned: boolean;
  bossPosition?: Vec3;
  supplyDrops?: number;
  pending: PendingImpact[];
}

const runtimes = new WeakMap<MapEventState, EventRuntime>();

/** Assinaturas implementadas pelo motor épico nesta fase. */
const EPIC_SIGNATURES = new Set<string>([
  'multi_vortex',
  'orbital_barrage',
  'volcano_birth',
  'whiteout',
  'acid_corrosion',
  'quake_collapse',
  'gravity_collapse',
  'sand_wall',
  'supercell',
  'hail_barrage',
  'canyon_tear',
  'crystal_bloom',
  'tsunami_surge',
  'sinkhole_maw',
  'lava_river',
  'glacier_advance',
  'overgrowth_titan',
  'alpha_pack',
  'stone_colossus',
  'panic_herd',
  'detonating_swarm',
  'spider_nest',
  'hunter_squad',
  'ice_titan',
  'serpent_nest',
  'supply_barrage',
  'armored_depot',
  'legendary_drop',
  'treasure_vault',
  'emergency_beacon',
  'titan_tree',
  'maze_grove',
  'rising_house',
  'watchtower',
  'colossal_tower',
  'lost_temple',
]);

/** Assinaturas de entidades tratadas pelo motor épico. */
const ENTITY_SIGNATURES = new Set<string>([
  'alpha_pack',
  'stone_colossus',
  'panic_herd',
  'detonating_swarm',
  'spider_nest',
  'hunter_squad',
  'ice_titan',
  'serpent_nest',
]);

/** Assinaturas de suprimentos tratadas pelo motor épico. */
const SUPPLY_SIGNATURES = new Set<string>([
  'supply_barrage',
  'armored_depot',
  'legendary_drop',
  'treasure_vault',
  'emergency_beacon',
]);

/** Assinaturas de cenário tratadas pelo motor épico. */
const SCENERY_SIGNATURES = new Set<string>([
  'titan_tree',
  'maze_grove',
  'rising_house',
  'watchtower',
  'colossal_tower',
  'lost_temple',
]);

const SCENERY_HEIGHTS: Partial<Record<EventSignature, number>> = {
  titan_tree: 22,
  maze_grove: 14,
  rising_house: 8,
  watchtower: 24,
  colossal_tower: 42,
  lost_temple: 12,
};

const SCENERY_CORE_NAMES: Partial<Record<EventSignature, string>> = {
  titan_tree: 'Fruto da Árvore-Mãe',
  maze_grove: 'Coração do Bosque',
  rising_house: 'Baú da Mansão',
  watchtower: 'Relíquia da Torre',
  colossal_tower: 'Cápsula do Arranha-Céu',
  lost_temple: 'Relíquia do Templo',
};

function runtimeFor(event: MapEventState): EventRuntime {
  let runtime = runtimes.get(event);
  if (!runtime) {
    runtime = {
      pulseAccum: 0,
      phase: 'impact',
      coreSpawned: false,
      giantSpawned: false,
      pending: [],
    };
    runtimes.set(event, runtime);
  }
  return runtime;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function groundWorldY(room: EventRoomLike, x: number, z: number): number {
  const vx = clamp(Math.floor(x / VOXEL_SIZE), 1, room.dimX - 2);
  const vz = clamp(Math.floor(z / VOXEL_SIZE), 1, room.dimZ - 2);
  return (getGroundVoxelY(room.grid, vx, vz) + 1) * VOXEL_SIZE;
}

/** Teto sólido acima do jogador reduz vento e dano de eventos aéreos. */
function isSheltered(room: EventRoomLike, player: EventPlayerLike): boolean {
  const vx = Math.floor(player.position.x / VOXEL_SIZE);
  const vz = Math.floor(player.position.z / VOXEL_SIZE);
  if (vx < 1 || vz < 1 || vx >= room.dimX - 1 || vz >= room.dimZ - 1) return false;
  const top = getGroundVoxelY(room.grid, vx, vz);
  return top * VOXEL_SIZE > player.position.y + 1.7;
}

function randomMapPoint(room: EventRoomLike): { x: number; z: number } {
  return {
    x: (0.08 + Math.random() * 0.84) * room.dimX * VOXEL_SIZE,
    z: (0.08 + Math.random() * 0.84) * room.dimZ * VOXEL_SIZE,
  };
}

function pickImpactPoint(
  room: EventRoomLike,
  radiusMeters: number,
  anchorChance: number,
): { x: number; z: number } {
  const alive = Array.from(room.players.values()).filter((p) => p.alive);
  if (alive.length === 0 || Math.random() > anchorChance) {
    return randomMapPoint(room);
  }
  const anchor = alive[Math.floor(Math.random() * alive.length)];
  const angle = Math.random() * Math.PI * 2;
  const distance = Math.random() * Math.min(radiusMeters, 28);
  return {
    x: clamp(
      anchor.position.x + Math.cos(angle) * distance,
      8,
      room.dimX * VOXEL_SIZE - 8,
    ),
    z: clamp(
      anchor.position.z + Math.sin(angle) * distance,
      8,
      room.dimZ * VOXEL_SIZE - 8,
    ),
  };
}

function createPulse(
  event: MapEventState,
  signature: ReturnType<typeof signatureForEvent>,
  kind: EventPulse['kind'],
  position: Vec3,
  radius: number,
  intensity: number,
  ttl: number,
): EventPulse {
  return {
    eventId: event.id,
    signature,
    kind,
    position: {
      x: Math.round(position.x * 100) / 100,
      y: Math.round(position.y * 100) / 100,
      z: Math.round(position.z * 100) / 100,
    },
    radius: Math.round(radius * 10) / 10,
    intensity: Math.round(intensity * 100) / 100,
    ttl,
  };
}

/** Atualiza a posição do vórtice e devolve os centros ativos (principal + satélites). */
function tornadoCenters(
  room: EventRoomLike,
  event: MapEventState,
  phase: EventPhase,
): Vec3[] {
  const width = room.dimX * VOXEL_SIZE;
  const depth = room.dimZ * VOXEL_SIZE;
  const age = Math.max(0, event.totalDurationSec - event.durationRemainingSec);
  const radius = Math.max(24, event.params.radiusMeters || 70);
  // Trajetória em figura-8: o vórtice atravessa o mapa e volta, sempre visível.
  const cx = width * 0.5 + Math.cos(age * 0.16) * width * 0.27;
  const cz = depth * 0.5 + Math.sin(age * 0.23) * depth * 0.27;
  const ground = groundWorldY(room, cx, cz);
  event.center[0] = cx;
  event.center[1] = ground;
  event.center[2] = cz;

  const centers: Vec3[] = [{ x: cx, y: ground, z: cz }];
  if (phase === 'climax') {
    const satellites = 3;
    for (let i = 0; i < satellites; i++) {
      const angle = age * 1.35 + (i / satellites) * Math.PI * 2;
      const orbit = Math.min(30, radius * 0.42);
      const sx = clamp(cx + Math.cos(angle) * orbit, 8, width - 8);
      const sz = clamp(cz + Math.sin(angle) * orbit, 8, depth - 8);
      centers.push({ x: sx, y: groundWorldY(room, sx, sz), z: sz });
    }
  }
  return centers;
}

function applyTornadoForces(
  room: EventRoomLike,
  event: MapEventState,
  dt: number,
  centers: Vec3[],
  intensity: number,
): void {
  const radius = Math.max(24, event.params.radiusMeters || 70);
  const phase = event.phase ?? 'sustain';
  const climax = phase === 'climax';
  for (const player of room.players.values()) {
    if (!player.alive || hasRelic(player, 'wind_anchor')) continue;
    const sheltered = isSheltered(room, player);
    for (let i = 0; i < centers.length; i++) {
      const center = centers[i];
      const dx = center.x - player.position.x;
      const dz = center.z - player.position.z;
      const dist = Math.hypot(dx, dz);
      const fieldRadius = radius * (i === 0 ? 1 : 0.55);
      if (dist > fieldRadius) continue;
      const falloff = 1 - dist / Math.max(0.001, fieldRadius);
      const inv = 1 / Math.max(0.001, dist);
      const tangentX = -dz * inv;
      const tangentZ = dx * inv;
      const inwardX = dx * inv;
      const inwardZ = dz * inv;
      const strength =
        (7 + intensity * 16) *
        falloff *
        (climax ? 1.35 : 1) *
        (sheltered ? 0.18 : 1);
      player.velocity.x += (tangentX * 0.82 + inwardX * 0.38) * strength * dt;
      player.velocity.z += (tangentZ * 0.82 + inwardZ * 0.38) * strength * dt;
      player.velocity.y +=
        (2.4 + falloff * 7.5) * (climax ? 1.25 : 1) * (sheltered ? 0.15 : 1) * dt;
    }
  }

  // Destroços também orbitam: dá leitura física ao funil e arma o caos.
  for (const entity of room.entities) {
    const dx = centers[0].x - entity.position.x;
    const dz = centers[0].z - entity.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist > radius || dist < 0.5) continue;
    const inv = 1 / dist;
    const falloff = 1 - dist / radius;
    entity.velocity.x += (-dz * inv * 5.5 + dx * inv * 2.2) * falloff * dt;
    entity.velocity.z += (dx * inv * 5.5 + dz * inv * 2.2) * falloff * dt;
    entity.velocity.y += (3 + falloff * 7) * dt;
  }
}

function damageCore(
  room: EventRoomLike,
  event: MapEventState,
  deps: EventEngineDeps,
  centers: Vec3[],
  intensity: number,
): void {
  const radius = Math.max(24, event.params.radiusMeters || 70);
  const core = radius * 0.4;
  for (const player of room.players.values()) {
    if (!player.alive || hasRelic(player, 'wind_anchor')) continue;
    const sheltered = isSheltered(room, player);
    for (const center of centers) {
      const dist = Math.hypot(center.x - player.position.x, center.z - player.position.z);
      if (dist > core) continue;
      const falloff = 1 - dist / Math.max(0.001, core);
      deps.damage(
        room,
        event,
        player,
        event.params.lethality * (0.08 + falloff * 0.16) * (sheltered ? 0.35 : 1),
        'tornado',
      );
      player.velocity.y += (sheltered ? 1.2 : 6.5) * (0.5 + intensity);
    }
  }
}

function meteorPulse(
  room: EventRoomLike,
  event: MapEventState,
  signature: ReturnType<typeof signatureForEvent>,
  deps: EventEngineDeps,
  runtime: EventRuntime,
  intensity: number,
  progress: number,
): void {
  const radius = Math.max(24, event.params.radiusMeters || 60);
  const point = pickImpactPoint(room, radius, 0.58);
  const y = groundWorldY(room, point.x, point.z);
  const giant = !runtime.giantSpawned && progress >= 0.6;
  if (giant) runtime.giantSpawned = true;
  const blastRadius = giant ? 9.5 : 4.5 + intensity * 2.5;
  const impact: Vec3 = { x: point.x, y, z: point.z };

  deps.carve(
    room,
    impact.x,
    impact.y,
    impact.z,
    giant ? 9 : 4 + Math.round(intensity * 3),
    true,
  );

  deps.pulse(
    room,
    event,
    createPulse(
      event,
      signature,
      giant ? 'shockwave' : 'impact',
      impact,
      blastRadius,
      giant ? 1 : intensity,
      giant ? 1.8 : 1.1,
    ),
  );

  for (const player of room.players.values()) {
    if (!player.alive) continue;
    const dist = Math.hypot(
      player.position.x - impact.x,
      player.position.z - impact.z,
    );
    if (dist > blastRadius) continue;
    const falloff = 1 - dist / blastRadius;
    deps.damage(
      room,
      event,
      player,
      event.params.lethality * (giant ? 0.62 : 0.34) * falloff,
      'meteoro',
    );
    player.velocity.y += (giant ? 12 : 6.5) * falloff;
  }

  if (giant && !runtime.coreSpawned) {
    runtime.coreSpawned = true;
    deps.spawnCore(room, event, impact, 'Núcleo de meteorito', 60);
  }
}

function volcanoPulse(
  room: EventRoomLike,
  event: MapEventState,
  signature: ReturnType<typeof signatureForEvent>,
  deps: EventEngineDeps,
  runtime: EventRuntime,
  intensity: number,
  phase: EventPhase,
): void {
  const center = event.center;
  const radius = Math.max(30, event.params.radiusMeters || 55);
  const ground = groundWorldY(room, center[0], center[2]);
  const bombs = phase === 'impact' ? 9 : phase === 'climax' ? 8 : 5;
  for (let i = 0; i < bombs; i++) {
    const angle = Math.random() * Math.PI * 2;
    const distance = 8 + Math.random() * radius;
    const x = clamp(center[0] + Math.cos(angle) * distance, 8, room.dimX * VOXEL_SIZE - 8);
    const z = clamp(center[2] + Math.sin(angle) * distance, 8, room.dimZ * VOXEL_SIZE - 8);
    const y = groundWorldY(room, x, z);
    const impact: Vec3 = { x, y, z };
    deps.carve(room, x, y, z, 2 + Math.round(intensity * 2), true);
    deps.pulse(
      room,
      event,
      createPulse(event, signature, 'eruption', impact, 3.5 + intensity * 2, intensity, 1.4),
    );
    for (const player of room.players.values()) {
      if (!player.alive) continue;
      const dist = Math.hypot(player.position.x - x, player.position.z - z);
      if (dist > 5.5) continue;
      const falloff = 1 - dist / 5.5;
      deps.damage(room, event, player, event.params.lethality * 0.3 * falloff, 'bomba de lava');
      player.velocity.y += 7.5 * falloff;
    }
  }

  deps.pulse(
    room,
    event,
    createPulse(
      event,
      signature,
      'roar',
      { x: center[0], y: ground + 2, z: center[2] },
      radius,
      intensity,
      2.2,
    ),
  );

  if (phase === 'climax' && !runtime.coreSpawned) {
    runtime.coreSpawned = true;
    deps.pulse(
      room,
      event,
      createPulse(
        event,
        signature,
        'shockwave',
        { x: center[0], y: ground + 1, z: center[2] },
        radius * 0.75,
        1,
        2.4,
      ),
    );
    deps.spawnCore(
      room,
      event,
      { x: center[0] + 4, y: ground + 0.6, z: center[2] + 4 },
      'Coração vulcânico',
      55,
    );
  }
}

/**
 * Tick de um evento épico. Retorna true quando a assinatura foi tratada aqui;
 * o RoomManager mantém o caminho legado para as demais assinaturas.
 */
function randomGroundPoint(room: EventRoomLike): Vec3 {
  const point = randomMapPoint(room);
  return { x: point.x, y: groundWorldY(room, point.x, point.z), z: point.z };
}

function setTopVoxel(
  room: EventRoomLike,
  worldX: number,
  worldZ: number,
  material: number,
  chance = 1,
): boolean {
  if (Math.random() > chance) return false;
  const vx = clamp(Math.floor(worldX / VOXEL_SIZE), 1, room.dimX - 2);
  const vz = clamp(Math.floor(worldZ / VOXEL_SIZE), 1, room.dimZ - 2);
  const vy = getGroundVoxelY(room.grid, vx, vz);
  const current = room.grid.get(vx, vy, vz);
  if (
    current === MAT.AIR ||
    current === MAT.BEDROCK ||
    current === MAT.LAVA ||
    current === MAT.LADDER
  ) {
    return false;
  }
  if (!room.grid.set(vx, vy, vz, material)) return false;
  const delta: VoxelDelta = { vx, vy, vz, mat: material };
  room.deltas.push(delta);
  room.pendingTickDeltas.push(delta);
  return true;
}

function setVoxelIfAir(
  room: EventRoomLike,
  vx: number,
  vy: number,
  vz: number,
  material: number,
): boolean {
  if (vx < 1 || vz < 1 || vx >= room.dimX - 1 || vz >= room.dimZ - 1) return false;
  if (vy < 1 || vy >= room.dimY - 1) return false;
  if (room.grid.get(vx, vy, vz) !== MAT.AIR) return false;
  if (!room.grid.set(vx, vy, vz, material)) return false;
  const delta: VoxelDelta = { vx, vy, vz, mat: material };
  room.deltas.push(delta);
  room.pendingTickDeltas.push(delta);
  return true;
}

function growSpike(
  room: EventRoomLike,
  worldX: number,
  worldZ: number,
  height: number,
  material: number = MAT.CRYSTAL,
): void {
  const vx = clamp(Math.floor(worldX / VOXEL_SIZE), 1, room.dimX - 2);
  const vz = clamp(Math.floor(worldZ / VOXEL_SIZE), 1, room.dimZ - 2);
  const baseY = getGroundVoxelY(room.grid, vx, vz) + 1;
  for (let dy = 0; dy < height; dy++) {
    setVoxelIfAir(room, vx, baseY + dy, vz, material);
  }
}

function buildTitanTree(room: EventRoomLike, center: Vec3): void {
  const cx = clamp(Math.floor(center.x / VOXEL_SIZE), 8, room.dimX - 9);
  const cz = clamp(Math.floor(center.z / VOXEL_SIZE), 8, room.dimZ - 9);
  const baseY = getGroundVoxelY(room.grid, cx, cz) + 1;
  const trunkHeight = 30;
  for (let dy = 0; dy < trunkHeight; dy++) {
    for (let dz = -2; dz <= 2; dz++) {
      for (let dx = -2; dx <= 2; dx++) {
        if (dx * dx + dz * dz > 4) continue;
        setVoxelIfAir(room, cx + dx, baseY + dy, cz + dz, MAT.WOOD);
      }
    }
  }
  const canopyBase = baseY + trunkHeight - 6;
  for (let dy = 0; dy <= 9; dy++) {
    const radius = Math.max(1, 10 - dy);
    for (let dz = -radius; dz <= radius; dz++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (dx * dx + dz * dz > radius * radius) continue;
        setVoxelIfAir(
          room,
          cx + dx,
          canopyBase + dy,
          cz + dz,
          dy >= 8 ? MAT.MOSS : MAT.LEAVES,
        );
      }
    }
  }
  // Raízes superficiais para leitura de "árvore-mundo".
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2;
    for (let step = 1; step <= 7; step++) {
      const vx = Math.round(cx + Math.cos(angle) * step);
      const vz = Math.round(cz + Math.sin(angle) * step);
      setVoxelIfAir(room, vx, baseY, vz, MAT.WOOD);
    }
  }
}

function isInWater(player: EventPlayerLike): boolean {
  return player.position.y < WATER_LEVEL_WORLD + 0.2;
}

function hasRelic(player: EventPlayerLike, id: RelicId): boolean {
  return player.relicBuff?.id === id;
}

function applyWind(
  room: EventRoomLike,
  dt: number,
  windX: number,
  windZ: number,
): void {
  for (const player of room.players.values()) {
    if (!player.alive || isSheltered(room, player) || hasRelic(player, 'wind_anchor')) continue;
    player.velocity.x += windX * dt;
    player.velocity.z += windZ * dt;
  }
}

function whiteoutTick(
  room: EventRoomLike,
  dt: number,
  intensity: number,
): void {
  const angle = room.elapsedSec * 0.11;
  const strength = 5 + intensity * 9;
  applyWind(room, dt, Math.cos(angle) * strength, Math.sin(angle * 0.8) * strength * 0.7);
}

function whiteoutPulse(
  room: EventRoomLike,
  event: MapEventState,
  signature: EventSignature,
  deps: EventEngineDeps,
  intensity: number,
): void {
  for (const player of room.players.values()) {
    if (!player.alive || isSheltered(room, player)) continue;
    deps.damage(room, event, player, event.params.lethality * 0.07, 'nevasca');
    if (!hasRelic(player, 'frost_heart')) {
      player.freezeUntil = Math.max(player.freezeUntil ?? 0, Date.now() + 900);
    }
  }
  for (let i = 0; i < 7; i++) {
    const point = randomGroundPoint(room);
    setTopVoxel(room, point.x, point.z, MAT.SNOW, 0.55);
  }
  const point = randomGroundPoint(room);
  deps.pulse(
    room,
    event,
    createPulse(event, signature, 'hail', point, 7 + intensity * 5, intensity, 1.2),
  );
}

function acidPulse(
  room: EventRoomLike,
  event: MapEventState,
  signature: EventSignature,
  deps: EventEngineDeps,
  intensity: number,
  phase: EventPhase,
): void {
  for (const player of room.players.values()) {
    if (!player.alive || isSheltered(room, player)) continue;
    deps.damage(room, event, player, event.params.lethality * 0.1, 'chuva ácida');
  }
  for (let i = 0; i < 8; i++) {
    const point = randomGroundPoint(room);
    setTopVoxel(room, point.x, point.z, MAT.SLUDGE, 0.55);
  }
  const point = randomGroundPoint(room);
  if (phase === 'climax' && Math.random() < 0.55) {
    deps.carve(room, point.x, point.y, point.z, 2, true);
    deps.pulse(
      room,
      event,
      createPulse(event, signature, 'eruption', point, 5 + intensity * 3, intensity, 1.4),
    );
    for (const player of room.players.values()) {
      if (!player.alive || isSheltered(room, player)) continue;
      const dist = Math.hypot(player.position.x - point.x, player.position.z - point.z);
      if (dist > 6) continue;
      deps.damage(room, event, player, event.params.lethality * 0.2 * (1 - dist / 6), 'gêiser ácido');
    }
  } else {
    deps.pulse(
      room,
      event,
      createPulse(event, signature, 'impact', point, 4 + intensity * 2, intensity, 1.1),
    );
  }
}

function quakePulse(
  room: EventRoomLike,
  event: MapEventState,
  signature: EventSignature,
  deps: EventEngineDeps,
  runtime: EventRuntime,
  intensity: number,
  phase: EventPhase,
): void {
  const points = phase === 'climax' ? 5 : 3;
  for (let i = 0; i < points; i++) {
    const point = randomGroundPoint(room);
    deps.carve(room, point.x, point.y, point.z, 2 + Math.round(intensity * 2), true);
    deps.pulse(
      room,
      event,
      createPulse(event, signature, 'debris', point, 4 + intensity * 2, intensity, 1.1),
    );
    for (const player of room.players.values()) {
      if (!player.alive) continue;
      const dist = Math.hypot(player.position.x - point.x, player.position.z - point.z);
      if (dist > 4.5) continue;
      deps.damage(room, event, player, event.params.lethality * 0.18 * (1 - dist / 4.5), 'terremoto');
      player.velocity.y += 4.5 * (1 - dist / 4.5);
    }
  }

  if (phase === 'climax' && !runtime.giantSpawned) {
    runtime.giantSpawned = true;
    const center = event.center;
    deps.pulse(
      room,
      event,
      createPulse(
        event,
        signature,
        'shockwave',
        { x: center[0], y: center[1], z: center[2] },
        55,
        1,
        2.4,
      ),
    );
    for (const player of room.players.values()) {
      if (!player.alive) continue;
      const dx = player.position.x - center[0];
      const dz = player.position.z - center[2];
      const dist = Math.hypot(dx, dz);
      if (dist > 70) continue;
      const falloff = 1 - dist / 70;
      deps.damage(room, event, player, event.params.lethality * 0.22 * falloff, 'onda sísmica');
      const inv = 1 / Math.max(0.001, dist);
      player.velocity.x += dx * inv * 8 * falloff;
      player.velocity.z += dz * inv * 8 * falloff;
      player.velocity.y += 5 * falloff;
    }
  }
}

function gravityTick(
  room: EventRoomLike,
  event: MapEventState,
  dt: number,
  intensity: number,
  phase: EventPhase,
): void {
  const radius = Math.max(24, event.params.radiusMeters || 70);
  const center = event.center;
  const strength = 2.5 + intensity * 5;
  for (const player of room.players.values()) {
    if (!player.alive) continue;
    const dx = center[0] - player.position.x;
    const dz = center[2] - player.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist > radius || dist < 0.001) continue;
    const falloff = 1 - dist / radius;
    const inv = 1 / dist;
    player.velocity.x += dx * inv * strength * falloff * dt;
    player.velocity.z += dz * inv * strength * falloff * dt;
    if (phase === 'climax') {
      player.velocity.y += (2.5 + falloff * 5) * dt;
    }
  }
  for (const entity of room.entities) {
    const dx = center[0] - entity.position.x;
    const dz = center[2] - entity.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist > radius || dist < 0.001) continue;
    const falloff = 1 - dist / radius;
    const inv = 1 / dist;
    entity.velocity.x += dx * inv * strength * 0.6 * falloff * dt;
    entity.velocity.z += dz * inv * strength * 0.6 * falloff * dt;
    entity.velocity.y += (phase === 'climax' ? 3 : 1) * falloff * dt;
  }
}

function driftHazardCenter(
  room: EventRoomLike,
  event: MapEventState,
  speedX: number,
  speedZ: number,
): void {
  const width = room.dimX * VOXEL_SIZE;
  const depth = room.dimZ * VOXEL_SIZE;
  const age = Math.max(0, event.totalDurationSec - event.durationRemainingSec);
  const x = clamp(width * 0.5 + Math.cos(age * speedX) * width * 0.3, 9, width - 9);
  const z = clamp(depth * 0.5 + Math.sin(age * speedZ) * depth * 0.3, 9, depth - 9);
  event.center[0] = x;
  event.center[1] = groundWorldY(room, x, z);
  event.center[2] = z;
}

function sandWallTick(
  room: EventRoomLike,
  event: MapEventState,
  dt: number,
  intensity: number,
  phase: EventPhase,
): void {
  driftHazardCenter(room, event, 0.12, 0.09);
  const wind = 7 + intensity * 8;
  applyWind(room, dt, wind, Math.sin(room.elapsedSec * 0.7) * wind * 0.35);
  if (phase !== 'climax') return;
  const center = event.center;
  for (const player of room.players.values()) {
    if (!player.alive || isSheltered(room, player) || hasRelic(player, 'wind_anchor')) continue;
    const dx = player.position.x - center[0];
    const dz = player.position.z - center[2];
    const dist = Math.hypot(dx, dz);
    if (dist > 22 || dist < 0.2) continue;
    const inv = 1 / dist;
    player.velocity.x += -dz * inv * 5 * (1 - dist / 22) * dt;
    player.velocity.z += dx * inv * 5 * (1 - dist / 22) * dt;
    player.velocity.y += 2.5 * (1 - dist / 22) * dt;
  }
}

function sandWallPulse(
  room: EventRoomLike,
  event: MapEventState,
  signature: EventSignature,
  deps: EventEngineDeps,
  intensity: number,
): void {
  for (const player of room.players.values()) {
    if (!player.alive || isSheltered(room, player)) continue;
    deps.damage(room, event, player, event.params.lethality * 0.06, 'tempestade de areia');
  }
  for (let i = 0; i < 9; i++) {
    const point = randomGroundPoint(room);
    setTopVoxel(room, point.x, point.z, MAT.SAND, 0.45);
  }
  const point = randomGroundPoint(room);
  deps.pulse(
    room,
    event,
    createPulse(event, signature, 'debris', point, 10 + intensity * 6, intensity, 1.4),
  );
}

function supercellPulse(
  room: EventRoomLike,
  event: MapEventState,
  signature: EventSignature,
  deps: EventEngineDeps,
  intensity: number,
  phase: EventPhase,
): void {
  const strikes = phase === 'climax' ? 3 : 1;
  const exposed = Array.from(room.players.values()).filter(
    (player) => player.alive && !isSheltered(room, player),
  );
  for (let i = 0; i < strikes; i++) {
    let point: { x: number; z: number };
    if (i === 0 && exposed.length > 0) {
      const anchor = exposed[Math.floor(Math.random() * exposed.length)];
      point = {
        x: clamp(anchor.position.x + (Math.random() - 0.5) * 2.5, 8, room.dimX * VOXEL_SIZE - 8),
        z: clamp(anchor.position.z + (Math.random() - 0.5) * 2.5, 8, room.dimZ * VOXEL_SIZE - 8),
      };
    } else {
      point = pickImpactPoint(room, 40, 0.82);
    }
    const y = groundWorldY(room, point.x, point.z);
    deps.carve(room, point.x, y, point.z, 2, true);
    deps.pulse(
      room,
      event,
      createPulse(
        event,
        signature,
        'lightning',
        { x: point.x, y, z: point.z },
        4 + intensity * 2,
        intensity,
        0.9,
      ),
    );
    let waterStrike = false;
    for (const player of room.players.values()) {
      if (!player.alive) continue;
      const dist = Math.hypot(player.position.x - point.x, player.position.z - point.z);
      if (dist > 5.5) continue;
      const falloff = 1 - dist / 5.5;
      if (isInWater(player)) waterStrike = true;
      deps.damage(
        room,
        event,
        player,
        event.params.lethality * (waterStrike ? 0.42 : 0.26) * falloff,
        'raio',
      );
      player.velocity.y += 3.5 * falloff;
    }
    if (waterStrike) {
      deps.pulse(
        room,
        event,
        createPulse(
          event,
          signature,
          'shockwave',
          { x: point.x, y, z: point.z },
          10,
          intensity,
          1.1,
        ),
      );
    }
    setTopVoxel(room, point.x, point.z, MAT.SCORCHED, 0.8);
  }
}

function hailPulse(
  room: EventRoomLike,
  event: MapEventState,
  signature: EventSignature,
  deps: EventEngineDeps,
  intensity: number,
  phase: EventPhase,
): void {
  driftHazardCenter(room, event, 0.09, 0.14);
  const center = event.center;
  const radius = Math.max(24, event.params.radiusMeters || 50);
  const count = phase === 'climax' ? 12 : 7;
  const exposed = Array.from(room.players.values()).filter(
    (player) => player.alive && !isSheltered(room, player),
  );
  for (let i = 0; i < count; i++) {
    let x: number;
    let z: number;
    if (i === 0 && exposed.length > 0) {
      const anchor = exposed[Math.floor(Math.random() * exposed.length)];
      x = clamp(anchor.position.x + (Math.random() - 0.5) * 2, 8, room.dimX * VOXEL_SIZE - 8);
      z = clamp(anchor.position.z + (Math.random() - 0.5) * 2, 8, room.dimZ * VOXEL_SIZE - 8);
    } else {
      const angle = Math.random() * Math.PI * 2;
      const dist = Math.random() * radius * 0.7;
      x = clamp(center[0] + Math.cos(angle) * dist, 8, room.dimX * VOXEL_SIZE - 8);
      z = clamp(center[2] + Math.sin(angle) * dist, 8, room.dimZ * VOXEL_SIZE - 8);
    }
    const y = groundWorldY(room, x, z);
    const placed = setTopVoxel(
      room,
      x,
      z,
      Math.random() < 0.5 ? MAT.ICE : MAT.SNOW,
      i === 0 ? 1 : 0.5,
    );
    if (!placed && i === 0) {
      const vx = clamp(Math.floor(x / VOXEL_SIZE), 1, room.dimX - 2);
      const vz = clamp(Math.floor(z / VOXEL_SIZE), 1, room.dimZ - 2);
      const gy = getGroundVoxelY(room.grid, vx, vz);
      setVoxelIfAir(room, vx, gy + 1, vz, MAT.ICE);
    }
    deps.pulse(
      room,
      event,
      createPulse(
        event,
        signature,
        'hail',
        { x, y, z },
        3.5 + intensity * 1.5,
        intensity,
        1.0,
      ),
    );
    for (const player of room.players.values()) {
      if (!player.alive || isSheltered(room, player)) continue;
      const playerDist = Math.hypot(player.position.x - x, player.position.z - z);
      if (playerDist > 3.6) continue;
      const falloff = 1 - playerDist / 3.6;
      deps.damage(room, event, player, event.params.lethality * 0.2 * falloff, 'granizo');
      player.velocity.y += 2.5 * falloff;
    }
  }
}

function canyonPulse(
  room: EventRoomLike,
  event: MapEventState,
  signature: EventSignature,
  deps: EventEngineDeps,
  runtime: EventRuntime,
  intensity: number,
  phase: EventPhase,
): void {
  const cx = event.center[0];
  const cz = event.center[2];
  const halfLen = Math.min(80, room.dimX * VOXEL_SIZE * 0.22);
  for (let i = 0; i < 4; i++) {
    const x = cx + (Math.random() - 0.5) * 2 * halfLen;
    const z = cz + (Math.random() - 0.5) * 8;
    const y = groundWorldY(room, x, z);
    deps.carve(room, x, y, z, 3 + Math.round(intensity * 2), true);
    deps.pulse(
      room,
      event,
      createPulse(event, signature, 'debris', { x, y, z }, 4, intensity, 1.2),
    );
  }

  for (const player of room.players.values()) {
    if (!player.alive) continue;
    if (Math.abs(player.position.z - cz) > 6) continue;
    if (Math.abs(player.position.x - cx) > halfLen) continue;
    const edge = Math.max(0, 1 - Math.abs(player.position.z - cz) / 6);
    deps.damage(room, event, player, event.params.lethality * 0.14 * edge, 'fissura');
    player.velocity.y -= 2.4 * edge;
  }

  if (phase === 'climax' && !runtime.giantSpawned) {
    runtime.giantSpawned = true;
    for (let dz = -42; dz <= 42; dz += 2) {
      const z = cz + dz;
      const y = groundWorldY(room, cx, z);
      deps.carve(room, cx, y, z, 3, true);
    }
    deps.pulse(
      room,
      event,
      createPulse(
        event,
        signature,
        'shockwave',
        { x: cx, y: event.center[1], z: cz },
        46,
        1,
        2.2,
      ),
    );
    for (const player of room.players.values()) {
      if (!player.alive) continue;
      const dist = Math.hypot(player.position.x - cx, player.position.z - cz);
      if (dist > 46) continue;
      deps.damage(
        room,
        event,
        player,
        event.params.lethality * 0.18 * (1 - dist / 46),
        'colapso da fissura',
      );
    }
  }
}

function crystalPulse(
  room: EventRoomLike,
  event: MapEventState,
  signature: EventSignature,
  deps: EventEngineDeps,
  runtime: EventRuntime,
  intensity: number,
  phase: EventPhase,
): void {
  const radius = Math.max(24, event.params.radiusMeters || 60);
  const count = phase === 'climax' ? 6 : 3;
  const alive = Array.from(room.players.values()).filter((player) => player.alive);
  for (let i = 0; i < count; i++) {
    let x: number;
    let z: number;
    if (i === 0 && alive.length > 0) {
      const anchor = alive[Math.floor(Math.random() * alive.length)];
      x = anchor.position.x + (Math.random() - 0.5) * 2;
      z = anchor.position.z + (Math.random() - 0.5) * 2;
    } else {
      const angle = Math.random() * Math.PI * 2;
      const dist = Math.random() * radius * 0.55;
      x = event.center[0] + Math.cos(angle) * dist;
      z = event.center[2] + Math.sin(angle) * dist;
    }
    growSpike(room, x, z, 4 + Math.round(intensity * 8));
    deps.pulse(
      room,
      event,
      createPulse(
        event,
        signature,
        'impact',
        { x, y: groundWorldY(room, x, z), z },
        4 + intensity * 2,
        intensity,
        1.1,
      ),
    );
    for (const player of room.players.values()) {
      if (!player.alive) continue;
      const playerDist = Math.hypot(player.position.x - x, player.position.z - z);
      if (playerDist > 4.5) continue;
      deps.damage(
        room,
        event,
        player,
        event.params.lethality * 0.22 * (1 - playerDist / 4.5),
        'estilhaço de cristal',
      );
    }
  }

  if (phase === 'climax' && !runtime.giantSpawned) {
    runtime.giantSpawned = true;
    for (let i = 0; i < 12; i++) {
      const angle = (i / 12) * Math.PI * 2;
      const dist = 10 + Math.random() * 18;
      growSpike(
        room,
        event.center[0] + Math.cos(angle) * dist,
        event.center[2] + Math.sin(angle) * dist,
        8 + Math.round(intensity * 10),
      );
    }
    deps.pulse(
      room,
      event,
      createPulse(
        event,
        signature,
        'shockwave',
        { x: event.center[0], y: event.center[1] + 3, z: event.center[2] },
        38,
        1,
        2.2,
      ),
    );
    deps.spawnCore(
      room,
      event,
      { x: event.center[0], y: event.center[1] + 1, z: event.center[2] },
      'Cristal primordial',
      45,
    );
  }
}

function tsunamiPulse(
  room: EventRoomLike,
  event: MapEventState,
  signature: EventSignature,
  deps: EventEngineDeps,
  runtime: EventRuntime,
  intensity: number,
  phase: EventPhase,
): void {
  const width = room.dimX * VOXEL_SIZE;
  const depth = room.dimZ * VOXEL_SIZE;
  const floodLevel = WATER_LEVEL_WORLD + 2.6;
  for (const player of room.players.values()) {
    if (!player.alive || player.position.y > floodLevel) continue;
    deps.damage(room, event, player, event.params.lethality * 0.16, 'tsunami');
    player.velocity.y += 4.5;
    const dx = width * 0.5 - player.position.x;
    const dz = depth * 0.5 - player.position.z;
    const inv = 1 / Math.max(0.001, Math.hypot(dx, dz));
    player.velocity.x += dx * inv * 3;
    player.velocity.z += dz * inv * 3;
  }

  for (let i = 0; i < 3; i++) {
    const edge = Math.random() < 0.5 ? 8 : width - 8;
    const z = 10 + Math.random() * (depth - 20);
    deps.pulse(
      room,
      event,
      createPulse(
        event,
        signature,
        'wave',
        { x: edge, y: floodLevel, z },
        18 + intensity * 10,
        intensity,
        1.8,
      ),
    );
  }

  if (phase === 'climax' && !runtime.giantSpawned) {
    runtime.giantSpawned = true;
    deps.pulse(
      room,
      event,
      createPulse(
        event,
        signature,
        'wave',
        { x: width * 0.5, y: floodLevel, z: depth * 0.5 },
        70,
        1,
        2.6,
      ),
    );
    deps.spawnCore(
      room,
      event,
      { x: width * 0.5, y: floodLevel, z: depth * 0.5 },
      'Cofre da maré',
      55,
    );
  }
}

function sinkholeTick(
  room: EventRoomLike,
  event: MapEventState,
  dt: number,
  intensity: number,
  phase: EventPhase,
): void {
  const radius = Math.max(24, event.params.radiusMeters || 55);
  const center = event.center;
  const pull = 3 + intensity * 6;
  for (const player of room.players.values()) {
    if (!player.alive) continue;
    const dx = center[0] - player.position.x;
    const dz = center[2] - player.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist > radius || dist < 0.2) continue;
    const falloff = 1 - dist / radius;
    const inv = 1 / dist;
    player.velocity.x += dx * inv * pull * falloff * dt;
    player.velocity.z += dz * inv * pull * falloff * dt;
    player.velocity.y -= (1.2 + (phase === 'climax' ? 3 : 1.4) * falloff) * dt;
  }
}

function sinkholePulse(
  room: EventRoomLike,
  event: MapEventState,
  signature: EventSignature,
  deps: EventEngineDeps,
  runtime: EventRuntime,
  intensity: number,
  phase: EventPhase,
): void {
  const center = event.center;
  const y = groundWorldY(room, center[0], center[2]);
  deps.carve(room, center[0], y - 0.4, center[2], 3 + Math.round(intensity * 3), true);
  deps.pulse(
    room,
    event,
    createPulse(
      event,
      signature,
      'debris',
      { x: center[0], y, z: center[2] },
      8 + intensity * 4,
      intensity,
      1.4,
    ),
  );
  for (const player of room.players.values()) {
    if (!player.alive) continue;
    const dist = Math.hypot(player.position.x - center[0], player.position.z - center[2]);
    if (dist > 12) continue;
    deps.damage(room, event, player, event.params.lethality * 0.2 * (1 - dist / 12), 'sorvedouro');
    player.velocity.y -= 2.5 * (1 - dist / 12);
  }
  if (phase === 'climax' && !runtime.giantSpawned) {
    runtime.giantSpawned = true;
    deps.carve(room, center[0], y - 2, center[2], 9, true);
    deps.pulse(
      room,
      event,
      createPulse(
        event,
        signature,
        'shockwave',
        { x: center[0], y, z: center[2] },
        42,
        1,
        2.4,
      ),
    );
    deps.spawnCore(
      room,
      event,
      { x: center[0] + 12, y: y + 1, z: center[2] },
      'Relíquia do abismo',
      55,
    );
  }
}

function lavaRiverTick(
  room: EventRoomLike,
  event: MapEventState,
  dt: number,
  deps: EventEngineDeps,
): void {
  for (const player of room.players.values()) {
    if (!player.alive) continue;
    const vx = Math.floor(player.position.x / VOXEL_SIZE);
    const vz = Math.floor(player.position.z / VOXEL_SIZE);
    const vy = Math.floor((player.position.y + 0.2) / VOXEL_SIZE);
    const onLava =
      room.grid.get(vx, vy, vz) === MAT.LAVA ||
      room.grid.get(vx, vy - 1, vz) === MAT.LAVA;
    if (!onLava) continue;
    deps.damage(room, event, player, event.params.lethality * 0.18 * dt, 'rio de lava');
    player.velocity.y += 2.2 * dt;
  }
}

function lavaRiverPulse(
  room: EventRoomLike,
  event: MapEventState,
  signature: EventSignature,
  deps: EventEngineDeps,
  runtime: EventRuntime,
  intensity: number,
  phase: EventPhase,
): void {
  const cx = event.center[0];
  const cz = event.center[2];
  const halfLen = Math.min(80, room.dimX * VOXEL_SIZE * 0.22);
  for (let i = 0; i < 4; i++) {
    const x = cx + (Math.random() - 0.5) * 2 * halfLen;
    const z = cz + (Math.random() - 0.5) * 12;
    const y = groundWorldY(room, x, z);
    deps.carve(room, x, y, z, 2 + Math.round(intensity * 2), false);
    setTopVoxel(room, x, z, MAT.SCORCHED, 0.5);
    deps.pulse(
      room,
      event,
      createPulse(event, signature, 'eruption', { x, y, z }, 4 + intensity * 2, intensity, 1.4),
    );
  }
  if (phase === 'climax' && !runtime.giantSpawned) {
    runtime.giantSpawned = true;
    for (let dz = -8; dz <= 8; dz += 2) {
      for (let x = cx - halfLen; x <= cx + halfLen; x += 6) {
        const z = cz + dz;
        const y = groundWorldY(room, x, z);
        deps.carve(room, x, y, z, 2, false);
        setTopVoxel(room, x, z, MAT.LAVA, 0.7);
      }
    }
    deps.pulse(
      room,
      event,
      createPulse(
        event,
        signature,
        'shockwave',
        { x: cx, y: event.center[1], z: cz },
        44,
        1,
        2.4,
      ),
    );
    deps.spawnCore(
      room,
      event,
      { x: cx, y: event.center[1] + 1, z: cz + 8 },
      'Obsidiana primordial',
      55,
    );
  }
}

function glacierTick(
  room: EventRoomLike,
  event: MapEventState,
  dt: number,
  intensity: number,
  phase: EventPhase,
): void {
  const width = room.dimX * VOXEL_SIZE;
  const depth = room.dimZ * VOXEL_SIZE;
  const total = Math.max(1, event.totalDurationSec);
  const progress = clamp(1 - event.durationRemainingSec / total, 0, 1);
  const wallX = clamp(8 + progress * (width - 16), 8, width - 8);
  event.center[0] = wallX;
  event.center[1] = groundWorldY(room, wallX, depth * 0.5);
  event.center[2] = depth * 0.5;
  for (const player of room.players.values()) {
    if (!player.alive) continue;
    if (Math.abs(player.position.x - wallX) > 12) continue;
    if (!hasRelic(player, 'frost_heart')) {
      player.freezeUntil = Math.max(player.freezeUntil ?? 0, Date.now() + 450);
    }
    player.velocity.x += (3 + intensity * 4) * dt;
    if (phase === 'climax') player.velocity.y += 1.4 * dt;
  }
}

function glacierPulse(
  room: EventRoomLike,
  event: MapEventState,
  signature: EventSignature,
  deps: EventEngineDeps,
  runtime: EventRuntime,
  intensity: number,
  phase: EventPhase,
): void {
  const wallX = event.center[0];
  const depth = room.dimZ * VOXEL_SIZE;
  for (let i = 0; i < 42; i++) {
    const z = 8 + Math.random() * (depth - 16);
    const x = wallX + (Math.random() - 0.5) * 8;
    setTopVoxel(room, x, z, Math.random() < 0.55 ? MAT.ICE : MAT.SNOW, 0.65);
  }
  for (const player of room.players.values()) {
    if (!player.alive) continue;
    const dist = Math.abs(player.position.x - wallX);
    if (dist > 10) continue;
    deps.damage(
      room,
      event,
      player,
      event.params.lethality * 0.18 * (1 - dist / 10),
      'geleira',
    );
  }
  const pulseZ = 10 + Math.random() * (depth - 20);
  deps.pulse(
    room,
    event,
    createPulse(
      event,
      signature,
      'hail',
      { x: wallX, y: event.center[1], z: pulseZ },
      10 + intensity * 5,
      intensity,
      1.4,
    ),
  );
  if (phase === 'climax' && !runtime.giantSpawned) {
    runtime.giantSpawned = true;
    deps.pulse(
      room,
      event,
      createPulse(
        event,
        signature,
        'wave',
        { x: wallX, y: event.center[1] + 4, z: event.center[2] },
        48,
        1,
        2.4,
      ),
    );
    deps.spawnCore(
      room,
      event,
      { x: wallX, y: event.center[1] + 1, z: event.center[2] },
      'Núcleo glacial',
      55,
    );
  }
}

function overgrowthTick(
  room: EventRoomLike,
  event: MapEventState,
  intensity: number,
): void {
  const radius = Math.max(20, event.params.radiusMeters || 50) * 0.6;
  for (const player of room.players.values()) {
    if (!player.alive) continue;
    const dist = Math.hypot(
      player.position.x - event.center[0],
      player.position.z - event.center[2],
    );
    if (dist > radius) continue;
    player.freezeUntil = Math.max(
      player.freezeUntil ?? 0,
      Date.now() + 220 + Math.round(intensity * 160),
    );
  }
}

function overgrowthPulse(
  room: EventRoomLike,
  event: MapEventState,
  signature: EventSignature,
  deps: EventEngineDeps,
  runtime: EventRuntime,
  intensity: number,
  phase: EventPhase,
): void {
  const radius = Math.max(24, event.params.radiusMeters || 60);
  const alive = Array.from(room.players.values()).filter((player) => player.alive);
  for (let i = 0; i < 8; i++) {
    let x: number;
    let z: number;
    if (i === 0 && alive.length > 0) {
      const anchor = alive[Math.floor(Math.random() * alive.length)];
      x = anchor.position.x + (Math.random() - 0.5) * 2;
      z = anchor.position.z + (Math.random() - 0.5) * 2;
    } else {
      const angle = Math.random() * Math.PI * 2;
      const dist = Math.random() * radius * 0.6;
      x = event.center[0] + Math.cos(angle) * dist;
      z = event.center[2] + Math.sin(angle) * dist;
    }
    growSpike(room, x, z, 2 + Math.round(intensity * 4), i % 2 === 0 ? MAT.WOOD : MAT.LEAVES);
    setTopVoxel(room, x, z, MAT.MOSS, 0.45);
    deps.pulse(
      room,
      event,
      createPulse(
        event,
        signature,
        'impact',
        { x, y: groundWorldY(room, x, z), z },
        4,
        intensity,
        1.0,
      ),
    );
    for (const player of room.players.values()) {
      if (!player.alive) continue;
      const playerDist = Math.hypot(player.position.x - x, player.position.z - z);
      if (playerDist > 4.5) continue;
      deps.damage(
        room,
        event,
        player,
        event.params.lethality * 0.16 * (1 - playerDist / 4.5),
        'vinhas',
      );
    }
  }

  if (phase === 'climax' && !runtime.giantSpawned) {
    runtime.giantSpawned = true;
    buildTitanTree(room, {
      x: event.center[0],
      y: event.center[1],
      z: event.center[2],
    });
    deps.pulse(
      room,
      event,
      createPulse(
        event,
        signature,
        'shockwave',
        { x: event.center[0], y: event.center[1] + 8, z: event.center[2] },
        46,
        1,
        2.6,
      ),
    );
    deps.spawnCore(
      room,
      event,
      { x: event.center[0] + 6, y: event.center[1] + 1, z: event.center[2] },
      'Semente da Árvore-Mundo',
      55,
    );
  }
}

const ENTITY_CORE_NAMES: Partial<Record<EventSignature, string>> = {
  alpha_pack: 'Presa do Alpha',
  stone_colossus: 'Núcleo de Pedra',
  panic_herd: 'Manada Dourada',
  detonating_swarm: 'Glândula Detonante',
  spider_nest: 'Seda da Rainha',
  hunter_squad: 'Núcleo de Drone',
  ice_titan: 'Núcleo de Gelo',
  serpent_nest: 'Saco de Veneno',
};

function eventEntities(room: EventRoomLike, event: MapEventState): EventEntityLike[] {
  return room.entities.filter((entity) => entity.eventId === event.id);
}

function nearestPlayer(
  room: EventRoomLike,
  position: Vec3,
): EventPlayerLike | null {
  let best: EventPlayerLike | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const player of room.players.values()) {
    if (!player.alive) continue;
    const dist = Math.hypot(player.position.x - position.x, player.position.z - position.z);
    if (dist < bestDist) {
      bestDist = dist;
      best = player;
    }
  }
  return best;
}

function entityTick(
  room: EventRoomLike,
  event: MapEventState,
  signature: EventSignature,
  dt: number,
  intensity: number,
  runtime: EventRuntime,
): void {
  const entities = eventEntities(room, event);
  const boss = entities.find((entity) => entity.id.startsWith('boss_'));
  if (boss) {
    runtime.bossPosition = { x: boss.position.x, y: boss.position.y, z: boss.position.z };
  }

  if (signature === 'spider_nest') {
    for (const entity of entities) {
      for (const player of room.players.values()) {
        if (!player.alive) continue;
        const dist = Math.hypot(
          player.position.x - entity.position.x,
          player.position.z - entity.position.z,
        );
        if (dist < 3.2) {
          player.freezeUntil = Math.max(player.freezeUntil ?? 0, Date.now() + 260);
        }
      }
    }
  } else if (signature === 'ice_titan') {
    if (boss) {
      for (const player of room.players.values()) {
        if (!player.alive) continue;
        const dist = Math.hypot(
          player.position.x - boss.position.x,
          player.position.z - boss.position.z,
        );
        if (dist < 14 && !hasRelic(player, 'frost_heart')) {
          player.freezeUntil = Math.max(player.freezeUntil ?? 0, Date.now() + 350);
        }
      }
    }
  } else if (signature === 'panic_herd') {
    for (const entity of entities) {
      for (const player of room.players.values()) {
        if (!player.alive) continue;
        const dx = player.position.x - entity.position.x;
        const dz = player.position.z - entity.position.z;
        const dist = Math.hypot(dx, dz);
        if (dist > 2.2 || dist < 0.1) continue;
        player.velocity.x += (dx / dist) * 2.4 * dt;
        player.velocity.z += (dz / dist) * 2.4 * dt;
        player.velocity.y += 0.8 * dt;
      }
    }
  } else if (signature === 'hunter_squad') {
    for (const entity of entities) {
      const vx = Math.floor(entity.position.x / VOXEL_SIZE);
      const vz = Math.floor(entity.position.z / VOXEL_SIZE);
      const ground = getGroundVoxelY(room.grid, vx, vz);
      const targetY = (ground + 5) * VOXEL_SIZE;
      if (entity.position.y < targetY) {
        entity.velocity.y += (targetY - entity.position.y) * 6 * dt + 24 * dt;
      }
    }
  }

  void intensity;
}

function entityPulse(
  room: EventRoomLike,
  event: MapEventState,
  signature: EventSignature,
  deps: EventEngineDeps,
  runtime: EventRuntime,
  intensity: number,
  phase: EventPhase,
): void {
  const entities = eventEntities(room, event);
  const boss = entities.find((entity) => entity.id.startsWith('boss_'));
  const coreName = ENTITY_CORE_NAMES[signature] ?? 'Núcleo do evento';

  if (signature === 'alpha_pack') {
    const center = boss?.position ?? { x: event.center[0], y: event.center[1], z: event.center[2] };
    deps.pulse(
      room,
      event,
      createPulse(event, signature, 'roar', center, 30 + intensity * 15, intensity, 1.6),
    );
    if (boss) {
      boss.hp = Math.min(boss.maxHp, boss.hp + (phase === 'climax' ? 45 : 8));
    }
    for (const player of room.players.values()) {
      if (!player.alive) continue;
      const dist = Math.hypot(player.position.x - center.x, player.position.z - center.z);
      if (dist > 18) continue;
      deps.damage(room, event, player, event.params.lethality * 0.08, 'matilha Alpha');
    }
  } else if (signature === 'stone_colossus') {
    const center = boss?.position ?? { x: event.center[0], y: event.center[1], z: event.center[2] };
    deps.pulse(
      room,
      event,
      createPulse(event, signature, 'shockwave', center, 16 + intensity * 8, intensity, 1.8),
    );
    for (const player of room.players.values()) {
      if (!player.alive) continue;
      const dx = player.position.x - center.x;
      const dz = player.position.z - center.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 16) continue;
      const falloff = 1 - dist / 16;
      deps.damage(room, event, player, event.params.lethality * 0.24 * falloff, 'pisada do colosso');
      const inv = 1 / Math.max(0.001, dist);
      player.velocity.x += dx * inv * 6 * falloff;
      player.velocity.z += dz * inv * 6 * falloff;
      player.velocity.y += 4 * falloff;
    }
  } else if (signature === 'panic_herd') {
    const sample = entities[Math.floor(Math.random() * Math.max(1, entities.length))];
    const point = sample?.position ?? { x: event.center[0], y: event.center[1], z: event.center[2] };
    deps.pulse(
      room,
      event,
      createPulse(event, signature, 'debris', point, 8, intensity, 1.2),
    );
    for (const player of room.players.values()) {
      if (!player.alive) continue;
      const dist = Math.hypot(player.position.x - point.x, player.position.z - point.z);
      if (dist > 6) continue;
      deps.damage(room, event, player, event.params.lethality * 0.06 * (1 - dist / 6), 'estampede');
    }
    if (phase === 'climax' && !runtime.coreSpawned) {
      runtime.coreSpawned = true;
      deps.spawnCore(room, event, point, coreName, 45);
    }
  } else if (signature === 'detonating_swarm') {
    const sample = entities[Math.floor(Math.random() * Math.max(1, entities.length))];
    const point = sample?.position ?? { x: event.center[0], y: event.center[1], z: event.center[2] };
    deps.pulse(room, event, createPulse(event, signature, 'impact', point, 7, intensity, 1.2));
    for (const player of room.players.values()) {
      if (!player.alive) continue;
      const dist = Math.hypot(player.position.x - point.x, player.position.z - point.z);
      if (dist > 7) continue;
      deps.damage(room, event, player, event.params.lethality * 0.2 * (1 - dist / 7), 'kamikaze');
    }
    if (boss && phase === 'climax') boss.hp = boss.maxHp;
  } else if (signature === 'spider_nest') {
    const sample = entities[Math.floor(Math.random() * Math.max(1, entities.length))];
    const point = sample?.position ?? { x: event.center[0], y: event.center[1], z: event.center[2] };
    deps.pulse(room, event, createPulse(event, signature, 'impact', point, 6, intensity, 1.1));
    for (const player of room.players.values()) {
      if (!player.alive) continue;
      const dist = Math.hypot(player.position.x - point.x, player.position.z - point.z);
      if (dist > 6) continue;
      player.freezeUntil = Math.max(player.freezeUntil ?? 0, Date.now() + 800);
      deps.damage(room, event, player, event.params.lethality * 0.12, 'teia');
    }
  } else if (signature === 'hunter_squad') {
    const target = nearestPlayer(room, boss?.position ?? { x: event.center[0], y: event.center[1], z: event.center[2] })
      ?? nearestPlayer(room, { x: event.center[0], y: event.center[1], z: event.center[2] });
    if (target) {
      deps.pulse(
        room,
        event,
        createPulse(
          event,
          signature,
          'lightning',
          { x: target.position.x, y: target.position.y + 1, z: target.position.z },
          4,
          intensity,
          0.9,
        ),
      );
      deps.damage(room, event, target, event.params.lethality * 0.18, 'laser de drone');
    }
  } else if (signature === 'ice_titan') {
    const center = boss?.position ?? { x: event.center[0], y: event.center[1], z: event.center[2] };
    deps.pulse(room, event, createPulse(event, signature, 'hail', center, 14, intensity, 1.4));
    for (const player of room.players.values()) {
      if (!player.alive) continue;
      const dist = Math.hypot(player.position.x - center.x, player.position.z - center.z);
      if (dist > 14) continue;
      const falloff = 1 - dist / 14;
      deps.damage(room, event, player, event.params.lethality * 0.16 * falloff, 'estilhaço glacial');
      if (!hasRelic(player, 'frost_heart')) {
        player.freezeUntil = Math.max(player.freezeUntil ?? 0, Date.now() + 600);
      }
    }
    if (phase === 'climax' && !runtime.coreSpawned) {
      runtime.coreSpawned = true;
      deps.spawnCore(room, event, center, coreName, 55);
    }
  } else if (signature === 'serpent_nest') {
    const target = nearestPlayer(room, boss?.position ?? { x: event.center[0], y: event.center[1], z: event.center[2] });
    const point = target
      ? { x: target.position.x, y: target.position.y, z: target.position.z }
      : { x: event.center[0], y: event.center[1], z: event.center[2] };
    setTopVoxel(room, point.x, point.z, MAT.SLUDGE, 0.8);
    deps.pulse(room, event, createPulse(event, signature, 'eruption', point, 5, intensity, 1.3));
    for (const player of room.players.values()) {
      if (!player.alive) continue;
      const dist = Math.hypot(player.position.x - point.x, player.position.z - point.z);
      if (dist > 5) continue;
      deps.damage(room, event, player, event.params.lethality * 0.16 * (1 - dist / 5), 'veneno');
    }
  }

  if (!runtime.coreSpawned) {
    if (!boss && runtime.bossPosition) {
      runtime.coreSpawned = true;
      deps.spawnCore(room, event, runtime.bossPosition, coreName, 50);
    } else if (phase === 'climax' && !boss && entities.length === 0) {
      runtime.coreSpawned = true;
      deps.spawnCore(
        room,
        event,
        { x: event.center[0], y: event.center[1] + 1, z: event.center[2] },
        coreName,
        50,
      );
    }
  }
}

function supplyTick(
  room: EventRoomLike,
  event: MapEventState,
  signature: EventSignature,
  dt: number,
  intensity: number,
): void {
  if (signature !== 'emergency_beacon') return;
  for (const player of room.players.values()) {
    if (!player.alive) continue;
    const dist = Math.hypot(
      player.position.x - event.center[0],
      player.position.z - event.center[2],
    );
    if (dist > 14) continue;
    player.hp = Math.min(100, player.hp + (2 + intensity * 3) * dt);
  }
}

function supplyPulse(
  room: EventRoomLike,
  event: MapEventState,
  signature: EventSignature,
  deps: EventEngineDeps,
  runtime: EventRuntime,
  intensity: number,
  phase: EventPhase,
): void {
  const crate = room.entities.find(
    (entity) => entity.eventId === event.id && entity.hp > 0,
  );
  const center = crate?.position ?? {
    x: event.center[0],
    y: event.center[1],
    z: event.center[2],
  };

  if (signature === 'supply_barrage') {
    runtime.supplyDrops = runtime.supplyDrops ?? 0;
    if (runtime.supplyDrops < 6) {
      runtime.supplyDrops += 1;
      const angle = Math.random() * Math.PI * 2;
      const distance = 6 + Math.random() * Math.max(20, event.params.radiusMeters * 0.5);
      const x = center.x + Math.cos(angle) * distance;
      const z = center.z + Math.sin(angle) * distance;
      deps.spawnCore(
        room,
        event,
        { x, y: 36, z },
        'Cápsula de Suprimentos',
        35,
        120,
        null,
      );
      deps.pulse(
        room,
        event,
        createPulse(event, signature, 'impact', { x, y: 36, z }, 5, intensity, 1.4),
      );
    }
    if (phase === 'climax' && !runtime.coreSpawned) {
      runtime.coreSpawned = true;
      deps.spawnCore(
        room,
        event,
        { x: event.center[0], y: 40, z: event.center[2] },
        'Carga Máxima',
        80,
        220,
      );
      deps.pulse(
        room,
        event,
        createPulse(
          event,
          signature,
          'wave',
          { x: event.center[0], y: 20, z: event.center[2] },
          24,
          1,
          2.2,
        ),
      );
    }
    return;
  }

  if (signature === 'armored_depot') {
    deps.pulse(room, event, createPulse(event, signature, 'shockwave', center, 14, intensity, 1.8));
    for (const player of room.players.values()) {
      if (!player.alive) continue;
      const dist = Math.hypot(player.position.x - center.x, player.position.z - center.z);
      if (dist > 10) continue;
      player.velocity.y += 2.5 * (1 - dist / 10);
    }
    return;
  }

  if (signature === 'legendary_drop') {
    deps.pulse(room, event, createPulse(event, signature, 'wave', center, 20, intensity, 2.0));
    deps.pulse(
      room,
      event,
      createPulse(event, signature, 'impact', { x: center.x, y: center.y + 12, z: center.z }, 6, intensity, 1.2),
    );
    return;
  }

  if (signature === 'treasure_vault') {
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2;
      setTopVoxel(
        room,
        center.x + Math.cos(angle) * (4 + Math.random() * 3),
        center.z + Math.sin(angle) * (4 + Math.random() * 3),
        MAT.GOLD,
        0.45,
      );
    }
    deps.pulse(room, event, createPulse(event, signature, 'impact', center, 6, intensity, 1.2));
    for (const player of room.players.values()) {
      if (!player.alive) continue;
      const dist = Math.hypot(player.position.x - center.x, player.position.z - center.z);
      if (dist > 4.5) continue;
      deps.damage(room, event, player, event.params.lethality * 0.12 * (1 - dist / 4.5), 'armadilha do cofre');
    }
    return;
  }

  // emergency_beacon
  for (const player of room.players.values()) {
    if (!player.alive) continue;
    const dist = Math.hypot(
      player.position.x - event.center[0],
      player.position.z - event.center[2],
    );
    if (dist > 16) continue;
    player.hp = Math.min(100, player.hp + 10 + intensity * 10);
  }
  deps.pulse(
    room,
    event,
    createPulse(
      event,
      signature,
      'wave',
      { x: event.center[0], y: event.center[1] + 1, z: event.center[2] },
      18,
      intensity,
      2.0,
    ),
  );
}

function sceneryTick(
  room: EventRoomLike,
  event: MapEventState,
  signature: EventSignature,
  dt: number,
  intensity: number,
): void {
  const height = (SCENERY_HEIGHTS[signature] ?? 12) *
    Math.max(0, Math.min(1, 1 - event.durationRemainingSec / Math.max(1, event.totalDurationSec)));
  const footprint = Math.max(6, Math.min(18, event.params.radiusMeters * 0.32));
  const ground = groundWorldY(room, event.center[0], event.center[2]);
  for (const player of room.players.values()) {
    if (!player.alive) continue;
    const dx = player.position.x - event.center[0];
    const dz = player.position.z - event.center[2];
    const dist = Math.hypot(dx, dz);
    if (dist > footprint || dist < 0.1) continue;
    if (player.position.y > ground + height + 1.2) continue;
    player.velocity.x += (dx / dist) * (2 + intensity * 3) * dt;
    player.velocity.z += (dz / dist) * (2 + intensity * 3) * dt;
    player.velocity.y += 1.5 * dt;
  }
}

function sceneryPulse(
  room: EventRoomLike,
  event: MapEventState,
  signature: EventSignature,
  deps: EventEngineDeps,
  runtime: EventRuntime,
  intensity: number,
  phase: EventPhase,
): void {
  const center = { x: event.center[0], y: event.center[1], z: event.center[2] };
  const ground = groundWorldY(room, center.x, center.z);
  const footprint = Math.max(6, Math.min(18, event.params.radiusMeters * 0.32));
  const coreName = SCENERY_CORE_NAMES[signature] ?? 'Relíquia da Estrutura';
  const height = SCENERY_HEIGHTS[signature] ?? 12;

  if (signature === 'titan_tree' || signature === 'maze_grove') {
    for (let i = 0; i < 10; i++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = footprint * (0.5 + Math.random() * 0.8);
      const x = center.x + Math.cos(angle) * dist;
      const z = center.z + Math.sin(angle) * dist;
      growSpike(
        room,
        x,
        z,
        3 + Math.round(intensity * 5),
        i % 2 === 0 ? MAT.WOOD : MAT.LEAVES,
      );
      setTopVoxel(room, x, z, MAT.MOSS, 0.5);
    }
    deps.pulse(
      room,
      event,
      createPulse(event, signature, 'debris', { x: center.x, y: ground, z: center.z }, footprint, intensity, 1.6),
    );
  } else if (signature === 'lost_temple') {
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2;
      setTopVoxel(
        room,
        center.x + Math.cos(angle) * (5 + Math.random() * 4),
        center.z + Math.sin(angle) * (5 + Math.random() * 4),
        i % 2 === 0 ? MAT.GOLD : MAT.TERRACOTTA,
        0.55,
      );
    }
    deps.pulse(
      room,
      event,
      createPulse(event, signature, 'eruption', { x: center.x, y: ground, z: center.z }, footprint, intensity, 1.8),
    );
  } else {
    deps.pulse(
      room,
      event,
      createPulse(
        event,
        signature,
        signature === 'colossal_tower' ? 'hail' : 'impact',
        { x: center.x, y: ground, z: center.z },
        footprint,
        intensity,
        1.5,
      ),
    );
    if (signature === 'colossal_tower') {
      for (let i = 0; i < 4; i++) {
        const angle = Math.random() * Math.PI * 2;
        const dist = footprint * (0.5 + Math.random());
        const x = center.x + Math.cos(angle) * dist;
        const z = center.z + Math.sin(angle) * dist;
        deps.pulse(
          room,
          event,
          createPulse(
            event,
            signature,
            'hail',
            { x, y: ground + 20 + Math.random() * 20, z },
            4,
            intensity,
            1.6,
          ),
        );
        for (const player of room.players.values()) {
          if (!player.alive) continue;
          const playerDist = Math.hypot(player.position.x - x, player.position.z - z);
          if (playerDist > 5) continue;
          deps.damage(
            room,
            event,
            player,
            event.params.lethality * 0.14 * (1 - playerDist / 5),
            'vidro do arranha-céu',
          );
        }
      }
    }
  }

  for (const player of room.players.values()) {
    if (!player.alive) continue;
    const dist = Math.hypot(player.position.x - center.x, player.position.z - center.z);
    if (dist > footprint) continue;
    deps.damage(
      room,
      event,
      player,
      event.params.lethality * 0.16 * (1 - dist / footprint),
      'estrutura emergente',
    );
    player.velocity.y += 3.5 * (1 - dist / footprint);
  }

  if (phase === 'climax' && !runtime.coreSpawned) {
    runtime.coreSpawned = true;
    deps.pulse(
      room,
      event,
      createPulse(
        event,
        signature,
        'shockwave',
        { x: center.x, y: ground + height * 0.5, z: center.z },
        footprint * 1.6,
        1,
        2.2,
      ),
    );
    deps.spawnCore(
      room,
      event,
      { x: center.x, y: ground + height + 2, z: center.z },
      coreName,
      60,
      150,
    );
  }
}

export function updateEpicEvent(
  room: EventRoomLike,
  event: MapEventState,
  dt: number,
  deps: EventEngineDeps,
): boolean {
  const signature = signatureForEvent(event.archetype, event.params, event.catalogId);
  if (!EPIC_SIGNATURES.has(signature)) return false;

  const runtime = runtimeFor(event);
  const total = Math.max(1, event.totalDurationSec || 1);
  const progress = clamp(1 - Math.max(0, event.durationRemainingSec) / total, 0, 1);
  const phase = phaseForEvent(event);
  runtime.phase = phase;
  event.phase = phase;
  event.intensity = intensityForEvent(event.params);
  event.epicScale = epicScaleForEvent(event.params);
  const intensity = event.intensity;

  if (signature === 'multi_vortex') {
    const centers = tornadoCenters(room, event, phase);
    applyTornadoForces(room, event, dt, centers, intensity);
    if (Math.random() < dt * 0.15) {
      // Rajadas de destroço no ar, mesmo entre pulsos de dano.
      const center = centers[0];
      deps.pulse(
        room,
        event,
        createPulse(
          event,
          signature,
          'debris',
          {
            x: center.x + (Math.random() - 0.5) * 30,
            y: center.y + 2 + Math.random() * 10,
            z: center.z + (Math.random() - 0.5) * 30,
          },
          1.5,
          intensity,
          1.2,
        ),
      );
    }
  } else if (signature === 'whiteout') {
    whiteoutTick(room, dt, intensity);
  } else if (signature === 'gravity_collapse') {
    gravityTick(room, event, dt, intensity, phase);
  } else if (signature === 'sand_wall') {
    sandWallTick(room, event, dt, intensity, phase);
  } else if (signature === 'sinkhole_maw') {
    sinkholeTick(room, event, dt, intensity, phase);
  } else if (signature === 'lava_river') {
    lavaRiverTick(room, event, dt, deps);
  } else if (signature === 'glacier_advance') {
    glacierTick(room, event, dt, intensity, phase);
  } else if (signature === 'overgrowth_titan') {
    overgrowthTick(room, event, intensity);
  } else if (ENTITY_SIGNATURES.has(signature)) {
    entityTick(room, event, signature, dt, intensity, runtime);
  } else if (SUPPLY_SIGNATURES.has(signature)) {
    supplyTick(room, event, signature, dt, intensity);
  } else if (SCENERY_SIGNATURES.has(signature)) {
    sceneryTick(room, event, signature, dt, intensity);
  }

  // Impactos agendados (meteoro gigante) vencem independentemente do pulso.
  for (let i = runtime.pending.length - 1; i >= 0; i--) {
    const pending = runtime.pending[i];
    if (room.elapsedSec < pending.dueElapsedSec) continue;
    runtime.pending.splice(i, 1);
    deps.pulse(
      room,
      event,
      createPulse(
        event,
        signature,
        'impact',
        pending.position,
        pending.radius,
        intensity,
        1.5,
      ),
    );
    deps.carve(room, pending.position.x, pending.position.y, pending.position.z, 8, true);
    for (const player of room.players.values()) {
      if (!player.alive) continue;
      const dist = Math.hypot(
        player.position.x - pending.position.x,
        player.position.z - pending.position.z,
      );
      if (dist > pending.radius) continue;
      deps.damage(room, event, player, pending.amount * (1 - dist / pending.radius), 'meteoro');
    }
  }

  runtime.pulseAccum += dt;
  const interval = pulseIntervalForSignature(signature, phase);
  if (runtime.pulseAccum < interval) return true;
  runtime.pulseAccum = 0;

  if (signature === 'multi_vortex') {
    const centers = tornadoCenters(room, event, phase);
    damageCore(room, event, deps, centers, intensity);
    if (phase === 'climax' || phase === 'impact') {
      deps.pulse(
        room,
        event,
        createPulse(
          event,
          signature,
          'roar',
          { x: centers[0].x, y: centers[0].y + 6, z: centers[0].z },
          Math.max(24, event.params.radiusMeters || 70),
          intensity,
          1.8,
        ),
      );
    }
  } else if (signature === 'orbital_barrage') {
    meteorPulse(room, event, signature, deps, runtime, intensity, progress);
    if (phase === 'climax' && !runtime.giantSpawned) {
      const point = pickImpactPoint(room, Math.max(24, event.params.radiusMeters || 60), 0.35);
      const y = groundWorldY(room, point.x, point.z);
      runtime.pending.push({
        dueElapsedSec: room.elapsedSec + 1.6,
        position: { x: point.x, y, z: point.z },
        radius: 11,
        amount: event.params.lethality * 0.75,
      });
      deps.pulse(
        room,
        event,
        createPulse(
          event,
          signature,
          'telegraph',
          { x: point.x, y: y + 24, z: point.z },
          9,
          1,
          1.8,
        ),
      );
    }
  } else if (signature === 'volcano_birth') {
    volcanoPulse(room, event, signature, deps, runtime, intensity, phase);
  } else if (signature === 'whiteout') {
    whiteoutPulse(room, event, signature, deps, intensity);
  } else if (signature === 'acid_corrosion') {
    acidPulse(room, event, signature, deps, intensity, phase);
  } else if (signature === 'quake_collapse') {
    quakePulse(room, event, signature, deps, runtime, intensity, phase);
  } else if (signature === 'gravity_collapse') {
    const radius = Math.max(24, event.params.radiusMeters || 70);
    deps.pulse(
      room,
      event,
      createPulse(
        event,
        signature,
        'roar',
        { x: event.center[0], y: event.center[1] + 8, z: event.center[2] },
        radius,
        intensity,
        1.8,
      ),
    );
    if (phase === 'climax') {
      for (const player of room.players.values()) {
        if (!player.alive) continue;
        const dist = Math.hypot(
          player.position.x - event.center[0],
          player.position.z - event.center[2],
        );
        if (dist > radius * 0.35) continue;
        deps.damage(
          room,
          event,
          player,
          event.params.lethality * 0.1 * (1 - dist / (radius * 0.35)),
          'colapso gravitacional',
        );
        player.velocity.y += 5;
      }
    }
  } else if (signature === 'sand_wall') {
    sandWallPulse(room, event, signature, deps, intensity);
  } else if (signature === 'supercell') {
    supercellPulse(room, event, signature, deps, intensity, phase);
  } else if (signature === 'hail_barrage') {
    hailPulse(room, event, signature, deps, intensity, phase);
  } else if (signature === 'canyon_tear') {
    canyonPulse(room, event, signature, deps, runtime, intensity, phase);
  } else if (signature === 'crystal_bloom') {
    crystalPulse(room, event, signature, deps, runtime, intensity, phase);
  } else if (signature === 'tsunami_surge') {
    tsunamiPulse(room, event, signature, deps, runtime, intensity, phase);
  } else if (signature === 'sinkhole_maw') {
    sinkholePulse(room, event, signature, deps, runtime, intensity, phase);
  } else if (signature === 'lava_river') {
    lavaRiverPulse(room, event, signature, deps, runtime, intensity, phase);
  } else if (signature === 'glacier_advance') {
    glacierPulse(room, event, signature, deps, runtime, intensity, phase);
  } else if (signature === 'overgrowth_titan') {
    overgrowthPulse(room, event, signature, deps, runtime, intensity, phase);
  } else if (ENTITY_SIGNATURES.has(signature)) {
    entityPulse(room, event, signature, deps, runtime, intensity, phase);
  } else if (SUPPLY_SIGNATURES.has(signature)) {
    supplyPulse(room, event, signature, deps, runtime, intensity, phase);
  } else if (SCENERY_SIGNATURES.has(signature)) {
    sceneryPulse(room, event, signature, deps, runtime, intensity, phase);
  }

  return true;
}

/** Exposto para testes: limpa o runtime de um evento recriado. */
export function resetEpicEventRuntime(event: MapEventState): void {
  runtimes.delete(event);
}

/** Helper puro usado pelo cliente/testes: força tangencial de um vórtice. */
export function vortexForceAt(
  center: Vec3,
  position: Vec3,
  radius: number,
  intensity: number,
): { x: number; z: number; lift: number } {
  const dx = center.x - position.x;
  const dz = center.z - position.z;
  const dist = Math.hypot(dx, dz);
  if (dist > radius || dist < 0.001) return { x: 0, z: 0, lift: 0 };
  const falloff = 1 - dist / radius;
  const inv = 1 / dist;
  return {
    x: (-dz * inv * 0.82 + dx * inv * 0.38) * (7 + intensity * 16) * falloff,
    z: (dx * inv * 0.82 + dz * inv * 0.38) * (7 + intensity * 16) * falloff,
    lift: (2.4 + falloff * 7.5) * falloff,
  };
}
