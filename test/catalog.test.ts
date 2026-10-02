import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mapCatalog } from '../extensions/catalog.ts';

test('maps only valid models from the user catalog with per-million-token pricing', () => {
  const { models, skipped } = mapCatalog([
    {
      id: 'vendor/chat', name: 'Chat', context_length: 128000,
      architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] },
      pricing: { prompt: '0.000001', completion: '0.000002' },
      top_provider: { max_completion_tokens: 8192 },
      supported_parameters: ['reasoning'],
    },
    { id: 'vendor/invalid', context_length: 1000, pricing: { prompt: 'not-a-number', completion: '1' } },
  ], 'full');

  assert.equal(skipped, 1);
  assert.deepEqual(models.find((model) => model.id === 'vendor/chat'), {
    id: 'vendor/chat', name: 'Chat', input: ['text', 'image'], reasoning: true,
    contextWindow: 128000, maxTokens: 8192,
    cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 },
  });
  assert.ok(models.some((model) => model.id === 'openrouter/free'));
  assert.ok(!models.some((model) => model.id === 'openrouter/auto'));
  assert.ok(!models.some((model) => model.id === 'vendor/invalid'));
});

test('free-only excludes paid catalog entries and malformed priced free entries', () => {
  const { models, skipped } = mapCatalog([
    { id: 'vendor/paid', context_length: 1000, pricing: { prompt: '0.01', completion: '0.01' } },
    { id: 'vendor/free:free', context_length: 1000, pricing: { prompt: '0', completion: '0' } },
    { id: 'vendor/mispriced:free', context_length: 1000, pricing: { prompt: '0.01', completion: '0' } },
  ], 'free-only');
  assert.deepEqual(models.map((model) => model.id), ['vendor/free:free', 'openrouter/free']);
  assert.equal(skipped, 1);
});
