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
- Slots e loot no fio carregam só `weaponId`; o blueprint completo é transmitido uma vez em `content:items` (ou em `room:init.contentItems`) e cacheado no cliente. O cliente hidrata o estado antes do HUD/renderização com `src/shared/contentHydration.ts`.
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

O runtime não gera conteúdo. Ele carrega o **índice quente** `content/catalog/index.json` no boot e resolve o prompt contra itens **não depreciados**:

1. Normaliza o prompt e a chave canônica (`src/shared/prompt.ts`).
2. Tenta alias exato, depois chave canônica, depois tokens/tags e palavras-chave de arquétipo/elemento. Aliases, chaves canônicas, tokens e palavras-chave são pré-computados uma vez por versão do catálogo; um índice invertido restringe a pontuação aos candidatos, sem varrer todos os itens.
3. Se o pedido combina uma capacidade já presente no item-base com outra existente em outro item, tenta uma **composição** validada pelo orçamento. Combinações impossíveis (dois status ou dois comportamentos) não são compostas.
4. Match fraco (< 120 pontos), ambíguo ou composição que estourou o orçamento vira `partial`: o item mais próximo é servido, mas o pedido é registrado como lacuna duvidosa.
5. Se nada casar, usa um item default do catálogo. Nunca chama rede ou LLM.
6. Devolve uma cópia do blueprint/evento com ID novo e `fromCatalog: true`.

`content/catalog/catalog.json` continua sendo o artefato completo para build, testes e ferramentas offline. O runtime usa `index.json` (metadados + `budgetUsed`/resumo visual) e carrega o payload do item sob demanda de `content/catalog/shards/*.json`. Cada shard tem nome content-addressed e é imutável; o `catalog.ts` mantém um LRU de 8 shards. `getCatalogSummary()`/`/api/catalog` leem apenas o índice, sem carregar payloads.

O catálogo é read-only, usa `schemaVersion: 3` e versionamento por release. Cada item carrega `status` (`approved`/`deprecated`), `provenance` (`procedural`, `ai_assisted`, `authored`, `template` ou `seed`) e `introducedIn` (versão de entrada, usada para novidade). `getCatalogVersion()` aparece em `room:init`/`room:tick`. Com `CATALOG_WATCH` ligado (padrão), o índice é recarregado de forma atômica quando muda; `SIGHUP` força a recarga. Editar `catalog.json` manualmente exige `npm run catalog:index` (ou `catalog:build`) para regenerar o índice; `promote-candidates` e `build-catalog` já fazem isso. A malha RLE continua `12×12×24` para armas e `16×16×16` para entidades.

O estado do evento transmitido à sala usa o **nome do item do catálogo**, não o texto cru do jogador; o prompt original fica apenas no ledger.

### `server/contentPool.ts`

Cada partida recebe um arsenal determinístico a partir de `room.seed`, `catalogVersion`, versão do algoritmo e snapshot de uso:

- núcleo obrigatório: defaults, um item por elemento, um por arquétipo, um por categoria de evento;
- tamanho entre 16–26 armas e 7–11 eventos, conforme `targetPlayers`;
- peso inverso ao uso humano recente (`equip`/`event`) e quota de novidade para `introducedIn` recente ou `provenance` `ai_assisted`/`authored`;
- `hash` e contagem de itens aparecem em `room:init`/`room:tick` (`contentPool`);
- itens `deprecated` e pools vazios caem para o catálogo completo.

O resolvedor recebe os IDs do pool e a composição só usa doadores do próprio pool. **Pedido explícito vence o arsenal**: se o prompt bate em nome/alias exato ou na chave canônica de um item aprovado, esse item é entregue mesmo fora do pool, e o desvio é registrado como `pool_miss = 1` com `pool_hash`. Para prompts vagos (tags/parcial), a resolução continua presa ao pool. Isso é **pool miss**, não lacuna de catálogo. O `loop:report` e o `ledger:report` separam os dois casos.

### Composição de eventos

Quando o prompt pede duas categorias de evento (ex.: “chuva de meteoros com matilha de lobos”), o resolvedor escolhe o evento-base e adiciona componentes de outras categorias:

- `MapEventState.components` carrega `{ archetype, params, entityBlueprint, budgetUsed }`;
- o componente secundário é escalado para caber no orçamento restante (100 pontos no total);
- o evento primário continua em `archetype`/`params` para compatibilidade;
- `onEventActivated` aplica todos os componentes (suprimentos, criaturas, terreno);
- `tickEvents` pulsa cada componente climático separadamente;
- se a composição não couber no orçamento, o resultado vira `partial` e entra nas lacunas.

