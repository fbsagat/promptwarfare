import { useCallback, useEffect, useRef, useState } from 'react';
import { DevPanel } from './components/DevPanel.tsx';
import { GameHud } from './components/GameHud.tsx';
import { LobbyOverlay } from './components/LobbyOverlay.tsx';
import { PromptOverlay } from './components/PromptOverlay.tsx';
import { StatusModal } from './components/StatusModal.tsx';
import { WaitingRoomOverlay } from './components/WaitingRoomOverlay.tsx';
import { BabylonVoxelArena } from './engine/babylonArena.ts';
import { soundSynth } from './engine/soundSynth.ts';
import { isClientDevEnabled } from './shared/devMode.ts';
import { buildHttpUrl, buildWsUrl } from './shared/endpoints.ts';
import {
  VOXEL_SIZE,
  type DevActionPayload,
  type DevRoomState,
  type KillfeedEntry,
  type LobbyStatePayload,
  type LootDropState,
  type MapEventState,
  type PlayerNetState,
  type RoomAccessMode,
  type RoomInitPayload,
  type RoomMatchSummary,
  type RoomPublicSummary,
  type RoomTickPayload,
  type SpawnedEntityNetState,
  type Vec3,
  type VoxelDelta,
  type WeaponAllocation,
} from './shared/types.ts';

type GamePhaseState = 'title' | 'waiting' | 'playing' | 'paused' | 'gameover';

