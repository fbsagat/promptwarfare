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

test('createAndJoinRoom supports open, password, and closed modes with public list filtering and password masking', () => {
  const manager = new RoomManager();
  try {
    const wsOpen = new MockSocket();
    const resOpen = manager.createAndJoinRoom(wsOpen, {
      roomId: 'ABERTA1',
      roomName: 'Arena Aberta',
      playerName: 'Lucas',
      accessMode: 'open',
      targetPlayers: 6,
      fillWithBots: true,
    });
    assert.ok(resOpen);

    // Creating a password room with empty password must fail cleanly
    const wsInvalidPwd = new MockSocket();
    const resInvalid = manager.createAndJoinRoom(wsInvalidPwd, {
      roomId: 'FAILPWD',
      roomName: 'Sem Senha',
      playerName: 'Erro',
      accessMode: 'password',
      password: '   ',
    });
    assert.equal(resInvalid, null);
    assert.equal(wsInvalidPwd.last('room:error')?.payload.code, 'PASSWORD_REQUIRED_ON_CREATE');

    const wsPwd = new MockSocket();
    const resPwd = manager.createAndJoinRoom(wsPwd, {
      roomId: 'SENHA1',
      roomName: 'Arena Trancada',
      playerName: 'Carla',
      accessMode: 'password',
      password: 'segredo123',
      targetPlayers: 8,
    });
    assert.ok(resPwd);

    const wsClosed = new MockSocket();
    const resClosed = manager.createAndJoinRoom(wsClosed, {
      roomId: 'FECHADA1',
      roomName: 'Arena Privada',
      playerName: 'Pedro',
      accessMode: 'closed',
    });
    assert.ok(resClosed);

    const list = manager.getRoomList();
    assert.equal(list.length, 2);
    const ids = list.map((r) => r.id);
    assert.ok(ids.includes('ABERTA1'));
    assert.ok(ids.includes('SENHA1'));
    assert.ok(!ids.includes('FECHADA1'));

    const senhaSummary = list.find((r) => r.id === 'SENHA1')!;
    assert.equal(senhaSummary.accessMode, 'password');
    assert.equal(senhaSummary.hasPassword, true);
    assert.equal(senhaSummary.hostName, 'Carla');
    assert.equal('password' in (senhaSummary as unknown as Record<string, unknown>), false);
  } finally {
    manager.disposeAll();
  }
});

test('joinExistingRoom enforces closed, password, and capacity rules', () => {
  const manager = new RoomManager();
  try {
    const wsHost = new MockSocket();
    manager.createAndJoinRoom(wsHost, {
      roomId: 'JOIN1',
      roomName: 'Sala Teste',
      playerName: 'Host',
      accessMode: 'password',
      password: 'passe',
      targetPlayers: 4,
    });

    // Missing password
    const wsGuest1 = new MockSocket();
    const missPwd = manager.joinExistingRoom(wsGuest1, {
      roomId: 'JOIN1',
      playerName: 'Convidado',
    });
    assert.equal(missPwd, null);
    assert.equal(wsGuest1.last('room:error')?.payload.code, 'PASSWORD_REQUIRED');

    // Wrong password
    wsGuest1.clear();
    const badPwd = manager.joinExistingRoom(wsGuest1, {
      roomId: 'JOIN1',
      playerName: 'Convidado',
      password: 'errada',
    });
    assert.equal(badPwd, null);
    assert.equal(wsGuest1.last('room:error')?.payload.code, 'INVALID_PASSWORD');

    // Correct password
    wsGuest1.clear();
    const okJoin = manager.joinExistingRoom(wsGuest1, {
      roomId: 'JOIN1',
      playerName: 'Convidado',
      password: 'passe',
    });
    assert.ok(okJoin);
    const lobbyMsg = wsGuest1.last('room:lobby_state');
    assert.ok(lobbyMsg);
    assert.equal(lobbyMsg.payload.members.length, 2);
    assert.equal(lobbyMsg.payload.hostName, 'Host');

    // Fill remaining 2 slots up to capacity 4
    const wsG2 = new MockSocket();
    const wsG3 = new MockSocket();
    assert.ok(manager.joinExistingRoom(wsG2, { roomId: 'JOIN1', playerName: 'P3', password: 'passe' }));
    assert.ok(manager.joinExistingRoom(wsG3, { roomId: 'JOIN1', playerName: 'P4', password: 'passe' }));

    // 5th human must be rejected as ROOM_FULL
    const wsG4 = new MockSocket();
    const fullRes = manager.joinExistingRoom(wsG4, {
      roomId: 'JOIN1',
      playerName: 'P5',
      password: 'passe',
    });
    assert.equal(fullRes, null);
    assert.equal(wsG4.last('room:error')?.payload.code, 'ROOM_FULL');

    // Host closes room -> new join attempt gets ROOM_CLOSED
    const hostId = wsHost.last('room:lobby_state')!.payload.hostId;
    manager.handleClientMessage('JOIN1', hostId, {
      type: 'room:update_settings',
      payload: { accessMode: 'closed' },
    });
    assert.equal(manager.getRoomList().length, 0);

    // Kick one player to make space, then test join against closed room
    const p4Id = wsG3.last('room:lobby_state')!.payload.playerId;
    manager.handleClientMessage('JOIN1', hostId, {
      type: 'room:kick',
      payload: { targetPlayerId: p4Id },
    });
    assert.equal(wsG3.last('room:error')?.payload.code, 'KICKED');

    const wsLate = new MockSocket();
    const closedAttempt = manager.joinExistingRoom(wsLate, {
      roomId: 'JOIN1',
      playerName: 'Atrasado',
      password: 'passe',
    });
    assert.equal(closedAttempt, null);
    assert.equal(wsLate.last('room:error')?.payload.code, 'ROOM_CLOSED');
  } finally {
    manager.disposeAll();
  }
});

