import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { isClientDevEnabled, isServerDevEnabled } from '../src/shared/devMode.ts';
import { getCatalogVersion } from './catalog.ts';
import { RoomManager, type SocketLike } from './roomManager.ts';

interface CapturedMsg {
  type: string;
  payload: any;
}

class MockSocket implements SocketLike {
  readyState = WebSocket.OPEN;
  messages: CapturedMsg[] = [];

  send(data: string): void {
    this.messages.push(JSON.parse(data) as CapturedMsg);
  }

  last(type?: string): CapturedMsg | undefined {
    if (!type) return this.messages[this.messages.length - 1];
    for (let i = this.messages.length - 1; i >= 0; i--) {
      if (this.messages[i].type === type) return this.messages[i];
    }
    return undefined;
  }

  clear(): void {
    this.messages.length = 0;
  }
}

test('dev mode gating flags strictly block production environments', () => {
  assert.equal(isServerDevEnabled('production'), false);
  assert.equal(isServerDevEnabled('development'), true);
  assert.equal(isServerDevEnabled(undefined), true);

  assert.equal(isClientDevEnabled(false, true), false);
  assert.equal(isClientDevEnabled(true, false), false);
  assert.equal(isClientDevEnabled(false, false), false);
  assert.equal(isClientDevEnabled(true, true), true);
});

test('RoomManager with devEnabled=false blocks dev:action and solo dev start cleanly', () => {
  const manager = new RoomManager({ devEnabled: false });
  try {
    const ws = new MockSocket();
    const created = manager.createAndJoinRoom(ws, {
      roomId: 'PROD1',
      roomName: 'Arena Prod',
      playerName: 'ProdTester',
      fillWithBots: false,
    });
    assert.ok(created);

    const lobbyMsg = ws.last('room:lobby_state');
    assert.equal(lobbyMsg?.payload.devMode, false);

    // Solo dev start must be rejected in production
    ws.clear();
    manager.handleClientMessage('PROD1', created.playerId, {
      type: 'room:start',
      payload: { devSolo: true },
    });
    assert.equal(ws.last('room:error')?.payload.code, 'NEED_PLAYERS');

    // Start normally with bots, then try dev:action -> must reject with DEV_DISABLED
    manager.handleClientMessage('PROD1', created.playerId, {
      type: 'room:update_settings',
      payload: { fillWithBots: true },
    });
    manager.handleClientMessage('PROD1', created.playerId, { type: 'room:start' });

    const initMsg = ws.last('room:init');
    assert.ok(initMsg);
    assert.equal(initMsg.payload.devMode, false);
    assert.equal(initMsg.payload.devState, undefined);

    ws.clear();
    manager.handleClientMessage('PROD1', created.playerId, {
      type: 'dev:action',
      payload: { action: 'toggle_god_mode' },
    });
    assert.equal(ws.last('room:error')?.payload.code, 'DEV_DISABLED');

    ws.clear();
    manager.handleClientMessage('PROD1', created.playerId, {
      type: 'dev:action',
      payload: { action: 'kill_bots' },
    });
    assert.equal(ws.last('room:error')?.payload.code, 'DEV_DISABLED');
    assert.equal(created.room.phase, 'playing');

    ws.clear();
    manager.handleClientMessage('PROD1', created.playerId, { type: 'dev:catalog' });
    assert.equal(ws.last('room:error')?.payload.code, 'DEV_DISABLED');
    assert.equal(ws.last('dev:catalog'), undefined);
  } finally {
    manager.disposeAll();
  }
});

