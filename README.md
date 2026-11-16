# Prompt Warfare

Arena battle royale 3D em micro-voxels destrutíveis. Os jogadores descrevem armas e eventos de mapa em linguagem natural; o servidor resolve o prompt contra um catálogo versionado, valida o orçamento de 100 pontos e transmite o resultado para todos os clientes em tempo real. Gemini é usado apenas em ferramentas offline de produção de conteúdo, nunca durante a partida.

## Destaques

- Salas de 4 a 14 jogadores, com entrada por código, sala aberta ou protegida por senha, partida rápida e preenchimento com bots.
- Ilha procedural em voxels de 0,3125 m, com múltiplos biomas, estruturas, cavernas, água e terreno destrutível.
- Combate com pá escavadora, gancho por massa e armas forjadas por prompt, com crateras, ricochete, perfuração, efeitos elementais e riscos de auto-dano.
- Forja de armas por prompt com orçamento interno de 100 pontos (trava de balanceamento, não escolha do jogador).
- Eventos globais do catálogo: tempestades, criaturas, mutações de terreno e suprimentos, com aviso antes do efeito.
- Mecânicas anti-estagnação: sorteio de evento, limite de eventos simultâneos e catástrofes automáticas após longos períodos sem eliminações.
- Bots com personalidades, mira com previsão de movimento, busca de recursos e fuga de água.
- Catálogo versionado (`content/catalog/catalog.json`) e resolvedor determinístico por aliases/tags; a partida não depende de rede, chave de API ou quota.

## Stack

| Camada | Tecnologias |
| --- | --- |
| Cliente | React 19, Vite 8, Tailwind CSS 4, Babylon.js 9, Web Audio |
| Servidor (VPS) | Node.js 22.18+, Express 4, `ws`, `node:sqlite` (ledger) |
| Frontend (Vercel) | Build estático do Vite, sem funções serverless |
| Ferramentas offline | `node:sqlite`, `@google/genai` (Gemini, saída estruturada em JSON) |
| Linguagem | TypeScript executado nativamente pelo Node (sem build do servidor) |

## Requisitos

