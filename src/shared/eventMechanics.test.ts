import test from 'node:test';
import assert from 'node:assert/strict';
import {
  epicScaleForEvent,
  intensityForEvent,
  phaseForEvent,
  phaseForProgress,
  pulseIntervalForSignature,
  signatureForEvent,
  SIGNATURE_META,
} from './eventMechanics.ts';
import type { EventParams, EventSignature } from './types.ts';

const base: EventParams = {
  radiusMeters: 26,
  durationSec: 30,
  lethality: 20,
  quantity: 2,
};

test('every signature has a complete epic meta contract', () => {
  for (const [signature, meta] of Object.entries(SIGNATURE_META)) {
    assert.ok(meta.scale === 'regional' || meta.scale === 'colossal' || meta.scale === 'apocaliptico');
    assert.ok(meta.pulseSec > 0 && meta.pulseSec < 10, `${signature} pulseSec inválido`);
    assert.ok(meta.telegraphSec >= 4 && meta.telegraphSec <= 10, `${signature} telegraphSec inválido`);
    assert.equal(meta.colors.length, 2);
    assert.ok(meta.cameraShake >= 0 && meta.cameraShake <= 1);
    assert.ok(meta.counterplay.length >= 2, `${signature} precisa de duas contra-jogadas`);
    assert.ok(meta.reward.trim().length > 0, `${signature} precisa de recompensa`);
  }
});

test('signature resolves every archetype and composes without reskin', () => {
  assert.equal(signatureForEvent('WEATHER_HAZARD', { ...base, weatherKind: 'tornado' }), 'multi_vortex');
  assert.equal(
    signatureForEvent('WEATHER_HAZARD', { ...base, weatherKind: 'meteor_shower' }),
    'orbital_barrage',
  );
  assert.equal(
    signatureForEvent('TERRAIN_MUTATION', { ...base, mutationKind: 'volcano' }),
    'volcano_birth',
  );
  assert.equal(
    signatureForEvent('ENTITY_SPAWN', base, 'evt_entity_spider_swarm'),
    'spider_nest',
  );
  assert.equal(
    signatureForEvent('SUPPLY_DROP', base, 'evt_supply_elite_supply'),
    'legendary_drop',
  );
  assert.equal(
    signatureForEvent('SCENERY_SPAWN', { ...base, sceneryKind: 'skyscraper' }),
    'colossal_tower',
  );
});

test('phase progression is monotonic and covers the whole event', () => {
  const phases = [0, 0.05, 0.2, 0.5, 0.7, 0.8, 0.9, 1].map(phaseForProgress);
  assert.deepEqual(phases, [
    'impact',
    'impact',
    'sustain',
    'sustain',
    'climax',
    'climax',
    'dissipate',
    'dissipate',
  ]);
  assert.equal(phaseForEvent({ durationRemainingSec: 30, totalDurationSec: 30 }), 'impact');
  assert.equal(phaseForEvent({ durationRemainingSec: 0, totalDurationSec: 30 }), 'dissipate');
});

test('intensity and epic scale are bounded for any input', () => {
  for (const params of [
    base,
    { ...base, radiusMeters: 0, durationSec: 0, lethality: 0, quantity: 0 },
    { ...base, radiusMeters: 130, durationSec: 120, lethality: 45, quantity: 20 },
  ]) {
    const intensity = intensityForEvent(params);
    const epic = epicScaleForEvent(params);
    assert.ok(intensity >= 0 && intensity <= 1);
    assert.ok(epic >= 0 && epic <= 1);
  }
});

test('climax pulses faster than sustain; dissipate is calmest', () => {
  const signatures = Object.keys(SIGNATURE_META) as EventSignature[];
  for (const signature of signatures) {
    const sustain = pulseIntervalForSignature(signature, 'sustain');
    const climax = pulseIntervalForSignature(signature, 'climax');
    const dissipate = pulseIntervalForSignature(signature, 'dissipate');
    assert.ok(climax < sustain, `${signature} precisa acelerar no clímax`);
    assert.ok(dissipate > sustain, `${signature} precisa desacelerar no rescaldo`);
  }
});
