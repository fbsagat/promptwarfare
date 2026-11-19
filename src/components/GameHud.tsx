import React, { useEffect, useState } from 'react';
import {
  Maximize,
  Minimize,
  Pause,
  Settings,
  Sparkles,
  AlertTriangle,
  Volume2,
  VolumeX,
  Wrench,
  ThumbsUp,
  ThumbsDown,
} from 'lucide-react';
import {
  BOT_EVENT_WINDOW_SEC,
  EVENT_CYCLE_COOLDOWN_SEC,
  EVENT_RAFFLE_WINDOW_SEC,
  EVENT_WRITE_WINDOW_SEC,
  WEAPON_CYCLE_COOLDOWN_SEC,
} from '../shared/budget.ts';
import type {
  EventCycleState,
  InventorySlotItem,
  KillfeedEntry,
  LootDropState,
  MapEventState,
  PlayerNetState,
  SpawnedEntityNetState,
  GameMode,
} from '../shared/types.ts';
import { RELICS } from '../shared/relics.ts';
import {
  type QualityLevel,
} from '../engine/quality.ts';
import type { PerfStats } from '../engine/babylonArena.ts';

const QUALITY_LABELS: Record<QualityLevel, string> = {
  auto: 'Auto',
  low: 'Baixa',
  medium: 'Média',
  high: 'Alta',
};

const COUNTERPLAY_LABELS: Record<string, string> = {
  shelter: 'Abrigue-se',
  dig: 'Cave',
  sprint: 'Corra',
  high_ground: 'Suba',
  grapple: 'Use o gancho',
  adapt: 'Adapte-se',
  jump: 'Pule',
  climb: 'Suba',
  combat: 'Enfrente',
  loot: 'Corra para o loot',
};

const EVENT_PHASE_LABELS: Record<string, string> = {
  warning: 'AVISO',
  impact: 'IMPACTO',
  sustain: 'CAOS',
  climax: 'CLÍMAX',
  dissipate: 'RESCALDO',
};

