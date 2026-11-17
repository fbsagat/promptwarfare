import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { RoomManager, type SocketLike } from './roomManager.ts';

class MockSocket implements SocketLike {
  readyState = WebSocket.OPEN;
  send(_data: string): void {}
}

test('client:perf accumulates asset cache deltas without double counting', () => {
  const manager = new RoomManager({ devEnabled: false });
  try {
    const socket = new MockSocket();
    const created = manager.createAndJoinRoom(socket, {
      roomId: 'PERF1',
      playerName: 'Ana',
      targetPlayers: 4,
      fillWithBots: false,
    });
    assert.ok(created);

    manager.handleClientMessage(created.room.id, created.playerId, {
      type: 'client:perf',
      payload: { assets: { loaded: 12, requests: 2, fetched: 10, failed: 1, bytes: 2048 } },
    });
    let stats = manager.getRuntimeStats();
    assert.equal(stats.clientAssets.loadedMax, 12);
    assert.equal(stats.clientAssets.requests, 2);
    assert.equal(stats.clientAssets.fetched, 10);
    assert.equal(stats.clientAssets.failed, 1);
    assert.equal(stats.clientAssets.bytes, 2048);
    assert.equal(stats.clientAssets.reporters, 1);

    // Relatório cumulativo: só o delta entra nos totais.
    manager.handleClientMessage(created.room.id, created.playerId, {
      type: 'client:perf',
      payload: { assets: { loaded: 20, requests: 3, fetched: 15, failed: 2, bytes: 4096 } },
    });
    stats = manager.getRuntimeStats();
    assert.equal(stats.clientAssets.loadedMax, 20);
    assert.equal(stats.clientAssets.requests, 3);
    assert.equal(stats.clientAssets.fetched, 15);
    assert.equal(stats.clientAssets.failed, 2);
    assert.equal(stats.clientAssets.bytes, 4096);
  } finally {
    manager.disposeAll();
  }
});
