import type {
  EventArchetype,
  EventFunContract,
  EventParams,
} from './types.ts';

/**
 * Deriva um contrato de diversão a partir do arquétipo/params. O catálogo pode
 * trazer um contrato explícito (`payload.fun`); este default garante que todo
 * evento tenha aviso, contra-jogada, leitura e resposta de bot mesmo antes de
 * curadoria manual.
 */
export function deriveEventFunContract(
  archetype: EventArchetype,
  params: EventParams,
): EventFunContract {
  const weather = params.weatherKind ?? '';
  const mutation = params.mutationKind ?? '';
  const ai = params.aiBehavior ?? '';

  let counterplay: string[] = ['sprint'];
  let spectacle: string[] = ['particles', 'sound'];
  let readability: string[] = ['audio', 'hud'];
  let riskReward: string[] = ['survive'];
  let botResponse: string[] = ['flee'];

  if (archetype === 'WEATHER_HAZARD') {
    if (weather === 'acid_rain' || weather === 'sandstorm' || weather === 'blizzard' || weather === 'hail') {
      counterplay = ['shelter', 'dig'];
      spectacle = ['sky', 'particles', 'ambience'];
      readability = ['audio', 'visual', 'hud'];
      riskReward = ['survive', 'loot_in_danger_zone'];
      botResponse = ['seek_shelter', 'dig'];
    } else if (weather === 'tornado') {
      counterplay = ['sprint', 'grapple', 'high_ground'];
      spectacle = ['sky', 'debris', 'screen_shake'];
      readability = ['audio', 'visual', 'hud'];
      riskReward = ['survive', 'loot_in_danger_zone'];
      botResponse = ['flee', 'climb'];
    } else if (weather === 'low_gravity') {
      counterplay = ['adapt', 'jump'];
      spectacle = ['sky', 'slow_fall'];
      readability = ['hud', 'visual'];
      riskReward = ['mobility'];
      botResponse = ['adapt'];
    } else {
      counterplay = ['shelter', 'sprint', 'high_ground'];
      spectacle = ['sky', 'particles', 'impact'];
      readability = ['audio', 'visual', 'hud'];
      riskReward = ['survive', 'loot_in_danger_zone'];
      botResponse = ['flee', 'seek_shelter'];
    }
  } else if (archetype === 'TERRAIN_MUTATION') {
    if (mutation === 'volcano' || mutation === 'lava_river') {
      counterplay = ['high_ground', 'sprint', 'shelter'];
      spectacle = ['ground', 'lava', 'screen_shake'];
      readability = ['audio', 'visual', 'hud'];
      riskReward = ['survive', 'loot_in_danger_zone'];
      botResponse = ['flee', 'climb'];
    } else if (mutation === 'fissure' || mutation === 'sinkhole') {
      counterplay = ['sprint', 'grapple'];
      spectacle = ['ground', 'debris', 'screen_shake'];
      readability = ['audio', 'visual', 'hud'];
      riskReward = ['survive', 'loot_in_danger_zone'];
      botResponse = ['flee', 'grapple'];
    } else {
      counterplay = ['high_ground', 'dig'];
      spectacle = ['ground', 'debris', 'ambience'];
      readability = ['visual', 'hud'];
      riskReward = ['survive', 'loot_in_danger_zone'];
      botResponse = ['climb', 'dig'];
    }
  } else if (archetype === 'ENTITY_SPAWN') {
    counterplay = ['combat', 'high_ground', 'sprint'];
    spectacle = ['creatures', 'sound', 'impact'];
    readability = ['audio', 'visual', 'hud'];
    riskReward = ['loot', 'kills'];
    botResponse = ['fight', 'retreat'];
  } else if (archetype === 'SUPPLY_DROP') {
    counterplay = ['loot', 'sprint'];
    spectacle = ['beacon', 'parachute', 'sound'];
    readability = ['visual', 'hud'];
    riskReward = ['loot', 'ammo', 'heal'];
    botResponse = ['loot'];
  } else if (archetype === 'SCENERY_SPAWN') {
    counterplay = ['climb', 'high_ground', 'shelter'];
    spectacle = ['rise', 'debris', 'sound'];
    readability = ['visual', 'hud', 'audio'];
    riskReward = ['cover', 'verticality'];
    botResponse = ['climb'];
  }

  return {
    telegraphSec: 5,
    escapeWindowSec: 4,
    counterplay,
    spectacle,
    readability,
    riskReward,
    fairness: {
      unavoidableDamage: false,
      maxLethality: Math.max(0, Math.min(45, params.lethality)),
    },
    botResponse: botResponse.length > 0 ? botResponse : ['flee'],
  };
}

function isNonEmptyStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((entry) => typeof entry === 'string' && entry.trim().length > 0)
  );
}

/** Retorna os motivos de reprovação; lista vazia = contrato válido. */
export function validateEventFunContract(contract: EventFunContract): string[] {
  const issues: string[] = [];
  if (!Number.isFinite(contract.telegraphSec) || contract.telegraphSec < 4 || contract.telegraphSec > 10) {
    issues.push('telegraphSec deve ficar entre 4 e 10');
  }
  if (
    !Number.isFinite(contract.escapeWindowSec) ||
    contract.escapeWindowSec < 2 ||
    contract.escapeWindowSec > contract.telegraphSec
  ) {
    issues.push('escapeWindowSec deve ficar entre 2 e telegraphSec');
  }
  if (!isNonEmptyStringArray(contract.counterplay)) {
    issues.push('counterplay precisa de pelo menos uma contra-jogada');
  }
  if (!isNonEmptyStringArray(contract.spectacle)) {
    issues.push('spectacle precisa de pelo menos uma camada visual');
  }
  if (!isNonEmptyStringArray(contract.readability)) {
    issues.push('readability precisa de pelo menos um canal de leitura');
  }
  if (!isNonEmptyStringArray(contract.riskReward)) {
    issues.push('riskReward precisa explicar por que entrar no perigo');
  }
  if (!isNonEmptyStringArray(contract.botResponse)) {
    issues.push('botResponse precisa de pelo menos uma reação de bot');
  }
  if (contract.fairness.unavoidableDamage) {
    issues.push('dano inevitável não é permitido');
  }
  if (
    !Number.isFinite(contract.fairness.maxLethality) ||
    contract.fairness.maxLethality < 0 ||
    contract.fairness.maxLethality > 45
  ) {
    issues.push('maxLethality deve ficar entre 0 e 45');
  }
  return issues;
}