- Node.js **22.18 ou superior** (o servidor e os testes executam arquivos `.ts` diretamente).
- [Bun](https://bun.sh/) é recomendado, pois o repositório versiona apenas `bun.lock`.

## Instalação

```bash
bun install
```

Sem Bun, use o npm com resolução legada de peers:

```bash
npm install --legacy-peer-deps
```

> `npm install` puro falha: o `esbuild@^0.25` da raiz conflita com o peer `esbuild@^0.27 || ^0.28` exigido pelo Vite 8. Não há `package-lock.json`, então `npm ci` também não funciona.

## Configuração

Crie um `.env` na raiz a partir do exemplo:

```bash
cp .env.example .env
```

No PowerShell:

```powershell
Copy-Item .env.example .env
```

**Servidor / VPS**

| Variável | Padrão | Descrição |
| --- | --- | --- |
| `PORT` | `3000` | Porta HTTP e WebSocket do servidor. |
| `HOST` | `0.0.0.0` | Interface de escuta. Use `127.0.0.1` atrás de proxy reverso. |
| `NODE_ENV` | `development` | `production` serve `dist/` em vez do middleware Vite (quando `SERVE_CLIENT` não é `false`). |
| `SERVE_CLIENT` | `true` | `false` deixa a VPS em modo API-only, sem entregar o frontend. |
| `CORS_ORIGINS` | vazio | Origens permitidas, separadas por vírgula. Aceita `*` e curingas como `https://prompt-warfare-*.vercel.app`. Vazio = HTTP somente mesma origem. |
| `PROMPT_LEDGER_DB_PATH` | `data/prompt-ledger.db` | Caminho do SQLite append-only de prompts. |
| `DISABLE_HMR` | `false` | `true` desativa HMR e file watching do Vite. |

`GEMINI_API_KEY` e `VOXELFORGE_DB_PATH` são variáveis das ferramentas offline em `tools/`, não do servidor. O jogo sobe sem chave de API.

**Frontend / Vercel (tempo de build)**

| Variável | Padrão | Descrição |
| --- | --- | --- |
| `VITE_API_URL` | vazio | Origem pública da API, por exemplo `https://api.promptwarfare.com`. Vazio = mesma origem. |
| `VITE_WS_URL` | vazio | URL completa do WebSocket, por exemplo `wss://api.promptwarfare.com/ws`. Se vazio, deriva de `VITE_API_URL`. |

As variáveis `VITE_*` são embutidas no bundle pelo Vite: altere-as no projeto da Vercel e faça um novo deploy. O servidor carrega apenas o `.env` (via `dotenv/config`); `.env.local` não é lido.

## Desenvolvimento

```bash
bun run dev
# ou
npm run dev
```

No Windows, também é possível dar um duplo clique em `dev.bat` na raiz do projeto: ele instala as dependências se faltarem, cria o `.env` a partir de `.env.example` quando necessário, abre o navegador e sobe o servidor. Use `NO_OPEN=1` para não abrir o navegador, `NO_PAUSE=1` para não pausar ao final e `PORT` para escolher outra porta. Se a porta padrão já estiver ocupada, ele avisa e usa a próxima livre.

O comando inicia **um único processo** em <http://localhost:3000>: o `server.ts` sobe a API, o WebSocket em `/ws` e o middleware do Vite com HMR. Localmente, frontend e API compartilham a mesma origem, então `VITE_API_URL` pode ficar vazio.

Em produção, o frontend fica na Vercel e a API/WebSocket na VPS. Nesse modo, o cliente usa `VITE_API_URL`/`VITE_WS_URL` e a VPS precisa liberar a origem da Vercel em `CORS_ORIGINS`. Veja [Deploy](docs/DEPLOY.md). Para rodar o frontend em outra porta local, defina `VITE_API_URL` e inclua a origem em `CORS_ORIGINS` (por exemplo, `http://localhost:5173`).

## Scripts

| Comando | O que faz |
| --- | --- |
| `npm run dev` | Inicia servidor + cliente em modo desenvolvimento. |
| `dev.bat` | Atalho Windows: instala dependências, cria `.env` se preciso, evita porta ocupada, abre o navegador e roda `npm run dev`. |
| `npm run build` | Gera o build do cliente em `dist/`. |
| `npm start` | Inicia o servidor; em produção, serve `dist/` se `SERVE_CLIENT` não for `false`. |
| `npm run preview` | Apenas pré-visualiza o build do Vite, **sem** API/WebSocket. |
| `npm run lint` | Typecheck com `tsc --noEmit`. Não há ESLint nem Prettier. |
| `npm test` | Executa todos os testes com o runner nativo do Node. |
| `npm run clean` | Remove `dist/` e `server.js`. |

Para testar produção no PowerShell:

```powershell
npm run build
$env:NODE_ENV='production'; npm start
```

## Deploy

Arquitetura de produção:

```text
Vercel (HTTPS)  ── HTTP /api/*  ──▶  VPS (Express + TLS)
    │                                   │
    └────── WebSocket /ws (wss://) ─────┘
```

- **Vercel**: importe o repositório; o `vercel.json` define `npm install --legacy-peer-deps`, `npm run build` e `dist/`. Configure `VITE_API_URL` e, se necessário, `VITE_WS_URL`.
- **VPS**: rode a API com `NODE_ENV=production`, `SERVE_CLIENT=false`, `CORS_ORIGINS` apontando para o domínio da Vercel e TLS na frente (a página HTTPS só pode abrir `wss://`).
- **CORS**: `CORS_ORIGINS` também valida a origem do handshake WebSocket quando não está vazio. Isso não substitui autenticação.
- **Chave Gemini**: fica apenas no ambiente das ferramentas offline; nunca use prefixo `VITE_` para segredos e nunca a configure no servidor do jogo.

Passo a passo completo, proxy reverso e checklist em [docs/DEPLOY.md](docs/DEPLOY.md).

## Controles

| Ação | Entrada |
| --- | --- |
| Mover | `WASD` ou setas |
| Olhar | Mouse (pointer lock) ou borda da tela |
| Pular | `Espaço` |
| Ação primária (atirar, escavar, gancho) | Clique esquerdo, segurado para tiro/escavação contínua |
| Alternar 1ª/3ª pessoa | Scroll do mouse |
| Selecionar slot | `1` a `4` |
| Pegar item | `E` |
| Descartar item | `G` ou `Q` |
| Abrir prompt (forja ou evento) | `Enter` |
| Atalhos de forja/evento | `T` / `Y` |
| Pausar / retomar | `P` ou `Esc` |
| Mutar áudio | `M` |
| Painel de desenvolvimento (fora de produção) | `F8` |

## Loop de jogo

1. O Master cria a sala, define de 4 a 14 jogadores, ativa ou não bots e inicia a partida.
2. Cada jogador começa com pá, gancho e dois slots livres. A forja fica disponível após 10 segundos; cada nova arma inicia 30 segundos de recarga.
3. Durante a partida, o servidor sorteia um jogador vivo e disponível a cada 24 segundos para propor um evento global. O sorteado tem 10 segundos para reivindicar e 20 para escrever; o jogador fica parado e vulnerável enquanto digita.
4. Eventos têm 5 segundos de aviso, até 3 ativos ao mesmo tempo, e alteram clima, terreno, criaturas ou suprimentos.
5. A partida termina quando resta um jogador vivo; o resumo mostra colocação, abates, armas criadas e duração.

## Pipeline de conteúdo

```bash
# Demanda inicial sintética (prompts prováveis de um shooter com catástrofes)
npm run demand:seed

# Jogar partidas: o servidor grava prompts em data/prompt-ledger.db
# Exportar demanda, lacunas e briefs
npm run ledger:report

# Gerar candidatos offline a partir das lacunas (usa Gemini se houver chave)
# Sem partidas reais, use o relatório da demanda inicial:
npm run catalog:candidates -- --report content/seeds/initial-demand-report.json --limit 10
# Com dados reais, use o último relatório de content/reports:
# npm run catalog:candidates -- --limit 10

# Revisar content/catalog/candidates.json e publicar uma nova versão
npm run catalog:promote -- --ids cand_weapon_exemplo_1 --version 2026-11-20.1

# Telemetria de uso/qualidade (equipes, abates, dano, sobrevivência e feedback por item)
npm run usage:report

# Retenção do ledger: dry-run, remoção ou redação de prompts antigos
npm run ledger:prune -- --days 90 --dry-run
npm run ledger:prune -- --days 90 --redact-prompts

# Regerar o catálogo procedural base, se necessário
npm run catalog:build -- 2026-11-20.1
```

## Estrutura

```text
vercel.json               Build estático do frontend na Vercel
server.ts                 Entrada única: API REST, WebSocket e cliente opcional
server/
  roomManager.ts          Estado autoritativo: salas, loop de 20 Hz, combate, bots, eventos
  catalog.ts              Catálogo read-only + resolvedor determinístico
  assets.ts               Manifesto de assets read-only
  ledger.ts               Ledger append-only de prompts (SQLite)
  ledgerReport.ts         Agregação de demanda/lacunas
  usageReport.ts          Agregação de uso/qualidade por item
  httpCors.ts             Origens permitidas para CORS e WebSocket
content/
  assets/manifest.json    Manifesto de texturas, sons, efeitos e waypoints
  catalog/catalog.json    Fonte de verdade versionada do conteúdo
  seeds/initial-demand.json Demanda inicial sintética
  reports/                Relatórios gerados offline
tools/
  build-catalog.ts        Gera o catálogo procedural offline
  seed-demand.ts          Gera o relatório da demanda inicial
  ledger-report.ts        Exporta clusters, lacunas e briefs
  ledger-prune.ts         Retenção/redação do ledger
  usage-report.ts         Exporta uso/qualidade por item
  catalog-candidates.ts   Gera candidatos a partir das lacunas
  promote-candidates.ts   Valida e publica candidatos aprovados
  aiGenerator.ts          Ferramenta offline de geração com Gemini
  blueprintDb.ts          Cache SQLite da ferramenta offline
src/
  App.tsx                 Controlador do cliente (estado, WebSocket, overlays)
  components/             HUD, lobby, sala de espera, prompt e modais
  engine/                 Babylon.js, mesher em Web Worker, síntese de áudio
  shared/                 Código compartilhado (orçamento, prompt, assets, voxels, bots, tipos, URLs da API)
docs/
  ARCHITECTURE.md         Arquitetura e fluxo de execução
  CONTENT_PLAN.md         Plano do ciclo de conteúdo por prompts
  DEPLOY.md               Deploy Vercel + VPS
  PROTOCOL.md             Mensagens do WebSocket
```

## Testes

```bash
npm test
# um arquivo
npm run test -- server/roomManager.test.ts
# um teste específico
node --test --test-name-pattern "100-point" src/shared/logic.test.ts
```

Os testes usam o runner nativo do Node, rodam offline e cobrem orçamento de armas/eventos, catálogo/resolvedor, ledger/demanda, promoção de candidatos, geração procedural, voxels, física, bots, ferramenta de IA offline, salas, permissões, dev mode, resolução de URLs da API/WebSocket e CORS.

## Documentação

- [Arquitetura](docs/ARCHITECTURE.md)
- [Deploy Vercel + VPS](docs/DEPLOY.md)
- [Protocolo WebSocket](docs/PROTOCOL.md)
- [Plano do ciclo de conteúdo por prompts](docs/CONTENT_PLAN.md)
- [Instruções para agentes](AGENTS.md)
