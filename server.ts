import 'dotenv/config';
import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { getAssetManifest, getAssetVersion } from './server/assets.ts';
import {
  getCatalogSummary,
  getCatalogVersion,
  resolveWeaponFromCatalog,
} from './server/catalog.ts';
import { isOriginAllowed, parseAllowedOrigins } from './server/httpCors.ts';
import { PromptLedger } from './server/ledger.ts';
import { RoomManager } from './server/roomManager.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      res.setHeader('Access-Control-Max-Age', '86400');
    }

    if (req.method === 'OPTIONS' && origin) {
      res.status(allowed ? 204 : 403).end();
      return;
    }

    next();
  });

  app.use(express.json({ limit: '1mb' }));

  const ledger = new PromptLedger();
  const roomManager = new RoomManager({ ledger });
  const catalogVersion = getCatalogVersion();
  const assetVersion = getAssetVersion();
  process.once('exit', () => ledger.close());

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      rooms: roomManager.getRoomList().length,
      devMode: roomManager.isDevModeEnabled(),
      catalogVersion,
      assetVersion,
    });
  });

  app.get('/api/rooms', (_req, res) => {
    res.json({ rooms: roomManager.getRoomList() });
  });

  app.get('/api/catalog', (_req, res) => {
    res.json(getCatalogSummary());
  });

  app.get('/api/assets', (_req, res) => {
    res.json(getAssetManifest());
  });

  app.post('/api/ai/preview-weapon', (req, res) => {
    try {
      const prompt = String(req.body?.prompt ?? '').slice(0, 90);
      if (!prompt.trim()) {
        res.status(400).json({ error: 'Prompt vazio.' });
        return;
      }
      const resolution = resolveWeaponFromCatalog(prompt);
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
    ledger.close();
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
            password: msg.payload?.password,
            targetPlayers: msg.payload?.targetPlayers,
            fillWithBots: msg.payload?.fillWithBots,
            startImmediately: msg.payload?.startImmediately,
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
