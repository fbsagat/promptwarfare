import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { PromptLedger } from './ledger.ts';
import { RoomManager, type SocketLike } from './roomManager.ts';

class MockSocket implements SocketLike {
  readyState = WebSocket.OPEN;
  send(_data: string): void {
    // no-op
  }
}

test('RoomManager records equip and kill usage for catalog items', () => {
  const ledger = new PromptLedger(':memory:');
  const manager = new RoomManager({ devEnabled: true, ledger });
  try {
    const ws = new MockSocket();
    const res = manager.createAndJoinRoom(ws, {
      roomId: 'LEDGER2',
      playerName: 'Ana',
      targetPlayers: 4,
      fillWithBots: false,
      startImmediately: true,
    });
    assert.ok(res);
    const ws2 = new MockSocket();
    const joined = manager.joinExistingRoom(ws2, {
      roomId: res.room.id,
      playerName: 'Bia',
    });
    assert.ok(joined);
    const attacker = res.room.players.get(res.playerId)!;
    const victim = res.room.players.get(joined.playerId)!;
    attacker.canForgeWeapon = true;
    attacker.weaponCooldownSec = 0;

    manager.handleClientMessage(res.room.id, attacker.id, {
      type: 'prompt:open',
      payload: { kind: 'weapon' },
    });
    manager.handleClientMessage(res.room.id, attacker.id, {
      type: 'ai:forge_weapon',
      payload: { prompt: 'Pistola de gelo' },
    });

    let usage = ledger.getUsage();
    assert.equal(usage.length, 1);
    assert.equal(usage[0].role, 'equip');
    const forgedWeaponId = usage[0].item_id;
    // Pedido explícito (alias exato) é honrado mesmo se o item ficar fora do pool.
    assert.equal(forgedWeaponId, 'wpn_pistol_ice');
    assert.equal(usage[0].actor_type, 'human');

    (manager as any).killPlayer(res.room, victim, attacker, 'teste');
    usage = ledger.getUsage();
    assert.equal(usage.length, 3);
    const kill = usage.find((row) => row.role === 'kill')!;
    assert.equal(kill.item_id, forgedWeaponId);
    assert.equal(kill.target_ref, victim.id);
    const survival = usage.find((row) => row.role === 'survival')!;
    assert.equal(survival.actor_ref, attacker.id);
    assert.match(survival.metadata_json ?? '', /won/);
  } finally {
    manager.disposeAll();
    ledger.close();
  }
});

test('content:feedback rejects unknown items and is rate limited', () => {
  const ledger = new PromptLedger(':memory:');
  const manager = new RoomManager({ devEnabled: true, ledger });
  try {
    const ws = new MockSocket();
    const res = manager.createAndJoinRoom(ws, {
      roomId: 'LEDGER3',
      playerName: 'Ana',
      targetPlayers: 4,
      fillWithBots: false,
      startImmediately: true,
    });
    assert.ok(res);
    const player = res.room.players.get(res.playerId)!;

    const sendFeedback = (itemId: string, kind: 'weapon' | 'event', rating: 1 | -1) => {
      manager.handleClientMessage(res.room.id, player.id, {
        type: 'content:feedback',
        payload: { itemId, kind, rating },
      });
    };

    sendFeedback('wpn_pistol_ice', 'weapon', 1);
    sendFeedback('evt_weather_meteor_shower', 'event', 1);
    sendFeedback('item_inexistente', 'weapon', 1);
    sendFeedback('wpn_pistol_ice', 'event', 1);
    sendFeedback('evt_weather_meteor_shower', 'weapon', 1);

    let feedback = ledger.getUsage().filter((row) => row.role === 'feedback');
    assert.equal(feedback.length, 2);
    assert.equal(feedback[0].item_id, 'wpn_pistol_ice');
    assert.equal(feedback[0].kind, 'weapon');
    assert.equal(feedback[1].item_id, 'evt_weather_meteor_shower');
    assert.equal(feedback[1].kind, 'event');

    for (let i = 0; i < 20; i++) sendFeedback('wpn_pistol_ice', 'weapon', 1);
    feedback = ledger.getUsage().filter((row) => row.role === 'feedback');
    assert.equal(feedback.length, 10);
  } finally {
    manager.disposeAll();
    ledger.close();
  }
});

test('RoomManager records opened/submitted prompt sessions in the ledger', () => {
  const ledger = new PromptLedger(':memory:');
  const manager = new RoomManager({ devEnabled: true, ledger });
  try {
    const ws = new MockSocket();
    const res = manager.createAndJoinRoom(ws, {
      roomId: 'LEDGER1',
      playerName: 'Ana',
      targetPlayers: 4,
      fillWithBots: false,
      startImmediately: true,
    });
    assert.ok(res);
    const player = res.room.players.get(res.playerId)!;
    player.canForgeWeapon = true;
    player.weaponCooldownSec = 0;

    manager.handleClientMessage(res.room.id, player.id, {
      type: 'prompt:open',
      payload: { kind: 'weapon' },
    });
    manager.handleClientMessage(res.room.id, player.id, {
      type: 'ai:forge_weapon',
      payload: { prompt: 'Pistola de gelo' },
    });

    const rows = ledger.getEvents();
    assert.equal(rows.length, 2);
    assert.equal(rows[0].phase, 'opened');
    assert.equal(rows[1].phase, 'submitted');
    assert.equal(rows[0].session_id, rows[1].session_id);
    assert.equal(rows[1].actor_type, 'human');
    assert.equal(rows[1].prompt, 'Pistola de gelo');
    assert.ok(rows[1].item_id);
    assert.equal(rows[1].item_id, 'wpn_pistol_ice');
    assert.ok(rows[1].strategy);
    assert.equal(rows[1].pool_hash, res.room.contentPool?.hash);
    const inPool =
      res.room.contentPool?.weaponIds.includes(rows[1].item_id!) ?? false;
    assert.equal(
      rows[1].pool_miss,
      inPool ? 0 : 1,
      'pool_miss deve refletir o desvio do arsenal em pedidos exatos',
    );
    assert.equal(rows[1].room_id, 'LEDGER1');
    assert.ok(rows[1].match_id);
  } finally {
    manager.disposeAll();
    ledger.close();
  }
});
