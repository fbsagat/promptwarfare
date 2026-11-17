import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { resolveEventFromCatalog } from './catalog.ts';
import { MAT, VOXEL_SIZE, WATER_LEVEL_WORLD } from '../src/shared/types.ts';
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

function enqueue(manager: RoomManager, room: any, prompt: string, center: [number, number, number]) {
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

function hasPulse(socket: RecordingSocket, signature: string, kind?: string): boolean {
  return socket.messages.some(
    (message) =>
      message.type === 'event:pulse' &&
      message.payload?.signature === signature &&
      (!kind || message.payload?.kind === kind),
  );
}

test('fissure tears the terrain and collapses a perpendicular branch at climax', () => {
  const manager = new RoomManager({ devEnabled: true });
  try {
    const socket = new RecordingSocket();
    const { room, playerId, center } = createRoom(manager, socket, 'TERFISSURE');
    const player = room.players.get(playerId);
    assert.ok(player);
    const event = enqueue(manager, room, 'Fissura no terreno', center);
    tickEvents(manager, room, 0.05);
    player.position = { x: center[0], y: center[1], z: center[2] };
    event.durationRemainingSec = Math.max(1, event.totalDurationSec * 0.3);
    const before = room.deltas.length;
    tickEvents(manager, room, 3.0);
    assert.ok(room.deltas.length > before, 'fissura precisa alterar o terreno');
    assert.ok(player.hp < 100, 'fissura precisa ferir quem está na borda');
    assert.ok(hasPulse(socket, 'canyon_tear', 'shockwave'), 'fissura precisa emitir onda de choque');
  } finally {
    manager.disposeAll();
  }
});

test('crystal bloom grows spires, bursts shards and reveals its core', () => {
  const manager = new RoomManager({ devEnabled: true });
  try {
    const socket = new RecordingSocket();
    const { room, playerId, center } = createRoom(manager, socket, 'TERCRYSTAL');
    const player = room.players.get(playerId);
    assert.ok(player);
    const event = enqueue(manager, room, 'Pilares de cristal', center);
    tickEvents(manager, room, 0.05);
    player.position = { x: center[0], y: center[1], z: center[2] };
    event.durationRemainingSec = Math.max(1, event.totalDurationSec * 0.3);
    const before = room.deltas.length;
    tickEvents(manager, room, 3.0);
    assert.ok(
      room.deltas.slice(before).some((delta: any) => delta.mat === MAT.CRYSTAL),
      'cristais precisam crescer',
    );
    assert.ok(player.hp < 100, 'estilhaços precisam ferir o jogador');
    assert.ok(
      room.entities.some((entity: any) => entity.name === 'Cristal primordial'),
      'clímax precisa revelar o núcleo de cristal',
    );
  } finally {
    manager.disposeAll();
  }
});

test('tsunami floods low ground and broadcasts waves', () => {
  const manager = new RoomManager({ devEnabled: true });
  try {
    const socket = new RecordingSocket();
    const { room, playerId, center } = createRoom(manager, socket, 'TERWAVE');
    const player = room.players.get(playerId);
    assert.ok(player);
    enqueue(manager, room, 'Maré crescente', center);
    tickEvents(manager, room, 0.05);
    player.position = { x: center[0], y: WATER_LEVEL_WORLD + 1, z: center[2] };
    tickEvents(manager, room, 2.2);
    assert.ok(player.hp < 100, 'maré precisa ferir quem está na área alagada');
    assert.ok(hasPulse(socket, 'tsunami_surge', 'wave'), 'maré precisa emitir ondas');
  } finally {
    manager.disposeAll();
  }
});

test('sinkhole pulls players in and collapses at climax', () => {
  const manager = new RoomManager({ devEnabled: true });
  try {
    const socket = new RecordingSocket();
    const { room, playerId, center } = createRoom(manager, socket, 'TERSINK');
    const player = room.players.get(playerId);
    assert.ok(player);
    const event = enqueue(manager, room, 'Sorvedouro', center);
    tickEvents(manager, room, 0.05);
    player.position = { x: center[0] + 12, y: center[1], z: center[2] };
    player.velocity = { x: 0, y: 0, z: 0 };
    tickEvents(manager, room, 0.5);
    assert.ok(player.velocity.x < 0, 'sorvedouro precisa puxar para o centro');
    player.position = { x: center[0] + 4, y: center[1], z: center[2] };
    event.durationRemainingSec = Math.max(1, event.totalDurationSec * 0.3);
    tickEvents(manager, room, 3.0);
    assert.ok(player.hp < 100, 'colapso precisa ferir quem está perto');
    assert.ok(
      room.entities.some((entity: any) => entity.name === 'Relíquia do abismo'),
      'clímax precisa revelar a relíquia do abismo',
    );
  } finally {
    manager.disposeAll();
  }
});

test('lava river burns players standing on lava and extends at pulses', () => {
  const manager = new RoomManager({ devEnabled: true });
  try {
    const socket = new RecordingSocket();
    const { room, playerId, center } = createRoom(manager, socket, 'TERLAVA');
    const player = room.players.get(playerId);
    assert.ok(player);
    enqueue(manager, room, 'Rio de lava', center);
    tickEvents(manager, room, 0.05);
    const lava = room.deltas.find((delta: any) => delta.mat === MAT.LAVA);
    assert.ok(lava, 'rio de lava precisa nascer com lava');
    player.position = {
      x: (lava.vx + 0.5) * VOXEL_SIZE,
      y: (lava.vy + 0.5) * VOXEL_SIZE,
      z: (lava.vz + 0.5) * VOXEL_SIZE,
    };
    player.hp = 100;
    tickEvents(manager, room, 0.5);
    assert.ok(player.hp < 100, 'lava precisa queimar o jogador');
    const before = room.deltas.length;
    tickEvents(manager, room, 1.8);
    assert.ok(room.deltas.length > before, 'rio de lava precisa se extender');
    assert.ok(hasPulse(socket, 'lava_river', 'eruption'), 'lava precisa emitir erupções');
  } finally {
    manager.disposeAll();
  }
});

test('glacier advances, freezes players and leaves ice at climax', () => {
  const manager = new RoomManager({ devEnabled: true });
  try {
    const socket = new RecordingSocket();
    const { room, playerId, center } = createRoom(manager, socket, 'TERGLACIER');
    const player = room.players.get(playerId);
    assert.ok(player);
    const event = enqueue(manager, room, 'Geleira', center);
    tickEvents(manager, room, 0.05);
    tickEvents(manager, room, 0.05);
    const firstX = event.center[0];
    tickEvents(manager, room, 0.5);
    assert.ok(event.center[0] > firstX, 'geleira precisa avançar');
    player.position = { x: event.center[0], y: event.center[1], z: event.center[2] };
    tickEvents(manager, room, 0.2);
    assert.ok((player.freezeUntil ?? 0) > Date.now(), 'geleira precisa congelar quem está na frente');
    const before = room.deltas.length;
    event.durationRemainingSec = Math.max(1, event.totalDurationSec * 0.3);
    tickEvents(manager, room, 3.0);
    assert.ok(
      room.deltas.slice(before).some(
        (delta: any) => delta.mat === MAT.ICE || delta.mat === MAT.SNOW,
      ),
      'geleira precisa deixar gelo/neve',
    );
    assert.ok(
      room.entities.some((entity: any) => entity.name === 'Núcleo glacial'),
      'clímax precisa revelar o núcleo glacial',
    );
  } finally {
    manager.disposeAll();
  }
});

test('overgrowth entangles players and raises the titan tree at climax', () => {
  const manager = new RoomManager({ devEnabled: true });
  try {
    const socket = new RecordingSocket();
    const { room, playerId, center } = createRoom(manager, socket, 'TERGROWTH');
    const player = room.players.get(playerId);
    assert.ok(player);
    const event = enqueue(manager, room, 'Floresta voraz', center);
    tickEvents(manager, room, 0.05);
    player.position = { x: center[0], y: center[1], z: center[2] };
    const before = room.deltas.length;
    event.durationRemainingSec = Math.max(1, event.totalDurationSec * 0.3);
    tickEvents(manager, room, 3.0);
    assert.ok((player.freezeUntil ?? 0) > Date.now(), 'vinhas precisam prender o jogador');
    assert.ok(player.hp < 100, 'vinhas precisam ferir o jogador');
    const newDeltas = room.deltas.slice(before);
    assert.ok(
      newDeltas.some(
        (delta: any) =>
          delta.mat === MAT.WOOD || delta.mat === MAT.LEAVES || delta.mat === MAT.MOSS,
      ),
      'floresta precisa crescer',
    );
    assert.ok(
      room.entities.some((entity: any) => entity.name === 'Semente da Árvore-Mundo'),
      'clímax precisa revelar a semente da árvore-mundo',
    );
  } finally {
    manager.disposeAll();
  }
});
