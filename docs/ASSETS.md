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
- Eventos/waypoints continuam usando `waypoint:event` e `fx:event:*` do manifesto.

## Limitações atuais

- O manifesto atual não tem URLs nem arquivos; tudo é procedural.
- Assets não têm hot reload no cliente: mudar o manifesto exige recarregar a página/nova sessão. O catálogo tem hot reload separado (`CATALOG_WATCH`).
- A validação de hash é apenas de presença; verificação criptográfica do conteúdo ainda não é feita.
