import { useCallback, useEffect, useRef, useState } from 'react';
import { DevPanel } from './components/DevPanel.tsx';
import { GameHud } from './components/GameHud.tsx';
import { LobbyOverlay } from './components/LobbyOverlay.tsx';
import { PromptBar } from './components/PromptBar.tsx';
import { SettingsModal } from './components/SettingsModal.tsx';
import { StatusModal } from './components/StatusModal.tsx';
import { WaitingRoomOverlay } from './components/WaitingRoomOverlay.tsx';
import { BabylonVoxelArena, type PerfStats } from './engine/babylonArena.ts';
import { audioEngine } from './engine/audio/audioEngine.ts';
import {
  loadQualityLevel,
  saveQualityLevel,
  type QualityLevel,
} from './engine/quality.ts';
import {
  loadSettings,
  saveSettings,
  type GameSettings,
} from './engine/settings.ts';
import { soundSynth } from './engine/soundSynth.ts';
import type { AssetManifest } from './shared/assets.ts';
import { mergeAssetManifests } from './shared/assets.ts';
import {
  hydrateRoomInit,
  hydrateRoomTick,
  mergeWeaponContent,
} from './shared/contentHydration.ts';
import { isClientDevEnabled } from './shared/devMode.ts';
import { buildHttpUrl, buildWsUrl } from './shared/endpoints.ts';
import {
  VOXEL_SIZE,
  type ContentItemsPayload,
  type DevActionPayload,
  type DevCatalogPayload,
  type DevRoomState,
  type EventCycleState,
  type EventPulse,
  type KillfeedEntry,
  type LobbyStatePayload,
  type LootDropState,
  type MapEventState,
  type PlayerNetState,
  type PromptKind,
  type RoomAccessMode,
  type RoomInitWirePayload,
  type RoomMatchSummary,
  type RoomPublicSummary,
  type RoomTickWirePayload,
  type SpawnedEntityNetState,
  type Vec3,
  type VoxelDelta,
  type WeaponBlueprint,
} from './shared/types.ts';

type GamePhaseState = 'title' | 'waiting' | 'playing' | 'paused' | 'gameover';

// Vite inlines these at build time. Empty values keep the API/WS same-origin.
const API_URL = import.meta.env.VITE_API_URL as string | undefined;
const WS_URL = import.meta.env.VITE_WS_URL as string | undefined;
const ASSET_FETCH_BATCH = 128;

function collectSceneAssetIds(
  players: PlayerNetState[],
  lootDrops: LootDropState[],
  events: MapEventState[],
): string[] {
  const ids = new Set<string>();
  for (const player of players) {
    for (const slot of player.slots) {
      for (const id of slot?.weapon?.assets ?? []) ids.add(id);
    }
  }
  for (const drop of lootDrops) {
    for (const id of drop.item.weapon?.assets ?? []) ids.add(id);
  }
  for (const event of events) {
    for (const id of event.assets ?? []) ids.add(id);
  }
  return Array.from(ids);
}

