export const VOXEL_SIZE = 0.3125; // 0.3125m micro-voxels de alta resolução (5/16m exact)
export const CHUNK_SIZE = 16; // 16x16x16 micro-voxels por chunk (5m x 5m x 5m)
export const WATER_LEVEL_VOXEL = 10; // y <= 10 é oceano (3.125m)
export const WATER_LEVEL_WORLD = WATER_LEVEL_VOXEL * VOXEL_SIZE;

export const MAT = {
  AIR: 0,
  BEDROCK: 1,
  SAND: 2,
  GRASS: 3,
  DIRT: 4,
  STONE: 5,
  CRYSTAL: 6,
  WOOD: 7,
  LEAVES: 8,
  SCORCHED: 9,
  ICE: 10,
  LAVA: 11,
  SNOW: 12,
  TERRACOTTA: 13,
  MOSS: 14,
  BASALT: 15,
  GOLD: 16,
  LADDER: 17,
  SLUDGE: 18,
} as const;

export type MaterialId = (typeof MAT)[keyof typeof MAT];

export const MATERIAL_COLORS: Record<number, [number, number, number]> = {
  [MAT.BEDROCK]: [42, 46, 56],
  [MAT.SAND]: [227, 203, 146],
  [MAT.GRASS]: [92, 179, 79],
  [MAT.DIRT]: [134, 94, 62],
  [MAT.STONE]: [128, 136, 148],
  [MAT.CRYSTAL]: [64, 214, 240],
  [MAT.WOOD]: [118, 76, 44],
  [MAT.LEAVES]: [58, 142, 68],
  [MAT.SCORCHED]: [46, 38, 38],
  [MAT.ICE]: [172, 232, 250],
  [MAT.LAVA]: [250, 102, 24],
  [MAT.SNOW]: [240, 247, 255],
  [MAT.TERRACOTTA]: [188, 99, 64],
  [MAT.MOSS]: [66, 128, 64],
  [MAT.BASALT]: [56, 58, 68],
  [MAT.GOLD]: [244, 192, 58],
  [MAT.LADDER]: [146, 98, 54],
  [MAT.SLUDGE]: [128, 196, 52],
};

export type ProjectileBehavior =
  | 'standard'
  | 'bouncing'
  | 'homing_weak'
  | 'sticky_bomb'
  | 'piercing';

export type StatusEffect =
  | 'none'
  | 'knockback'
  | 'burn'
  | 'freeze'
  | 'gravity_pull';

export type SelfRiskFlag =
  | 'recoil_launch'
  | 'overheat_explosion'
  | 'toxic_leak';

export interface PaletteColor {
  hex: string;
  emissive: boolean;
}

export interface WeaponStats {
  damage: number; // 5..100
  fireRate: number; // 0.5..15 shots/sec
  projectiles: number; // 1..12
  spreadDeg: number; // 0..25
  rangeMeters: number; // 15..150
  ammoMax: number; // 1..120
  cooling: number; // 1..10
  massKg: number; // 1..30
}

export interface WeaponModifiers {
  voxelCraterRadius: number; // 0..5 (in micro-voxels)
  projectileBehavior: ProjectileBehavior;
  statusEffect: StatusEffect;
}

export interface WeaponAllocation {
  firepower: number; // Dano e projéteis
  cadence: number; // Cadência, munição e resfriamento
  precision: number; // Precisão e alcance
  destruction: number; // Cratera voxel e efeitos
}

export interface WeaponBlueprint {
  id: string;
  name: string;
  prompt: string;
  stats: WeaponStats;
  modifiers: WeaponModifiers;
  selfRisk: SelfRiskFlag[];
  budgetUsed: number;
  wasClamped: boolean;
  palette: PaletteColor[]; // index 1..N (0 = empty)
  rleVoxels: number[]; // flat [colorIndex, runLength, ...] for 12x12x24
  gripPos: [number, number, number];
  muzzlePos: [number, number, number];
  catalogId?: string;
  assets?: string[];
  fromDatabase?: boolean;
  fromCatalog?: boolean;
  composed?: boolean;
}

export type PromptKind = 'weapon' | 'event';

/** Relíquias ativas dropadas por eventos catastróficos. */
export type RelicId =
  | 'wind_anchor'
  | 'acid_mask'
  | 'thermal_core'
  | 'frost_heart'
  | 'storm_rod'
  | 'seismic_boots'
  | 'void_eye'
  | 'titan_heart';

export interface RelicBuffState {
  id: RelicId;
  endsAt: number;
}

