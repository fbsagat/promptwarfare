export function isServerDevEnabled(nodeEnv: string | undefined = process.env.NODE_ENV): boolean {
  return nodeEnv !== 'production';
}

export function isClientDevEnabled(viteDev: boolean, serverDevMode?: boolean): boolean {
  return Boolean(viteDev && serverDevMode);
}

export const DEV_WEAPON_PRESETS = [
  { label: 'Laser Ricochete', prompt: 'Rifle laser azul com tiros ricocheteantes' },
  { label: 'Basuca Cratera', prompt: 'Basuca pesada explosiva que abre crateras enormes' },
  { label: 'Criogênica', prompt: 'Metralhadora de gelo rápida congelante' },
  { label: 'Gravitacional', prompt: 'Canhão gravitacional que puxa inimigos' },
] as const;

export const DEV_EVENT_PRESETS = [
  { label: 'Meteoros', prompt: 'Chuva de meteoros flamejantes' },
  { label: 'Suprimentos', prompt: 'Caixas de suprimentos com munição e cura' },
  { label: 'Lobos Robôs', prompt: 'Matilha de lobos robôs agressivos' },
  { label: 'Maré Alta', prompt: 'Maré oceânica subindo rapidamente' },
  { label: 'Baixa Gravidade', prompt: 'Campo de baixa gravidade lunar' },
] as const;
