import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SETTINGS,
  loadSettings,
  normalizeSettings,
  saveSettings,
  SETTINGS_STORAGE_KEY,
} from './settings.ts';

test('normalizeSettings clamps volumes and sensitivity', () => {
  const settings = normalizeSettings({
    volumes: { master: 4, sfx: -1, ambience: 0.5, ui: Number.NaN },
    sensitivity: 9,
    invertY: 1,
    showStats: 'yes',
    reducedMotion: 1,
  });
  assert.equal(settings.volumes.master, 1);
  assert.equal(settings.volumes.sfx, 0);
  assert.equal(settings.volumes.ambience, 0.5);
  assert.equal(settings.volumes.ui, DEFAULT_SETTINGS.volumes.ui);
  assert.equal(settings.sensitivity, 2);
  assert.equal(settings.invertY, true);
  assert.equal(settings.showStats, true);
  assert.equal(settings.reducedMotion, true);
});

test('normalizeSettings falls back for invalid data', () => {
  const settings = normalizeSettings('nope');
  assert.deepEqual(settings, DEFAULT_SETTINGS);
  assert.equal(normalizeSettings({ sensitivity: 0.1 }).sensitivity, 0.4);
});

test('loadSettings handles missing, corrupt and valid storage', () => {
  const store = new Map<string, string>();
  const storage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
  };
  assert.deepEqual(loadSettings(null), DEFAULT_SETTINGS);
  assert.deepEqual(loadSettings(storage), DEFAULT_SETTINGS);

  store.set(SETTINGS_STORAGE_KEY, '{corrupt');
  assert.deepEqual(loadSettings(storage), DEFAULT_SETTINGS);

  const custom = normalizeSettings({
    volumes: { master: 0.4, sfx: 0.5, ambience: 0.3, ui: 0.6 },
    sensitivity: 1.4,
    invertY: true,
    showStats: true,
  });
  saveSettings(custom, storage);
  assert.deepEqual(loadSettings(storage), custom);
});
