import React, { useMemo, useState } from 'react';
import {
  Bot,
  Crosshair,
  FastForward,
  Flame,
  HeartPulse,
  Infinity as InfinityIcon,
  PauseCircle,
  PlayCircle,
  RefreshCw,
  RotateCcw,
  Search,
  Shield,
  Skull,
  Sparkles,
  Target,
  Trash2,
  UserPlus,
  Wrench,
  X,
  Zap,
} from 'lucide-react';
import { DEV_EVENT_PRESETS, DEV_WEAPON_PRESETS } from '../shared/devMode.ts';
import type {
  DevActionPayload,
  DevCatalogPayload,
  DevRoomState,
  PlayerNetState,
} from '../shared/types.ts';

interface DevPanelProps {
  devState: DevRoomState;
  devCatalog: DevCatalogPayload | null;
  localPlayer: PlayerNetState | null;
  allPlayers: PlayerNetState[];
  activeEventsCount: number;
  entitiesCount: number;
  onAction: (payload: DevActionPayload) => void;
  onRequestCatalog: () => void;
  onClose: () => void;
}

type CatalogKind = 'weapon' | 'event';

export const DevPanel: React.FC<DevPanelProps> = ({
  devState,
  devCatalog,
  localPlayer,
  allPlayers,
  activeEventsCount,
  entitiesCount,
  onAction,
  onRequestCatalog,
  onClose,
}) => {
  const [weaponPrompt, setWeaponPrompt] = useState('');
  const [eventPrompt, setEventPrompt] = useState('');
  const [catalogKind, setCatalogKind] = useState<CatalogKind>('weapon');
  const [catalogQuery, setCatalogQuery] = useState('');

  const aliveBots = allPlayers.filter((p) => p.isBot && p.alive).length;
  const totalBots = allPlayers.filter((p) => p.isBot).length;

  const catalogEntries = useMemo(() => {
    if (!devCatalog) return [];
    const query = catalogQuery.trim().toLowerCase();
    const source = catalogKind === 'weapon' ? devCatalog.weapons : devCatalog.events;
    return source
      .filter((item) => item.status !== 'deprecated')
      .filter((item) => {
        if (!query) return true;
        return (
          item.id.toLowerCase().includes(query) ||
          item.name.toLowerCase().includes(query) ||
          item.aliases.some((alias) => alias.toLowerCase().includes(query)) ||
          item.tags.some((tag) => tag.toLowerCase().includes(query))
        );
      })
      .slice(0, 60);
  }, [devCatalog, catalogKind, catalogQuery]);

  const fire = (payload: DevActionPayload, e?: React.MouseEvent<HTMLButtonElement>) => {
    e?.currentTarget.blur();
    onAction(payload);
  };

  return (
    <aside
      data-testid="dev-panel"
      aria-label="Painel de Modo Desenvolvimento"
      className="fixed top-16 right-4 z-30 w-96 max-w-[calc(100vw-2rem)] max-h-[calc(100vh-8.5rem)] overflow-y-auto pointer-events-auto rounded-xl bg-[#0b101b]/95 border border-amber-400/40 shadow-2xl p-3.5 space-y-3 text-xs text-slate-200"
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-2 pb-2 border-b border-white/10">
        <div className="flex items-center gap-1.5">
          <Wrench className="w-3.5 h-3.5 text-amber-400" />
          <span className="font-display font-bold text-sm text-amber-300">
            Modo Dev
          </span>
          <span className="px-1.5 py-0.5 rounded bg-amber-500/15 border border-amber-400/30 font-mono-tabular text-[10px] text-amber-200">
            F8
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Fechar painel dev"
          className="w-7 h-7 flex items-center justify-center rounded-md bg-[#141c2e] hover:bg-slate-800 border border-white/10 text-slate-300 cursor-pointer"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Live telemetry */}
      <div className="grid grid-cols-3 gap-1.5 p-2 rounded-lg bg-[#141c2e]/85 border border-white/10 font-mono-tabular text-[11px]">
        <div>
          <span className="block text-[10px] text-slate-400">Posição</span>
          <span className="text-white">
            {localPlayer
              ? `${Math.round(localPlayer.position.x)}, ${Math.round(localPlayer.position.y)}, ${Math.round(localPlayer.position.z)}`
              : '—'}
          </span>
        </div>
        <div>
          <span className="block text-[10px] text-slate-400">Bots Vivos</span>
          <span className="text-sky-300">
            {aliveBots}/{totalBots}
          </span>
        </div>
        <div>
          <span className="block text-[10px] text-slate-400">Ev / Ent</span>
          <span className="text-amber-300">
            {activeEventsCount} / {entitiesCount}
          </span>
        </div>
      </div>

      {/* Core Sandbox Toggles */}
      <div className="space-y-1.5">
        <span className="block text-[11px] font-semibold uppercase tracking-wider text-slate-400">
          Regras de Teste
        </span>
        <div className="grid grid-cols-1 gap-1.5">
          <button
            type="button"
            data-testid="dev-toggle-god"
            onClick={(e) => fire({ action: 'toggle_god_mode' }, e)}
            className={`flex items-center justify-between px-2.5 h-8 rounded-lg border font-medium cursor-pointer transition-colors ${
              devState.godMode
                ? 'bg-emerald-500/20 border-emerald-400 text-emerald-200'
                : 'bg-[#141c2e] border-white/10 text-slate-300 hover:border-white/25'
            }`}
          >
            <span className="flex items-center gap-1.5">
              <Shield className="w-3.5 h-3.5" />
              Modo Deus (Invencível)
            </span>
            <span className="font-mono-tabular text-[10px] font-bold">
              {devState.godMode ? 'ON' : 'OFF'}
            </span>
          </button>

          <button
            type="button"
            data-testid="dev-toggle-sandbox"
            onClick={(e) => fire({ action: 'toggle_infinite_sandbox' }, e)}
            className={`flex items-center justify-between px-2.5 h-8 rounded-lg border font-medium cursor-pointer transition-colors ${
              devState.infiniteSandbox
                ? 'bg-sky-500/20 border-sky-400 text-sky-200'
                : 'bg-[#141c2e] border-white/10 text-slate-300 hover:border-white/25'
            }`}
          >
            <span className="flex items-center gap-1.5">
              <InfinityIcon className="w-3.5 h-3.5" />
              Munição &amp; Forja Infinita
            </span>
            <span className="font-mono-tabular text-[10px] font-bold">
              {devState.infiniteSandbox ? 'ON' : 'OFF'}
            </span>
          </button>

          <button
            type="button"
            data-testid="dev-toggle-freeze-bots"
            onClick={(e) => fire({ action: 'toggle_freeze_bots' }, e)}
            className={`flex items-center justify-between px-2.5 h-8 rounded-lg border font-medium cursor-pointer transition-colors ${
              devState.botsFrozen
                ? 'bg-amber-500/20 border-amber-400 text-amber-200'
                : 'bg-[#141c2e] border-white/10 text-slate-300 hover:border-white/25'
            }`}
          >
            <span className="flex items-center gap-1.5">
              <Bot className="w-3.5 h-3.5" />
              Congelar IA dos Bots
            </span>
            <span className="font-mono-tabular text-[10px] font-bold">
              {devState.botsFrozen ? 'ON' : 'OFF'}
            </span>
          </button>

          <button
            type="button"
            data-testid="dev-toggle-auto-events"
            onClick={(e) => fire({ action: 'toggle_auto_events' }, e)}
            className={`flex items-center justify-between px-2.5 h-8 rounded-lg border font-medium cursor-pointer transition-colors ${
              devState.autoEventsPaused
                ? 'bg-fuchsia-500/20 border-fuchsia-400 text-fuchsia-200'
                : 'bg-[#141c2e] border-white/10 text-slate-300 hover:border-white/25'
            }`}
          >
            <span className="flex items-center gap-1.5">
              {devState.autoEventsPaused ? (
                <PauseCircle className="w-3.5 h-3.5" />
              ) : (
                <PlayCircle className="w-3.5 h-3.5" />
              )}
              Eventos Automáticos
            </span>
            <span className="font-mono-tabular text-[10px] font-bold">
              {devState.autoEventsPaused ? 'PAUSADO' : 'ATIVO'}
            </span>
          </button>

          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              data-testid="dev-spawn-dummy"
              onClick={(e) => fire({ action: 'spawn_dummy' }, e)}
              className="flex items-center justify-center gap-1.5 h-8 px-2 rounded-lg bg-[#141c2e] hover:bg-slate-800 border border-white/12 text-slate-200 font-medium cursor-pointer"
            >
              <Target className="w-3.5 h-3.5" />
              <span>Alvo à Frente</span>
            </button>
            <button
              type="button"
              data-testid="dev-damage-player"
              onClick={(e) => fire({ action: 'damage_player', amount: 25 }, e)}
              className="flex items-center justify-center gap-1.5 h-8 px-2 rounded-lg bg-[#141c2e] hover:bg-rose-500/20 border border-white/12 text-rose-300 font-medium cursor-pointer"
            >
              <HeartPulse className="w-3.5 h-3.5" />
              <span>Levar 25 Dano</span>
            </button>
          </div>
        </div>
      </div>

      {/* Player & Arsenal */}
      <div className="space-y-2 pt-1 border-t border-white/10">
        <span className="block text-[11px] font-semibold uppercase tracking-wider text-slate-400">
          Jogador &amp; Arsenal
        </span>
        <div className="grid grid-cols-2 gap-1.5">
          <button
            type="button"
            data-testid="dev-unlock-forge"
            onClick={(e) => fire({ action: 'unlock_forge' }, e)}
            className="flex items-center justify-center gap-1.5 h-8 px-2 rounded-lg bg-[#141c2e] hover:bg-sky-500/20 border border-sky-400/35 text-sky-200 font-semibold cursor-pointer"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Liberar Forja</span>
          </button>
          <button
            type="button"
            data-testid="dev-refill-player"
            onClick={(e) => fire({ action: 'refill_player' }, e)}
            className="flex items-center justify-center gap-1.5 h-8 px-2 rounded-lg bg-[#141c2e] hover:bg-emerald-500/20 border border-emerald-400/35 text-emerald-200 font-semibold cursor-pointer"
          >
            <HeartPulse className="w-3.5 h-3.5" />
            <span>Curar/Munição</span>
          </button>
          <button
            type="button"
            onClick={(e) => fire({ action: 'teleport_center' }, e)}
            className="col-span-2 flex items-center justify-center gap-1.5 h-8 px-2 rounded-lg bg-[#141c2e] hover:bg-slate-800 border border-white/12 text-slate-200 font-medium cursor-pointer"
          >
            <Crosshair className="w-3.5 h-3.5" />
            <span>Teleportar para Centro da Ilha</span>
          </button>
        </div>

        <div className="flex flex-wrap gap-1">
          {DEV_WEAPON_PRESETS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              onClick={(e) => fire({ action: 'quick_forge', prompt: preset.prompt }, e)}
              className="px-2 py-1 rounded bg-[#141c2e] hover:bg-sky-500/20 border border-white/12 text-[11px] text-sky-200 cursor-pointer"
            >
              + {preset.label}
            </button>
          ))}
        </div>

        <form
          className="flex gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            if (!weaponPrompt.trim()) return;
            onAction({ action: 'quick_forge', prompt: weaponPrompt.trim() });
            setWeaponPrompt('');
          }}
        >
          <input
            type="text"
            value={weaponPrompt}
            onChange={(e) => setWeaponPrompt(e.target.value)}
            placeholder="Forjar arma instantânea..."
            aria-label="Prompt rápido de arma dev"
            className="flex-1 min-w-0 h-8 px-2.5 rounded bg-[#141c2e] border border-white/15 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-sky-400"
          />
          <button
            type="submit"
            className="h-8 px-2.5 rounded bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold text-xs cursor-pointer"
          >
            Forjar
          </button>
        </form>
      </div>

      {/* Catalog picker */}
      <div className="space-y-2 pt-1 border-t border-white/10">
        <div className="flex items-center justify-between">
          <span className="block text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            Catálogo Exato
          </span>
          <div className="flex items-center gap-1">
            <span className="font-mono-tabular text-[10px] text-slate-500">
              {devState.catalogVersion || devCatalog?.catalogVersion || '—'}
            </span>
            <button
              type="button"
              data-testid="dev-refresh-catalog"
              onClick={onRequestCatalog}
              aria-label="Recarregar catálogo dev"
              className="w-6 h-6 flex items-center justify-center rounded bg-[#141c2e] hover:bg-slate-800 border border-white/10 text-slate-300 cursor-pointer"
            >
              <RefreshCw className="w-3 h-3" />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-1.5">
          <button
            type="button"
            onClick={(e) => {
              e.currentTarget.blur();
              setCatalogKind('weapon');
            }}
            className={`h-7 rounded-md border text-[11px] font-semibold cursor-pointer ${
              catalogKind === 'weapon'
                ? 'bg-sky-500/20 border-sky-400 text-sky-200'
                : 'bg-[#141c2e] border-white/10 text-slate-400 hover:border-white/25'
            }`}
          >
            Armas ({devCatalog?.weapons.length ?? 0})
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.currentTarget.blur();
              setCatalogKind('event');
            }}
            className={`h-7 rounded-md border text-[11px] font-semibold cursor-pointer ${
              catalogKind === 'event'
                ? 'bg-amber-500/20 border-amber-400 text-amber-200'
                : 'bg-[#141c2e] border-white/10 text-slate-400 hover:border-white/25'
            }`}
          >
            Eventos ({devCatalog?.events.length ?? 0})
          </button>
        </div>

        <label className="flex items-center gap-1.5 h-8 px-2 rounded bg-[#141c2e] border border-white/15 focus-within:border-amber-400">
          <Search className="w-3.5 h-3.5 text-slate-500" />
          <input
            type="text"
            value={catalogQuery}
            onChange={(e) => setCatalogQuery(e.target.value)}
            placeholder={catalogKind === 'weapon' ? 'Buscar arma (nome, id, tag)...' : 'Buscar evento (nome, id, tag)...'}
            aria-label="Buscar item do catálogo"
            className="flex-1 min-w-0 bg-transparent text-xs text-white placeholder:text-slate-500 focus:outline-none"
          />
        </label>

        <div
          data-testid="dev-catalog-list"
          className="max-h-48 overflow-y-auto rounded-lg border border-white/10 divide-y divide-white/5 bg-[#0f1626]"
        >
          {!devCatalog && (
            <p className="px-2 py-3 text-[11px] text-slate-500">
              {devState.enabled ? 'Carregando catálogo...' : 'Catálogo indisponível.'}
            </p>
          )}
          {devCatalog && catalogEntries.length === 0 && (
            <p className="px-2 py-3 text-[11px] text-slate-500">
              Nenhum item encontrado para “{catalogQuery}”.
            </p>
          )}
          {catalogEntries.map((item) => (
            <div key={item.id} className="flex items-stretch">
              <button
                type="button"
                data-testid={`dev-catalog-${item.id}`}
                title={`${item.id} · ${item.aliases.join(' / ')}`}
                onClick={(e) =>
                  fire(
                    catalogKind === 'weapon'
                      ? { action: 'spawn_catalog_weapon', itemId: item.id }
                      : { action: 'spawn_catalog_event', itemId: item.id },
                    e,
                  )
                }
                className={`flex-1 min-w-0 text-left px-2 py-1.5 cursor-pointer transition-colors ${
                  catalogKind === 'weapon'
                    ? 'hover:bg-sky-500/15'
                    : 'hover:bg-amber-500/15'
                }`}
              >
                <span className="block truncate text-[11px] text-slate-100">
                  {item.name}
                </span>
                <span className="block truncate font-mono-tabular text-[10px] text-slate-500">
                  {item.aliases[0] ?? item.id} · {item.budgetUsed} pts
                </span>
              </button>
              {catalogKind === 'weapon' && (
                <button
                  type="button"
                  title="Equipar no primeiro bot vivo"
                  aria-label={`Equipar ${item.name} em um bot`}
                  onClick={(e) => fire({ action: 'equip_bot_weapon', itemId: item.id }, e)}
                  className="w-8 shrink-0 flex items-center justify-center border-l border-white/10 text-slate-400 hover:text-sky-300 hover:bg-sky-500/15 cursor-pointer"
                >
                  <Bot className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>
        <p className="text-[10px] leading-snug text-slate-500">
          Clique para equipar/disparar o item exato. Nos eventos, o impacto chega em
          1 s; use “Eventos Automáticos” para isolar o teste.
        </p>
      </div>

      {/* Events & Arena */}
      <div className="space-y-2 pt-1 border-t border-white/10">
        <span className="block text-[11px] font-semibold uppercase tracking-wider text-slate-400">
          Eventos &amp; Arena
        </span>
        <div className="grid grid-cols-2 gap-1.5">
          <button
            type="button"
            onClick={(e) => fire({ action: 'win_event_raffle' }, e)}
            className="flex items-center justify-center gap-1.5 h-8 px-2 rounded-lg bg-[#141c2e] hover:bg-amber-500/20 border border-amber-400/35 text-amber-200 font-semibold cursor-pointer"
          >
            <Zap className="w-3.5 h-3.5" />
            <span>Ganhar Sorteio</span>
          </button>
          <button
            type="button"
            data-testid="dev-skip-event-cooldown"
            onClick={(e) => fire({ action: 'skip_event_cooldown' }, e)}
            className="flex items-center justify-center gap-1.5 h-8 px-2 rounded-lg bg-[#141c2e] hover:bg-amber-500/20 border border-white/12 text-amber-200 font-medium cursor-pointer"
          >
            <FastForward className="w-3.5 h-3.5" />
            <span>Pular Espera</span>
          </button>
          <button
            type="button"
            onClick={(e) => fire({ action: 'clear_events' }, e)}
            className="col-span-2 flex items-center justify-center gap-1.5 h-8 px-2 rounded-lg bg-[#141c2e] hover:bg-rose-500/20 border border-white/12 text-slate-200 font-medium cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Limpar Arena (eventos, entidades, projéteis)</span>
          </button>
        </div>

        <div className="flex flex-wrap gap-1">
          {DEV_EVENT_PRESETS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              onClick={(e) => fire({ action: 'trigger_event', prompt: preset.prompt }, e)}
              className="px-2 py-1 rounded bg-[#141c2e] hover:bg-amber-500/20 border border-white/12 text-[11px] text-amber-200 cursor-pointer"
            >
              <Flame className="w-2.5 h-2.5 inline mr-1" />
              {preset.label}
            </button>
          ))}
        </div>

        <form
          className="flex gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            if (!eventPrompt.trim()) return;
            onAction({ action: 'trigger_event', prompt: eventPrompt.trim() });
            setEventPrompt('');
          }}
        >
          <input
            type="text"
            value={eventPrompt}
            onChange={(e) => setEventPrompt(e.target.value)}
            placeholder="Disparar evento instantâneo..."
            aria-label="Prompt rápido de evento dev"
            className="flex-1 min-w-0 h-8 px-2.5 rounded bg-[#141c2e] border border-white/15 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-amber-400"
          />
          <button
            type="submit"
            className="h-8 px-2.5 rounded bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs cursor-pointer"
          >
            Disparar
          </button>
        </form>
      </div>

      {/* Bots & Match Control */}
      <div className="space-y-1.5 pt-1 border-t border-white/10">
        <span className="block text-[11px] font-semibold uppercase tracking-wider text-slate-400">
          Bots &amp; Partida
        </span>
        <div className="grid grid-cols-3 gap-1.5">
          <button
            type="button"
            data-testid="dev-spawn-bot"
            onClick={(e) => fire({ action: 'spawn_bot' }, e)}
            className="flex items-center justify-center gap-1 h-8 px-2 rounded-lg bg-[#141c2e] hover:bg-slate-800 border border-white/12 text-slate-200 font-medium cursor-pointer"
          >
            <UserPlus className="w-3.5 h-3.5" />
            <span>+1 Bot</span>
          </button>
          <button
            type="button"
            data-testid="dev-kill-bots"
            onClick={(e) => fire({ action: 'kill_bots' }, e)}
            className="flex items-center justify-center gap-1 h-8 px-2 rounded-lg bg-[#141c2e] hover:bg-rose-500/20 border border-rose-400/35 text-rose-300 font-semibold cursor-pointer"
          >
            <Skull className="w-3.5 h-3.5" />
            <span>Fim Bots</span>
          </button>
          <button
            type="button"
            onClick={(e) => fire({ action: 'force_restart' }, e)}
            className="flex items-center justify-center gap-1 h-8 px-2 rounded-lg bg-[#141c2e] hover:bg-slate-800 border border-white/12 text-slate-200 font-medium cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Reiniciar</span>
          </button>
        </div>
      </div>
    </aside>
  );
};
