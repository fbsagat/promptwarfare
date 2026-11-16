# Deploy: Vercel + VPS

O frontend é um build estático do Vite na Vercel. A API REST e o WebSocket rodam em um processo Node na VPS, atrás de HTTPS/WSS.

```text
Navegador
  ├── https://promptwarfare.vercel.app     (arquivos estáticos)
  └── https://api.promptwarfare.com        (REST)
      wss://api.promptwarfare.com/ws       (WebSocket direto, sem proxy da Vercel)
```

A Vercel **não** faz proxy do WebSocket. O navegador conecta direto na VPS, por isso a API precisa de TLS válido e a origem da Vercel precisa estar liberada.

## 1. VPS (API + WebSocket)

### Requisitos

- Node.js 22.18+.
- Bun (recomendado) ou npm com `--legacy-peer-deps`.
- Um domínio/subdomínio, por exemplo `api.promptwarfare.com`.
- Proxy reverso com TLS (Caddy ou Nginx).

### Instalação

```bash
git clone <repo> /opt/prompt-warfare
cd /opt/prompt-warfare
bun install
# ou: npm install --legacy-peer-deps
```

Não é necessário rodar `npm run build` na VPS quando `SERVE_CLIENT=false`.

### Variáveis

Crie `/opt/prompt-warfare/.env` (ou use `EnvironmentFile` no systemd):

```dotenv
NODE_ENV=production
PORT=3000
HOST=127.0.0.1
SERVE_CLIENT=false
CORS_ORIGINS=https://promptwarfare.vercel.app
PROMPT_LEDGER_DB_PATH=/var/lib/prompt-warfare/prompt-ledger.db
CATALOG_WATCH=true
METRICS_WINDOW_DAYS=90
# METRICS_TOKEN=troque-por-um-segredo
```

- `HOST=127.0.0.1` expõe a porta apenas para o proxy reverso.
- `SERVE_CLIENT=false` mantém a VPS em modo API-only.
- `CORS_ORIGINS` aceita vírgula, `*` e curingas como `https://prompt-warfare-*.vercel.app` para previews.
- Em desenvolvimento, deixe `CORS_ORIGINS` vazio ou inclua `http://localhost:3000`; com a lista preenchida, o handshake WebSocket de uma origem não listada é rejeitado.
- Não defina `VITE_*` na VPS: essas variáveis são embutidas no build do frontend.
- `CATALOG_WATCH=false` desliga o hot reload do catálogo; o padrão é observar `content/catalog/catalog.json`.
- `METRICS_TOKEN` protege `/api/metrics` via header `X-Metrics-Token`; sem ele, o endpoint expõe apenas agregados públicos (sem prompts).
- `GEMINI_API_KEY` e `VOXELFORGE_DB_PATH` pertencem às ferramentas offline, não à VPS.

### Catálogo, ledger e permissões

O runtime lê `content/catalog/catalog.json` e escreve apenas no ledger de prompts. Garanta que o catálogo acompanhe o deploy e que o diretório do ledger seja gravável e persistente:

```bash
sudo mkdir -p /var/lib/prompt-warfare
sudo chown promptwarfare:promptwarfare /var/lib/prompt-warfare
```

O ledger usa SQLite com WAL. Faça backup de `prompt-ledger.db` (e dos arquivos WAL) ou do diretório inteiro. Trate o arquivo como dado sensível e pseudonimizado.

Defina uma política de retenção e agende a limpeza/redação:

```bash
npm run ledger:prune -- --db /var/lib/prompt-warfare/prompt-ledger.db --days 90 --dry-run
npm run ledger:prune -- --db /var/lib/prompt-warfare/prompt-ledger.db --days 90 --redact-prompts
```

`--redact-prompts` preserva os agregados (item, estratégia, cobertura) e apaga o texto bruto; sem ele, as linhas antigas de prompt e uso são removidas.

### Ledger Postgres (múltiplas instâncias)

O backend padrão continua SQLite. Para compartilhar o ledger entre instâncias:

```bash
npm install pg
```

```dotenv
PROMPT_LEDGER_BACKEND=postgres
PROMPT_LEDGER_POSTGRES_URL=postgres://user:pass@host:5432/promptwarfare
```

- As tabelas e índices são criados automaticamente no boot (`prompt_events` e `content_usage`).
- `ledger:report`, `usage:report`, `loop:report`, `ledger:prune` e `/api/metrics` usam o mesmo backend configurado.
- `--db` continua valendo apenas para SQLite.
- O backend Postgres compartilha **telemetria**, não o estado das partidas: salas continuam em memória. Para rodar várias instâncias, use afinidade/sticky sessions por sala no proxy.
- A troca de SQLite para Postgres não migra dados antigos automaticamente; exporte/importe com `sqlite3`/CSV ou comece um ledger novo.

### Hot reload do catálogo

Com `CATALOG_WATCH=true` (padrão), o servidor observa `content/catalog/catalog.json` e troca o cache de forma atômica quando o arquivo muda. Se o JSON estiver inválido, a versão anterior continua em memória e o erro vai para o log.

