import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveOpenRouterKey } from '../extensions/credentials.ts';

async function authFile(contents: object): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'or-credentials-'));
  const path = join(directory, 'auth.json');
  await writeFile(path, JSON.stringify(contents));
  return path;
}

test('a stored api_key credential wins over the environment variable', async () => {
  const path = await authFile({ openrouter: { type: 'api_key', key: 'stored-key' } });
  assert.equal(resolveOpenRouterKey(path, { OPENROUTER_API_KEY: 'env-key' }), 'stored-key');
});

test('an OpenRouter OAuth credential exposes its permanent key through access', async () => {
  const path = await authFile({
    openrouter: { type: 'oauth', access: 'oauth-key', refresh: '', expires: Number.MAX_SAFE_INTEGER },
  });
  assert.equal(resolveOpenRouterKey(path, { OPENROUTER_API_KEY: 'env-key' }), 'oauth-key');
});

test('the environment variable is used when no credential is stored', async () => {
  const path = await authFile({});
  assert.equal(resolveOpenRouterKey(path, { OPENROUTER_API_KEY: 'env-key' }), 'env-key');
});

test('the environment variable is used when the auth file is missing', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'or-credentials-'));
  assert.equal(resolveOpenRouterKey(join(directory, 'missing.json'), { OPENROUTER_API_KEY: 'env-key' }), 'env-key');
});

test('returns undefined with neither a stored credential nor an environment variable', async () => {
  const path = await authFile({});
  assert.equal(resolveOpenRouterKey(path, {}), undefined);
});

test('blank stored and environment values do not resolve a key', async () => {
  const path = await authFile({ openrouter: { type: 'api_key', key: '  ' } });
  assert.equal(resolveOpenRouterKey(path, { OPENROUTER_API_KEY: '  ' }), undefined);
});

test('PI_OPENROUTER_MODELS_AUTH_PATH redirects the default auth file', async () => {
  const path = await authFile({ openrouter: { type: 'api_key', key: 'stored-key' } });
  const previous = process.env.PI_OPENROUTER_MODELS_AUTH_PATH;
  process.env.PI_OPENROUTER_MODELS_AUTH_PATH = path;
  try {
    assert.equal(resolveOpenRouterKey(undefined, {}), 'stored-key');
  } finally {
    if (previous === undefined) delete process.env.PI_OPENROUTER_MODELS_AUTH_PATH;
    else process.env.PI_OPENROUTER_MODELS_AUTH_PATH = previous;
  }
});
