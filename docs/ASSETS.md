# Assets e CDN

O jogo continua funcionando sem assets externos: texturas, sons e efeitos têm fallback procedural. O manifesto versionado em `content/assets/manifest.json` permite apontar para arquivos reais em um CDN/MinIO/S3 sem alterar o código do servidor.

## Modelo

Cada asset tem:

```json
{
  "id": "texture:weapon:ice",
  "type": "texture",
  "status": "approved",
  "tags": ["weapon", "ice"],
  "params": { "kind": "palette", "colors": ["#67e8f9"] },
  "url": "textures/weapon/ice.png",
  "mimeType": "image/png",
  "hash": "sha256:..."
}
```

- `url` pode ser absoluta (`https://...`) ou relativa.
- Quando relativa, o cliente resolve contra `baseUrl` do manifesto.
- `ASSET_BASE_URL` no servidor injeta `baseUrl` no `/api/assets`.
- O manifesto usa `baseUrl: "/assets/files"` por padrão, servido pelo próprio `server.ts` na rota `/assets/files` (mesma origem). Em deploy separado (Vercel + VPS) ou CDN, defina `ASSET_BASE_URL`; sem isso o cliente resolve contra a origem errada.
- `status: deprecated` mantém o asset no arquivo sem uso novo.
- O manifesto é validado no boot (`server/assets.ts`) e por `server/assets.test.ts`.

## CDN/MinIO

A stack principal já tem MinIO/S3. Exemplo com `mc`:

```bash
mc alias set pw https://minio.exemplo.com ACCESS SECRET
mc mb --ignore-existing pw/promptwarfare-assets
mc cp --recursive content/assets/files/ pw/promptwarfare-assets/
```

Configure no `.env` da API:

```dotenv
ASSET_BASE_URL=https://cdn.promptwarfare.com/assets
```

O bucket/CDN deve permitir leitura pública dos assets (ou URLs assinadas, se o cliente suportar). Não publique o bucket de escrita.

## Validar

```bash
npm run assets:check
npm run assets:check -- --remote
```

- Sem `--remote`, resolve URLs e verifica base.
- Com `--remote`, faz HEAD/GET e falha se o arquivo não responder 2xx.
- `--base-url` e `--manifest` permitem testar sem alterar o ambiente.

## Cliente

- `src/shared/assets.ts` expõe `resolveAssetUrl`.
- `babylonArena` aplica `texture:weapon:*` no material da arma quando há URL; se o download falhar, mantém a paleta.
- `soundSynth` tenta baixar/cachear `sfx:weapon:*` e toca o sample; até o cache carregar, usa o som procedural.
- `audioDirector` usa os SFX espacialmente (HRTF/equalpower), escolhe passos/impactos por `MAT` e faz crossfade de loops de ambiência; `soundSynth` segue para tiros procedurais, UI e feedback local.
- Eventos/waypoints continuam usando `waypoint:event` e `fx:event:*` do manifesto.

## SFX importados (Fase 0)

<!-- sfx-import:start -->
Importado de `material/400 Sounds Pack` (ignorado pelo git) por `npm run assets:import`.
Não edite esta seção à mão; rode o script novamente.

- Pacote: **400 Sounds Pack** — [Chequered Ink](https://ci.itch.io/400-sounds-pack)
- Licença: uso comercial permitido; vedada a revenda/redistribuição dos WAVs sem alteração.
- Arquivos versionados: 46 (.ogg mono, ~728.2 KB), em `content/assets/files/sfx/`.
- Formato: opus 48 kHz, loudness normalizada; fallback procedural permanece quando o sample não carrega.

| Grupo | Arquivos |
| --- | --- |
| `ambience:cave` | 1 |
| `ambience:fire` | 1 |
| `ambience:swamp` | 1 |
| `ambience:water` | 1 |
| `ambience:wind` | 1 |
| `dig` | 1 |
| `drop:weapon` | 1 |
| `equip` | 1 |
| `equip:weapon` | 1 |
| `footstep:loose` | 4 |
| `footstep:soft` | 4 |
| `footstep:stone` | 4 |
| `grapple` | 1 |
| `impact:ice` | 2 |
| `impact:metal` | 2 |
| `impact:soft` | 2 |
| `impact:stone` | 2 |
| `impact:terracotta` | 1 |
| `impact:wood` | 2 |
| `land` | 1 |
| `pickup` | 2 |
| `pickup:weapon` | 1 |
| `traversal:whoosh` | 2 |
| `ui:cancel` | 1 |
| `ui:confirm` | 1 |
| `ui:error` | 1 |
| `ui:select` | 1 |
| `water:drop` | 1 |
| `water:ice` | 1 |
| `water:splash` | 1 |
<!-- sfx-import:end -->

## Limitações atuais

- O manifesto tem URLs apenas para os SFX convertidos; texturas, efeitos e waypoints continuam procedurais.
- Assets não têm hot reload no cliente: mudar o manifesto exige recarregar a página/nova sessão. O catálogo tem hot reload separado (`CATALOG_WATCH`).
- A validação de hash é apenas de presença; verificação criptográfica do conteúdo ainda não é feita.
