import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { resolveEventFromCatalog } from './catalog.ts';
import { VOXEL_SIZE } from '../src/shared/types.ts';
import { RoomManager, type SocketLike } from './roomManager.ts';

class MockSocket implements SocketLike {
  readyState = WebSocket.OPEN;
  send(_data: string): void {
    // no-op
  }
}

test('composed events activate all components', () => {
  const manager = new RoomManager({ devEnabled: true });
  try {
    const ws = new MockSocket();
    const res = manager.createAndJoinRoom(ws, {
      roomId: 'EVENTCOMP',
      playerName: 'Ana',
      targetPlayers: 4,
      fillWithBots: false,
      startImmediately: true,
    });
    assert.ok(res);
    const center: [number, number, number] = [
      (res.room.dimX * VOXEL_SIZE) / 2,
      10,
      (res.room.dimZ * VOXEL_SIZE) / 2,
    ];
    const resolution = resolveEventFromCatalog(
      'Chuva de meteoros com matilha de lobos',
      'p1',
      'Ana',
      center,
    );
    assert.equal(resolution.strategy, 'composition');
    assert.equal(resolution.event.components?.length, 2);

    (manager as any).enqueueMapEvent(res.room, resolution.event);
    resolution.event.warningRemainingSec = 0.01;
    (manager as any).tickRoom(res.room, 0.05);

    assert.equal(res.room.activeEvents[0].components?.length, 2);
    assert.ok(
      res.room.entities.some((entity) => entity.kind === 'creature'),
      'componente ENTITY_SPAWN deve criar criaturas',
    );
  } finally {
    manager.disposeAll();
  }
});