// Vite inlines these at build time. Empty values keep the API/WS same-origin.
const API_URL = import.meta.env.VITE_API_URL as string | undefined;
const WS_URL = import.meta.env.VITE_WS_URL as string | undefined;

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
  const [activeEvents, setActiveEvents] = useState<MapEventState[]>([]);
  const [eventCooldownSec, setEventCooldownSec] = useState(24);
  const [rafflePlayerId, setRafflePlayerId] = useState<string | null>(null);
  const [rafflePlayerName, setRafflePlayerName] = useState<string | null>(null);
  const [raffleRemainingSec, setRaffleRemainingSec] = useState(0);
  const [killfeed, setKillfeed] = useState<KillfeedEntry[]>([]);
  const [summary, setSummary] = useState<RoomMatchSummary | null>(null);

  const [promptMode, setPromptMode] = useState<'weapon' | 'event' | null>(null);
  const promptModeRef = useRef<'weapon' | 'event' | null>(null);
  const [zoomMeters, setZoomMeters] = useState(0);
  const [muted, setMuted] = useState(false);
  const [damageFlash, setDamageFlash] = useState(false);
  const [hitmarkerActive, setHitmarkerActive] = useState(false);
  const [aimContext, setAimContext] = useState<'neutral' | 'dig' | 'grapple' | 'enemy'>('neutral');
  const [nearbyLootName, setNearbyLootName] = useState<string | null>(null);
  const [islandSizeMeters, setIslandSizeMeters] = useState(88);
  const [lootDrops, setLootDrops] = useState<LootDropState[]>([]);
  const [entities, setEntities] = useState<SpawnedEntityNetState[]>([]);
  const [serverDevMode, setServerDevMode] = useState(false);
  const [devState, setDevState] = useState<DevRoomState>({
    enabled: false,
    godMode: false,
    infiniteSandbox: false,
    botsFrozen: false,
  });
  const [devPanelOpen, setDevPanelOpen] = useState(false);
  const devEnabled = isClientDevEnabled(import.meta.env.DEV, serverDevMode);
  const devEnabledRef = useRef(false);
  devEnabledRef.current = devEnabled;

  const playersRef = useRef<PlayerNetState[]>([]);
  const rafflePlayerIdRef = useRef<string | null>(null);
  const lastHudSyncRef = useRef<number>(0);
  const prevHpRef = useRef<number | null>(null);
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

  useEffect(() => {
    promptModeRef.current = promptMode;
    arenaRef.current?.setPromptOpen(promptMode !== null);
  }, [promptMode]);

  const sendWs = useCallback((msg: unknown) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  const openWeaponPrompt = useCallback(() => {
    if (gameStateRef.current !== 'playing') return;
    const local = playersRef.current.find((p) => p.id === localPlayerIdRef.current);
    if (!local || !local.alive || !local.canForgeWeapon) return;
    setPromptMode('weapon');
  }, []);

  const openEventPrompt = useCallback(() => {
    if (gameStateRef.current !== 'playing') return;
    const local = playersRef.current.find((p) => p.id === localPlayerIdRef.current);
    if (!local || !local.alive) return;
    if (rafflePlayerIdRef.current === local.id) {
      setPromptMode('event');
    }
  }, []);

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
          payload: {
            ...input,
            isTypingPrompt: promptModeRef.current !== null,
          },
        });
      },
      onPrimaryAction: (origin: Vec3, dir: Vec3) => {
        sendWs({ type: 'player:action', payload: { origin, dir } });
      },
      onDropItem: () => sendWs({ type: 'player:drop' }),
      onPickupItem: () => sendWs({ type: 'player:pickup' }),
      onOpenWeaponPrompt: () => openWeaponPrompt(),
      onOpenEventPrompt: () => openEventPrompt(),
      onZoomChange: (z) => setZoomMeters(z),
      onAimContextChange: (ctx) => setAimContext(ctx),
      onContextLost: (lost) => setContextLost(lost),
    });

    arenaRef.current = arena;
    return () => {
      if (damageFlashTimerRef.current) window.clearTimeout(damageFlashTimerRef.current);
      if (hitmarkerTimerRef.current) window.clearTimeout(hitmarkerTimerRef.current);
      arena.dispose();
      arenaRef.current = null;
    };
  }, [openEventPrompt, openWeaponPrompt, sendWs]);

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
          const init = msg.payload as RoomInitPayload;
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
          playersRef.current = init.players;
          rafflePlayerIdRef.current = init.rafflePlayerId;
          setPlayers(init.players);
          setActiveEvents(init.activeEvents);
          setEventCooldownSec(init.eventCooldownSec);
          setRafflePlayerId(init.rafflePlayerId);
          setRafflePlayerName(init.rafflePlayerName);
          setRaffleRemainingSec(init.raffleRemainingSec);
          setZoomMeters(0);
          setIslandSizeMeters(init.dimX * VOXEL_SIZE);
          setLootDrops(init.lootDrops);
          setEntities(init.entities);
          prevHpRef.current = null;
          prevCanForgeRef.current = false;
          setDamageFlash(false);
          setHitmarkerActive(false);
          setNearbyLootName(null);
          arenaRef.current?.loadRoomInit(init);
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

        if (msg.type === 'fx:hit') {
          const heavy = Boolean(msg.payload?.heavy);
          arenaRef.current?.triggerHitstop(heavy ? 0.052 : 0.032);
          soundSynth.playHitConfirm(heavy);
          setHitmarkerActive(true);
          if (hitmarkerTimerRef.current) window.clearTimeout(hitmarkerTimerRef.current);
          hitmarkerTimerRef.current = window.setTimeout(() => {
            setHitmarkerActive(false);
          }, 160);
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

        if (msg.type === 'ai:weapon_ready') {
          soundSynth.playForgeComplete();
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

        if (msg.type === 'room:tick') {
          const tick = msg.payload as RoomTickPayload;
          arenaRef.current?.applyRoomTick(tick);
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
          } else {
            prevCanForgeRef.current = false;
            prevHpRef.current = null;
          }

          if (
            promptModeRef.current === 'event' &&
            tick.rafflePlayerId !== localPlayerIdRef.current
          ) {
            setPromptMode(null);
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
            setEventCooldownSec(tick.eventCooldownSec);
            setRafflePlayerId(tick.rafflePlayerId);
            setRafflePlayerName(tick.rafflePlayerName);
            setRaffleRemainingSec(tick.raffleRemainingSec);

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

  // Global keyboard shortcuts (Pause P/Escape, Mute M)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const activeTag = document.activeElement?.tagName;
      const inInput = activeTag === 'INPUT' || activeTag === 'TEXTAREA';
      if (inInput) return;

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
  }, []);

  const handleToggleMute = () => {
    soundSynth.muted = !soundSynth.muted;
    setMuted(soundSynth.muted);
  };

  const handlePromptSubmit = (prompt: string, allocation?: WeaponAllocation) => {
    if (promptMode === 'weapon') {
      sendWs({ type: 'ai:forge_weapon', payload: { prompt, allocation } });
    } else if (promptMode === 'event') {
      sendWs({ type: 'ai:trigger_event', payload: { prompt } });
    }
    setPromptMode(null);
    canvasRef.current?.focus();
    arenaRef.current?.requestPointerLock();
  };

  const handlePromptTimeout = useCallback(() => {
    if (promptModeRef.current === 'weapon') {
      sendWs({ type: 'ai:weapon_prompt_timeout' });
    }
    setPromptMode(null);
    canvasRef.current?.focus();
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

      {gameState === 'playing' && (
        <GameHud
          localPlayer={localPlayer}
          allPlayers={players}
          lootDrops={lootDrops}
          entities={entities}
          islandSizeMeters={islandSizeMeters}
          activeEvents={activeEvents}
          eventCooldownSec={eventCooldownSec}
          rafflePlayerId={rafflePlayerId}
          rafflePlayerName={rafflePlayerName}
          raffleRemainingSec={raffleRemainingSec}
          killfeed={killfeed}
          zoomMeters={zoomMeters}
          muted={muted}
          damageFlash={damageFlash}
          hitmarkerActive={hitmarkerActive}
          aimContext={aimContext}
          nearbyLootName={nearbyLootName}
          devEnabled={import.meta.env.DEV && devEnabled}
          devPanelOpen={devPanelOpen}
          onToggleDevPanel={() => setDevPanelOpen((v) => !v)}
          onToggleMute={handleToggleMute}
          onPause={() => setGameState('paused')}
          onSelectSlot={(slot) => arenaRef.current?.selectSlot(slot)}
          onOpenWeaponPrompt={() => openWeaponPrompt()}
          onOpenEventPrompt={() => openEventPrompt()}
        />
      )}

      {import.meta.env.DEV && devEnabled && gameState === 'playing' && devPanelOpen && (
        <DevPanel
          devState={devState}
          localPlayer={localPlayer}
          allPlayers={players}
          activeEventsCount={activeEvents.length}
          entitiesCount={entities.length}
          onAction={handleDevAction}
          onClose={() => setDevPanelOpen(false)}
        />
      )}

      {gameState === 'playing' && promptMode !== null && (
        <PromptOverlay
          mode={promptMode}
          remainingSec={promptMode === 'event' ? raffleRemainingSec : undefined}
          onSubmit={handlePromptSubmit}
          onTimeout={handlePromptTimeout}
          onCancel={() => {
            setPromptMode(null);
            canvasRef.current?.focus();
          }}
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
          onBackToTitle={handleBackToTitle}
        />
      )}
    </main>
  );
}
