import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HANDSHAKE_TIMEOUT_MS,
  PROTOCOL_NAME,
  PROTOCOL_VERSION,
  buildClientHello,
  checkHealthPayload,
  checkProtocolVersion,
  describeProtocolFailure,
  evaluateHello,
  evaluateHelloAck,
  isBootFailureCode,
  isProtocolVersion,
} from './protocol.ts';

test('checkProtocolVersion aceita a mesma versão nos dois lados', () => {
  const result = checkProtocolVersion(PROTOCOL_VERSION);
  assert.equal(result.ok, true);
  assert.equal(result.code, null);
});

test('checkProtocolVersion distingue cliente e servidor desatualizados', () => {
  assert.equal(checkProtocolVersion(4, 5).code, 'CLIENT_OUTDATED');
  assert.equal(checkProtocolVersion(6, 5).code, 'SERVER_OUTDATED');
});

test('checkProtocolVersion recusa versões inválidas sem lançar', () => {
  for (const invalid of [undefined, null, '1', 0, -1, 1.5, Number.NaN]) {
    const result = checkProtocolVersion(invalid);
    assert.equal(result.ok, false);
    assert.equal(result.code, 'PROTOCOL_MISMATCH');
  }
});

test('isProtocolVersion exige inteiro positivo', () => {
  assert.equal(isProtocolVersion(1), true);
  assert.equal(isProtocolVersion(0), false);
  assert.equal(isProtocolVersion('2'), false);
});

test('buildClientHello carrega o contrato compartilhado', () => {
  assert.deepEqual(buildClientHello(), {
    protocol: PROTOCOL_NAME,
    protocolVersion: PROTOCOL_VERSION,
    client: 'web',
  });
});

test('evaluateHello recusa nome de protocolo diferente', () => {
  const wrongName = evaluateHello({ protocol: 'outro-jogo', protocolVersion: PROTOCOL_VERSION });
  assert.equal(wrongName.ok, false);
  assert.equal(wrongName.code, 'PROTOCOL_MISMATCH');

  assert.equal(
    evaluateHello({ protocol: PROTOCOL_NAME, protocolVersion: PROTOCOL_VERSION }).ok,
    true,
  );
});

test('evaluateHelloAck usa a mesma regra do hello', () => {
  assert.equal(
    evaluateHelloAck({ protocol: PROTOCOL_NAME, protocolVersion: PROTOCOL_VERSION }).ok,
    true,
  );
  assert.equal(evaluateHelloAck({ protocol: PROTOCOL_NAME }).code, 'PROTOCOL_MISMATCH');
});

test('checkHealthPayload valida /api/health antes de liberar o cliente', () => {
  assert.equal(
    checkHealthPayload({ ok: true, protocol: PROTOCOL_NAME, protocolVersion: PROTOCOL_VERSION }).ok,
    true,
  );
  assert.equal(checkHealthPayload({ ok: true }).code, 'PROTOCOL_MISMATCH');
  assert.equal(
    checkHealthPayload(
      { protocol: PROTOCOL_NAME, protocolVersion: 4 },
      5,
    ).code,
    'CLIENT_OUTDATED',
  );
});

test('códigos de boot são reconhecidos e têm mensagem em pt-BR', () => {
  assert.equal(isBootFailureCode('CLIENT_OUTDATED'), true);
  assert.equal(isBootFailureCode('HANDSHAKE_REQUIRED'), true);
  assert.equal(isBootFailureCode('ROOM_NOT_FOUND'), false);

  assert.match(describeProtocolFailure('CLIENT_OUTDATED'), /Recarregue/);
  assert.match(describeProtocolFailure('PROTOCOL_UNREACHABLE'), /conexão/);
});

test('o timeout de handshake é curto o suficiente para não travar o cliente', () => {
  assert.ok(HANDSHAKE_TIMEOUT_MS > 0 && HANDSHAKE_TIMEOUT_MS <= 30_000);
});
