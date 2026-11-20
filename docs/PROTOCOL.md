# Protocolo WebSocket

O transporte é um WebSocket em `/ws`. Por padrão ele usa o mesmo host do cliente (`ws://` ou `wss://` conforme a página). Em produção, o frontend fica na Vercel e o cliente usa:

- `VITE_API_URL` para chamadas REST (`/api/*`);
- `VITE_WS_URL` para o WebSocket completo, ou a derivação automática de `VITE_API_URL` trocando `https` por `wss` e anexando `/ws`.

Sem essas variáveis, tudo continua na mesma origem, como no desenvolvimento local. A origem do handshake pode ser restringida na VPS por `CORS_ORIGINS`. Todas as mensagens são JSON com o envelope:

```json
{ "type": "namespace:action", "payload": {} }
```

A fonte de verdade dos campos é `src/shared/types.ts`. `room:tick` é enviado a 20 Hz com o estado público dos jogadores; o cliente envia entradas com throttle de 45 ms.

Slots e loot **não carregam o blueprint da arma** no estado de 20 Hz. Eles trafegam apenas `{ weaponId }`; o blueprint completo chega uma única vez por instância em `room:init.contentItems` ou na mensagem `content:items`. O cliente hidrata o slot com `src/shared/contentHydration.ts` antes de entregar o estado ao HUD e ao renderizador. Os tipos `RoomInitWirePayload`/`RoomTickWirePayload` descrevem o fio; `RoomInitPayload`/`RoomTickPayload` descrevem a visão hidratada.

## Handshake de protocolo

Cliente e servidor precisam se reconhecer **antes de qualquer coisa**. O contrato vive em `src/shared/protocol.ts` (`PROTOCOL_NAME`, `PROTOCOL_VERSION`) e é comparado por igualdade exata: um cliente novo contra um servidor antigo (ou vice-versa) é recusado, não degradado.

1. O cliente faz `GET /api/health` com `cache: no-store`. A resposta inclui `{ protocol, protocolVersion }`. Se a chamada falhar (rede, timeout de 8 s, CORS) ou a versão não bater, o app inteiro fica bloqueado no overlay de boot e tenta de novo com backoff (3 s → 10 s); voltar para a aba, recuperar a rede ou clicar em "Tentar novamente" revalida na hora. `CLIENT_OUTDATED` exige recarregar a página; os demais casos têm retry automático.
2. Ao abrir o WebSocket, a primeira mensagem do cliente é `client:hello` com `{ protocol, protocolVersion, client }`. Em produção (`NODE_ENV=production`) o servidor responde `client:hello_ack` e libera o socket apenas se versão e protocolo baterem; caso contrário envia `room:error` (`PROTOCOL_MISMATCH`, `CLIENT_OUTDATED` ou `SERVER_OUTDATED`) e fecha com 1008. Sem `client:hello`, qualquer outra mensagem recebe `HANDSHAKE_REQUIRED`; após 10 s o socket é fechado com `HELLO_TIMEOUT`.
3. Em desenvolvimento (`npm run dev`, `NODE_ENV` diferente de `production` e `import.meta.env.DEV`) a divergência de versão não bloqueia: cliente e servidor seguem com um aviso no console. Falha de rede continua bloqueando. O container local (`api-docker.bat`/`docker compose`) roda com `NODE_ENV=production`, então é ele que valida o handshake estrito — `api-local.bat` (modo strict) replica o contrato na porta 3100, mas não substitui o aceite no Docker, e `npm run dev` não serve para aceite de protocolo.
4. Se a conexão cair depois do boot, o cliente mostra um banner persistente. Ele revalida `/api/health` sozinho (a cada 4 s, ao voltar o foco e ao recuperar a rede) e avisa quando o servidor volta; a partir daí o jogador escolhe voltar ao menu. A partida não é retomada: o servidor remove o jogador quando o socket fecha.

Subir `PROTOCOL_VERSION` sempre que o formato de uma mensagem WS/HTTP mudar. O deploy da Vercel e da VPS deve ser coordenado; não há janela de compatibilidade N-1.

## Cliente → servidor

### Antes de entrar em uma sala

Tratadas em `server.ts`:

| Tipo | Payload | Efeito |
| --- | --- | --- |
| `client:hello` | `{ protocol, protocolVersion, client }` | Handshake obrigatório em produção; precisa ser a primeira mensagem do socket. Responde `client:hello_ack`. |
| `rooms:list` | — | Responde com a lista de salas públicas. |
| `room:create` | `roomId?`, `roomName?`, `playerName?`, `accessMode?`, `password?`, `targetPlayers?`, `fillWithBots?`, `startImmediately?` | Cria a sala, entra como Master e pode iniciar imediatamente. |
| `room:join` | `roomId`, `playerName?`, `password?` | Entra em uma sala existente. |
| `room:quick_play` | `roomId?`, `playerName?`, `targetPlayers?`, `fillWithBots?` | Entra em uma sala aberta disponível ou cria uma nova. |
| `room:leave` | — | Desvincula o socket da sala atual. |