export interface PromptWindowState {
  kind: PromptKind;
  endsAt: number; // epoch ms do servidor
}

export type ForgePhase = 'cooling' | 'ready' | 'writing' | 'dead';

export interface ForgeState {
  phase: ForgePhase;
  endsAt: number | null; // epoch ms; null quando pronta
}

export type EventCyclePhase = 'cooldown' | 'raffle' | 'writing' | 'bot';

export interface EventCycleState {
  phase: EventCyclePhase;
  endsAt: number | null; // epoch ms
  rafflePlayerId: string | null;
  rafflePlayerName: string | null;
}

export interface InventorySlotItem {
  id: string;
  kind: 'shovel' | 'grapple' | 'weapon' | 'relic';
  name: string;
  massKg: number;
  ammo?: number;
  ammoMax?: number;
  weapon?: WeaponBlueprint;
  relicId?: RelicId;
}

/**
 * Slot público: referência estável para o conteúdo da arma. O blueprint
 * completo viaja uma única vez em `content:items` / `room:init.contentItems`.
 */
export interface NetInventorySlot {
  id: string;
  kind: 'shovel' | 'grapple' | 'weapon' | 'relic';
  name: string;
  massKg: number;
  ammo?: number;
  ammoMax?: number;
  /** id da instância em `WeaponBlueprint.id`; ausente para ferramentas. */
  weaponId?: string;
  relicId?: RelicId;
}

export type EventArchetype =
  | 'WEATHER_HAZARD'
  | 'ENTITY_SPAWN'
  | 'TERRAIN_MUTATION'
  | 'SUPPLY_DROP'
  | 'SCENERY_SPAWN';

/** Fases de um evento catastrófico. O cliente usa para VFX/HUD; o servidor, para cadência. */
export type EventPhase = 'warning' | 'impact' | 'sustain' | 'climax' | 'dissipate';

/**
 * Assinatura física de um evento. Cada assinatura tem uma mecânica própria e
 * não pode ser reutilizada como reskin por outro evento.
 */
export type EventSignature =
  | 'orbital_barrage'
  | 'whiteout'
  | 'acid_corrosion'
  | 'quake_collapse'
  | 'gravity_collapse'
  | 'sand_wall'
  | 'supercell'
  | 'hail_barrage'
  | 'multi_vortex'
  | 'volcano_birth'
  | 'canyon_tear'
  | 'crystal_bloom'
  | 'tsunami_surge'
  | 'sinkhole_maw'
  | 'lava_river'
  | 'glacier_advance'
  | 'overgrowth_titan'
  | 'alpha_pack'
  | 'stone_colossus'
  | 'panic_herd'
  | 'detonating_swarm'
  | 'spider_nest'
  | 'hunter_squad'
  | 'ice_titan'
  | 'serpent_nest'
  | 'supply_barrage'
  | 'armored_depot'
  | 'legendary_drop'
  | 'treasure_vault'
  | 'emergency_beacon'
  | 'titan_tree'
  | 'maze_grove'
  | 'rising_house'
  | 'watchtower'
  | 'colossal_tower'
  | 'lost_temple';

/** Pulso visual/sonoro autoritativo de um evento (impacto, raio, onda, destroço). */
export interface EventPulse {
  eventId: string;
  signature: EventSignature;
  kind:
    | 'impact'
    | 'shockwave'
    | 'lightning'
    | 'hail'
    | 'debris'
    | 'roar'
    | 'eruption'
    | 'wave'
    | 'telegraph';
  position: Vec3;
  radius: number;
  intensity: number;
  ttl: number;
}

export type SceneryKind =
  | 'tree'
  | 'grove'
  | 'house'
  | 'tower'
  | 'skyscraper'
  | 'ruins';

export type EntityAiBehavior =
  | 'aggressive_nearest'
  | 'territorial'
  | 'fleeing'
  | 'explosive_kamikaze'
  | 'static_pickup';

export interface EventParams {
  radiusMeters: number; // 6..130; componentes compostos podem ser reduzidos para caber no orçamento
  durationSec: number; // 15..120
  lethality: number; // 5..45
  quantity: number; // 1..20
  weatherKind?:
    | 'acid_rain'
    | 'blizzard'
    | 'meteor_shower'
    | 'low_gravity'
    | 'earthquake'
    | 'sandstorm'
    | 'thunderstorm'
    | 'hail'
    | 'tornado';
  mutationKind?:
    | 'volcano'
    | 'fissure'
    | 'crystal_spires'
    | 'rising_tide'
    | 'sinkhole'
    | 'lava_river'
    | 'glacier'
    | 'overgrowth';
  aiBehavior?: EntityAiBehavior;
  ammoRestore?: number; // 10..60
  sceneryKind?: SceneryKind;
}

