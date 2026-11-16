import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

test('runtime server does not import the offline AI tool or Gemini SDK', () => {
  for (const relative of ['server.ts', 'server/roomManager.ts', 'server/catalog.ts']) {
    const source = fs.readFileSync(path.join(root, relative), 'utf8');
    assert.equal(
      source.includes('@google/genai'),
      false,
      `${relative} não deve importar @google/genai`,
    );
    assert.equal(
      source.includes('aiGenerator'),
      false,
      `${relative} não deve importar aiGenerator`,
    );
    assert.equal(
      source.includes('GEMINI_API_KEY'),
      false,
      `${relative} não deve depender de GEMINI_API_KEY`,
    );
  }
});
