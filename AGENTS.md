# AGENTS.md

Prompt Warfare is a server-authoritative 3D voxel battle royale: React 19 + Babylon.js client, Express + `ws` server, and Gemini-generated weapons/map events. It is a single package; player-facing text is Brazilian Portuguese.

Production topology: the static client is hosted on Vercel and the API + WebSocket run on a VPS. Local dev remains a single process with both on the same origin. See `docs/DEPLOY.md` before changing URLs, CORS, or deployment config.

## Commands

- Install: `bun install` (only `bun.lock` is committed; there is no `package-lock.json`, so `npm ci` will not work). Without Bun, use `npm install --legacy-peer-deps`; plain `npm install` fails because root `esbuild@^0.25` conflicts with Vite 8's peer `esbuild@^0.27 || ^0.28`.
- Dev: `npm run dev` runs one process on port 3000: `tsx server.ts` starts Express, WebSocket `/ws`, and Vite middleware. There is no separate frontend dev server.
- Typecheck: `npm run lint` is only `tsc --noEmit` despite its name. No ESLint, Prettier, or CI is configured.
- Tests use Node's built-in runner and run offline in ~1 s:
  - all: `npm test` (alias for `node --test`)
  - one file: `npm test -- server/roomManager.test.ts`
  - one test: `node --test --test-name-pattern "100-point" src/shared/logic.test.ts`
- Production (all-in-one): `npm run build` (client-only, outputs `dist/`) then `NODE_ENV=production npm start`. In PowerShell: `$env:NODE_ENV='production'; npm start`. Without `NODE_ENV=production`, `npm start` boots Vite middleware instead of serving `dist/`.
- Production (Vercel + VPS): Vercel builds/deploys the client via `vercel.json`; the VPS runs `NODE_ENV=production SERVE_CLIENT=false npm start` and needs `CORS_ORIGINS` set to the frontend origin.
- `npm run preview` is plain `vite preview`: it serves the built client without API/WebSocket, so the game will not connect. Use `npm start` to check production.
- Requires Node 22.18+ (native TypeScript execution; verified on Node 26). `npm run clean` removes `dist/` and `server.js` and works on Windows.

## Runtime architecture

- `server.ts` is the only entrypoint: CORS/preflight, REST (`/api/health`, `/api/rooms`, `/api/catalog`, `/api/ai/preview-weapon`), WebSocket `/ws`, then optional client serving. `HOST` controls the bind address; `SERVE_CLIENT=false` makes it API-only.
- `server/roomManager.ts` is authoritative for all match state: rooms, 20 Hz tick (50 ms, `dt = 0.05`), movement, voxels, projectiles, loot, bots, events, and broadcasts. WS messages are JSON `{ type, payload }`; add new client message types to its `handleClientMessage` switch. Rooms are in-memory only—restarting the server discards them.
- `src/App.tsx` is the client controller; it sends `player:input` on a 45 ms throttle and renders `room:tick` / `voxel:deltas`. Never trust client-computed state on the server. API/WS URLs are built in `src/shared/endpoints.ts` from `VITE_API_URL` / `VITE_WS_URL`; empty means same-origin.
- `server/aiGenerator.ts` calls Gemini (`gemini-4-hydrogen`, `ThinkingLevel.LOW`, structured JSON) and falls back to procedural generation when the key is missing, quota is exhausted, or generation fails. AI output is untrusted and must pass through `src/shared/budget.ts` validation/clamping.
- `server/blueprintDb.ts` caches generated weapons/events in SQLite (`node:sqlite`) at `data/voxelforge-blueprints.db` (override with `VOXELFORGE_DB_PATH`). Schema is created at startup; bumping `balance_version` deletes `source='procedural'` rows.
- `src/shared/` is the shared layer used by the browser and/or server: `budget.ts` (100-point balance, RLE, fallbacks), `voxelWorld.ts` (deterministic island generation, raycast, movement, destruction), `botBrain.ts` (server-driven bots), `controls.ts`, and protocol types in `types.ts`. Keep it free of DOM/Node-only APIs. `src/engine/` is browser-only Babylon rendering; voxel meshing runs in `greedyMesher.worker.ts`.
- Human-facing docs live in `README.md`, `docs/ARCHITECTURE.md`, `docs/DEPLOY.md`, and `docs/PROTOCOL.md`. Keep them in pt-BR and update the protocol table when adding WS message types.

## Invariants and gotchas

- Server/shared TypeScript runs in Node's strip-only mode: `enum`, `namespace`, parameter properties, and decorators throw at runtime even though `npm run lint` passes. Use `as const` objects/unions (see `MAT` in `types.ts`) and `import type` for type-only imports.
- Relative imports always include the extension (`./shared/types.ts`, `./App.tsx`). Extensionless imports break native Node execution.
- The 100-point weapon/event budget is a core game rule, not UI copy. Route all new stats/events through `budget.ts`; tests assert allocations normalize to 100 and no weapon is one-shot/overpowered.
- Dev tools are double-gated: client `import.meta.env.DEV` and server `NODE_ENV !== 'production'` (`src/shared/devMode.ts`). Never expose `dev:action` in production; `server/devMode.test.ts` enforces the gate.
- `vite.config.ts` intentionally supports disabling HMR/watch with `DISABLE_HMR=true` for automated edit environments. Keep that branch working.
- Env (server/VPS): `GEMINI_API_KEY` (placeholder `MY_GEMINI_API_KEY` disables the LLM), `PORT` (default 3000), `HOST` (default `0.0.0.0`), `NODE_ENV`, `SERVE_CLIENT`, `VOXELFORGE_DB_PATH`, `CORS_ORIGINS`, `DISABLE_HMR`. `server.ts` loads `dotenv/config`, which reads `.env`; `.env.local` is not loaded.
- Env (client/Vercel): `VITE_API_URL`, `VITE_WS_URL`. Vite inlines them at build time, so changing them requires a new Vercel deploy. Never put secrets in `VITE_*` variables.
- Cross-origin production: the frontend on Vercel calls the VPS directly. `CORS_ORIGINS` gates HTTP CORS and, when non-empty, the WebSocket `Origin`. Wildcards like `https://*.vercel.app` are supported. An HTTPS frontend requires `wss://`; Vercel does not proxy WebSockets.
- `vercel.json` deliberately overrides the install command to `npm install --legacy-peer-deps`; changing dependencies/scripts must keep the Vercel build working.
- Tests must stay offline: `server/aiGenerator.test.ts` blanks `GEMINI_API_KEY` and uses `:memory:` SQLite deliberately. `RoomManager` accepts `{ devEnabled }` and `SocketLike`; these are the test seams.
- World units: integer voxel grid with `VOXEL_SIZE = 0.3125`, `CHUNK_SIZE = 16`, `WATER_LEVEL_VOXEL = 10` (`src/shared/types.ts`). Room size scales with 4–14 target players.
- Keep new user-facing strings in pt-BR. The ~6.6 MB Babylon chunk warning during `npm run build` is expected.