### Contrato de diversão dos eventos

Todo evento carrega `MapEventState.fun` (`EventFunContract`) com:

- `telegraphSec` e `escapeWindowSec`: aviso e tempo real de reação (o runtime mantém 5 s de aviso);
- `counterplay`: `shelter`, `dig`, `sprint`, `high_ground`, `grapple`, `combat`, `loot` etc.;
- `spectacle`, `readability` e `riskReward`: camadas visuais/sonoras, canais de leitura e por que entrar no perigo;
- `fairness`: `unavoidableDamage` sempre `false` e `maxLethality ≤ 45`;
- `botResponse`: reação esperada dos bots (`flee`, `seek_shelter`, `climb`, `fight`, `loot`).

O contrato é derivado de `archetype`/`params` em `src/shared/eventFun.ts` quando o item não traz um explícito; `catalog:promote` valida e grava o contrato em eventos promovidos. O HUD mostra as contra-jogadas no aviso. Nevasca/granizo respeitam teto (dano zero quando abrigado), e bots fogem de tornado/lava/vulcão.

### Eventos de cenário

`SCENERY_SPAWN` gera estruturas voxel determinísticas (`src/shared/scenery.ts`: árvore, bosque, casa, torre, arranha-céu, ruínas). O servidor escolhe uma área livre, apoia no solo e aplica as células em **uma camada por tick** via `room.sceneryPlans`, produzindo o efeito de surgir do chão. A estrutura fica no mapa depois do evento e pode ser usada como cobertura/verticalidade; torres e arranha-céus incluem `MAT.LADDER`. O pool trata os itens como `terrain`, mas o arquétipo é separado para geração, HUD e contrato de diversão.

### `server/semantic.ts` e dedup offline

`server/semantic.ts` gera embeddings lexicais determinísticos (sinônimos do domínio + unigramas/bigramas + trigramas) e similaridade de cosseno. Não há chamada de rede nem modelo externo no runtime.

- `server/semanticDuplicates.ts` encontra quase-duplicatas do mesmo tipo, exigindo tag compartilhada e arquétipo/categoria compatível.
- `tools/catalog-dedupe.ts` gera `content/reports/dedupe-*.json/.md` para curadoria.
- `promoteCandidates` usa a similaridade semântica como segundo degrau, depois de alias/canonical exato, antes de criar item novo.
- O threshold padrão é `0.75` e é ajustável via `--threshold`.

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
- IDs lógicos para `texture`, `sound`, `effect` e `waypoint`, com `status`, `params`, `url`, `mimeType` e `hash` opcionais.
- `ASSET_BASE_URL` injeta `baseUrl` no `/api/assets`; o cliente resolve URLs relativas via `resolveAssetUrl`.
- Em dev/all-in-one, `server.ts` serve `content/assets/files` em `/assets/files` com cache imutável; em Vercel + VPS o áudio deve vir do CDN (`ASSET_BASE_URL`), pois o frontend não fala com a origem da API.
- `assetVersion` aparece em `room:init`/`room:tick`; o catálogo referencia IDs de assets.
- O manifesto é validado por `server/assets.test.ts`; `npm run assets:check` valida URLs e, com `--remote`, faz HEAD/GET no CDN.
- Texturas de arma usam o material Babylon quando há URL; sons usam cache de samples e caem no sintetizador procedural em falha/ausência.

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
- `tools/catalog-dedupe.ts` lista quase-duplicatas semânticas para revisão humana.
- `tools/aiGenerator.ts` é a ferramenta Gemini para produzir candidatos; não é importada pelo servidor.
- `tools/blueprintDb.ts` é o cache SQLite (`node:sqlite`) da ferramenta offline, em `data/voxelforge-blueprints.db` (`VOXELFORGE_DB_PATH`).
- Todo candidato passa por `src/shared/budget.ts` e por curadoria humana antes de entrar no catálogo.

## Código compartilhado (`src/shared`)

