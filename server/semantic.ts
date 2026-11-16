import { normalizePrompt } from '../src/shared/prompt.ts';

const DIMENSIONS = 256;

const SYNONYMS: Record<string, string> = {
  congelante: 'gelo',
  congelar: 'gelo',
  congelado: 'gelo',
  crio: 'gelo',
  criogenico: 'gelo',
  glacial: 'gelo',
  frost: 'gelo',
  ice: 'gelo',
  freeze: 'gelo',
  neve: 'gelo',
  nevasca: 'gelo',
  fogo: 'fogo',
  chama: 'fogo',
  chamas: 'fogo',
  flamejante: 'fogo',
  incendiario: 'fogo',
  incendiaria: 'fogo',
  lava: 'fogo',
  solar: 'fogo',
  fire: 'fogo',
  burn: 'fogo',
  acido: 'acido',
  acida: 'acido',
  toxico: 'acido',
  toxica: 'acido',
  veneno: 'acido',
  venenoso: 'acido',
  toxic: 'acido',
  vazio: 'vazio',
  void: 'vazio',
  gravidade: 'vazio',
  gravitacional: 'vazio',
  buraco: 'vazio',
  negro: 'vazio',
  choque: 'choque',
  eletrico: 'choque',
  eletrica: 'choque',
  raio: 'choque',
  tesla: 'choque',
  trovao: 'choque',
  sonic: 'choque',
  sonoro: 'choque',
  electric: 'choque',
  ricochete: 'ricochete',
  ricocheteia: 'ricochete',
  quica: 'ricochete',
  quicar: 'ricochete',
  bouncing: 'ricochete',
  perfurante: 'perfurante',
  perfurar: 'perfurante',
  atravessa: 'perfurante',
  atravessar: 'perfurante',
  piercing: 'perfurante',
  grudenta: 'adesivo',
  grude: 'adesivo',
  gruda: 'adesivo',
  cola: 'adesivo',
  adesivo: 'adesivo',
  sticky: 'adesivo',
  teleguiado: 'teleguiado',
  teleguiada: 'teleguiado',
  persegue: 'teleguiado',
  homing: 'teleguiado',
  pistola: 'pistola',
  pistol: 'pistola',
  revolver: 'pistola',
  fuzil: 'rifle',
  carabina: 'rifle',
  espingarda: 'escopeta',
  shotgun: 'escopeta',
  metralhadora: 'smg',
  submetralhadora: 'smg',
  franco: 'sniper',
  precisao: 'sniper',
  bazuca: 'lancador',
  lancador: 'lancador',
  canhao: 'lancador',
  missil: 'lancador',
  foguete: 'lancador',
  meteoro: 'meteoro',
  meteorito: 'meteoro',
  terremoto: 'terremoto',
  tremor: 'terremoto',
  sismo: 'terremoto',
  criatura: 'criatura',
  monstro: 'criatura',
  bicho: 'criatura',
  lobo: 'criatura',
  lobos: 'criatura',
  zumbi: 'criatura',
  caixa: 'suprimento',
  municao: 'suprimento',
  suprimento: 'suprimento',
  suprimentos: 'suprimento',
  tesouro: 'suprimento',
  kit: 'suprimento',
  cura: 'suprimento',
};

const STOP_WORDS = new Set([
  'a',
  'as',
  'o',
  'os',
  'um',
  'uma',
  'uns',
  'umas',
  'de',
  'da',
  'do',
  'das',
  'dos',
  'com',
  'sem',
  'para',
  'por',
  'em',
  'no',
  'na',
  'nos',
  'nas',
  'que',
  'e',
  'the',
  'of',
  'with',
  'for',
  'and',
]);

function fnv1a(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function semanticTokens(text: string): string[] {
  return normalizePrompt(text)
    .split(/\s+/)
    .map((token) => SYNONYMS[token] ?? token)
    .filter((token) => token.length >= 2 && !STOP_WORDS.has(token));
}

function addFeature(vector: number[], feature: string, weight: number): void {
  const hash = fnv1a(feature);
  const index = hash % DIMENSIONS;
  const sign = (hash & 0x80000000) === 0 ? 1 : -1;
  vector[index] += sign * weight;
}

function normalizeVector(vector: number[]): number[] {
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (norm <= 0) return vector;
  return vector.map((value) => value / norm);
}

/**
 * Embedding lexical determinístico: unigramas (com sinônimos do domínio),
 * bigramas e trigramas de caractere. Não usa rede nem modelo externo; serve
 * para dedup e similaridade offline, com vocabulário do jogo.
 */
export function embedText(text: string): number[] {
  const vector = new Array<number>(DIMENSIONS).fill(0);
  const tokens = semanticTokens(text);
  for (const token of tokens) addFeature(vector, `w:${token}`, 1);
  for (let i = 0; i < tokens.length - 1; i++) {
    addFeature(vector, `b:${tokens[i]}_${tokens[i + 1]}`, 1.2);
  }
  const compact = normalizePrompt(text).replace(/[^a-z0-9]+/g, ' ');
  for (const token of compact.split(/\s+/)) {
    const padded = `^${token}$`;
    for (let i = 0; i < padded.length - 2; i++) {
      addFeature(vector, `c:${padded.slice(i, i + 3)}`, 0.15);
    }
  }
  return normalizeVector(vector);
}

export function embedTexts(texts: string[]): number[] {
  const vector = new Array<number>(DIMENSIONS).fill(0);
  const seen = new Set<string>();
  for (const text of texts) {
    const normalized = normalizePrompt(text);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    const embedded = embedText(text);
    for (let i = 0; i < DIMENSIONS; i++) vector[i] += embedded[i];
  }
  return normalizeVector(vector);
}

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  const length = Math.min(a.length, b.length);
  for (let i = 0; i < length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA <= 0 || normB <= 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export function textSimilarity(a: string, b: string): number {
  return cosineSimilarity(embedText(a), embedText(b));
}

export function textSetSimilarity(aTexts: string[], bTexts: string[]): number {
  return cosineSimilarity(embedTexts(aTexts), embedTexts(bTexts));
}
