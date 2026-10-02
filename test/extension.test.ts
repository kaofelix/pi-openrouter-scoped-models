import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import install from '../extensions/index.ts';
import { writeCatalogCache } from '../extensions/cache.ts';

const paid = { id: 'vendor/paid', name: 'Paid', context_length: 16000,
  pricing: { prompt: '0.000001', completion: '0.000002' } };
const free = { id: 'vendor/free:free', name: 'Free', context_length: 16000,
  pricing: { prompt: '0', completion: '0' } };

type Handler = (event: any, ctx: any) => unknown;

async function waitFor(predicate: () => boolean, timeout = 2000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeout) throw new Error('Timed out waiting for condition');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function harness(directory: string, key = 'test-only-key') {
  const previousKey = process.env.OPENROUTER_API_KEY;
  const previousCache = process.env.PI_OPENROUTER_MODELS_CACHE_DIR;
  process.env.OPENROUTER_API_KEY = key;
  process.env.PI_OPENROUTER_MODELS_CACHE_DIR = directory;
  const commands = new Map<string, (args: string, ctx: any) => Promise<void>>();
  const registered: any[] = [];
  const notices: string[] = [];
  const handlers = new Map<string, Handler[]>();
  const pi = {
    registerProvider: (_name: string, config: unknown) => registered.push(config),
    registerCommand: (name: string, spec: any) => commands.set(name, spec.handler),
    on: (event: string, handler: Handler) => {
      const list = handlers.get(event) ?? [];
      list.push(handler);
      handlers.set(event, list);
      return () => {};
    },
  };
  await install(pi as any);
  const context = {
    hasUI: true,
    modelRegistry: { registerProvider: pi.registerProvider },
    ui: { notify: (message: string) => notices.push(message) },
  };
  const emit = (event: string, payload: any) => {
    for (const handler of handlers.get(event) ?? []) handler(payload, context);
  };
  const restore = () => {
    if (previousKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = previousKey;
    if (previousCache === undefined) delete process.env.PI_OPENROUTER_MODELS_CACHE_DIR;
    else process.env.PI_OPENROUTER_MODELS_CACHE_DIR = previousCache;
  };
  return { commands, registered, notices, context, emit, restore };
}

test('sync command registers authenticated user models and status reports the active catalog', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'or-extension-'));
  const previousFetch = globalThis.fetch;
  const requests: string[] = [];
  globalThis.fetch = async (input) => {
    requests.push(String(input));
    return new Response(JSON.stringify({ data: [paid] }), { status: 200 });
  };
  const h = await harness(directory);
  try {
    await h.commands.get('openrouter-models')!('sync', h.context);
    await h.commands.get('openrouter-models')!('status', h.context);
    assert.deepEqual(requests, ['https://openrouter.ai/api/v1/models/user']);
    assert.deepEqual(h.registered.at(-1).models.map((model: any) => model.id),
      ['vendor/paid', 'openrouter/free']);
    assert.match(h.notices.at(-1)!, /2 models.*full.*api/i);
  } finally {
    globalThis.fetch = previousFetch;
    h.restore();
  }
});

test('a stale cache triggers a background startup refresh that replaces the catalog', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'or-startup-'));
  await writeCatalogCache(directory, 'test-only-key', {
    version: 1, mode: 'full', timestamp: Date.now() - 60 * 60 * 1000, models: [free],
  });
  const previousFetch = globalThis.fetch;
  const requests: string[] = [];
  globalThis.fetch = async (input) => {
    requests.push(String(input));
    return new Response(JSON.stringify({ data: [paid] }), { status: 200 });
  };
  const h = await harness(directory);
  try {
    h.emit('session_start', { type: 'session_start', reason: 'startup' });
    await waitFor(() => h.registered.length > 1);
    assert.deepEqual(h.registered.at(-1).models.map((model: any) => model.id),
      ['vendor/paid', 'openrouter/free']);
    assert.deepEqual(requests, ['https://openrouter.ai/api/v1/models/user']);
  } finally {
    globalThis.fetch = previousFetch;
    h.restore();
  }
});

test('a fresh cache skips the startup refresh', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'or-fresh-'));
  await writeCatalogCache(directory, 'test-only-key', {
    version: 1, mode: 'full', timestamp: Date.now(), models: [paid],
  });
  const previousFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response('{}', { status: 200 }); };
  const h = await harness(directory);
  try {
    h.emit('session_start', { type: 'session_start', reason: 'startup' });
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(calls, 0);
    assert.deepEqual(h.registered.at(-1).models.map((model: any) => model.id),
      ['vendor/paid', 'openrouter/free']);
  } finally {
    globalThis.fetch = previousFetch;
    h.restore();
  }
});

test('the startup refresh reuses the cached free-only mode', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'or-free-'));
  await writeCatalogCache(directory, 'test-only-key', {
    version: 1, mode: 'free-only', timestamp: Date.now() - 60 * 60 * 1000, models: [paid, free],
  });
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ data: [paid, free] }), { status: 200 });
  const h = await harness(directory);
  try {
    h.emit('session_start', { type: 'session_start', reason: 'startup' });
    await waitFor(() => h.registered.length > 1);
    assert.deepEqual(h.registered.at(-1).models.map((model: any) => model.id),
      ['vendor/free:free', 'openrouter/free']);
  } finally {
    globalThis.fetch = previousFetch;
    h.restore();
  }
});

test('a failed startup refresh keeps the cached catalog', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'or-fallback-'));
  await writeCatalogCache(directory, 'test-only-key', {
    version: 1, mode: 'full', timestamp: Date.now() - 60 * 60 * 1000, models: [paid],
  });
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('offline'); };
  const h = await harness(directory);
  try {
    h.emit('session_start', { type: 'session_start', reason: 'startup' });
    await waitFor(() => h.registered.length > 1);
    assert.deepEqual(h.registered.at(-1).models.map((model: any) => model.id),
      ['vendor/paid', 'openrouter/free']);
  } finally {
    globalThis.fetch = previousFetch;
    h.restore();
  }
});

test('only the startup session event refreshes the catalog', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'or-reason-'));
  const previousFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response('{}', { status: 200 }); };
  const h = await harness(directory);
  try {
    h.emit('session_start', { type: 'session_start', reason: 'resume' });
    h.emit('session_start', { type: 'session_start', reason: 'reload' });
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = previousFetch;
    h.restore();
  }
});
