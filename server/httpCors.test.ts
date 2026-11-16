import test from 'node:test';
import assert from 'node:assert/strict';
import { isOriginAllowed, parseAllowedOrigins } from './httpCors.ts';

test('parseAllowedOrigins trims entries, removes trailing slashes, and drops blanks', () => {
  assert.deepEqual(
    parseAllowedOrigins(' https://a.example.com/, https://*.vercel.app ,, '),
    ['https://a.example.com', 'https://*.vercel.app'],
  );
  assert.deepEqual(parseAllowedOrigins(''), []);
  assert.deepEqual(parseAllowedOrigins(undefined), []);
});

test('isOriginAllowed matches exact origins case-insensitively', () => {
  const allowed = parseAllowedOrigins('https://prompt-warfare.vercel.app');
  assert.equal(isOriginAllowed('https://prompt-warfare.vercel.app', allowed), true);
  assert.equal(isOriginAllowed('https://PROMPT-WARFARE.VERCEL.APP', allowed), true);
  assert.equal(isOriginAllowed('https://evil.example.com', allowed), false);
});

test('isOriginAllowed supports Vercel preview wildcards', () => {
  const allowed = parseAllowedOrigins('https://prompt-warfare-*.vercel.app, https://*.example.com');
  assert.equal(isOriginAllowed('https://prompt-warfare-git-main-user.vercel.app', allowed), true);
  assert.equal(isOriginAllowed('https://preview.example.com', allowed), true);
  assert.equal(isOriginAllowed('https://preview.example.com.evil.test', allowed), false);
});

test('isOriginAllowed supports the global wildcard and denies when the list is empty', () => {
  assert.equal(isOriginAllowed('https://anything.test', ['*']), true);
  assert.equal(isOriginAllowed('https://anything.test', []), false);
  assert.equal(isOriginAllowed('', ['*']), false);
});
