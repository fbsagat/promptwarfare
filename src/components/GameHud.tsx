import React, { useEffect, useState } from 'react';
import {
  Volume2,
  VolumeX,
  Pause,
  Sparkles,
  AlertTriangle,
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
} from '../shared/types.ts';

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
  damageFlash: boolean;
  hitmarkerActive: boolean;
  aimContext: 'neutral' | 'dig' | 'grapple' | 'enemy';
  nearbyLootName: string | null;
  devEnabled?: boolean;
  devPanelOpen?: boolean;
  onToggleDevPanel?: () => void;
  onToggleMute: () => void;
  onPause: () => void;
  onSelectSlot: (slot: number) => void;
  onOpenWeaponPrompt: () => void;
  onOpenEventPrompt: () => void;
  onFeedback: (itemId: string, rating: 1 | -1, kind?: 'weapon' | 'event') => void;
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
  damageFlash,
  hitmarkerActive,
  aimContext,
  nearbyLootName,
  devEnabled,
  devPanelOpen,
  onToggleDevPanel,
  onToggleMute,
  onPause,
  onSelectSlot,
  onOpenWeaponPrompt,
  onOpenEventPrompt,
  onFeedback,
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
          {isRaffled ? (
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
          ) : (
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
          )}

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
              <div className="absolute w-3 h-[1.5px] bg-rose-400 rotate-45 -translate-x-1.5 -translate-y-1.5" />
              <div className="absolute w-3 h-[1.5px] bg-rose-400 -rotate-45 translate-x-1.5 -translate-y-1.5" />
              <div className="absolute w-3 h-[1.5px] bg-rose-400 -rotate-45 -translate-x-1.5 translate-y-1.5" />
              <div className="absolute w-3 h-[1.5px] bg-rose-400 rotate-45 translate-x-1.5 translate-y-1.5" />
            </>
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
        <span className="mt-1.5 text-[10px] font-mono-tabular text-white/75 drop-shadow">
          {zoomMeters < 0.3 ? '1P' : `3P · ${zoomMeters.toFixed(1)}m`}
        </span>
      </div>

      {/* BOTTOM ROW: Loot Cue + Weapon Forge Status + Weapon Telemetry + 4-Slot Hotbar */}
      <div className="flex flex-col items-center gap-2">
        {nearbyLootName && (
          <div className="bg-[#0b101b]/90 border border-amber-400/60 rounded-lg px-3 py-1 text-xs font-medium text-amber-200">
            Pressione <span className="font-mono-tabular font-bold text-white">[E]</span> para pegar {nearbyLootName}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-center gap-2.5">
          {forgePhase === 'ready' && (
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

          {forgePhase === 'cooling' && (
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
                : 'Gancho por massa: puxa mais leve · [G] Descartar'}
            </div>
          )}

          {activeItem?.kind === 'weapon' && activeItem.weapon && (
            <div className="bg-[#0b101b]/86 border border-white/15 rounded-lg px-3 py-1 text-[11px] text-slate-200 font-mono-tabular flex items-center gap-2.5">
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
                        ? `${item.ammo ?? 0}/${item.ammoMax ?? 0}`
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
            {/* Central crystal shrine landmark */}
            <polygon points="44,40 47.5,44 44,48 40.5,44" fill="#38bdf8" opacity="0.85" />

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

            {/* Enemy combatants */}
            {allPlayers.map((p) => {
              if (!p.alive || p.id === localPlayer.id) return null;
              const rx = (p.position.x / islandSizeMeters) * 80 + 4;
              const rz = 84 - (p.position.z / islandSizeMeters) * 80;
              return <circle key={p.id} cx={rx} cy={rz} r="2.6" fill="#fb7185" />;
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
    </div>
  );
};
