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
    assert.equal(usage[0].item_id, 'wpn_pistol_ice');
    assert.equal(usage[0].actor_type, 'human');

    (manager as any).killPlayer(res.room, victim, attacker, 'teste');
    usage = ledger.getUsage();
    assert.equal(usage.length, 3);
    const kill = usage.find((row) => row.role === 'kill')!;
    assert.equal(kill.item_id, 'wpn_pistol_ice');
    assert.equal(kill.target_ref, victim.id);
    const survival = usage.find((row) => row.role === 'survival')!;
    assert.equal(survival.actor_ref, attacker.id);
    assert.match(survival.metadata_json ?? '', /won/);
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
    assert.equal(rows[1].item_id, 'wpn_pistol_ice');
    assert.equal(rows[1].strategy, 'alias');
    assert.equal(rows[1].room_id, 'LEDGER1');
    assert.ok(rows[1].match_id);
  } finally {
    manager.disposeAll();
    ledger.close();
  }
});
