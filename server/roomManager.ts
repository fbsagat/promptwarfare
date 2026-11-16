import { WebSocket } from 'ws';
import {
  BOT_EVENT_WINDOW_SEC,
  computeGrappleOutcome,
  computeIslandDimensions,
  computePlayerMassKg,
  EVENT_CYCLE_COOLDOWN_SEC,
  EVENT_RAFFLE_WINDOW_SEC,
  EVENT_WRITE_WINDOW_SEC,
  GRAPPLE_MASS_KG,
  SHOVEL_MASS_KG,
  WEAPON_CYCLE_COOLDOWN_SEC,
  WEAPON_INITIAL_COOLDOWN_SEC,
  WEAPON_TIMEOUT_COOLDOWN_SEC,
  WEAPON_WRITE_WINDOW_SEC,
} from '../src/shared/budget.ts';
import {
  MAT,
  VOXEL_SIZE,
  WATER_LEVEL_WORLD,
  type ClientInputPacket,
  type EventCyclePhase,
  type EventCycleState,
  type InventorySlotItem,
  type KillfeedEntry,
  type LootDropState,
  type MapEventComponent,
  type MapEventState,
  type PlayerNetState,
  type ProjectileNetState,
  type PromptKind,
  type RoomInitPayload,
  type RoomMatchSummary,
  type RoomTickPayload,
  type SpawnedEntityNetState,
  type Vec3,
  type VoxelDelta,
  type WeaponBlueprint,
} from '../src/shared/types.ts';
import type {
  DevActionPayload,
  DevRoomState,
  LobbyStatePayload,
  RoomAccessMode,
  RoomPublicSummary,
} from '../src/shared/types.ts';
import { isServerDevEnabled } from '../src/shared/devMode.ts';
import {
  carveSphere,
  collapseFloatingClusters,
  createProceduralIsland,
  findSafeSpawnPositions,
  getGroundVoxelY,
  overlapsSolid,
  raycastVoxels,
  resolvePlayerMovement,
  VoxelGrid,
} from '../src/shared/voxelWorld.ts';
import { getAssetVersion } from './assets.ts';
import {
  getCatalog,
  getCatalogItem,
  getCatalogItemName,
  getCatalogVersion,
  resolveEventFromCatalog,
  resolveWeaponFromCatalog,
} from './catalog.ts';
import {
  buildContentPool,
  summarizeContentPool,
  type ContentPool,
} from './contentPool.ts';
import {
  type LedgerPhase,
  type LedgerPromptKind,
  type LedgerSink,
  type PromptLedgerEvent,
} from './ledger.ts';
import {
  createBotBrainState,
  createBotPersonality,
  notifyBotDamaged,
  rotateAngleTowards,
  stepBotBrain,
  type BotBrainState,
} from '../src/shared/botBrain.ts';

export interface SocketLike {
  readyState?: number;
  send(data: string): void;
}

interface ServerPlayer extends PlayerNetState {
  ws: SocketLike | null;
  joinedAt: number;
  lastFireMs: number;
  moveX: number;
  moveZ: number;
  jumpQueued: boolean;
  botTargetId: string | null;
  botThinkTimer: number;
  botForgePrompted: boolean;
  botBrain: BotBrainState | null;
  grappleTimerSec: number;
  grappleMode: 'pull_self' | 'pull_target' | null;
  grappleTargetId: string | null;
  promptSessionId: string | null;
  promptOpenedAt: number | null;
  promptOpenWindowStart: number;
  promptOpenCount: number;
  feedbackWindowStart: number;
  feedbackCount: number;
}

interface ServerProjectile extends ProjectileNetState {
  bouncesLeft: number;
  pierceLeft: number;
  stickyTimerSec: number;
  stuck: boolean;
}

interface GameRoom {
  id: string;
  name: string;
  hostId: string;
  matchId: string;
  accessMode: RoomAccessMode;
  password: string;
  createdAt: number;
  seed: number;
  contentPool: ContentPool | null;
  dimX: number;
  dimY: number;
  dimZ: number;
  targetPlayers: number;
  fillWithBots: boolean;
  grid: VoxelGrid;
  deltas: VoxelDelta[];
  pendingTickDeltas: VoxelDelta[];
  players: Map<string, ServerPlayer>;
  projectiles: ServerProjectile[];
  lootDrops: LootDropState[];
  entities: SpawnedEntityNetState[];
  activeEvents: MapEventState[];
  eventPhase: EventCyclePhase;
  eventEndsAt: number;
  eventCooldownSec: number;
  rafflePlayerId: string | null;
  rafflePlayerName: string | null;
  rafflePendingIsBot: boolean;
  raffleRemainingSec: number;
  phase: 'lobby' | 'playing' | 'ended';
  elapsedSec: number;
  lastKillElapsedSec: number;
  stagnationLevel: number;
  eventsTriggered: number;
  totalKills: number;
  tickTimer: ReturnType<typeof setInterval> | null;
  weatherTickAccum: number;
  summary?: RoomMatchSummary;
  devGodMode: boolean;
  devInfiniteSandbox: boolean;
  devBotsFrozen: boolean;
}

const PROMPT_OPEN_RATE_LIMIT = 12;
const PROMPT_OPEN_RATE_WINDOW_MS = 10_000;
const FEEDBACK_RATE_LIMIT = 10;
const FEEDBACK_RATE_WINDOW_MS = 10_000;

const PLAYER_COLORS = [
  '#38bdf8',
  '#f59e0b',
  '#34d399',
  '#fb7185',
  '#a78bfa',
  '#facc15',
  '#2dd4bf',
  '#f97316',
  '#60a5fa',
  '#e879f9',
  '#4ade80',
  '#f43f5e',
  '#22d3ee',
  '#fbbf24',
];

const BOT_EVENT_PROMPTS = [
  'Chuva de meteoros flamejantes',
  'Matilha de lobos robos agressivos',
  'Caixas de municao caindo de paraquedas',
  'Terremoto na ilha',
  'Nevasca congelante',
  'Pilares gigantes de cristal surgindo do chao',
];

function createStarterSlots(): (InventorySlotItem | null)[] {
  return [
    {
      id: `shv_${Math.random().toString(36).slice(2, 7)}`,
      kind: 'shovel',
      name: 'Pá Escavadora',
      massKg: SHOVEL_MASS_KG,
    },
    {
      id: `grp_${Math.random().toString(36).slice(2, 7)}`,
      kind: 'grapple',
      name: 'Gancho Puxador',
      massKg: GRAPPLE_MASS_KG,
    },
    null,
    null,
  ];
}

function closestPointOnSegmentT(
  px: number,
  py: number,
  pz: number,
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
): { distSq: number; t: number } {
  const abx = bx - ax;
  const aby = by - ay;
  const abz = bz - az;
  const lenSq = abx * abx + aby * aby + abz * abz;
  if (lenSq <= 1e-8) {
    const dx = px - ax;
    const dy = py - ay;
    const dz = pz - az;
    return { distSq: dx * dx + dy * dy + dz * dz, t: 0 };
  }
  const t = Math.max(0, Math.min(1, ((px - ax) * abx + (py - ay) * aby + (pz - az) * abz) / lenSq));
  const cx = ax + abx * t;
  const cy = ay + aby * t;
  const cz = az + abz * t;
  const dx = px - cx;
  const dy = py - cy;
  const dz = pz - cz;
  return { distSq: dx * dx + dy * dy + dz * dz, t };
}

export class RoomManager {
  private rooms = new Map<string, GameRoom>();
  private readonly devEnabled: boolean;
  private readonly ledger: LedgerSink | null;
  private usageWeights: Record<string, number> = {};

  constructor(opts: { devEnabled?: boolean; ledger?: LedgerSink | null } = {}) {
    this.devEnabled = opts.devEnabled ?? isServerDevEnabled();
    this.ledger = opts.ledger ?? null;
  }

  setUsageWeights(weights: Record<string, number>): void {
    this.usageWeights = { ...weights };
  }

  isDevModeEnabled(): boolean {
    return this.devEnabled;
  }

  private sanitizeRoomId(raw?: string): string {
    return (raw || '')
      .toUpperCase()
      .replace(/[^A-Z0-9_-]/g, '')
      .slice(0, 12);
  }

  private generateUniqueRoomId(): string {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    for (let attempt = 0; attempt < 24; attempt++) {
      let code = '';
      for (let i = 0; i < 6; i++) {
        code += alphabet[Math.floor(Math.random() * alphabet.length)];
      }
      const existing = this.rooms.get(code);
      if (!existing || existing.phase === 'ended') return code;
    }
    return `ARENA${Math.floor(100 + Math.random() * 899)}`;
  }

  private sendSocketMsg(ws: SocketLike | null, msg: unknown): void {
    if (!ws) return;
    if (ws.readyState !== undefined && ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify(msg));
  }

  private sendRoomError(
    ws: SocketLike | null,
    code: string,
    message: string,
    extra: Record<string, unknown> = {},
  ): void {
    this.sendSocketMsg(ws, {
      type: 'room:error',
      payload: { code, message, ...extra },
    });
  }

  getRuntimeStats(): {
    rooms: number;
    playing: number;
    lobby: number;
    humans: number;
    bots: number;
  } {
    let playing = 0;
    let lobby = 0;
    let humans = 0;
    let bots = 0;
    for (const room of this.rooms.values()) {
      if (room.phase === 'playing') playing += 1;
      else if (room.phase === 'lobby') lobby += 1;
      for (const player of room.players.values()) {
        if (player.isBot) bots += 1;
        else if (player.ws !== null) humans += 1;
      }
    }
    return { rooms: this.rooms.size, playing, lobby, humans, bots };
  }

  getRoomList(): RoomPublicSummary[] {
    return Array.from(this.rooms.values())
      .filter((r) => r.accessMode !== 'closed' && r.phase !== 'ended')
      .map((r) => {
        const humanPlayers = Array.from(r.players.values()).filter(
          (p) => !p.isBot && p.ws !== null,
        ).length;
        const hostName = r.players.get(r.hostId)?.name ?? 'Master';
        return {
          id: r.id,
          name: r.name,
          hostId: r.hostId,
          hostName,
          accessMode: (r.accessMode === 'password' ? 'password' : 'open') as 'open' | 'password',
          hasPassword: r.accessMode === 'password',
          humanPlayers,
          totalActors: r.players.size,
          targetPlayers: r.targetPlayers,
          fillWithBots: r.fillWithBots,
          phase: r.phase,
          createdAt: r.createdAt,
        };
      })
      .sort((a, b) => {
        if (a.phase !== b.phase) return a.phase === 'lobby' ? -1 : 1;
        return b.createdAt - a.createdAt;
      });
  }

  disposeAll(): void {
    for (const room of this.rooms.values()) {
      if (room.tickTimer) {
        clearInterval(room.tickTimer);
        room.tickTimer = null;
      }
    }
    this.rooms.clear();
  }

  createAndJoinRoom(
    ws: SocketLike,
    opts: {
      roomId?: string;
      roomName?: string;
      playerName: string;
      accessMode?: RoomAccessMode;
      password?: string;
      targetPlayers?: number;
      fillWithBots?: boolean;
      startImmediately?: boolean;
    },
  ): { room: GameRoom; playerId: string } | null {
    const requestedId = this.sanitizeRoomId(opts.roomId);
    const roomId = requestedId || this.generateUniqueRoomId();
    const existing = this.rooms.get(roomId);
    if (existing && existing.phase !== 'ended') {
      this.sendRoomError(ws, 'ROOM_EXISTS', `Já existe uma sala ativa com o código ${roomId}.`);
      return null;
    }

    const accessMode: RoomAccessMode =
      opts.accessMode === 'password' || opts.accessMode === 'closed' ? opts.accessMode : 'open';
    const password = String(opts.password ?? '').trim().slice(0, 24);
    if (accessMode === 'password' && !password) {
      this.sendRoomError(
        ws,
        'PASSWORD_REQUIRED_ON_CREATE',
        'Defina uma senha para criar uma sala protegida.',
      );
      return null;
    }

    const cleanPlayerName = (opts.playerName || 'Viajante').trim().slice(0, 18) || 'Viajante';
    const cleanRoomName =
      (opts.roomName || '').trim().slice(0, 28) || `Arena de ${cleanPlayerName}`;
    const targetPlayers = Math.max(4, Math.min(14, Math.round(opts.targetPlayers ?? 6)));
    const fillWithBots = opts.fillWithBots ?? true;

    const playerId = `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const { dimX, dimY, dimZ } = computeIslandDimensions(targetPlayers);
    const seed = Math.floor(Math.random() * 100000) + 1;

    const room: GameRoom = {
      id: roomId,
      name: cleanRoomName,
      hostId: playerId,
      matchId: '',
      accessMode,
      password: accessMode === 'password' ? password : '',
      createdAt: Date.now(),
      seed,
      contentPool: null,
      dimX,
      dimY,
      dimZ,
      targetPlayers,
      fillWithBots,
      grid: new VoxelGrid(1, 1, 1),
      deltas: [],
      pendingTickDeltas: [],
      players: new Map(),
      projectiles: [],
      lootDrops: [],
      entities: [],
      activeEvents: [],
      eventPhase: 'cooldown',
      eventEndsAt: Date.now() + EVENT_CYCLE_COOLDOWN_SEC * 1000,
      eventCooldownSec: EVENT_CYCLE_COOLDOWN_SEC,
      rafflePlayerId: null,
      rafflePlayerName: null,
      rafflePendingIsBot: false,
      raffleRemainingSec: 0,
      phase: 'lobby',
      elapsedSec: 0,
      lastKillElapsedSec: 0,
      stagnationLevel: 0,
      eventsTriggered: 0,
      totalKills: 0,
      tickTimer: null,
      weatherTickAccum: 0,
      devGodMode: false,
      devInfiniteSandbox: false,
      devBotsFrozen: false,
    };

    const hostPlayer = this.createHumanPlayer(
      playerId,
      cleanPlayerName,
      0,
      ws,
      { x: 0, y: 10, z: 0 },
      0,
    );
    room.players.set(playerId, hostPlayer);
    this.rooms.set(roomId, room);

    if (opts.startImmediately) {
      this.startRoomMatch(room);
    } else {
      this.broadcastLobbyState(room);
    }

    return { room, playerId };
  }

  joinExistingRoom(
    ws: SocketLike,
    opts: {
      roomId: string;
      playerName: string;
      password?: string;
    },
  ): { room: GameRoom; playerId: string } | null {
    const cleanRoomId = this.sanitizeRoomId(opts.roomId);
    if (!cleanRoomId) {
      this.sendRoomError(ws, 'ROOM_NOT_FOUND', 'Informe o código da sala para entrar.');
      return null;
    }

    const room = this.rooms.get(cleanRoomId);
    if (!room || room.phase === 'ended') {
      this.sendRoomError(ws, 'ROOM_NOT_FOUND', `Sala "${cleanRoomId}" não encontrada.`);
      return null;
    }

    if (room.accessMode === 'closed') {
      this.sendRoomError(
        ws,
        'ROOM_CLOSED',
        'Esta sala está fechada pelo Master da partida.',
        { roomId: room.id, roomName: room.name },
      );
      return null;
    }

    if (room.accessMode === 'password') {
      const attempt = String(opts.password ?? '').trim();
      if (!attempt) {
        this.sendRoomError(
          ws,
          'PASSWORD_REQUIRED',
          'Esta sala exige senha para entrar.',
          { roomId: room.id, roomName: room.name },
        );
        return null;
      }
      if (attempt !== room.password) {
        this.sendRoomError(
          ws,
          'INVALID_PASSWORD',
          'Senha incorreta. Tente novamente.',
          { roomId: room.id, roomName: room.name },
        );
        return null;
      }
    }

    const connectedHumans = Array.from(room.players.values()).filter(
      (p) => !p.isBot && p.ws !== null,
    ).length;
    if (connectedHumans >= room.targetPlayers) {
      this.sendRoomError(
        ws,
        'ROOM_FULL',
        'Esta sala já atingiu a capacidade máxima de jogadores.',
        { roomId: room.id, roomName: room.name },
      );
      return null;
    }

    // If room is already playing and filled with bots, remove one bot to free a human slot
    if (room.phase === 'playing' && room.players.size >= room.targetPlayers) {
      const botEntry = Array.from(room.players.values()).find((p) => p.isBot);
      if (botEntry) {
        room.players.delete(botEntry.id);
      }
    }

    const playerId = `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const cleanPlayerName = (opts.playerName || 'Viajante').trim().slice(0, 18) || 'Viajante';

    let spawn = { x: 0, y: 10, z: 0 };
    let inwardYaw = 0;
    if (room.phase === 'playing') {
      const spawns = findSafeSpawnPositions(room.grid, room.targetPlayers, room.seed);
      spawn = spawns[room.players.size % spawns.length];
      const centerX = (room.dimX * VOXEL_SIZE) / 2;
      const centerZ = (room.dimZ * VOXEL_SIZE) / 2;
      inwardYaw = Math.atan2(centerX - spawn.x, centerZ - spawn.z);
    }

    const player = this.createHumanPlayer(
      playerId,
      cleanPlayerName,
      room.players.size,
      ws,
      spawn,
      inwardYaw,
    );
    room.players.set(playerId, player);

    if (room.phase === 'lobby') {
      this.broadcastLobbyState(room);
    } else {
      this.sendToPlayer(player, {
        type: 'room:init',
        payload: this.buildInitPayload(room, playerId),
      });
      this.broadcastKillfeed(room, {
        id: `kf_${Date.now()}`,
        text: `${player.name} entrou na ilha`,
        tone: 'event',
        ts: Date.now(),
      });
    }

    return { room, playerId };
  }