/**
 * Contrato de diversão de um evento. Não é balanceamento de dano: é o que
 * garante que o caos seja legível, tenha contra-jogada e não vire morte
 * inevitável.
 */
export interface EventFunContract {
  telegraphSec: number;
  escapeWindowSec: number;
  counterplay: string[];
  spectacle: string[];
  readability: string[];
  riskReward: string[];
  fairness: {
    unavoidableDamage: boolean;
    maxLethality: number;
  };
  botResponse: string[];
}

export interface EntityBlueprint {
  name: string;
  palette: PaletteColor[];
  rleVoxels: number[]; // 16x16x16
}

export interface MapEventComponent {
  archetype: EventArchetype;
  params: EventParams;
  entityBlueprint?: EntityBlueprint;
  budgetUsed: number;
}

export interface MapEventState {
  id: string;
  authorId: string;
  authorName: string;
  prompt: string;
  archetype: EventArchetype;
  components?: MapEventComponent[];
  fun?: EventFunContract;
  warningRemainingSec: number; // starts at 5
  durationRemainingSec: number;
  totalDurationSec: number;
  params: EventParams;
  center: [number, number, number];
  entityBlueprint?: EntityBlueprint;
  budgetUsed: number;
  wasClamped: boolean;
  /** Fase atual, calculada pelo servidor a partir do progresso do evento. */
  phase?: EventPhase;
  /** Intensidade normalizada 0..1 para VFX, áudio, câmera e HUD. */
  intensity?: number;
  /** Escala épica normalizada 0..1 derivada de raio/duração/letalidade. */
  epicScale?: number;
  catalogId?: string;
  assets?: string[];
  fromDatabase?: boolean;
  fromCatalog?: boolean;
}

/**
 * Evento no fio: os campos de apresentação estática (blueprint de entidade e
 * componentes) já foram enviados no conteúdo do evento; o tick carrega só o
 * estado que muda a 20 Hz.
 */
export type NetMapEventState = Omit<MapEventState, 'components' | 'entityBlueprint'>;

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface PlayerNetState {
  id: string;
  name: string;
  isBot: boolean;
  color: string;
  alive: boolean;
  hp: number;
  oxygen: number; // 0..100
  massKg: number;
  position: Vec3;
  velocity: Vec3;
  yaw: number;
  pitch: number;
  slots: (InventorySlotItem | null)[]; // length 4
  activeSlot: number;
  heat: number; // 0..100
  overheatedUntil: number;
  stamina: number; // 0..100 (sprint/slide/mantle)
  sprinting: boolean;
  crouching: boolean;
  sliding: boolean;
  slideCooldownSec: number;
  climbing: boolean;
  ziplineRouteId: string | null;
  isTypingPrompt: boolean;
  canForgeWeapon: boolean;
  weaponCooldownSec: number;
  prompt: PromptWindowState | null;
  forge: ForgeState;
  kills: number;
    weaponsCreated: number;
    deaths: number;
    assists: number;
    recentDamageSources: string[]; // Player IDs who recently damaged this player (for assists)
    grappleTarget: Vec3 | null;
  burnUntil: number;
  freezeUntil: number;
  relicBuff: RelicBuffState | null;
  shieldHp: number;
  personalityLabel?: string;
  respawnAt?: number; // timestamp when player will respawn (Arsenal mode)
    team?: TeamId; // time do jogador no modo Arsenal com times (blue/orange/null)
  }

/** Estado de jogador transmitido a 20 Hz; slots carregam apenas referências. */
export interface PlayerNetWireState extends Omit<PlayerNetState, 'slots'> {
  slots: (NetInventorySlot | null)[]; // length 4
}

export interface LootDropState {
  id: string;
  position: Vec3;
  item: InventorySlotItem;
}

/** Loot no fio: mesmo contrato de referência dos slots. */
export interface LootDropWireState {
  id: string;
  position: Vec3;
  item: NetInventorySlot;
}

export interface IslandZipline {
  id: string;
  from: Vec3;
  to: Vec3;
}

export interface IslandMeta {
  ziplines: IslandZipline[];
}

