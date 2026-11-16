# Arquitetura

## Visão geral

O Prompt Warfare tem dois lados bem separados: um cliente estático e um servidor autoritativo.

```text
Vercel (HTTPS)                          VPS (HTTPS/WSS)
React + Babylon.js  ── /api/* ────────▶ server.ts (Express + ws)
                    ── /ws (wss) ─────▶   └── RoomManager (20 Hz)
                                              ├── VoxelGrid / física / combate / bots
                                              ├── aiGenerator (Gemini + fallback)
                                              └── blueprintDb (SQLite)
```

Em desenvolvimento, o `server.ts` monta o Vite em modo middleware e serve o frontend na mesma origem. Em produção, o build do cliente fica na Vercel e a VPS roda apenas a API/WebSocket (`SERVE_CLIENT=false`). O `server.ts` ainda consegue servir `dist/`, o que é útil para um deploy all-in-one ou para testes locais de produção.

### Separação de origens

- O cliente resolve a API com `VITE_API_URL` e o WebSocket com `VITE_WS_URL` (ou deriva de `VITE_API_URL`); sem essas variáveis, usa a mesma origem. A lógica fica em `src/shared/endpoints.ts`.
- A VPS libera CORS e, opcionalmente, valida a origem do handshake WebSocket com `CORS_ORIGINS` (`server/httpCors.ts`). A lista aceita `*` e curingas como `https://*.vercel.app`.
- `HOST` controla a interface de escuta; atrás de proxy reverso, use `127.0.0.1`.
- `SERVE_CLIENT=false` desliga o middleware Vite e os arquivos estáticos na VPS.
- O passo a passo de infraestrutura está em [DEPLOY.md](DEPLOY.md).

## Autoridade e loop

- Todo o estado de partida vive no servidor, em memória: jogadores, grade de voxels, projéteis, loot, entidades, eventos e placar.
- O cliente envia entradas (`player:input`) com throttle de 45 ms e ações pontuais; nunca calcula dano, colisão ou destruição.
- O `RoomManager` executa `tickRoom(room, 0.05)` a cada 50 ms (20 Hz): atualiza timers, eventos, jogadores, bots, projéteis, entidades e envia `room:tick` + `voxel:deltas`.
- Colisão e movimento usam a mesma implementação de `src/shared/voxelWorld.ts` nos dois lados, mas só o resultado do servidor é autoritativo.
- Reiniciar o processo apaga salas e partidas. Apenas os blueprints de IA persistem em SQLite.

## Fases da sala

| Fase | Comportamento |
| --- | --- |
| `lobby` | Jogadores entram, o Master ajusta nome, vagas (4–14), bots e acesso (aberta, senha ou fechada). |
| `playing` | Loop de 20 Hz ativo, forja e eventos liberados, bots simulados no servidor. |
| `ended` | Resta no máximo um jogador vivo; o resumo fica disponível e o Master pode reiniciar. |

## Módulos do servidor

### `server.ts`

Entrada única da aplicação:

- `GET /api/health`, `/api/rooms`, `/api/catalog`, `POST /api/ai/preview-weapon`.
- Middleware de CORS/preflight baseado em `CORS_ORIGINS`; a mesma lista valida o `Origin` do WebSocket quando não está vazia.
- WebSocket em `/ws`; mensagens de criação/entrada em sala são tratadas antes de delegar ao `RoomManager`.
- Em desenvolvimento, importa o Vite dinamicamente e usa `appType: 'spa'`; em produção, serve `dist/` quando `SERVE_CLIENT` não é `false`. A escolha é feita por `NODE_ENV` e `SERVE_CLIENT`.
- `HOST` define a interface de escuta (padrão `0.0.0.0`; use `127.0.0.1` na VPS com proxy reverso).

### `server/roomManager.ts`

Núcleo do jogo. Concentra:

- criação, entrada, saída, kick, transferência de host, início e reinício;
- simulação de movimento, água/afogamento, voxels, projéteis, loot, entidades e bots;
- sorteio e aplicação de eventos, incluindo catástrofes anti-estagnação;
- broadcast de estado (`room:tick`, `lobby_state`, `killfeed`, `voxel:deltas`, efeitos);
- dev mode opcional, com ferramentas extras bloqueadas fora de desenvolvimento.

Novas mensagens de cliente devem ser adicionadas ao `switch` de `handleClientMessage`.

### `server/aiGenerator.ts`

Pipeline de geração:

1. Normaliza o prompt e consulta o cache por chave canônica (ignora acentos, pontuação e ordem das palavras) e pela alocação de pontos.
2. Com `GEMINI_API_KEY` válida, chama `gemini-4-hydrogen` com `responseSchema` estrito e `ThinkingLevel.LOW`.
3. Valida e limita a resposta com as regras de `src/shared/budget.ts` (orçamento, faixas de atributos, riscos, paleta e RLE).
4. Persiste o blueprint e devolve uma cópia com ID novo.
5. Sem chave, em erro ou durante cooldown de quota, usa o gerador procedural e salva o resultado como `procedural`.

Armas usam malha RLE `12×12×24`; entidades de evento usam `16×16×16`. O cliente monta as malhas a partir desses dados.

### `server/blueprintDb.ts`

- SQLite via `node:sqlite`, com WAL e `synchronous = NORMAL`.
- Caminho padrão `data/voxelforge-blueprints.db`; pode ser trocado por `VOXELFORGE_DB_PATH`.
- Tabelas `weapon_blueprints`, `event_blueprints` e `schema_meta`; o schema é criado no startup, sem migrations.
- A versão de balanceamento atual fica em `schema_meta.balance_version`. Quando muda, blueprints `procedural` são apagados para forçar regeneração; blueprints de IA são preservados.

## Código compartilhado (`src/shared`)

| Arquivo | Responsabilidade |
| --- | --- |
| `types.ts` | Protocolo, constantes de voxel e tipos de domínio. Fonte da verdade dos payloads. |
| `budget.ts` | Orçamento de 100 pontos, normalização, clamps, RLE e geradores de fallback. |
| `voxelWorld.ts` | Ilha procedural determinística, raycast, movimento, carving e colapso de estruturas. |
| `botBrain.ts` | Personalidades, seleção de alvo, mira com previsão e decisões dos bots (executado no servidor). |
| `controls.ts` | Cálculo de look/edge turn compartilhado com o cliente. |
| `devMode.ts` | Gating de desenvolvimento no servidor e no cliente. |
| `endpoints.ts` | Resolve URLs HTTP/WebSocket para mesma origem ou Vercel + VPS. |

Esses módulos não devem depender de DOM nem de APIs exclusivas do Node.

## Cliente (`src`)

- `App.tsx` mantém o WebSocket, o estado da UI, o roteamento das mensagens e os overlays.
- `components/` contém lobby, sala de espera, HUD, prompt de arma/evento, pausa e fim de partida.
- `engine/babylonArena.ts` monta a cena, câmera, iluminação, projéteis, avatares e aplica deltas de voxels.
- `engine/greedyMesher.worker.ts` faz greedy meshing por chunk em Web Worker; os chunks têm 16³ voxels e são enviados com padding para consulta O(1) de vizinhos.
- `engine/voxelMeshBuilder.ts` converte RLE em malhas de armas, criaturas e avatares.
- `engine/soundSynth.ts` sintetiza efeitos via Web Audio; não há arquivos de áudio carregados pelo código.

## Regras de balanceamento

- Armas e eventos têm orçamento fixo de **100 pontos**.
- A alocação de arma distribui pontos entre poder de fogo, cadência/munição, precisão/alcance e destruição.
- O servidor sempre revalida e aplica clamp no que vem do cliente ou da IA; `wasClamped` indica correção.
- Prompts com padrões de abuso (vida infinita, one-shot, "mate todos") são tratados como suspeitos e normalizados.
- Forja inicial: 10 s de espera. Após criar uma arma: 30 s. Prompt de arma: 20 s. Ciclo de evento: 24 s. Máximo de 3 eventos ativos.
- Sem eliminações por muito tempo, o servidor escala catástrofes automáticas (120 s + 45 s por nível de estagnação).

## Dev mode

O modo de desenvolvimento exige **as duas condições**:

- cliente compilado em modo dev (`import.meta.env.DEV`);
- servidor com `NODE_ENV !== 'production'`.

O servidor pode ser instanciado com `new RoomManager({ devEnabled })` e expõe ferramentas como deus, sandbox infinito, congelar bots, forja rápida e spawn de bots. Em produção, `dev:action` é ignorado. O painel abre com `F8`.

## Testes

- Runner nativo do Node (`node --test`), sem framework externo.
- `src/shared/logic.test.ts` cobre orçamento, RLE, voxels, geração de ilha, física e bots.
- `src/shared/endpoints.test.ts` cobre mesma origem, API externa, derivação `https → wss` e URL explícita de WebSocket.
- `server/httpCors.test.ts` cobre origens exatas, wildcard global, curingas de preview e lista vazia.
- `server/aiGenerator.test.ts` usa SQLite `:memory:` e zera `GEMINI_API_KEY` para nunca acessar a rede.
- `server/roomManager.test.ts` e `server/devMode.test.ts` usam `MockSocket` e o parâmetro `{ devEnabled }` para simular clientes e ambientes.