function chunkIds(ids: string[], size: number): string[][] {
  const chunks: string[][] = [];
  for (let index = 0; index < ids.length; index += size) {
    chunks.push(ids.slice(index, index + size));
  }
  return chunks;
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const arenaRef = useRef<BabylonVoxelArena | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const lastInputSentAtRef = useRef<number>(0);

  const [gameState, setGameState] = useState<GamePhaseState>('title');
  const gameStateRef = useRef<GamePhaseState>('title');

  const [playerName, setPlayerName] = useState('Viajante');
  const [initialRoomCode] = useState(() => {
    const param = new URLSearchParams(window.location.search).get('room');
    if (!param) return '';
    return param.toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 12);
  });
  const [roomId, setRoomId] = useState('ARENA1');
  const [hostId, setHostId] = useState<string | null>(null);
  const [hostName, setHostName] = useState('Master');
  const [roomAccessMode, setRoomAccessMode] = useState<RoomAccessMode>('open');
  const [lobbyState, setLobbyState] = useState<LobbyStatePayload | null>(null);

  const [rooms, setRooms] = useState<RoomPublicSummary[]>([]);
  const [loadingRooms, setLoadingRooms] = useState(false);

  const [connecting, setConnecting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [errorRoomId, setErrorRoomId] = useState<string | null>(null);
  const [contextLost, setContextLost] = useState(false);

  const [localPlayerId, setLocalPlayerId] = useState<string | null>(null);
  const localPlayerIdRef = useRef<string | null>(null);

  const [players, setPlayers] = useState<PlayerNetState[]>([]);
  const assetManifestRef = useRef<AssetManifest | null>(null);
  const loadedAssetIdsRef = useRef<Set<string>>(new Set());
  const pendingAssetIdsRef = useRef<Set<string>>(new Set());
  const failedAssetIdsRef = useRef<Map<string, number>>(new Map());
  const assetStatsRef = useRef({ requests: 0, fetched: 0, failed: 0, bytes: 0 });
  const [activeEvents, setActiveEvents] = useState<MapEventState[]>([]);
  const [serverNow, setServerNow] = useState(() => Date.now());
  const [eventCycle, setEventCycle] = useState<EventCycleState>({
    phase: 'cooldown',
    endsAt: null,
    rafflePlayerId: null,
    rafflePlayerName: null,
  });
  const [eventCooldownSec, setEventCooldownSec] = useState(24);
  const [killfeed, setKillfeed] = useState<KillfeedEntry[]>([]);
  const [summary, setSummary] = useState<RoomMatchSummary | null>(null);

  const [promptMode, setPromptMode] = useState<'weapon' | 'event' | null>(null);
  const promptModeRef = useRef<'weapon' | 'event' | null>(null);
  const promptAckedRef = useRef(false);
  const promptRequestAtRef = useRef(0);
  const [zoomMeters, setZoomMeters] = useState(0);
  const [muted, setMuted] = useState(false);
  const [qualityLevel, setQualityLevel] = useState<QualityLevel>(() =>
    loadQualityLevel(),
  );
  const [settings, setSettings] = useState<GameSettings>(() => loadSettings());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [pointerLocked, setPointerLocked] = useState(false);
  const [pingMs, setPingMs] = useState<number | null>(null);
  const [damageDirection, setDamageDirection] = useState<{
    angle: number;
    at: number;
  } | null>(null);
  const [damageNumbers, setDamageNumbers] = useState<
    Array<{ id: number; x: number; y: number; amount: number }>
  >([]);
  const [perfStats, setPerfStats] = useState<PerfStats | null>(null);
  const qualityLevelRef = useRef<QualityLevel>(qualityLevel);
  const settingsRef = useRef<GameSettings>(settings);
  const damageNumberSeqRef = useRef(0);
  const pingSentAtRef = useRef(0);
  const [damageFlash, setDamageFlash] = useState(false);
  const [hitmarkerActive, setHitmarkerActive] = useState(false);
  const [hitmarkerHeavy, setHitmarkerHeavy] = useState(false);
  const [aimContext, setAimContext] = useState<'neutral' | 'dig' | 'grapple' | 'enemy'>('neutral');
  const [nearbyLootName, setNearbyLootName] = useState<string | null>(null);
  const [nearbyZipline, setNearbyZipline] = useState<string | null>(null);

  const [islandSizeMeters, setIslandSizeMeters] = useState(88);
  const [lootDrops, setLootDrops] = useState<LootDropState[]>([]);
  const [entities, setEntities] = useState<SpawnedEntityNetState[]>([]);
  const [serverDevMode, setServerDevMode] = useState(false);
  const [devState, setDevState] = useState<DevRoomState>({
    enabled: false,
    godMode: false,
    infiniteSandbox: false,
    botsFrozen: false,
    autoEventsPaused: false,
    catalogVersion: '',
  });
  const [devCatalog, setDevCatalog] = useState<DevCatalogPayload | null>(null);
  const [devPanelOpen, setDevPanelOpen] = useState(false);
  const devEnabled = isClientDevEnabled(import.meta.env.DEV, serverDevMode);
  const devEnabledRef = useRef(false);
  devEnabledRef.current = devEnabled;

  const playersRef = useRef<PlayerNetState[]>([]);
  const weaponCacheRef = useRef<Map<string, WeaponBlueprint>>(new Map());
  const rafflePlayerIdRef = useRef<string | null>(null);
  const lastHudSyncRef = useRef<number>(0);
  const prevHpRef = useRef<number | null>(null);
  const prevAliveRef = useRef<Map<string, boolean>>(new Map());
  const prevCanForgeRef = useRef<boolean>(false);
  const damageFlashTimerRef = useRef<number | null>(null);
  const hitmarkerTimerRef = useRef<number | null>(null);

  useEffect(() => {
    gameStateRef.current = gameState;
    document.body.dataset.state = gameState;
    arenaRef.current?.setMode(gameState === 'waiting' ? 'title' : gameState);
  }, [gameState]);

  const fetchRooms = useCallback(async () => {
    setLoadingRooms(true);
    try {
      const res = await fetch(buildHttpUrl('/api/rooms', API_URL));
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.rooms)) {
          setRooms(data.rooms as RoomPublicSummary[]);
        }
      }
    } catch {
      // Ignore transient polling failure
    } finally {
      setLoadingRooms(false);
    }
  }, []);

  useEffect(() => {
    if (gameState !== 'title') return;
    void fetchRooms();
    const timer = window.setInterval(() => {
      void fetchRooms();
    }, 2500);
    return () => window.clearInterval(timer);
  }, [fetchRooms, gameState]);

  const applyAssetManifest = useCallback((incoming: AssetManifest | null) => {
    if (
      incoming &&
      assetManifestRef.current &&
      incoming.version !== assetManifestRef.current.version
    ) {
      loadedAssetIdsRef.current.clear();
      failedAssetIdsRef.current.clear();
      assetManifestRef.current = null;
    }
    const merged = mergeAssetManifests(assetManifestRef.current, incoming);
    if (!merged) return;
    assetManifestRef.current = merged;
    for (const asset of merged.assets) loadedAssetIdsRef.current.add(asset.id);
    arenaRef.current?.setAssetManifest(merged);
  }, []);

  const ensureAssets = useCallback(
    (ids: string[]) => {
      const missing: string[] = [];
      const seen = new Set<string>();
      const now = Date.now();
      for (const id of ids) {
        if (
          !id ||
          seen.has(id) ||
          loadedAssetIdsRef.current.has(id) ||
          pendingAssetIdsRef.current.has(id)
        ) {
          continue;
        }
        const failedAt = failedAssetIdsRef.current.get(id);
        if (failedAt && now - failedAt < 30_000) continue;
        seen.add(id);
        missing.push(id);
      }
      if (missing.length === 0) return;

      for (const batch of chunkIds(missing, ASSET_FETCH_BATCH)) {
        for (const id of batch) pendingAssetIdsRef.current.add(id);
        assetStatsRef.current.requests += 1;
        const url = buildHttpUrl(
          `/api/assets?ids=${encodeURIComponent(batch.join(','))}`,
          API_URL,
        );
        void fetch(url)
          .then(async (res) => {
            if (!res.ok) return null;
            const size = Number(res.headers.get('content-length') ?? 0);
            const data = (await res.json()) as AssetManifest;
            return { data, size: Number.isFinite(size) ? size : 0 };
          })
          .then((result) => {
            if (!result?.data?.assets) {
              assetStatsRef.current.failed += batch.length;
              for (const id of batch) failedAssetIdsRef.current.set(id, Date.now());
              return;
            }
            const data = result.data;
            assetStatsRef.current.fetched += data.assets.length;
            assetStatsRef.current.bytes += result.size;
            applyAssetManifest(data);
            const returned = new Set(data.assets.map((asset) => asset.id));
            for (const id of batch) {
              if (returned.has(id)) failedAssetIdsRef.current.delete(id);
              else {
                assetStatsRef.current.failed += 1;
                failedAssetIdsRef.current.set(id, Date.now());
              }
            }
            arenaRef.current?.prefetchAssets(data.assets.map((asset) => asset.id));
          })
          .catch(() => {
            // Assets são opcionais; o jogo segue com fallback visual/sintetizado.
            assetStatsRef.current.failed += batch.length;
            for (const id of batch) failedAssetIdsRef.current.set(id, Date.now());
          })
          .finally(() => {
            for (const id of batch) pendingAssetIdsRef.current.delete(id);
          });
      }
    },
    [applyAssetManifest],
  );

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      let data: AssetManifest | null = null;
      try {
        const coreRes = await fetch(buildHttpUrl('/api/assets/core', API_URL));
        if (coreRes.ok) {
          const parsed = (await coreRes.json()) as AssetManifest | null;
          if (parsed?.assets) data = parsed;
        }
      } catch {
        // servidor antigo sem /core: cai no manifesto completo abaixo
      }
      if (!data) {
        try {
          const fullRes = await fetch(buildHttpUrl('/api/assets', API_URL));
          if (fullRes.ok) {
            const parsed = (await fullRes.json()) as AssetManifest | null;
            if (parsed?.assets) data = parsed;
          }
        } catch {
          // Manifesto é opcional no cliente; o jogo segue com fallback visual.
        }
      }
      if (!cancelled && data?.assets) applyAssetManifest(data);
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [applyAssetManifest]);

  useEffect(() => {
    promptModeRef.current = promptMode;
    if (promptMode === null) promptAckedRef.current = false;
    arenaRef.current?.setPromptOpen(promptMode !== null);
  }, [promptMode]);

  const sendWs = useCallback((msg: unknown) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  // Ao abrir o painel dev, pede a lista compacta do catálogo ao servidor.
  // É sob demanda: nada disso trafega no tick de 20 Hz.
  useEffect(() => {
    if (!devPanelOpen || !devEnabled) return;
    sendWs({ type: 'dev:catalog' });
  }, [devPanelOpen, devEnabled, sendWs]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      const stats = assetStatsRef.current;
      ws.send(
        JSON.stringify({
          type: 'client:perf',
          payload: {
            assets: {
              loaded: loadedAssetIdsRef.current.size,
              requests: stats.requests,
              fetched: stats.fetched,
              failed: stats.failed,
              bytes: stats.bytes,
            },
          },
        }),
      );
    }, 15_000);
    return () => window.clearInterval(timer);
  }, []);

  const openWeaponPrompt = useCallback(() => {
    if (gameStateRef.current !== 'playing') return;
    const local = playersRef.current.find((p) => p.id === localPlayerIdRef.current);
    if (!local || !local.alive || local.prompt) return;
    if (rafflePlayerIdRef.current === local.id) return;
    if (!local.canForgeWeapon && local.forge?.phase !== 'ready') return;
    promptAckedRef.current = false;
    promptRequestAtRef.current = Date.now();
    sendWs({ type: 'prompt:open', payload: { kind: 'weapon' } });
    setPromptMode('weapon');
  }, [sendWs]);

  const openEventPrompt = useCallback(() => {
    if (gameStateRef.current !== 'playing') return;
    const local = playersRef.current.find((p) => p.id === localPlayerIdRef.current);
    if (!local || !local.alive || local.prompt) return;
    if (rafflePlayerIdRef.current !== local.id) return;
    promptAckedRef.current = false;
    promptRequestAtRef.current = Date.now();
    sendWs({ type: 'prompt:open', payload: { kind: 'event' } });
    setPromptMode('event');
  }, [sendWs]);

  const openPromptByPriority = useCallback(() => {
    const local = playersRef.current.find((p) => p.id === localPlayerIdRef.current);
    if (!local || !local.alive) return;
    if (rafflePlayerIdRef.current === local.id) {
      openEventPrompt();
      return;
    }
    openWeaponPrompt();
  }, [openEventPrompt, openWeaponPrompt]);

  // Mount Babylon.js engine once
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const arena = new BabylonVoxelArena(canvas, {
      onSendInput: (input, force) => {
        const now = performance.now();
        if (!force && now - lastInputSentAtRef.current < 45) return;
        lastInputSentAtRef.current = now;
        sendWs({
          type: 'player:input',
          payload: input,
        });
      },
      onPrimaryAction: (origin: Vec3, dir: Vec3) => {
        sendWs({ type: 'player:action', payload: { origin, dir } });
      },
      onDropItem: () => sendWs({ type: 'player:drop' }),
      onPickupItem: () => sendWs({ type: 'player:pickup' }),
      onUseZipline: (routeId) =>
        sendWs({ type: 'player:zipline', payload: { routeId } }),
      onZiplineNearby: (name) => setNearbyZipline(name),
      onOpenPrompt: () => openPromptByPriority(),
      onOpenWeaponPrompt: () => openWeaponPrompt(),
      onOpenEventPrompt: () => openEventPrompt(),
      onZoomChange: (z) => setZoomMeters(z),
      onAimContextChange: (ctx) => setAimContext(ctx),
      onContextLost: (lost) => setContextLost(lost),
      onPointerLockChange: (locked) => setPointerLocked(locked),
    });

    arenaRef.current = arena;
    arena.setQuality(qualityLevelRef.current);
    arena.setLookSensitivity(settingsRef.current.sensitivity);
    arena.setInvertY(settingsRef.current.invertY);
    arena.setReducedMotion(settingsRef.current.reducedMotion);
    if (assetManifestRef.current) arena.setAssetManifest(assetManifestRef.current);
    return () => {
      if (damageFlashTimerRef.current) window.clearTimeout(damageFlashTimerRef.current);
      if (hitmarkerTimerRef.current) window.clearTimeout(hitmarkerTimerRef.current);
      arena.dispose();
      arenaRef.current = null;
    };
  }, [openEventPrompt, openPromptByPriority, openWeaponPrompt, sendWs]);

  const openSocketAndSend = useCallback((initialMessage: unknown) => {
    if (connecting) return;
    setConnecting(true);
    setErrorMessage(null);
    setErrorCode(null);
    setErrorRoomId(null);
    setSummary(null);
    setKillfeed([]);
    setPromptMode(null);

    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    const ws = new WebSocket(
      buildWsUrl({
        apiBase: API_URL,
        wsUrl: WS_URL,
        pageProtocol: window.location.protocol,
        pageHost: window.location.host,
      }),
    );
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify(initialMessage));
    };

    ws.onerror = () => {
      setConnecting(false);
      setErrorMessage('Falha ao conectar ao servidor da partida.');
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);

        if (msg.type === 'room:error') {
          setConnecting(false);
          const code = String(msg.payload?.code ?? '');
          const message = String(msg.payload?.message ?? 'Erro na sala.');
          setErrorCode(code);
          setErrorRoomId(msg.payload?.roomId ?? null);
          setErrorMessage(message);
          if (code === 'KICKED') {
            wsRef.current?.close();
            wsRef.current = null;
            setLobbyState(null);
            setGameState('title');
            void fetchRooms();
          }
          return;
        }

        if (msg.type === 'room:lobby_state') {
          const st = msg.payload as LobbyStatePayload;
          setConnecting(false);
          setErrorMessage(null);
          setErrorCode(null);
          setErrorRoomId(null);
          setLobbyState(st);
          setRoomId(st.roomId);
          setHostId(st.hostId);
          setHostName(st.hostName);
          setRoomAccessMode(st.accessMode);
          setServerDevMode(Boolean(st.devMode));
          setLocalPlayerId(st.playerId);
          localPlayerIdRef.current = st.playerId;
          setGameState('waiting');
          return;
        }

        if (msg.type === 'room:settings_updated') {
          if (msg.payload?.accessMode) setRoomAccessMode(msg.payload.accessMode);
          if (msg.payload?.hostId) setHostId(msg.payload.hostId);
          if (msg.payload?.hostName) setHostName(msg.payload.hostName);
          return;
        }

        if (msg.type === 'room:init') {
          const init = msg.payload as RoomInitWirePayload;
          weaponCacheRef.current.clear();
          const view = hydrateRoomInit(init, weaponCacheRef.current);
          ensureAssets(init.contentPool?.assetIds ?? []);
          ensureAssets(
            collectSceneAssetIds(view.players, view.lootDrops, view.activeEvents),
          );
          setConnecting(false);
          setErrorMessage(null);
          setLobbyState(null);
          setRoomId(init.roomId);
          setHostId(init.hostId);
          setHostName(init.hostName);
          setRoomAccessMode(init.accessMode);
          setServerDevMode(Boolean(init.devMode));
          if (init.devState) setDevState(init.devState);
          setLocalPlayerId(init.playerId);
          localPlayerIdRef.current = init.playerId;
          playersRef.current = view.players;
          rafflePlayerIdRef.current = init.rafflePlayerId;
          setPlayers(view.players);
          setActiveEvents(view.activeEvents);
          setServerNow(init.serverNow);
          setEventCycle(init.event);
          setEventCooldownSec(init.eventCooldownSec);
          setZoomMeters(0);
          setIslandSizeMeters(init.dimX * VOXEL_SIZE);
          setLootDrops(view.lootDrops);
          setEntities(init.entities);
          prevHpRef.current = null;
          prevCanForgeRef.current = false;
          prevAliveRef.current = new Map(
            view.players.map((p) => [p.id, p.alive] as const),
          );
          setDamageFlash(false);
          setHitmarkerActive(false);
          setHitmarkerHeavy(false);
          setNearbyLootName(null);
          arenaRef.current?.loadRoomInit(view);
          setGameState('playing');
          if (document.activeElement instanceof HTMLElement) {
            document.activeElement.blur();
          }
          canvasRef.current?.focus();
          return;
        }

        if (msg.type === 'voxel:deltas') {
          arenaRef.current?.applyVoxelDeltas(msg.payload as VoxelDelta[]);
          return;
        }

        if (msg.type === 'fx:shrapnel') {
          arenaRef.current?.spawnShrapnelBurst(
            msg.payload.center,
            msg.payload.voxels,
          );
          return;
        }

        if (msg.type === 'event:pulse') {
          arenaRef.current?.handleEventPulse(msg.payload as EventPulse);
          return;
        }

        if (msg.type === 'fx:hit') {
          const payload = msg.payload as {
            damage?: number;
            heavy?: boolean;
            position?: Vec3;
          };
          const heavy = Boolean(payload?.heavy);
          arenaRef.current?.triggerHitstop(heavy ? 0.052 : 0.032);
          if (payload?.position) {
            arenaRef.current?.spawnHitSpark(payload.position, heavy);
          }
          soundSynth.playHitConfirm(heavy);
          setHitmarkerHeavy(heavy);
          setHitmarkerActive(true);
          if (hitmarkerTimerRef.current) window.clearTimeout(hitmarkerTimerRef.current);
          hitmarkerTimerRef.current = window.setTimeout(() => {
            setHitmarkerActive(false);
          }, 160);
          const damage = Number(payload?.damage);
          if (payload?.position && Number.isFinite(damage)) {
            const screen = arenaRef.current?.projectToScreen(payload.position);
            if (screen?.visible) {
              const id = ++damageNumberSeqRef.current;
              setDamageNumbers((prev) => [
                ...prev.slice(-7),
                {
                  id,
                  x: screen.x,
                  y: screen.y,
                  amount: Math.round(damage),
                },
              ]);
              window.setTimeout(() => {
                setDamageNumbers((prev) => prev.filter((n) => n.id !== id));
              }, 900);
            }
          }
          return;
        }

        if (msg.type === 'fx:damage') {
          const from = msg.payload?.from as Vec3 | undefined;
          const local = playersRef.current.find(
            (p) => p.id === localPlayerIdRef.current,
          );
          if (from && local) {
            const dx = from.x - local.position.x;
            const dz = from.z - local.position.z;
            let angle = Math.atan2(dx, dz) - local.yaw;
            angle = Math.atan2(Math.sin(angle), Math.cos(angle));
            const at = Date.now();
            setDamageDirection({ angle, at });
            window.setTimeout(() => {
              setDamageDirection((cur) =>
                cur && cur.at === at ? null : cur,
              );
            }, 1300);
          }
          return;
        }

        if (msg.type === 'pong') {
          const sentAt = Number(msg.payload?.t);
          if (Number.isFinite(sentAt)) {
            setPingMs(Math.max(0, Math.round(performance.now() - sentAt)));
          }
          return;
        }

        if (msg.type === 'fx:pickup') {
          soundSynth.playPickup();
          return;
        }

        if (msg.type === 'room:killfeed') {
          const entry = msg.payload as KillfeedEntry;
          if (entry.tone === 'event') soundSynth.playAlert();
          setKillfeed((prev) => [...prev.slice(-8), entry]);
          return;
        }

        if (msg.type === 'content:items') {
          const payload = msg.payload as ContentItemsPayload;
          mergeWeaponContent(weaponCacheRef.current, payload?.weapons);
          if (payload?.weapons) {
            ensureAssets(payload.weapons.flatMap((weapon) => weapon.assets ?? []));
          }
          return;
        }

        if (msg.type === 'dev:catalog') {
          setDevCatalog(msg.payload as DevCatalogPayload);
          return;
        }

        if (msg.type === 'ai:weapon_ready') {
          soundSynth.playForgeComplete();
          if (msg.payload?.weapon) {
            const weapon = msg.payload.weapon as WeaponBlueprint;
            mergeWeaponContent(weaponCacheRef.current, [weapon]);
            ensureAssets(weapon.assets ?? []);
          }
          if (typeof msg.payload?.slotIndex === 'number') {
            arenaRef.current?.selectSlot(msg.payload.slotIndex);
          }
          return;
        }

        if (msg.type === 'player:select_slot') {
          if (typeof msg.payload?.slotIndex === 'number') {
            arenaRef.current?.selectSlot(msg.payload.slotIndex);
          }
          return;
        }

        if (msg.type === 'ai:event_raffle_won') {
          soundSynth.playAlert();
          return;
        }

        if (msg.type === 'ai:error') {
          console.warn('[Prompt]', msg.payload?.message ?? 'Erro na forja.');
          const kind = promptModeRef.current;
          if (kind) {
            sendWs({ type: 'prompt:cancel', payload: { kind } });
          }
          setPromptMode(null);
          canvasRef.current?.focus();
          return;
        }

        if (msg.type === 'room:tick') {
          const tick = hydrateRoomTick(
            msg.payload as RoomTickWirePayload,
            weaponCacheRef.current,
          );
          ensureAssets(
            collectSceneAssetIds(tick.players, tick.lootDrops, tick.activeEvents),
          );
          arenaRef.current?.applyRoomTick(tick);

          // Reação de morte: o tick é a única fonte; sem protocolo novo.
          const wasAlive = prevAliveRef.current;
          const nowAlive = new Map<string, boolean>();
          for (const p of tick.players) {
            nowAlive.set(p.id, p.alive);
            if (wasAlive.get(p.id) === true && !p.alive) {
              arenaRef.current?.spawnKillBurst(
                { x: p.position.x, y: p.position.y + 0.9, z: p.position.z },
                p.color,
              );
            }
          }
          prevAliveRef.current = nowAlive;

          playersRef.current = tick.players;
          rafflePlayerIdRef.current = tick.rafflePlayerId;
          setHostId(tick.hostId);
          setHostName(tick.hostName);
          setRoomAccessMode(tick.accessMode);

          const local = tick.players.find((p) => p.id === localPlayerIdRef.current);
          if (local) {
            if (prevHpRef.current !== null && local.hp < prevHpRef.current - 0.5) {
              soundSynth.playDamageTaken();
              setDamageFlash(true);
              if (damageFlashTimerRef.current) window.clearTimeout(damageFlashTimerRef.current);
              damageFlashTimerRef.current = window.setTimeout(() => {
                setDamageFlash(false);
              }, 260);
            }
            if (!prevCanForgeRef.current && local.canForgeWeapon) {
              soundSynth.playPickup();
            }
            prevCanForgeRef.current = local.canForgeWeapon;
            prevHpRef.current = local.hp;

            if (promptModeRef.current) {
              if (local.prompt && local.prompt.kind === promptModeRef.current) {
                promptAckedRef.current = true;
              } else {
                const rejected =
                  !local.prompt &&
                  (promptAckedRef.current ||
                    Date.now() - promptRequestAtRef.current > 600);
                const kindChanged =
                  local.prompt !== null && local.prompt.kind !== promptModeRef.current;
                if (rejected || kindChanged) {
                  setPromptMode(null);
                }
              }
            }
          } else {
            prevCanForgeRef.current = false;
            prevHpRef.current = null;
          }

          if (tick.phase === 'ended' || (local && !local.alive && gameStateRef.current === 'playing')) {
            setSummary(tick.summary ?? null);
            setPlayers(tick.players);
            setActiveEvents(tick.activeEvents);
            setPromptMode(null);
            setNearbyLootName(null);
            setGameState('gameover');
            return;
          }

          // Throttle HUD React updates to <= 12 Hz
          const now = performance.now();
          if (now - lastHudSyncRef.current >= 85) {
            lastHudSyncRef.current = now;
            if (tick.devState) setDevState(tick.devState);
            setPlayers(tick.players);
            setLootDrops(tick.lootDrops);
            setEntities(tick.entities);
            setActiveEvents(tick.activeEvents);
            setServerNow(tick.serverNow);
            setEventCycle(tick.event);
            setEventCooldownSec(tick.eventCooldownSec);

            if (local && local.alive) {
              let closestName: string | null = null;
              let closestDist = 2.6;
              for (const drop of tick.lootDrops) {
                const d = Math.hypot(
                  drop.position.x - local.position.x,
                  drop.position.y - local.position.y,
                  drop.position.z - local.position.z,
                );
                if (d < closestDist) {
                  closestDist = d;
                  closestName = drop.item.name;
                }
              }
              for (const ent of tick.entities) {
                if (ent.kind !== 'supply_crate') continue;
                const d = Math.hypot(
                  ent.position.x - local.position.x,
                  ent.position.y - local.position.y,
                  ent.position.z - local.position.z,
                );
                if (d < closestDist) {
                  closestDist = d;
                  closestName = 'Caixa de Suprimentos (+HP / Munição)';
                }
              }
              setNearbyLootName(closestName);
            } else {
              setNearbyLootName(null);
            }
          }
        }
      } catch (err) {
        console.error('[WS Parse Error]', err);
      }
    };
  }, [connecting, fetchRooms]);

  const handleCreateRoom = useCallback(
    (opts: {
      roomName: string;
      roomId: string;
      accessMode: RoomAccessMode;
      password: string;
      targetPlayers: number;
      fillWithBots: boolean;
    }) => {
      openSocketAndSend({
        type: 'room:create',
        payload: {
          ...opts,
          playerName: playerName || 'Viajante',
          startImmediately: false,
        },
      });
    },
    [openSocketAndSend, playerName],
  );

  const handleJoinRoom = useCallback(
    (opts: { roomId: string; password?: string }) => {
      openSocketAndSend({
        type: 'room:join',
        payload: {
          roomId: opts.roomId,
          password: opts.password,
          playerName: playerName || 'Viajante',
        },
      });
    },
    [openSocketAndSend, playerName],
  );

  const handleQuickPlay = useCallback(() => {
    openSocketAndSend({
      type: 'room:quick_play',
      payload: {
        roomId: initialRoomCode || undefined,
        playerName: playerName || 'Viajante',
        targetPlayers: 6,
        fillWithBots: true,
      },
    });
  }, [initialRoomCode, openSocketAndSend, playerName]);

  // Support ?autostart=1
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('autostart') === '1') {
      handleQuickPlay();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleFullscreen = useCallback(async () => {
    const doc = document as Document & {
      webkitFullscreenElement?: Element | null;
      webkitExitFullscreen?: () => Promise<void>;
    };
    const el = document.documentElement as HTMLElement & {
      webkitRequestFullscreen?: () => Promise<void>;
    };
    try {
      const active = doc.fullscreenElement ?? doc.webkitFullscreenElement;
      if (active) {
        if (doc.exitFullscreen) await doc.exitFullscreen();
        else if (doc.webkitExitFullscreen) await doc.webkitExitFullscreen();
      } else if (el.requestFullscreen) {
        await el.requestFullscreen();
      } else if (el.webkitRequestFullscreen) {
        await el.webkitRequestFullscreen();
      }
    } catch {
      // Navegador/iframe pode bloquear fullscreen sem gesto.
    }
  }, []);

  // Global keyboard shortcuts (Pause P/Escape, Mute M)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const activeTag = document.activeElement?.tagName;
      const inInput =
        activeTag === 'INPUT' ||
        activeTag === 'TEXTAREA' ||
        activeTag === 'SELECT';
      if (inInput) return;

      if (e.code === 'KeyF' && !e.repeat) {
        e.preventDefault();
        void toggleFullscreen();
        return;
      }

      if (settingsOpen) {
        if (e.key === 'Escape') {
          e.preventDefault();
          setSettingsOpen(false);
        }
        return;
      }

      if (e.code === 'KeyM') {
        soundSynth.muted = !soundSynth.muted;
        setMuted(soundSynth.muted);
      } else if (e.code === 'F8' && devEnabledRef.current && gameStateRef.current === 'playing') {
        e.preventDefault();
        setDevPanelOpen((prev) => !prev);
      } else if (
        (e.code === 'KeyP' || e.key === 'Escape') &&
        promptModeRef.current === null
      ) {
        if (gameStateRef.current === 'playing') {
          setGameState('paused');
        } else if (gameStateRef.current === 'paused') {
          setGameState('playing');
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [settingsOpen, toggleFullscreen]);

  const handleToggleMute = () => {
    soundSynth.muted = !soundSynth.muted;
    setMuted(soundSynth.muted);
  };

  const handleQualityChange = useCallback((level: QualityLevel) => {
    setQualityLevel(level);
    qualityLevelRef.current = level;
    saveQualityLevel(level);
    arenaRef.current?.setQuality(level);
  }, []);

  const handleSettingsChange = useCallback((next: GameSettings) => {
    setSettings(next);
  }, []);

  const openSettings = useCallback(() => {
    setSettingsOpen(true);
    if (gameStateRef.current === 'playing') {
      setGameState('paused');
    }
    arenaRef.current?.releasePointerLock();
  }, []);

  const closeSettings = useCallback(() => {
    setSettingsOpen(false);
  }, []);

  useEffect(() => {
    settingsRef.current = settings;
    saveSettings(settings);
    audioEngine.setMasterVolume(settings.volumes.master);
    audioEngine.setBusVolume('sfx', settings.volumes.sfx);
    audioEngine.setBusVolume('ambience', settings.volumes.ambience);
    audioEngine.setBusVolume('ui', settings.volumes.ui);
    arenaRef.current?.setLookSensitivity(settings.sensitivity);
    arenaRef.current?.setInvertY(settings.invertY);
    arenaRef.current?.setReducedMotion(settings.reducedMotion);
    if (!settings.showStats) setPerfStats(null);
  }, [settings]);

  useEffect(() => {
    const onChange = () => {
      const doc = document as Document & { webkitFullscreenElement?: Element | null };
      setIsFullscreen(Boolean(doc.fullscreenElement ?? doc.webkitFullscreenElement));
    };
    onChange();
    document.addEventListener('fullscreenchange', onChange);
    document.addEventListener('webkitfullscreenchange', onChange);
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      document.removeEventListener('webkitfullscreenchange', onChange);
    };
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
      const t = performance.now();
      pingSentAtRef.current = t;
      wsRef.current.send(JSON.stringify({ type: 'ping', payload: { t } }));
    }, 2500);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => {
      const next = arenaRef.current?.getPerfStats();
      if (!next) return;
      if (import.meta.env.DEV || settingsRef.current.showStats) {
        setPerfStats(next);
      }
    }, 500);
    return () => window.clearInterval(id);
  }, []);

  const handlePromptSubmit = (prompt: string) => {
    if (promptMode === 'weapon') {
      sendWs({ type: 'ai:forge_weapon', payload: { prompt } });
    } else if (promptMode === 'event') {
      sendWs({ type: 'ai:trigger_event', payload: { prompt } });
    }
    setPromptMode(null);
    canvasRef.current?.focus();
    arenaRef.current?.requestPointerLock();
  };

  const handlePromptCancel = useCallback(() => {
    const kind: PromptKind | null = promptModeRef.current;
    if (kind) {
      sendWs({ type: 'prompt:cancel', payload: { kind } });
    }
    setPromptMode(null);
    canvasRef.current?.focus();
    arenaRef.current?.requestPointerLock();
  }, [sendWs]);

  const handleBackToTitle = () => {
    sendWs({ type: 'room:leave' });
    wsRef.current?.close();
    wsRef.current = null;
    setLobbyState(null);
    setPromptMode(null);
    setDevPanelOpen(false);
    setSummary(null);
    setErrorMessage(null);
    setGameState('title');
    void fetchRooms();
  };

  const handleDevAction = useCallback(
    (payload: DevActionPayload) => {
      if (!import.meta.env.DEV || !devEnabledRef.current) return;
      sendWs({ type: 'dev:action', payload });
    },
    [sendWs],
  );

  const handleRestart = () => {
    setPromptMode(null);
    setSummary(null);
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      sendWs({ type: 'room:restart' });
    } else {
      handleQuickPlay();
    }
  };

  const localPlayer = players.find((p) => p.id === localPlayerId) ?? null;

  return (
    <main className="relative w-screen h-screen overflow-hidden bg-[#0b101b]">
      {/* Isolated Babylon.js 3D Viewport */}
      <canvas
        ref={canvasRef}
        tabIndex={0}
        data-testid="voxel-canvas"
        className="block w-full h-full outline-none"
      />

      {contextLost && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0b101b] text-white">
          <p className="text-sm">Contexto WebGL restaurando...</p>
        </div>
      )}

      {gameState === 'title' && (
        <LobbyOverlay
          playerName={playerName}
          onPlayerNameChange={setPlayerName}
          initialRoomCode={initialRoomCode}
          rooms={rooms}
          loadingRooms={loadingRooms}
          onRefreshRooms={() => void fetchRooms()}
          onCreateRoom={handleCreateRoom}
          onJoinRoom={handleJoinRoom}
          onQuickPlay={handleQuickPlay}
          connecting={connecting}
          errorMessage={errorMessage}
          errorCode={errorCode}
          errorRoomId={errorRoomId}
          isFullscreen={isFullscreen}
          onToggleFullscreen={() => void toggleFullscreen()}
          onOpenSettings={openSettings}
        />
      )}

      {gameState === 'waiting' && lobbyState && (
        <WaitingRoomOverlay
          lobby={lobbyState}
          errorMessage={errorMessage}
          devEnabled={import.meta.env.DEV && devEnabled}
          onStartMatch={() => sendWs({ type: 'room:start' })}
          onStartSoloMatch={() => {
            if (!import.meta.env.DEV || !devEnabled) return;
            sendWs({ type: 'room:update_settings', payload: { fillWithBots: false } });
            sendWs({ type: 'room:start', payload: { devSolo: true } });
          }}
          onUpdateSettings={(patch) => sendWs({ type: 'room:update_settings', payload: patch })}
          onKickPlayer={(targetPlayerId) => sendWs({ type: 'room:kick', payload: { targetPlayerId } })}
          onTransferHost={(targetPlayerId) =>
            sendWs({ type: 'room:transfer_host', payload: { targetPlayerId } })
          }
          onLeaveRoom={handleBackToTitle}
        />
      )}

      {gameState === 'playing' && promptMode === null && (
        <GameHud
          localPlayer={localPlayer}
          allPlayers={players}
          lootDrops={lootDrops}
          entities={entities}
          islandSizeMeters={islandSizeMeters}
          activeEvents={activeEvents}
          eventCycle={eventCycle}
          serverNow={serverNow}
          eventCooldownSec={eventCooldownSec}
          killfeed={killfeed}
          zoomMeters={zoomMeters}
          muted={muted}
          qualityLevel={qualityLevel}
          perfStats={perfStats}
          showStats={settings.showStats}
          pingMs={pingMs}
          pointerLocked={pointerLocked}
          isFullscreen={isFullscreen}
          damageFlash={damageFlash}
          hitmarkerActive={hitmarkerActive}
          hitmarkerHeavy={hitmarkerHeavy}
          aimContext={aimContext}
          nearbyLootName={nearbyLootName}
          nearbyZipline={nearbyZipline}
          damageDirection={damageDirection}
          damageNumbers={damageNumbers}
          devEnabled={import.meta.env.DEV && devEnabled}
          devPanelOpen={devPanelOpen}
          onToggleDevPanel={() => setDevPanelOpen((v) => !v)}
          onToggleMute={handleToggleMute}
          onToggleFullscreen={() => void toggleFullscreen()}
          onOpenSettings={openSettings}
          onPause={() => setGameState('paused')}
          onSelectSlot={(slot) => arenaRef.current?.selectSlot(slot)}
          onOpenWeaponPrompt={() => openWeaponPrompt()}
          onOpenEventPrompt={() => openEventPrompt()}
          onFeedback={(itemId, rating, kind = 'weapon') =>
            sendWs({ type: 'content:feedback', payload: { itemId, rating, kind } })
          }
        />
      )}

      {import.meta.env.DEV && devEnabled && gameState === 'playing' && devPanelOpen && (
        <DevPanel
          devState={devState}
          devCatalog={devCatalog}
          localPlayer={localPlayer}
          allPlayers={players}
          activeEventsCount={activeEvents.length}
          entitiesCount={entities.length}
          onAction={handleDevAction}
          onRequestCatalog={() => sendWs({ type: 'dev:catalog' })}
          onClose={() => setDevPanelOpen(false)}
        />
      )}

      {gameState === 'playing' && promptMode !== null && (
        <PromptBar
          mode={promptMode}
          endsAt={
            localPlayer?.prompt?.kind === promptMode ? localPlayer.prompt.endsAt : null
          }
          serverNow={serverNow}
          onSubmit={handlePromptSubmit}
          onCancel={handlePromptCancel}
        />
      )}

      {(gameState === 'paused' || gameState === 'gameover') && (
        <StatusModal
          kind={gameState}
          localPlayerId={localPlayerId}
          roomId={roomId}
          hostId={hostId}
          hostName={hostName}
          accessMode={roomAccessMode}
          summary={summary}
          localAlive={Boolean(localPlayer?.alive)}
          onResume={() => {
            setGameState('playing');
            canvasRef.current?.focus();
          }}
          onRestart={handleRestart}
          onUpdateAccess={(accessMode, password) =>
            sendWs({ type: 'room:update_settings', payload: { accessMode, password } })
          }
          onOpenSettings={openSettings}
          onBackToTitle={handleBackToTitle}
        />
      )}

      {settingsOpen && (
        <SettingsModal
          settings={settings}
          qualityLevel={qualityLevel}
          isFullscreen={isFullscreen}
          onChange={handleSettingsChange}
          onQualityChange={handleQualityChange}
          onToggleFullscreen={() => void toggleFullscreen()}
          onClose={closeSettings}
        />
      )}
    </main>
  );
}
