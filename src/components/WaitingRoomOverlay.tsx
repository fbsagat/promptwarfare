import React, { useState } from 'react';
import {
  Check,
  Crown,
  Link2,
  Lock,
  LockOpen,
  Play,
  ShieldBan,
  UserX,
  ArrowRightLeft,
  LogOut,
} from 'lucide-react';
import type { LobbyStatePayload, RoomAccessMode } from '../shared/types.ts';

interface WaitingRoomOverlayProps {
  lobby: LobbyStatePayload;
  errorMessage: string | null;
  devEnabled?: boolean;
  onStartMatch: () => void;
  onStartSoloMatch?: () => void;
  onUpdateSettings: (patch: {
    accessMode?: RoomAccessMode;
    password?: string;
    targetPlayers?: number;
    fillWithBots?: boolean;
  }) => void;
  onKickPlayer: (targetPlayerId: string) => void;
  onTransferHost: (targetPlayerId: string) => void;
  onLeaveRoom: () => void;
}

export const WaitingRoomOverlay: React.FC<WaitingRoomOverlayProps> = ({
  lobby,
  errorMessage,
  devEnabled,
  onStartMatch,
  onStartSoloMatch,
  onUpdateSettings,
  onKickPlayer,
  onTransferHost,
  onLeaveRoom,
}) => {
  const [copied, setCopied] = useState(false);
  const [pwdDraft, setPwdDraft] = useState('');
  const [showPwdEditor, setShowPwdEditor] = useState(false);

  const isHost = lobby.playerId === lobby.hostId;
  const botSlotsCount = lobby.fillWithBots
    ? Math.max(0, lobby.targetPlayers - lobby.members.length)
    : 0;
  const canStart = lobby.fillWithBots || lobby.members.length >= 2;

  const handleCopyInvite = () => {
    const url = `${window.location.origin}/?room=${encodeURIComponent(lobby.roomId)}`;
    void navigator.clipboard?.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  };

  const handleSelectAccessMode = (mode: RoomAccessMode) => {
    if (!isHost) return;
    if (mode === 'password') {
      if (lobby.hasPassword && !pwdDraft.trim()) {
        onUpdateSettings({ accessMode: 'password' });
        setShowPwdEditor(true);
        return;
      }
      if (pwdDraft.trim()) {
        onUpdateSettings({ accessMode: 'password', password: pwdDraft.trim() });
        setShowPwdEditor(false);
      } else {
        setShowPwdEditor(true);
      }
      return;
    }
    setShowPwdEditor(false);
    onUpdateSettings({ accessMode: mode });
  };

  const accessBadge =
    lobby.accessMode === 'closed'
      ? {
          label: 'Fechada',
          cls: 'bg-rose-500/15 border-rose-400/35 text-rose-300',
          icon: <ShieldBan className="w-3.5 h-3.5" />,
        }
      : lobby.accessMode === 'password'
        ? {
            label: 'Com Senha',
            cls: 'bg-amber-500/15 border-amber-400/35 text-amber-300',
            icon: <Lock className="w-3.5 h-3.5" />,
          }
        : {
            label: 'Aberta',
            cls: 'bg-emerald-500/15 border-emerald-400/35 text-emerald-300',
            icon: <LockOpen className="w-3.5 h-3.5" />,
          };

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-start p-6 md:p-12 pointer-events-none">
      <div className="w-full max-w-lg pointer-events-auto bg-[#0b101b]/92 border border-white/15 rounded-xl p-6 shadow-2xl max-h-[92vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span className="font-mono-tabular text-xs font-bold px-2 py-0.5 rounded bg-sky-500/15 border border-sky-400/30 text-sky-300">
                #{lobby.roomId}
              </span>
              <span
                data-testid="waiting-access-badge"
                className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded border ${accessBadge.cls}`}
              >
                {accessBadge.icon}
                {accessBadge.label}
              </span>
            </div>
            <h2 className="font-display text-2xl font-bold text-white truncate">
              {lobby.roomName}
            </h2>
            <p className="text-xs text-slate-300 mt-0.5 flex items-center gap-1.5">
              <Crown className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              <span>
                Master da partida: <strong className="text-amber-300">{lobby.hostName}</strong>
                {isHost ? ' (Você)' : ''}
              </span>
            </p>
          </div>

          <button
            type="button"
            onClick={handleCopyInvite}
            title="Copiar link de convite"
            className="shrink-0 inline-flex items-center gap-1.5 h-9 px-3 rounded-lg bg-[#141c2e] hover:bg-slate-800 border border-white/15 text-xs font-medium text-slate-200 cursor-pointer"
          >
            {copied ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-400" />
                <span>Copiado</span>
              </>
            ) : (
              <>
                <Link2 className="w-3.5 h-3.5" />
                <span>Convidar</span>
              </>
            )}
          </button>
        </div>

        {/* Connected players roster */}
        <div className="mb-4">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-300 mb-2">
            <span>
              Jogadores na Sala ({lobby.members.length}/{lobby.targetPlayers})
            </span>
            {botSlotsCount > 0 && (
              <span className="text-sky-300 font-mono-tabular">
                +{botSlotsCount} bots ao iniciar
              </span>
            )}
          </div>
          <div className="bg-[#141c2e]/80 border border-white/10 rounded-lg divide-y divide-white/5 max-h-44 overflow-y-auto">
            {lobby.members.map((m) => (
              <div
                key={m.id}
                className="flex items-center justify-between gap-2 px-3 py-2 text-sm"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: m.color }}
                  />
                  <span className="text-white font-medium truncate">
                    {m.name}
                    {m.id === lobby.playerId ? (
                      <span className="ml-1.5 text-xs text-slate-400">(Você)</span>
                    ) : null}
                  </span>
                  {m.isHost && (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-500/15 border border-amber-400/35 text-[11px] font-semibold text-amber-300 shrink-0">
                      <Crown className="w-3 h-3" />
                      Master
                    </span>
                  )}
                </div>

                {isHost && !m.isHost && (
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => onTransferHost(m.id)}
                      aria-label={`Passar Master para ${m.name}`}
                      title="Passar Master"
                      className="inline-flex items-center gap-1 px-2 py-1 rounded bg-slate-800 hover:bg-amber-500/20 border border-white/10 text-[11px] text-amber-300 cursor-pointer"
                    >
                      <ArrowRightLeft className="w-3 h-3" />
                      <span>Master</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => onKickPlayer(m.id)}
                      aria-label={`Expulsar ${m.name}`}
                      title="Expulsar jogador"
                      className="inline-flex items-center gap-1 px-2 py-1 rounded bg-slate-800 hover:bg-rose-500/25 border border-white/10 text-[11px] text-rose-300 cursor-pointer"
                    >
                      <UserX className="w-3 h-3" />
                      <span>Expulsar</span>
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Host-only settings */}
        {isHost && (
          <div className="mb-4 p-3.5 rounded-lg bg-[#141c2e]/75 border border-white/10 space-y-3">
            <div>
              <span className="block text-xs font-semibold text-slate-300 mb-1.5">
                Visibilidade &amp; Acesso (Controle do Master)
              </span>
              <div className="grid grid-cols-3 gap-1.5">
                {(
                  [
                    { id: 'open', label: 'Aberta' },
                    { id: 'password', label: 'Com Senha' },
                    { id: 'closed', label: 'Fechada' },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => handleSelectAccessMode(opt.id)}
                    className={`h-9 rounded-md text-xs font-semibold border transition-colors cursor-pointer ${
                      lobby.accessMode === opt.id
                        ? opt.id === 'closed'
                          ? 'bg-rose-500/20 border-rose-400 text-rose-200'
                          : opt.id === 'password'
                            ? 'bg-amber-500/20 border-amber-400 text-amber-200'
                            : 'bg-emerald-500/20 border-emerald-400 text-emerald-200'
                        : 'bg-[#0b101b]/70 border-white/10 text-slate-300 hover:border-white/25'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {(showPwdEditor || lobby.accessMode === 'password') && (
              <div className="flex gap-2">
                <input
                  type="password"
                  value={pwdDraft}
                  maxLength={24}
                  onChange={(e) => setPwdDraft(e.target.value)}
                  placeholder={lobby.hasPassword ? 'Nova senha da sala' : 'Defina a senha da sala'}
                  aria-label="Senha da sala"
                  className="flex-1 h-9 px-3 rounded-md bg-[#0b101b] border border-white/15 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-amber-400"
                />
                <button
                  type="button"
                  onClick={() => {
                    if (!pwdDraft.trim()) return;
                    onUpdateSettings({ accessMode: 'password', password: pwdDraft.trim() });
                    setShowPwdEditor(false);
                    setPwdDraft('');
                  }}
                  className="px-3 h-9 rounded-md bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs cursor-pointer"
                >
                  Aplicar Senha
                </button>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3 pt-1">
              <div>
                <label
                  htmlFor="wr-capacity"
                  className="block text-xs font-semibold text-slate-300 mb-1"
                >
                  Capacidade ({lobby.targetPlayers})
                </label>
                <input
                  id="wr-capacity"
                  type="range"
                  min={Math.max(4, lobby.members.length)}
                  max={14}
                  step={1}
                  value={lobby.targetPlayers}
                  onChange={(e) => onUpdateSettings({ targetPlayers: Number(e.target.value) })}
                  className="w-full h-8 accent-amber-400 cursor-pointer"
                />
              </div>

              <label className="flex items-center justify-between px-2.5 rounded-md bg-[#0b101b]/70 border border-white/10 cursor-pointer">
                <span className="text-xs text-slate-200">Bots táticos</span>
                <input
                  type="checkbox"
                  checked={lobby.fillWithBots}
                  onChange={(e) => onUpdateSettings({ fillWithBots: e.target.checked })}
                  className="w-4 h-4 accent-sky-400"
                />
              </label>
            </div>
          </div>
        )}

        {errorMessage && (
          <p className="text-xs text-rose-400 font-medium mb-3" role="alert">
            {errorMessage}
          </p>
        )}

        <div className="flex items-center gap-2.5">
          {isHost ? (
            <button
              type="button"
              data-testid="start-match-btn"
              disabled={!canStart}
              onClick={onStartMatch}
              className="flex-1 h-11 inline-flex items-center justify-center gap-2 rounded-lg bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 font-display font-bold text-sm tracking-wide cursor-pointer"
            >
              <Play className="w-4 h-4 fill-current" />
              <span>
                {canStart ? 'Iniciar Partida' : 'Aguarde mais jogadores ou ative Bots'}
              </span>
            </button>
          ) : (
            <div className="flex-1 h-11 px-3 rounded-lg bg-[#141c2e] border border-white/10 flex items-center text-xs text-slate-300">
              Aguardando <strong className="mx-1 text-amber-300">{lobby.hostName}</strong> iniciar...
            </div>
          )}

          <button
            type="button"
            onClick={onLeaveRoom}
            className="px-3.5 h-11 inline-flex items-center gap-1.5 rounded-lg bg-[#141c2e] hover:bg-slate-800 border border-white/15 text-xs font-medium text-slate-200 cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
            <span>Sair</span>
          </button>
        </div>

        {devEnabled && isHost && onStartSoloMatch && (
          <button
            type="button"
            data-testid="dev-solo-start-btn"
            onClick={onStartSoloMatch}
            className="mt-2.5 w-full h-9 rounded-lg bg-amber-500/12 hover:bg-amber-500/22 border border-amber-400/40 text-amber-200 text-xs font-semibold cursor-pointer"
          >
            🧪 [DEV] Iniciar Sandbox Solo (sem bots obrigatórios)
          </button>
        )}
      </div>
    </div>
  );
};
