import test from 'node:test';
import assert from 'node:assert/strict';
import { expandAliases } from './aliasExpansion.ts';

test('expandAliases adds normalized variants and canonical phrasing', () => {
  const aliases = expandAliases('Pistola de Gelo', 'gelo|pistola', [
    'pistola gelada',
    'arma congelante',
  ]);

  assert.ok(aliases.includes('Pistola de Gelo'));
  assert.ok(aliases.includes('pistola gelada'));
  assert.ok(aliases.includes('arma congelante'));
  assert.ok(aliases.includes('gelo pistola'));
  assert.ok(aliases.includes('pistola de gelo'));
  assert.equal(new Set(aliases).size, aliases.length);
});

test('expandAliases respects the cap and drops blanks', () => {
  const aliases = expandAliases(
    'Arma',
    'a|b|c',
    ['', '  ', 'um', 'dois', 'tres', 'quatro', 'cinco', 'seis', 'sete', 'oito'],
    6,
  );
  assert.equal(aliases.length, 6);
  assert.equal(aliases.includes(''), false);
});
