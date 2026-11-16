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
| `player:input` | `ClientInputPacket` | Movimento, pulo, yaw/pitch, slot ativo e flag de digitação. |
| `player:action` | `{ origin, dir }` | Ação primária (tiro, escavação ou gancho). |
| `player:drop` | — | Descarta o item do slot ativo. |
| `player:pickup` | — | Pega o loot mais próximo. |
| `ai:forge_weapon` | `{ prompt, allocation? }` | Forja uma arma; consome a recarga e responde com `ai:weapon_ready`. |
| `ai:weapon_prompt_timeout` | — | Cancela a forja e aplica recarga curta. |
| `ai:trigger_event` | `{ prompt }` | Só funciona para o jogador sorteado da rodada. |
| `room:start` | `{ devSolo? }` | Master inicia a partida (`devSolo` só em dev mode). |
| `room:update_settings` | `accessMode?`, `password?`, `roomName?`, `targetPlayers?`, `fillWithBots?` | Ajustes de sala; parte só é aceita no lobby e/ou pelo Master. |
| `room:kick` | `{ targetPlayerId }` | Master expulsa um jogador. |
| `room:transfer_host` | `{ targetPlayerId }` | Master transfere a liderança. |
| `room:restart` | — | Master reinicia a partida. |
| `dev:action` | `DevActionPayload` | Ferramentas de desenvolvimento; ignorado se o dev mode estiver desligado. |

`DevActionPayload` aceita: `toggle_god_mode`, `toggle_infinite_sandbox`, `toggle_freeze_bots`, `unlock_forge`, `refill_player`, `quick_forge`, `win_event_raffle`, `trigger_event`, `clear_events`, `teleport_center`, `spawn_bot`, `kill_bots` e `force_restart`.

## Servidor → cliente

| Tipo | Conteúdo |
| --- | --- |
| `rooms:list` | `{ rooms: RoomPublicSummary[] }` |
| `room:error` | `{ code, message, roomId?, ... }` |
| `room:lobby_state` | `LobbyStatePayload` (membros, Master, configurações e fase). |
| `room:settings_updated` | `{ accessMode, hostId, hostName }` |
| `room:init` | `RoomInitPayload`: estado inicial completo (seed, dimensões, grade inicial, jogadores, eventos e loot). |
| `room:tick` | `RoomTickPayload`: jogadores, projéteis, loot, entidades, eventos, timers, água e resumo. |
| `room:killfeed` | `KillfeedEntry` (abates e avisos do sistema). |
| `voxel:deltas` | `VoxelDelta[]` com alterações de voxels desde o último envio. |
| `fx:shrapnel` | `{ center, voxels }` para estilhaços locais. |
| `fx:hit` | `{ heavy }` para hitmarker/hitstop. |
| `fx:pickup` | Efeito sonoro de coleta. |
| `ai:weapon_ready` | `{ slotIndex }` quando a arma forjada é equipada. |
| `ai:error` | `{ message }` em falhas de permissão/tempo da forja ou evento. |
| `ai:event_raffle_won` | Jogador local foi sorteado para propor um evento. |
| `player:select_slot` | `{ slotIndex }` quando o servidor força a troca de slot. |

## Códigos de erro

`ROOM_NOT_FOUND`, `ROOM_EXISTS`, `ROOM_FULL`, `ROOM_CLOSED`, `INVALID_PASSWORD`, `PASSWORD_REQUIRED`, `PASSWORD_REQUIRED_ON_CREATE`, `NEED_PLAYERS`, `NOT_HOST`, `KICKED` e `DEV_DISABLED`.

## Observações

- Não há autenticação: a identidade é a conexão WebSocket e o `playerId` gerado pelo servidor.
- Salas, partidas e sockets vivem em memória; o servidor não retoma uma partida após reiniciar.
- `devState` só aparece em `room:tick` quando o servidor está com dev mode habilitado.
- Como o WebSocket vai direto do navegador para a VPS, a página HTTPS exige `wss://`. A Vercel não faz proxy desse tráfego.
- `CORS_ORIGINS` protege apenas navegadores; ela não autentica clientes nem substitui rate limiting.
