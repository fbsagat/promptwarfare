export function parseAllowedOrigins(raw?: string | null): string[] {
  return (raw ?? '')
    .split(',')
    .map((origin) => origin.trim().replace(/\/+$/, ''))
    .filter(Boolean);
}

function escapeRegex(value: string): string {
  return value.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Supports exact origins, `*`, and wildcard patterns such as
 * `https://*.vercel.app` (useful for Vercel preview deployments).
 */
export function isOriginAllowed(origin: string, allowedOrigins: string[]): boolean {
  if (!origin || allowedOrigins.length === 0) return false;

  return allowedOrigins.some((pattern) => {
    if (pattern === '*') return true;
    if (!pattern.includes('*')) return pattern.toLowerCase() === origin.toLowerCase();

    const regex = new RegExp(`^${escapeRegex(pattern).replace(/\*/g, '.*')}$`, 'i');
    return regex.test(origin);
  });
}
