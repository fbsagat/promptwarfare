import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { resolveEventFromCatalog } from './catalog.ts';
import { VOXEL_SIZE } from '../src/shared/types.ts';
import { RoomManager, type SocketLike } from './roomManager.ts';

class MockSocket implements SocketLike {
  readyState = WebSocket.OPEN;
  send(_data: string): void {}
}

function createRoom(manager: RoomManager, roomId: string) {
  const created = manager.createAndJoinRoom(new MockSocket(), {
    roomId,
    playerName: 'Ana',
    targetPlayers: 4,
    fillWithBots: false,
    startImmediately: true,
  });
  assert.ok(created);
  const center: [number, number, number] = [
    (created.room.dimX * VOXEL_SIZE) / 2,
    10,
    (created.room.dimZ * VOXEL_SIZE) / 2,
  ];
  return { ...created, center };
}

test('relic pickup fits an empty slot and activation starts the buff', () => {
  const manager = new RoomManager({ devEnabled: true });
  try {
    const { room, playerId } = createRoom(manager, 'RELICUSE');
    const player = room.players.get(playerId);
    assert.ok(player);
    (manager as any).grantRelic(room, player, 'wind_anchor');
    const relicSlot = player.slots.findIndex((slot) => slot?.kind === 'relic');
    assert.ok(relicSlot >= 0, 'relíquia precisa entrar no inventário');
    assert.equal(player.slots[relicSlot]?.relicId, 'wind_anchor');

    player.activeSlot = relicSlot;
    (manager as any).performActiveItem(room, player);
    assert.equal(player.slots[relicSlot], null);
    assert.equal(player.relicBuff?.id, 'wind_anchor');
    assert.ok((player.relicBuff?.endsAt ?? 0) > Date.now());
  } finally {
    manager.disposeAll();
  }
});

test('acid mask blocks acid and venom damage but not bullets', () => {
  const manager = new RoomManager({ devEnabled: true });
  try {
    const { room, playerId } = createRoom(manager, 'RELICACID');
    const player = room.players.get(playerId);
    assert.ok(player);
    player.relicBuff = { id: 'acid_mask', endsAt: Date.now() + 20_000 };
    (manager as any).damagePlayer(room, player, 25, null, 'chuva ácida');
    assert.equal(player.hp, 100, 'máscara precisa bloquear dano ácido');
    (manager as any).damagePlayer(room, player, 25, null, 'veneno');
    assert.equal(player.hp, 100, 'máscara precisa bloquear veneno');
    (manager as any).damagePlayer(room, player, 10, null, 'tiro');
    assert.ok(player.hp < 100, 'máscara não pode bloquear dano balístico');
  } finally {
    manager.disposeAll();
  }
});

test('titan heart grants shield before HP and consumes the shield first', () => {
  const manager = new RoomManager({ devEnabled: true });
  try {
    const { room, playerId } = createRoom(manager, 'RELICTITAN');
    const player = room.players.get(playerId);
    assert.ok(player);
    (manager as any).grantRelic(room, player, 'titan_heart');
    const slot = player.slots.findIndex((item) => item?.relicId === 'titan_heart');
    player.activeSlot = slot;
    (manager as any).performActiveItem(room, player);
    assert.equal(player.shieldHp, 60);
    (manager as any).damagePlayer(room, player, 30, null, 'teste');
    assert.equal(player.hp, 100);
    assert.equal(player.shieldHp, 30);
    (manager as any).damagePlayer(room, player, 50, null, 'teste');
    assert.equal(player.shieldHp, 0);
    assert.ok(player.hp < 100);
  } finally {
    manager.disposeAll();
  }
});

test('relic buff expires on the authoritative tick', () => {
  const manager = new RoomManager({ devEnabled: true });
  try {
    const { room, playerId } = createRoom(manager, 'RELICEXPIRE');
    const player = room.players.get(playerId);
    assert.ok(player);
    player.relicBuff = { id: 'thermal_core', endsAt: Date.now() - 1 };
    (manager as any).tickRoom(room, 0.05);
    assert.equal(player.relicBuff, null);
  } finally {
    manager.disposeAll();
  }
});

test('wind anchor ignores tornado force and core damage', () => {
  const manager = new RoomManager({ devEnabled: true });
  try {
    const { room, playerId, center } = createRoom(manager, 'RELICWIND');
    const player = room.players.get(playerId);
    assert.ok(player);
    const event = resolveEventFromCatalog('Tornado', 'p1', 'Ana', center).event;
    (manager as any).enqueueMapEvent(room, event);
    room.activeEvents[room.activeEvents.length - 1].warningRemainingSec = 0.01;
    (manager as any).tickEvents(room, 0.05);
    (manager as any).tickEvents(room, 0.05);
    player.position = { x: event.center[0], y: event.center[1], z: event.center[2] };
    player.velocity = { x: 0, y: 0, z: 0 };
    player.relicBuff = { id: 'wind_anchor', endsAt: Date.now() + 20_000 };
    event.durationRemainingSec = Math.max(1, event.totalDurationSec * 0.4);
    (manager as any).tickEvents(room, 0.7);
    assert.equal(player.hp, 100);
    assert.equal(Math.hypot(player.velocity.x, player.velocity.z), 0);
  } finally {
    manager.disposeAll();
  }
});

test('event cores carry a relic and the full inventory drops it on the floor', () => {
  const manager = new RoomManager({ devEnabled: true });
  try {
    const { room, playerId, center } = createRoom(manager, 'RELICCORE');
    const player = room.players.get(playerId);
    assert.ok(player);
    for (let i = 0; i < 4; i++) player.slots[i] = null;
    // Preenche os 4 slots com relíquias para forçar o drop no chão.
    for (let i = 0; i < 4; i++) {
      (manager as any).grantRelic(room, player, 'wind_anchor', false);
    }
    assert.ok(player.slots.every((slot) => slot !== null));

    const event = resolveEventFromCatalog('Tornado', 'p1', 'Ana', center).event;
    (manager as any).spawnEventCore(
      room,
      event,
      { x: center[0], y: center[1], z: center[2] },
      'Núcleo de teste',
      30,
      150,
    );
    const core = room.entities.find((entity: any) => entity.name === 'Núcleo de teste');
    assert.ok(core);
    assert.equal(core.relicId, 'wind_anchor');

    (manager as any).grantRelic(room, player, 'titan_heart');
    assert.ok(
      room.lootDrops.some((drop) => drop.item.relicId === 'titan_heart'),
      'inventário cheio precisa derrubar a relíquia no chão',
    );
  } finally {
    manager.disposeAll();
  }
});
