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
GEMINI_API_KEY=<chave>
VOXELFORGE_DB_PATH=/var/lib/prompt-warfare/voxelforge-blueprints.db
```

- `HOST=127.0.0.1` expõe a porta apenas para o proxy reverso.
- `SERVE_CLIENT=false` mantém a VPS em modo API-only.
- `CORS_ORIGINS` aceita vírgula, `*` e curingas como `https://prompt-warfare-*.vercel.app` para previews.
- Em desenvolvimento, deixe `CORS_ORIGINS` vazio ou inclua `http://localhost:3000`; com a lista preenchida, o handshake WebSocket de uma origem não listada é rejeitado.
- Não defina `VITE_*` na VPS: essas variáveis são embutidas no build do frontend.
- `GEMINI_API_KEY` fica somente aqui. Nunca use prefixo `VITE_`.

### Banco e permissões

```bash
sudo mkdir -p /var/lib/prompt-warfare
sudo chown promptwarfare:promptwarfare /var/lib/prompt-warfare
```

O SQLite é criado no primeiro start. Faça backup do arquivo `.db` (e dos arquivos WAL) ou do diretório inteiro. O servidor deve rodar como uma única instância: salas ficam em memória e não há suporte a múltiplos processos compartilhando estado.

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
- [ ] `GEMINI_API_KEY` existe apenas na VPS.
- [ ] O diretório de dados do SQLite é persistente e tem backup.
- [ ] Novo deploy da Vercel foi feito depois de alterar `VITE_*`.

## Limites atuais

- Não há autenticação nem rate limiting. CORS e a checagem de origem do WebSocket não são barreiras de segurança contra clientes que não sejam navegadores.
- Salas são perdidas ao reiniciar a VPS.
- O SQLite e o estado em memória assumem uma única instância; não escale horizontalmente sem repensar salas, WebSocket e persistência.
- Sem `GEMINI_API_KEY`, o jogo continua funcional com o gerador procedural.