  quickPlayOrJoin(
    ws: SocketLike,
    opts: {
      roomId?: string;
      playerName: string;
      targetPlayers?: number;
      fillWithBots?: boolean;
    },
  ): { room: GameRoom; playerId: string } | null {
    const cleanRoomId = this.sanitizeRoomId(opts.roomId);
    if (cleanRoomId && this.rooms.has(cleanRoomId) && this.rooms.get(cleanRoomId)!.phase !== 'ended') {
      return this.joinExistingRoom(ws, {
        roomId: cleanRoomId,
        playerName: opts.playerName,
      });
    }
    return this.createAndJoinRoom(ws, {
      roomId: cleanRoomId || undefined,
      playerName: opts.playerName,
      accessMode: 'open',
      targetPlayers: opts.targetPlayers,
      fillWithBots: opts.fillWithBots ?? true,
      startImmediately: true,
    });
  }

  private createHumanPlayer(
    playerId: string,
    name: string,
    colorIdx: number,
    ws: SocketLike,
    spawn: Vec3,
    yaw: number,
  ): ServerPlayer {
    const slots = createStarterSlots();
    return {
      id: playerId,
      name,
      isBot: false,
      color: PLAYER_COLORS[colorIdx % PLAYER_COLORS.length],
      alive: true,
      hp: 100,
      oxygen: 100,
      massKg: computePlayerMassKg(slots),
      position: { ...spawn },
      velocity: { x: 0, y: 0, z: 0 },
      yaw,
      pitch: 0.16,
      slots,
      activeSlot: 0,
      heat: 0,
      overheatedUntil: 0,
      isTypingPrompt: false,
      canForgeWeapon: false,
      weaponCooldownSec: WEAPON_INITIAL_COOLDOWN_SEC,
      prompt: null,
      forge: { phase: 'cooling', endsAt: Date.now() + WEAPON_INITIAL_COOLDOWN_SEC * 1000 },
      kills: 0,
      weaponsCreated: 0,
      grappleTarget: null,
      burnUntil: 0,
      freezeUntil: 0,
      ws,
      joinedAt: Date.now(),
      lastFireMs: 0,
      moveX: 0,
      moveZ: 0,
      jumpQueued: false,
      botTargetId: null,
      botThinkTimer: 0,
      botForgePrompted: false,
      botBrain: null,
      grappleTimerSec: 0,
      grappleMode: null,
      grappleTargetId: null,
      promptSessionId: null,
      promptOpenedAt: null,
      promptOpenWindowStart: 0,
      promptOpenCount: 0,
      feedbackWindowStart: 0,
      feedbackCount: 0,
    };
  }

