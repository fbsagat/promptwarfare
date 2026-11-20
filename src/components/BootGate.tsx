import React from 'react';
import { AlertTriangle, Loader2, RadioTower, RefreshCw, RotateCcw } from 'lucide-react';
import {
  describeProtocolFailure,
  type ProtocolFailureCode,
} from '../shared/protocol.ts';

export type BootPhase = 'checking' | 'unreachable' | 'incompatible';

interface BootGateProps {
  phase: BootPhase;
  code: ProtocolFailureCode | null;
  attempt: number;
  autoRetryInSec: number | null;
  apiBase?: string | null;
  onRetry: () => void;
  onReload: () => void;
}

/**
 * Bloqueio de boot: cobre o app inteiro até o cliente confirmar que fala o
 * mesmo protocolo que a API. Nenhuma tela de menu, asset ou socket abre antes
 * disso. Textos em pt-BR; detalhes técnicos ficam no console.
 */
export const BootGate: React.FC<BootGateProps> = ({
  phase,
  code,
  attempt,
  autoRetryInSec,
  apiBase,
  onRetry,
  onReload,
}) => {
  const checking = phase === 'checking';
  const reloadFirst = code === 'CLIENT_OUTDATED' || code === 'PROTOCOL_MISMATCH';
  const apiLabel = apiBase?.trim() || 'mesma origem da página';
  const title = checking
    ? 'Verificando o servidor'
    : code === 'CLIENT_OUTDATED'
      ? 'Versão desatualizada'
      : 'Servidor indisponível';

  return (
    <main
      className="fixed inset-0 z-[100] flex items-center justify-center bg-[#0b101b] px-4"
      role="alert"
      aria-live="polite"
      aria-busy={checking}
    >
      <div className="absolute inset-0 opacity-40 pointer-events-none [background-image:radial-gradient(circle_at_50%_20%,rgba(56,189,248,0.16),transparent_55%),radial-gradient(circle_at_80%_80%,rgba(245,158,11,0.10),transparent_45%)]" />

      <div className="relative w-full max-w-md bg-[#0b101b]/95 border border-white/15 rounded-2xl p-6 shadow-2xl">
        <div className="flex items-center gap-2 mb-4">
          <span className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-amber-500/15 border border-amber-400/40 text-amber-300">
            <RadioTower className="w-5 h-5" />
          </span>
          <div>
            <h1 className="font-display text-lg font-bold text-white leading-tight">
              Prompt Warfare
            </h1>
            <p className="text-[11px] uppercase tracking-wider text-slate-500">
              Verificação de conexão
            </p>
          </div>
        </div>

        <h2 className="font-display text-2xl font-bold text-white mb-1">{title}</h2>
        <p className="mb-3 text-[11px] text-slate-500">
          API consultada: <span className="font-mono text-slate-400">{apiLabel}</span>
        </p>

        <div className="flex items-start gap-2.5 min-h-[3.5rem]">
          {checking ? (
            <Loader2 className="w-4 h-4 mt-0.5 text-sky-300 animate-spin shrink-0" />
          ) : (
            <AlertTriangle className="w-4 h-4 mt-0.5 text-amber-300 shrink-0" />
          )}
          <p className="text-sm text-slate-300">
            {checking
              ? 'Confirmando que o seu jogo e o servidor falam a mesma versão antes de abrir a arena.'
              : describeProtocolFailure(code)}
          </p>
        </div>

        {!checking && (
          <p className="mt-2 text-[11px] text-slate-500">
            {attempt > 1 ? `Tentativa ${attempt}. ` : ''}
            {autoRetryInSec !== null
              ? `Nova tentativa automática em ${autoRetryInSec}s.`
              : 'A verificação automática está pausada.'}
          </p>
        )}

        {!checking && code === 'PROTOCOL_UNREACHABLE' && (
          <p className="mt-2 text-[11px] text-amber-200/80 leading-relaxed">
            Nada respondeu em <span className="font-mono">{apiLabel}</span>. Suba a
            API (`api-docker.bat up` ou `api-local.bat`) e confira se o frontend
            aponta para a porta certa: 3000 (Docker) ou 3100 (API local).
          </p>
        )}

        {checking ? (
          <div className="mt-5 h-1 w-full overflow-hidden rounded bg-white/10">
            <div className="h-full w-1/3 bg-sky-400/80 animate-pulse" />
          </div>
        ) : (
          <div className="mt-5 flex gap-2.5">
            {reloadFirst ? (
              <>
                <button
                  type="button"
                  onClick={onReload}
                  className="flex-1 h-11 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-display font-bold text-sm cursor-pointer flex items-center justify-center gap-2"
                >
                  <RefreshCw className="w-4 h-4" />
                  Recarregar página
                </button>
                <button
                  type="button"
                  onClick={onRetry}
                  className="px-4 h-11 rounded-lg bg-[#141c2e] hover:bg-slate-800 border border-white/15 text-white font-medium text-sm cursor-pointer"
                >
                  Tentar de novo
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={onRetry}
                  className="flex-1 h-11 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-display font-bold text-sm cursor-pointer flex items-center justify-center gap-2"
                >
                  <RotateCcw className="w-4 h-4" />
                  Tentar novamente
                </button>
                <button
                  type="button"
                  onClick={onReload}
                  className="px-4 h-11 rounded-lg bg-[#141c2e] hover:bg-slate-800 border border-white/15 text-white font-medium text-sm cursor-pointer"
                >
                  Recarregar
                </button>
              </>
            )}
          </div>
        )}

        <p className="mt-4 text-[11px] text-slate-500 leading-relaxed">
          O jogo só abre quando o cliente e a API confirmam a mesma versão de
          protocolo. Se o problema continuar, confirme que a API está no ar e
          que o frontend aponta para ela (`API_URL`).
        </p>
      </div>
    </main>
  );
};
