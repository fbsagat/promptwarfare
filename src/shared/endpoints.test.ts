import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHttpUrl, buildWsUrl, normalizeBaseUrl } from './endpoints.ts';

test('normalizeBaseUrl trims whitespace and trailing slashes', () => {
  assert.equal(normalizeBaseUrl('  https://api.example.com///  '), 'https://api.example.com');
  assert.equal(normalizeBaseUrl(''), '');
  assert.equal(normalizeBaseUrl(undefined), '');
});

test('buildHttpUrl keeps same-origin when no API base is configured', () => {
  assert.equal(buildHttpUrl('/api/rooms', ''), '/api/rooms');
  assert.equal(buildHttpUrl('api/rooms', undefined), '/api/rooms');
});

test('buildHttpUrl joins an absolute API base and normalizes the path', () => {
  assert.equal(
    buildHttpUrl('/api/rooms', 'https://api.example.com/'),
    'https://api.example.com/api/rooms',
  );
  assert.equal(
    buildHttpUrl('api/rooms', 'https://api.example.com'),
    'https://api.example.com/api/rooms',
  );
});

test('buildWsUrl falls back to the page origin when no endpoint is configured', () => {
  assert.equal(
    buildWsUrl({ pageProtocol: 'https:', pageHost: 'game.example.com' }),
    'wss://game.example.com/ws',
  );
  assert.equal(
    buildWsUrl({ pageProtocol: 'http:', pageHost: 'localhost:3000' }),
    'ws://localhost:3000/ws',
  );
});

test('buildWsUrl derives the WebSocket URL from the API base', () => {
  assert.equal(
    buildWsUrl({
      apiBase: 'https://api.example.com/',
      pageProtocol: 'https:',
      pageHost: 'game.example.com',
    }),
    'wss://api.example.com/ws',
  );
  assert.equal(
    buildWsUrl({
      apiBase: 'http://127.0.0.1:3000',
      pageProtocol: 'http:',
      pageHost: 'localhost:5173',
    }),
    'ws://127.0.0.1:3000/ws',
  );
});

test('buildWsUrl honors an explicit WebSocket URL', () => {
  assert.equal(
    buildWsUrl({
      apiBase: 'https://ignored.example.com',
      wsUrl: 'wss://ws.example.com/game/',
      pageProtocol: 'https:',
      pageHost: 'game.example.com',
    }),
    'wss://ws.example.com/game',
  );
});
