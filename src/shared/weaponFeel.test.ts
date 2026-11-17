import assert from 'node:assert/strict';
import test from 'node:test';
import { MAX_RECOIL_PITCH, recoilImpulseFor } from './weaponFeel.ts';

const base = { damage: 20, fireRate: 5, massKg: 6 };

test('recoil fica dentro dos limites para qualquer arma', () => {
  for (const damage of [5, 20, 45, 100]) {
    for (const fireRate of [0.5, 4, 10, 15]) {
      for (const massKg of [1, 6, 30]) {
        const impulse = recoilImpulseFor({ damage, fireRate, massKg }, () => 0.5);
        assert.ok(impulse.pitch > 0, 'pitch precisa subir');
        assert.ok(impulse.pitch <= MAX_RECOIL_PITCH);
        assert.equal(impulse.yaw, 0, 'random 0.5 zera o desvio lateral');
        assert.ok(impulse.viewKick >= 0.55 && impulse.viewKick <= 1.3);
        assert.ok(impulse.trauma > 0 && impulse.trauma <= 0.12);
      }
    }
  }
});

test('dano alto chuta mais que dano baixo', () => {
  const light = recoilImpulseFor({ ...base, damage: 5 }, () => 0.5);
  const heavy = recoilImpulseFor({ ...base, damage: 100 }, () => 0.5);
  assert.ok(heavy.pitch > light.pitch);
  assert.ok(heavy.viewKick > light.viewKick);
});

test('cadência alta reduz o chute por tiro', () => {
  const slow = recoilImpulseFor({ ...base, fireRate: 1 }, () => 0.5);
  const fast = recoilImpulseFor({ ...base, fireRate: 15 }, () => 0.5);
  assert.ok(fast.pitch < slow.pitch);
});

test('desvio lateral é simétrico e limitado', () => {
  const left = recoilImpulseFor(base, () => 0);
  const right = recoilImpulseFor(base, () => 1);
  assert.ok(left.yaw < 0 && right.yaw > 0);
  assert.ok(Math.abs(left.yaw) <= 0.006);
  assert.ok(Math.abs(right.yaw) <= 0.006);
  assert.ok(Math.abs(left.yaw + right.yaw) < 1e-9);
});

test('stats inválidos caem em valores seguros', () => {
  const impulse = recoilImpulseFor(
    { damage: Number.NaN, fireRate: -1, massKg: Number.POSITIVE_INFINITY },
    () => 0.5,
  );
  assert.ok(Number.isFinite(impulse.pitch));
  assert.ok(impulse.pitch > 0 && impulse.pitch <= MAX_RECOIL_PITCH);
  assert.ok(Number.isFinite(impulse.yaw));
});