test('RoomManager with devEnabled=true enables solo sandbox start, weapon/event shortcuts, toggles, and bot controls', async () => {
  const manager = new RoomManager({ devEnabled: true });
  try {
    const ws = new MockSocket();
    const created = manager.createAndJoinRoom(ws, {
      roomId: 'DEV1',
      roomName: 'Sandbox Dev',
      playerName: 'DevUser',
      fillWithBots: false,
    });
    assert.ok(created);
    assert.equal(ws.last('room:lobby_state')?.payload.devMode, true);

    // Solo dev start works without bots
    manager.handleClientMessage('DEV1', created.playerId, {
      type: 'room:start',
      payload: { devSolo: true },
    });
    const initMsg = ws.last('room:init');
    assert.ok(initMsg);
    assert.equal(initMsg.payload.devMode, true);
    assert.equal(initMsg.payload.players.length, 1);
    assert.equal(initMsg.payload.devState.enabled, true);

    const host = created.room.players.get(created.playerId)!;
    assert.equal(host.canForgeWeapon, false);

    // Unlock forge immediately
    manager.handleClientMessage('DEV1', created.playerId, {
      type: 'dev:action',
      payload: { action: 'unlock_forge' },
    });
    assert.equal(host.canForgeWeapon, true);
    assert.equal(host.weaponCooldownSec, 0);

    // Toggle God Mode, Infinite Sandbox, Freeze Bots
    manager.handleClientMessage('DEV1', created.playerId, {
      type: 'dev:action',
      payload: { action: 'toggle_god_mode' },
    });
    manager.handleClientMessage('DEV1', created.playerId, {
      type: 'dev:action',
      payload: { action: 'toggle_infinite_sandbox' },
    });
    manager.handleClientMessage('DEV1', created.playerId, {
      type: 'dev:action',
      payload: { action: 'toggle_freeze_bots' },
    });
    assert.equal(created.room.devGodMode, true);
    assert.equal(created.room.devInfiniteSandbox, true);
    assert.equal(created.room.devBotsFrozen, true);

    // Quick forge equips weapon directly without waiting
    manager.handleClientMessage('DEV1', created.playerId, {
      type: 'dev:action',
      payload: { action: 'quick_forge', prompt: 'Rifle laser azul' },
    });
    await new Promise((r) => setTimeout(r, 40));
    assert.ok(host.slots.some((s) => s?.kind === 'weapon'));

    // Win event raffle & trigger fast event
    manager.handleClientMessage('DEV1', created.playerId, {
      type: 'dev:action',
      payload: { action: 'win_event_raffle' },
    });
    assert.equal(created.room.rafflePlayerId, created.playerId);

    manager.handleClientMessage('DEV1', created.playerId, {
      type: 'dev:action',
      payload: { action: 'trigger_event', prompt: 'Chuva de meteoros' },
    });
    await new Promise((r) => setTimeout(r, 40));
    assert.equal(created.room.activeEvents.length, 1);
    // The 20 Hz tick may already have decremented the 1 s warning.
    assert.ok(created.room.activeEvents[0].warningRemainingSec <= 1);

    // Spawn bot then kill all bots -> triggers match victory
    manager.handleClientMessage('DEV1', created.playerId, {
      type: 'dev:action',
      payload: { action: 'spawn_bot' },
    });
    assert.equal(created.room.players.size, 2);

    manager.handleClientMessage('DEV1', created.playerId, {
      type: 'dev:action',
      payload: { action: 'kill_bots' },
    });
    assert.equal(created.room.phase, 'ended');
    assert.equal(created.room.summary?.winnerId, created.playerId);
  } finally {
    manager.disposeAll();
  }
});

