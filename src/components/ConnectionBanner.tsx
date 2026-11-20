import React from 'react';
import { CheckCircle2, Loader2, RefreshCw, WifiOff } from 'lucide-react';

interface ConnectionBannerProps {
  checking: boolean;
  reconnected: boolean;
  onRetry: () => void;
  onBackToMenu: () => void;
  onReload: () => void;
}

/**
 * Banner persistente para queda de conexão depois que o boot já foi liberado.
 * A partida não é retomada (o servidor remove o jogador ao fechar o socket),
 * então a única saída segura é verificar a API e voltar ao menu.
 */
export const ConnectionBanner: React.FC<ConnectionBannerProps> = ({
  checking,
  reconnected,
  onRetry,
  onBackToMenu,
  onReload,
}) => (
  <div
    className="fixed inset-x-0 top-0 z-[90] flex justify-center px-3 pt-3 pointer-events-none"
    role="status"
    aria-live="assertive"
  >
    <div
      className={`pointer-events-auto flex w-full max-w-3xl flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border px-3 py-2 shadow-xl backdrop-blur ${
        reconnected
          ? 'border-emerald-400/40 bg-emerald-500/15 text-emerald-100'
          : 'border-rose-400/40 bg-rose-500/15 text-rose-100'
      }`}
    >
      <span className="inline-flex items-center gap-2 text-xs font-semibold">
        {checking ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : reconnected ? (
          <CheckCircle2 className="w-4 h-4" />
        ) : (
          <WifiOff className="w-4 h-4" />
        )}
        {checking
          ? 'Verificando conexão com o servidor...'
          : reconnected
            ? 'Servidor disponível novamente.'
            : 'Conexão com o servidor perdida. A sala atual foi encerrada.'}
      </span>

      <span className="ml-auto flex items-center gap-2">
        {!checking && !reconnected && (
          <button
            type="button"
            onClick={onRetry}
            className="h-8 px-3 rounded border border-white/20 bg-black/20 hover:bg-black/35 text-xs font-semibold cursor-pointer flex items-center gap-1.5"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Tentar reconectar
          </button>
        )}
        <button
          type="button"
          onClick={reconnected ? onBackToMenu : onReload}
          className="h-8 px-3 rounded bg-white/90 hover:bg-white text-slate-950 text-xs font-bold cursor-pointer"
        >
          {reconnected ? 'Voltar ao menu' : 'Recarregar'}
        </button>
        {!reconnected && (
          <button
            type="button"
            onClick={onBackToMenu}
            className="h-8 px-3 rounded border border-white/20 bg-black/20 hover:bg-black/35 text-xs font-semibold cursor-pointer"
          >
            Voltar ao menu
          </button>
        )}
      </span>
    </div>
  </div>
);
