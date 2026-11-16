import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import {
  buildFallbackEntityVoxels,
  buildFallbackWeaponVoxels,
  decodeRleVoxels,
  encodeRleVoxels,
  normalizePalette,
  normalizeWeaponAllocation,
  validateAndClampEventParams,
  validateAndClampWeapon,
} from '../src/shared/budget.ts';
import type {
  EntityAiBehavior,
  EventArchetype,
  MapEventState,
  ProjectileBehavior,
  StatusEffect,
  WeaponAllocation,
  WeaponBlueprint,
} from '../src/shared/types.ts';

import {
  getBlueprintDb,
  type BlueprintDatabase,
} from './blueprintDb.ts';

export interface AiGenerationOptions {
  useLlm?: boolean;
  db?: BlueprintDatabase;
  allocation?: Partial<WeaponAllocation>;
}

let cachedClient: GoogleGenAI | null = null;
let quotaCooldownUntil = 0;
let loggedCooldownNotice = false;

function cloneWeaponWithFreshId(
  bp: WeaponBlueprint,
  fromDatabase = false,
): WeaponBlueprint {
  return {
    ...bp,
    id: `wpn_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    fromDatabase,
    stats: { ...bp.stats },
    modifiers: { ...bp.modifiers },
    selfRisk: [...bp.selfRisk],
    palette: bp.palette.map((c) => ({ ...c })),
    rleVoxels: [...bp.rleVoxels],
    gripPos: [...bp.gripPos] as [number, number, number],
    muzzlePos: [...bp.muzzlePos] as [number, number, number],
    allocation: bp.allocation ? { ...bp.allocation } : undefined,
  };
}

function parseQuotaError(err: unknown): { isQuota: boolean; retryDelayMs: number } {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  const isQuota =
    /\b429\b|RESOURCE_EXHAUSTED|quota|rate[- ]?limit/i.test(msg);
  if (!isQuota) {
    return { isQuota: false, retryDelayMs: 0 };
  }
  const match = /"retryDelay"\s*:\s*"(\d+)s"/i.exec(msg);
  const parsedMs = match ? Number(match[1]) * 1000 : 15 * 60_000;
  const retryDelayMs = Math.max(60_000, Math.min(60 * 60_000, parsedMs));
  return { isQuota: true, retryDelayMs };
}

function handleAiFallbackError(kind: 'Weapon' | 'Event', err: unknown): void {
  const { isQuota, retryDelayMs } = parseQuotaError(err);
  if (isQuota) {
    quotaCooldownUntil = Math.max(quotaCooldownUntil, Date.now() + retryDelayMs);
    if (!loggedCooldownNotice) {
      loggedCooldownNotice = true;
      const mins = Math.max(1, Math.round(retryDelayMs / 60_000));
      console.info(
        `[AI Generator] Gemini quota reached; using procedural generator for ${mins} min.`,
      );
    }
    return;
  }
  const msg = (err instanceof Error ? err.message : String(err ?? 'Unknown error')).slice(0, 140);
  console.warn(`[AI ${kind}] Using procedural fallback: ${msg}`);
}

function getAiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    return null;
  }
  if (!cachedClient) {
    cachedClient = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'prompt-warfare',
        },
      },
    });
  }
  return cachedClient;
}

const weaponResponseSchema = {
  type: Type.OBJECT,
  properties: {
    name: { type: Type.STRING },
    stats: {
      type: Type.OBJECT,
      properties: {
        damage: { type: Type.INTEGER },
        fireRate: { type: Type.NUMBER },
        projectiles: { type: Type.INTEGER },
        spreadDeg: { type: Type.NUMBER },
        rangeMeters: { type: Type.INTEGER },
        ammoMax: { type: Type.INTEGER },
        cooling: { type: Type.INTEGER },
        massKg: { type: Type.INTEGER },
      },
      required: [
        'damage',
        'fireRate',
        'projectiles',
        'spreadDeg',
        'rangeMeters',
        'ammoMax',
        'cooling',
        'massKg',
      ],
    },
    modifiers: {
      type: Type.OBJECT,
      properties: {
        voxelCraterRadius: { type: Type.INTEGER },
        projectileBehavior: { type: Type.STRING },
        statusEffect: { type: Type.STRING },
      },
      required: ['voxelCraterRadius', 'projectileBehavior', 'statusEffect'],
    },
    selfRisk: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
    palette: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          hex: { type: Type.STRING },
          emissive: { type: Type.BOOLEAN },
        },
        required: ['hex', 'emissive'],
      },
    },
    rleVoxels: {
      type: Type.ARRAY,
      items: { type: Type.INTEGER },
    },
    gripPos: {
      type: Type.ARRAY,
      items: { type: Type.INTEGER },
    },
    muzzlePos: {
      type: Type.ARRAY,
      items: { type: Type.INTEGER },
    },
  },
  required: [
    'name',
    'stats',
    'modifiers',
    'selfRisk',
    'palette',
    'rleVoxels',
    'gripPos',
    'muzzlePos',
  ],
};

const eventResponseSchema = {
  type: Type.OBJECT,
  properties: {
    archetype: { type: Type.STRING },
    weatherKind: { type: Type.STRING },
    mutationKind: { type: Type.STRING },
    aiBehavior: { type: Type.STRING },
    entityName: { type: Type.STRING },
    radiusMeters: { type: Type.INTEGER },
    durationSec: { type: Type.INTEGER },
    lethality: { type: Type.INTEGER },
    quantity: { type: Type.INTEGER },
    ammoRestore: { type: Type.INTEGER },
    palette: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          hex: { type: Type.STRING },
          emissive: { type: Type.BOOLEAN },
        },
        required: ['hex', 'emissive'],
      },
    },
    rleVoxels: {
      type: Type.ARRAY,
      items: { type: Type.INTEGER },
    },
  },
  required: [
    'archetype',
    'radiusMeters',
    'durationSec',
    'lethality',
    'quantity',
  ],
};

function pickWeaponPalette(lower: string) {
  if (/gelo|congel|crio|neve|frost/i.test(lower)) {
    return [
      { hex: '#67e8f9', emissive: true },
      { hex: '#1e3a5f', emissive: false },
      { hex: '#bae6fd', emissive: false },
      { hex: '#e0f2fe', emissive: true },
    ];
  }
  if (/fogo|lava|plasma solar|chama|incendi|meteoro/i.test(lower)) {
    return [
      { hex: '#fb923c', emissive: true },
      { hex: '#27272a', emissive: false },
      { hex: '#71717a', emissive: false },
      { hex: '#facc15', emissive: true },
    ];
  }
  if (/t[oó]xic|venen|[aá]cid|verde|esmeralda|radioativ/i.test(lower)) {
    return [
      { hex: '#4ade80', emissive: true },
      { hex: '#1f2937', emissive: false },
      { hex: '#3f6212', emissive: false },
      { hex: '#a3e635', emissive: true },
    ];
  }
  if (/vazio|buraco|gravidade|sombr|roxo|violet|arcane|n[eé]bula/i.test(lower)) {
    return [
      { hex: '#c084fc', emissive: true },
      { hex: '#1e1b4b', emissive: false },
      { hex: '#4c1d95', emissive: false },
      { hex: '#f472b6', emissive: true },
    ];
  }
  if (/ouro|dourad|sol|real|s[oô]nic/i.test(lower)) {
    return [
      { hex: '#fbbf24', emissive: true },
      { hex: '#334155', emissive: false },
      { hex: '#fef08a', emissive: false },
      { hex: '#ffffff', emissive: true },
    ];
  }
  return [
    { hex: '#38bdf8', emissive: true },
    { hex: '#334155', emissive: false },
    { hex: '#94a3b8', emissive: false },
    { hex: '#f59e0b', emissive: true },
  ];
}

function buildProceduralWeaponFallback(
  prompt: string,
  allocation?: Partial<WeaponAllocation>,
): WeaponBlueprint {
  const lower = prompt.toLowerCase();
  const isShotgun = /escopeta|shotgun|estilha|leque|dispers/i.test(lower);
  const isCannon = /bazuca|canh[aã]o|m[ií]ssil|meteoro|bomba|explos|lan[çc]a-fog/i.test(lower);
  const isSniper = /sniper|lazer|laser|feixe|precis|franco/i.test(lower);
  const isRapid = /metralha|sub|smg|minigun|r[aá]pida|rajada/i.test(lower);

  let projectileBehavior: ProjectileBehavior = 'standard';
  if (/ricochete|rebate|bounce|el[eé]tric|tesla/i.test(lower)) projectileBehavior = 'bouncing';
  else if (/gruda|adesiv|bomba|sticky|c4/i.test(lower)) projectileBehavior = 'sticky_bomb';
  else if (/perfura|atravessa|pierc|feixe|laser/i.test(lower)) projectileBehavior = 'piercing';
  else if (/teleguiad|homing|persegue|m[ií]ssil|guiad/i.test(lower)) projectileBehavior = 'homing_weak';

  let statusEffect: StatusEffect = 'none';
  if (/gelo|congel|crio|neve|frost/i.test(lower)) statusEffect = 'freeze';
  else if (/fogo|lava|chama|incendi|solar/i.test(lower)) statusEffect = 'burn';
  else if (/gravidade|buraco negro|puxa|vazio/i.test(lower)) statusEffect = 'gravity_pull';
  else if (/empurra|impacto|onda|knock|s[oô]nic|choque/i.test(lower)) statusEffect = 'knockback';

  const palette = pickWeaponPalette(lower);

  const stats = isCannon
    ? {
        damage: 36,
        fireRate: 0.75,
        projectiles: 1,
        spreadDeg: 4,
        rangeMeters: 85,
        ammoMax: 10,
        cooling: 4,
        massKg: 18,
      }
    : isShotgun
      ? {
          damage: 9,
          fireRate: 1.3,
          projectiles: 5,
          spreadDeg: 13,
          rangeMeters: 42,
          ammoMax: 18,
          cooling: 5,
          massKg: 11,
        }
      : isSniper
        ? {
            damage: 40,
            fireRate: 0.9,
            projectiles: 1,
            spreadDeg: 1,
            rangeMeters: 112,
            ammoMax: 14,
            cooling: 5,
            massKg: 12,
          }
        : isRapid
          ? {
              damage: 8,
              fireRate: 6.4,
              projectiles: 1,
              spreadDeg: 7,
              rangeMeters: 62,
              ammoMax: 48,
              cooling: 7,
              massKg: 6,
            }
          : {
              damage: 13,
              fireRate: 4.2,
              projectiles: 1,
              spreadDeg: 4.5,
              rangeMeters: 74,
              ammoMax: 34,
              cooling: 6,
              massKg: 7,
            };

  return validateAndClampWeapon(
    {
      name: prompt.trim().slice(0, 28) || 'Forja Voxel',
      stats,
      modifiers: {
        voxelCraterRadius: isCannon ? 3 : isShotgun ? 2 : 1,
        projectileBehavior,
        statusEffect,
      },
      selfRisk: isCannon ? ['recoil_launch'] : [],
      palette,
      rleVoxels: encodeRleVoxels(buildFallbackWeaponVoxels(prompt, palette.length)),
      gripPos: [6, 3, 6],
      muzzlePos: [6, 7, 22],
    },
    prompt,
    allocation,
  );
}

export async function generateAiWeapon(
  prompt: string,
  opts?: AiGenerationOptions,
): Promise<WeaponBlueprint> {
  const cleanPrompt = prompt.trim().slice(0, 90) || 'Rifle de Plasma Compacto';
  const normAlloc = opts?.allocation ? normalizeWeaponAllocation(opts.allocation) : undefined;
  const allocKey = normAlloc
    ? `alloc:${normAlloc.firepower}-${normAlloc.cadence}-${normAlloc.precision}-${normAlloc.destruction}`
    : undefined;
  const db = opts?.db ?? getBlueprintDb();
  const stored = db.findWeapon(cleanPrompt, allocKey);
  const llmAllowed =
    opts?.useLlm !== false && Date.now() >= quotaCooldownUntil && getAiClient() !== null;

  // Reuse stored weapon whenever it came from AI/seed, OR whenever LLM isn't being invoked
  if (stored && (stored.source !== 'procedural' || !llmAllowed)) {
    return cloneWeaponWithFreshId(stored.blueprint, true);
  }

  if (!llmAllowed) {
    const fallback = buildProceduralWeaponFallback(cleanPrompt, normAlloc);
    db.saveWeapon(cleanPrompt, fallback, 'procedural', allocKey);
    return cloneWeaponWithFreshId(fallback, false);
  }

  const ai = getAiClient()!;
  try {
    const allocHint = normAlloc
      ? `\nDistribuição prioritária pedida pelo jogador (soma 100): Poder de Fogo ${normAlloc.firepower}pts, Cadência/Munição ${normAlloc.cadence}pts, Precisão/Alcance ${normAlloc.precision}pts, Destruição/Cratera ${normAlloc.destruction}pts.`
      : '';
    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: `Pedido do jogador para gerar uma arma 3D voxel: "${cleanPrompt}"${allocHint}`,
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        responseMimeType: 'application/json',
        responseSchema: weaponResponseSchema,
        systemInstruction: `Você é o balanceador e modelador 3D do jogo Prompt Warfare.
Converta o pedido do jogador em JSON estrito distribuindo um orçamento MÁXIMO de 100 pontos entre os atributos da arma (nenhuma arma pode eliminar em 1 tiro; jogadores têm 100 HP):
- damage (5..45 por projétil) e projectiles (1..8): poder da rajada = damage * (1 + (projectiles - 1) * 0.65); custo = rajada*0.72 + (rajada*fireRate)*0.34.
- fireRate (0.5..8.0 tiros/seg), ammoMax (6..60), cooling (1..10): custo = fireRate*1.4 + ammoMax*0.35 + cooling*1.1.
- spreadDeg (1..25) e rangeMeters (20..120): custo = (22 - spreadDeg)*0.55 + (rangeMeters - 15)*0.14.
- voxelCraterRadius (0..4): 5 pts por unidade; efeito/comportamento especial custa 4.5 a 5.5 pts.
- massKg (2..24): cada kg acima de 4 desconta 0.45 pt em troca de movimentação mais lenta.
- projectileBehavior: um de "standard", "bouncing", "homing_weak", "sticky_bomb", "piercing"
- statusEffect: um de "none", "knockback", "burn", "freeze", "gravity_pull"
- selfRisk: array opcional com "recoil_launch", "overheat_explosion", "toxic_leak" caso o pedido seja exagerado ou perigoso.
Gere também uma malha voxel 12x12x24 compactada em rleVoxels (pares [indiceCor(0..4), quantidade] cuja soma das quantidades seja até 3456, índice 0=ar, índices 1..4 correspondem à palette com 4 cores hex). gripPos [x,y,z] dentro de 12x12x24 e muzzlePos [x,y,z] na ponta dianteira (z ~ 20..23). Nome curto em português.`,
      },
    });

    const parsed = JSON.parse((response.text ?? '{}').trim());
    const blueprint = validateAndClampWeapon(parsed, cleanPrompt, normAlloc);
    loggedCooldownNotice = false;
    db.saveWeapon(cleanPrompt, blueprint, 'ai', allocKey);
    return cloneWeaponWithFreshId(blueprint, false);
  } catch (err) {
    handleAiFallbackError('Weapon', err);
    if (stored) {
      return cloneWeaponWithFreshId(stored.blueprint, true);
    }
    const fallback = buildProceduralWeaponFallback(cleanPrompt, normAlloc);
    db.saveWeapon(cleanPrompt, fallback, 'procedural', allocKey);
    return cloneWeaponWithFreshId(fallback, false);
  }
}

function pickEventPalette(lower: string, archetype: EventArchetype) {
  if (archetype === 'SUPPLY_DROP') {
    if (/ouro|tesouro|real/i.test(lower)) {
      return [
        { hex: '#fbbf24', emissive: false },
        { hex: '#78350f', emissive: false },
        { hex: '#fef08a', emissive: true },
      ];
    }
    return [
      { hex: '#f59e0b', emissive: false },
      { hex: '#334155', emissive: false },
      { hex: '#22d3ee', emissive: true },
    ];
  }
  if (/gelo|neve|crio|glacial/i.test(lower)) {
    return [
      { hex: '#67e8f9', emissive: true },
      { hex: '#1e3a5f', emissive: false },
      { hex: '#e0f2fe', emissive: false },
    ];
  }
  if (/t[oó]xic|venen|aranha|[aá]cid|verde/i.test(lower)) {
    return [
      { hex: '#4ade80', emissive: true },
      { hex: '#1f2937', emissive: false },
      { hex: '#3f6212', emissive: false },
    ];
  }
  if (/cristal|vazio|sombr|roxo|drone/i.test(lower)) {
    return [
      { hex: '#38bdf8', emissive: true },
      { hex: '#1e293b', emissive: false },
      { hex: '#a855f7', emissive: false },
    ];
  }
  return [
    { hex: '#ef4444', emissive: true },
    { hex: '#3f3f46', emissive: false },
    { hex: '#a1a1aa', emissive: false },
  ];
}

function buildProceduralEventFallback(
  prompt: string,
  authorId: string,
  authorName: string,
  center: [number, number, number],
): MapEventState {
  const lower = prompt.toLowerCase();
  let archetype: EventArchetype = 'WEATHER_HAZARD';
  if (/muni[çc][aã]o|caixa|suprimento|supply|bala|ammo|cura|kit|tesouro/i.test(lower)) {
    archetype = 'SUPPLY_DROP';
  } else if (/lobo|aranha|golem|monstro|zumbi|rob[oô]|criatura|javali|drag|drone|enxame|tit[aã]/i.test(lower)) {
    archetype = 'ENTITY_SPAWN';
  } else if (/vulc|fissura|racha|abismo|cristal|mar[eé]|tsunami|inund|terreno|pilar|montanha/i.test(lower)) {
    archetype = 'TERRAIN_MUTATION';
  }

  let weatherKind: 'acid_rain' | 'blizzard' | 'meteor_shower' | 'low_gravity' | 'earthquake' =
    'meteor_shower';
  if (/nevasca|gelo|neve|frio|congel/i.test(lower)) weatherKind = 'blizzard';
  else if (/[aá]cid|chuva|t[oó]xic/i.test(lower)) weatherKind = 'acid_rain';
  else if (/terremoto|tremor|abal/i.test(lower)) weatherKind = 'earthquake';
  else if (/gravidade|flutua|lua|peso/i.test(lower)) weatherKind = 'low_gravity';

  let mutationKind: 'volcano' | 'fissure' | 'crystal_spires' | 'rising_tide' = 'crystal_spires';
  if (/vulc|lava|erup/i.test(lower)) mutationKind = 'volcano';
  else if (/fissura|racha|abismo/i.test(lower)) mutationKind = 'fissure';
  else if (/mar[eé]|enchente|[aá]gua|tsunami|inund/i.test(lower)) mutationKind = 'rising_tide';

  const aiBehavior: EntityAiBehavior =
    archetype === 'SUPPLY_DROP'
      ? 'static_pickup'
      : /explos|kamikaze|bomba/i.test(lower)
        ? 'explosive_kamikaze'
        : /foge|fuga|pasivo|coelho/i.test(lower)
          ? 'fleeing'
          : /guardi|territor|torre/i.test(lower)
            ? 'territorial'
            : 'aggressive_nearest';

  const isIntense = /gigante|apocalip|extremo|horda|enxame|massiv/i.test(lower);
  const { params, budgetUsed, wasClamped } = validateAndClampEventParams(
    archetype,
    {
      radiusMeters: archetype === 'TERRAIN_MUTATION' ? 28 : isIntense ? 32 : 24,
      durationSec: archetype === 'TERRAIN_MUTATION' ? 24 : 36,
      lethality: archetype === 'SUPPLY_DROP' ? 5 : isIntense ? 28 : 22,
      quantity:
        archetype === 'ENTITY_SPAWN'
          ? isIntense
            ? 7
            : 5
          : archetype === 'SUPPLY_DROP'
            ? isIntense
              ? 6
              : 4
            : 3,
      weatherKind,
      mutationKind,
      aiBehavior,
      ammoRestore: /grande|cheia|max/i.test(lower) ? 45 : 30,
    },
    prompt,
  );

  const palette = pickEventPalette(lower, archetype);

  return {
    id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    authorId,
    authorName,
    prompt: prompt.slice(0, 90),
    archetype,
    warningRemainingSec: 5,
    durationRemainingSec: params.durationSec,
    totalDurationSec: params.durationSec,
    params,
    center,
    entityBlueprint:
      archetype === 'ENTITY_SPAWN' || archetype === 'SUPPLY_DROP'
        ? {
            name: prompt.slice(0, 24) || 'Entidade Voxel',
            palette,
            rleVoxels: encodeRleVoxels(
              buildFallbackEntityVoxels(
                archetype === 'SUPPLY_DROP' ? 'supply_crate' : 'creature',
                palette.length,
                prompt,
              ),
            ),
          }
        : undefined,
    budgetUsed,
    wasClamped,
  };
}

export async function generateAiMapEvent(
  prompt: string,
  authorId: string,
  authorName: string,
  center: [number, number, number],
  opts?: AiGenerationOptions,
): Promise<MapEventState> {
  const cleanPrompt = prompt.trim().slice(0, 90) || 'Chuva de meteoros de cristal';
  const db = opts?.db ?? getBlueprintDb();
  const stored = db.findEvent(cleanPrompt);
  const llmAllowed =
    opts?.useLlm !== false && Date.now() >= quotaCooldownUntil && getAiClient() !== null;

  if (stored && (stored.source !== 'procedural' || !llmAllowed)) {
    const p = stored.payload;
    return {
      id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      authorId,
      authorName,
      prompt: cleanPrompt,
      archetype: p.archetype,
      warningRemainingSec: 5,
      durationRemainingSec: p.params.durationSec,
      totalDurationSec: p.params.durationSec,
      params: { ...p.params },
      center: [...center] as [number, number, number],
      entityBlueprint: p.entityBlueprint
        ? {
            name: p.entityBlueprint.name,
            palette: p.entityBlueprint.palette.map((c) => ({ ...c })),
            rleVoxels: [...p.entityBlueprint.rleVoxels],
          }
        : undefined,
      budgetUsed: p.budgetUsed,
      wasClamped: p.wasClamped,
      fromDatabase: true,
    };
  }

  if (!llmAllowed) {
    const fallback = buildProceduralEventFallback(cleanPrompt, authorId, authorName, center);
    db.saveEvent(
      cleanPrompt,
      {
        archetype: fallback.archetype,
        params: fallback.params,
        entityBlueprint: fallback.entityBlueprint,
        budgetUsed: fallback.budgetUsed,
        wasClamped: fallback.wasClamped,
      },
      'procedural',
    );
    return fallback;
  }

  const ai = getAiClient()!;
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: `Pedido do jogador sorteado para Evento de Mapa: "${cleanPrompt}"`,
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        responseMimeType: 'application/json',
        responseSchema: eventResponseSchema,
        systemInstruction: `Você é o Mestre de Caos do jogo Prompt Warfare.
Classifique o evento em exatamente 1 archetype:
- "WEATHER_HAZARD" (weatherKind: "acid_rain" | "blizzard" | "meteor_shower" | "low_gravity" | "earthquake")
- "ENTITY_SPAWN" (aiBehavior: "aggressive_nearest" | "territorial" | "fleeing" | "explosive_kamikaze")
- "TERRAIN_MUTATION" (mutationKind: "volcano" | "fissure" | "crystal_spires" | "rising_tide")
- "SUPPLY_DROP" (apenas quando pedir munição/suprimentos/caixas; ammoRestore 10..60)
Respeite o orçamento de 100 pontos: radiusMeters*0.9 + durationSec*0.45 + lethality*1.1 + (quantity*3.5 para spawn/supply) <= 100.
Para ENTITY_SPAWN ou SUPPLY_DROP, gere também palette (3 cores hex) e rleVoxels para grade 16x16x16.`,
      },
    });

    const parsed = JSON.parse((response.text ?? '{}').trim());
    const validArch: EventArchetype[] = [
      'WEATHER_HAZARD',
      'ENTITY_SPAWN',
      'TERRAIN_MUTATION',
      'SUPPLY_DROP',
    ];
    const archetype: EventArchetype = validArch.includes(parsed.archetype)
      ? parsed.archetype
      : 'WEATHER_HAZARD';

    const { params, budgetUsed, wasClamped } = validateAndClampEventParams(
      archetype,
      {
        radiusMeters: parsed.radiusMeters,
        durationSec: parsed.durationSec,
        lethality: parsed.lethality,
        quantity: parsed.quantity,
        weatherKind: parsed.weatherKind,
        mutationKind: parsed.mutationKind,
        aiBehavior: parsed.aiBehavior,
        ammoRestore: parsed.ammoRestore,
      },
      cleanPrompt,
    );

    const palette = normalizePalette(parsed.palette, [
      { hex: '#f43f5e', emissive: true },
      { hex: '#334155', emissive: false },
      { hex: '#cbd5e1', emissive: false },
    ]);

    let entityBlueprint: MapEventState['entityBlueprint'];
    if (archetype === 'ENTITY_SPAWN' || archetype === 'SUPPLY_DROP') {
      const decoded = decodeRleVoxels(parsed.rleVoxels ?? [], 16, 16, 16);
      let solidCount = 0;
      for (let i = 0; i < decoded.length; i++) if (decoded[i] > 0) solidCount++;
      const rle =
        solidCount >= 24
          ? encodeRleVoxels(decoded)
          : encodeRleVoxels(
              buildFallbackEntityVoxels(
                archetype === 'SUPPLY_DROP' ? 'supply_crate' : 'creature',
                palette.length,
                cleanPrompt,
              ),
            );
      entityBlueprint = {
        name: (parsed.entityName || cleanPrompt.slice(0, 24)).trim(),
        palette,
        rleVoxels: rle,
      };
    }

    loggedCooldownNotice = false;
    db.saveEvent(
      cleanPrompt,
      {
        archetype,
        params,
        entityBlueprint,
        budgetUsed,
        wasClamped,
      },
      'ai',
    );

    return {
      id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      authorId,
      authorName,
      prompt: cleanPrompt,
      archetype,
      warningRemainingSec: 5,
      durationRemainingSec: params.durationSec,
      totalDurationSec: params.durationSec,
      params,
      center,
      entityBlueprint,
      budgetUsed,
      wasClamped,
      fromDatabase: false,
    };
  } catch (err) {
    handleAiFallbackError('Event', err);
    if (stored) {
      const p = stored.payload;
      return {
        id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        authorId,
        authorName,
        prompt: cleanPrompt,
        archetype: p.archetype,
        warningRemainingSec: 5,
        durationRemainingSec: p.params.durationSec,
        totalDurationSec: p.params.durationSec,
        params: { ...p.params },
        center: [...center] as [number, number, number],
        entityBlueprint: p.entityBlueprint,
        budgetUsed: p.budgetUsed,
        wasClamped: p.wasClamped,
        fromDatabase: true,
      };
    }
    const fallback = buildProceduralEventFallback(cleanPrompt, authorId, authorName, center);
    db.saveEvent(
      cleanPrompt,
      {
        archetype: fallback.archetype,
        params: fallback.params,
        entityBlueprint: fallback.entityBlueprint,
        budgetUsed: fallback.budgetUsed,
        wasClamped: fallback.wasClamped,
      },
      'procedural',
    );
    return fallback;
  }
}
