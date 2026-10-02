import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import install from '../extensions/index.ts';

test('sync command registers authenticated user models and status reports the active catalog', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'or-extension-'));
  const previousKey = process.env.OPENROUTER_API_KEY;
  const previousCache = process.env.PI_OPENROUTER_MODELS_CACHE_DIR;
  const previousFetch = globalThis.fetch;
  process.env.OPENROUTER_API_KEY = 'test-only-key';
  process.env.PI_OPENROUTER_MODELS_CACHE_DIR = directory;
  const requests: string[] = [];
  globalThis.fetch = async (input) => {
    requests.push(String(input));
    return new Response(JSON.stringify({ data: [
      { id: 'vendor/model', name: 'Model', context_length: 16000,
        pricing: { prompt: '0.000001', completion: '0.000002' } },
    ] }), { status: 200 });
  };
  try {
    const commands = new Map<string, (args: string, ctx: any) => Promise<void>>();
    const registered: any[] = [];
    const notices: string[] = [];
    const pi = {
      registerProvider: (_name: string, config: unknown) => registered.push(config),
      registerCommand: (name: string, spec: any) => commands.set(name, spec.handler),
    };
    await install(pi as any);
    const context = {
      hasUI: true,
      modelRegistry: { registerProvider: pi.registerProvider },
      ui: { notify: (message: string) => notices.push(message) },
    };
    await commands.get('openrouter-models')!('sync', context);
    await commands.get('openrouter-models')!('status', context);
    assert.deepEqual(requests, ['https://openrouter.ai/api/v1/models/user']);
    assert.deepEqual(registered.at(-1).models.map((model: any) => model.id),
      ['vendor/model', 'openrouter/free']);
    assert.match(notices.at(-1)!, /2 models.*full.*api/i);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = previousKey;
    if (previousCache === undefined) delete process.env.PI_OPENROUTER_MODELS_CACHE_DIR;
    else process.env.PI_OPENROUTER_MODELS_CACHE_DIR = previousCache;
  }
});