export interface ProjectileNetState {
  id: string;
  ownerId: string;
  catalogId?: string;
  position: Vec3;
  velocity: Vec3;
  color: string;
  behavior: ProjectileBehavior;
  statusEffect: StatusEffect;
  craterRadius: number;
  damage: number;
  ttlSec: number;
}

export interface SpawnedEntityNetState {
  id: string;
  eventId: string;
  kind: 'creature' | 'supply_crate';
  name: string;
  position: Vec3;
  velocity: Vec3;
  hp: number;
  maxHp: number;
  aiBehavior: EntityAiBehavior;
  blueprint?: EntityBlueprint;
  ammoRestore?: number;
  relicId?: RelicId;
}

export interface VoxelDelta {
  vx: number;
  vy: number;
  vz: number;
  mat: number;
}

export interface KillfeedEntry {
  id: string;
  text: string;
  tone: 'kill' | 'event' | 'forge' | 'risk';
  ts: number;
}

export interface RoomMatchSummary {
  winnerId: string | null;
  winnerName: string;
  durationSec: number;
  totalKills: number;
  eventsTriggered: number;
  arsenalTeams?: boolean;
  standings: Array<{
      id: string;
      name: string;
      isBot: boolean;
      alive: boolean;
      kills: number;
      deaths: number;
      assists: number;
      weaponsCreated: number;
      personalityLabel?: string;
      team?: TeamId; // time do jogador no modo Arsenal com times
    }>;
  }

/**
 * Identificador de time para modo Arsenal com times.
 * 'blue' = Time Azul, 'orange' = Time Laranja, null = sem time / não atribuído.
 */
export type TeamId = 'blue' | 'orange' | null;

export type RoomAccessMode = 'open' | 'password' | 'closed';

export type GameMode = 'warfare' | 'arsenal' | 'disaster' | 'laboratory';

export interface RoomPublicSummary {
  id: string;
  name: string;
  hostId: string;
  hostName: string;
  accessMode: 'open' | 'password';
  hasPassword: boolean;
  humanPlayers: number;
  totalActors: number;
  targetPlayers: number;
  fillWithBots: boolean;
  phase: 'lobby' | 'playing' | 'ended';
  createdAt: number;
}

export interface LobbyMemberInfo {
  id: string;
  name: string;
  color: string;
  isHost: boolean;
  joinedAt: number;
  team?: TeamId; // time do jogador no modo Arsenal com times
}

export interface DevRoomState {
  enabled: boolean;
  godMode: boolean;
  infiniteSandbox: boolean;
  botsFrozen: boolean;
  /** Eventos automáticos (sorteio e catástrofes de estagnação) pausados. */
  autoEventsPaused: boolean;
  /** Versão do catálogo em uso; muda sozinha após um hot reload. */
  catalogVersion: string;
}

export interface DevCatalogWeaponEntry {
  id: string;
  name: string;
  aliases: string[];
  tags: string[];
  status: 'approved' | 'deprecated';
  budgetUsed: number;
  damage: number;
  projectiles: number;
}

export interface DevCatalogEventEntry {
  id: string;
  name: string;
  aliases: string[];
  tags: string[];
  status: 'approved' | 'deprecated';
  budgetUsed: number;
  archetype: string;
}

export interface DevCatalogPayload {
  catalogVersion: string;
  weapons: DevCatalogWeaponEntry[];
  events: DevCatalogEventEntry[];
}

export type DevActionPayload =
  | { action: 'toggle_god_mode' }
  | { action: 'toggle_infinite_sandbox' }
  | { action: 'toggle_freeze_bots' }
  | { action: 'unlock_forge' }
  | { action: 'refill_player' }
  | { action: 'quick_forge'; prompt: string }
  | { action: 'win_event_raffle' }
  | { action: 'trigger_event'; prompt: string }
  | { action: 'clear_events' }
  | { action: 'teleport_center' }
  | { action: 'spawn_bot' }
  | { action: 'spawn_dummy' }
  | { action: 'equip_bot_weapon'; itemId: string }
  | { action: 'spawn_catalog_weapon'; itemId: string }
  | { action: 'spawn_catalog_event'; itemId: string }
  | { action: 'toggle_auto_events' }
  | { action: 'skip_event_cooldown' }
  | { action: 'damage_player'; amount: number }
  | { action: 'kill_bots' }
  | { action: 'force_restart' };

export interface LobbyStatePayload {
  roomId: string;
  roomName: string;
  playerId: string;
  hostId: string;
  hostName: string;
  accessMode: RoomAccessMode;
  hasPassword: boolean;
  targetPlayers: number;
  fillWithBots: boolean;
  phase: 'lobby' | 'playing' | 'ended';
  members: LobbyMemberInfo[];
  devMode?: boolean;
  gameMode?: GameMode;
  arsenalTeams?: boolean;
}

