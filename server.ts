import 'dotenv/config';
import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import {
  getAssetManifest,
  getAssetManifestByIds,
  getAssetVersion,
  getCoreAssetManifest,
} from './server/assets.ts';
import {
  getCatalogRuntimeStats,
  getCatalogSummary,
  getCatalogVersion,
  getResolverStats,
  reloadCatalog,
  resolveWeaponFromCatalog,
  startCatalogWatcher,
  stopCatalogWatcher,
} from './server/catalog.ts';
import { isOriginAllowed, parseAllowedOrigins } from './server/httpCors.ts';
import { createLedgerRuntime, ledgerBackendFromEnv } from './server/ledgerFactory.ts';
import { buildLoopReport } from './server/loopReport.ts';
import { buildMetricsSnapshot, type MetricsSnapshot } from './server/metrics.ts';
import { renderPrometheusMetrics } from './server/prometheus.ts';
import { aggregateUsageWeights } from './server/contentPool.ts';
import { RoomManager } from './server/roomManager.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ASSETS_FILES_DIR = path.join(__dirname, 'content', 'assets', 'files');

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;
  const HOST = process.env.HOST?.trim() || '0.0.0.0';
  const allowedOrigins = parseAllowedOrigins(process.env.CORS_ORIGINS);
  const serveClient = process.env.SERVE_CLIENT !== 'false';

  app.use((req, res, next) => {
    const origin = req.headers.origin;
    const allowed = Boolean(origin && isOriginAllowed(origin, allowedOrigins));

    if (origin) res.setHeader('Vary', 'Origin');
    if (allowed && origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Metrics-Token');
      res.setHeader('Access-Control-Max-Age', '86400');
    }

    if (req.method === 'OPTIONS' && origin) {
      res.status(allowed ? 204 : 403).end();
      return;
    }

    next();
  });

  app.use(express.json({ limit: '1mb' }));

  // Assets estáticos do manifesto (SFX/texturas). Em produção com CDN/MinIO,
  // ASSET_BASE_URL tem precedência e estes arquivos são servidos pelo bucket.
  app.use(
    '/assets/files',
    express.static(ASSETS_FILES_DIR, {
      etag: true,
      maxAge: '30d',
      immutable: true,
      fallthrough: true,
      setHeaders: (res) => {
        res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      },
    }),
  );

  const ledger = await createLedgerRuntime();
  const roomManager = new RoomManager({ ledger });
  process.once('exit', () => {
    void ledger.close();
  });

  const metricsWindowDays = Math.max(
    1,
    Number(process.env.METRICS_WINDOW_DAYS) || 90,
  );
  const metricsToken = process.env.METRICS_TOKEN?.trim() || '';
  let metricsLoop: ReturnType<typeof buildLoopReport> | null = null;
  let metricsCache: MetricsSnapshot | null = null;
  const assetMetrics = {
    coreRequests: 0,
    subsetRequests: 0,
    fullRequests: 0,
    requestedIds: 0,
    servedAssets: 0,
    rejectedRequests: 0,
  };

  const refreshMetrics = async (): Promise<void> => {
    try {
      const since = Date.now() - metricsWindowDays * 24 * 60 * 60 * 1000;
      const prompts = await ledger.readPromptEvents(100000, since);
      const usage = await ledger.readContentUsage(100000, since);
      metricsLoop = buildLoopReport(prompts, usage, getCatalogVersion());
      roomManager.setUsageWeights(aggregateUsageWeights(usage));
      metricsCache = buildMetricsSnapshot({
        loop: metricsLoop,
        rooms: roomManager.getRuntimeStats(),
        uptimeSec: process.uptime(),
        catalogVersion: getCatalogVersion(),
        assetVersion: getAssetVersion(),
        catalog: getCatalogRuntimeStats(),
        resolver: getResolverStats(),
        assets: assetMetrics,
      });
    } catch (err) {
      console.warn('[Métricas] falha ao atualizar snapshot:', (err as Error).message);
    }
  };

  setImmediate(() => {
    void refreshMetrics();
  });
  const metricsTimer = setInterval(() => {
    void refreshMetrics();
  }, 60_000);
  metricsTimer.unref();

  if (process.env.CATALOG_WATCH !== 'false') {
    startCatalogWatcher();
    console.log('[Catálogo] hot reload ativo (CATALOG_WATCH=false para desligar)');
  }

  const reloadCatalogNow = (): void => {
    try {
      const result = reloadCatalog();
      console.log(
        `[Catálogo] recarga manual: ${result.version} (${result.weapons} armas, ${result.events} eventos)`,
      );
      void refreshMetrics();
    } catch (err) {
      console.warn(
        `[Catálogo] recarga manual falhou; mantendo a versão anterior: ${(err as Error).message}`,
      );
    }
  };
  process.on('SIGHUP', reloadCatalogNow);

  app.get('/api/health', (_req, res) => {
    const stats = roomManager.getRuntimeStats();
    res.json({
      ok: true,
      rooms: stats.rooms,
      playing: stats.playing,
      lobby: stats.lobby,
      humans: stats.humans,
      bots: stats.bots,
      uptimeSec: Math.round(process.uptime()),
      devMode: roomManager.isDevModeEnabled(),
      catalogVersion: getCatalogVersion(),
      assetVersion: getAssetVersion(),
    });
  });

  const currentMetricsSnapshot = (): MetricsSnapshot | null =>
    metricsLoop
      ? buildMetricsSnapshot({
          loop: metricsLoop,
          rooms: roomManager.getRuntimeStats(),
          uptimeSec: process.uptime(),
          catalogVersion: getCatalogVersion(),
          assetVersion: getAssetVersion(),
          catalog: getCatalogRuntimeStats(),
          resolver: getResolverStats(),
          assets: assetMetrics,
          generatedAt: metricsLoop.generatedAt,
        })
      : metricsCache;

  app.get('/api/metrics', async (req, res) => {
    if (metricsToken && req.headers['x-metrics-token'] !== metricsToken) {
      res.status(401).json({ error: 'Métricas protegidas.' });
      return;
    }
    if (!metricsLoop) await refreshMetrics();
    const snapshot = currentMetricsSnapshot();
    res.setHeader('Cache-Control', 'no-store');
    res.json(snapshot ?? { error: 'Métricas indisponíveis.' });
  });

  // Scrape Prometheus da stack interna. Não deve ser publicado publicamente
  // pelo nginx; o container só é alcançável pela rede Docker de monitoramento.
  app.get('/metrics', async (_req, res) => {
    if (!metricsLoop) await refreshMetrics();
    const snapshot = currentMetricsSnapshot();
    if (!snapshot) {
      res.status(503).type('text/plain; charset=utf-8').send('# métricas indisponíveis\n');
      return;
    }
    res.setHeader('Cache-Control', 'no-store');
    res
      .type('text/plain; version=0.0.4; charset=utf-8')
      .send(renderPrometheusMetrics(snapshot, ledgerBackendFromEnv()));
  });

  app.get('/api/rooms', (_req, res) => {
    res.json({ rooms: roomManager.getRoomList() });
  });

  app.get('/api/catalog', (_req, res) => {
    res.json(getCatalogSummary());
  });

  app.get('/api/assets/core', (_req, res) => {
    assetMetrics.coreRequests += 1;
    const core = getCoreAssetManifest();
    assetMetrics.servedAssets += core.assets.length;
    res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
    res.json(core);
  });

  app.get('/api/assets', (req, res) => {
    const raw = typeof req.query.ids === 'string' ? req.query.ids.trim() : '';
    if (!raw) {
      assetMetrics.fullRequests += 1;
      const manifest = getAssetManifest();
      assetMetrics.servedAssets += manifest.assets.length;
      res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
      res.json(manifest);
      return;
    }
    const ids = raw
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean);
    if (ids.length > 256) {
      assetMetrics.rejectedRequests += 1;
      res.status(400).json({ error: 'Muitos assets por requisição (máximo 256).' });
      return;
    }
    assetMetrics.subsetRequests += 1;
    assetMetrics.requestedIds += ids.length;
    const subset = getAssetManifestByIds(ids);
    assetMetrics.servedAssets += subset.assets.length;
    res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=600');
    res.json(subset);
  });

  app.post('/api/ai/preview-weapon', (req, res) => {
    try {
      const prompt = String(req.body?.prompt ?? '').slice(0, 90);
      if (!prompt.trim()) {
        res.status(400).json({ error: 'Prompt vazio.' });
        return;
      }
      const resolution = resolveWeaponFromCatalog(prompt);
      const catalogVersion = getCatalogVersion();
      ledger.record({
        sessionId: `preview_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        actorType: 'preview',
        actorRef: null,
        roomId: null,
        matchId: null,
        kind: 'weapon',
        phase: 'submitted',
        prompt,
        itemId: resolution.itemId,
        strategy: resolution.strategy,
        catalogVersion,
        budgetUsed: resolution.blueprint.budgetUsed,
        wasClamped: resolution.blueprint.wasClamped,
        elapsedMs: null,
        reason: null,
      });
      res.json({
        weapon: resolution.blueprint,
        catalogVersion,
        strategy: resolution.strategy,
      });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });

  const shutdown = () => {
    clearInterval(metricsTimer);
    stopCatalogWatcher();
    process.removeListener('SIGHUP', reloadCatalogNow);
    void ledger.close();
    wss.close();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);

  wss.on('connection', (ws, req) => {
    const origin = req.headers.origin;
    if (origin && allowedOrigins.length > 0 && !isOriginAllowed(origin, allowedOrigins)) {
      ws.close(1008, 'Origin not allowed');
      return;
    }

    let boundRoomId: string | null = null;
    let boundPlayerId: string | null = null;

    const releaseCurrentBinding = () => {
      if (boundRoomId && boundPlayerId) {
        roomManager.handleDisconnect(boundRoomId, boundPlayerId);
      }
      boundRoomId = null;
      boundPlayerId = null;
    };

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg?.type === 'rooms:list') {
          ws.send(JSON.stringify({ type: 'rooms:list', payload: { rooms: roomManager.getRoomList() } }));
          return;
        }

        if (msg?.type === 'room:create') {
                                          releaseCurrentBinding();
                                          const res = roomManager.createAndJoinRoom(ws, {
                                            roomId: msg.payload?.roomId,
                                            roomName: msg.payload?.roomName,
                                            playerName: msg.payload?.playerName,
                                            accessMode: msg.payload?.accessMode,
                                            gameMode: msg.payload?.gameMode,
                                            password: msg.payload?.password,
                                            targetPlayers: msg.payload?.targetPlayers,
                                            fillWithBots: msg.payload?.fillWithBots,
                                            startImmediately: msg.payload?.startImmediately,
                                            arsenalMatchDuration: msg.payload?.arsenalMatchDuration,
                                            arsenalMaxKills: msg.payload?.arsenalMaxKills,
                                            arsenalAutoEvents: msg.payload?.arsenalAutoEvents,
                                            arsenalTeams: msg.payload?.arsenalTeams,
                                          });
                          if (res) {
                            boundRoomId = res.room.id;
                            boundPlayerId = res.playerId;
                          }
                          return;
                        }

        if (msg?.type === 'room:join') {
          releaseCurrentBinding();
          const res = roomManager.joinExistingRoom(ws, {
            roomId: msg.payload?.roomId,
            playerName: msg.payload?.playerName,
            password: msg.payload?.password,
          });
          if (res) {
            boundRoomId = res.room.id;
            boundPlayerId = res.playerId;
          }
          return;
        }

        if (msg?.type === 'room:quick_play') {
          releaseCurrentBinding();
          const res = roomManager.quickPlayOrJoin(ws, {
            roomId: msg.payload?.roomId,
            playerName: msg.payload?.playerName,
            targetPlayers: msg.payload?.targetPlayers,
            fillWithBots: msg.payload?.fillWithBots,
          });
          if (res) {
            boundRoomId = res.room.id;
            boundPlayerId = res.playerId;
          }
          return;
        }

        if (msg?.type === 'room:leave') {
          releaseCurrentBinding();
          return;
        }

        if (boundRoomId && boundPlayerId) {
          roomManager.handleClientMessage(boundRoomId, boundPlayerId, msg);
        }
      } catch (err) {
        console.error('[WS Message Error]', err);
      }
    });

    ws.on('close', () => {
      releaseCurrentBinding();
    });
  });

  if (!serveClient) {
    console.log('[server] client serving disabled (SERVE_CLIENT=false)');
  } else if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  server.listen(PORT, HOST, () => {
    console.log(`Prompt Warfare server running on http://${HOST}:${PORT}`);
    console.log(
      `[cors] ${allowedOrigins.length > 0 ? allowedOrigins.join(', ') : 'same-origin only'}`,
    );
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
