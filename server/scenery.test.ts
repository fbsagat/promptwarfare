import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { resolveEventFromCatalog } from './catalog.ts';
import { MAT, VOXEL_SIZE } from '../src/shared/types.ts';
import { RoomManager, type SocketLike } from './roomManager.ts';

class MockSocket implements SocketLike {
  readyState = WebSocket.OPEN;
  send(_data: string): void {}
}

test('scenery event rises from the ground in layers', () => {
  const manager = new RoomManager({ devEnabled: true });
  try {
    const created = manager.createAndJoinRoom(new MockSocket(), {
      roomId: 'SCENERY1',
      playerName: 'Ana',
      targetPlayers: 4,
      fillWithBots: false,
      startImmediately: true,
    });
    assert.ok(created);
    const room: any = created.room;
    const center: [number, number, number] = [
      (room.dimX * VOXEL_SIZE) / 2,
      10,
      (room.dimZ * VOXEL_SIZE) / 2,
    ];

    const resolution = resolveEventFromCatalog('Árvore', 'p1', 'Ana', center);
    assert.equal(resolution.strategy, 'alias');
    assert.equal(resolution.itemId, 'evt_scenery_tree');
    (manager as any).enqueueMapEvent(room, resolution.event);
    room.activeEvents[room.activeEvents.length - 1].warningRemainingSec = 0.01;

    (manager as any).tickEvents(room, 0.05); // ativa e cria o plano
    assert.equal(room.sceneryPlans.size, 1);

    const before = room.pendingTickDeltas.length;
    for (let i = 0; i < 8; i++) (manager as any).advanceSceneryPlans(room);
    const added = room.pendingTickDeltas.slice(before);
    assert.ok(added.length > 0, 'nenhum voxel de cenário foi aplicado');
    assert.ok(
      added.some((delta: any) => delta.mat === MAT.WOOD || delta.mat === MAT.LEAVES),
      'árvore não aplicou madeira/folhas',
    );
    assert.ok(
      added.some((delta: any) => delta.vy > 0),
      'cenário não subiu em camadas',
    );
  } finally {
    manager.disposeAll();
  }
});
