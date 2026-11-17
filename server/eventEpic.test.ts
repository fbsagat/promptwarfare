import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { resolveEventFromCatalog } from './catalog.ts';
import { MAT, VOXEL_SIZE } from '../src/shared/types.ts';
import { RoomManager, type SocketLike } from './roomManager.ts';

class RecordingSocket implements SocketLike {
  readyState = WebSocket.OPEN;
  messages: Array<{ type: string; payload: any }> = [];

  send(data: string): void {
    try {
      this.messages.push(JSON.parse(data));
    } catch {
      // ignore non-JSON frames
    }
  }
}

function createRoom(manager: RoomManager, socket: RecordingSocket, roomId: string) {
  const created = manager.createAndJoinRoom(socket, {
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

function enqueueEvent(
  manager: RoomManager,
  room: any,
  prompt: string,
  center: [number, number, number],
): any {
  const resolution = resolveEventFromCatalog(prompt, 'p1', 'Ana', center);
  assert.equal(resolution.strategy, 'alias', `${prompt} deveria bater em um alias exato`);
  (manager as any).enqueueMapEvent(room, resolution.event);
  const event = room.activeEvents[room.activeEvents.length - 1];
  event.warningRemainingSec = 0.01;
  return event;
}

function tickEvents(manager: RoomManager, room: any, dt: number): void {
  (manager as any).tickEvents(room, dt);
}

test('tornado F5 moves its vortex, pushes players and broadcasts debris pulses', () => {
  const manager = new RoomManager({ devEnabled: true });
  try {
    const socket = new RecordingSocket();
    const { room, playerId, center } = createRoom(manager, socket, 'EPICTORNADO');
    const player = room.players.get(playerId);
    assert.ok(player);
    const event = enqueueEvent(manager, room, 'Tornado', center);
    tickEvents(manager, room, 0.05); // ativa
    tickEvents(manager, room, 0.05); // primeiro tick do motor

    const firstCenter = { x: event.center[0], z: event.center[2] };
    player.position = { x: event.center[0], y: event.center[1], z: event.center[2] };
    player.velocity = { x: 0, y: 0, z: 0 };
    tickEvents(manager, room, 0.5);

    assert.ok(
      Math.hypot(event.center[0] - firstCenter.x, event.center[2] - firstCenter.z) > 0.5,
      'o vórtice precisa se deslocar pelo mapa',
    );
    assert.ok(
      Math.hypot(player.velocity.x, player.velocity.z) > 0.5,
      'o tornado precisa empurrar o jogador',
    );
    assert.ok(player.velocity.y > 0, 'o tornado precisa erguer o jogador');
    assert.equal(event.phase, 'impact');

    tickEvents(manager, room, 0.7);
    assert.ok(player.hp < 100, 'o núcleo do tornado precisa causar dano');
    assert.ok(
      socket.messages.some(
        (message) =>
          message.type === 'event:pulse' && message.payload?.signature === 'multi_vortex',
      ),
      'o cliente precisa receber pulsos do tornado',
    );
  } finally {
    manager.disposeAll();
  }
});

test('meteor barrage broadcasts impacts and carves the terrain', () => {
  const manager = new RoomManager({ devEnabled: true });
  try {
    const socket = new RecordingSocket();
    const { room, center } = createRoom(manager, socket, 'EPICMETEOR');
    enqueueEvent(manager, room, 'Chuva de meteoros', center);
    tickEvents(manager, room, 0.05); // ativa
    const before = room.deltas.length;
    tickEvents(manager, room, 1.7);

    const pulses = socket.messages.filter((message) => message.type === 'event:pulse');
    assert.ok(
      pulses.some((message) => message.payload?.signature === 'orbital_barrage'),
      'meteoro precisa emitir pulso para o cliente',
    );
    assert.ok(
      pulses.some((message) => message.payload?.kind === 'impact'),
      'meteoro precisa emitir impacto',
    );
    const newDeltas = room.deltas.slice(before);
    assert.ok(newDeltas.length > 0, 'meteoro precisa alterar o terreno');
    assert.ok(
      newDeltas.some((delta) => delta.mat === MAT.AIR || delta.mat === MAT.SCORCHED),
      'meteoro precisa abrir cratera e chamuscar a borda',
    );
  } finally {
    manager.disposeAll();
  }
});

test('volcano birth builds a coherent cone at the epicenter and spawns its core at climax', () => {
  const manager = new RoomManager({ devEnabled: true });
  try {
    const socket = new RecordingSocket();
    const { room, center } = createRoom(manager, socket, 'EPICVOLCANO');
    const event = enqueueEvent(manager, room, 'Erupção vulcânica', center);
    tickEvents(manager, room, 0.05); // ativa

    const vx = Math.floor(event.center[0] / VOXEL_SIZE);
    const vz = Math.floor(event.center[2] / VOXEL_SIZE);
    const near = room.deltas.filter(
      (delta: any) =>
        Math.abs(delta.vx - vx) <= 17 &&
        Math.abs(delta.vz - vz) <= 17 &&
        (delta.mat === MAT.LAVA || delta.mat === MAT.SCORCHED || delta.mat === MAT.BASALT),
    );
    assert.ok(near.length > 0, 'vulcão precisa nascer no centro do evento');

    event.durationRemainingSec = Math.max(1, event.totalDurationSec * 0.28);
    tickEvents(manager, room, 2.2);
    assert.ok(
      room.entities.some((entity: any) => entity.name === 'Coração vulcânico'),
      'clímax do vulcão precisa revelar o núcleo',
    );
    assert.ok(
      socket.messages.some(
        (message) =>
          message.type === 'event:pulse' &&
          message.payload?.signature === 'volcano_birth' &&
          message.payload?.kind === 'eruption',
      ),
      'vulcão precisa emitir pulsos de erupção',
    );
  } finally {
    manager.disposeAll();
  }
});
