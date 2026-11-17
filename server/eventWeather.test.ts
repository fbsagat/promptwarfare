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

function exposePlayer(room: any, player: any): void {
  const vx = Math.floor(player.position.x / VOXEL_SIZE);
  const vz = Math.floor(player.position.z / VOXEL_SIZE);
  const startVy = Math.ceil(player.position.y / VOXEL_SIZE) + 2;
  for (let vy = startVy; vy < room.dimY - 1; vy++) room.grid.set(vx, vy, vz, MAT.AIR);
}

test('whiteout pushes exposed players, freezes them and leaves snow', () => {
  const manager = new RoomManager({ devEnabled: true });
  try {
    const socket = new RecordingSocket();
    const { room, playerId, center } = createRoom(manager, socket, 'WXWHITEOUT');
    const player = room.players.get(playerId);
    assert.ok(player);
    exposePlayer(room, player);
    enqueue(manager, room, 'Nevasca congelante', center);
    tickEvents(manager, room, 0.05);
    tickEvents(manager, room, 0.5);
    assert.ok(Math.hypot(player.velocity.x, player.velocity.z) > 0.1, 'nevasca precisa empurrar');
    const before = room.deltas.length;
    tickEvents(manager, room, 2.0);
    assert.ok(player.hp < 100, 'nevasca precisa causar dano no exposto');
    assert.ok((player.freezeUntil ?? 0) > Date.now(), 'nevasca precisa congelar');
    assert.ok(
      room.deltas.slice(before).some((delta: any) => delta.mat === MAT.SNOW),
      'nevasca precisa acumular neve',
    );
  } finally {
    manager.disposeAll();
  }
});

test('acid rain corrodes the ground into sludge and burns exposed players', () => {
  const manager = new RoomManager({ devEnabled: true });
  try {
    const socket = new RecordingSocket();
    const { room, playerId, center } = createRoom(manager, socket, 'WXACID');
    const player = room.players.get(playerId);
    assert.ok(player);
    exposePlayer(room, player);
    enqueue(manager, room, 'Chuva ácida', center);
    tickEvents(manager, room, 0.05);
    const before = room.deltas.length;
    tickEvents(manager, room, 2.0);
    assert.ok(player.hp < 100, 'chuva ácida precisa ferir o exposto');
    assert.ok(
      room.deltas.slice(before).some((delta: any) => delta.mat === MAT.SLUDGE),
      'chuva ácida precisa criar lama tóxica',
    );
  } finally {
    manager.disposeAll();
  }
});

test('earthquake collapses terrain and releases a climax shockwave', () => {
  const manager = new RoomManager({ devEnabled: true });
  try {
    const socket = new RecordingSocket();
    const { room, playerId, center } = createRoom(manager, socket, 'WXQUAKE');
    const player = room.players.get(playerId);
    assert.ok(player);
    const event = enqueue(manager, room, 'Terremoto', center);
    tickEvents(manager, room, 0.05);
    event.durationRemainingSec = Math.max(1, event.totalDurationSec * 0.28);
    const before = room.deltas.length;
    tickEvents(manager, room, 2.0);
    assert.ok(room.deltas.length > before, 'terremoto precisa alterar o terreno');
    assert.ok(player.hp < 100, 'onda sísmica precisa atingir o jogador');
    assert.ok(
      socket.messages.some(
        (message) =>
          message.type === 'event:pulse' &&
          message.payload?.signature === 'quake_collapse' &&
          message.payload?.kind === 'shockwave',
      ),
      'terremoto precisa emitir onda de choque',
    );
  } finally {
    manager.disposeAll();
  }
});

