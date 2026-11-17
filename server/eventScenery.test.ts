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

function hasPulse(socket: RecordingSocket, signature: string, kind?: string): boolean {
  return socket.messages.some(
    (message) =>
      message.type === 'event:pulse' &&
      message.payload?.signature === signature &&
      (!kind || message.payload?.kind === kind),
  );
}

const CASES = [
  {
    prompt: 'Árvore',
    signature: 'titan_tree',
    pulse: 'debris',
    core: 'Fruto da Árvore-Mãe',
    material: MAT.WOOD,
  },
  {
    prompt: 'Bosque',
    signature: 'maze_grove',
    pulse: 'debris',
    core: 'Coração do Bosque',
    material: MAT.LEAVES,
  },
  {
    prompt: 'Casa',
    signature: 'rising_house',
    pulse: 'impact',
    core: 'Baú da Mansão',
    material: MAT.WOOD,
  },
  {
    prompt: 'Torre',
    signature: 'watchtower',
    pulse: 'impact',
    core: 'Relíquia da Torre',
    material: MAT.STONE,
  },
  {
    prompt: 'Arranha-céu',
    signature: 'colossal_tower',
    pulse: 'hail',
    core: 'Cápsula do Arranha-Céu',
    material: MAT.STONE,
  },
  {
    prompt: 'Ruínas',
    signature: 'lost_temple',
    pulse: 'eruption',
    core: 'Relíquia do Templo',
    material: MAT.GOLD,
  },
];

for (const scenario of CASES) {
  test(`${scenario.signature} rises, emits ${scenario.pulse} and reveals its core`, () => {
    const manager = new RoomManager({ devEnabled: true });
    try {
      const socket = new RecordingSocket();
      const { room, playerId, center } = createRoom(manager, socket, `SCN${scenario.signature}`);
      const player = room.players.get(playerId);
      assert.ok(player);
      const event = enqueue(manager, room, scenario.prompt, center);
      tickEvents(manager, room, 0.05);
      player.position = { x: center[0], y: center[1], z: center[2] };
      const before = room.deltas.length;
      for (let i = 0; i < 60; i++) (manager as any).advanceSceneryPlans(room);
      event.durationRemainingSec = Math.max(1, event.totalDurationSec * 0.4);
      tickEvents(manager, room, 3.5);

      assert.ok(
        room.deltas.slice(before).some((delta: any) => delta.mat === scenario.material),
        `${scenario.signature} precisa alterar o terreno com ${scenario.material}`,
      );
      assert.ok(
        hasPulse(socket, scenario.signature, scenario.pulse),
        `${scenario.signature} precisa emitir ${scenario.pulse}`,
      );
      assert.ok(
        room.entities.some((entity: any) => entity.name === scenario.core),
        `${scenario.signature} precisa revelar ${scenario.core}`,
      );
    } finally {
      manager.disposeAll();
    }
  });
}

test('scenery crush pushes players out of the rising footprint', () => {
  const manager = new RoomManager({ devEnabled: true });
  try {
    const socket = new RecordingSocket();
    const { room, playerId, center } = createRoom(manager, socket, 'SCNCRUSH');
    const player = room.players.get(playerId);
    assert.ok(player);
    const event = enqueue(manager, room, 'Arranha-céu', center);
    tickEvents(manager, room, 0.05);
    player.position = { x: center[0] + 3, y: center[1], z: center[2] };
    player.velocity = { x: 0, y: 0, z: 0 };
    event.durationRemainingSec = Math.max(1, event.totalDurationSec * 0.3);
    tickEvents(manager, room, 0.5);
    assert.ok(player.velocity.x > 0, 'estrutura precisa empurrar o jogador para fora');
  } finally {
    manager.disposeAll();
  }
});
