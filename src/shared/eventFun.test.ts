import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveEventFunContract,
  validateEventFunContract,
} from './eventFun.ts';
import type { EventFunContract, EventParams } from './types.ts';

const base: EventParams = { radiusMeters: 20, durationSec: 30, lethality: 20, quantity: 3 };

test('event fun contract derives readable counterplay per archetype', () => {
  const tornado = deriveEventFunContract('WEATHER_HAZARD', {
    ...base,
    weatherKind: 'tornado',
  });
  assert.ok(tornado.counterplay.includes('sprint'));
  assert.ok(tornado.counterplay.includes('high_ground'));
  assert.equal(tornado.fairness.unavoidableDamage, false);

  const blizzard = deriveEventFunContract('WEATHER_HAZARD', {
    ...base,
    weatherKind: 'blizzard',
  });
  assert.ok(blizzard.counterplay.includes('shelter'));

  const supply = deriveEventFunContract('SUPPLY_DROP', base);
  assert.ok(supply.riskReward.includes('loot'));
  assert.deepEqual(validateEventFunContract(supply), []);
});

test('event fun contract validation rejects unfair or unreadable events', () => {
  const valid = deriveEventFunContract('WEATHER_HAZARD', {
    ...base,
    weatherKind: 'meteor_shower',
  });
  assert.deepEqual(validateEventFunContract(valid), []);

  const unavoidable: EventFunContract = {
    ...valid,
    fairness: { ...valid.fairness, unavoidableDamage: true },
  };
  assert.ok(validateEventFunContract(unavoidable).some((issue) => issue.includes('inevitável')));

  const noCounterplay: EventFunContract = { ...valid, counterplay: [] };
  assert.ok(validateEventFunContract(noCounterplay).length > 0);

  const slowWarning: EventFunContract = {
    ...valid,
    telegraphSec: 3,
    escapeWindowSec: 4,
  };
  assert.ok(validateEventFunContract(slowWarning).length > 0);
});
