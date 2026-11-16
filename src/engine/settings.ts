export interface AudioVolumes {
  master: number;
  sfx: number;
  ambience: number;
  ui: number;
}

export interface GameSettings {
  volumes: AudioVolumes;
  /** Multiplicador de sensibilidade do mouse (0.4–2.0). */
  sensitivity: number;
  invertY: boolean;
  showStats: boolean;
  reducedMotion: boolean;
}

export const SETTINGS_STORAGE_KEY = 'pw.settings.v1';

export const DEFAULT_SETTINGS: GameSettings = {
  volumes: { master: 0.8, sfx: 0.9, ambience: 0.65, ui: 0.8 },
  sensitivity: 1,
  invertY: false,
  showStats: false,
  reducedMotion: false,
};

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

function clamp01(value: unknown, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(1, n));
}

export function normalizeSettings(raw: unknown): GameSettings {
  const data = (raw ?? {}) as Partial<GameSettings>;
  const volumes = (data.volumes ?? {}) as Partial<AudioVolumes>;
  const sensitivity = Number(data.sensitivity);
  return {
    volumes: {
      master: clamp01(volumes.master, DEFAULT_SETTINGS.volumes.master),
      sfx: clamp01(volumes.sfx, DEFAULT_SETTINGS.volumes.sfx),
      ambience: clamp01(volumes.ambience, DEFAULT_SETTINGS.volumes.ambience),
      ui: clamp01(volumes.ui, DEFAULT_SETTINGS.volumes.ui),
    },
    sensitivity: Number.isFinite(sensitivity)
      ? Math.max(0.4, Math.min(2, sensitivity))
      : DEFAULT_SETTINGS.sensitivity,
    invertY: Boolean(data.invertY),
    showStats: Boolean(data.showStats),
    reducedMotion: Boolean(data.reducedMotion),
  };
}

function defaultStorage(): StorageLike | null {
  try {
    if (typeof window === 'undefined') return null;
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

export function loadSettings(storage: StorageLike | null = defaultStorage()): GameSettings {
  if (!storage) return { ...DEFAULT_SETTINGS };
  try {
    const raw = storage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return normalizeSettings(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(
  settings: GameSettings,
  storage: StorageLike | null = defaultStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(
      SETTINGS_STORAGE_KEY,
      JSON.stringify(normalizeSettings(settings)),
    );
  } catch {
    // localStorage pode estar bloqueado; ignora.
  }
}

export function volumePercent(value: number): number {
  return Math.round(Math.max(0, Math.min(1, value)) * 100);
}