test('low gravity pulls players toward the anomaly and lifts them at climax', () => {
  const manager = new RoomManager({ devEnabled: true });
  try {
    const socket = new RecordingSocket();
    const { room, playerId, center } = createRoom(manager, socket, 'WXGRAVITY');
    const player = room.players.get(playerId);
    assert.ok(player);
    const event = enqueue(manager, room, 'Gravidade baixa', center);
    tickEvents(manager, room, 0.05);
    player.position = { x: center[0] + 18, y: center[1], z: center[2] };
    player.velocity = { x: 0, y: 0, z: 0 };
    tickEvents(manager, room, 0.5);
    assert.ok(player.velocity.x < 0, 'poço gravitacional precisa puxar para o centro');
    event.durationRemainingSec = Math.max(1, event.totalDurationSec * 0.28);
    player.velocity = { x: 0, y: 0, z: 0 };
    tickEvents(manager, room, 2.0);
    assert.ok(player.velocity.y > 0, 'clímax precisa erguer o jogador');
  } finally {
    manager.disposeAll();
  }
});

test('sand wall drifts across the map, pushes players and raises dunes', () => {
  const manager = new RoomManager({ devEnabled: true });
  try {
    const socket = new RecordingSocket();
    const { room, playerId, center } = createRoom(manager, socket, 'WXSAND');
    const player = room.players.get(playerId);
    assert.ok(player);
    exposePlayer(room, player);
    const event = enqueue(manager, room, 'Tempestade de areia', center);
    tickEvents(manager, room, 0.05);
    const first = { x: event.center[0], z: event.center[2] };
    tickEvents(manager, room, 0.5);
    assert.ok(
      Math.hypot(event.center[0] - first.x, event.center[2] - first.z) > 0.5,
      'parede de areia precisa se deslocar',
    );
    assert.ok(player.velocity.x > 0.1, 'vento precisa empurrar o exposto');
    const before = room.deltas.length;
    tickEvents(manager, room, 2.0);
    assert.ok(player.hp < 100, 'areia precisa causar dano no exposto');
    assert.ok(
      room.deltas.slice(before).some((delta: any) => delta.mat === MAT.SAND),
      'areia precisa formar dunas',
    );
  } finally {
    manager.disposeAll();
  }
});

test('supercell strikes players and broadcasts lightning pulses', () => {
  const manager = new RoomManager({ devEnabled: true });
  try {
    const socket = new RecordingSocket();
    const { room, playerId, center } = createRoom(manager, socket, 'WXSTORM');
    const player = room.players.get(playerId);
    assert.ok(player);
    exposePlayer(room, player);
    enqueue(manager, room, 'Tempestade de raios', center);
    tickEvents(manager, room, 0.05);
    for (let i = 0; i < 5 && player.hp >= 100; i++) tickEvents(manager, room, 2.0);
    assert.ok(player.hp < 100, 'raio precisa atingir o jogador exposto');
    assert.ok(
      socket.messages.some(
        (message) =>
          message.type === 'event:pulse' &&
          message.payload?.signature === 'supercell' &&
          message.payload?.kind === 'lightning',
      ),
      'tempestade precisa emitir pulsos de raio',
    );
  } finally {
    manager.disposeAll();
  }
});

test('hail barrage damages exposed players and leaves ice patches', () => {
  const manager = new RoomManager({ devEnabled: true });
  try {
    const socket = new RecordingSocket();
    const { room, playerId, center } = createRoom(manager, socket, 'WXHAIL');
    const player = room.players.get(playerId);
    assert.ok(player);
    exposePlayer(room, player);
    enqueue(manager, room, 'Tempestade de granizo', center);
    tickEvents(manager, room, 0.05);
    const before = room.deltas.length;
    tickEvents(manager, room, 2.0);
    assert.ok(player.hp < 100, 'granizo precisa ferir o exposto');
    assert.ok(
      room.deltas.slice(before).some(
        (delta: any) => delta.mat === MAT.ICE || delta.mat === MAT.SNOW,
      ),
      'granizo precisa deixar gelo no chão',
    );
    assert.ok(
      socket.messages.some(
        (message) =>
          message.type === 'event:pulse' &&
          message.payload?.signature === 'hail_barrage' &&
          message.payload?.kind === 'hail',
      ),
      'granizo precisa emitir pulsos',
    );
  } finally {
    manager.disposeAll();
  }
});
