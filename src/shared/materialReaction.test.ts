import assert from 'node:assert/strict';
import test from 'node:test';
import { MATERIAL_COLORS, MAT } from './types.ts';
import {
  IMPACT_REACTION_KINDS,
  impactReactionFor,
  reactionKindFor,
} from './materialReaction.ts';

test('todo MAT sólido tem receita com valores sãos', () => {
  for (const mat of Object.values(MAT)) {
    if (mat === MAT.AIR) continue;
    const reaction = impactReactionFor(mat);
    assert.ok((IMPACT_REACTION_KINDS as readonly string[]).includes(reaction.kind));
    assert.ok(reaction.particles > 0, `MAT ${mat} sem partículas`);
    assert.ok(reaction.scale > 0 && reaction.scale <= 1);
    assert.ok(reaction.speed > 0 && reaction.speed <= 6);
    for (const channel of [...reaction.color, ...reaction.decalTint]) {
      assert.ok(channel >= 0 && channel <= 1, `canal fora de 0..1 em MAT ${mat}`);
    }
    assert.ok(reaction.decalScale > 0);
    assert.ok(reaction.decalAlpha > 0 && reaction.decalAlpha <= 1);
  }
});

test('materiais com cor própria não caem no fallback genérico', () => {
  for (const mat of Object.keys(MATERIAL_COLORS).map(Number)) {
    assert.notEqual(reactionKindFor(mat), 'generic', `MAT ${mat} sem receita`);
    assert.equal(reactionKindFor(mat), impactReactionFor(mat).kind);
  }
});

test('pedra, cristal e lava deixam marca; areia, neve e madeira não', () => {
  assert.equal(impactReactionFor(MAT.STONE).decal, true);
  assert.equal(impactReactionFor(MAT.CRYSTAL).decal, true);
  assert.equal(impactReactionFor(MAT.LAVA).decal, true);
  assert.equal(impactReactionFor(MAT.SAND).decal, false);
  assert.equal(impactReactionFor(MAT.SNOW).decal, false);
  assert.equal(impactReactionFor(MAT.WOOD).decal, false);
});

test('metal, gelo, cristal e lava soltam faísca; grama e terra não', () => {
  for (const mat of [MAT.GOLD, MAT.ICE, MAT.CRYSTAL, MAT.LAVA]) {
    assert.equal(impactReactionFor(mat).sparks, true, `MAT ${mat} sem faísca`);
  }
  for (const mat of [MAT.GRASS, MAT.DIRT, MAT.WOOD]) {
    assert.equal(impactReactionFor(mat).sparks, false, `MAT ${mat} faiscando`);
  }
});

test('MAT desconhecido cai no genérico sem quebrar', () => {
  assert.equal(reactionKindFor(9999), 'generic');
  const reaction = impactReactionFor(9999);
  assert.equal(reaction.kind, 'generic');
  assert.equal(reaction.decal, false);
});
