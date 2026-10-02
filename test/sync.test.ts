import assert from 'node:assert/strict';
import { test } from 'node:test';
import { syncModels } from '../extensions/sync.ts';

const paid = { id: 'vendor/paid', context_length: 4096, pricing: { prompt: '0.000001', completion: '0.000001' } };
const free = { id: 'vendor/free:free', context_length: 4096, pricing: { prompt: '0', completion: '0' } };

test('a failed free-only refresh never registers paid models from a full cache', async () => {
  let registered: string[] = [];
  const cachedAt = Date.now() - 60_000;
  const result = await syncModels({
    mode: 'free-only',
    fetchModels: async () => { throw new Error('offline'); },
    readCache: async () => ({ version: 1, mode: 'full', timestamp: cachedAt, models: [paid, free] }),
    writeCache: async () => { throw new Error('must not write'); },
    register: (models) => { registered = models.map((model) => model.id); },
  });
  assert.deepEqual(registered, ['vendor/free:free', 'openrouter/free']);
  assert.equal(result.mode, 'free-only');
  assert.equal(result.source, 'cache');
  assert.equal(result.timestamp, cachedAt);
});

test('free-only failure without cache replaces a previously paid catalog with only the free router', async () => {
  let registered = [paid.id];
  const result = await syncModels({
    mode: 'free-only',
    fetchModels: async () => { throw new Error('offline'); },
    readCache: async () => null,
    writeCache: async () => {},
    register: (models) => { registered = models.map((model) => model.id); },
  });
  assert.deepEqual(registered, ['openrouter/free']);
  assert.equal(result.source, 'none');
});
