import React, { useMemo, useState } from 'react';
import {
  Crown,
  Dices,
  Lock,
  LockOpen,
  PlusCircle,
  RefreshCw,
  Search,
  ShieldBan,
  Users,
  Zap,
} from 'lucide-react';
import type { RoomAccessMode, RoomPublicSummary } from '../shared/types.ts';

interface LobbyOverlayProps {
  playerName: string;
  onPlayerNameChange: (v: string) => void;
  initialRoomCode: string;
  rooms: RoomPublicSummary[];
  loadingRooms: boolean;
  onRefreshRooms: () => void;
  onCreateRoom: (opts: {
    roomName: string;
    roomId: string;
    accessMode: RoomAccessMode;
    password: string;
    targetPlayers: number;
    fillWithBots: boolean;
  }) => void;
  onJoinRoom: (opts: { roomId: string; password?: string }) => void;
  onQuickPlay: () => void;
  connecting: boolean;
  errorMessage: string | null;
  errorCode: string | null;
  errorRoomId: string | null;
}

type DiscoveryFilter = 'all' | 'open' | 'password' | 'lobby';

function randomRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 6; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

export const LobbyOverlay: React.FC<LobbyOverlayProps> = ({
  playerName,
  onPlayerNameChange,
  initialRoomCode,
  rooms,
  loadingRooms,
  onRefreshRooms,
  onCreateRoom,
  onJoinRoom,
  onQuickPlay,
  connecting,
  errorMessage,
  errorCode,
  errorRoomId,
}) => {
  const [activeTab, setActiveTab] = useState<'discover' | 'create'>('discover');

  // Discovery tab state
  const [searchQuery, setSearchQuery] = useState('');
  const [filter, setFilter] = useState<DiscoveryFilter>('all');
  const [directCode, setDirectCode] = useState(initialRoomCode);
  const [directPassword, setDirectPassword] = useState('');
  const [showDirectPassword, setShowDirectPassword] = useState(false);
  const [selectedLockedRoomId, setSelectedLockedRoomId] = useState<string | null>(null);
  const [cardPassword, setCardPassword] = useState('');

  // Create room tab state
  const [roomName, setRoomName] = useState('');
  const [roomId, setRoomId] = useState(() => randomRoomCode());
  const [accessMode, setAccessMode] = useState<RoomAccessMode>('open');
  const [createPassword, setCreatePassword] = useState('');
  const [targetPlayers, setTargetPlayers] = useState(6);
  const [fillWithBots, setFillWithBots] = useState(true);
  const [localValidationError, setLocalValidationError] = useState<string | null>(null);

  const needsDirectPassword =
    showDirectPassword ||
    ((errorCode === 'PASSWORD_REQUIRED' || errorCode === 'INVALID_PASSWORD') &&
      errorRoomId === directCode.trim().toUpperCase() &&
      selectedLockedRoomId !== errorRoomId);

  const filteredRooms = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return rooms.filter((r) => {
      if (filter === 'open' && r.hasPassword) return false;
      if (filter === 'password' && !r.hasPassword) return false;
      if (filter === 'lobby' && r.phase !== 'lobby') return false;
      if (!q) return true;
      return (
        r.name.toLowerCase().includes(q) ||
        r.id.toLowerCase().includes(q) ||
        r.hostName.toLowerCase().includes(q)
      );
    });
  }, [filter, rooms, searchQuery]);

  const displayedError = localValidationError || errorMessage;

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setLocalValidationError(null);
    if (accessMode === 'password' && !createPassword.trim()) {
      setLocalValidationError('Defina uma senha para salas protegidas.');
      return;
    }
    onCreateRoom({
      roomName: roomName.trim(),
      roomId: roomId.trim().toUpperCase(),
      accessMode,
      password: createPassword.trim(),
      targetPlayers,
      fillWithBots,
    });
  };

  const handleDirectJoinSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setLocalValidationError(null);
    const code = directCode.trim().toUpperCase();
    if (!code) {
      setLocalValidationError('Digite o código da sala para entrar.');
      return;
    }
    onJoinRoom({
      roomId: code,
      password: directPassword.trim() || undefined,
    });
  };

  return (
    <div className="fixed inset-0 z-20 flex flex-col justify-between p-4 sm:p-8 md:p-10 pointer-events-none">
      {/* Left-side Lobby Panel keeping right 60% viewport open to the 3D voxel island */}
      <div className="my-auto w-full max-w-lg pointer-events-auto bg-[#0b101b]/92 border border-white/15 rounded-xl p-5 md:p-6 shadow-2xl max-h-[88vh] flex flex-col">
        {/* Brand Header */}
        <div className="mb-4">
          <div className="flex items-center justify-between gap-3 mb-1.5">
            <div className="flex items-center gap-2.5">
              <svg
                width="32"
                height="32"
                viewBox="0 0 36 36"
                fill="none"
                aria-hidden="true"
                className="shrink-0"
              >
                <polygon points="18,2 33,10 18,18 3,10" fill="#38bdf8" />
                <polygon points="3,10 18,18 18,34 3,26" fill="#0284c7" />
                <polygon points="33,10 18,18 18,34 33,26" fill="#0369a1" />
                <rect x="14" y="8" width="8" height="4" fill="#f59e0b" />
              </svg>
              <h1 className="font-display text-2xl md:text-3xl font-bold tracking-tight text-white">
                Prompt <span className="text-sky-400">Warfare</span>
              </h1>
            </div>

            <button
              type="button"
              data-start="true"
              disabled={connecting}
              onClick={onQuickPlay}
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-display font-bold text-xs tracking-wide cursor-pointer disabled:opacity-60 whitespace-nowrap"
            >
              <Zap className="w-3.5 h-3.5 fill-current" />
              <span>Partida Rápida</span>
            </button>
          </div>
          <p className="text-xs text-slate-300">
            Arena em micro-voxels destrutíveis com salas abertas, fechadas, senha e controle do Master.
          </p>
        </div>

        {/* Nickname Field */}
        <div className="mb-4">
          <label
            htmlFor="vf-nickname"
            className="block text-xs font-semibold text-slate-300 mb-1"
          >
            Apelido do Combatente
          </label>
          <input
            id="vf-nickname"
            type="text"
            maxLength={18}
            value={playerName}
            onChange={(e) => onPlayerNameChange(e.target.value)}
            placeholder="Seu nome na arena"
            className="w-full h-10 px-3 rounded-lg bg-[#141c2e] border border-white/15 text-white text-sm placeholder:text-slate-500 focus:outline-none focus:border-sky-400"
          />
        </div>

        {/* Discovery vs Create Room Tabs */}
        <div
          role="tablist"
          aria-label="Modo do Lobby"
          className="grid grid-cols-2 gap-1.5 p-1 rounded-lg bg-[#141c2e] border border-white/10 mb-4"
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'discover'}
            onClick={() => {
              setActiveTab('discover');
              setLocalValidationError(null);
            }}
            className={`h-9 rounded-md text-xs font-display font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
              activeTab === 'discover'
                ? 'bg-sky-500 text-slate-950'
                : 'text-slate-300 hover:text-white'
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            <span>Salas Disponíveis ({rooms.length})</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'create'}
            onClick={() => {
              setActiveTab('create');
              setLocalValidationError(null);
            }}
            className={`h-9 rounded-md text-xs font-display font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
              activeTab === 'create'
                ? 'bg-amber-500 text-slate-950'
                : 'text-slate-300 hover:text-white'
            }`}
          >
            <PlusCircle className="w-3.5 h-3.5" />
            <span>Criar Sala</span>
          </button>
        </div>

        {activeTab === 'discover' ? (
          <div className="flex-1 min-h-0 flex flex-col gap-3">
            {/* Search & Refresh */}
            <div className="flex gap-1.5">
              <div className="relative flex-1">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Buscar sala, código ou Master..."
                  aria-label="Buscar salas disponíveis"
                  className="w-full h-9 pl-8 pr-3 rounded-lg bg-[#141c2e] border border-white/15 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-sky-400"
                />
              </div>
              <button
                type="button"
                onClick={onRefreshRooms}
                aria-label="Atualizar lista de salas"
                title="Atualizar lista de salas"
                className="w-9 h-9 shrink-0 flex items-center justify-center rounded-lg bg-[#141c2e] hover:bg-slate-800 border border-white/15 text-slate-200 cursor-pointer"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loadingRooms ? 'animate-spin text-sky-400' : ''}`} />
              </button>
            </div>

            {/* Filter Strip */}
            <div className="grid grid-cols-4 gap-1.5">
              {(
                [
                  { id: 'all', label: 'Todas' },
                  { id: 'open', label: 'Abertas' },
                  { id: 'password', label: 'Com Senha' },
                  { id: 'lobby', label: 'Em Espera' },
                ] as const
              ).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setFilter(item.id)}
                  className={`h-7 rounded text-[11px] font-semibold border cursor-pointer transition-colors ${
                    filter === item.id
                      ? 'bg-sky-500/20 border-sky-400 text-sky-200'
                      : 'bg-[#141c2e]/70 border-white/10 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>

            {/* Public Room Browser List */}
            <div
              data-testid="room-list"
              className="flex-1 min-h-[140px] max-h-52 overflow-y-auto space-y-2 pr-0.5"
            >
              {filteredRooms.length === 0 ? (
                <div className="h-full min-h-[130px] flex flex-col items-center justify-center text-center px-4 py-5 rounded-lg bg-[#141c2e]/55 border border-dashed border-white/12">
                  <p className="text-xs font-medium text-slate-300 mb-1">
                    {rooms.length === 0
                      ? 'Nenhuma sala pública disponível no momento.'
                      : 'Nenhuma sala corresponde ao filtro.'}
                  </p>
                  <p className="text-[11px] text-slate-400 mb-3">
                    Crie sua própria sala com controle de Master ou entre por código abaixo.
                  </p>
                  <button
                    type="button"
                    onClick={() => setActiveTab('create')}
                    className="h-8 px-3 rounded-md bg-amber-500/15 hover:bg-amber-500/25 border border-amber-400/40 text-amber-300 text-xs font-semibold cursor-pointer"
                  >
                    + Criar Nova Sala
                  </button>
                </div>
              ) : (
                filteredRooms.map((r) => {
                  const isPromptingPwd = selectedLockedRoomId === r.id;
                  const isFull = r.humanPlayers >= r.targetPlayers;
                  return (
                    <div
                      key={r.id}
                      data-testid={`room-card-${r.id}`}
                      className="rounded-lg bg-[#141c2e]/85 border border-white/12 p-3 space-y-2"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-sm font-semibold text-white truncate">
                              {r.name}
                            </span>
                            <span className="font-mono-tabular text-[11px] text-sky-300">
                              #{r.id}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 text-[11px] text-slate-400 mt-0.5 flex-wrap">
                            <span className="inline-flex items-center gap-1 text-amber-300/90">
                              <Crown className="w-3 h-3" />
                              {r.hostName}
                            </span>
                            <span className="font-mono-tabular">
                              {r.humanPlayers}/{r.targetPlayers} jogadores
                            </span>
                            {r.fillWithBots && <span className="text-slate-400">+Bots</span>}
                            <span
                              className={`px-1.5 py-0.2 rounded text-[10px] font-semibold ${
                                r.phase === 'lobby'
                                  ? 'bg-sky-500/15 text-sky-300'
                                  : 'bg-slate-700/70 text-slate-300'
                              }`}
                            >
                              {r.phase === 'lobby' ? 'Em Espera' : 'Em Partida'}
                            </span>
                            {r.hasPassword ? (
                              <span className="inline-flex items-center gap-0.5 text-amber-300 font-semibold">
                                <Lock className="w-3 h-3" />
                                Senha
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-0.5 text-emerald-300 font-semibold">
                                <LockOpen className="w-3 h-3" />
                                Aberta
                              </span>
                            )}
                          </div>
                        </div>

                        <button
                          type="button"
                          disabled={connecting || isFull}
                          onClick={() => {
                            setLocalValidationError(null);
                            if (r.hasPassword) {
                              setSelectedLockedRoomId(isPromptingPwd ? null : r.id);
                              setCardPassword('');
                            } else {
                              onJoinRoom({ roomId: r.id });
                            }
                          }}
                          className="shrink-0 h-8 px-3 rounded-md bg-sky-500 hover:bg-sky-400 disabled:opacity-45 text-slate-950 font-display font-bold text-xs cursor-pointer"
                        >
                          {isFull ? 'Lotada' : r.hasPassword ? 'Senha' : 'Entrar'}
                        </button>
                      </div>

                      {isPromptingPwd && (
                        <form
                          className="flex gap-1.5 pt-1 border-t border-white/10"
                          onSubmit={(e) => {
                            e.preventDefault();
                            if (!cardPassword.trim()) {
                              setLocalValidationError('Digite a senha desta sala.');
                              return;
                            }
                            onJoinRoom({ roomId: r.id, password: cardPassword.trim() });
                          }}
                        >
                          <input
                            type="password"
                            autoFocus
                            value={cardPassword}
                            onChange={(e) => setCardPassword(e.target.value)}
                            placeholder="Senha da sala..."
                            aria-label={`Senha para ${r.name}`}
                            className="flex-1 h-8 px-2.5 rounded bg-[#0b101b] border border-white/15 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-amber-400"
                          />
                          <button
                            type="submit"
                            disabled={connecting}
                            className="h-8 px-3 rounded bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs cursor-pointer"
                          >
                            Confirmar
                          </button>
                        </form>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            {/* Direct Join by Room Code */}
            <form
              onSubmit={handleDirectJoinSubmit}
              className="pt-2.5 border-t border-white/10 space-y-2"
            >
              <div className="flex items-center justify-between">
                <label
                  htmlFor="vf-direct-code"
                  className="text-[11px] font-semibold text-slate-300"
                >
                  Entrar direto por código
                </label>
                <button
                  type="button"
                  onClick={() => setShowDirectPassword((v) => !v)}
                  className="text-[11px] text-sky-300 hover:text-sky-200 cursor-pointer"
                >
                  {needsDirectPassword ? 'Ocultar senha' : 'Sala tem senha?'}
                </button>
              </div>
              <div className="flex gap-1.5">
                <input
                  id="vf-direct-code"
                  type="text"
                  maxLength={12}
                  value={directCode}
                  onChange={(e) => setDirectCode(e.target.value.toUpperCase())}
                  placeholder="CÓDIGO (ex: ARENA1)"
                  className="flex-1 min-w-0 h-9 px-3 rounded-lg bg-[#141c2e] border border-white/15 text-white font-mono-tabular text-xs placeholder:text-slate-500 focus:outline-none focus:border-sky-400"
                />
                {needsDirectPassword && (
                  <input
                    type="password"
                    maxLength={24}
                    value={directPassword}
                    onChange={(e) => setDirectPassword(e.target.value)}
                    placeholder="Senha"
                    aria-label="Senha da sala por código"
                    className="w-28 h-9 px-2.5 rounded-lg bg-[#141c2e] border border-amber-400/50 text-white text-xs placeholder:text-slate-500 focus:outline-none focus:border-amber-400"
                  />
                )}
                <button
                  type="submit"
                  disabled={connecting}
                  className="h-9 px-3.5 rounded-lg bg-[#141c2e] hover:bg-slate-800 border border-sky-400/40 text-sky-200 font-semibold text-xs cursor-pointer whitespace-nowrap"
                >
                  Entrar
                </button>
              </div>
            </form>
          </div>
        ) : (
          <form className="space-y-3 overflow-y-auto pr-0.5" onSubmit={handleCreateSubmit}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <div>
                <label
                  htmlFor="vf-create-name"
                  className="block text-xs font-semibold text-slate-300 mb-1"
                >
                  Nome da Sala
                </label>
                <input
                  id="vf-create-name"
                  type="text"
                  maxLength={28}
                  value={roomName}
                  onChange={(e) => setRoomName(e.target.value)}
                  placeholder="Ex: Ilha dos Vulcões"
                  className="w-full h-10 px-3 rounded-lg bg-[#141c2e] border border-white/15 text-white text-xs placeholder:text-slate-500 focus:outline-none focus:border-amber-400"
                />
              </div>

              <div>
                <label
                  htmlFor="vf-create-code"
                  className="block text-xs font-semibold text-slate-300 mb-1"
                >
                  Código da Sala
                </label>
                <div className="flex gap-1.5">
                  <input
                    id="vf-create-code"
                    type="text"
                    maxLength={12}
                    value={roomId}
                    onChange={(e) => setRoomId(e.target.value.toUpperCase())}
                    placeholder="VXL492"
                    className="w-full min-w-0 h-10 px-3 rounded-lg bg-[#141c2e] border border-white/15 text-white font-mono-tabular text-xs focus:outline-none focus:border-amber-400"
                  />
                  <button
                    type="button"
                    onClick={() => setRoomId(randomRoomCode())}
                    aria-label="Gerar novo código de sala"
                    title="Gerar novo código"
                    className="w-10 h-10 shrink-0 flex items-center justify-center rounded-lg bg-[#141c2e] hover:bg-slate-800 border border-white/15 text-slate-200 cursor-pointer"
                  >
                    <Dices className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>

            {/* Room Access Mode */}
            <div>
              <span className="block text-xs font-semibold text-slate-300 mb-1.5">
                Acesso da Sala
              </span>
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => setAccessMode('open')}
                  className={`p-2 rounded-lg border text-left transition-colors cursor-pointer ${
                    accessMode === 'open'
                      ? 'bg-emerald-500/15 border-emerald-400 text-emerald-200'
                      : 'bg-[#141c2e]/75 border-white/10 text-slate-300 hover:border-white/25'
                  }`}
                >
                  <div className="flex items-center gap-1.5 text-xs font-bold">
                    <LockOpen className="w-3.5 h-3.5" />
                    <span>Aberta</span>
                  </div>
                  <div className="text-[10px] text-slate-400 mt-0.5">Pública na lista</div>
                </button>

                <button
                  type="button"
                  onClick={() => setAccessMode('password')}
                  className={`p-2 rounded-lg border text-left transition-colors cursor-pointer ${
                    accessMode === 'password'
                      ? 'bg-amber-500/15 border-amber-400 text-amber-200'
                      : 'bg-[#141c2e]/75 border-white/10 text-slate-300 hover:border-white/25'
                  }`}
                >
                  <div className="flex items-center gap-1.5 text-xs font-bold">
                    <Lock className="w-3.5 h-3.5" />
                    <span>Com Senha</span>
                  </div>
                  <div className="text-[10px] text-slate-400 mt-0.5">Exige senha</div>
                </button>

                <button
                  type="button"
                  onClick={() => setAccessMode('closed')}
                  className={`p-2 rounded-lg border text-left transition-colors cursor-pointer ${
                    accessMode === 'closed'
                      ? 'bg-rose-500/15 border-rose-400 text-rose-200'
                      : 'bg-[#141c2e]/75 border-white/10 text-slate-300 hover:border-white/25'
                  }`}
                >
                  <div className="flex items-center gap-1.5 text-xs font-bold">
                    <ShieldBan className="w-3.5 h-3.5" />
                    <span>Fechada</span>
                  </div>
                  <div className="text-[10px] text-slate-400 mt-0.5">Só o Master libera</div>
                </button>
              </div>
            </div>

            {accessMode === 'password' && (
              <div>
                <label
                  htmlFor="vf-create-password"
                  className="block text-xs font-semibold text-amber-200 mb-1"
                >
                  Senha da Sala
                </label>
                <input
                  id="vf-create-password"
                  type="password"
                  maxLength={24}
                  value={createPassword}
                  onChange={(e) => setCreatePassword(e.target.value)}
                  placeholder="Digite uma senha para os convidados"
                  className="w-full h-10 px-3 rounded-lg bg-[#141c2e] border border-amber-400/50 text-white text-xs placeholder:text-slate-500 focus:outline-none focus:border-amber-400"
                />
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-0.5">
              <div>
                <label
                  htmlFor="vf-players"
                  className="block text-xs font-semibold text-slate-300 mb-1"
                >
                  Jogadores ({targetPlayers})
                </label>
                <input
                  id="vf-players"
                  type="range"
                  min={4}
                  max={14}
                  step={1}
                  value={targetPlayers}
                  onChange={(e) => setTargetPlayers(Number(e.target.value))}
                  className="w-full h-9 accent-amber-400 cursor-pointer"
                />
              </div>

              <label className="flex items-center justify-between px-3 h-10 mt-auto rounded-lg bg-[#141c2e]/70 border border-white/10 cursor-pointer">
                <span className="text-xs text-slate-200">Preencher com bots</span>
                <input
                  type="checkbox"
                  checked={fillWithBots}
                  onChange={(e) => setFillWithBots(e.target.checked)}
                  className="w-4 h-4 accent-sky-400"
                />
              </label>
            </div>

            <button
              type="submit"
              disabled={connecting}
              className="w-full h-11 rounded-lg bg-amber-500 hover:bg-amber-400 active:bg-amber-600 text-slate-950 font-display font-bold text-sm tracking-wide transition-colors cursor-pointer disabled:opacity-60"
            >
              {connecting ? 'Criando sala...' : 'Criar Sala (Você será o Master)'}
            </button>
          </form>
        )}

        {displayedError && (
          <p className="mt-3 text-xs text-rose-400 font-medium" role="alert">
            {displayedError}
          </p>
        )}
      </div>

      {/* Single flat borderless control hint line in bottom safe margin */}
      <div className="text-xs text-slate-200/90 font-medium tracking-wide drop-shadow">
        Mouse Girar · WASD Mover · Espaço Pular · Scroll 1ª/3ª Pessoa · Clique Ação · T Arma · Y Evento · G Descartar · P Pausar
      </div>
    </div>
  );
};
