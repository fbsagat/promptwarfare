import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { resolveEventFromCatalog, resolveWeaponFromCatalog } from './catalog.ts';
import { hydrateRoomInit, hydrateRoomTick } from '../src/shared/contentHydration.ts';
import { RoomManager, type SocketLike } from './roomManager.ts';
import type {
  ContentItemsPayload,
  RoomInitWirePayload,
  RoomTickWirePayload,
  WeaponBlueprint,
} from '../src/shared/types.ts';

interface CapturedMsg {
  type: string;
  payload: any;
}

class MockSocket implements SocketLike {
  readyState = WebSocket.OPEN;
  messages: CapturedMsg[] = [];

  send(data: string): void {
    this.messages.push(JSON.parse(data) as CapturedMsg);
  }

  all(type: string): CapturedMsg[] {
    return this.messages.filter((msg) => msg.type === type);
  }

  clear(): void {
    this.messages.length = 0;
  }
}

test('wire slots reference weapon content and the blueprint travels once', () => {
  const manager = new RoomManager({ devEnabled: false });
  const socket = new MockSocket();
  try {
    const created = manager.createAndJoinRoom(socket, {
      roomId: 'STREAM1',
      playerName: 'Ana',
      targetPlayers: 4,
      fillWithBots: true,
      startImmediately: true,
    });
    assert.ok(created);
    const room: any = created.room;
    const host = room.players.get(created.playerId);
    assert.ok(host);

    const weapon: WeaponBlueprint = resolveWeaponFromCatalog('Pistola de gelo').blueprint;
    host.slots[2] = {
      id: weapon.id,
      kind: 'weapon',
      name: weapon.name,
      massKg: weapon.stats.massKg,
      ammo: weapon.stats.ammoMax,
      ammoMax: weapon.stats.ammoMax,
      weapon,
    };

    const event = resolveEventFromCatalog(
      'Enxame de aranhas',
      'p1',
      'Ana',
      [50, 20, 50],
    ).event;
    assert.ok(event.entityBlueprint);
    room.activeEvents.push(event);

    // Init: referências + conteúdo estático uma única vez por instância.
    const init = (manager as any).buildInitPayload(room, created.playerId) as RoomInitWirePayload;
    const initHost = init.players.find((p) => p.id === created.playerId);
    assert.ok(initHost);
    const initSlot = initHost.slots[2];
    assert.equal(initSlot?.weaponId, weapon.id);
    assert.equal('weapon' in (initSlot as object), false);
    assert.ok(init.contentItems.some((entry) => entry.id === weapon.id));
    assert.ok(init.activeEvents.every((evt) => !('entityBlueprint' in evt)));
    assert.ok(init.activeEvents.every((evt) => !('components' in evt)));

    // Hidratação: o cliente reconstrói o slot completo a partir do cache.
    const cache = new Map<string, WeaponBlueprint>();
    const hydrated = hydrateRoomInit(init, cache);
    const hydratedHost = hydrated.players.find((p) => p.id === created.playerId);
    assert.equal(hydratedHost?.slots[2]?.weapon?.id, weapon.id);
    assert.equal(hydratedHost?.slots[2]?.ammo, weapon.stats.ammoMax);

    // Tick: conteúdo novo vai antes do estado que o referencia.
    socket.clear();
    (manager as any).tickRoom(room, 0.05);
    const contentMessages = socket.all('content:items');
    assert.equal(contentMessages.length, 1);
    const content = contentMessages[0].payload as ContentItemsPayload;
    assert.ok(content.weapons.some((entry) => entry.id === weapon.id));

    const tickMessage = socket.all('room:tick').at(-1);
    assert.ok(tickMessage);
    const tick = tickMessage.payload as RoomTickWirePayload;
    const tickHost = tick.players.find((p) => p.id === created.playerId);
    assert.equal(tickHost?.slots[2]?.weaponId, weapon.id);
    assert.equal('weapon' in (tickHost?.slots[2] as object), false);
    assert.ok(tick.activeEvents.every((evt) => !('entityBlueprint' in evt)));
    assert.equal(JSON.stringify(tick).includes('rleVoxels'), false);

    // O cliente que perdeu o conteúdo ainda hidrata o slot parcial sem quebrar.
    const cold = hydrateRoomTick(tick, new Map());
    const coldHost = cold.players.find((p) => p.id === created.playerId);
    assert.equal(coldHost?.slots[2]?.weapon, undefined);
    assert.equal(coldHost?.slots[2]?.name, weapon.name);

    // Segundo tick não reenvia o mesmo blueprint.
    socket.clear();
    (manager as any).tickRoom(room, 0.05);
    assert.equal(socket.all('content:items').length, 0);
    const secondTick = socket.all('room:tick').at(-1)?.payload as RoomTickWirePayload;
    assert.equal(JSON.stringify(secondTick).includes('rleVoxels'), false);
  } finally {
    manager.disposeAll();
  }
});
