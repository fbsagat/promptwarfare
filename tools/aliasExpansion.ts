import { normalizePrompt } from '../src/shared/prompt.ts';

function unique(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

/**
 * Expande aliases de um candidato a partir do prompt original, dos exemplos
 * agregados e da chave canônica. O objetivo é cobrir variações de ordem,
 * acentuação e formulação sem depender de embeddings.
 */
export function expandAliases(
  prompt: string,
  canonicalKey: string,
  examples: string[],
  max = 12,
): string[] {
  const base = [prompt, ...examples, canonicalKey.replace(/\|/g, ' ')];
  const normalized = base.map((value) => normalizePrompt(value));
  return unique([...base, ...normalized]).slice(0, max);
}