- Para forçar a recarga sem esperar o polling: `kill -HUP <pid>`.
- A recarga não reinicia partidas; armas/eventos já resolvidos permanecem como estão, e os próximos prompts usam a nova versão.
- Em releases imutáveis/symlink, prefira `kill -HUP` ou reinicie o serviço.
- `CATALOG_WATCH=false` desliga o watcher.

### Loop report agendado

Rode o fechamento do loop diariamente e mantenha o ledger dentro da política de retenção:

```bash
# /etc/cron.d/prompt-warfare-loop
0 4 * * * promptwarfare cd /opt/prompt-warfare && npm run loop:report -- --days 90 >> /var/lib/prompt-warfare/loop-report.log 2>&1
30 4 * * * promptwarfare cd /opt/prompt-warfare && npm run ledger:prune -- --db /var/lib/prompt-warfare/prompt-ledger.db --days 90 --redact-prompts >> /var/lib/prompt-warfare/prune.log 2>&1
```

Os relatórios saem em `content/reports/loop-*.json/.md`. Use `--include-bots` apenas para auditoria; a demanda padrão é humana.

### Métricas

`GET /api/metrics` expõe um snapshot agregado (salas, jogadores, cobertura, lacunas fechadas/persistentes/regredidas, pool misses e itens com demanda/uso), sem texto de prompt. O snapshot é atualizado a cada 60 s; salas e uptime são lidos ao vivo. O campo `alerts` sinaliza baixa cobertura, pool miss alto, lacunas regredidas, cobertura duvidosa excessiva e ausência de uso.

```bash
curl -H "X-Metrics-Token: $METRICS_TOKEN" https://api.promptwarfare.com/api/metrics
```

`GET /api/health` continua sendo o health check barato, agora com `playing`, `lobby`, `humans`, `bots`, `uptimeSec` e as versões atuais.

O servidor deve rodar como uma única instância: salas ficam em memória e não há suporte a múltiplos processos compartilhando estado.

### systemd

`/etc/systemd/system/prompt-warfare.service`:

```ini
[Unit]
Description=Prompt Warfare API
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/prompt-warfare
EnvironmentFile=/opt/prompt-warfare/.env
ExecStart=/usr/bin/node server.ts
Restart=always
RestartSec=3
User=promptwarfare
Group=promptwarfare

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now prompt-warfare
curl http://127.0.0.1:3000/api/health
```

Resposta esperada: `{"ok":true,"rooms":0,"devMode":false}`.

### Caddy

```caddyfile
api.promptwarfare.com {
    reverse_proxy 127.0.0.1:3000
}
```

O Caddy emite o certificado e encaminha upgrades de WebSocket automaticamente.

### Nginx

```nginx
server {
    listen 443 ssl;
    server_name api.promptwarfare.com;

    ssl_certificate     /etc/letsencrypt/live/api.promptwarfare.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.promptwarfare.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 300s;
    }
}
```

Libere apenas 80/443 no firewall; a porta 3000 deve ficar em `127.0.0.1`.

## 2. Vercel (frontend)

1. Importe o repositório na Vercel. O framework é detectado como Vite.
2. O `vercel.json` já define:
   - `installCommand`: `npm install --legacy-peer-deps` (o `npm install` puro falha pelo conflito de `esbuild`);
   - `buildCommand`: `npm run build`;
   - `outputDirectory`: `dist`.
3. Configure as variáveis em **Production** e **Preview**:
   - `VITE_API_URL=https://api.promptwarfare.com`
   - `VITE_WS_URL=wss://api.promptwarfare.com/ws` (opcional; se vazio, é derivada de `VITE_API_URL`)
4. Faça o deploy. Variáveis `VITE_*` são lidas em tempo de build; mudanças exigem novo deploy.
5. Ao adicionar um domínio customizado, inclua-o em `CORS_ORIGINS` na VPS e reinicie o serviço.

Se preferir Bun na Vercel, troque o `installCommand` para `bun install` e configure o runtime/versão do Bun no projeto. O caminho com npm acima é o que está validado neste repositório.

## 3. Checklist

- [ ] `https://api.<domínio>/api/health` responde sem erro de TLS.
- [ ] `GET /api/rooms` com `Origin: https://<frontend>` devolve `Access-Control-Allow-Origin` correto.
- [ ] O navegador abre `wss://api.<domínio>/ws` (sem erro de mixed content).
- [ ] `CORS_ORIGINS` contém o domínio de produção e os previews necessários.
- [ ] `SERVE_CLIENT=false` na VPS.
- [ ] `content/catalog/catalog.json` está presente e legível no deploy.
- [ ] O diretório do `PROMPT_LEDGER_DB_PATH` é gravável, persistente e tem backup.
- [ ] A política de retenção foi definida e `ledger:prune` está agendado.
- [ ] Nenhuma chave de IA está configurada na VPS.
- [ ] Novo deploy da Vercel foi feito depois de alterar `VITE_*`.

## Limites atuais

- Não há autenticação nem rate limiting. CORS e a checagem de origem do WebSocket não são barreiras de segurança contra clientes que não sejam navegadores.
- Salas são perdidas ao reiniciar a VPS.
- O estado em memória assume uma única instância; não escale horizontalmente sem repensar salas e WebSocket.
- O jogo não depende de IA nem de rede externa: o catálogo versionado é a fonte de conteúdo.