### Durante a partida

Tratadas em `RoomManager.handleClientMessage`:

| Tipo | Payload | Efeito |
| --- | --- | --- |
| `player:input` | `ClientInputPacket` | Movimento, pulo, sprint (`sprint`), agachar (`crouch`), yaw/pitch e slot ativo. Ignorado enquanto o jogador está escrevendo. |
| `player:action` | `{ origin, dir }` | Ação primária (tiro, escavação ou gancho). Rejeitada durante a escrita e durante tirolesa. |
| `player:drop` | — | Descarta o item do slot ativo. Rejeitado durante a escrita. |
| `player:pickup` | — | Pega o loot mais próximo. Rejeitado durante a escrita. |
| `player:zipline` | `{ routeId }` | Inicia uma tirolesa se o jogador estiver a ≤ 3,6 m da âncora superior. |
| `ping` | `{ t }` | Mede latência; o servidor responde com `pong` ecoando `t`. |
| `client:perf` | `{ assets: { loaded, requests, fetched, failed, bytes } }` | Telemetria do cache/prefetch de assets do cliente para `/api/metrics`/`/metrics`. Valores são clampados; deltas são acumulados por jogador. |
| `prompt:open` | `{ kind: 'weapon' \| 'event' }` | Abre a janela de escrita no servidor e inicia o timeout. |
| `prompt:cancel` | `{ kind }` | Cancela a escrita; o evento é consumido e a forja volta a ficar pronta. |
| `ai:forge_weapon` | `{ prompt }` | Envia a arma; exige `prompt:open` de arma. Sem alocação. |
| `ai:trigger_event` | `{ prompt }` | Envia o evento; exige `prompt:open` de evento e ser o sorteado. |
| `content:feedback` | `{ itemId, rating: 1 \| -1, kind? }` | Registra feedback explícito do jogador para um item do catálogo. |
| `room:start` | `{ devSolo? }` | Master inicia a partida (`devSolo` só em dev mode). |
| `room:update_settings` | `accessMode?`, `password?`, `roomName?`, `targetPlayers?`, `fillWithBots?` | Ajustes de sala; parte só é aceita no lobby e/ou pelo Master. |
| `room:kick` | `{ targetPlayerId }` | Master expulsa um jogador. |
| `room:transfer_host` | `{ targetPlayerId }` | Master transfere a liderança. |
| `room:restart` | — | Master reinicia a partida. |
| `dev:action` | `DevActionPayload` | Ferramentas de desenvolvimento; rejeitado com `DEV_DISABLED` se o dev mode estiver desligado. |
| `dev:catalog` | — | Pede a lista compacta do catálogo (`dev:catalog` na resposta); rejeitado com `DEV_DISABLED` em produção. |

`DevActionPayload` aceita: `toggle_god_mode`, `toggle_infinite_sandbox`, `toggle_freeze_bots`, `toggle_auto_events`, `unlock_forge`, `refill_player`, `damage_player` (`amount`), `quick_forge` (`prompt`), `spawn_catalog_weapon` (`itemId`), `equip_bot_weapon` (`itemId`), `win_event_raffle`, `trigger_event` (`prompt`), `spawn_catalog_event` (`itemId`), `skip_event_cooldown`, `clear_events`, `teleport_center`, `spawn_bot`, `spawn_dummy`, `kill_bots` e `force_restart`.

`content:feedback` só aceita `itemId` existente no catálogo e do `kind` correspondente, com limite de 10 eventos por 10 s. `prompt:open` aceita no máximo 12 aberturas por 10 s por jogador.

O servidor é dono dos prazos. O evento global tem 10s para o sorteado reivindicar e 20s de escrita; a forja tem 20s de escrita. Se o cliente travar, o servidor expira e limpa o estado sozinho. Enquanto escreve, o jogador fica parado e vulnerável; movimento e ações são rejeitados.

## Servidor → cliente

