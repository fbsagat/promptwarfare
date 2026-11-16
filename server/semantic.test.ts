import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cosineSimilarity,
  embedText,
  embedTexts,
  semanticTokens,
  textSetSimilarity,
  textSimilarity,
} from './semantic.ts';

test('semanticTokens apply domain synonyms and drop stopwords', () => {
  assert.deepEqual(semanticTokens('Pistola de gelo congelante'), [
    'pistola',
    'gelo',
    'gelo',
  ]);
  assert.deepEqual(semanticTokens('Bazuca do Vazio gravitacional'), [
    'lancador',
    'vazio',
    'vazio',
  ]);
});

test('embeddings are deterministic and cosine similarity is sane', () => {
  const a = embedText('Pistola de gelo');
  const b = embedText('Pistola congelante');
  const c = embedText('Matilha de lobos');
  assert.deepEqual(a, embedText('Pistola de gelo'));
  assert.equal(cosineSimilarity(a, a), 1);
  assert.ok(textSimilarity('Pistola de gelo', 'Pistola congelante') > 0.9);
  assert.ok(textSimilarity('Pistola de gelo', 'Matilha de lobos') < 0.2);
  assert.ok(textSimilarity('Pistola de gelo', 'Pistola de fogo') < 0.5);
  assert.ok(cosineSimilarity(a, c) < 0.2);
});

test('textSetSimilarity compares sets of aliases', () => {
  const similarity = textSetSimilarity(
    ['Bazuca do Vazio'],
    ['Lancador gravitacional'],
  );
  assert.ok(similarity > 0.8, `expected synonym similarity, got ${similarity}`);
  assert.ok(
    textSetSimilarity(['Chuva de meteoros'], ['Chuva de meteoros flamejantes']) >
      0.7,
  );
  assert.ok(
    textSetSimilarity(['Pistola de gelo'], ['Rifle de gelo']) < 0.5,
  );
});
