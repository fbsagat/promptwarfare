import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { RoomManager, type SocketLike } from './roomManager.ts';

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

  last(type?: string): CapturedMsg | undefined {
    if (!type) return this.messages[this.messages.length - 1];
    for (let i = this.messages.length - 1; i >= 0; i--) {
      if (this.messages[i].type === type) return this.messages[i];
    }
    return undefined;
  }

  clear(): void {
    this.messages.length = 0;
  }
}

function startSoloRoom(manager: RoomManager, roomId: string) {
  const ws = new MockSocket();
  const res = manager.createAndJoinRoom(ws, {
    roomId,
    roomName: 'Teste de Prompt',
    playerName: 'Ana',
    accessMode: 'open',
    targetPlayers: 4,
    fillWithBots: false,
    startImmediately: true,
  });
  assert.ok(res);
  return { ws, room: res.room, player: res.room.players.get(res.playerId)! };
}

test('prompt:open weapon freezes input and cancel keeps the forge ready', () => {
  const manager = new RoomManager({ devEnabled: true });
  try {
    const { ws, room, player } = startSoloRoom(manager, 'PROMPT1');
    player.canForgeWeapon = true;
    player.weaponCooldownSec = 0;

    manager.handleClientMessage(room.id, player.id, {
      type: 'prompt:open',
      payload: { kind: 'weapon' },
    });
    assert.equal(player.prompt?.kind, 'weapon');
    assert.equal(player.isTypingPrompt, true);

    manager.handleClientMessage(room.id, player.id, {
      type: 'player:input',
      payload: {
        moveX: 1,
        moveZ: 1,
        jump: true,
        yaw: 1,
        pitch: 0,
        activeSlot: 0,
        isTypingPrompt: false,
      },
    });
    assert.equal(player.moveX, 0);
    assert.equal(player.moveZ, 0);
    assert.equal(player.jumpQueued, false);

    manager.handleClientMessage(room.id, player.id, {
      type: 'prompt:cancel',
      payload: { kind: 'weapon' },
    });
    assert.equal(player.prompt, null);
    assert.equal(player.isTypingPrompt, false);
    assert.equal(player.canForgeWeapon, true);

    // O cliente não consegue forjar sem abrir a janela no servidor.
    ws.clear();
    manager.handleClientMessage(room.id, player.id, {
      type: 'ai:forge_weapon',
      payload: { prompt: 'Rifle de plasma' },
    });
    assert.equal(ws.last('ai:error')?.payload.message.includes('Enter'), true);
    assert.equal(player.prompt, null);
    assert.equal(player.canForgeWeapon, true);
  } finally {
    manager.disposeAll();
  }
});

test('weapon prompt timeout applies the short cooldown', () => {
  const manager = new RoomManager({ devEnabled: true });
  try {
    const { room, player } = startSoloRoom(manager, 'PROMPT2');
    player.canForgeWeapon = true;
    player.weaponCooldownSec = 0;
    manager.handleClientMessage(room.id, player.id, {
      type: 'prompt:open',
      payload: { kind: 'weapon' },
    });
    assert.equal(player.prompt?.kind, 'weapon');

    player.prompt = { kind: 'weapon', endsAt: Date.now() - 1 };
    (manager as any).tickRoom(room, 0.05);

    assert.equal(player.prompt, null);
    assert.equal(player.isTypingPrompt, false);
    assert.equal(player.canForgeWeapon, false);
    assert.ok(
      player.weaponCooldownSec > 7 && player.weaponCooldownSec <= 8,
      `Expected ~8s timeout cooldown, got ${player.weaponCooldownSec}`,
    );
  } finally {
    manager.disposeAll();
  }
});

test('event raffle skips typing players and event priority blocks the forge', () => {
  const manager = new RoomManager({ devEnabled: true });
  try {
    const { ws, room, player } = startSoloRoom(manager, 'PROMPT3');
    const ws2 = new MockSocket();
    const joined = manager.joinExistingRoom(ws2, {
      roomId: room.id,
      playerName: 'Bia',
    });
    assert.ok(joined);
    const player2 = room.players.get(joined.playerId)!;

    player.canForgeWeapon = true;
    player.weaponCooldownSec = 0;
    manager.handleClientMessage(room.id, player.id, {
      type: 'prompt:open',
      payload: { kind: 'weapon' },
    });

    (manager as any).raffleEventPlayer(room);
    assert.equal(room.rafflePlayerId, player2.id);

    // Ana está escrevendo; a forja dela continua aberta e o evento não a escolhe.
    assert.equal(player.prompt?.kind, 'weapon');

    manager.handleClientMessage(room.id, player2.id, {
      type: 'prompt:open',
      payload: { kind: 'event' },
    });
    assert.equal(player2.prompt?.kind, 'event');
    assert.equal(room.eventPhase, 'writing');
    assert.equal(room.rafflePlayerId, player2.id);

    manager.handleClientMessage(room.id, player2.id, {
      type: 'prompt:cancel',
      payload: { kind: 'event' },
    });
    assert.equal(player2.prompt, null);
    assert.equal(room.rafflePlayerId, null);
    assert.equal(room.eventPhase, 'cooldown');

    ws.clear();
    ws2.clear();
  } finally {
    manager.disposeAll();
  }
});