export interface ContentPoolNetInfo {
  hash: string;
  algorithmVersion: number;
  catalogVersion: string;
  weaponCount: number;
  eventCount: number;
  /** Enviado apenas em `room:init`; evita repetir o arsenal de assets no tick. */
  assetIds?: string[];
}

export interface RoomInitPayload {
  roomId: string;
  roomName: string;
  playerId: string;
  hostId: string;
  hostName: string;
  accessMode: RoomAccessMode;
  gameMode: GameMode;
  seed: number;
  dimX: number;
  dimY: number;
  dimZ: number;
  deltas: VoxelDelta[];
  players: PlayerNetState[];
  activeEvents: MapEventState[];
  lootDrops: LootDropState[];
  entities: SpawnedEntityNetState[];
  serverNow: number;
  event: EventCycleState;
  catalogVersion: string;
  assetVersion: string;
  contentPool?: ContentPoolNetInfo | null;
  eventCooldownSec: number;
  rafflePlayerId: string | null;
  rafflePlayerName: string | null;
  raffleRemainingSec: number;
  phase: 'lobby' | 'playing' | 'ended';
  devMode?: boolean;
  devState?: DevRoomState;
  /** Configuração do modo Arsenal: duração máxima da partida em segundos (ex.: 300). */
  arsenalMatchDuration?: number;
  /** Configuração do modo Arsenal: número máximo de kills para vitória (ex.: 20). */
  arsenalMaxKills?: number;
  /** Configuração do modo Arsenal: se eventos globais automáticos estão ativados. */
  arsenalAutoEvents?: boolean;
  /** Configuração do modo Arsenal: se modo de times está ativado (Azul vs Laranja). */
  arsenalTeams?: boolean;
}

export interface RoomTickPayload {
  hostId: string;
  hostName: string;
  accessMode: RoomAccessMode;
  gameMode: GameMode;
  players: PlayerNetState[];
  projectiles: ProjectileNetState[];
  lootDrops: LootDropState[];
  entities: SpawnedEntityNetState[];
  activeEvents: MapEventState[];
  serverNow: number;
  event: EventCycleState;
  catalogVersion: string;
  assetVersion: string;
  contentPool?: ContentPoolNetInfo | null;
  eventCooldownSec: number;
  rafflePlayerId: string | null;
  rafflePlayerName: string | null;
  raffleRemainingSec: number;
  stagnationLevel: number;
  waterLevelWorld?: number;
  phase: 'lobby' | 'playing' | 'ended';
  summary?: RoomMatchSummary;
  devState?: DevRoomState;
  /** Tempo decorrido da partida em segundos (apenas relevante em modos com tempo limite). */
  elapsedSec?: number;
  /** Duração máxima da partida em segundos (ex.: 300 para Arsenal). */
  matchDurationSec?: number;
  /** Número máximo de kills para vitória (ex.: 20 para Arsenal). */
  maxKills?: number;
  /** Configuração do modo Arsenal: se eventos globais automáticos estão ativados. */
  arsenalAutoEvents?: boolean;
  /** Configuração do modo Arsenal: se modo de times está ativado (Azul vs Laranja). */
  arsenalTeams?: boolean;
}

/**
 * Conteúdo estático de armas enviado uma única vez por instância. O cliente
 * mantém um cache por `id` e hidrata os slots do tick.
 */
export interface ContentItemsPayload {
  catalogVersion: string;
  weapons: WeaponBlueprint[];
}

export interface RoomInitWirePayload extends Omit<RoomInitPayload, 'players' | 'lootDrops' | 'activeEvents'> {
  players: PlayerNetWireState[];
  activeEvents: NetMapEventState[];
  lootDrops: LootDropWireState[];
  /** Blueprints de todas as armas já presentes na sala. */
  contentItems: WeaponBlueprint[];
}

export interface RoomTickWirePayload extends Omit<RoomTickPayload, 'players' | 'lootDrops' | 'activeEvents'> {
  players: PlayerNetWireState[];
  activeEvents: NetMapEventState[];
  lootDrops: LootDropWireState[];
}

export interface ClientInputPacket {
  moveX: number; // -1..1
  moveZ: number; // -1..1
  jump: boolean;
  sprint?: boolean;
  crouch?: boolean;
  yaw: number;
  pitch: number;
  activeSlot: number;
}
