# Protocolo WebSocket

O transporte é um WebSocket em `/ws`. Por padrão ele usa o mesmo host do cliente (`ws://` ou `wss://` conforme a página). Em produção, o frontend fica na Vercel e o cliente usa:

- `VITE_API_URL` para chamadas REST (`/api/*`);
- `VITE_WS_URL` para o WebSocket completo, ou a derivação automática de `VITE_API_URL` trocando `https` por `wss` e anexando `/ws`.

Sem essas variáveis, tudo continua na mesma origem, como no desenvolvimento local. A origem do handshake pode ser restringida na VPS por `CORS_ORIGINS`. Todas as mensagens são JSON com o envelope:

```json
{ "type": "namespace:action", "payload": {} }
```

A fonte de verdade dos campos é `src/shared/types.ts`. `room:tick` é enviado a 20 Hz com o estado público dos jogadores; o cliente envia entradas com throttle de 45 ms.

## Cliente → servidor

### Antes de entrar em uma sala

Tratadas em `server.ts`:

| Tipo | Payload | Efeito |
| --- | --- | --- |
| `rooms:list` | — | Responde com a lista de salas públicas. |
| `room:create` | `roomId?`, `roomName?`, `playerName?`, `accessMode?`, `password?`, `targetPlayers?`, `fillWithBots?`, `startImmediately?` | Cria a sala, entra como Master e pode iniciar imediatamente. |
| `room:join` | `roomId`, `playerName?`, `password?` | Entra em uma sala existente. |
| `room:quick_play` | `roomId?`, `playerName?`, `targetPlayers?`, `fillWithBots?` | Entra em uma sala aberta disponível ou cria uma nova. |
| `room:leave` | — | Desvincula o socket da sala atual. |

### Durante a partida

Tratadas em `RoomManager.handleClientMessage`:

| Tipo | Payload | Efeito |
| --- | --- | --- |
| `player:input` | `ClientInputPacket` | Movimento, pulo, yaw/pitch e slot ativo. Ignorado enquanto o jogador está escrevendo. |
| `player:action` | `{ origin, dir }` | Ação primária (tiro, escavação ou gancho). Rejeitada durante a escrita. |
| `player:drop` | — | Descarta o item do slot ativo. Rejeitado durante a escrita. |
| `player:pickup` | — | Pega o loot mais próximo. Rejeitado durante a escrita. |
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
| `dev:action` | `DevActionPayload` | Ferramentas de desenvolvimento; ignorado se o dev mode estiver desligado. |

`DevActionPayload` aceita: `toggle_god_mode`, `toggle_infinite_sandbox`, `toggle_freeze_bots`, `unlock_forge`, `refill_player`, `quick_forge`, `win_event_raffle`, `trigger_event`, `clear_events`, `teleport_center`, `spawn_bot`, `kill_bots` e `force_restart`.

O servidor é dono dos prazos. O evento global tem 10s para o sorteado reivindicar e 20s de escrita; a forja tem 20s de escrita. Se o cliente travar, o servidor expira e limpa o estado sozinho. Enquanto escreve, o jogador fica parado e vulnerável; movimento e ações são rejeitados.

## Servidor → cliente

| Tipo | Conteúdo |
| --- | --- |
| `rooms:list` | `{ rooms: RoomPublicSummary[] }` |
| `room:error` | `{ code, message, roomId?, ... }` |
| `room:lobby_state` | `LobbyStatePayload` (membros, Master, configurações e fase). |
| `room:settings_updated` | `{ accessMode, hostId, hostName }` |
| `room:init` | `RoomInitPayload`: estado inicial completo (seed, dimensões, grade inicial, jogadores, eventos, loot, `serverNow`, `event`, `catalogVersion` e `assetVersion`). |
| `room:tick` | `RoomTickPayload`: jogadores, projéteis, loot, entidades, eventos, timers, água e resumo. Inclui `serverNow`, `event`, `catalogVersion`, `assetVersion` e, por jogador, `prompt` e `forge`. |
| `room:killfeed` | `KillfeedEntry` (abates e avisos do sistema). |
| `voxel:deltas` | `VoxelDelta[]` com alterações de voxels desde o último envio. |
| `fx:shrapnel` | `{ center, voxels }` para estilhaços locais. |
| `fx:hit` | `{ heavy }` para hitmarker/hitstop. |
| `fx:pickup` | Efeito sonoro de coleta. |
| `ai:weapon_ready` | `{ weapon, slotIndex }` quando a arma do catálogo é equipada. |
| `ai:error` | `{ message }` em falhas de permissão/tempo da forja ou evento. |
| `ai:event_raffle_won` | Jogador local foi sorteado para propor um evento. |
| `player:select_slot` | `{ slotIndex }` quando o servidor força a troca de slot. |

Cada jogador carrega `prompt: { kind, endsAt } | null` e `forge: { phase, endsAt }`. O evento da sala carrega `event: { phase, endsAt, rafflePlayerId, rafflePlayerName }`. Use `serverNow` para interpolar os contadores; os campos antigos em segundos continuam no payload durante a migração.

## Códigos de erro

`ROOM_NOT_FOUND`, `ROOM_EXISTS`, `ROOM_FULL`, `ROOM_CLOSED`, `INVALID_PASSWORD`, `PASSWORD_REQUIRED`, `PASSWORD_REQUIRED_ON_CREATE`, `NEED_PLAYERS`, `NOT_HOST`, `KICKED` e `DEV_DISABLED`.

## Observações

- Não há autenticação: a identidade é a conexão WebSocket e o `playerId` gerado pelo servidor.
- Salas, partidas e sockets vivem em memória; o servidor não retoma uma partida após reiniciar.
- `devState` só aparece em `room:tick` quando o servidor está com dev mode habilitado.
- Como o WebSocket vai direto do navegador para a VPS, a página HTTPS exige `wss://`. A Vercel não faz proxy desse tráfego.
- `CORS_ORIGINS` protege apenas navegadores; ela não autentica clientes nem substitui rate limiting.
