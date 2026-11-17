import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { resolveEventFromCatalog } from './catalog.ts';
import { VOXEL_SIZE } from '../src/shared/types.ts';
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
  { prompt: 'Caixa de suprimentos', signature: 'supply_barrage', crate: 'Cápsula de Suprimentos' },
  { prompt: 'Depósito de munição', signature: 'armored_depot', crate: 'Depósito Blindado' },
  { prompt: 'Suprimentos de elite', signature: 'legendary_drop', crate: 'Cápsula Lendária' },
  { prompt: 'Cache do tesouro', signature: 'treasure_vault', crate: 'Cofre do Tesouro' },
  { prompt: 'Caixa de emergência', signature: 'emergency_beacon', crate: 'Posto de Emergência' },
];

for (const scenario of CASES) {
  test(`${scenario.signature} spawns its dedicated supply crate`, () => {
    const manager = new RoomManager({ devEnabled: true });
    try {
      const socket = new RecordingSocket();
      const { room, center } = createRoom(manager, socket, `SUP${scenario.signature}`);
      enqueue(manager, room, scenario.prompt, center);
      tickEvents(manager, room, 0.05);
      assert.ok(
        room.entities.some((entity: any) => entity.name === scenario.crate),
        `${scenario.signature} precisa spawnar ${scenario.crate}`,
      );
    } finally {
      manager.disposeAll();
    }
  });
}

test('supply barrage keeps dropping capsules and reveals the mega crate at climax', () => {
  const manager = new RoomManager({ devEnabled: true });
  try {
    const socket = new RecordingSocket();
    const { room, center } = createRoom(manager, socket, 'SUPBARRAGE');
    const event = enqueue(manager, room, 'Caixa de suprimentos', center);
    tickEvents(manager, room, 0.05);
    const initial = room.entities.filter(
      (entity: any) => entity.eventId === event.id && entity.kind === 'supply_crate',
    ).length;
    event.durationRemainingSec = Math.max(1, event.totalDurationSec * 0.3);
    tickEvents(manager, room, 3.5);
    const crates = room.entities.filter(
      (entity: any) => entity.eventId === event.id && entity.kind === 'supply_crate',
    );
    assert.ok(crates.length > initial, 'barragem precisa continuar derrubando cápsulas');
    assert.ok(
      crates.some((entity: any) => entity.name === 'Carga Máxima'),
      'clímax precisa revelar a Carga Máxima',
    );
    assert.ok(hasPulse(socket, 'supply_barrage', 'wave'), 'clímax precisa emitir onda');
  } finally {
    manager.disposeAll();
  }
});

test('armored depot lands with a shockwave', () => {
  const manager = new RoomManager({ devEnabled: true });
  try {
    const socket = new RecordingSocket();
    const { room, center } = createRoom(manager, socket, 'SUPARMOR');
    const event = enqueue(manager, room, 'Depósito de munição', center);
    tickEvents(manager, room, 0.05);
    event.durationRemainingSec = Math.max(1, event.totalDurationSec * 0.3);
    tickEvents(manager, room, 3.5);
    assert.ok(hasPulse(socket, 'armored_depot', 'shockwave'), 'depósito precisa emitir impacto');
  } finally {
    manager.disposeAll();
  }
});

test('legendary drop emits a golden wave', () => {
  const manager = new RoomManager({ devEnabled: true });
  try {
    const socket = new RecordingSocket();
    const { room, center } = createRoom(manager, socket, 'SUPLEGEND');
    const event = enqueue(manager, room, 'Suprimentos de elite', center);
    tickEvents(manager, room, 0.05);
    event.durationRemainingSec = Math.max(1, event.totalDurationSec * 0.3);
    tickEvents(manager, room, 3.5);
    assert.ok(hasPulse(socket, 'legendary_drop', 'wave'), 'cápsula lendária precisa emitir onda');
  } finally {
    manager.disposeAll();
  }
});

test('treasure cache protects itself with a trap pulse', () => {
  const manager = new RoomManager({ devEnabled: true });
  try {
    const socket = new RecordingSocket();
    const { room, playerId, center } = createRoom(manager, socket, 'SUPTREASURE');
    const player = room.players.get(playerId);
    assert.ok(player);
    const event = enqueue(manager, room, 'Cache do tesouro', center);
    tickEvents(manager, room, 0.05);
    const crate = room.entities.find(
      (entity: any) => entity.eventId === event.id && entity.kind === 'supply_crate',
    );
    assert.ok(crate);
    player.position = { x: crate.position.x, y: crate.position.y, z: crate.position.z };
    event.durationRemainingSec = Math.max(1, event.totalDurationSec * 0.3);
    tickEvents(manager, room, 3.5);
    assert.ok(hasPulse(socket, 'treasure_vault', 'impact'), 'cofre precisa emitir armadilha');
  } finally {
    manager.disposeAll();
  }
});

test('emergency beacon heals players inside its field', () => {
  const manager = new RoomManager({ devEnabled: true });
  try {
    const socket = new RecordingSocket();
    const { room, playerId, center } = createRoom(manager, socket, 'SUPHEAL');
    const player = room.players.get(playerId);
    assert.ok(player);
    const event = enqueue(manager, room, 'Caixa de emergência', center);
    tickEvents(manager, room, 0.05);
    player.hp = 45;
    player.position = { x: center[0], y: center[1], z: center[2] };
    event.durationRemainingSec = Math.max(1, event.totalDurationSec * 0.3);
    tickEvents(manager, room, 3.5);
    assert.ok(player.hp > 45, 'posto de emergência precisa curar');
    assert.ok(hasPulse(socket, 'emergency_beacon', 'wave'), 'posto precisa emitir onda de cura');
  } finally {
    manager.disposeAll();
  }
});
