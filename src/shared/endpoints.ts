export function normalizeBaseUrl(raw?: string | null): string {
  return (raw ?? '').trim().replace(/\/+$/, '');
}

/**
 * Builds an HTTP API URL. An empty base keeps the request same-origin, which is
 * the default for local development.
 */
export function buildHttpUrl(path: string, apiBase?: string | null): string {
  const base = normalizeBaseUrl(apiBase);
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return base ? `${base}${suffix}` : suffix;
}

/**
 * Resolves the WebSocket endpoint.
 *
 * Priority:
 * 1. explicit full WS URL (for example wss://api.example.com/ws);
 * 2. API base with the protocol swapped and `/ws` appended;
 * 3. current page origin (same-origin development).
 */
export function buildWsUrl(input: {
  apiBase?: string | null;
  wsUrl?: string | null;
  pageProtocol: string;
  pageHost: string;
}): string {
  const explicit = normalizeBaseUrl(input.wsUrl);
  if (explicit) return explicit;

  const base = normalizeBaseUrl(input.apiBase);
  if (!base) {
    const protocol = input.pageProtocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${input.pageHost}/ws`;
  }

  if (base.startsWith('//')) {
    const protocol = input.pageProtocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}${base}/ws`;
  }

  const wsBase = base.replace(/^https:/i, 'wss:').replace(/^http:/i, 'ws:');
  return `${wsBase}/ws`;
}