| Tipo | Conteúdo |
| --- | --- |
| `client:hello_ack` | `{ protocol, protocolVersion }` confirma o handshake depois de `client:hello`. |
| `rooms:list` | `{ rooms: RoomPublicSummary[] }` |
| `room:error` | `{ code, message, roomId?, ... }` |
| `room:lobby_state` | `LobbyStatePayload` (membros, Master, configurações e fase). |
| `room:settings_updated` | `{ accessMode, hostId, hostName }` |
| `room:init` | `RoomInitWirePayload`: estado inicial completo (seed, dimensões, grade inicial, jogadores, eventos, loot, `serverNow`, `event`, `catalogVersion` e `assetVersion`). Inclui `contentItems: WeaponBlueprint[]` com todas as armas já presentes na sala. |
| `room:tick` | `RoomTickWirePayload`: jogadores, projéteis, loot, entidades, eventos, timers, água e resumo. Slots e loot trazem só `weaponId`; o blueprint não é reenviado. Inclui `serverNow`, `event`, `catalogVersion`, `assetVersion` e, por jogador, `prompt` e `forge`. |
| `content:items` | `{ catalogVersion, weapons: WeaponBlueprint[] }` com blueprints novos de uma instância de arma. Enviado antes do primeiro `room:tick` que referencia o id. |
| `room:killfeed` | `KillfeedEntry` (abates e avisos do sistema). |
| `voxel:deltas` | `VoxelDelta[]` com alterações de voxels desde o último envio. |
| `fx:shrapnel` | `{ center, voxels }` para estilhaços locais. |
| `event:pulse` | `EventPulse`: `{ eventId, signature, kind, position, radius, intensity, ttl }`. Pulso autoritativo de impacto/erupção/raio/granizo/destroço/rugido/onda. O cliente usa para VFX/SFX; o servidor nunca envia partículas. |
| `fx:hit` | `{ damage, heavy, position? }` para hitmarker/hitstop e números de dano. |
| `fx:damage` | `{ amount, hp, from? }` para a direção do dano recebido (`from` é a posição do atacante). |
| `fx:pickup` | Efeito sonoro de coleta. |
| `pong` | `{ t }` ecoado de `ping` para calcular RTT no cliente. |
| `ai:weapon_ready` | `{ weapon, slotIndex }` quando a arma do catálogo é equipada. |
| `ai:error` | `{ message }` em falhas de permissão/tempo da forja ou evento. |
| `ai:event_raffle_won` | Jogador local foi sorteado para propor um evento. |
| `dev:catalog` | `DevCatalogPayload`: `{ catalogVersion, weapons, events }` com `id`, nome, aliases, tags, `budgetUsed` e resumo. Só existe em dev mode; enviado sob demanda ao abrir o painel F8. |
| `player:select_slot` | `{ slotIndex }` quando o servidor força a troca de slot. |

Cada jogador carrega `prompt: { kind, endsAt } | null` e `forge: { phase, endsAt }`. O evento da sala carrega `event: { phase, endsAt, rafflePlayerId, rafflePlayerName }`. Use `serverNow` para interpolar os contadores; os campos antigos em segundos continuam no payload durante a migração. O campo `prompt` de um evento ativo é o nome do item do catálogo, não o texto cru digitado pelo jogador. `room:init`/`room:tick` incluem `contentPool: { hash, algorithmVersion, catalogVersion, weaponCount, eventCount } | null`, o arsenal da sala — hoje o catálogo ativo inteiro; `assetIds` aparece só no `room:init` para prefetch. No fio, `activeEvents` é `NetMapEventState`: os campos estáticos `components` e `entityBlueprint` foram removidos do tick (o cliente não os usa para exibição); `fun` permanece para o HUD mostrar contra-jogadas. Eventos épicos também carregam `phase`, `intensity` e `epicScale`; `center` pode mudar a cada tick em eventos móveis, como o tornado. Jogadores carregam `relicBuff` (`{ id, endsAt } | null`) e `shieldHp`; slots podem ser `kind: 'relic'` com `relicId`. `entities` continua carregando o blueprint da criatura porque o renderizador precisa dele para montar a malha.

Cada jogador também traz `stamina`, `sprinting`, `crouching`, `sliding`, `slideCooldownSec`, `climbing` e `ziplineRouteId` para HUD/câmera. As rotas de tirolesa **não** vão no protocolo: cliente e servidor derivam a mesma lista determinística da seed/dimensões via `createProceduralIsland(..., meta)`.

## Códigos de erro

`ROOM_NOT_FOUND`, `ROOM_EXISTS`, `ROOM_FULL`, `ROOM_CLOSED`, `INVALID_PASSWORD`, `PASSWORD_REQUIRED`, `PASSWORD_REQUIRED_ON_CREATE`, `NEED_PLAYERS`, `NOT_HOST`, `KICKED` e `DEV_DISABLED`.

Falhas de handshake (socket recusado/fechado): `PROTOCOL_MISMATCH`, `CLIENT_OUTDATED`, `SERVER_OUTDATED`, `HANDSHAKE_REQUIRED` e `HELLO_TIMEOUT`. O cliente trata esses códigos como bloqueio de boot (overlay com explicação e retry), não como erro de sala.

## Observações

- Não há autenticação: a identidade é a conexão WebSocket e o `playerId` gerado pelo servidor. O `client:hello` verifica compatibilidade de protocolo, não identidade nem autorização.
- Salas, partidas e sockets vivem em memória; o servidor não retoma uma partida após reiniciar.
- `devState` só aparece em `room:tick` quando o servidor está com dev mode habilitado.
- Como o WebSocket vai direto do navegador para a VPS, a página HTTPS exige `wss://`. A Vercel não faz proxy desse tráfego.
- `CORS_ORIGINS` protege apenas navegadores; ela não autentica clientes nem substitui rate limiting.