| Arquivo | Responsabilidade |
| --- | --- |
| `types.ts` | Protocolo, constantes de voxel e tipos de domínio. Fonte da verdade dos payloads. |
| `contentHydration.ts` | Junta referências de slot (`weaponId`) com o cache de blueprints do cliente e devolve o estado completo para HUD/renderização. |
| `budget.ts` | Orçamento de 100 pontos, normalização, clamps, RLE e geradores de fallback. |
| `prompt.ts` | Normalização de prompt e chave canônica usadas pelo resolvedor e pelo cache offline. |
| `voxelWorld.ts` | Ilha procedural determinística (inclui escadas e rotas de tirolesa via `IslandMeta`), raycast, movimento, carving e colapso de estruturas. |
| `botBrain.ts` | Personalidades, seleção de alvo, mira com previsão e decisões dos bots (executado no servidor). |
| `controls.ts` | Cálculo de look/edge turn compartilhado com o cliente. |
| `devMode.ts` | Gating de desenvolvimento no servidor e no cliente. |
| `endpoints.ts` | Resolve URLs HTTP/WebSocket para mesma origem ou Vercel + VPS. |

Esses módulos não devem depender de DOM nem de APIs exclusivas do Node.

## Cliente (`src`)

- `App.tsx` mantém o WebSocket, o estado da UI, o roteamento das mensagens e os overlays.
- `components/` contém lobby, sala de espera, HUD, barra mínima de prompt (`PromptBar`), pausa e fim de partida.
- `engine/babylonArena.ts` monta a cena, câmera, iluminação, projéteis, avatares e aplica deltas de voxels.
- `engine/chunkDetailPlugin.ts` usa `matId` (enviado pelo mesher) para detalhe procedural, brilho de lava/cristal e borda Fresnel por material, sem texturas.
- Água tem normal map procedural animado, espuma de costa gerada da heightmap e névoa submersa; o bloom fica atrás do preset de qualidade e só pega emissivos (threshold 1.0).
- `engine/greedyMesher.worker.ts` faz greedy meshing por chunk em Web Worker; os chunks têm 16³ voxels e são enviados com padding para consulta O(1) de vizinhos.
- `engine/voxelMeshBuilder.ts` converte RLE em malhas de armas, criaturas e avatares; `applyWeaponModules` acrescenta cano/mira/carregador/coronha no grid do modelo-base usando a receita de `src/shared/weaponVisuals.ts`.
- `engine/soundSynth.ts` sintetiza efeitos via Web Audio e usa samples do manifesto (`sfx:*`) quando existem, com fallback procedural; `playEventCue` dá identidade sonora por tipo de evento.
- `engine/babylonArena.ts` combina `eventPresentation.ts` (cor, anel, feixe e cue por evento) com o clima por `weatherKind` e invalida visualizações quando um lote de assets chega.
- `engine/audio/audioEngine.ts` centraliza contexto, limiter, buses (`sfx`, `ambience`, `ui`), cache de samples, listener e cadeia espacial (PannerNode + lowpass de oclusão).
- `engine/audio/audioDirector.ts` resolve `sfx:*` do manifesto, espacializa tiros/impactos/explosões/passos, aplica oclusão por raycast e faz crossfade de ambiência (vento/água/fogo/caverna).
- `engine/audio/materialAudio.ts` mapeia `MAT` para passos e impactos (pedra, madeira, metal, gelo, terracota, macio).
- VFX derivam do que o servidor já envia: `fx:shrapnel` gera detritos/onda de choque/decals e projétil novo/removido gera tiro/impacto — sem novas mensagens de protocolo.
- `engine/settings.ts` persiste volumes por bus, sensibilidade/inverter Y, preferência de estatísticas e **reduzir movimento**; `components/SettingsModal.tsx` centraliza áudio, mouse, qualidade e HUD.
- Ambiência combina vento, água, fogo, pântano e caverna, com reverb procedural em interiores e crossfade; clima (chuva ácida, nevasca, granizo, meteoros, terremoto, tempestade de areia, tempestade de raios e tornado) altera névoa/cor e adiciona respingos/poeira/rumble, com transições suaves. Mutações de terreno (vulcão, fissura, pilares de cristal, maré, sorvedouro, rio de lava, geleira e floresta voraz) alteram voxels de forma autoritativa no servidor.
- Fullscreen (F/botão) usa `requestFullscreen` com fallback WebKit; o mouse é capturado por pointer lock no clique do canvas (cursor escondido) e `Esc` solta + pausa.
- Traversal: `MAT.LADDER` é não-sólido para colisão e detectado por `isNearLadder`; sprint/crouch/slide/mantle e stamina rodam no tick autoritativo, e tirolesas usam `IslandMeta.ziplines` recomputado da seed no cliente e no servidor.
- `engine/quality.ts` resolve presets de qualidade (`auto/low/medium/high`), persistidos em `localStorage` e aplicados pelo `babylonArena` (escala de render e sombras); `auto` usa low em iGPU. O HUD de perf é apenas DEV.

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