interface GameHudProps {
  localPlayer: PlayerNetState | null;
  allPlayers: PlayerNetState[];
  lootDrops: LootDropState[];
  entities: SpawnedEntityNetState[];
  islandSizeMeters: number;
  activeEvents: MapEventState[];
  eventCycle: EventCycleState;
  serverNow: number;
  eventCooldownSec: number;
  killfeed: KillfeedEntry[];
  zoomMeters: number;
  muted: boolean;
  qualityLevel: QualityLevel;
  perfStats?: PerfStats | null;
  showStats: boolean;
  pingMs: number | null;
  pointerLocked: boolean;
  isFullscreen: boolean;
  damageFlash: boolean;
  hitmarkerActive: boolean;
  hitmarkerHeavy: boolean;
  aimContext: 'neutral' | 'dig' | 'grapple' | 'enemy';
  nearbyLootName: string | null;
  nearbyZipline: string | null;
  damageDirection: { angle: number } | null;
  damageNumbers: Array<{ id: number; x: number; y: number; amount: number }>;
  devEnabled?: boolean;
  devPanelOpen?: boolean;
  onToggleDevPanel?: () => void;
  onToggleMute: () => void;
  onToggleFullscreen: () => void;
  onOpenSettings: () => void;
  onPause: () => void;
  onSelectSlot: (slot: number) => void;
    onOpenWeaponPrompt: () => void;
      onOpenEventPrompt: () => void;
      onFeedback: (itemId: string, rating: 1 | -1, kind?: 'weapon' | 'event') => void;
      gameMode: GameMode;
      elapsedSec?: number;
      matchDurationSec?: number;
      maxKills?: number;
      arsenalMatchDuration?: number;
            arsenalMaxKills?: number;
            arsenalTeams?: boolean;
            showScoreboard: boolean;
          }

    const BEHAVIOR_LABELS: Record<string, string> = {
    standard: 'Balístico',
    bouncing: 'Ricochete',
    homing_weak: 'Teleguiado',
    sticky_bomb: 'Adesiva',
    piercing: 'Perfurante',
  };

  const EFFECT_LABELS: Record<string, string> = {
    none: 'Neutro',
    knockback: 'Repulsão',
    burn: 'Incendiário',
    freeze: 'Criogênico',
    gravity_pull: 'Gravitacional',
  };

  const RISK_LABELS: Record<string, string> = {
    recoil_launch: 'Coice Extremo',
    overheat_explosion: 'Explosão Térmica',
    toxic_leak: 'Vazamento Tóxico',
  };

  const COMPASS_POINTS: Array<{ label: string; deg: number }> = [
    { label: 'N', deg: 0 },
    { label: 'NE', deg: 45 },
    { label: 'E', deg: 90 },
    { label: 'SE', deg: 135 },
    { label: 'S', deg: 180 },
    { label: 'SO', deg: 225 },
    { label: 'O', deg: 270 },
    { label: 'NO', deg: 315 },
  ];

  const CompassBar: React.FC<{ yaw: number }> = ({ yaw }) => {
  const heading = ((((yaw * 180) / Math.PI) % 360) + 360) % 360;
  return (
    <div className="relative h-6 w-60 md:w-72 rounded-md bg-[#0b101b]/72 border border-white/12 overflow-hidden pointer-events-none">
      <div className="absolute inset-y-0 left-1/2 w-px bg-amber-300/80 -translate-x-1/2" />
      {COMPASS_POINTS.map((point) => {
        const delta = (((point.deg - heading + 540) % 360) - 180);
        if (Math.abs(delta) > 82) return null;
        return (
          <span
            key={point.label}
            className={`absolute top-1/2 -translate-y-1/2 font-mono-tabular text-[10px] ${
              point.label.length === 1
                ? 'text-slate-100 font-bold'
                : 'text-slate-400'
            }`}
            style={{ left: `calc(50% + ${(delta / 180) * 50}%)` }}
          >
            {point.label}
          </span>
        );
      })}
      <span className="absolute right-1.5 top-1/2 -translate-y-1/2 font-mono-tabular text-[9px] text-amber-200/90">
        {Math.round(heading)}°
      </span>
    </div>
  );
  };

  const Scoreboard: React.FC<{ players: PlayerNetState[]; localPlayerId: string | null; gameMode: GameMode; arsenalTeams: boolean }> = ({ players, localPlayerId, gameMode, arsenalTeams }) => {
      const sortedPlayers = [...players].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths || a.name.localeCompare(b.name));
    
      // Calculate team scores for Arsenal teams mode
      const teamScores = arsenalTeams && gameMode === 'arsenal' 
        ? {
            blue: sortedPlayers.filter(p => p.team === 'blue').reduce((sum, p) => sum + p.kills, 0),
            orange: sortedPlayers.filter(p => p.team === 'orange').reduce((sum, p) => sum + p.kills, 0),
          }
        : null;

      return (
        <div className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none bg-black/60">
          <div className="pointer-events-auto bg-[#0b101b]/98 border border-rose-400/30 rounded-2xl shadow-2xl w-full max-w-3xl mx-4 max-h-[80vh] overflow-hidden flex flex-col">
            <div className="bg-gradient-to-r from-rose-500/20 to-rose-600/10 border-b border-rose-400/30 px-4 py-3 flex items-center justify-between">
              <h2 className="text-xl font-display font-bold text-rose-200">PLACAR - MODO ARSENAL</h2>
              <span className="text-sm font-mono-tabular text-rose-300/80">Segure TAB para fechar</span>
            </div>
            {/* Team scores banner for Arsenal teams mode */}
            {teamScores && (
              <div className="bg-gradient-to-r from-sky-500/10 to-amber-500/10 border-b border-white/10 px-4 py-2 flex items-center justify-center gap-8">
                <div className="flex items-center gap-2 bg-sky-500/20 border border-sky-400 rounded-lg px-3 py-1">
                  <span className="text-sky-300 font-display font-bold">🔵 Time Azul</span>
                  <span className="font-mono-tabular text-sky-100 text-lg">{teamScores.blue}</span>
                </div>
                <div className="flex items-center gap-2 bg-amber-500/20 border border-amber-400 rounded-lg px-3 py-1">
                  <span className="text-amber-300 font-display font-bold">🟠 Time Laranja</span>
                  <span className="font-mono-tabular text-amber-100 text-lg">{teamScores.orange}</span>
                </div>
              </div>
            )}
            <div className="overflow-x-auto overflow-y-auto p-4">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/10">
                    <th className="text-left pb-2 font-mono-tabular text-slate-400 uppercase tracking-wider text-[11px]">Jogador</th>
                    <th className="text-right pb-2 font-mono-tabular text-slate-400 uppercase tracking-wider text-[11px] w-20">Kills</th>
                    <th className="text-right pb-2 font-mono-tabular text-slate-400 uppercase tracking-wider text-[11px] w-20">Mortes</th>
                    <th className="text-right pb-2 font-mono-tabular text-slate-400 uppercase tracking-wider text-[11px] w-20">Assist.</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedPlayers.map((player, index) => (
                    <tr
                      key={player.id}
                      className={`border-b border-white/5 last:border-b-0 transition-colors ${
                        player.id === localPlayerId ? 'bg-rose-500/10' : ''
                      }`}
                    >
                      <td className="py-2 pr-3 font-medium truncate max-w-[200px]">
                        <div className="flex items-center gap-2">
                          <span className="font-mono-tabular text-slate-500 text-[11px] w-5 text-right">{index + 1}.</span>
                          <span className={`font-display ${player.alive ? 'text-white' : 'text-slate-400 line-through'}`}>
                            {player.name}
                          </span>
                          {player.isBot && <span className="text-[9px] bg-slate-700 text-slate-300 px-1 rounded">BOT</span>}
                          {/* Team badge for Arsenal teams mode */}
                          {arsenalTeams && gameMode === 'arsenal' && player.team && (
                            <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-semibold ${
                              player.team === 'blue'
                                ? 'bg-sky-500/20 border-sky-400 text-sky-300'
                                : 'bg-amber-500/20 border-amber-400 text-amber-300'
                            }`}>
                              {player.team === 'blue' ? '🔵' : '🟠'}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-2 text-right font-mono-tabular text-rose-200 font-bold w-20">{player.kills}</td>
                      <td className="py-2 text-right font-mono-tabular text-rose-400 w-20">{player.deaths}</td>
                      <td className="py-2 text-right font-mono-tabular text-amber-300 w-20">{player.assists}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      );
    };

  function renderSlotIcon(item: InventorySlotItem | null) {
  if (!item) return null;
  if (item.kind === 'shovel') {
    return (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M14 4L20 10L17 13L11 7L14 4Z" fill="#cbd5e1" stroke="#0f172a" strokeWidth="1.5" />
        <path d="M12 12L5 19" stroke="#d97706" strokeWidth="2.5" strokeLinecap="round" />
      </svg>
    );
  }
  if (item.kind === 'grapple') {
    return (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M4 20L14 10" stroke="#06b6d4" strokeWidth="2.2" strokeLinecap="round" />
        <path d="M11 6L18 6L18 13" stroke="#e2e8f0" strokeWidth="2.2" strokeLinecap="round" />
        <circle cx="15" cy="9" r="2" fill="#22d3ee" />
      </svg>
    );
  }
  if (item.kind === 'relic') {
    const color = item.relicId ? RELICS[item.relicId]?.color ?? '#fbbf24' : '#fbbf24';
    return (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M12 3L20 12L12 21L4 12L12 3Z"
          fill={color}
          fillOpacity="0.35"
          stroke={color}
          strokeWidth="1.8"
        />
        <circle cx="12" cy="12" r="2.4" fill={color} />
      </svg>
    );
  }
  const color = item.weapon?.palette[0]?.hex || '#f59e0b';
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3" y="8" width="15" height="6" rx="1" fill="#334155" stroke="#0f172a" strokeWidth="1.2" />
      <rect x="6" y="14" width="4" height="6" fill="#475569" />
      <rect x="15" y="9" width="6" height="3" fill={color} />
    </svg>
  );
}

export const GameHud: React.FC<GameHudProps> = ({
  localPlayer,
  allPlayers,
  lootDrops,
  entities,
  islandSizeMeters,
  activeEvents,
  eventCycle,
  serverNow,
  eventCooldownSec,
  killfeed,
  zoomMeters,
  muted,
  qualityLevel,
  perfStats,
  showStats,
  pingMs,
  pointerLocked,
  isFullscreen,
  damageFlash,
  hitmarkerActive,
  hitmarkerHeavy,
  aimContext,
  nearbyLootName,
  nearbyZipline,
  damageDirection,
  damageNumbers,
  devEnabled,
  devPanelOpen,
  onToggleDevPanel,
  onToggleMute,
  onToggleFullscreen,
  onOpenSettings,
  onPause,
  onSelectSlot,
  onOpenWeaponPrompt,
  onOpenEventPrompt,
  onFeedback,
    gameMode,
    elapsedSec,
    matchDurationSec,
    maxKills,
    arsenalMatchDuration,
        arsenalMaxKills,
        arsenalTeams,
            showScoreboard,
          }) => {
  const [ghostHp, setGhostHp] = useState(100);
  const [feedback, setFeedback] = useState<Record<string, 1 | -1>>({});
  const currentHp = localPlayer?.hp ?? 0;

  useEffect(() => {
    const t = setTimeout(() => setGhostHp(currentHp), 360);
    return () => clearTimeout(t);
  }, [currentHp]);

  const aliveCount = allPlayers.filter((p) => p.alive).length;
  const totalCount = allPlayers.length;
  const eventRemainingSec = eventCycle.endsAt
    ? Math.max(0, Math.ceil((eventCycle.endsAt - serverNow) / 1000))
    : Math.max(0, eventCooldownSec);
  const eventWindowSec =
    eventCycle.phase === 'cooldown'
      ? EVENT_CYCLE_COOLDOWN_SEC
      : eventCycle.phase === 'raffle'
        ? EVENT_RAFFLE_WINDOW_SEC
        : eventCycle.phase === 'writing'
          ? EVENT_WRITE_WINDOW_SEC
          : BOT_EVENT_WINDOW_SEC;
  const isRaffled =
    eventCycle.rafflePlayerId !== null &&
    eventCycle.rafflePlayerId === localPlayer?.id &&
    eventCycle.phase !== 'cooldown';
  const raffledName = eventCycle.rafflePlayerName;
  const forgePhase =
    localPlayer?.forge?.phase ?? (localPlayer?.canForgeWeapon ? 'ready' : 'cooling');
  const forgeRemainingSec = localPlayer?.forge?.endsAt
    ? Math.max(0, Math.ceil((localPlayer.forge.endsAt - serverNow) / 1000))
    : Math.max(0, localPlayer?.weaponCooldownSec ?? 0);
  const warningEvent = activeEvents.find((e) => e.warningRemainingSec > 0);
  const activeItem = localPlayer?.slots[localPlayer.activeSlot] ?? null;
  const inWater = (localPlayer?.oxygen ?? 100) < 99.5;
  const isOverheated =
    localPlayer !== null && localPlayer.overheatedUntil > Date.now();
  const isHot = (localPlayer?.heat ?? 0) >= 72 || isOverheated;

  const crosshairTickClass =
      aimContext === 'enemy'
        ? 'bg-rose-400'
        : aimContext === 'grapple'
          ? 'bg-cyan-400'
          : aimContext === 'dig'
            ? 'bg-amber-300'
            : 'bg-white/85';

    const hitmarkerSlashClass = hitmarkerHeavy
      ? 'w-4 h-[2px] bg-amber-300 shadow-[0_0_6px_rgba(252,211,77,0.9)]'
      : 'w-3 h-[1.5px] bg-rose-400';

    // Arsenal mode HUD state
        const isArsenal = gameMode === 'arsenal';
        // Use init payload values as fallback when tick payload not yet received
        const effectiveMatchDuration = matchDurationSec ?? arsenalMatchDuration ?? 300;
        const effectiveMaxKills = maxKills ?? arsenalMaxKills ?? 20;
        const matchTimerSec = isArsenal && elapsedSec !== undefined
          ? Math.max(0, effectiveMatchDuration - elapsedSec)
          : 0;
        const localPlayerKills = localPlayer?.kills ?? 0;
        const isDead = localPlayer && !localPlayer.alive;
        const respawnTimerSec = isArsenal && isDead && localPlayer.respawnAt
          ? Math.max(0, Math.ceil((localPlayer.respawnAt - serverNow) / 1000))
          : 0;
        const matchProgress = isArsenal && elapsedSec !== undefined
          ? Math.min(100, (elapsedSec / effectiveMatchDuration) * 100)
          : 0;

    const offscreenMarkers = (() => {
    if (!localPlayer) return [];
    return activeEvents
      .map((evt) => {
        const dx = evt.center[0] - localPlayer.position.x;
        const dz = evt.center[2] - localPlayer.position.z;
        const dist = Math.hypot(dx, dz);
        let rel = Math.atan2(dx, dz) - localPlayer.yaw;
        rel = Math.atan2(Math.sin(rel), Math.cos(rel));
        return { evt, dist, rel };
      })
      .filter(({ dist, rel }) => dist > 10 && dist < 150 && Math.abs(rel) > 0.72)
      .sort((a, b) => a.dist - b.dist)
      .slice(0, 3);
  })();

  return (
    <div className="fixed inset-0 z-10 pointer-events-none flex flex-col justify-between p-4 md:p-5">
      {/* Peripheral blue drowning vignette when low oxygen */}
      {localPlayer && localPlayer.oxygen < 45 && localPlayer.alive && (
        <div
          className="fixed inset-0 pointer-events-none"
          style={{
            boxShadow: 'inset 0 0 90px 28px rgba(6, 182, 212, 0.45)',
          }}
        />
      )}

      {/* Peripheral coral-red damage vignette on hit */}
      {damageFlash && (
        <div
          className="fixed inset-0 pointer-events-none"
          style={{
            boxShadow: 'inset 0 0 95px 34px rgba(239, 68, 68, 0.48)',
          }}
        />
      )}

      {/* Eventos fora do campo de visão: seta na borda com distância */}
      {offscreenMarkers.map(({ evt, dist, rel }) => {
        const deg = (rel * 180) / Math.PI;
        const warning = evt.warningRemainingSec > 0;
        const label =
          evt.archetype === 'SUPPLY_DROP'
            ? 'SUPRIMENTO'
            : evt.archetype === 'SCENERY_SPAWN'
              ? 'ESTRUTURA'
              : evt.archetype === 'ENTITY_SPAWN'
                ? 'CRIATURAS'
                : evt.archetype === 'TERRAIN_MUTATION'
                  ? 'TERRENO'
                  : 'CLIMA';
        return (
          <div
            key={`edge_${evt.id}`}
            className="absolute left-1/2 top-1/2"
            style={{ transform: `translate(-50%, -50%) rotate(${deg}deg)` }}
          >
            <div className="absolute left-1/2 -translate-x-1/2 -top-[144px] flex flex-col items-center gap-1">
              <div
                className={`w-0 h-0 border-l-[7px] border-r-[7px] border-b-[13px] border-l-transparent border-r-transparent drop-shadow-[0_0_4px_rgba(0,0,0,0.85)] ${
                  warning ? 'border-b-rose-400' : 'border-b-amber-300'
                }`}
              />
              <span
                className={`inline-block text-[9px] font-mono-tabular font-bold px-1.5 py-0.5 rounded bg-[#0b101b]/85 whitespace-nowrap ${
                  warning ? 'text-rose-200' : 'text-amber-200'
                }`}
                style={{ transform: `rotate(${-deg}deg)` }}
              >
                {warning ? 'PERIGO' : label} · {Math.round(dist)}m
              </span>
            </div>
          </div>
        );
      })}

      {/* TOP ROW: Corner Clusters + Center Event Alert */}
      <div className="flex items-start justify-between gap-4">
        {/* Top-Left: HP, Mass, Oxygen, Alive Count */}
        <div className="bg-[#0b101b]/84 border border-white/15 rounded-lg px-3.5 py-2.5 min-w-[220px]">
          <div className="flex items-baseline justify-between gap-4 mb-1.5">
            <div className="flex items-baseline gap-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                HP
              </span>
              <span
                className="font-mono-tabular text-2xl font-bold text-white"
                data-testid="hud-hp"
              >
                {Math.round(currentHp)}
              </span>
            </div>
            <div className="text-xs text-slate-300 font-mono-tabular">
              {localPlayer?.massKg ?? 77} kg · Vivos {aliveCount}/{totalCount}
            </div>
          </div>

          {/* Health bar with delayed ghost drain */}
          <div className="relative h-2.5 w-full rounded bg-slate-800 overflow-hidden">
            <div
              className="absolute inset-y-0 left-0 bg-amber-400/50 transition-all duration-300"
              style={{ width: `${Math.max(0, Math.min(100, ghostHp))}%` }}
            />
            <div
              className={`absolute inset-y-0 left-0 transition-all duration-100 ${
                currentHp > 35 ? 'bg-emerald-400' : 'bg-rose-500'
              }`}
              style={{ width: `${Math.max(0, Math.min(100, currentHp))}%` }}
            />
          </div>

          {localPlayer && (localPlayer.stamina ?? 100) < 99.5 && (
            <div className="mt-2">
              <div className="flex justify-between text-[11px] font-mono-tabular text-emerald-300 mb-0.5">
                <span>Vigor</span>
                <span>{Math.round(localPlayer.stamina ?? 100)}%</span>
              </div>
              <div className="h-1.5 w-full rounded bg-slate-800 overflow-hidden">
                <div
                  className={`h-full transition-all duration-100 ${
                    (localPlayer.stamina ?? 100) < 20
                      ? 'bg-rose-400'
                      : 'bg-emerald-400'
                  }`}
                  style={{
                    width: `${Math.max(0, Math.min(100, localPlayer.stamina ?? 100))}%`,
                  }}
                />
              </div>
            </div>
          )}

          {localPlayer && localPlayer.sliding && (
            <div className="mt-1.5 text-[10px] font-mono-tabular font-bold text-sky-300">
              ESCORREGANDO
            </div>
          )}
          {localPlayer && localPlayer.slideCooldownSec > 0 && (
            <div className="mt-1 text-[10px] font-mono-tabular text-slate-400">
              Slide recarrega em {localPlayer.slideCooldownSec.toFixed(1)}s
            </div>
          )}

          {inWater && (
            <div className="mt-2">
              <div className="flex justify-between text-[11px] font-mono-tabular text-cyan-300 mb-0.5">
                <span>Fôlego</span>
                <span>{Math.round(localPlayer?.oxygen ?? 100)}%</span>
              </div>
              <div className="h-1.5 w-full rounded bg-slate-800 overflow-hidden">
                <div
                  className="h-full bg-cyan-400 transition-all duration-100"
                  style={{ width: `${Math.max(0, localPlayer?.oxygen ?? 100)}%` }}
                />
              </div>
            </div>
          )}
        </div>

        {/* Top-Center: Global Map Event Raffle Timer [Y], Warning Banner, Stacked Events */}
                <div className="flex flex-col items-center gap-2 max-w-md w-full">
                  <CompassBar yaw={localPlayer?.yaw ?? 0} />

                  {/* Arsenal Mode: Match Timer + Kill Counter */}
                  {isArsenal && (
                    <div className="w-full bg-[#0b101b]/84 border border-rose-400/25 rounded-lg px-3.5 py-2 text-xs text-slate-200 font-mono-tabular">
                      <div className="flex items-center justify-between gap-3 mb-1">
                        <span className="text-rose-300">⏱️ Partida</span>
                        <span className="text-rose-200 font-bold">
                          {Math.floor(matchTimerSec / 60).toString().padStart(2, '0')}:{(matchTimerSec % 60).toString().padStart(2, '0')}
                        </span>
                      </div>
                      <div className="h-1.5 rounded bg-slate-800 overflow-hidden">
                        <div
                          className="h-full bg-rose-400 transition-all duration-100"
                          style={{ width: `${matchProgress}%` }}
                        />
                      </div>
                      <div className="flex items-center justify-between gap-3 mt-1">
                                              <span className="text-slate-300">🏆 Kills</span>
                                              <span className="text-rose-200 font-bold">{localPlayerKills}/{effectiveMaxKills}</span>
                                            </div>
                    </div>
                  )}

                                    {!isArsenal && isRaffled ? (
                                      <button
                                        type="button"
                                        data-testid="event-raffle-btn"
                                        onClick={(e) => {
                                          e.currentTarget.blur();
                                          onOpenEventPrompt();
                                        }}
                                        className="pointer-events-auto flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-display font-bold text-sm shadow-lg cursor-pointer whitespace-nowrap animate-pulse"
                                      >
                                        <AlertTriangle className="w-4 h-4 shrink-0" />
                                        <span>
                                          Você foi sorteado — Enter para escrever ({eventRemainingSec}s)
                                        </span>
                                      </button>
                                    ) : !isArsenal ? (
                                      <div
                                        data-testid="event-timer"
                                        className="w-full bg-[#0b101b]/84 border border-amber-400/25 rounded-lg px-3.5 py-1.5 text-xs text-slate-200 font-mono-tabular"
                                      >
                                        {eventCycle.rafflePlayerId ? (
                                          <div className="flex items-center justify-between gap-3">
                                            <span className="text-amber-300 truncate">
                                              🎲 {raffledName || 'Jogador'}
                                              {eventCycle.phase === 'writing' || eventCycle.phase === 'bot'
                                                ? ' · preparando'
                                                : ' · sorteado'}
                                            </span>
                                            <span className="text-amber-200">{eventRemainingSec}s</span>
                                          </div>
                                        ) : (
                                          <div className="flex items-center justify-between gap-3">
                                            <span>Evento global em</span>
                                            <span className="text-amber-200">{eventRemainingSec}s</span>
                                          </div>
                                        )}
                                        <div className="mt-1 h-1 rounded bg-slate-800 overflow-hidden">
                                          <div
                                            className="h-full bg-amber-400 transition-all duration-100"
                                            style={{
                                              width: `${Math.max(
                                                3,
                                                Math.min(100, (eventRemainingSec / eventWindowSec) * 100),
                                              )}%`,
                                            }}
                                          />
                                        </div>
                                      </div>
                                    ) : null}

                                    {warningEvent && (
            <div
              role="status"
              className="w-full bg-rose-950/92 border border-rose-400/60 rounded-lg px-4 py-2 text-center shadow-lg"
            >
              <p className="text-xs font-bold text-rose-200">
                ⚠️ {warningEvent.authorName} invocou: &ldquo;{warningEvent.prompt}&rdquo; — Impacto em{' '}
                <span className="font-mono-tabular text-white">
                  {Math.ceil(warningEvent.warningRemainingSec)}s
                </span>
              </p>
              {warningEvent.fun && warningEvent.fun.counterplay.length > 0 && (
                <p className="mt-0.5 text-[10px] font-medium text-rose-100/80">
                  {warningEvent.fun.counterplay
                    .slice(0, 3)
                    .map((counter) => COUNTERPLAY_LABELS[counter] ?? counter)
                    .join(' · ')}
                </p>
              )}
            </div>
          )}

          {activeEvents.filter((e) => e.warningRemainingSec <= 0).length > 0 && (
            <div className="flex flex-wrap justify-center gap-2">
              {activeEvents
                .filter((e) => e.warningRemainingSec <= 0)
                .map((evt) => (
                  <div
                    key={evt.id}
                    className="bg-[#0b101b]/82 border border-amber-400/30 rounded px-2.5 py-1 text-[11px] text-amber-200 font-mono-tabular flex items-center gap-1.5"
                  >
                    <span>
                      {evt.prompt.slice(0, 26)} · {Math.ceil(evt.durationRemainingSec)}s
                      {evt.phase ? ` · ${EVENT_PHASE_LABELS[evt.phase] ?? evt.phase}` : ''}
                    </span>
                    {evt.catalogId &&
                      (feedback[evt.catalogId] ? (
                        <span className="text-emerald-300" aria-label="Feedback enviado">
                          ✓
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 border-l border-white/10 pl-1.5">
                          <button
                            type="button"
                            tabIndex={-1}
                            aria-label="Gostei deste evento"
                            onClick={(e) => {
                              e.currentTarget.blur();
                              onFeedback(evt.catalogId!, 1, 'event');
                              setFeedback((prev) => ({ ...prev, [evt.catalogId!]: 1 }));
                            }}
                            className="pointer-events-auto text-slate-300 hover:text-emerald-300 cursor-pointer"
                          >
                            <ThumbsUp className="w-3 h-3" />
                          </button>
                          <button
                            type="button"
                            tabIndex={-1}
                            aria-label="Não gostei deste evento"
                            onClick={(e) => {
                              e.currentTarget.blur();
                              onFeedback(evt.catalogId!, -1, 'event');
                              setFeedback((prev) => ({ ...prev, [evt.catalogId!]: -1 }));
                            }}
                            className="pointer-events-auto text-slate-300 hover:text-rose-300 cursor-pointer"
                          >
                            <ThumbsDown className="w-3 h-3" />
                          </button>
                        </span>
                      ))}
                  </div>
                ))}
            </div>
          )}
        </div>

        {/* Top-Right: Utility Controls + Compact Killfeed */}
        <div className="flex flex-col items-end gap-2">
          <div className="flex items-center gap-2 pointer-events-auto">
            {devEnabled && onToggleDevPanel && (
              <button
                type="button"
                tabIndex={-1}
                data-testid="dev-toggle-btn"
                aria-label="Alternar Modo Desenvolvimento [F8]"
                onClick={(e) => {
                  e.currentTarget.blur();
                  onToggleDevPanel();
                }}
                className={`h-9 px-2.5 flex items-center gap-1.5 rounded-lg border text-xs font-display font-bold cursor-pointer transition-colors ${
                  devPanelOpen
                    ? 'bg-amber-500 border-amber-400 text-slate-950'
                    : 'bg-[#0b101b]/84 border-amber-400/45 text-amber-300 hover:bg-amber-500/20'
                }`}
              >
                <Wrench className="w-3.5 h-3.5" />
                <span>DEV</span>
              </button>
            )}
            <button
              type="button"
              tabIndex={-1}
              aria-label="Configurações"
              onClick={(e) => {
                e.currentTarget.blur();
                onOpenSettings();
              }}
              className="w-9 h-9 flex items-center justify-center rounded-lg bg-[#0b101b]/84 border border-white/15 text-slate-200 hover:text-white hover:border-white/35 cursor-pointer"
            >
              <Settings className="w-4 h-4" />
            </button>
            <button
              type="button"
              tabIndex={-1}
              aria-label={isFullscreen ? 'Sair da tela cheia [F]' : 'Tela cheia [F]'}
              onClick={(e) => {
                e.currentTarget.blur();
                onToggleFullscreen();
              }}
              className="w-9 h-9 flex items-center justify-center rounded-lg bg-[#0b101b]/84 border border-white/15 text-slate-200 hover:text-white hover:border-white/35 cursor-pointer"
            >
              {isFullscreen ? (
                <Minimize className="w-4 h-4" />
              ) : (
                <Maximize className="w-4 h-4" />
              )}
            </button>
            <button
              type="button"
              tabIndex={-1}
              aria-label={muted ? 'Ativar áudio [M]' : 'Silenciar áudio [M]'}
              onClick={(e) => {
                e.currentTarget.blur();
                onToggleMute();
              }}
              className="w-9 h-9 flex items-center justify-center rounded-lg bg-[#0b101b]/84 border border-white/15 text-slate-200 hover:text-white hover:border-white/35 cursor-pointer"
            >
              {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
            </button>
            <button
              type="button"
              tabIndex={-1}
              aria-label="Pausar partida [P]"
              onClick={(e) => {
                e.currentTarget.blur();
                onPause();
              }}
              className="w-9 h-9 flex items-center justify-center rounded-lg bg-[#0b101b]/84 border border-white/15 text-slate-200 hover:text-white hover:border-white/35 cursor-pointer"
            >
              <Pause className="w-4 h-4" />
            </button>
          </div>

          <div className="flex flex-col items-end gap-1 max-w-[260px]">
            {killfeed.slice(-3).map((kf) => (
              <div
                key={kf.id}
                className={`text-xs px-2 py-0.5 rounded bg-[#0b101b]/75 text-right truncate max-w-full ${
                  kf.tone === 'kill'
                    ? 'text-rose-300'
                    : kf.tone === 'forge'
                      ? 'text-sky-300'
                      : kf.tone === 'risk'
                        ? 'text-amber-300'
                        : 'text-slate-200'
                }`}
              >
                {kf.text}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* EXACT CENTER CROSSHAIR (0,0) + Thermal Pulse + Hitmarker + Camera Mode Cue */}
      <div className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none flex flex-col items-center">
        <div
          className={`relative w-7 h-7 flex items-center justify-center transition-transform duration-75 ${
            isHot ? 'scale-110' : 'scale-100'
          }`}
        >
          <div className={`w-1 h-1 rounded-full ${crosshairTickClass} shadow-[0_0_2px_#000]`} />
          <div className={`absolute left-0 top-1/2 -translate-y-1/2 w-1.5 h-[1.5px] ${crosshairTickClass}`} />
          <div className={`absolute right-0 top-1/2 -translate-y-1/2 w-1.5 h-[1.5px] ${crosshairTickClass}`} />
          <div className={`absolute top-0 left-1/2 -translate-x-1/2 h-1.5 w-[1.5px] ${crosshairTickClass}`} />
          <div className={`absolute bottom-0 left-1/2 -translate-x-1/2 h-1.5 w-[1.5px] ${crosshairTickClass}`} />

          {hitmarkerActive && (
            <>
              {hitmarkerHeavy && (
                <div className="absolute inset-0 rounded-full border border-amber-300/70 scale-125" />
              )}
              <div className={`absolute ${hitmarkerSlashClass} rotate-45 -translate-x-1.5 -translate-y-1.5`} />
              <div className={`absolute ${hitmarkerSlashClass} -rotate-45 translate-x-1.5 -translate-y-1.5`} />
              <div className={`absolute ${hitmarkerSlashClass} -rotate-45 -translate-x-1.5 translate-y-1.5`} />
              <div className={`absolute ${hitmarkerSlashClass} rotate-45 translate-x-1.5 translate-y-1.5`} />
            </>
          )}
          {damageDirection && (
            <div
              className="absolute left-1/2 top-1/2"
              style={{
                transform: `translate(-50%, -50%) rotate(${(damageDirection.angle * 180) / Math.PI}deg)`,
              }}
            >
              <div className="absolute left-1/2 -translate-x-1/2 -top-[76px] w-0 h-0 border-l-[8px] border-r-[8px] border-b-[16px] border-l-transparent border-r-transparent border-b-rose-500 drop-shadow-[0_0_6px_rgba(244,63,94,0.9)]" />
            </div>
          )}
        </div>
        {localPlayer && activeItem?.kind === 'weapon' && (localPlayer.heat > 5 || isOverheated) && (
          <div className="mt-1.5 flex flex-col items-center gap-0.5">
            <div className="w-14 h-1 rounded bg-slate-900/90 overflow-hidden">
              <div
                className={`h-full transition-all duration-75 ${
                  isOverheated
                    ? 'bg-rose-500 animate-pulse'
                    : localPlayer.heat >= 75
                      ? 'bg-rose-500'
                      : 'bg-amber-400'
                }`}
                style={{ width: `${Math.min(100, localPlayer.heat)}%` }}
              />
            </div>
            {isOverheated && (
              <span className="text-[10px] font-mono-tabular font-bold text-rose-400">
                SUPERAQUECIDO
              </span>
            )}
          </div>
        )}
        {/* HUD de perspectiva removida */}
                {!pointerLocked && (
                  <div className="mt-2 rounded-lg bg-[#0b101b]/85 border border-white/20 px-3 py-1 text-[11px] text-slate-200 whitespace-nowrap shadow-lg">
                    Clique para capturar o mouse · Esc pausa
                  </div>
                )}

                {/* Arsenal Mode: Respawn Countdown Overlay */}
                                {isArsenal && isDead && respawnTimerSec > 0 && (
                                  <div className="fixed inset-0 flex flex-col items-center justify-center pointer-events-none z-20">
                                    <div className="bg-[#0b101b]/95 border border-rose-400/50 rounded-2xl p-8 text-center shadow-2xl max-w-md mx-4">
                                      <div className="text-4xl font-bold text-rose-400 mb-4">Renascendo</div>
                                      <div className="text-6xl font-mono-tabular font-bold text-rose-200 mb-2 animate-pulse">
                                        {respawnTimerSec}
                                      </div>
                                      <div className="text-slate-300 text-sm">Preparando renascimento...</div>
                                      <div className="mt-4 h-2 w-full bg-slate-800 rounded overflow-hidden">
                                        <div
                                          className="h-full bg-rose-400 transition-all duration-300"
                                          style={{ width: `${Math.max(0, 100 - (respawnTimerSec / 3) * 100)}%` }}
                                        />
                                      </div>
                                    </div>
                                  </div>
                                )}
              </div>

      {/* BOTTOM ROW: Loot Cue + Weapon Forge Status + Weapon Telemetry + 4-Slot Hotbar */}
      <div className="flex flex-col items-center gap-2">
        {nearbyZipline && (
          <div className="bg-[#0b101b]/90 border border-sky-400/60 rounded-lg px-3 py-1 text-xs font-medium text-sky-200">
            Pressione <span className="font-mono-tabular font-bold text-white">[E]</span> para usar {nearbyZipline}
          </div>
        )}
        {nearbyLootName && (
          <div className="bg-[#0b101b]/90 border border-amber-400/60 rounded-lg px-3 py-1 text-xs font-medium text-amber-200">
            Pressione <span className="font-mono-tabular font-bold text-white">[E]</span> para pegar {nearbyLootName}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-center gap-2.5">
          {!isArsenal && forgePhase === 'ready' && (
                      <button
                        type="button"
                        tabIndex={-1}
                        data-testid="forge-weapon-btn"
                        onClick={(e) => {
                          e.currentTarget.blur();
                          onOpenWeaponPrompt();
                        }}
                        className="pointer-events-auto flex items-center gap-2 px-3.5 py-1.5 rounded-lg bg-sky-500 hover:bg-sky-400 text-slate-950 font-display font-bold text-xs shadow cursor-pointer whitespace-nowrap animate-pulse"
                      >
                        <Sparkles className="w-3.5 h-3.5" />
                        <span>Forja pronta — Enter para escrever</span>
                      </button>
                    )}

                    {!isArsenal && forgePhase === 'cooling' && (
            <div
              data-testid="weapon-timer"
              className="bg-[#0b101b]/84 border border-sky-400/25 rounded-lg px-3 py-1.5 text-xs text-sky-200 font-mono-tabular flex items-center gap-2"
            >
              <span>Forja em {forgeRemainingSec}s</span>
              <span className="w-12 h-1.5 rounded bg-slate-800 overflow-hidden inline-block">
                <span
                  className="block h-full bg-sky-400 transition-all duration-150"
                  style={{
                    width: `${Math.max(
                      4,
                      Math.min(
                        100,
                        ((WEAPON_CYCLE_COOLDOWN_SEC - forgeRemainingSec) /
                          WEAPON_CYCLE_COOLDOWN_SEC) *
                          100,
                      ),
                    )}%`,
                  }}
                />
              </span>
            </div>
          )}

          {activeItem && activeItem.kind !== 'weapon' && (
            <div className="bg-[#0b101b]/82 border border-white/12 rounded-lg px-3 py-1 text-xs text-slate-300">
              {activeItem.kind === 'shovel'
                ? 'Escava terreno voxel · [G] Descartar'
                : activeItem.kind === 'grapple'
                  ? 'Gancho por massa: puxa mais leve · [G] Descartar'
                  : activeItem.relicId && RELICS[activeItem.relicId]
                    ? `${RELICS[activeItem.relicId].name} · [Clique] Ativar · [G] Descartar`
                    : 'Relíquia · [Clique] Ativar · [G] Descartar'}
            </div>
          )}

          {localPlayer?.relicBuff && (() => {
            const def = RELICS[localPlayer.relicBuff.id];
            const remaining = Math.max(
              0,
              Math.ceil((localPlayer.relicBuff.endsAt - serverNow) / 1000),
            );
            return (
              <div
                className="bg-[#0b101b]/88 border rounded-lg px-3 py-1 text-[11px] text-slate-200 font-mono-tabular flex items-center gap-2"
                style={{ borderColor: `${def?.color ?? '#fbbf24'}66` }}
              >
                <span style={{ color: def?.color ?? '#fbbf24' }}>
                  ◆ {def?.name ?? localPlayer.relicBuff.id}
                </span>
                <span className="text-slate-400">{remaining}s</span>
              </div>
            );
          })()}

          {activeItem?.kind === 'weapon' && activeItem.weapon && (
                      <div className="bg-[#0b101b]/86 border border-white/15 rounded-lg px-3 py-1 text-[11px] text-slate-200 font-mono-tabular flex items-center gap-2.5">
                        <span className="text-amber-300 font-bold">
                          {isArsenal && (activeItem.ammo ?? 0) >= 999999 ? '∞' : `${activeItem.ammo ?? 0}/${activeItem.ammoMax ?? 0}`}
                        </span>
              <span className="w-12 h-1.5 rounded bg-slate-900 overflow-hidden inline-block">
                <span
                  className={`block h-full ${
                    isOverheated
                      ? 'bg-rose-500'
                      : (localPlayer?.heat ?? 0) >= 75
                        ? 'bg-rose-400'
                        : 'bg-amber-400'
                  }`}
                  style={{ width: `${Math.min(100, localPlayer?.heat ?? 0)}%` }}
                />
              </span>
              <span className="text-sky-300 font-bold">{activeItem.weapon.budgetUsed}/100 pts</span>
              <span>DMG {activeItem.weapon.stats.damage}×{activeItem.weapon.stats.projectiles}</span>
              <span>{BEHAVIOR_LABELS[activeItem.weapon.modifiers.projectileBehavior] ?? 'Balístico'}</span>
              {activeItem.weapon.modifiers.statusEffect !== 'none' && (
                <span className="text-amber-300">
                  {EFFECT_LABELS[activeItem.weapon.modifiers.statusEffect]}
                </span>
              )}
              {activeItem.weapon.selfRisk.length > 0 && (
                <span className="text-rose-400">
                  {activeItem.weapon.selfRisk.map((r) => RISK_LABELS[r] ?? r).join(' · ')}
                </span>
              )}
              <span className="text-slate-400">[G] Descartar</span>
              {activeItem.weapon.catalogId && (
                <span className="ml-1 flex items-center gap-1 border-l border-white/10 pl-2">
                  {feedback[activeItem.weapon.catalogId] ? (
                    <span className="text-emerald-300">Obrigado!</span>
                  ) : (
                    <>
                      <button
                        type="button"
                        tabIndex={-1}
                        aria-label="Gostei desta arma"
                        onClick={(e) => {
                          e.currentTarget.blur();
                          onFeedback(activeItem.weapon!.catalogId!, 1, 'weapon');
                          setFeedback((prev) => ({
                            ...prev,
                            [activeItem.weapon!.catalogId!]: 1,
                          }));
                        }}
                        className="pointer-events-auto text-slate-300 hover:text-emerald-300 cursor-pointer"
                      >
                        <ThumbsUp className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        tabIndex={-1}
                        aria-label="Não gostei desta arma"
                        onClick={(e) => {
                          e.currentTarget.blur();
                          onFeedback(activeItem.weapon!.catalogId!, -1, 'weapon');
                          setFeedback((prev) => ({
                            ...prev,
                            [activeItem.weapon!.catalogId!]: -1,
                          }));
                        }}
                        className="pointer-events-auto text-slate-300 hover:text-rose-300 cursor-pointer"
                      >
                        <ThumbsDown className="w-3.5 h-3.5" />
                      </button>
                    </>
                  )}
                </span>
              )}
            </div>
          )}
        </div>

        {/* 4-Slot Inventory Bar */}
        <div
          className="grid grid-cols-4 gap-2 pointer-events-auto"
          data-testid="hotbar"
        >
          {[0, 1, 2, 3].map((idx) => {
            const item = localPlayer?.slots[idx] ?? null;
            const isSelected = (localPlayer?.activeSlot ?? 0) === idx;
            return (
              <button
                key={idx}
                type="button"
                tabIndex={-1}
                onClick={(e) => {
                  e.currentTarget.blur();
                  onSelectSlot(idx);
                }}
                className={`w-28 md:w-36 px-2.5 py-2 rounded-lg border text-left transition-colors cursor-pointer ${
                  isSelected
                    ? 'bg-[#172238]/95 border-amber-400 text-white'
                    : 'bg-[#0b101b]/84 border-white/15 text-slate-300 hover:border-white/30'
                }`}
              >
                <div className="flex items-center justify-between gap-1 mb-1">
                  <span className="font-mono-tabular text-[11px] font-bold text-slate-400">
                    [{idx + 1}]
                  </span>
                  {item ? (
                                      <span className="font-mono-tabular text-[11px] text-amber-300">
                                        {item.kind === 'weapon'
                                          ? isArsenal && (item.ammo ?? 0) >= 999999
                                            ? '∞'
                                            : `${item.ammo ?? 0}/${item.ammoMax ?? 0}`
                                          : `${item.massKg}kg`}
                                      </span>
                                    ) : (
                    <span className="text-[11px] text-slate-600">Vazio</span>
                  )}
                </div>
                <div className="flex items-center gap-1.5 min-h-[20px]">
                  {renderSlotIcon(item)}
                  <span className="text-xs font-medium truncate">
                    {item ? item.name : '—'}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Bottom-Right: Compact Tactical Island Radar */}
      {localPlayer && islandSizeMeters > 0 && (
        <div
          aria-hidden="true"
          className="hidden sm:flex fixed bottom-4 right-4 md:bottom-5 md:right-5 flex-col items-center gap-1 bg-[#0b101b]/84 border border-white/15 rounded-xl p-2 pointer-events-none"
        >
          <svg width="88" height="88" viewBox="0 0 88 88" className="block">
            <circle cx="44" cy="44" r="41" fill="#071324" stroke="rgba(255,255,255,0.12)" strokeWidth="1" />
            <circle cx="44" cy="44" r="34" fill="#132b24" stroke="rgba(74,222,128,0.28)" strokeWidth="1" />
            {/* Central crystal shrine landmark (oculto no Arsenal) */}
            {!isArsenal && (
              <polygon points="44,40 47.5,44 44,48 40.5,44" fill="#38bdf8" opacity="0.85" />
            )}

            {/* Loot drops */}
            {lootDrops.map((d) => {
              const rx = (d.position.x / islandSizeMeters) * 80 + 4;
              const rz = 84 - (d.position.z / islandSizeMeters) * 80;
              return <circle key={d.id} cx={rx} cy={rz} r="2" fill="#fbbf24" />;
            })}

            {/* Entities (supply crates & creatures) */}
            {entities.map((ent) => {
              const rx = (ent.position.x / islandSizeMeters) * 80 + 4;
              const rz = 84 - (ent.position.z / islandSizeMeters) * 80;
              return ent.kind === 'supply_crate' ? (
                <rect key={ent.id} x={rx - 2.2} y={rz - 2.2} width="4.4" height="4.4" fill="#22d3ee" />
              ) : (
                <circle key={ent.id} cx={rx} cy={rz} r="2.2" fill="#f97316" />
              );
            })}

            {/* Other combatants */}
            {allPlayers.map((p) => {
              if (!p.alive || p.id === localPlayer.id) return null;
              const rx = (p.position.x / islandSizeMeters) * 80 + 4;
              const rz = 84 - (p.position.z / islandSizeMeters) * 80;
              let fill = '#fb7185'; // inimigo (padrão)
              if (isArsenal && arsenalTeams && localPlayer.team && p.team === localPlayer.team) {
                fill = p.team === 'blue' ? '#3b82f6' : '#f97316';
              }
              return <circle key={p.id} cx={rx} cy={rz} r="2.6" fill={fill} />;
            })}

            {/* Local player heading indicator */}
            {(() => {
              const px = (localPlayer.position.x / islandSizeMeters) * 80 + 4;
              const pz = 84 - (localPlayer.position.z / islandSizeMeters) * 80;
              const deg = (localPlayer.yaw * 180) / Math.PI;
              return (
                <g transform={`translate(${px}, ${pz}) rotate(${deg})`}>
                  <polygon points="0,-5 3.6,3.5 0,1.5 -3.6,3.5" fill="#ffffff" />
                </g>
              );
            })()}
          </svg>
          <span className="font-mono-tabular text-[10px] text-slate-400">
            Ilha {Math.round(islandSizeMeters)}×{Math.round(islandSizeMeters)}m
          </span>
        </div>
      )}

      {devEnabled && perfStats && (
        <div className="fixed left-4 bottom-4 z-20 pointer-events-none rounded-md bg-black/55 px-2 py-1 font-mono-tabular text-[10px] leading-tight text-lime-300/90">
          {perfStats.fps.toFixed(0)} quadros/s · {perfStats.frameMs.toFixed(1)} ms ·{' '}
          {perfStats.chunks} chunks · {perfStats.activeMeshes} malhas ·{' '}
          {perfStats.vertices} vért.
        </div>
      )}

      {showStats && (
        <div
          className={`fixed left-4 z-20 pointer-events-none rounded-md bg-black/55 px-2 py-1 font-mono-tabular text-[10px] leading-tight text-lime-300/90 ${
            devEnabled && perfStats ? 'bottom-[42px]' : 'bottom-4'
          }`}
        >
          {perfStats ? Math.round(perfStats.fps) : '--'} FPS ·{' '}
          {pingMs === null ? '--' : Math.round(pingMs)} ms ·{' '}
          {QUALITY_LABELS[qualityLevel]}
        </div>
      )}

      {damageNumbers.map((num) => (
              <div
                key={num.id}
                className="fixed pw-damage-float z-30 pointer-events-none font-display font-bold text-lg text-rose-300 drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]"
                style={{ left: num.x, top: num.y }}
              >
                -{num.amount}
              </div>
            ))}

            {showScoreboard && isArsenal && (
              <Scoreboard players={allPlayers} localPlayerId={localPlayer?.id ?? null} gameMode={gameMode} arsenalTeams={arsenalTeams ?? false} />
            )}
          </div>
        );
      };
