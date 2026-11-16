import React, { useEffect, useRef, useState } from 'react';
import { Clock } from 'lucide-react';
import { DEFAULT_WEAPON_ALLOCATION } from '../shared/budget.ts';
import type { WeaponAllocation } from '../shared/types.ts';

interface PromptOverlayProps {
  mode: 'weapon' | 'event';
  onSubmit: (prompt: string, allocation?: WeaponAllocation) => void;
  onCancel: () => void;
  onTimeout: () => void;
  remainingSec?: number;
}

const WEAPON_PROMPT_LIMIT_SEC = 20;
const EVENT_PROMPT_LIMIT_SEC = 15;

function adjustAllocation(
  current: WeaponAllocation,
  key: keyof WeaponAllocation,
  nextRaw: number,
): WeaponAllocation {
  const minForKey = key === 'destruction' ? 0 : 5;
  const maxForKey = key === 'destruction' ? 70 : 75;
  const targetVal = Math.max(minForKey, Math.min(maxForKey, Math.round(nextRaw)));
  const otherKeys = (['firepower', 'cadence', 'precision', 'destruction'] as const).filter(
    (k) => k !== key,
  );
  const remainingTarget = 100 - targetVal;
  const otherSum = otherKeys.reduce((acc, k) => acc + current[k], 0);
  const next: WeaponAllocation = { ...current, [key]: targetVal };

  if (otherSum <= 0) {
    const each = Math.floor(remainingTarget / otherKeys.length);
    otherKeys.forEach((k, idx) => {
      next[k] = idx === 0 ? remainingTarget - each * (otherKeys.length - 1) : each;
    });
    return next;
  }

  let assigned = 0;
  otherKeys.forEach((k, idx) => {
    if (idx === otherKeys.length - 1) {
      next[k] = Math.max(0, remainingTarget - assigned);
    } else {
      const share = Math.round((current[k] / otherSum) * remainingTarget);
      next[k] = Math.max(0, share);
      assigned += next[k];
    }
  });
  return next;
}

export const PromptOverlay: React.FC<PromptOverlayProps> = ({
  mode,
  onSubmit,
  onCancel,
  onTimeout,
  remainingSec,
}) => {
  const [text, setText] = useState('');
  const [allocation, setAllocation] = useState<WeaponAllocation>({
    ...DEFAULT_WEAPON_ALLOCATION,
  });
  const [weaponTimeLeft, setWeaponTimeLeft] = useState(WEAPON_PROMPT_LIMIT_SEC);
  const inputRef = useRef<HTMLInputElement>(null);
  const timedOutRef = useRef(false);

  const maxSec = mode === 'weapon' ? WEAPON_PROMPT_LIMIT_SEC : EVENT_PROMPT_LIMIT_SEC;
  const effectiveTimeLeft =
    mode === 'weapon' ? weaponTimeLeft : Math.max(0, remainingSec ?? EVENT_PROMPT_LIMIT_SEC);

  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  useEffect(() => {
    if (mode !== 'weapon') return;
    timedOutRef.current = false;
    setWeaponTimeLeft(WEAPON_PROMPT_LIMIT_SEC);
    const interval = window.setInterval(() => {
      setWeaponTimeLeft((prev) => {
        if (prev <= 1) {
          if (!timedOutRef.current) {
            timedOutRef.current = true;
            window.setTimeout(() => onTimeout(), 0);
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => window.clearInterval(interval);
  }, [mode, onTimeout]);

  useEffect(() => {
    if (mode === 'event' && remainingSec !== undefined && remainingSec <= 0) {
      onTimeout();
    }
  }, [mode, remainingSec, onTimeout]);

  const totalPoints =
    allocation.firepower +
    allocation.cadence +
    allocation.precision +
    allocation.destruction;
  const pct = Math.max(0, Math.min(100, (effectiveTimeLeft / maxSec) * 100));
  const isUrgent = effectiveTimeLeft <= 5;

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center pointer-events-none px-4">
      <div className="w-full max-w-md bg-[#0b101b]/94 border border-white/20 rounded-xl p-5 shadow-2xl pointer-events-auto">
        <div className="flex items-center justify-between gap-3 mb-2">
          <h2 className="font-display text-base font-bold text-white">
            {mode === 'weapon' ? 'Forjar Arma [T]' : 'Evento Global [Y]'}
          </h2>
          <div className="flex items-center gap-2">
            <span
              data-testid="prompt-timer"
              className={`flex items-center gap-1 px-2 py-0.5 rounded font-mono-tabular text-xs font-bold ${
                isUrgent
                  ? 'bg-rose-500/20 text-rose-300 border border-rose-400/50'
                  : 'bg-slate-800 text-amber-300 border border-white/10'
              }`}
            >
              <Clock className="w-3.5 h-3.5" />
              <span>{effectiveTimeLeft}s</span>
            </span>
            <button
              type="button"
              onClick={onCancel}
              className="text-xs text-slate-400 hover:text-white px-1.5 py-0.5 cursor-pointer"
            >
              [Esc]
            </button>
          </div>
        </div>

        <div className="h-1.5 w-full rounded bg-slate-800 overflow-hidden mb-3">
          <div
            className={`h-full transition-all duration-300 ${
              isUrgent ? 'bg-rose-500' : 'bg-amber-400'
            }`}
            style={{ width: `${pct}%` }}
          />
        </div>

        <p className="text-[11px] text-rose-300 mb-3">
          Seu combatente continua vulnerável no mapa enquanto você escreve.
        </p>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!text.trim() || effectiveTimeLeft <= 0) return;
            onSubmit(text.trim(), mode === 'weapon' ? allocation : undefined);
          }}
          className="flex gap-2"
        >
          <input
            ref={inputRef}
            type="text"
            maxLength={90}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={
              mode === 'weapon'
                ? 'Descreva sua arma...'
                : 'Descreva o evento global...'
            }
            className="flex-1 h-11 px-3.5 rounded-lg bg-[#141c2e] border border-white/20 text-white text-sm placeholder:text-slate-500 focus:outline-none focus:border-amber-400"
          />
          <button
            type="submit"
            disabled={!text.trim() || effectiveTimeLeft <= 0}
            className="px-4 h-11 rounded-lg bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 font-display font-bold text-sm cursor-pointer whitespace-nowrap"
          >
            Gerar
          </button>
        </form>

        {mode === 'weapon' && (
          <div className="mt-3.5 pt-3 border-t border-white/10">
            <div className="flex items-center justify-between text-xs mb-2">
              <span className="font-semibold text-slate-200">
                Distribuição dos Atributos
              </span>
              <span className="font-mono-tabular text-sky-300 font-bold">
                {totalPoints}/100 pts
              </span>
            </div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-2">
              {(
                [
                  ['firepower', 'Poder de Fogo', 5, 75],
                  ['cadence', 'Cadência & Munição', 5, 75],
                  ['precision', 'Precisão & Alcance', 5, 75],
                  ['destruction', 'Destruição / Cratera', 0, 70],
                ] as const
              ).map(([key, label, minVal, maxVal]) => (
                <label key={key} className="block">
                  <div className="flex justify-between text-[11px] text-slate-300 mb-0.5">
                    <span>{label}</span>
                    <span className="font-mono-tabular text-white font-semibold">
                      {allocation[key]}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={minVal}
                    max={maxVal}
                    step={1}
                    value={allocation[key]}
                    onChange={(e) =>
                      setAllocation((prev) =>
                        adjustAllocation(prev, key, Number(e.target.value)),
                      )
                    }
                    className="w-full h-2 accent-sky-400 cursor-pointer"
                  />
                </label>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
