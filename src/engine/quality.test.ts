import test from 'node:test';
import assert from 'node:assert/strict';
import {
  detectGpuTier,
  isQualityLevel,
  loadQualityLevel,
  QUALITY_STORAGE_KEY,
  resolveQuality,
  saveQualityLevel,
} from './quality.ts';

test('resolveQuality usa low em renderer de software', () => {
  assert.equal(resolveQuality('high', { isSoftwareGl: true }).level, 'low');
  assert.equal(resolveQuality('auto', { isSoftwareGl: true }).level, 'low');
});

test('resolveQuality: auto usa medium e níveis explícitos são respeitados', () => {
  assert.equal(resolveQuality('auto').level, 'medium');
  assert.equal(resolveQuality('low').hardwareScaling, 1.25);
  assert.equal(resolveQuality('medium').shadows, true);
  assert.equal(resolveQuality('high').shadowMapSize, 2048);
  assert.equal(resolveQuality('high').shadows, true);
  assert.equal(resolveQuality('low').shadows, false);
});

test('resolveQuality: auto escolhe low em iGPU e medium em GPU dedicada', () => {
  assert.equal(resolveQuality('auto', { gpuTier: 'integrated' }).level, 'low');
  assert.equal(resolveQuality('auto', { gpuTier: 'discrete' }).level, 'medium');
  assert.equal(resolveQuality('auto', { gpuTier: 'unknown' }).level, 'medium');
});

test('detectGpuTier classifica renderer de software, iGPU e dedicada', () => {
  assert.equal(
    detectGpuTier(
      'ANGLE (NVIDIA, NVIDIA GeForce RTX 4060 (0x00002882) Direct3D11 vs_5_0 ps_5_0, D3D11)',
    ),
    'discrete',
  );
  assert.equal(
    detectGpuTier('ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0)'),
    'integrated',
  );
  assert.equal(
    detectGpuTier('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)))'),
    'software',
  );
  assert.equal(detectGpuTier(''), 'unknown');
});

test('todo perfil mantém orçamento de partículas e sem flags caras', () => {
  for (const level of ['low', 'medium', 'high'] as const) {
    const profile = resolveQuality(level);
    assert.ok(profile.weatherCap > 0 && profile.weatherCap <= 180);
    assert.ok(profile.decalCap > 0 && profile.decalCap <= 64);
    assert.ok(profile.vfxScale > 0);
  }
});

test('todo perfil mantém raio de descarga maior que o de carga e LOD por perfil', () => {
  for (const level of ['low', 'medium', 'high'] as const) {
    const profile = resolveQuality(level);
    assert.ok(profile.chunkLoadRadius > 0);
    assert.ok(profile.chunkUnloadRadius > profile.chunkLoadRadius);
    assert.ok(profile.chunkNearLodRadius > 0);
    assert.ok(profile.chunkNearLodRadius <= profile.chunkLoadRadius);
    assert.ok(profile.chunkUnloadCooldownSec > 0);
    assert.ok(profile.chunkJobsPerFrame > 0 && profile.chunkJobsPerFrame <= 64);
  }
});

test('isQualityLevel aceita apenas valores conhecidos', () => {
  assert.equal(isQualityLevel('auto'), true);
  assert.equal(isQualityLevel('high'), true);
  assert.equal(isQualityLevel('ultra'), false);
  assert.equal(isQualityLevel(null), false);
});

test('loadQualityLevel lida com storage ausente, inválido e válido', () => {
  const store = new Map<string, string>();
  const storage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
  };

  assert.equal(loadQualityLevel(null), 'auto');
  assert.equal(loadQualityLevel(storage), 'auto');

  saveQualityLevel('high', storage);
  assert.equal(store.get(QUALITY_STORAGE_KEY), 'high');
  assert.equal(loadQualityLevel(storage), 'high');

  store.set(QUALITY_STORAGE_KEY, 'ultra');
  assert.equal(loadQualityLevel(storage), 'auto');
});
