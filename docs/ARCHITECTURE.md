# Arquitetura

## Visão geral

O Prompt Warfare tem dois lados bem separados: um cliente estático e um servidor autoritativo.

```text
Vercel (HTTPS)                          VPS (HTTPS/WSS)
React + Babylon.js  ── /api/* ────────▶ server.ts (Express + ws)
                    ── /ws (wss) ─────▶   └── RoomManager (20 Hz)
                                              ├── VoxelGrid / física / combate / bots
                                              ├── catalog (JSON versionado)
                                              ├── ledger (SQLite append-only)
                                              └── resolvedor local (sem IA)
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
- Reiniciar o processo apaga salas e partidas. O catálogo é um arquivo versionado e permanece entre reinícios.

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

### `server/catalog.ts`

O runtime não gera conteúdo. Ele carrega `content/catalog/catalog.json` no boot e resolve o prompt contra itens **não depreciados**:

1. Normaliza o prompt e a chave canônica (`src/shared/prompt.ts`).
2. Tenta alias exato, depois chave canônica, depois tokens/tags e palavras-chave de arquétipo/elemento.
3. Se o pedido combina uma capacidade já presente no item-base com outra existente em outro item, tenta uma **composição** validada pelo orçamento. Combinações impossíveis (dois status ou dois comportamentos) não são compostas.
4. Match fraco (< 120 pontos), ambíguo ou composição que estourou o orçamento vira `partial`: o item mais próximo é servido, mas o pedido é registrado como lacuna duvidosa.
5. Se nada casar, usa um item default do catálogo. Nunca chama rede ou LLM.
6. Devolve uma cópia do blueprint/evento com ID novo e `fromCatalog: true`.

O catálogo é read-only, usa `schemaVersion: 3` e versionamento por release. Cada item carrega `status` (`approved`/`deprecated`), `provenance` (`procedural`, `ai_assisted`, `authored`, `template` ou `seed`) e `introducedIn` (versão de entrada, usada para novidade). `getCatalogVersion()` aparece em `room:init`/`room:tick`. Com `CATALOG_WATCH` ligado (padrão), o arquivo é recarregado de forma atômica quando muda; `SIGHUP` força a recarga. A malha RLE continua `12×12×24` para armas e `16×16×16` para entidades.

O estado do evento transmitido à sala usa o **nome do item do catálogo**, não o texto cru do jogador; o prompt original fica apenas no ledger.

### `server/contentPool.ts`

Cada partida recebe um arsenal determinístico a partir de `room.seed`, `catalogVersion`, versão do algoritmo e snapshot de uso:

- núcleo obrigatório: defaults, um item por elemento, um por arquétipo, um por categoria de evento;
- tamanho entre 16–26 armas e 7–11 eventos, conforme `targetPlayers`;
- peso inverso ao uso humano recente (`equip`/`event`) e quota de novidade para `introducedIn` recente ou `provenance` `ai_assisted`/`authored`;
- `hash` e contagem de itens aparecem em `room:init`/`room:tick` (`contentPool`);
- itens `deprecated` e pools vazios caem para o catálogo completo.

O resolvedor recebe os IDs do pool e a composição só usa doadores do próprio pool. Se o item ideal existe no catálogo mas não no pool, o ledger grava `pool_miss = 1` e `pool_hash`; isso é **pool miss**, não lacuna de catálogo. O `loop:report` e o `ledger:report` separam os dois casos.

### `server/ledger.ts`

Ledger append-only de prompts em SQLite (`node:sqlite`) por padrão, com backend Postgres opcional para múltiplas instâncias (`PROMPT_LEDGER_BACKEND=postgres`, driver `pg` carregado dinamicamente):

- tabela `prompt_events` com uma linha por fase (`opened`, `submitted`, `cancelled`, `timed_out`);
- `session_id` correlaciona abertura, envio e abandono;
- guarda ator (`human`, `bot`, `dev`, `preview`, `system`), sala, partida, prompt normalizado/canônico, item servido, estratégia, orçamento, `catalog_version`, tempo de escrita, motivo, `pool_hash` e `pool_miss`;
- não guarda nomes de jogador, apenas `actor_ref` pseudônimo;
- grava em lote a cada ~100 ms para não bloquear o tick;
- caminho padrão `data/prompt-ledger.db` (`PROMPT_LEDGER_DB_PATH`).

### `server/assets.ts`

- Lê `content/assets/manifest.json` no boot; runtime read-only.
- IDs lógicos para `texture`, `sound`, `effect` e `waypoint`, com `status` e `params`.
- `assetVersion` aparece em `room:init`/`room:tick`; o catálogo referencia IDs de assets.
- O manifesto é validado por `server/assets.test.ts`; a ligação do cliente por ID ainda é a próxima etapa.

### Telemetria de uso

- `content_usage` registra `equip`, `kill` e `event` por item, jogador/partida e versão do catálogo.
- `server/usageReport.ts` + `tools/usage-report.ts` geram `content/reports/usage-*.json/.md` com equipes, abates, eventos e abates/equipe por item.
- `server/loopReport.ts` + `tools/loop-report.ts` cruzam `prompt_events` com `content_usage`: cobertura por versão, lacunas fechadas/persistentes/regredidas e qualidade por item.
- Bots são excluídos por padrão; use `--include-bots` para auditá-los.

### Observabilidade

- `GET /api/health` expõe salas, jogadores humanos/bots, uptime e versões atuais.
- `GET /api/metrics` expõe um snapshot agregado de cobertura, lacunas e itens com demanda/uso; não inclui texto de prompt. O snapshot do ledger é atualizado a cada 60 s, enquanto salas e uptime são lidos ao vivo. Também inclui `alerts` para baixa cobertura, pool miss alto, lacunas regredidas, cobertura duvidosa excessiva e ausência de uso.
- `GET /metrics` expõe o mesmo snapshot em formato Prometheus (`text/plain; version=0.0.4`) para o scrape interno da stack Grafana/Prometheus. Não deve ser publicado pelo nginx.
- `METRICS_TOKEN` (opcional) exige o header `X-Metrics-Token`; `METRICS_WINDOW_DAYS` controla a janela (padrão 90).

### Ferramentas offline (`tools/`)

- `tools/build-catalog.ts` gera o catálogo procedural determinístico e **preserva** itens promovidos/artesanais fora da base; use `--reset` para descartá-los (`npx tsx tools/build-catalog.ts [versão]`).
- `tools/seed-demand.ts` gera `content/seeds/initial-demand-report.json/.md` a partir da demanda sintética inicial.
- `tools/ledger-report.ts` lê o ledger e gera `content/reports/demand-*.json/.md` com intenções, lacunas, abandono e cobertura; use `--days N` para limitar a janela.
- `tools/usage-report.ts` lê `content_usage` e gera o relatório de qualidade.
- `tools/loop-report.ts` cruza demanda, uso e versões para verificar se a publicação fechou a lacuna.
- `tools/catalog-candidates.ts` transforma lacunas em candidatos usando a ferramenta Gemini offline e expande aliases (`tools/aliasExpansion.ts`).
- `tools/promote-candidates.ts` valida candidatos aprovados, mescla aliases em itens existentes e publica uma nova versão do catálogo.
- `tools/aiGenerator.ts` é a ferramenta Gemini para produzir candidatos; não é importada pelo servidor.
- `tools/blueprintDb.ts` é o cache SQLite (`node:sqlite`) da ferramenta offline, em `data/voxelforge-blueprints.db` (`VOXELFORGE_DB_PATH`).
- Todo candidato passa por `src/shared/budget.ts` e por curadoria humana antes de entrar no catálogo.

## Código compartilhado (`src/shared`)

| Arquivo | Responsabilidade |
| --- | --- |
| `types.ts` | Protocolo, constantes de voxel e tipos de domínio. Fonte da verdade dos payloads. |
| `budget.ts` | Orçamento de 100 pontos, normalização, clamps, RLE e geradores de fallback. |
| `prompt.ts` | Normalização de prompt e chave canônica usadas pelo resolvedor e pelo cache offline. |
| `voxelWorld.ts` | Ilha procedural determinística, raycast, movimento, carving e colapso de estruturas. |
| `botBrain.ts` | Personalidades, seleção de alvo, mira com previsão e decisões dos bots (executado no servidor). |
| `controls.ts` | Cálculo de look/edge turn compartilhado com o cliente. |
| `devMode.ts` | Gating de desenvolvimento no servidor e no cliente. |
| `endpoints.ts` | Resolve URLs HTTP/WebSocket para mesma origem ou Vercel + VPS. |

Esses módulos não devem depender de DOM nem de APIs exclusivas do Node.

## Cliente (`src`)

- `App.tsx` mantém o WebSocket, o estado da UI, o roteamento das mensagens e os overlays.
- `components/` contém lobby, sala de espera, HUD, barra mínima de prompt (`PromptBar`), pausa e fim de partida.
- `engine/babylonArena.ts` monta a cena, câmera, iluminação, projéteis, avatares e aplica deltas de voxels.
- `engine/greedyMesher.worker.ts` faz greedy meshing por chunk em Web Worker; os chunks têm 16³ voxels e são enviados com padding para consulta O(1) de vizinhos.
- `engine/voxelMeshBuilder.ts` converte RLE em malhas de armas, criaturas e avatares.
- `engine/soundSynth.ts` sintetiza efeitos via Web Audio; não há arquivos de áudio carregados pelo código.

## Regras de balanceamento

- Armas e eventos têm orçamento fixo de **100 pontos**.
- O orçamento é interno: o jogador descreve a arma/evento, mas não distribui pontos manualmente. Bots podem usar perfis internos de estilo.
- O servidor sempre revalida e aplica clamp no que vem do cliente ou da IA; `wasClamped` indica correção.
- Prompts com padrões de abuso (vida infinita, one-shot, "mate todos") são tratados como suspeitos e normalizados.
- Forja inicial: 10 s de espera. Após criar uma arma: 30 s. Escrita da arma: 20 s. Evento global: 24 s de ciclo, 10 s para o sorteado reivindicar e 20 s de escrita. Máximo de 3 eventos ativos.
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
- `tools/aiGenerator.test.ts` usa SQLite `:memory:` e zera `GEMINI_API_KEY` para nunca acessar a rede. `server/catalog.test.ts` valida o catálogo e o resolvedor.
- `server/roomManager.test.ts` e `server/devMode.test.ts` usam `MockSocket` e o parâmetro `{ devEnabled }` para simular clientes e ambientes.
