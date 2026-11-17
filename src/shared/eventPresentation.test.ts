import test from 'node:test';
import assert from 'node:assert/strict';
import { presentationForEvent } from './eventPresentation.ts';
import type { EventParams } from './types.ts';

const base: EventParams = { radiusMeters: 20, durationSec: 30, lethality: 20, quantity: 3 };

test('event presentation gives distinct colors and cues per phenomenon', () => {
  const tornado = presentationForEvent('WEATHER_HAZARD', {
    ...base,
    weatherKind: 'tornado',
  });
  const blizzard = presentationForEvent('WEATHER_HAZARD', {
    ...base,
    weatherKind: 'blizzard',
  });
  const volcano = presentationForEvent('TERRAIN_MUTATION', {
    ...base,
    mutationKind: 'volcano',
  });
  const supply = presentationForEvent('SUPPLY_DROP', base);

  assert.notEqual(tornado.primaryColor, blizzard.primaryColor);
  assert.equal(tornado.sound, 'wind');
  assert.equal(blizzard.sound, 'wind');
  assert.equal(volcano.sound, 'rumble');
  assert.equal(supply.sound, 'chime');
  assert.notEqual(volcano.primaryColor, supply.primaryColor);
});

test('event presentation scales ring and beam with threat without exploding', () => {
  const weak = presentationForEvent('WEATHER_HAZARD', {
    ...base,
    weatherKind: 'meteor_shower',
    radiusMeters: 6,
    lethality: 5,
  });
  const strong = presentationForEvent('WEATHER_HAZARD', {
    ...base,
    weatherKind: 'meteor_shower',
    radiusMeters: 45,
    lethality: 45,
  });

  assert.ok(strong.ringRadius > weak.ringRadius);
  assert.ok(strong.beamHeight > weak.beamHeight);
  assert.ok(strong.ringRadius <= 6);
  assert.ok(strong.beamHeight <= 18);
  assert.ok(strong.particleCount > weak.particleCount);
});
