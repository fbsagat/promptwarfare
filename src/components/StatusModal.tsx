import React, { useState } from 'react';
import { Crown, Lock, LockOpen, Settings, ShieldBan, RotateCcw, LogOut } from 'lucide-react';
import type { RoomAccessMode, RoomMatchSummary, GameMode } from '../shared/types.ts';

interface StatusModalProps {
  kind: 'paused' | 'gameover';
  localPlayerId: string | null;
  roomId: string;
  hostId: string | null;
  hostName: string;
  accessMode: RoomAccessMode;
  summary: RoomMatchSummary | null;
  localAlive: boolean;
  gameMode: GameMode;
  onResume: () => void;
  onRestart: () => void;
  onUpdateAccess: (accessMode: RoomAccessMode, password?: string) => void;
  onOpenSettings: () => void;
  onBackToTitle: () => void;
}

export const StatusModal: React.FC<StatusModalProps> = ({
  kind,
  localPlayerId,
  roomId,
  hostId,
  hostName,
  accessMode,
  summary,
  localAlive,
  gameMode,
  onResume,
  onRestart,
  onUpdateAccess,
  onOpenSettings,
  onBackToTitle,
}) => {
  const [copied, setCopied] = useState(false);
  const [pwdInput, setPwdInput] = useState('');
  const [showPwdPrompt, setShowPwdPrompt] = useState(false);

  const isHost = localPlayerId !== null && hostId === localPlayerId;

  const handleCopyInvite = () => {
    const url = `${window.location.origin}/?room=${encodeURIComponent(roomId)}`;
    void navigator.clipboard?.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  };

  const accessBadge =
    accessMode === 'closed'
      ? { label: 'Fechada', icon: <ShieldBan className="w-3 h-3" />, cls: 'text-rose-300 border-rose-400/35 bg-rose-500/15' }
      : accessMode === 'password'
        ? { label: 'Com Senha', icon: <Lock className="w-3 h-3" />, cls: 'text-amber-300 border-amber-400/35 bg-amber-500/15' }
        : { label: 'Aberta', icon: <LockOpen className="w-3 h-3" />, cls: 'text-emerald-300 border-emerald-400/35 bg-emerald-500/15' };

  if (kind === 'paused') {
    return (
      <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/55 px-4">
        <div className="w-full max-w-sm bg-[#0b101b]/95 border border-white/15 rounded-xl p-6 shadow-2xl">
          <div className="flex items-center justify-between gap-2 mb-1">
            <h2 className="font-display text-2xl font-bold text-white">
              Partida Pausada
            </h2>
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[11px] font-semibold ${accessBadge.cls}`}>
              {accessBadge.icon}
              {accessBadge.label}
            </span>
          </div>
          <p className="text-xs text-slate-400 mb-4 flex items-center gap-1.5 flex-wrap">
            <span>
              Sala <span className="font-mono-tabular text-slate-200">#{roomId}</span>
            </span>
            <span>·</span>
            <span className="inline-flex items-center gap-1 text-amber-300">
              <Crown className="w-3 h-3" />
              Master: {hostName}{isHost ? ' (Você)' : ''}
            </span>
          </p>

          {isHost && (
            <div className="mb-4 p-3 rounded-lg bg-[#141c2e]/80 border border-white/10 space-y-2">
              <span className="block text-[11px] font-semibold text-slate-300">
                Controle de Acesso do Master
              </span>
              <div className="grid grid-cols-3 gap-1.5">
                {(
                  [
                    { id: 'open', label: 'Aberta' },
                    { id: 'password', label: 'Senha' },
                    { id: 'closed', label: 'Fechada' },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => {
                      if (opt.id === 'password') {
                        setShowPwdPrompt(true);
                      } else {
                        setShowPwdPrompt(false);
                        onUpdateAccess(opt.id);
                      }
                    }}
                    className={`h-8 rounded text-xs font-semibold border cursor-pointer ${
                      accessMode === opt.id
                        ? 'bg-amber-500/20 border-amber-400 text-amber-200'
                        : 'bg-[#0b101b]/70 border-white/10 text-slate-300 hover:border-white/25'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              {showPwdPrompt && (
                <div className="flex gap-1.5 pt-1">
                  <input
                    type="password"
                    maxLength={24}
                    value={pwdInput}
                    onChange={(e) => setPwdInput(e.target.value)}
                    placeholder="Definir senha..."
                    aria-label="Nova senha da sala"
                    className="flex-1 h-8 px-2.5 rounded bg-[#0b101b] border border-white/15 text-xs text-white focus:outline-none focus:border-amber-400"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (!pwdInput.trim()) return;
                      onUpdateAccess('password', pwdInput.trim());
                      setPwdInput('');
                      setShowPwdPrompt(false);
                    }}
                    className="px-2.5 h-8 rounded bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs cursor-pointer"
                  >
                    Salvar
                  </button>
                </div>
              )}
            </div>
          )}

          <div className="space-y-2.5">
            <button
              type="button"
              onClick={onResume}
              className="w-full h-11 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-display font-bold text-sm cursor-pointer"
            >
              Continuar
            </button>
            {kind === 'paused' && (
              <button
                type="button"
                onClick={onOpenSettings}
                className="w-full h-11 rounded-lg bg-[#141c2e] hover:bg-slate-800 border border-white/15 text-emerald-300 font-medium text-sm cursor-pointer flex items-center justify-center gap-2"
              >
                <Settings className="w-4 h-4" />
                Configurações
              </button>
            )}
            <button
              type="button"
              onClick={handleCopyInvite}
              className="w-full h-11 rounded-lg bg-[#141c2e] hover:bg-slate-800 border border-white/15 text-sky-300 font-medium text-sm cursor-pointer"
            >
              {copied ? 'Link da Sala Copiado' : 'Copiar Link de Convite'}
            </button>
            {isHost ? (
              <button
                type="button"
                onClick={onRestart}
                className="w-full h-11 rounded-lg bg-[#141c2e] hover:bg-slate-800 border border-white/15 text-white font-medium text-sm cursor-pointer"
              >
                Reiniciar Ilha (Master)
              </button>
            ) : (
              <div className="px-3 py-2 rounded-lg bg-[#141c2e]/60 border border-white/10 text-[11px] text-slate-400 text-center">
                Apenas o Master ({hostName}) pode reiniciar a ilha.
              </div>
            )}
            <button
              type="button"
              onClick={onBackToTitle}
              className="w-full h-11 rounded-lg bg-transparent hover:bg-white/5 border border-white/10 text-slate-300 font-medium text-sm cursor-pointer"
            >
              Voltar ao Lobby
            </button>
          </div>
        </div>
      </div>
    );
  }

    // Arsenal mode gameover: full scoreboard with restart/lobby buttons (matching TAB scoreboard)
        if (kind === 'gameover' && gameMode === 'arsenal') {
          const standings = summary?.standings ?? [];
          // Sort by kills desc, deaths asc, name asc (matching TAB scoreboard)
          const sortedStandings = [...standings].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths || a.name.localeCompare(b.name));

          return (
            <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/65 px-4">
              <div className="w-full max-w-2xl bg-[#0b101b]/95 border border-rose-400/30 rounded-2xl shadow-2xl overflow-hidden flex flex-col">
                <div className="bg-gradient-to-r from-rose-500/20 to-rose-600/10 border-b border-rose-400/30 px-4 py-3 flex items-center justify-between">
                  <h2 className="text-xl font-display font-bold text-rose-200">PLACAR - MODO ARSENAL</h2>
                  {summary && (
                    <span className="font-mono-tabular text-xs text-rose-300/80">{summary.durationSec}s</span>
                  )}
                </div>
                <div className="overflow-x-auto overflow-y-auto p-4 max-h-[60vh]">
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
                      {sortedStandings.map((row, index) => (
                        <tr
                          key={row.id}
                          className={`border-b border-white/5 last:border-b-0 transition-colors ${
                            row.id === localPlayerId ? 'bg-rose-500/10' : ''
                          }`}
                        >
                          <td className="py-2 pr-3 font-medium truncate max-w-[200px]">
                            <div className="flex items-center gap-2">
                              <span className="font-mono-tabular text-slate-500 text-[11px] w-5 text-right">{index + 1}.</span>
                              <span className={`font-display ${row.alive ? 'text-white' : 'text-slate-400 line-through'}`}>
                                {row.name}
                              </span>
                              {row.isBot && <span className="text-[9px] bg-slate-700 text-slate-300 px-1 rounded">BOT</span>}
                            </div>
                          </td>
                          <td className="py-2 text-right font-mono-tabular text-rose-200 font-bold w-20">{row.kills}</td>
                          <td className="py-2 text-right font-mono-tabular text-rose-400 w-20">{row.deaths}</td>
                          <td className="py-2 text-right font-mono-tabular text-amber-300 w-20">{row.assists}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="flex gap-2.5 px-4 py-4 bg-[#141c2e]/50 border-t border-white/10">
                  <button
                    type="button"
                    onClick={onRestart}
                    className="flex-1 h-11 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-display font-bold text-sm cursor-pointer flex items-center justify-center gap-2"
                  >
                    <RotateCcw className="w-4 h-4" />
                    Reiniciar partida
                  </button>
                  <button
                    type="button"
                    onClick={onBackToTitle}
                    className="flex-1 h-11 rounded-lg bg-[#141c2e] hover:bg-slate-800 border border-white/15 text-white font-medium text-sm cursor-pointer flex items-center justify-center gap-2"
                  >
                    <LogOut className="w-4 h-4" />
                    Lobby
                  </button>
                </div>
              </div>
            </div>
          );
        }

    // Default gameover for other modes (warfare, disaster, laboratory)
    const isVictory = summary
      ? summary.winnerId === localPlayerId
      : localAlive;
    const localStats = summary?.standings.find((s) => s.id === localPlayerId);

    return (
      <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/65 px-4">
        <div className="w-full max-w-lg bg-[#0b101b]/95 border border-white/15 rounded-xl p-6 shadow-2xl">
          <div className="flex items-baseline justify-between gap-3 mb-1">
            <h2
              className={`font-display text-3xl font-bold ${
                isVictory ? 'text-amber-400' : 'text-rose-400'
              }`}
            >
              {isVictory ? 'Último Sobrevivente' : 'Você Foi Eliminado'}
            </h2>
            {summary && (
              <span className="font-mono-tabular text-xs text-slate-400">
                {summary.durationSec}s
              </span>
            )}
          </div>
          <p className="text-sm text-slate-300 mb-4">
            {summary
              ? `Vencedor da rodada: ${summary.winnerName}`
              : 'A rodada continua na ilha. Acompanhe ou retorne ao lobby.'}
          </p>

          <div className="grid grid-cols-3 gap-2.5 mb-4">
            <div className="bg-[#141c2e] border border-white/10 rounded-lg p-3">
              <div className="text-[11px] text-slate-400">Abates</div>
              <div className="font-mono-tabular text-xl font-bold text-white">
                {localStats?.kills ?? 0}
              </div>
            </div>
            <div className="bg-[#141c2e] border border-white/10 rounded-lg p-3">
              <div className="text-[11px] text-slate-400">Armas IA</div>
              <div className="font-mono-tabular text-xl font-bold text-white">
                {localStats?.weaponsCreated ?? 0}
              </div>
            </div>
            <div className="bg-[#141c2e] border border-white/10 rounded-lg p-3">
              <div className="text-[11px] text-slate-400">Eventos</div>
              <div className="font-mono-tabular text-xl font-bold text-white">
                {summary?.eventsTriggered ?? 0}
              </div>
            </div>
          </div>

          {summary && summary.standings.length > 0 && (
            <div className="mb-5 bg-[#141c2e]/70 border border-white/10 rounded-lg divide-y divide-white/5 max-h-44 overflow-y-auto">
              {summary.standings.slice(0, 6).map((row, idx) => (
                <div
                  key={row.id}
                  className={`flex items-center justify-between px-3 py-1.5 text-xs ${
                    row.id === localPlayerId ? 'text-amber-300 font-semibold' : 'text-slate-200'
                  }`}
                >
                  <span className="truncate">
                    {idx + 1}. {row.name}
                    {row.personalityLabel ? (
                      <span className="ml-1.5 text-[10px] text-slate-400 font-normal">
                        · {row.personalityLabel}
                      </span>
                    ) : null}
                  </span>
                  <span className="font-mono-tabular text-slate-300 shrink-0 ml-3">
                    {row.kills} abates · {row.weaponsCreated} armas
                  </span>
                </div>
              ))}
            </div>
          )}

          <div className="flex gap-2.5">
            {isHost ? (
              <button
                type="button"
                data-start="true"
                onClick={onRestart}
                className="flex-1 h-11 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-display font-bold text-sm cursor-pointer"
              >
                Jogar Novamente (Master)
              </button>
            ) : (
              <div className="flex-1 h-11 px-3 rounded-lg bg-[#141c2e] border border-white/10 flex items-center text-xs text-slate-300">
                Aguardando Master ({hostName}) reiniciar...
              </div>
            )}
            <button
              type="button"
              onClick={onBackToTitle}
              className="px-4 h-11 rounded-lg bg-[#141c2e] hover:bg-slate-800 border border-white/15 text-white font-medium text-sm cursor-pointer"
            >
              Lobby
            </button>
          </div>
        </div>
      </div>
    );
  };
