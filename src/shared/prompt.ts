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
  'an',
  'of',
  'with',
  'for',
]);

export function normalizePrompt(prompt: string): string {
  return prompt
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function buildCanonicalKey(prompt: string): string {
  const norm = normalizePrompt(prompt);
  if (!norm) return '';
  const tokens = Array.from(
    new Set(
      norm
        .split(/\s+/)
        .filter((t) => t.length >= 2 && !STOP_WORDS.has(t)),
    ),
  ).sort();
  return tokens.length > 0 ? tokens.join('|') : norm;
}
