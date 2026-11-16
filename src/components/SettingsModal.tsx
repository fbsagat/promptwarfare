import React from 'react';
import { Maximize, Minimize, MousePointer2, Volume2, X } from 'lucide-react';
import type { AudioVolumes, GameSettings } from '../engine/settings.ts';
import { volumePercent } from '../engine/settings.ts';
import { QUALITY_LEVELS, type QualityLevel } from '../engine/quality.ts';

const QUALITY_LABELS: Record<QualityLevel, string> = {
  auto: 'Auto',
  low: 'Baixa',
  medium: 'Média',
  high: 'Alta',
};

const VOLUME_ROWS: Array<{ key: keyof AudioVolumes; label: string; hint: string }> = [
  { key: 'master', label: 'Volume geral', hint: 'Tudo que sai do jogo' },
  { key: 'sfx', label: 'Efeitos', hint: 'Tiros, impactos e passos' },
  { key: 'ambience', label: 'Ambiência', hint: 'Vento, água, fogo e caverna' },
  { key: 'ui', label: 'Interface', hint: 'Sons de menu e feedback' },
];

interface SettingsModalProps {
  settings: GameSettings;
  qualityLevel: QualityLevel;
  isFullscreen: boolean;
  onChange: (next: GameSettings) => void;
  onQualityChange: (level: QualityLevel) => void;
  onToggleFullscreen: () => void;
  onClose: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  settings,
  qualityLevel,
  isFullscreen,
  onChange,
  onQualityChange,
  onToggleFullscreen,
  onClose,
}) => {
  const patch = (partial: Partial<GameSettings>) => {
    onChange({ ...settings, ...partial });
  };
  const setVolume = (bus: keyof AudioVolumes, value: number) => {
    patch({ volumes: { ...settings.volumes, [bus]: value } });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Configurações"
        className="w-full max-w-xl max-h-[88vh] overflow-y-auto rounded-2xl border border-white/15 bg-[#0b101b]/97 shadow-2xl"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
          <div>
            <h2 className="font-display font-bold text-lg text-white tracking-wide">
              Configurações
            </h2>
            <p className="text-[11px] text-slate-400">
              Salvas neste navegador. Aplicadas na hora.
            </p>
          </div>
          <button
            type="button"
            aria-label="Fechar configurações"
            onClick={onClose}
            className="w-9 h-9 flex items-center justify-center rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-slate-200 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-6">
          <section>
            <div className="flex items-center gap-2 mb-3">
              <Volume2 className="w-4 h-4 text-sky-300" />
              <h3 className="text-xs font-bold uppercase tracking-widest text-sky-300">
                Áudio
              </h3>
            </div>
            <div className="grid gap-3">
              {VOLUME_ROWS.map((row) => (
                <label key={row.key} className="block">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-slate-200">{row.label}</span>
                    <span className="text-[11px] font-mono-tabular text-slate-400">
                      {volumePercent(settings.volumes[row.key])}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={settings.volumes[row.key]}
                    onChange={(e) =>
                      setVolume(row.key, Number(e.target.value))
                    }
                    aria-label={row.label}
                    className="w-full h-1.5 accent-sky-400 cursor-pointer"
                  />
                  <span className="text-[10px] text-slate-500">{row.hint}</span>
                </label>
              ))}
            </div>
          </section>

          <section>
            <div className="flex items-center gap-2 mb-3">
              <MousePointer2 className="w-4 h-4 text-emerald-300" />
              <h3 className="text-xs font-bold uppercase tracking-widest text-emerald-300">
                Mouse
              </h3>
            </div>
            <label className="block mb-3">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-slate-200">Sensibilidade</span>
                <span className="text-[11px] font-mono-tabular text-slate-400">
                  {settings.sensitivity.toFixed(2)}×
                </span>
              </div>
              <input
                type="range"
                min={0.4}
                max={2}
                step={0.05}
                value={settings.sensitivity}
                onChange={(e) =>
                  patch({ sensitivity: Number(e.target.value) })
                }
                aria-label="Sensibilidade do mouse"
                className="w-full h-1.5 accent-emerald-400 cursor-pointer"
              />
            </label>
            <label className="flex items-center justify-between px-3 h-10 rounded-lg bg-[#141c2e]/70 border border-white/10 cursor-pointer">
              <span className="text-xs text-slate-200">Inverter eixo Y</span>
              <input
                type="checkbox"
                checked={settings.invertY}
                onChange={(e) => patch({ invertY: e.target.checked })}
                className="w-4 h-4 accent-emerald-400 cursor-pointer"
              />
            </label>
            <p className="mt-2 text-[10px] text-slate-500">
              O mouse é capturado ao clicar no jogo. Esc solta o cursor e pausa.
            </p>
            <p className="mt-1 text-[10px] text-slate-400">
              Shift corre · C agacha · Espaço pula/escala · E interage
            </p>
          </section>

          <section>
            <div className="flex items-center gap-2 mb-3">
              <Maximize className="w-4 h-4 text-amber-300" />
              <h3 className="text-xs font-bold uppercase tracking-widest text-amber-300">
                Vídeo e HUD
              </h3>
            </div>
            <div className="grid gap-3">
              <label className="block">
                <span className="text-xs text-slate-200 block mb-1">
                  Qualidade gráfica
                </span>
                <select
                  value={qualityLevel}
                  onChange={(e) =>
                    onQualityChange(e.target.value as QualityLevel)
                  }
                  aria-label="Qualidade gráfica"
                  className="w-full h-9 px-2 rounded-lg bg-[#141c2e] border border-white/15 text-xs text-slate-100 outline-none cursor-pointer"
                >
                  {QUALITY_LEVELS.map((level) => (
                    <option key={level} value={level}>
                      {QUALITY_LABELS[level]}
                    </option>
                  ))}
                </select>
                <span className="text-[10px] text-slate-500">
                  Auto usa baixa em GPU integrada e média em dedicada.
                </span>
              </label>

              <label className="flex items-center justify-between px-3 h-10 rounded-lg bg-[#141c2e]/70 border border-white/10 cursor-pointer">
                <span className="text-xs text-slate-200">
                  Mostrar FPS, ping e qualidade
                </span>
                <input
                  type="checkbox"
                  checked={settings.showStats}
                  onChange={(e) => patch({ showStats: e.target.checked })}
                  className="w-4 h-4 accent-amber-400 cursor-pointer"
                />
              </label>

              <label className="flex items-center justify-between px-3 h-10 rounded-lg bg-[#141c2e]/70 border border-white/10 cursor-pointer">
                <span className="text-xs text-slate-200">
                  Reduzir movimento (shake, bob e FOV)
                </span>
                <input
                  type="checkbox"
                  checked={settings.reducedMotion}
                  onChange={(e) => patch({ reducedMotion: e.target.checked })}
                  className="w-4 h-4 accent-amber-400 cursor-pointer"
                />
              </label>

              <button
                type="button"
                onClick={onToggleFullscreen}
                className="h-10 px-3 rounded-lg bg-[#141c2e] hover:bg-slate-800 border border-white/15 text-xs font-semibold text-slate-200 cursor-pointer flex items-center justify-center gap-2"
              >
                {isFullscreen ? (
                  <>
                    <Minimize className="w-4 h-4" /> Sair da tela cheia (F)
                  </>
                ) : (
                  <>
                    <Maximize className="w-4 h-4" /> Tela cheia (F)
                  </>
                )}
              </button>
            </div>
          </section>

          <button
            type="button"
            onClick={onClose}
            className="w-full h-10 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-display font-bold text-sm cursor-pointer"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
};
