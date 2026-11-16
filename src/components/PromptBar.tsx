import React, { useEffect, useRef, useState } from 'react';
import {
  EVENT_WRITE_WINDOW_SEC,
  WEAPON_WRITE_WINDOW_SEC,
} from '../shared/budget.ts';

interface PromptBarProps {
  mode: 'weapon' | 'event';
  endsAt: number | null;
  serverNow: number;
  onSubmit: (prompt: string) => void;
  onCancel: () => void;
}

/**
 * Barra mínima de prompt: só texto, progresso embutido e as teclas.
 * Sem modal, sem sliders, sem botões.
 */
export const PromptBar: React.FC<PromptBarProps> = ({
  mode,
  endsAt,
  serverNow,
  onSubmit,
  onCancel,
}) => {
  const [text, setText] = useState('');
  const [, setTick] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const syncRef = useRef({ serverNow, at: Date.now() });

  useEffect(() => {
    syncRef.current = { serverNow, at: Date.now() };
  }, [serverNow]);

  useEffect(() => {
    inputRef.current?.focus();
    const interval = window.setInterval(() => setTick((t) => t + 1), 100);
    return () => window.clearInterval(interval);
  }, []);

  const windowMs =
    (mode === 'event' ? EVENT_WRITE_WINDOW_SEC : WEAPON_WRITE_WINDOW_SEC) * 1000;
  const now = syncRef.current.serverNow + (Date.now() - syncRef.current.at);
  const remainingMs = endsAt ? Math.max(0, endsAt - now) : windowMs;
  const remainingSec = Math.ceil(remainingMs / 1000);
  const expired = remainingMs <= 0;
  const progress = Math.max(0, Math.min(100, (remainingMs / windowMs) * 100));

  const submit = () => {
    const clean = text.trim();
    if (!clean || expired) return;
    onSubmit(clean);
  };

  return (
    <div className="fixed inset-x-0 bottom-6 z-40 flex justify-center px-4 pointer-events-none">
      <form
        data-testid="prompt-bar"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="pointer-events-auto w-full max-w-xl rounded-lg border border-amber-400/45 bg-[#0b101b]/94 px-3 py-2 shadow-2xl"
      >
        <div className="flex items-center gap-3">
          <input
            ref={inputRef}
            type="text"
            maxLength={90}
            value={text}
            disabled={expired}
            autoComplete="off"
            spellCheck={false}
            aria-label={
              mode === 'weapon' ? 'Descreva sua arma' : 'Descreva o evento global'
            }
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                submit();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                onCancel();
              }
            }}
            placeholder={
              mode === 'weapon'
                ? 'Descreva sua arma...  (Enter executa · Esc cancela)'
                : 'Descreva o evento global...  (Enter executa · Esc cancela)'
            }
            className="flex-1 min-w-0 bg-transparent text-sm text-white placeholder:text-slate-500 focus:outline-none disabled:opacity-60"
          />
          <span className="font-mono-tabular text-xs font-bold text-amber-300 shrink-0">
            {expired ? '0s' : `${remainingSec}s`}
          </span>
        </div>
        <div className="mt-2 h-0.5 w-full overflow-hidden rounded bg-slate-800">
          <div
            className={`h-full transition-all duration-100 ${expired ? 'bg-rose-500' : 'bg-amber-400'}`}
            style={{ width: `${progress}%` }}
          />
        </div>
      </form>
    </div>
  );
};
