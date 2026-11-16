import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { resolveEventFromCatalog } from './catalog.ts';
import { MAT, VOXEL_SIZE } from '../src/shared/types.ts';
import { RoomManager, type SocketLike } from './roomManager.ts';

class MockSocket implements SocketLike {
  readyState = WebSocket.OPEN;
  send(_data: string): void {
    // no-op
  }
}

/* Acessos privados via cast são o padrão dos testes de fluxo do RoomManager. */
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

/** Enfileira o evento com warning quase zero; o próximo tick ativa. */
function enqueueEvent(
  manager: RoomManager,
  room: any,
  prompt: string,
  center: [number, number, number],
): void {
  const resolution = resolveEventFromCatalog(prompt, 'p1', 'Ana', center);
  assert.equal(resolution.strategy, 'alias', `${prompt} deveria bater em um alias exato`);
  (manager as any).enqueueMapEvent(room, resolution.event);
  (room.activeEvents[room.activeEvents.length - 1] as { warningRemainingSec: number })
    .warningRemainingSec = 0.01;
}

function tickEvents(manager: RoomManager, room: any, dt: number): void {
  (manager as any).tickEvents(room, dt);
}

/** Remove o teto acima do jogador para os testes de clima exposto. */
function exposePlayer(
  room: any,
  player: { position: { x: number; y: number; z: number } },
): void {
  const vx = Math.floor(player.position.x / VOXEL_SIZE);
  const vz = Math.floor(player.position.z / VOXEL_SIZE);
  const startVy = Math.ceil(player.position.y / VOXEL_SIZE) + 2;
  for (let vy = startVy; vy < room.dimY - 1; vy++) room.grid.set(vx, vy, vz, MAT.AIR);
}

test('new terrain mutation kinds carve or build distinct materials', () => {
  const manager = new RoomManager({ devEnabled: true });
  try {
    const { room, center } = createRoom(manager, 'HAZTERRAIN');

    const cases: Array<{ prompt: string; material: number; label: string }> = [
      { prompt: 'Sorvedouro', material: MAT.AIR, label: 'sorvedouro' },
      { prompt: 'Rio de lava', material: MAT.LAVA, label: 'rio de lava' },
      { prompt: 'Geleira', material: MAT.ICE, label: 'geleira' },
      { prompt: 'Floresta voraz', material: MAT.WOOD, label: 'floresta voraz' },
    ];

    for (const { prompt, material, label } of cases) {
      room.activeEvents.length = 0;
      const before = room.deltas.length;
      enqueueEvent(manager, room, prompt, center);
      tickEvents(manager, room, 0.05);
      const newDeltas = room.deltas.slice(before);
      assert.ok(newDeltas.length > 0, `${label} não gerou deltas de voxel`);
      assert.ok(
        newDeltas.some((delta) => delta.mat === material),
        `${label} não aplicou o material esperado`,
      );
    }
  } finally {
    manager.disposeAll();
  }
});

test('new weather kinds damage players through the authoritative hazard pulse', () => {
  const manager = new RoomManager({ devEnabled: true });
  try {
    const { room, playerId, center } = createRoom(manager, 'HAZWEATHER');
    const player = room.players.get(playerId);
    assert.ok(player);
    exposePlayer(room, player);

    for (const prompt of ['Tempestade de granizo', 'Tempestade de areia']) {
      room.activeEvents.length = 0;
      player.hp = 100;
      enqueueEvent(manager, room, prompt, center);
      tickEvents(manager, room, 0.05); // ativa
      tickEvents(manager, room, 1.3); // pulso de perigo
      assert.ok(player.hp < 100, `${prompt} não causou dano no jogador exposto`);
    }

    // Tornado: no centro do vórtice o jogador sofre dano e ganha impulso vertical.
    room.activeEvents.length = 0;
    player.hp = 100;
    const drift = 10;
    player.position = {
      x: center[0] + Math.cos(room.elapsedSec * 0.35) * drift,
      y: center[1],
      z: center[2] + Math.sin(room.elapsedSec * 0.35) * drift,
    };
    player.velocity = { x: 0, y: 0, z: 0 };
    enqueueEvent(manager, room, 'Tornado', center);
    tickEvents(manager, room, 0.05); // ativa
    tickEvents(manager, room, 1.3); // pulso de perigo
    assert.ok(player.hp < 100, 'tornado não causou dano no centro do vórtice');
    assert.ok(player.velocity.y > 0, 'tornado não aplicou impulso vertical');
  } finally {
    manager.disposeAll();
  }
});