test('Master authority, host transfer, automatic host migration on disconnect, and start match work properly', () => {
  const manager = new RoomManager();
  try {
    const wsHost = new MockSocket();
    const created = manager.createAndJoinRoom(wsHost, {
      roomId: 'MASTER1',
      roomName: 'Comando',
      playerName: 'Alpha',
      accessMode: 'open',
      targetPlayers: 5,
      fillWithBots: true,
    });
    assert.ok(created);

    const wsGuest = new MockSocket();
    const joined = manager.joinExistingRoom(wsGuest, {
      roomId: 'MASTER1',
      playerName: 'Bravo',
    });
    assert.ok(joined);

    const wsThird = new MockSocket();
    const joinedThird = manager.joinExistingRoom(wsThird, {
      roomId: 'MASTER1',
      playerName: 'Charlie',
    });
    assert.ok(joinedThird);

    // Non-host attempts are rejected with NOT_HOST
    wsGuest.clear();
    manager.handleClientMessage('MASTER1', joined.playerId, { type: 'room:start' });
    assert.equal(wsGuest.last('room:error')?.payload.code, 'NOT_HOST');

    wsGuest.clear();
    manager.handleClientMessage('MASTER1', joined.playerId, {
      type: 'room:update_settings',
      payload: { accessMode: 'closed' },
    });
    assert.equal(wsGuest.last('room:error')?.payload.code, 'NOT_HOST');

    wsGuest.clear();
    manager.handleClientMessage('MASTER1', joined.playerId, {
      type: 'room:kick',
      payload: { targetPlayerId: joinedThird.playerId },
    });
    assert.equal(wsGuest.last('room:error')?.payload.code, 'NOT_HOST');

    wsGuest.clear();
    manager.handleClientMessage('MASTER1', joined.playerId, {
      type: 'room:transfer_host',
      payload: { targetPlayerId: joinedThird.playerId },
    });
    assert.equal(wsGuest.last('room:error')?.payload.code, 'NOT_HOST');

    // Host transfers Master explicitly to Bravo
    manager.handleClientMessage('MASTER1', created.playerId, {
      type: 'room:transfer_host',
      payload: { targetPlayerId: joined.playerId },
    });
    assert.equal(wsGuest.last('room:lobby_state')?.payload.hostId, joined.playerId);

    // Bravo disconnects -> Master automatically migrates to earliest remaining human (Alpha)
    manager.handleDisconnect('MASTER1', joined.playerId);
    const afterDisconnect = wsHost.last('room:lobby_state');
    assert.equal(afterDisconnect?.payload.hostId, created.playerId);
    assert.equal(afterDisconnect?.payload.members.length, 2);

    // Non-host Charlie cannot restart either
    wsThird.clear();
    manager.handleClientMessage('MASTER1', joinedThird.playerId, { type: 'room:restart' });
    assert.equal(wsThird.last('room:error')?.payload.code, 'NOT_HOST');

    // Alpha starts match -> transitions lobby -> playing, fills bots to 5, emits room:init
    manager.handleClientMessage('MASTER1', created.playerId, { type: 'room:start' });
    const initHost = wsHost.last('room:init');
    const initThird = wsThird.last('room:init');
    assert.ok(initHost);
    assert.ok(initThird);
    assert.equal(initHost.payload.phase, 'playing');
    assert.equal(initHost.payload.hostId, created.playerId);
    assert.equal(initHost.payload.players.length, 5);
    assert.equal(initHost.payload.players.filter((p: any) => p.isBot).length, 3);
  } finally {
    manager.disposeAll();
  }
});