test('dev catalog lists exact items and spawns weapons, bot loadouts, events, and training dummies', async () => {
  const manager = new RoomManager({ devEnabled: true });
  try {
    const ws = new MockSocket();
    const created = manager.createAndJoinRoom(ws, {
      roomId: 'DEV2',
      roomName: 'Catálogo Dev',
      playerName: 'DevUser',
      fillWithBots: false,
    });
    assert.ok(created);
    manager.handleClientMessage('DEV2', created.playerId, {
      type: 'room:start',
      payload: { devSolo: true },
    });
    const host = created.room.players.get(created.playerId)!;

    // Catálogo compacto, sem carregar shards no payload do tick.
    ws.clear();
    manager.handleClientMessage('DEV2', created.playerId, { type: 'dev:catalog' });
    const catalogMsg = ws.last('dev:catalog');
    assert.ok(catalogMsg);
    assert.equal(catalogMsg.payload.catalogVersion, getCatalogVersion());
    assert.ok(catalogMsg.payload.weapons.some((w: any) => w.id === 'wpn_pistol_ice'));
    assert.ok(catalogMsg.payload.events.some((e: any) => e.id === 'evt_terrain_rising_tide'));

    // Arma exata por id, sem passar pela pontuação de prompts.
    const pistol = catalogMsg.payload.weapons.find((w: any) => w.id === 'wpn_pistol_ice');
    assert.equal(pistol.name.length > 0, true);
    manager.handleClientMessage('DEV2', created.playerId, {
      type: 'dev:action',
      payload: { action: 'spawn_catalog_weapon', itemId: 'wpn_pistol_ice' },
    });
    assert.ok(host.slots.some((slot) => slot?.weapon?.catalogId === 'wpn_pistol_ice'));
    assert.equal(host.slots[host.activeSlot]?.weapon?.catalogId, 'wpn_pistol_ice');

    // Item desconhecido não equipa nada nem quebra a partida.
    const beforeSlots = host.slots.filter(Boolean).length;
    manager.handleClientMessage('DEV2', created.playerId, {
      type: 'dev:action',
      payload: { action: 'spawn_catalog_weapon', itemId: 'wpn_does_not_exist' },
    });
    assert.equal(host.slots.filter(Boolean).length, beforeSlots);

    // Arma exata em um bot vivo, para testar o comportamento ofensivo.
    manager.handleClientMessage('DEV2', created.playerId, {
      type: 'dev:action',
      payload: { action: 'spawn_bot' },
    });
    const bot = Array.from(created.room.players.values()).find((p) => p.isBot && p.alive);
    assert.ok(bot);
    manager.handleClientMessage('DEV2', created.playerId, {
      type: 'dev:action',
      payload: { action: 'equip_bot_weapon', itemId: 'wpn_rifle_standard' },
    });
    assert.ok(bot.slots.some((slot) => slot?.weapon?.catalogId === 'wpn_rifle_standard'));

    // Evento exato por id, com aviso reduzido para testar na hora.
    ws.clear();
    manager.handleClientMessage('DEV2', created.playerId, {
      type: 'dev:action',
      payload: { action: 'spawn_catalog_event', itemId: 'evt_terrain_rising_tide' },
    });
    assert.equal(created.room.activeEvents.length, 1);
    assert.equal(created.room.activeEvents[0].catalogId, 'evt_terrain_rising_tide');
    assert.ok(created.room.activeEvents[0].warningRemainingSec <= 1);

    // Pausa dos eventos automáticos e pulo da espera de sorteio.
    manager.handleClientMessage('DEV2', created.playerId, {
      type: 'dev:action',
      payload: { action: 'toggle_auto_events' },
    });
    assert.equal(created.room.devAutoEventsPaused, true);
    manager.handleClientMessage('DEV2', created.playerId, {
      type: 'dev:action',
      payload: { action: 'skip_event_cooldown' },
    });
    await new Promise((r) => setTimeout(r, 80));
    assert.equal(created.room.rafflePlayerId, null);

    // Alvo de treino: imóvel, com vida extra, visível na partida.
    const beforeDummy = created.room.players.size;
    manager.handleClientMessage('DEV2', created.playerId, {
      type: 'dev:action',
      payload: { action: 'spawn_dummy' },
    });
    assert.equal(created.room.players.size, beforeDummy + 1);
    const dummy = Array.from(created.room.players.values()).find((p) => p.devDummy);
    assert.ok(dummy);
    assert.equal(dummy!.hp, 250);
    assert.equal(dummy!.name.startsWith('Alvo '), true);

    // Dano de teste no jogador humano.
    host.hp = 100;
    manager.handleClientMessage('DEV2', created.playerId, {
      type: 'dev:action',
      payload: { action: 'damage_player', amount: 25 },
    });
    assert.equal(host.hp, 75);

    // Modo Deus continua bloqueando dano de dev.
    manager.handleClientMessage('DEV2', created.playerId, {
      type: 'dev:action',
      payload: { action: 'toggle_god_mode' },
    });
    manager.handleClientMessage('DEV2', created.playerId, {
      type: 'dev:action',
      payload: { action: 'damage_player', amount: 100 },
    });
    assert.equal(host.hp, 100);
  } finally {
    manager.disposeAll();
  }
});
