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
  { prompt: 'Matilha agressiva', signature: 'alpha_pack', boss: 'Lobo Alpha', pulse: 'roar' },
  { prompt: 'Golem territorial', signature: 'stone_colossus', boss: 'Colosso de Pedra', pulse: 'shockwave' },
  { prompt: 'Criaturas fugitivas', signature: 'panic_herd', boss: 'Criatura Dourada', pulse: 'debris' },
  { prompt: 'Enxame kamikaze', signature: 'detonating_swarm', boss: 'Rainha Detonante', pulse: 'impact' },
  { prompt: 'Enxame de aranhas', signature: 'spider_nest', boss: 'Rainha Aranha', pulse: 'impact' },
  { prompt: 'Drones caçadores', signature: 'hunter_squad', boss: 'Comandante Drone', pulse: 'lightning' },
  { prompt: 'Colosso de Gelo', signature: 'ice_titan', boss: 'Titã Glacial', pulse: 'hail' },
  { prompt: 'Serpentes venenosas', signature: 'serpent_nest', boss: 'Serpente Rainha', pulse: 'eruption' },
];

for (const scenario of CASES) {
  test(`${scenario.signature} spawns its boss and emits its signature pulse`, () => {
    const manager = new RoomManager({ devEnabled: true });
    try {
      const socket = new RecordingSocket();
      const { room, playerId, center } = createRoom(manager, socket, `ENT${scenario.signature}`);
      const player = room.players.get(playerId);
      assert.ok(player);
      const event = enqueue(manager, room, scenario.prompt, center);
      tickEvents(manager, room, 0.05);
      const boss = room.entities.find((entity: any) => entity.id.startsWith('boss_'));
      assert.ok(boss, `${scenario.signature} precisa de um boss`);
      assert.equal(boss.name, scenario.boss);

      player.position = { x: boss.position.x, y: boss.position.y, z: boss.position.z };
      player.velocity = { x: 0, y: 0, z: 0 };
      event.durationRemainingSec = Math.max(1, event.totalDurationSec * 0.3);
      tickEvents(manager, room, 3.5);

      assert.ok(
        hasPulse(socket, scenario.signature, scenario.pulse),
        `${scenario.signature} precisa emitir pulso ${scenario.pulse}`,
      );
    } finally {
      manager.disposeAll();
    }
  });
}

test('spider nest webs and slows players near the swarm', () => {
  const manager = new RoomManager({ devEnabled: true });
  try {
    const socket = new RecordingSocket();
    const { room, playerId, center } = createRoom(manager, socket, 'ENTWEB');
    const player = room.players.get(playerId);
    assert.ok(player);
    const event = enqueue(manager, room, 'Enxame de aranhas', center);
    tickEvents(manager, room, 0.05);
    const entity = room.entities.find((candidate: any) => candidate.eventId === event.id);
    assert.ok(entity);
    player.position = { x: entity.position.x, y: entity.position.y, z: entity.position.z };
    tickEvents(manager, room, 0.2);
    assert.ok((player.freezeUntil ?? 0) > Date.now(), 'teias precisam prender o jogador');
  } finally {
    manager.disposeAll();
  }
});

test('ice titan aura freezes nearby players', () => {
  const manager = new RoomManager({ devEnabled: true });
  try {
    const socket = new RecordingSocket();
    const { room, playerId, center } = createRoom(manager, socket, 'ENTICE');
    const player = room.players.get(playerId);
    assert.ok(player);
    const event = enqueue(manager, room, 'Colosso de Gelo', center);
    tickEvents(manager, room, 0.05);
    const boss = room.entities.find((entity: any) => entity.id.startsWith('boss_'));
    assert.ok(boss);
    player.position = { x: boss.position.x, y: boss.position.y, z: boss.position.z };
    tickEvents(manager, room, 0.2);
    assert.ok((player.freezeUntil ?? 0) > Date.now(), 'aura do titã precisa congelar');
  } finally {
    manager.disposeAll();
  }
});

test('serpent nest leaves toxic sludge and poisons the target', () => {
  const manager = new RoomManager({ devEnabled: true });
  try {
    const socket = new RecordingSocket();
    const { room, playerId, center } = createRoom(manager, socket, 'ENTVENOM');
    const player = room.players.get(playerId);
    assert.ok(player);
    const event = enqueue(manager, room, 'Serpentes venenosas', center);
    tickEvents(manager, room, 0.05);
    const boss = room.entities.find((entity: any) => entity.id.startsWith('boss_'));
    assert.ok(boss);
    player.position = { x: boss.position.x, y: boss.position.y, z: boss.position.z };
    const before = room.deltas.length;
    event.durationRemainingSec = Math.max(1, event.totalDurationSec * 0.3);
    tickEvents(manager, room, 3.5);
    assert.ok(
      room.deltas.slice(before).some((delta: any) => delta.mat === MAT.SLUDGE),
      'veneno precisa deixar lama tóxica',
    );
  } finally {
    manager.disposeAll();
  }
});

test('dead boss leaves its core in the last known position', () => {
  const manager = new RoomManager({ devEnabled: true });
  try {
    const socket = new RecordingSocket();
    const { room, center } = createRoom(manager, socket, 'ENTCORE');
    const event = enqueue(manager, room, 'Matilha agressiva', center);
    tickEvents(manager, room, 0.05);
    tickEvents(manager, room, 0.05);
    const boss = room.entities.find((entity: any) => entity.id.startsWith('boss_'));
    assert.ok(boss);
    const bossPosition = { ...boss.position };
    room.entities = room.entities.filter((entity: any) => entity.id !== boss.id);
    event.durationRemainingSec = Math.max(1, event.totalDurationSec * 0.3);
    tickEvents(manager, room, 3.5);
    assert.ok(
      room.entities.some(
        (entity: any) =>
          entity.name === 'Presa do Alpha' &&
          Math.hypot(entity.position.x - bossPosition.x, entity.position.z - bossPosition.z) < 12,
      ),
      'boss morto precisa deixar o núcleo perto do corpo',
    );
  } finally {
    manager.disposeAll();
  }
});