  private startRoomMatch(room: GameRoom): void {
    const { dimX, dimY, dimZ } = computeIslandDimensions(room.targetPlayers);
    room.dimX = dimX;
    room.dimY = dimY;
    room.dimZ = dimZ;
    room.seed = Math.floor(Math.random() * 100000) + 1;
    try {
      room.contentPool = buildContentPool({
        seed: room.seed,
        targetPlayers: room.targetPlayers,
        catalog: getCatalog(),
        usage: this.usageWeights,
      });
    } catch (err) {
      room.contentPool = null;
      console.warn('[Pool] falha ao montar arsenal da sala:', (err as Error).message);
    }
    room.grid = createProceduralIsland(room.seed, dimX, dimY, dimZ);
    room.deltas = [];
    room.pendingTickDeltas = [];
    room.projectiles = [];
    room.lootDrops = [];
    room.entities = [];
    room.activeEvents = [];
    room.eventPhase = 'cooldown';
    room.eventEndsAt = Date.now() + EVENT_CYCLE_COOLDOWN_SEC * 1000;
    room.eventCooldownSec = EVENT_CYCLE_COOLDOWN_SEC;
    room.rafflePlayerId = null;
    room.rafflePlayerName = null;
    room.rafflePendingIsBot = false;
    room.raffleRemainingSec = 0;
    room.phase = 'playing';
    room.matchId = `match_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    room.elapsedSec = 0;
    room.lastKillElapsedSec = 0;
    room.stagnationLevel = 0;
    room.eventsTriggered = 0;
    room.totalKills = 0;
    room.summary = undefined;

    const spawns = findSafeSpawnPositions(room.grid, room.targetPlayers, room.seed);
    const centerX = (room.dimX * VOXEL_SIZE) / 2;
    const centerZ = (room.dimZ * VOXEL_SIZE) / 2;
    let idx = 0;
    for (const p of room.players.values()) {
      if (p.isBot) continue;
      const sp = spawns[idx++ % spawns.length];
      p.alive = true;
      p.hp = 100;
      p.oxygen = 100;
      p.slots = createStarterSlots();
      p.activeSlot = 0;
      p.massKg = computePlayerMassKg(p.slots);
      p.position = { ...sp };
      p.velocity = { x: 0, y: 0, z: 0 };
      p.yaw = Math.atan2(centerX - sp.x, centerZ - sp.z);
      p.pitch = 0.16;
      p.heat = 0;
      p.overheatedUntil = 0;
      p.isTypingPrompt = false;
      p.canForgeWeapon = false;
      p.weaponCooldownSec = WEAPON_INITIAL_COOLDOWN_SEC;
      p.prompt = null;
      p.forge = { phase: 'cooling', endsAt: Date.now() + WEAPON_INITIAL_COOLDOWN_SEC * 1000 };
      p.kills = 0;
      p.weaponsCreated = 0;
      p.grappleTarget = null;
      p.grappleTimerSec = 0;
      p.grappleMode = null;
      p.grappleTargetId = null;
      p.burnUntil = 0;
      p.freezeUntil = 0;
    }

    if (room.fillWithBots) {
      this.ensureBotsForRoom(room);
    }

    if (room.tickTimer) {
      clearInterval(room.tickTimer);
    }
    room.tickTimer = setInterval(() => this.tickRoom(room, 0.05), 50);
    room.tickTimer.unref?.();

    for (const p of room.players.values()) {
      if (!p.isBot && p.ws) {
        this.sendToPlayer(p, {
          type: 'room:init',
          payload: this.buildInitPayload(room, p.id),
        });
      }
    }
  }

  private spawnSingleBot(room: GameRoom, spawnPos?: Vec3): ServerPlayer {
    const spawns = findSafeSpawnPositions(room.grid, Math.max(room.targetPlayers, room.players.size + 1), room.seed);
    const usedNames = new Set(Array.from(room.players.values()).map((p) => p.name));
    const idx = room.players.size;
    const botId = `bot_${idx}_${Math.random().toString(36).slice(2, 6)}`;
    const slots = createStarterSlots();
    const spawn = spawnPos ?? spawns[idx % spawns.length];
    const personality = createBotPersonality(
      room.seed * 7919 + idx * 104729 + Math.floor(Math.random() * 99991),
      usedNames,
    );
    const bot: ServerPlayer = {
      id: botId,
      name: personality.handle,
      isBot: true,
      color: PLAYER_COLORS[idx % PLAYER_COLORS.length],
      alive: true,
      hp: 100,
      oxygen: 100,
      massKg: computePlayerMassKg(slots),
      position: { ...spawn },
      velocity: { x: 0, y: 0, z: 0 },
      yaw: Math.random() * Math.PI * 2,
      pitch: 0,
      slots,
      activeSlot: 0,
      heat: 0,
      overheatedUntil: 0,
      isTypingPrompt: false,
      canForgeWeapon: false,
      weaponCooldownSec: 6 + Math.random() * 5,
      prompt: null,
      forge: { phase: 'cooling', endsAt: Date.now() + (6 + Math.random() * 5) * 1000 },
      kills: 0,
      weaponsCreated: 0,
      grappleTarget: null,
      burnUntil: 0,
      freezeUntil: 0,
      personalityLabel: personality.label,
      ws: null,
      joinedAt: Date.now(),
      lastFireMs: 0,
      moveX: 0,
      moveZ: 0,
      jumpQueued: false,
      botTargetId: null,
      botThinkTimer: 0.4 + Math.random() * 0.8,
      botForgePrompted: false,
      botBrain: createBotBrainState(personality, spawn),
      grappleTimerSec: 0,
      grappleMode: null,
      grappleTargetId: null,
      promptSessionId: null,
      promptOpenedAt: null,
      promptOpenWindowStart: 0,
      promptOpenCount: 0,
      feedbackWindowStart: 0,
      feedbackCount: 0,
    };
    room.players.set(botId, bot);
    return bot;
  }

  private ensureBotsForRoom(room: GameRoom): void {
    const spawns = findSafeSpawnPositions(room.grid, room.targetPlayers, room.seed);
    while (room.players.size < room.targetPlayers) {
      this.spawnSingleBot(room, spawns[room.players.size % spawns.length]);
    }
  }

  private promoteNextHostIfNeeded(room: GameRoom, departedId: string): boolean {
    if (room.hostId !== departedId) return false;
    const candidates = Array.from(room.players.values())
      .filter((p) => !p.isBot && p.ws !== null && p.id !== departedId)
      .sort((a, b) => a.joinedAt - b.joinedAt);
    if (candidates.length === 0) return false;
    room.hostId = candidates[0].id;
    return true;
  }

  handleDisconnect(roomId: string, playerId: string): void {
    const room = this.rooms.get(roomId);
    if (!room) return;
    const player = room.players.get(playerId);
    if (!player) return;
    player.ws = null;

    if (room.phase === 'lobby') {
      room.players.delete(playerId);
    } else if (player.alive) {
      this.killPlayer(room, player, null, 'desconectou');
    }

    const humansLeft = Array.from(room.players.values()).filter(
      (p) => !p.isBot && p.ws !== null,
    ).length;

    if (humansLeft === 0) {
      if (room.tickTimer) {
        clearInterval(room.tickTimer);
        room.tickTimer = null;
      }
      this.rooms.delete(roomId);
      return;
    }

    const hostChanged = this.promoteNextHostIfNeeded(room, playerId);
    if (room.phase === 'lobby') {
      this.broadcastLobbyState(room);
    } else if (hostChanged) {
      const newHost = room.players.get(room.hostId);
      if (newHost) {
        this.broadcastKillfeed(room, {
          id: `kf_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
          text: `👑 ${newHost.name} agora é o Master da partida`,
          tone: 'event',
          ts: Date.now(),
        });
      }
    }
  }

  handleClientMessage(roomId: string, playerId: string, msg: any): void {
    const room = this.rooms.get(roomId);
    if (!room) return;
    const player = room.players.get(playerId);
    if (!player) return;

    switch (msg?.type) {
      case 'player:input': {
        const p = msg.payload as ClientInputPacket;
        if (!player.alive) return;
        if (player.prompt) {
          player.moveX = 0;
          player.moveZ = 0;
          player.jumpQueued = false;
          player.isTypingPrompt = true;
          break;
        }
        player.yaw = Number(p.yaw) || 0;
        player.pitch = Math.max(-1.48, Math.min(1.48, Number(p.pitch) || 0));
        player.moveX = Math.max(-1, Math.min(1, Number(p.moveX) || 0));
        player.moveZ = Math.max(-1, Math.min(1, Number(p.moveZ) || 0));
        if (p.jump) player.jumpQueued = true;
        if (Number.isInteger(p.activeSlot) && p.activeSlot >= 0 && p.activeSlot < 4) {
          player.activeSlot = p.activeSlot;
        }
        player.isTypingPrompt = false;
        break;
      }

      case 'player:action': {
        if (!player.alive || room.phase !== 'playing' || player.prompt) return;
        this.performActiveItem(room, player, msg.payload?.origin, msg.payload?.dir);
        break;
      }

      case 'player:drop': {
        if (!player.alive || room.phase !== 'playing' || player.prompt) return;
        this.dropActiveItem(room, player);
        break;
      }

      case 'player:pickup': {
        if (!player.alive || room.phase !== 'playing' || player.prompt) return;
        this.pickupNearestItem(room, player);
        break;
      }

      case 'content:feedback': {
        if (!player.alive || room.phase !== 'playing') return;
        const itemId = String(msg.payload?.itemId ?? '').slice(0, 80);
        const kind = msg.payload?.kind === 'event' ? 'event' : 'weapon';
        const rating = msg.payload?.rating === 1 ? 1 : msg.payload?.rating === -1 ? -1 : 0;
        if (!itemId || rating === 0) return;
        const catalogItem = getCatalogItem(itemId);
        if (!catalogItem || catalogItem.kind !== kind) return;
        const now = Date.now();
        if (now - player.feedbackWindowStart > FEEDBACK_RATE_WINDOW_MS) {
          player.feedbackWindowStart = now;
          player.feedbackCount = 0;
        }
        if (player.feedbackCount >= FEEDBACK_RATE_LIMIT) return;
        player.feedbackCount += 1;
        this.ledger?.recordUsage({
          itemId,
          kind,
          role: 'feedback',
          actorType: player.isBot ? 'bot' : 'human',
          actorRef: player.id,
          roomId: room.id,
          matchId: room.matchId,
          catalogVersion: getCatalogVersion(),
          metadata: { rating },
        });
        break;
      }

      case 'prompt:open': {
        if (!player.alive || room.phase !== 'playing') return;
        const kind = msg.payload?.kind as PromptKind | undefined;
        if (kind !== 'weapon' && kind !== 'event') return;
        this.openPrompt(room, player, kind);
        break;
      }

      case 'prompt:cancel': {
        if (!player.alive || room.phase !== 'playing') return;
        const kind = msg.payload?.kind as PromptKind | undefined;
        if (!player.prompt || player.prompt.kind !== kind) return;
        this.cancelPrompt(room, player, false);
        break;
      }

      case 'ai:forge_weapon': {
        if (!player.alive || room.phase !== 'playing') return;
        if (player.prompt?.kind !== 'weapon') {
          this.sendToPlayer(player, {
            type: 'ai:error',
            payload: { message: 'Abra a forja com Enter antes de enviar o texto.' },
          });
          return;
        }
        const prompt = String(msg.payload?.prompt ?? '').slice(0, 90);
        if (!prompt.trim()) return;
        const resolution = resolveWeaponFromCatalog(prompt, {
          allowedIds: room.contentPool?.weaponIds,
        });
        const elapsedMs = player.promptOpenedAt ? Date.now() - player.promptOpenedAt : null;
        this.recordPromptEvent(room, player, 'submitted', 'weapon', {
          prompt,
          itemId: resolution.itemId,
          strategy: resolution.strategy,
          budgetUsed: resolution.blueprint.budgetUsed,
          wasClamped: resolution.blueprint.wasClamped,
          elapsedMs,
          reason: null,
          poolHash: room.contentPool?.hash ?? null,
          poolMiss: resolution.poolMiss ?? false,
        });
        player.prompt = null;
        player.isTypingPrompt = false;
        player.promptSessionId = null;
        player.promptOpenedAt = null;
        player.canForgeWeapon = false;
        player.weaponCooldownSec = WEAPON_CYCLE_COOLDOWN_SEC;
        player.forge = { phase: 'cooling', endsAt: Date.now() + WEAPON_CYCLE_COOLDOWN_SEC * 1000 };

        this.equipForgedWeapon(room, player, resolution.blueprint);
        break;
      }

      case 'ai:trigger_event': {
        if (!player.alive || room.phase !== 'playing') return;
        if (room.rafflePlayerId !== player.id || player.prompt?.kind !== 'event') {
          this.sendToPlayer(player, {
            type: 'ai:error',
            payload: { message: 'Você não é o jogador sorteado para o evento atual.' },
          });
          return;
        }
        const prompt = String(msg.payload?.prompt ?? '').slice(0, 90);
        if (!prompt.trim()) return;
        const center: [number, number, number] = [
          (room.dimX * VOXEL_SIZE) / 2,
          10,
          (room.dimZ * VOXEL_SIZE) / 2,
        ];
        const resolution = resolveEventFromCatalog(prompt, player.id, player.name, center, {
          allowedIds: room.contentPool?.eventIds,
        });
        const elapsedMs = player.promptOpenedAt ? Date.now() - player.promptOpenedAt : null;
        this.recordPromptEvent(room, player, 'submitted', 'event', {
          prompt,
          itemId: resolution.itemId,
          strategy: resolution.strategy,
          budgetUsed: resolution.event.budgetUsed,
          wasClamped: resolution.event.wasClamped,
          elapsedMs,
          reason: null,
          poolHash: room.contentPool?.hash ?? null,
          poolMiss: resolution.poolMiss ?? false,
        });
        player.prompt = null;
        player.isTypingPrompt = false;
        player.promptSessionId = null;
        player.promptOpenedAt = null;
        this.resetEventCycle(room);
        this.enqueueMapEvent(room, resolution.event);
        break;
      }

      case 'room:start': {
        if (playerId !== room.hostId) {
          this.sendRoomError(player.ws, 'NOT_HOST', 'Apenas o Master da partida pode iniciar.');
          return;
        }
        if (room.phase !== 'lobby') return;
        const humanCount = Array.from(room.players.values()).filter(
          (p) => !p.isBot && p.ws !== null,
        ).length;
        const allowDevSolo = this.devEnabled && Boolean(msg.payload?.devSolo);
        if (!room.fillWithBots && humanCount < 2 && !allowDevSolo) {
          this.sendRoomError(
            player.ws,
            'NEED_PLAYERS',
            'Aguarde pelo menos 2 jogadores ou ative os bots para iniciar.',
          );
          return;
        }
        this.startRoomMatch(room);
        break;
      }

      case 'dev:action': {
        if (!this.devEnabled) {
          this.sendRoomError(
            player.ws,
            'DEV_DISABLED',
            'Modo desenvolvimento indisponível em produção.',
          );
          return;
        }
        this.handleDevAction(room, player, msg.payload as DevActionPayload);
        break;
      }

      case 'room:update_settings': {
        if (playerId !== room.hostId) {
          this.sendRoomError(
            player.ws,
            'NOT_HOST',
            'Apenas o Master pode alterar as configurações da sala.',
          );
          return;
        }
        const nextMode = msg.payload?.accessMode as RoomAccessMode | undefined;
        if (nextMode === 'open' || nextMode === 'password' || nextMode === 'closed') {
          if (nextMode === 'password') {
            const nextPwd =
              typeof msg.payload?.password === 'string'
                ? msg.payload.password.trim().slice(0, 24)
                : room.password;
            if (!nextPwd) {
              this.sendRoomError(
                player.ws,
                'PASSWORD_REQUIRED_ON_CREATE',
                'Informe uma senha antes de proteger a sala.',
              );
              return;
            }
            room.password = nextPwd;
          } else {
            room.password = '';
          }
          room.accessMode = nextMode;
        } else if (typeof msg.payload?.password === 'string' && room.accessMode === 'password') {
          const nextPwd = msg.payload.password.trim().slice(0, 24);
          if (nextPwd) room.password = nextPwd;
        }

        if (room.phase === 'lobby') {
          if (typeof msg.payload?.roomName === 'string') {
            const cleaned = msg.payload.roomName.trim().slice(0, 28);
            if (cleaned) room.name = cleaned;
          }
          if (typeof msg.payload?.targetPlayers === 'number') {
            const humanCount = Array.from(room.players.values()).filter((p) => !p.isBot).length;
            room.targetPlayers = Math.max(
              Math.max(4, humanCount),
              Math.min(14, Math.round(msg.payload.targetPlayers)),
            );
          }
          if (typeof msg.payload?.fillWithBots === 'boolean') {
            room.fillWithBots = msg.payload.fillWithBots;
          }
          this.broadcastLobbyState(room);
        } else {
          const hostName = room.players.get(room.hostId)?.name ?? 'Master';
          this.broadcastToRoom(room, {
            type: 'room:settings_updated',
            payload: { accessMode: room.accessMode, hostId: room.hostId, hostName },
          });
          const modeLabel =
            room.accessMode === 'closed'
              ? '🔒 Sala fechada pelo Master'
              : room.accessMode === 'password'
                ? '🔑 Senha ativada pelo Master'
                : '🔓 Sala aberta pelo Master';
          this.broadcastKillfeed(room, {
            id: `kf_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
            text: modeLabel,
            tone: 'event',
            ts: Date.now(),
          });
        }
        break;
      }

      case 'room:kick': {
        if (playerId !== room.hostId) {
          this.sendRoomError(player.ws, 'NOT_HOST', 'Apenas o Master pode expulsar jogadores.');
          return;
        }
        const targetId = String(msg.payload?.targetPlayerId ?? '');
        if (!targetId || targetId === room.hostId) return;
        const target = room.players.get(targetId);
        if (!target || target.isBot) return;
        const targetWs = target.ws;
        room.players.delete(targetId);
        this.sendRoomError(targetWs, 'KICKED', 'Você foi removido da sala pelo Master da partida.');
        if (room.phase === 'lobby') {
          this.broadcastLobbyState(room);
        } else {
          this.broadcastKillfeed(room, {
            id: `kf_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
            text: `${target.name} foi removido da partida pelo Master`,
            tone: 'event',
            ts: Date.now(),
          });
        }
        break;
      }

      case 'room:transfer_host': {
        if (playerId !== room.hostId) {
          this.sendRoomError(player.ws, 'NOT_HOST', 'Apenas o Master pode transferir o comando.');
          return;
        }
        const targetId = String(msg.payload?.targetPlayerId ?? '');
        const target = room.players.get(targetId);
        if (!target || target.isBot || !target.ws || target.id === room.hostId) return;
        room.hostId = target.id;
        if (room.phase === 'lobby') {
          this.broadcastLobbyState(room);
        } else {
          this.broadcastKillfeed(room, {
            id: `kf_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
            text: `👑 ${target.name} agora é o Master da partida`,
            tone: 'event',
            ts: Date.now(),
          });
        }
        break;
      }

      case 'room:leave': {
        this.handleDisconnect(roomId, playerId);
        break;
      }

      case 'room:restart': {
        if (playerId !== room.hostId) {
          this.sendRoomError(
            player.ws,
            'NOT_HOST',
            'Apenas o Master da partida pode reiniciar a ilha.',
          );
          return;
        }
        if (room.phase === 'ended' || room.phase === 'playing') {
          this.restartRoom(room);
        }
        break;
      }
    }
  }

  private restartRoom(room: GameRoom): void {
    room.seed = Math.floor(Math.random() * 100000) + 1;
    room.grid = createProceduralIsland(room.seed, room.dimX, room.dimY, room.dimZ);
    room.deltas = [];
    room.pendingTickDeltas = [];
    room.projectiles = [];
    room.lootDrops = [];
    room.entities = [];
    room.activeEvents = [];
    room.eventPhase = 'cooldown';
    room.eventEndsAt = Date.now() + EVENT_CYCLE_COOLDOWN_SEC * 1000;
    room.eventCooldownSec = EVENT_CYCLE_COOLDOWN_SEC;
    room.rafflePlayerId = null;
    room.rafflePlayerName = null;
    room.rafflePendingIsBot = false;
    room.raffleRemainingSec = 0;
    room.phase = 'playing';
    room.matchId = `match_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    room.elapsedSec = 0;
    room.lastKillElapsedSec = 0;
    room.stagnationLevel = 0;
    room.eventsTriggered = 0;
    room.totalKills = 0;
    room.summary = undefined;

    const spawns = findSafeSpawnPositions(room.grid, room.players.size, room.seed);
    const centerX = (room.dimX * VOXEL_SIZE) / 2;
    const centerZ = (room.dimZ * VOXEL_SIZE) / 2;
    let idx = 0;
    for (const p of room.players.values()) {
      const sp = spawns[idx++ % spawns.length];
      p.alive = true;
      p.hp = 100;
      p.oxygen = 100;
      p.slots = createStarterSlots();
      p.activeSlot = 0;
      p.massKg = computePlayerMassKg(p.slots);
      p.position = { ...sp };
      p.velocity = { x: 0, y: 0, z: 0 };
      p.yaw = Math.atan2(centerX - sp.x, centerZ - sp.z);
      p.pitch = 0.16;
      p.heat = 0;
      p.overheatedUntil = 0;
      p.isTypingPrompt = false;
      p.canForgeWeapon = false;
      p.weaponCooldownSec = p.isBot ? 6 + Math.random() * 5 : WEAPON_INITIAL_COOLDOWN_SEC;
      p.prompt = null;
      p.forge = { phase: 'cooling', endsAt: Date.now() + p.weaponCooldownSec * 1000 };
      p.kills = 0;
      p.weaponsCreated = 0;
      p.grappleTarget = null;
      p.grappleTimerSec = 0;
      p.grappleMode = null;
      p.grappleTargetId = null;
      p.burnUntil = 0;
      p.freezeUntil = 0;
      p.botForgePrompted = false;
      if (p.isBot) {
        const personality = createBotPersonality(
          room.seed * 7919 + idx * 104729 + Math.floor(Math.random() * 99991),
        );
        personality.handle = p.name;
        p.personalityLabel = personality.label;
        p.botBrain = createBotBrainState(personality, sp);
      }
      if (!p.isBot && p.ws) {
        this.sendToPlayer(p, {
          type: 'room:init',
          payload: this.buildInitPayload(room, p.id),
        });
      }
    }
  }

  private equipForgedWeapon(
    room: GameRoom,
    player: ServerPlayer,
    bp: WeaponBlueprint,
  ): void {
    const newItem: InventorySlotItem = {
      id: bp.id,
      kind: 'weapon',
      name: bp.name,
      massKg: bp.stats.massKg,
      ammo: bp.stats.ammoMax,
      ammoMax: bp.stats.ammoMax,
      weapon: bp,
    };

    let targetIdx = player.slots.findIndex((s) => s === null);
    if (targetIdx === -1) {
      targetIdx = player.activeSlot;
      const displaced = player.slots[targetIdx];
      if (displaced) {
        room.lootDrops.push({
          id: `loot_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
          position: {
            x: player.position.x + Math.sin(player.yaw) * 1.1,
            y: player.position.y + 0.5,
            z: player.position.z + Math.cos(player.yaw) * 1.1,
          },
          item: displaced,
        });
      }
    }
    player.slots[targetIdx] = newItem;
    player.activeSlot = targetIdx;
    player.weaponsCreated += 1;
    player.massKg = computePlayerMassKg(player.slots);

    this.sendToPlayer(player, {
      type: 'ai:weapon_ready',
      payload: { weapon: bp, slotIndex: targetIdx },
    });

    if (bp.catalogId) {
      this.ledger?.recordUsage({
        itemId: bp.catalogId,
        kind: 'weapon',
        role: 'equip',
        actorType: player.isBot ? 'bot' : 'human',
        actorRef: player.id,
        roomId: room.id,
        matchId: room.matchId,
        catalogVersion: getCatalogVersion(),
        metadata: { name: bp.name, budgetUsed: bp.budgetUsed },
      });
    }

    if (!player.isBot) {
      this.broadcastKillfeed(room, {
        id: `kf_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
        text: `${player.name} ${bp.fromCatalog || bp.fromDatabase ? 'reutilizou' : 'forjou'} "${bp.name}" (${bp.budgetUsed}/100 pts${bp.fromCatalog ? ' · catálogo' : ''}${bp.wasClamped ? ' · instável!' : ''})`,
        tone: bp.wasClamped ? 'risk' : 'forge',
        ts: Date.now(),
      });
    }
  }

  private enqueueMapEvent(room: GameRoom, evt: MapEventState): void {
    if (room.activeEvents.length >= 3) {
      room.activeEvents.shift(); // oldest expires smoothly
    }
    room.activeEvents.push(evt);
    room.eventsTriggered += 1;

    if (evt.catalogId) {
      const author = room.players.get(evt.authorId);
      this.ledger?.recordUsage({
        itemId: evt.catalogId,
        kind: 'event',
        role: 'event',
        actorType:
          evt.authorId === 'server' ? 'system' : author?.isBot ? 'bot' : 'human',
        actorRef: evt.authorId,
        roomId: room.id,
        matchId: room.matchId,
        catalogVersion: getCatalogVersion(),
        metadata: {
          archetype: evt.archetype,
          durationSec: evt.params.durationSec,
          lethality: evt.params.lethality,
          quantity: evt.params.quantity,
        },
      });
    }

    const displayName = evt.catalogId
      ? getCatalogItemName(evt.catalogId) ?? 'Evento do catálogo'
      : 'Evento';
    this.broadcastKillfeed(room, {
      id: `kf_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
      text: `⚠️ ${evt.authorName} ${evt.fromCatalog || evt.fromDatabase ? 'reutilizou' : 'invocou'}: "${displayName}"${evt.fromCatalog ? ' [catálogo]' : ''} — Impacto em 5s!`,
      tone: 'event',
      ts: Date.now(),
    });
  }

  private getAimBasis(player: ServerPlayer, originOverride?: Vec3, dirOverride?: Vec3) {
    const cosP = Math.cos(player.pitch);
    const dir =
      dirOverride && Number.isFinite(dirOverride.x)
        ? dirOverride
        : {
            x: Math.sin(player.yaw) * cosP,
            y: -Math.sin(player.pitch),
            z: Math.cos(player.yaw) * cosP,
          };
    const len = Math.hypot(dir.x, dir.y, dir.z) || 1;
    dir.x /= len;
    dir.y /= len;
    dir.z /= len;

    const origin =
      originOverride && Number.isFinite(originOverride.x)
        ? originOverride
        : {
            x: player.position.x,
            y: player.position.y + 1.45,
            z: player.position.z,
          };
    return { origin, dir };
  }

  private performActiveItem(
    room: GameRoom,
    player: ServerPlayer,
    originOverride?: Vec3,
    dirOverride?: Vec3,
  ): void {
    const slotItem = player.slots[player.activeSlot];
    if (!slotItem) return;

    const { origin, dir } = this.getAimBasis(player, originOverride, dirOverride);
    const now = Date.now();

    if (slotItem.kind === 'shovel') {
      if (now - player.lastFireMs < 260) return;
      player.lastFireMs = now;
      const hit = raycastVoxels(room.grid, origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, 6.0);
      if (hit.hit) {
        // Carve centered inside the struck solid voxel so exterior rounding never misses
        const cx = (hit.vx + 0.5) * VOXEL_SIZE;
        const cy = (hit.vy + 0.5) * VOXEL_SIZE;
        const cz = (hit.vz + 0.5) * VOXEL_SIZE;
        this.applyVoxelCarve(room, cx, cy, cz, 3.6, false);
      }
      return;
    }

    if (slotItem.kind === 'grapple') {
      if (now - player.lastFireMs < 650) return;
      player.lastFireMs = now;
      const maxRange = 44;
      const voxelHit = raycastVoxels(
        room.grid,
        origin.x,
        origin.y,
        origin.z,
        dir.x,
        dir.y,
        dir.z,
        maxRange,
      );

      // Check closest enemy player along ray within voxelHit.distance
      let hitPlayer: ServerPlayer | null = null;
      let bestDist = voxelHit.distance;
      for (const other of room.players.values()) {
        if (other.id === player.id || !other.alive) continue;
        const dx = other.position.x - origin.x;
        const dy = other.position.y + 0.9 - origin.y;
        const dz = other.position.z - origin.z;
        const proj = dx * dir.x + dy * dir.y + dz * dir.z;
        if (proj <= 0 || proj > bestDist) continue;
        const perpSq = dx * dx + dy * dy + dz * dz - proj * proj;
        if (perpSq <= 1.0) {
          bestDist = proj;
          hitPlayer = other;
        }
      }

      // Check closest creature along ray within bestDist
      let hitCreature: SpawnedEntityNetState | null = null;
      for (const ent of room.entities) {
        if (ent.kind !== 'creature') continue;
        const dx = ent.position.x - origin.x;
        const dy = ent.position.y + 0.6 - origin.y;
        const dz = ent.position.z - origin.z;
        const proj = dx * dir.x + dy * dir.y + dz * dir.z;
        if (proj <= 0 || proj > bestDist) continue;
        const perpSq = dx * dx + dy * dy + dz * dz - proj * proj;
        if (perpSq <= 1.15) {
          bestDist = proj;
          hitCreature = ent;
          hitPlayer = null;
        }
      }

      if (hitPlayer) {
        const outcome = computeGrappleOutcome(player.massKg, hitPlayer.massKg, false);
        player.grappleTarget = {
          x: hitPlayer.position.x,
          y: hitPlayer.position.y + 0.9,
          z: hitPlayer.position.z,
        };
        player.grappleTimerSec = 0.45;
        player.grappleMode = outcome.mode;
        player.grappleTargetId = hitPlayer.id;

        if (outcome.mode === 'pull_self') {
          if (!overlapsSolid(room.grid, player.position.x, player.position.y + 0.14, player.position.z, 0.34, 1.65)) {
            player.position.y += 0.14;
          }
          const dx = hitPlayer.position.x - player.position.x;
          const dy = hitPlayer.position.y - player.position.y + 0.4;
          const dz = hitPlayer.position.z - player.position.z;
          const d = Math.hypot(dx, dy, dz) || 1;
          player.velocity.x = (dx / d) * outcome.impulseSpeed;
          player.velocity.y = Math.max(5.5, (dy / d) * outcome.impulseSpeed);
          player.velocity.z = (dz / d) * outcome.impulseSpeed;
        } else {
          if (!overlapsSolid(room.grid, hitPlayer.position.x, hitPlayer.position.y + 0.14, hitPlayer.position.z, 0.34, 1.65)) {
            hitPlayer.position.y += 0.14;
          }
          const dx = player.position.x - hitPlayer.position.x;
          const dy = player.position.y - hitPlayer.position.y + 0.5;
          const dz = player.position.z - hitPlayer.position.z;
          const d = Math.hypot(dx, dy, dz) || 1;
          hitPlayer.velocity.x = (dx / d) * outcome.impulseSpeed;
          hitPlayer.velocity.y = Math.max(6.0, (dy / d) * outcome.impulseSpeed);
          hitPlayer.velocity.z = (dz / d) * outcome.impulseSpeed;
        }
        return;
      }

      if (hitCreature) {
        player.grappleTarget = {
          x: hitCreature.position.x,
          y: hitCreature.position.y + 0.6,
          z: hitCreature.position.z,
        };
        player.grappleTimerSec = 0.42;
        player.grappleMode = 'pull_target';
        player.grappleTargetId = hitCreature.id;
        const dx = player.position.x - hitCreature.position.x;
        const dy = player.position.y - hitCreature.position.y + 0.5;
        const dz = player.position.z - hitCreature.position.z;
        const d = Math.hypot(dx, dy, dz) || 1;
        hitCreature.velocity.x = (dx / d) * 18;
        hitCreature.velocity.y = 6.5;
        hitCreature.velocity.z = (dz / d) * 18;
        return;
      }

      // Check loot drop along ray
      for (let i = 0; i < room.lootDrops.length; i++) {
        const drop = room.lootDrops[i];
        const dx = drop.position.x - origin.x;
        const dy = drop.position.y - origin.y;
        const dz = drop.position.z - origin.z;
        const proj = dx * dir.x + dy * dir.y + dz * dir.z;
        if (proj > 0 && proj <= bestDist) {
          const perpSq = dx * dx + dy * dy + dz * dz - proj * proj;
          if (perpSq <= 0.9 * 0.9) {
            const outcome = computeGrappleOutcome(player.massKg, drop.item.massKg, false);
            if (outcome.mode === 'pull_target') {
              drop.position = {
                x: player.position.x + dir.x * 1.0,
                y: player.position.y + 0.6,
                z: player.position.z + dir.z * 1.0,
              };
              player.grappleTarget = { ...drop.position };
              player.grappleTimerSec = 0.25;
              this.pickupNearestItem(room, player);
              return;
            }
          }
        }
      }

      if (voxelHit.hit) {
        const outcome = computeGrappleOutcome(player.massKg, 5000, true);
        if (!overlapsSolid(room.grid, player.position.x, player.position.y + 0.14, player.position.z, 0.34, 1.65)) {
          player.position.y += 0.14;
        }
        player.grappleTarget = { ...voxelHit.point };
        player.grappleTimerSec = 0.45;
        player.grappleMode = outcome.mode;
        player.grappleTargetId = null;

        const dx = voxelHit.point.x - player.position.x;
        const dy = voxelHit.point.y - player.position.y;
        const dz = voxelHit.point.z - player.position.z;
        const d = Math.hypot(dx, dy, dz) || 1;
        player.velocity.x = (dx / d) * outcome.impulseSpeed;
        player.velocity.y = Math.max(6.5, (dy / d) * outcome.impulseSpeed + 2.5);
        player.velocity.z = (dz / d) * outcome.impulseSpeed;
      }
      return;
    }

    if (slotItem.kind === 'weapon' && slotItem.weapon) {
      const wp = slotItem.weapon;
      if (now < player.overheatedUntil) return;
      const minIntervalMs = 1000 / Math.max(0.5, wp.stats.fireRate);
      if (now - player.lastFireMs < minIntervalMs) return;
      if ((slotItem.ammo ?? 0) <= 0) {
        // Weapon ran out of ammo -> turned into scrap
        player.slots[player.activeSlot] = null;
        player.massKg = computePlayerMassKg(player.slots);
        return;
      }

      player.lastFireMs = now;
      const sandboxInfinite = this.devEnabled && room.devInfiniteSandbox && !player.isBot;
      if (!sandboxInfinite) {
        slotItem.ammo = Math.max(0, (slotItem.ammo ?? 1) - 1);

        const heatPerShot = Math.max(4, 24 - wp.stats.cooling * 1.9 + wp.modifiers.voxelCraterRadius * 4);
        player.heat = Math.min(100, player.heat + heatPerShot);
        if (player.heat >= 100) {
          player.overheatedUntil = now + 2600;
          if (wp.selfRisk.includes('overheat_explosion')) {
            this.damagePlayer(room, player, 22, null, `explosão térmica de ${wp.name}`);
            this.applyVoxelCarve(room, player.position.x, player.position.y + 0.5, player.position.z, 3, true);
          }
        }
      }

      if (wp.selfRisk.includes('recoil_launch')) {
        player.velocity.x -= dir.x * 11;
        player.velocity.y += Math.max(3, -dir.y * 8 + 2.5);
        player.velocity.z -= dir.z * 11;
      }

      const speed = Math.max(22, Math.min(95, wp.stats.rangeMeters * 0.95));
      const ttlSec = Math.max(0.35, wp.stats.rangeMeters / speed);
      const spreadRad = (wp.stats.spreadDeg * Math.PI) / 180;
      const projColor = wp.palette[0]?.hex || '#38bdf8';

      // Ensure muzzle spawn never skips past adjacent blocks when nose-to-wall
      const closeWall = raycastVoxels(room.grid, origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, 0.72);
      const spawnDist = closeWall.hit ? Math.max(0.08, closeWall.distance * 0.4) : 0.65;

      // Compute orthonormal right/up basis perpendicular to aim dir for accurate cone spread
      const upRefY = Math.abs(dir.y) > 0.92 ? 0 : 1;
      const upRefZ = Math.abs(dir.y) > 0.92 ? 1 : 0;
      let rx = dir.y * upRefZ - dir.z * upRefY;
      let ry = dir.z * 0 - dir.x * upRefZ;
      let rz = dir.x * upRefY - dir.y * 0;
      const rLen = Math.hypot(rx, ry, rz) || 1;
      rx /= rLen;
      ry /= rLen;
      rz /= rLen;
      const ux = ry * dir.z - rz * dir.y;
      const uy = rz * dir.x - rx * dir.z;
      const uz = rx * dir.y - ry * dir.x;

      for (let i = 0; i < wp.stats.projectiles; i++) {
        const sx = (Math.random() - 0.5) * spreadRad;
        const sy = (Math.random() - 0.5) * spreadRad;
        const pvx = (dir.x + rx * sx + ux * sy) * speed;
        const pvy = (dir.y + ry * sx + uy * sy) * speed;
        const pvz = (dir.z + rz * sx + uz * sy) * speed;

        room.projectiles.push({
          id: `prj_${now}_${Math.random().toString(36).slice(2, 6)}`,
          ownerId: player.id,
          catalogId: wp.catalogId,
          position: {
            x: origin.x + dir.x * spawnDist,
            y: origin.y + dir.y * spawnDist,
            z: origin.z + dir.z * spawnDist,
          },
          velocity: { x: pvx, y: pvy, z: pvz },
          color: projColor,
          behavior: wp.modifiers.projectileBehavior,
          statusEffect: wp.modifiers.statusEffect,
          craterRadius: wp.modifiers.voxelCraterRadius,
          damage: wp.stats.damage,
          ttlSec,
          bouncesLeft: wp.modifiers.projectileBehavior === 'bouncing' ? 3 : 0,
          pierceLeft: wp.modifiers.projectileBehavior === 'piercing' ? 3 : 0,
          stickyTimerSec: wp.modifiers.projectileBehavior === 'sticky_bomb' ? 1.4 : 0,
          stuck: false,
        });
      }

      if (slotItem.ammo === 0 && !(this.devEnabled && room.devInfiniteSandbox && !player.isBot)) {
        // Out of ammo -> scrap immediately after final shot
        player.slots[player.activeSlot] = null;
        player.massKg = computePlayerMassKg(player.slots);
      }
    }
  }

  private dropActiveItem(room: GameRoom, player: ServerPlayer): void {
    const item = player.slots[player.activeSlot];
    if (!item) return;
    player.slots[player.activeSlot] = null;
    player.massKg = computePlayerMassKg(player.slots);
    room.lootDrops.push({
      id: `loot_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
      position: {
        x: player.position.x + Math.sin(player.yaw) * 1.2,
        y: player.position.y + 0.6,
        z: player.position.z + Math.cos(player.yaw) * 1.2,
      },
      item,
    });
  }

  private pickupNearestItem(room: GameRoom, player: ServerPlayer): void {
    // Check supply crates first
    for (let i = room.entities.length - 1; i >= 0; i--) {
      const ent = room.entities[i];
      if (ent.kind !== 'supply_crate') continue;
      const dist = Math.hypot(
        ent.position.x - player.position.x,
        ent.position.y - player.position.y,
        ent.position.z - player.position.z,
      );
      if (dist <= 2.4) {
        const restore = ent.ammoRestore ?? 30;
        for (const s of player.slots) {
          if (s && s.kind === 'weapon' && s.ammoMax) {
            s.ammo = Math.min(s.ammoMax, (s.ammo ?? 0) + restore);
          }
        }
        player.hp = Math.min(100, player.hp + 25);
        room.entities.splice(i, 1);
        if (!player.isBot && player.ws) {
          this.sendToPlayer(player, {
            type: 'fx:pickup',
            payload: { itemName: `+25 HP · +${restore} Munição` },
          });
        }
        return;
      }
    }

    // Check dropped loot
    let bestIdx = -1;
    let bestDist = 2.5;
    for (let i = 0; i < room.lootDrops.length; i++) {
      const d = room.lootDrops[i];
      const dist = Math.hypot(
        d.position.x - player.position.x,
        d.position.y - player.position.y,
        d.position.z - player.position.z,
      );
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = i;
      }
    }
    if (bestIdx === -1) return;

    const emptySlot = player.slots.findIndex((s) => s === null);
    if (emptySlot === -1) return;
    const [picked] = room.lootDrops.splice(bestIdx, 1);
    player.slots[emptySlot] = picked.item;
    player.activeSlot = emptySlot;
    player.massKg = computePlayerMassKg(player.slots);
    if (!player.isBot && player.ws) {
      this.sendToPlayer(player, {
        type: 'player:select_slot',
        payload: { slotIndex: emptySlot },
      });
      this.sendToPlayer(player, {
        type: 'fx:pickup',
        payload: { itemName: picked.item.name },
      });
    }
  }

  private applyVoxelCarve(
    room: GameRoom,
    wx: number,
    wy: number,
    wz: number,
    radiusVoxels: number,
    scorchShell: boolean,
  ): void {
    const { removed, deltas } = carveSphere(room.grid, wx, wy, wz, radiusVoxels, scorchShell);
    const { collapsed, deltas: collapseDeltas } = collapseFloatingClusters(
      room.grid,
      wx,
      wy,
      wz,
      Math.max(8, Math.round(radiusVoxels) + 6),
    );
    const allDeltas = deltas.concat(collapseDeltas);
    if (allDeltas.length > 0) {
      room.deltas.push(...allDeltas);
      room.pendingTickDeltas.push(...allDeltas);
    }
    const shrapnel = removed.concat(collapsed);
    if (shrapnel.length > 0) {
      this.broadcastToRoom(room, {
        type: 'fx:shrapnel',
        payload: {
          center: { x: wx, y: wy, z: wz },
          count: Math.min(28, shrapnel.length),
          voxels: shrapnel.slice(0, 28),
        },
      });
    }
  }

  private damagePlayer(
    room: GameRoom,
    victim: ServerPlayer,
    amount: number,
    attacker: ServerPlayer | null,
    reason: string,
  ): void {
    if (!victim.alive) return;
    if (this.devEnabled && room.devGodMode && !victim.isBot) return;
    victim.hp = Math.max(0, Math.round((victim.hp - amount) * 10) / 10);
    if (victim.isBot && attacker && attacker.id !== victim.id) {
      notifyBotDamaged(victim.botBrain, attacker.id);
    }
    if (attacker && attacker.id !== victim.id && !attacker.isBot && attacker.ws && amount >= 3) {
      this.sendToPlayer(attacker, {
        type: 'fx:hit',
        payload: { damage: Math.round(amount), heavy: amount >= 28 || victim.hp <= 0 },
      });
    }
    if (victim.hp <= 0) {
      this.killPlayer(room, victim, attacker, reason);
    }
  }

  private killPlayer(
    room: GameRoom,
    victim: ServerPlayer,
    attacker: ServerPlayer | null,
    reason: string,
  ): void {
    if (!victim.alive) return;
    victim.alive = false;
    victim.hp = 0;
    victim.isTypingPrompt = false;
    if (victim.prompt) {
      this.recordPromptEvent(room, victim, 'cancelled', victim.prompt.kind, {
        elapsedMs: victim.promptOpenedAt ? Date.now() - victim.promptOpenedAt : null,
        reason: 'death',
      });
    } else if (room.rafflePlayerId === victim.id) {
      this.recordPromptEvent(room, victim, 'cancelled', 'event', {
        elapsedMs: null,
        reason: 'death',
      });
    }
    victim.prompt = null;
    victim.promptSessionId = null;
    victim.promptOpenedAt = null;
    victim.forge = { phase: 'dead', endsAt: null };
    if (room.rafflePlayerId === victim.id) {
      this.resetEventCycle(room, 1);
    }
    room.totalKills += 1;
    room.lastKillElapsedSec = room.elapsedSec;

    if (attacker && attacker.id !== victim.id) {
      attacker.kills += 1;
      const activeWeapon = attacker.slots[attacker.activeSlot]?.weapon;
      if (activeWeapon?.catalogId) {
        this.ledger?.recordUsage({
          itemId: activeWeapon.catalogId,
          kind: 'weapon',
          role: 'kill',
          actorType: attacker.isBot ? 'bot' : 'human',
          actorRef: attacker.id,
          roomId: room.id,
          matchId: room.matchId,
          targetRef: victim.id,
          catalogVersion: getCatalogVersion(),
          metadata: { name: activeWeapon.name, reason },
        });
      }
    }

    const victimWeapon = victim.slots[victim.activeSlot]?.weapon;
    if (victimWeapon?.catalogId) {
      this.ledger?.recordUsage({
        itemId: victimWeapon.catalogId,
        kind: 'weapon',
        role: 'survival',
        actorType: victim.isBot ? 'bot' : 'human',
        actorRef: victim.id,
        roomId: room.id,
        matchId: room.matchId,
        catalogVersion: getCatalogVersion(),
        metadata: {
          survivedSec: Math.round(room.elapsedSec),
          won: false,
          reason,
        },
      });
    }

    // Drop entire inventory physically on death
    for (let i = 0; i < victim.slots.length; i++) {
      const item = victim.slots[i];
      if (!item) continue;
      room.lootDrops.push({
        id: `loot_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 5)}`,
        position: {
          x: victim.position.x + (Math.random() - 0.5) * 1.4,
          y: victim.position.y + 0.5,
          z: victim.position.z + (Math.random() - 0.5) * 1.4,
        },
        item,
      });
      victim.slots[i] = null;
    }

    this.broadcastKillfeed(room, {
      id: `kf_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
      text: attacker
        ? `${attacker.name} eliminou ${victim.name} (${reason})`
        : `${victim.name} sucumbiu (${reason})`,
      tone: 'kill',
      ts: Date.now(),
    });

    const alivePlayers = Array.from(room.players.values()).filter((p) => p.alive);
    if (alivePlayers.length <= 1 && room.players.size >= 2) {
      room.phase = 'ended';
      const winner = alivePlayers[0] ?? null;
      room.summary = {
        winnerId: winner?.id ?? null,
        winnerName: winner?.name ?? 'Ninguém',
        durationSec: Math.round(room.elapsedSec),
        totalKills: room.totalKills,
        eventsTriggered: room.eventsTriggered,
        standings: Array.from(room.players.values())
          .sort((a, b) => Number(b.alive) - Number(a.alive) || b.kills - a.kills)
          .map((p) => ({
            id: p.id,
            name: p.name,
            isBot: p.isBot,
            alive: p.alive,
            kills: p.kills,
            weaponsCreated: p.weaponsCreated,
            personalityLabel: p.personalityLabel,
          })),
      };
      const winnerWeapon = winner?.slots[winner.activeSlot]?.weapon;
      if (winnerWeapon?.catalogId) {
        this.ledger?.recordUsage({
          itemId: winnerWeapon.catalogId,
          kind: 'weapon',
          role: 'survival',
          actorType: winner.isBot ? 'bot' : 'human',
          actorRef: winner.id,
          roomId: room.id,
          matchId: room.matchId,
          catalogVersion: getCatalogVersion(),
          metadata: {
            survivedSec: Math.round(room.elapsedSec),
            won: true,
          },
        });
      }
    }
  }

  private tickRoom(room: GameRoom, dt: number): void {
    if (room.phase !== 'playing') return;

    room.elapsedSec += dt;
    const now = Date.now();
    const hasLowGrav = room.activeEvents.some(
      (e) =>
        e.warningRemainingSec <= 0 &&
        this.getEventComponents(e).some(
          (component) =>
            component.archetype === 'WEATHER_HAZARD' &&
            component.params.weatherKind === 'low_gravity',
        ),
    );
    const gravity = hasLowGrav ? 10 : 24;

    let effectiveWaterLevel = WATER_LEVEL_WORLD;
    const tideEvent = room.activeEvents.find(
      (e) =>
        e.warningRemainingSec <= 0 &&
        this.getEventComponents(e).some(
          (component) =>
            component.archetype === 'TERRAIN_MUTATION' &&
            component.params.mutationKind === 'rising_tide',
        ),
    );
    if (tideEvent) {
      const progress =
        1 - tideEvent.durationRemainingSec / Math.max(1, tideEvent.totalDurationSec);
      const surge = Math.sin(Math.max(0, Math.min(1, progress)) * Math.PI);
      effectiveWaterLevel = WATER_LEVEL_WORLD + surge * 3.0;
    }

    // 1. Update timers & anti-stagnation catastrophes
    for (const player of room.players.values()) {
      if (player.prompt && now >= player.prompt.endsAt) {
        this.cancelPrompt(room, player, true);
      }
    }

    if (room.rafflePlayerId) {
      room.raffleRemainingSec = Math.max(0, Math.ceil((room.eventEndsAt - now) / 1000));
      if (room.eventEndsAt <= now) {
        if (room.rafflePendingIsBot) {
          const botWinner = room.players.get(room.rafflePlayerId);
          if (botWinner && botWinner.alive) {
            const eventPool = botWinner.botBrain?.personality.eventPrompts ?? BOT_EVENT_PROMPTS;
            const prompt = eventPool[Math.floor(Math.random() * eventPool.length)];
            const center: [number, number, number] = [
              (room.dimX * VOXEL_SIZE) / 2,
              10,
              (room.dimZ * VOXEL_SIZE) / 2,
            ];
            const resolution = resolveEventFromCatalog(
              prompt,
              botWinner.id,
              botWinner.name,
              center,
              { allowedIds: room.contentPool?.eventIds },
            );
            this.recordPromptEvent(room, botWinner, 'submitted', 'event', {
              prompt,
              itemId: resolution.itemId,
              strategy: resolution.strategy,
              budgetUsed: resolution.event.budgetUsed,
              wasClamped: resolution.event.wasClamped,
              elapsedMs: null,
              reason: null,
              poolHash: room.contentPool?.hash ?? null,
              poolMiss: resolution.poolMiss ?? false,
            });
            this.enqueueMapEvent(room, resolution.event);
          }
        } else {
          const raffled = room.players.get(room.rafflePlayerId);
          if (raffled && !raffled.prompt) {
            this.recordPromptEvent(room, raffled, 'timed_out', 'event', {
              elapsedMs: null,
              reason: 'timeout',
            });
          }
        }
        this.resetEventCycle(room);
      }
    } else {
      room.eventCooldownSec = Math.max(0, Math.ceil((room.eventEndsAt - now) / 1000));
      if (room.eventEndsAt <= now) {
        this.raffleEventPlayer(room);
      }
    }

    if (room.elapsedSec - room.lastKillElapsedSec > 120 + room.stagnationLevel * 45) {
      room.stagnationLevel += 1;
      const center: [number, number, number] = [
        (room.dimX * VOXEL_SIZE) / 2,
        10,
        (room.dimZ * VOXEL_SIZE) / 2,
      ];
      const resolution = resolveEventFromCatalog(
        'Tempestade apocaliptica de meteoros e terremotos',
        'server',
        'Tempestade da Ilha',
        center,
      );
      this.recordPromptEvent(room, null, 'submitted', 'event', {
        actorType: 'system',
        actorRef: 'server',
        prompt: 'Tempestade apocaliptica de meteoros e terremotos',
        itemId: resolution.itemId,
        strategy: resolution.strategy,
        budgetUsed: resolution.event.budgetUsed,
        wasClamped: resolution.event.wasClamped,
        elapsedMs: null,
        reason: null,
      });
      this.enqueueMapEvent(room, resolution.event);
    }

    // 2. Tick active events
    this.tickEvents(room, dt);

    // 3. Update bots & players
    for (const player of room.players.values()) {
      if (!player.alive) continue;

      if (player.isBot) {
        if (this.devEnabled && room.devBotsFrozen) {
          player.moveX = 0;
          player.moveZ = 0;
          player.jumpQueued = false;
        } else {
          this.tickBot(room, player, dt, effectiveWaterLevel, now);
        }
      }

      if (this.devEnabled && room.devInfiniteSandbox && !player.isBot) {
        player.canForgeWeapon = true;
        player.weaponCooldownSec = 0;
        player.heat = 0;
        player.overheatedUntil = 0;
      } else if (!player.canForgeWeapon) {
        player.weaponCooldownSec = Math.max(0, player.weaponCooldownSec - dt);
        if (player.weaponCooldownSec <= 0) {
          player.canForgeWeapon = true;
        }
      }

      if (player.grappleTimerSec > 0) {
        player.grappleTimerSec = Math.max(0, player.grappleTimerSec - dt);
        if (player.grappleTimerSec <= 0) {
          player.grappleTarget = null;
          player.grappleMode = null;
          player.grappleTargetId = null;
        } else if (player.grappleTargetId) {
          const trackedPlayer = room.players.get(player.grappleTargetId);
          if (trackedPlayer && trackedPlayer.alive) {
            player.grappleTarget = {
              x: trackedPlayer.position.x,
              y: trackedPlayer.position.y + 0.9,
              z: trackedPlayer.position.z,
            };
          } else {
            const trackedEntity = room.entities.find((e) => e.id === player.grappleTargetId);
            if (trackedEntity) {
              player.grappleTarget = {
                x: trackedEntity.position.x,
                y: trackedEntity.position.y + 0.6,
                z: trackedEntity.position.z,
              };
            }
          }
        }
      }

      // Cool down weapon heat
      const activeWeapon = player.slots[player.activeSlot]?.weapon;
      const coolRate = activeWeapon ? 8 + activeWeapon.stats.cooling * 2.5 : 18;
      player.heat = Math.max(0, player.heat - coolRate * dt);

      // Toxic leak risk
      if (activeWeapon?.selfRisk.includes('toxic_leak')) {
        this.damagePlayer(room, player, 1.4 * dt, null, 'vazamento tóxico');
        if (!player.alive) continue;
      }

      // Burn effect
      if (now < player.burnUntil) {
        this.damagePlayer(room, player, 4.5 * dt, null, 'queimadura');
        if (!player.alive) continue;
      }

      // Movement physics
      const weightPenalty = Math.max(0.65, 1 - Math.max(0, player.massKg - 77) * 0.009);
      const freezeMult = now < player.freezeUntil ? 0.55 : 1.0;
      const moveSpeed = 7.4 * weightPenalty * freezeMult;

      const sinY = Math.sin(player.yaw);
      const cosY = Math.cos(player.yaw);
      const forwardX = sinY;
      const forwardZ = cosY;
      const rightX = cosY;
      const rightZ = -sinY;

      const wishX = forwardX * player.moveZ + rightX * player.moveX;
      const wishZ = forwardZ * player.moveZ + rightZ * player.moveX;
      const wishLen = Math.hypot(wishX, wishZ);

      if (player.grappleTimerSec <= 0.05) {
        const accel = wishLen > 0.01 ? 14 : 10;
        const targetVx = wishLen > 0.01 ? (wishX / wishLen) * moveSpeed : 0;
        const targetVz = wishLen > 0.01 ? (wishZ / wishLen) * moveSpeed : 0;
        player.velocity.x += (targetVx - player.velocity.x) * Math.min(1, accel * dt);
        player.velocity.z += (targetVz - player.velocity.z) * Math.min(1, accel * dt);
      }

      const { grounded, inWater } = resolvePlayerMovement(
        room.grid,
        player.position,
        player.velocity,
        dt,
        0.34,
        1.65,
        gravity,
        effectiveWaterLevel,
      );

      if (player.jumpQueued) {
        player.jumpQueued = false;
        if (grounded || inWater) {
          player.velocity.y = inWater ? 6.5 : hasLowGrav ? 10.5 : 8.8;
        }
      }

      // Water drowning limit
      if (inWater && !(this.devEnabled && room.devGodMode && !player.isBot)) {
        player.oxygen = Math.max(0, player.oxygen - 12.5 * dt);
        if (player.oxygen <= 0) {
          this.damagePlayer(room, player, 14 * dt, null, 'afogamento');
          if (!player.alive) continue;
        }
      } else {
        player.oxygen = Math.min(100, player.oxygen + 28 * dt);
      }

      // Auto-collect nearby supply crates & dropped weapons for bots
      for (let i = room.entities.length - 1; i >= 0; i--) {
        const ent = room.entities[i];
        if (ent.kind === 'supply_crate') {
          const d = Math.hypot(
            ent.position.x - player.position.x,
            ent.position.y - player.position.y,
            ent.position.z - player.position.z,
          );
          if (d < 1.65) {
            this.pickupNearestItem(room, player);
          }
        }
      }
      if (player.isBot && player.slots.some((s) => s === null)) {
        for (let i = room.lootDrops.length - 1; i >= 0; i--) {
          const drop = room.lootDrops[i];
          if (drop.item.kind !== 'weapon') continue;
          const d = Math.hypot(
            drop.position.x - player.position.x,
            drop.position.y - player.position.y,
            drop.position.z - player.position.z,
          );
          if (d < 1.8) {
            this.pickupNearestItem(room, player);
            break;
          }
        }
      }
    }

    // 4. Update projectiles
    this.tickProjectiles(room, dt);

    // 5. Update spawned entities (creatures + falling supply crates)
    this.tickEntities(room, dt, gravity, effectiveWaterLevel);

    // 6. Broadcast tick + voxel deltas
    if (room.pendingTickDeltas.length > 0) {
      const batch = room.pendingTickDeltas.splice(0, room.pendingTickDeltas.length);
      this.broadcastToRoom(room, { type: 'voxel:deltas', payload: batch });
    }

    const tickPayload: RoomTickPayload = {
      hostId: room.hostId,
      hostName: room.players.get(room.hostId)?.name ?? 'Master',
      accessMode: room.accessMode,
      players: Array.from(room.players.values()).map((p) => this.stripPlayer(p)),
      projectiles: room.projectiles.map((pr) => ({
        id: pr.id,
        ownerId: pr.ownerId,
        catalogId: pr.catalogId,
        position: pr.position,
        velocity: pr.velocity,
        color: pr.color,
        behavior: pr.behavior,
        statusEffect: pr.statusEffect,
        craterRadius: pr.craterRadius,
        damage: pr.damage,
        ttlSec: pr.ttlSec,
      })),
      lootDrops: room.lootDrops,
      entities: room.entities,
      activeEvents: room.activeEvents,
      serverNow: now,
      event: this.buildEventCycleState(room),
      catalogVersion: getCatalogVersion(),
      assetVersion: getAssetVersion(),
      contentPool: summarizeContentPool(room.contentPool),
      eventCooldownSec: Math.round(room.eventCooldownSec),
      rafflePlayerId: room.rafflePlayerId,
      rafflePlayerName: room.rafflePlayerName,
      raffleRemainingSec: Math.ceil(room.raffleRemainingSec),
      stagnationLevel: room.stagnationLevel,
      waterLevelWorld: effectiveWaterLevel,
      phase: room.phase,
      summary: room.summary,
      ...(this.devEnabled ? { devState: this.buildDevState(room) } : {}),
    };

    this.broadcastToRoom(room, { type: 'room:tick', payload: tickPayload });
  }

  private buildDevState(room: GameRoom): DevRoomState {
    return {
      enabled: this.devEnabled,
      godMode: room.devGodMode,
      infiniteSandbox: room.devInfiniteSandbox,
      botsFrozen: room.devBotsFrozen,
    };
  }

  private handleDevAction(room: GameRoom, player: ServerPlayer, payload?: DevActionPayload): void {
    if (!this.devEnabled || !payload) return;

    switch (payload.action) {
      case 'toggle_god_mode': {
        room.devGodMode = !room.devGodMode;
        if (room.devGodMode) {
          player.hp = 100;
          player.oxygen = 100;
          player.burnUntil = 0;
          player.freezeUntil = 0;
        }
        break;
      }

      case 'toggle_infinite_sandbox': {
        room.devInfiniteSandbox = !room.devInfiniteSandbox;
        if (room.devInfiniteSandbox) {
          player.canForgeWeapon = true;
          player.weaponCooldownSec = 0;
          player.heat = 0;
          player.overheatedUntil = 0;
        }
        break;
      }

      case 'toggle_freeze_bots': {
        room.devBotsFrozen = !room.devBotsFrozen;
        break;
      }

      case 'unlock_forge': {
        player.canForgeWeapon = true;
        player.weaponCooldownSec = 0;
        break;
      }

      case 'refill_player': {
        player.alive = true;
        player.hp = 100;
        player.oxygen = 100;
        player.heat = 0;
        player.overheatedUntil = 0;
        player.burnUntil = 0;
        player.freezeUntil = 0;
        for (const s of player.slots) {
          if (s && s.kind === 'weapon' && s.ammoMax) {
            s.ammo = s.ammoMax;
          }
        }
        break;
      }

      case 'quick_forge': {
        const prompt = String(payload.prompt || 'Rifle laser azul').slice(0, 90);
        if (room.phase !== 'playing') return;
        const resolution = resolveWeaponFromCatalog(prompt);
        this.recordPromptEvent(room, player, 'submitted', 'weapon', {
          actorType: 'dev',
          prompt,
          itemId: resolution.itemId,
          strategy: resolution.strategy,
          budgetUsed: resolution.blueprint.budgetUsed,
          wasClamped: resolution.blueprint.wasClamped,
          elapsedMs: null,
          reason: null,
        });
        this.equipForgedWeapon(room, player, resolution.blueprint);
        break;
      }

      case 'win_event_raffle': {
        if (room.phase !== 'playing') return;
        room.rafflePlayerId = player.id;
        room.rafflePlayerName = player.name;
        room.rafflePendingIsBot = false;
        room.eventPhase = 'raffle';
        room.eventEndsAt = Date.now() + 30_000;
        room.raffleRemainingSec = 30;
        room.eventCooldownSec = 0;
        this.sendToPlayer(player, {
          type: 'ai:event_raffle_won',
          payload: { remainingSec: 30 },
        });
        break;
      }

      case 'trigger_event': {
        if (room.phase !== 'playing') return;
        const prompt = String(payload.prompt || 'Chuva de meteoros flamejantes').slice(0, 90);
        const center: [number, number, number] = [
          (room.dimX * VOXEL_SIZE) / 2,
          10,
          (room.dimZ * VOXEL_SIZE) / 2,
        ];
        const resolution = resolveEventFromCatalog(prompt, player.id, player.name, center);
        this.recordPromptEvent(room, player, 'submitted', 'event', {
          actorType: 'dev',
          prompt,
          itemId: resolution.itemId,
          strategy: resolution.strategy,
          budgetUsed: resolution.event.budgetUsed,
          wasClamped: resolution.event.wasClamped,
          elapsedMs: null,
          reason: null,
        });
        resolution.event.warningRemainingSec = 1;
        this.enqueueMapEvent(room, resolution.event);
        break;
      }

      case 'clear_events': {
        room.activeEvents = [];
        room.entities = [];
        room.projectiles = [];
        break;
      }

      case 'teleport_center': {
        if (room.phase !== 'playing') return;
        const cx = (room.dimX * VOXEL_SIZE) / 2;
        const cz = (room.dimZ * VOXEL_SIZE) / 2;
        const gy = getGroundVoxelY(room.grid, Math.floor(cx / VOXEL_SIZE), Math.floor(cz / VOXEL_SIZE));
        player.position = { x: cx, y: (gy + 3) * VOXEL_SIZE, z: cz };
        player.velocity = { x: 0, y: 0, z: 0 };
        break;
      }

      case 'spawn_bot': {
        if (room.phase !== 'playing') return;
        if (room.players.size >= 18) return;
        const bot = this.spawnSingleBot(room);
        this.broadcastKillfeed(room, {
          id: `kf_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
          text: `🧪 [DEV] Bot ${bot.name} adicionado à partida`,
          tone: 'event',
          ts: Date.now(),
        });
        break;
      }

      case 'kill_bots': {
        if (room.phase !== 'playing') return;
        for (const p of room.players.values()) {
          if (p.isBot && p.alive) {
            this.killPlayer(room, p, player, 'comando dev');
          }
        }
        break;
      }

      case 'force_restart': {
        if (room.phase === 'playing' || room.phase === 'ended') {
          this.restartRoom(room);
        }
        break;
      }
    }
  }

  private newPromptSessionId(): string {
    return `ps_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  }

  private recordPromptEvent(
    room: GameRoom,
    player: ServerPlayer | null,
    phase: LedgerPhase,
    kind: LedgerPromptKind,
    extra: Partial<PromptLedgerEvent> = {},
  ): void {
    if (!this.ledger) return;
    this.ledger.record({
      sessionId: extra.sessionId ?? player?.promptSessionId ?? this.newPromptSessionId(),
      actorType: extra.actorType ?? (player?.isBot ? 'bot' : 'human'),
      actorRef: extra.actorRef ?? player?.id ?? null,
      roomId: room.id,
      matchId: room.matchId,
      kind,
      phase,
      catalogVersion: getCatalogVersion(),
      ...extra,
    });
  }

  private resetEventCycle(room: GameRoom, delaySec = EVENT_CYCLE_COOLDOWN_SEC): void {
    room.eventPhase = 'cooldown';
    room.eventEndsAt = Date.now() + delaySec * 1000;
    room.eventCooldownSec = delaySec;
    room.rafflePlayerId = null;
    room.rafflePlayerName = null;
    room.rafflePendingIsBot = false;
    room.raffleRemainingSec = 0;
  }

  private openPrompt(room: GameRoom, player: ServerPlayer, kind: PromptKind): void {
    if (player.prompt) return;
    const now = Date.now();

    if (now - player.promptOpenWindowStart > PROMPT_OPEN_RATE_WINDOW_MS) {
      player.promptOpenWindowStart = now;
      player.promptOpenCount = 0;
    }
    if (player.promptOpenCount >= PROMPT_OPEN_RATE_LIMIT) {
      this.sendToPlayer(player, {
        type: 'ai:error',
        payload: { message: 'Muitas aberturas de prompt. Aguarde alguns segundos.' },
      });
      return;
    }
    player.promptOpenCount += 1;

    if (kind === 'event') {
      if (
        room.rafflePlayerId !== player.id ||
        room.rafflePendingIsBot ||
        room.eventPhase !== 'raffle'
      ) {
        this.sendToPlayer(player, {
          type: 'ai:error',
          payload: { message: 'Você não é o jogador sorteado para o evento atual.' },
        });
        return;
      }
      player.prompt = { kind, endsAt: now + EVENT_WRITE_WINDOW_SEC * 1000 };
      player.isTypingPrompt = true;
      player.promptSessionId = this.newPromptSessionId();
      player.promptOpenedAt = now;
      room.eventPhase = 'writing';
      room.eventEndsAt = player.prompt.endsAt;
      room.raffleRemainingSec = EVENT_WRITE_WINDOW_SEC;
      this.recordPromptEvent(room, player, 'opened', 'event');
      return;
    }

    if (room.rafflePlayerId === player.id) {
      this.sendToPlayer(player, {
        type: 'ai:error',
        payload: { message: 'Resolva o Evento Global antes de forjar.' },
      });
      return;
    }
    if (!player.canForgeWeapon) {
      this.sendToPlayer(player, {
        type: 'ai:error',
        payload: { message: 'Contador da arma ainda está recarregando.' },
      });
      return;
    }
    player.prompt = { kind, endsAt: now + WEAPON_WRITE_WINDOW_SEC * 1000 };
    player.isTypingPrompt = true;
    player.promptSessionId = this.newPromptSessionId();
    player.promptOpenedAt = now;
    this.recordPromptEvent(room, player, 'opened', 'weapon');
  }

  private cancelPrompt(room: GameRoom, player: ServerPlayer, timedOut: boolean): void {
    const kind = player.prompt?.kind;
    const elapsedMs = player.promptOpenedAt ? Date.now() - player.promptOpenedAt : null;
    player.prompt = null;
    player.isTypingPrompt = false;

    if (kind) {
      this.recordPromptEvent(room, player, timedOut ? 'timed_out' : 'cancelled', kind, {
        elapsedMs,
        reason: timedOut ? 'timeout' : 'user',
      });
    }
    player.promptSessionId = null;
    player.promptOpenedAt = null;

    if (kind === 'event') {
      this.resetEventCycle(room);
      this.broadcastKillfeed(room, {
        id: `kf_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
        text: timedOut
          ? `⌛ ${player.name} não invocou o Evento Global a tempo.`
          : `✖️ ${player.name} desistiu do Evento Global.`,
        tone: 'event',
        ts: Date.now(),
      });
      return;
    }

    if (kind === 'weapon' && timedOut) {
      player.canForgeWeapon = false;
      player.weaponCooldownSec = WEAPON_TIMEOUT_COOLDOWN_SEC;
      player.forge = {
        phase: 'cooling',
        endsAt: Date.now() + WEAPON_TIMEOUT_COOLDOWN_SEC * 1000,
      };
    }
  }

  private raffleEventPlayer(room: GameRoom): void {
    const available = Array.from(room.players.values()).filter((p) => p.alive && !p.prompt);
    const availableHumans = available.filter((p) => !p.isBot);
    const pool = availableHumans.length > 0 ? availableHumans : available;
    if (pool.length === 0) {
      this.resetEventCycle(room);
      return;
    }

    const chosen = pool[Math.floor(Math.random() * pool.length)];
    const windowSec = chosen.isBot ? BOT_EVENT_WINDOW_SEC : EVENT_RAFFLE_WINDOW_SEC;

    room.rafflePlayerId = chosen.id;
    room.rafflePlayerName = chosen.name;
    room.rafflePendingIsBot = chosen.isBot;
    room.eventPhase = chosen.isBot ? 'bot' : 'raffle';
    room.eventEndsAt = Date.now() + windowSec * 1000;
    room.eventCooldownSec = 0;
    room.raffleRemainingSec = windowSec;

    this.broadcastKillfeed(room, {
      id: `kf_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
      text: `🎲 ${chosen.name} foi sorteado(a) para o Evento Global!`,
      tone: 'event',
      ts: Date.now(),
    });

    if (!chosen.isBot) {
      this.sendToPlayer(chosen, {
        type: 'ai:event_raffle_won',
        payload: { remainingSec: windowSec },
      });
    }
  }

  private tickEvents(room: GameRoom, dt: number): void {
    room.weatherTickAccum += dt;
    const doHazardPulse = room.weatherTickAccum >= 1.2;
    if (doHazardPulse) room.weatherTickAccum = 0;

    for (let i = room.activeEvents.length - 1; i >= 0; i--) {
      const evt = room.activeEvents[i];
      if (evt.warningRemainingSec > 0) {
        evt.warningRemainingSec = Math.max(0, evt.warningRemainingSec - dt);
        if (evt.warningRemainingSec <= 0) {
          this.onEventActivated(room, evt);
        }
        continue;
      }

      evt.durationRemainingSec = Math.max(0, evt.durationRemainingSec - dt);

      if (doHazardPulse) {
        for (const component of this.getEventComponents(evt)) {
          if (component.archetype !== 'WEATHER_HAZARD') continue;
          const params = component.params;
          const wKind = params.weatherKind ?? 'meteor_shower';
          if (wKind === 'meteor_shower' || wKind === 'earthquake') {
            const alivePlayers = Array.from(room.players.values()).filter((p) => p.alive);
            let rx = (0.2 + Math.random() * 0.6) * room.dimX * VOXEL_SIZE;
            let rz = (0.2 + Math.random() * 0.6) * room.dimZ * VOXEL_SIZE;
            if (alivePlayers.length > 0 && Math.random() < 0.48) {
              const anchor = alivePlayers[Math.floor(Math.random() * alivePlayers.length)];
              const rad = Math.min(28, params.radiusMeters || 18);
              const ang = Math.random() * Math.PI * 2;
              const d = Math.random() * rad;
              rx = Math.max(8, Math.min(room.dimX * VOXEL_SIZE - 8, anchor.position.x + Math.cos(ang) * d));
              rz = Math.max(8, Math.min(room.dimZ * VOXEL_SIZE - 8, anchor.position.z + Math.sin(ang) * d));
            }
            const gy = getGroundVoxelY(room.grid, Math.floor(rx / VOXEL_SIZE), Math.floor(rz / VOXEL_SIZE));
            const wy = (gy + 0.5) * VOXEL_SIZE;
            this.applyVoxelCarve(room, rx, wy, rz, wKind === 'meteor_shower' ? 5.0 : 3.5, true);
            for (const p of room.players.values()) {
              if (!p.alive) continue;
              const d = Math.hypot(p.position.x - rx, p.position.z - rz);
              if (d < 4.5) {
                this.damagePlayer(room, p, params.lethality * 0.55, null, evt.prompt);
                p.velocity.y += 6.5;
              }
            }
          } else if (wKind === 'acid_rain') {
            for (const p of room.players.values()) {
              if (!p.alive) continue;
              // Check if player has roof overhead
              const headVx = Math.floor(p.position.x / VOXEL_SIZE);
              const headVz = Math.floor(p.position.z / VOXEL_SIZE);
              const topVy = getGroundVoxelY(room.grid, headVx, headVz);
              if (topVy * VOXEL_SIZE <= p.position.y + 1.8) {
                this.damagePlayer(room, p, params.lethality * 0.16, null, 'chuva ácida');
              }
            }
          } else if (wKind === 'blizzard') {
            const now = Date.now();
            for (const p of room.players.values()) {
              if (!p.alive) continue;
              p.freezeUntil = now + 1500;
              this.damagePlayer(room, p, params.lethality * 0.1, null, 'nevasca');
            }
          }
        }
      }

      if (evt.durationRemainingSec <= 0) {
        room.activeEvents.splice(i, 1);
      }
    }
  }

  private getEventComponents(evt: MapEventState): MapEventComponent[] {
    if (evt.components && evt.components.length > 0) return evt.components;
    return [
      {
        archetype: evt.archetype,
        params: evt.params,
        entityBlueprint: evt.entityBlueprint,
        budgetUsed: evt.budgetUsed,
      },
    ];
  }

  private onEventActivated(room: GameRoom, evt: MapEventState): void {
    const components = this.getEventComponents(evt);
    for (let index = 0; index < components.length; index++) {
      this.activateEventComponent(room, evt, components[index], index);
    }
  }

  private activateEventComponent(
    room: GameRoom,
    evt: MapEventState,
    component: MapEventComponent,
    componentIndex: number,
  ): void {
    const cx = (room.dimX * VOXEL_SIZE) / 2;
    const cz = (room.dimZ * VOXEL_SIZE) / 2;
    const params = component.params;

    if (component.archetype === 'SUPPLY_DROP') {
      const qty = Math.max(1, Math.min(8, params.quantity));
      for (let i = 0; i < qty; i++) {
        const angle = (i / qty) * Math.PI * 2 + Math.random();
        const dist = 6 + Math.random() * (room.dimX * VOXEL_SIZE * 0.28);
        const x = cx + Math.cos(angle) * dist;
        const z = cz + Math.sin(angle) * dist;
        const gy = getGroundVoxelY(room.grid, Math.floor(x / VOXEL_SIZE), Math.floor(z / VOXEL_SIZE));
        room.entities.push({
          id: `sup_${evt.id}_${componentIndex}_${i}`,
          eventId: evt.id,
          kind: 'supply_crate',
          name: 'Caixa de Suprimentos',
          position: { x, y: Math.max(30, gy * VOXEL_SIZE + 18), z },
          velocity: { x: 0, y: -3, z: 0 },
          hp: 100,
          maxHp: 100,
          aiBehavior: 'static_pickup',
          blueprint: component.entityBlueprint,
          ammoRestore: params.ammoRestore ?? 30,
        });
      }
    } else if (component.archetype === 'ENTITY_SPAWN') {
      const qty = Math.max(1, Math.min(10, params.quantity));
      for (let i = 0; i < qty; i++) {
        const angle = (i / qty) * Math.PI * 2 + Math.random();
        const dist = 7 + Math.random() * (room.dimX * VOXEL_SIZE * 0.28);
        const x = cx + Math.cos(angle) * dist;
        const z = cz + Math.sin(angle) * dist;
        const gy = getGroundVoxelY(room.grid, Math.floor(x / VOXEL_SIZE), Math.floor(z / VOXEL_SIZE));
        const hp = Math.max(25, Math.round(120 - qty * 8));
        room.entities.push({
          id: `ent_${evt.id}_${componentIndex}_${i}`,
          eventId: evt.id,
          kind: 'creature',
          name: component.entityBlueprint?.name || 'Criatura Voxel',
          position: { x, y: (gy + 1.5) * VOXEL_SIZE, z },
          velocity: { x: 0, y: 0, z: 0 },
          hp,
          maxHp: hp,
          aiBehavior: params.aiBehavior ?? 'aggressive_nearest',
          blueprint: component.entityBlueprint,
        });
      }
    } else if (component.archetype === 'TERRAIN_MUTATION') {
      const mKind = params.mutationKind ?? 'crystal_spires';
      if (mKind === 'rising_tide') {
        // Rising tide surges smoothly via tickRoom effectiveWaterLevel
        return;
      }
      const deltas: VoxelDelta[] = [];
      if (mKind === 'fissure') {
        const xMid = Math.floor(room.dimX / 2);
        const zMid = Math.floor(room.dimZ / 2);
        const halfLen = Math.min(54, Math.floor(room.dimX * 0.16));
        for (let vx = xMid - halfLen; vx <= xMid + halfLen; vx++) {
          for (let dz = -3; dz <= 3; dz++) {
            for (let vy = 1; vy < room.dimY - 2; vy++) {
              if (room.grid.set(vx, vy, zMid + dz, MAT.AIR)) {
                deltas.push({ vx, vy, vz: zMid + dz, mat: MAT.AIR });
              }
            }
          }
        }
      } else {
        const pillars = mKind === 'volcano' ? 2 : 7;
        for (let p = 0; p < pillars; p++) {
          const px = Math.floor((0.25 + Math.random() * 0.5) * room.dimX);
          const pz = Math.floor((0.25 + Math.random() * 0.5) * room.dimZ);
          const h = mKind === 'volcano' ? 22 : 16;
          const rMax = mKind === 'volcano' ? 11 : 5;
          const baseY = getGroundVoxelY(room.grid, px, pz);
          for (let dy = 0; dy < h; dy++) {
            const r = Math.max(1, Math.round(rMax * (1 - dy / (h + 2))));
            for (let dz = -r; dz <= r; dz++) {
              for (let dx = -r; dx <= r; dx++) {
                if (dx * dx + dz * dz > r * r) continue;
                const vy = Math.min(room.dimY - 2, baseY + dy);
                const mat =
                  mKind === 'volcano' && dy >= h - 3 && dx * dx + dz * dz <= 1
                    ? MAT.LAVA
                    : mKind === 'volcano'
                      ? MAT.SCORCHED
                      : MAT.CRYSTAL;
                if (room.grid.set(px + dx, vy, pz + dz, mat)) {
                  deltas.push({ vx: px + dx, vy, vz: pz + dz, mat });
                }
              }
            }
          }
        }
      }
      if (deltas.length > 0) {
        room.deltas.push(...deltas);
        room.pendingTickDeltas.push(...deltas);
      }
    }
  }

  private tickProjectiles(room: GameRoom, dt: number): void {
    const now = Date.now();
    for (let i = room.projectiles.length - 1; i >= 0; i--) {
      const pr = room.projectiles[i];
      pr.ttlSec -= dt;
      if (pr.ttlSec <= 0) {
        if (pr.stuck && pr.craterRadius > 0) {
          this.explodeProjectile(room, pr);
        }
        room.projectiles.splice(i, 1);
        continue;
      }

      if (pr.stuck) {
        pr.stickyTimerSec -= dt;
        if (pr.stickyTimerSec <= 0) {
          this.explodeProjectile(room, pr);
          room.projectiles.splice(i, 1);
        }
        continue;
      }

      if (pr.behavior === 'homing_weak') {
        let nearest: ServerPlayer | null = null;
        let bestD = 18;
        for (const p of room.players.values()) {
          if (!p.alive || p.id === pr.ownerId) continue;
          const d = Math.hypot(
            p.position.x - pr.position.x,
            p.position.y + 0.9 - pr.position.y,
            p.position.z - pr.position.z,
          );
          if (d < bestD) {
            bestD = d;
            nearest = p;
          }
        }
        if (nearest) {
          const speed = Math.hypot(pr.velocity.x, pr.velocity.y, pr.velocity.z) || 1;
          const tx = (nearest.position.x - pr.position.x) / bestD;
          const ty = (nearest.position.y + 0.9 - pr.position.y) / bestD;
          const tz = (nearest.position.z - pr.position.z) / bestD;
          pr.velocity.x += (tx * speed - pr.velocity.x) * 3.5 * dt;
          pr.velocity.y += (ty * speed - pr.velocity.y) * 3.5 * dt;
          pr.velocity.z += (tz * speed - pr.velocity.z) * 3.5 * dt;
        }
      }

      pr.velocity.y -= 9.5 * dt;
      const dx = pr.velocity.x * dt;
      const dy = pr.velocity.y * dt;
      const dz = pr.velocity.z * dt;
      const stepDist = Math.hypot(dx, dy, dz);

      // First check swept voxel wall hit so entity hits behind walls are ignored
      const hit =
        stepDist > 1e-5
          ? raycastVoxels(
              room.grid,
              pr.position.x,
              pr.position.y,
              pr.position.z,
              dx,
              dy,
              dz,
              stepDist,
            )
          : {
              hit: false,
              vx: 0,
              vy: 0,
              vz: 0,
              nx: 0,
              ny: 0,
              nz: 0,
              distance: stepDist,
              point: { ...pr.position },
              material: MAT.AIR,
            };

      const maxTravelFrac =
        hit.hit && stepDist > 1e-5 ? Math.max(0, Math.min(1, hit.distance / stepDist)) : 1;
      const endX = pr.position.x + dx * maxTravelFrac;
      const endY = pr.position.y + dy * maxTravelFrac;
      const endZ = pr.position.z + dz * maxTravelFrac;

      // Swept segment-to-point check against players & creatures before wall contact
      let bestT = 2;
      let hitPlayer: ServerPlayer | null = null;
      let hitCreatureIdx = -1;

      for (const p of room.players.values()) {
        if (!p.alive || p.id === pr.ownerId) continue;
        const { distSq, t } = closestPointOnSegmentT(
          p.position.x,
          p.position.y + 0.9,
          p.position.z,
          pr.position.x,
          pr.position.y,
          pr.position.z,
          endX,
          endY,
          endZ,
        );
        if (distSq <= 1.0 && t < bestT) {
          bestT = t;
          hitPlayer = p;
          hitCreatureIdx = -1;
        }
      }

      for (let ei = room.entities.length - 1; ei >= 0; ei--) {
        const ent = room.entities[ei];
        if (ent.kind !== 'creature') continue;
        const { distSq, t } = closestPointOnSegmentT(
          ent.position.x,
          ent.position.y + 0.6,
          ent.position.z,
          pr.position.x,
          pr.position.y,
          pr.position.z,
          endX,
          endY,
          endZ,
        );
        if (distSq <= 1.32 && t < bestT) {
          bestT = t;
          hitCreatureIdx = ei;
          hitPlayer = null;
        }
      }

      if (hitPlayer) {
        pr.position.x = pr.position.x + (endX - pr.position.x) * bestT;
        pr.position.y = pr.position.y + (endY - pr.position.y) * bestT;
        pr.position.z = pr.position.z + (endZ - pr.position.z) * bestT;
        const attacker = room.players.get(pr.ownerId) ?? null;
        this.damagePlayer(room, hitPlayer, pr.damage, attacker, 'tiro de arma IA');
        if (pr.catalogId) {
          this.ledger?.recordUsage({
            itemId: pr.catalogId,
            kind: 'weapon',
            role: 'damage',
            actorType: attacker?.isBot ? 'bot' : 'human',
            actorRef: pr.ownerId,
            roomId: room.id,
            matchId: room.matchId,
            targetRef: hitPlayer.id,
            catalogVersion: getCatalogVersion(),
            metadata: {
              damage: pr.damage,
              behavior: pr.behavior,
              status: pr.statusEffect,
            },
          });
        }
        this.applyStatusEffect(room, hitPlayer, pr, now);
        if (pr.craterRadius > 0) this.explodeProjectile(room, pr, hitPlayer.id);
        room.projectiles.splice(i, 1);
        continue;
      }

      if (hitCreatureIdx !== -1) {
        pr.position.x = pr.position.x + (endX - pr.position.x) * bestT;
        pr.position.y = pr.position.y + (endY - pr.position.y) * bestT;
        pr.position.z = pr.position.z + (endZ - pr.position.z) * bestT;
        const ent = room.entities[hitCreatureIdx];
        ent.hp -= pr.damage;
        const attacker = room.players.get(pr.ownerId) ?? null;
        if (pr.catalogId) {
          this.ledger?.recordUsage({
            itemId: pr.catalogId,
            kind: 'weapon',
            role: 'damage',
            actorType: attacker?.isBot ? 'bot' : 'human',
            actorRef: pr.ownerId,
            roomId: room.id,
            matchId: room.matchId,
            targetRef: ent.id,
            catalogVersion: getCatalogVersion(),
            metadata: { damage: pr.damage, target: 'entity' },
          });
        }
        if (attacker && !attacker.isBot && attacker.ws) {
          this.sendToPlayer(attacker, {
            type: 'fx:hit',
            payload: { damage: Math.round(pr.damage), heavy: ent.hp <= 0 || pr.damage >= 28 },
          });
        }
        if (ent.hp <= 0) room.entities.splice(hitCreatureIdx, 1);
        if (pr.craterRadius > 0) this.explodeProjectile(room, pr);
        room.projectiles.splice(i, 1);
        continue;
      }

      if (hit.hit) {
        if (pr.behavior === 'bouncing' && pr.bouncesLeft > 0) {
          pr.bouncesLeft -= 1;
          if (hit.nx !== 0) pr.velocity.x *= -0.82;
          if (hit.ny !== 0) pr.velocity.y *= -0.82;
          if (hit.nz !== 0) pr.velocity.z *= -0.82;
          pr.position = {
            x: hit.point.x + hit.nx * 0.25,
            y: hit.point.y + hit.ny * 0.25,
            z: hit.point.z + hit.nz * 0.25,
          };
          continue;
        }
        if (pr.behavior === 'sticky_bomb') {
          pr.stuck = true;
          pr.position = hit.point;
          pr.velocity = { x: 0, y: 0, z: 0 };
          continue;
        }
        if (pr.behavior === 'piercing' && pr.pierceLeft > 0) {
          pr.pierceLeft -= 1;
          this.applyVoxelCarve(room, (hit.vx + 0.5) * VOXEL_SIZE, (hit.vy + 0.5) * VOXEL_SIZE, (hit.vz + 0.5) * VOXEL_SIZE, 2, false);
          pr.position.x += dx;
          pr.position.y += dy;
          pr.position.z += dz;
          continue;
        }

        pr.position = hit.point;
        this.explodeProjectile(room, pr);
        room.projectiles.splice(i, 1);
        continue;
      }

      pr.position.x += dx;
      pr.position.y += dy;
      pr.position.z += dz;
    }
  }

  private applyStatusEffect(
    room: GameRoom,
    target: ServerPlayer,
    pr: ServerProjectile,
    now: number,
  ): void {
    if (pr.statusEffect === 'knockback') {
      const len = Math.hypot(pr.velocity.x, pr.velocity.z) || 1;
      target.velocity.x += (pr.velocity.x / len) * 12;
      target.velocity.y += 6.5;
      target.velocity.z += (pr.velocity.z / len) * 12;
    } else if (pr.statusEffect === 'burn') {
      target.burnUntil = now + 3500;
    } else if (pr.statusEffect === 'freeze') {
      target.freezeUntil = now + 3500;
    } else if (pr.statusEffect === 'gravity_pull') {
      target.velocity.x += (pr.position.x - target.position.x) * 3;
      target.velocity.z += (pr.position.z - target.position.z) * 3;
    }
    void room;
  }

  private explodeProjectile(
    room: GameRoom,
    pr: ServerProjectile,
    directHitPlayerId?: string,
  ): void {
    if (pr.craterRadius > 0) {
      const voxelRad = Math.max(1, Math.round(pr.craterRadius * (0.5 / VOXEL_SIZE)));
      this.applyVoxelCarve(
        room,
        pr.position.x,
        pr.position.y,
        pr.position.z,
        voxelRad,
        pr.statusEffect === 'burn' || pr.craterRadius >= 2,
      );
      const splashRadius = 1.6 + pr.craterRadius * 0.75;
      const attacker = room.players.get(pr.ownerId) ?? null;
      for (const p of room.players.values()) {
        if (!p.alive || p.id === directHitPlayerId) continue;
        const d = Math.hypot(
          p.position.x - pr.position.x,
          p.position.y + 0.8 - pr.position.y,
          p.position.z - pr.position.z,
        );
        if (d <= splashRadius) {
          const falloff = 1 - d / splashRadius;
          this.damagePlayer(
            room,
            p,
            Math.round(pr.damage * 0.65 * falloff),
            attacker,
            'explosão de projétil',
          );
        }
      }
    }
  }

  private tickEntities(
    room: GameRoom,
    dt: number,
    gravity: number,
    waterLevelWorld: number,
  ): void {
    for (let i = room.entities.length - 1; i >= 0; i--) {
      const ent = room.entities[i];
      if (ent.kind === 'supply_crate') {
        resolvePlayerMovement(
          room.grid,
          ent.position,
          ent.velocity,
          dt,
          0.45,
          0.9,
          6,
          waterLevelWorld,
        );
        continue;
      }

      // Creature AI
      let nearest: ServerPlayer | null = null;
      let bestDist = 68;
      for (const p of room.players.values()) {
        if (!p.alive) continue;
        const d = Math.hypot(p.position.x - ent.position.x, p.position.z - ent.position.z);
        if (d < bestDist) {
          bestDist = d;
          nearest = p;
        }
      }

      if (nearest) {
        const dx = nearest.position.x - ent.position.x;
        const dz = nearest.position.z - ent.position.z;
        const len = Math.hypot(dx, dz) || 1;
        const dirSign = ent.aiBehavior === 'fleeing' ? -1 : 1;
        const speed = ent.aiBehavior === 'explosive_kamikaze' ? 6.2 : 4.6;
        ent.velocity.x = (dx / len) * speed * dirSign;
        ent.velocity.z = (dz / len) * speed * dirSign;

        if (bestDist < 1.7) {
          if (ent.aiBehavior === 'explosive_kamikaze') {
            this.applyVoxelCarve(room, ent.position.x, ent.position.y, ent.position.z, 5, true);
            this.damagePlayer(room, nearest, 32, null, ent.name);
            room.entities.splice(i, 1);
            continue;
          } else {
            this.damagePlayer(room, nearest, 10 * dt, null, ent.name);
          }
        }
      }

      resolvePlayerMovement(
        room.grid,
        ent.position,
        ent.velocity,
        dt,
        0.45,
        1.1,
        gravity,
        waterLevelWorld,
      );
    }
  }

  private tickBot(
    room: GameRoom,
    bot: ServerPlayer,
    dt: number,
    waterLevelWorld: number,
    nowMs: number,
  ): void {
    if (!bot.botBrain) {
      const personality = createBotPersonality(room.seed + bot.name.length * 31);
      personality.handle = bot.name;
      bot.personalityLabel = personality.label;
      bot.botBrain = createBotBrainState(personality, bot.position);
    }

    const brain = bot.botBrain;
    const enemies = Array.from(room.players.values());
    const action = stepBotBrain(brain, {
      bot,
      grid: room.grid,
      enemies,
      lootDrops: room.lootDrops,
      entities: room.entities,
      waterLevelWorld,
      elapsedSec: room.elapsedSec,
      nowMs,
      dt,
    });

    if (action.startTypingPrompt && !bot.botForgePrompted) {
      bot.isTypingPrompt = true;
    }

    if (action.finishTypingPrompt && bot.canForgeWeapon && !bot.botForgePrompted) {
      bot.isTypingPrompt = false;
      bot.botForgePrompted = true;
      bot.canForgeWeapon = false;
      bot.weaponCooldownSec = WEAPON_CYCLE_COOLDOWN_SEC + 1 + Math.random() * 2;
      const prompts = brain.personality.weaponPrompts;
      const prompt = prompts[Math.floor(Math.random() * prompts.length)];
      const resolution = resolveWeaponFromCatalog(prompt, {
        allowedIds: room.contentPool?.weaponIds,
      });
      this.recordPromptEvent(room, bot, 'submitted', 'weapon', {
        prompt,
        itemId: resolution.itemId,
        strategy: resolution.strategy,
        budgetUsed: resolution.blueprint.budgetUsed,
        wasClamped: resolution.blueprint.wasClamped,
        elapsedMs: null,
        reason: null,
        poolHash: room.contentPool?.hash ?? null,
        poolMiss: resolution.poolMiss ?? false,
      });
      this.equipForgedWeapon(room, bot, resolution.blueprint);
      bot.botForgePrompted = false;
    } else if (!brain.typingQueued && bot.isTypingPrompt) {
      bot.isTypingPrompt = false;
    }

    // Smooth human-like angular turn (never instant aimbot snap)
    const maxYawStep = brain.personality.turnSpeedRad * dt;
    const maxPitchStep = brain.personality.turnSpeedRad * 0.85 * dt;
    bot.yaw = rotateAngleTowards(bot.yaw, action.targetYaw, maxYawStep);
    bot.pitch = Math.max(
      -1.2,
      Math.min(1.2, rotateAngleTowards(bot.pitch, action.targetPitch, maxPitchStep)),
    );

    bot.moveX = action.moveX;
    bot.moveZ = action.moveZ;
    if (action.jump) bot.jumpQueued = true;

    if (action.activeSlot >= 0 && action.activeSlot < 4 && bot.slots[action.activeSlot]) {
      bot.activeSlot = action.activeSlot;
    }

    if (action.firePrimary) {
      this.performActiveItem(room, bot);
    }
  }

  private buildEventCycleState(room: GameRoom): EventCycleState {
    return {
      phase: room.eventPhase,
      endsAt: room.eventEndsAt,
      rafflePlayerId: room.rafflePlayerId,
      rafflePlayerName: room.rafflePlayerName,
    };
  }

  private stripPlayer(p: ServerPlayer): PlayerNetState {
    const now = Date.now();
    const forgePhase: 'cooling' | 'ready' | 'writing' | 'dead' = !p.alive
      ? 'dead'
      : p.prompt?.kind === 'weapon'
        ? 'writing'
        : p.canForgeWeapon
          ? 'ready'
          : 'cooling';
    const forgeEndsAt =
      forgePhase === 'writing'
        ? p.prompt?.endsAt ?? null
        : forgePhase === 'cooling'
          ? now + Math.max(0, p.weaponCooldownSec) * 1000
          : null;

    return {
      id: p.id,
      name: p.name,
      isBot: p.isBot,
      color: p.color,
      alive: p.alive,
      hp: p.hp,
      oxygen: p.oxygen,
      massKg: p.massKg,
      position: p.position,
      velocity: p.velocity,
      yaw: p.yaw,
      pitch: p.pitch,
      slots: p.slots,
      activeSlot: p.activeSlot,
      heat: p.heat,
      overheatedUntil: p.overheatedUntil,
      isTypingPrompt: p.prompt !== null,
      canForgeWeapon: p.canForgeWeapon,
      weaponCooldownSec: Math.ceil(p.weaponCooldownSec),
      prompt: p.prompt ? { ...p.prompt } : null,
      forge: { phase: forgePhase, endsAt: forgeEndsAt },
      kills: p.kills,
      weaponsCreated: p.weaponsCreated,
      grappleTarget: p.grappleTarget,
      burnUntil: p.burnUntil,
      freezeUntil: p.freezeUntil,
      personalityLabel: p.personalityLabel,
    };
  }

  private buildLobbyStatePayload(room: GameRoom, playerId: string): LobbyStatePayload {
    const members = Array.from(room.players.values())
      .filter((p) => !p.isBot && p.ws !== null)
      .sort((a, b) => a.joinedAt - b.joinedAt)
      .map((p) => ({
        id: p.id,
        name: p.name,
        color: p.color,
        isHost: p.id === room.hostId,
        joinedAt: p.joinedAt,
      }));
    const hostName = room.players.get(room.hostId)?.name ?? members[0]?.name ?? 'Master';
    return {
      roomId: room.id,
      roomName: room.name,
      playerId,
      hostId: room.hostId,
      hostName,
      accessMode: room.accessMode,
      hasPassword: room.accessMode === 'password',
      targetPlayers: room.targetPlayers,
      fillWithBots: room.fillWithBots,
      phase: room.phase,
      members,
      devMode: this.devEnabled,
    };
  }

  private broadcastLobbyState(room: GameRoom): void {
    for (const p of room.players.values()) {
      if (!p.isBot && p.ws) {
        this.sendToPlayer(p, {
          type: 'room:lobby_state',
          payload: this.buildLobbyStatePayload(room, p.id),
        });
      }
    }
  }

  private buildInitPayload(room: GameRoom, playerId: string): RoomInitPayload {
    const hostName = room.players.get(room.hostId)?.name ?? 'Master';
    return {
      roomId: room.id,
      roomName: room.name,
      playerId,
      hostId: room.hostId,
      hostName,
      accessMode: room.accessMode,
      seed: room.seed,
      dimX: room.dimX,
      dimY: room.dimY,
      dimZ: room.dimZ,
      deltas: room.deltas,
      players: Array.from(room.players.values()).map((p) => this.stripPlayer(p)),
      activeEvents: room.activeEvents,
      lootDrops: room.lootDrops,
      entities: room.entities,
      serverNow: Date.now(),
      event: this.buildEventCycleState(room),
      catalogVersion: getCatalogVersion(),
      assetVersion: getAssetVersion(),
      contentPool: summarizeContentPool(room.contentPool),
      eventCooldownSec: Math.round(room.eventCooldownSec),
      rafflePlayerId: room.rafflePlayerId,
      rafflePlayerName: room.rafflePlayerName,
      raffleRemainingSec: Math.ceil(room.raffleRemainingSec),
      phase: room.phase,
      devMode: this.devEnabled,
      ...(this.devEnabled ? { devState: this.buildDevState(room) } : {}),
    };
  }

  private sendToPlayer(player: ServerPlayer, msg: unknown): void {
    this.sendSocketMsg(player.ws, msg);
  }

  private broadcastToRoom(room: GameRoom, msg: unknown): void {
    const raw = JSON.stringify(msg);
    for (const p of room.players.values()) {
      if (p.ws && (p.ws.readyState === undefined || p.ws.readyState === WebSocket.OPEN)) {
        p.ws.send(raw);
      }
    }
  }

  private broadcastKillfeed(room: GameRoom, entry: KillfeedEntry): void {
    this.broadcastToRoom(room, { type: 'room:killfeed', payload: entry });
  }
}
