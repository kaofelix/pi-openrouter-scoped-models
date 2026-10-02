import { homedir } from 'node:os';
import { join } from 'node:path';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { fetchUserModels } from './api.ts';
import { readCatalogCache, writeCatalogCache } from './cache.ts';
import { mapCatalog, type CatalogMode, type ModelConfig } from './catalog.ts';
import { syncModels, type SyncResult } from './sync.ts';

type ActiveCatalog = { source: 'api' | 'cache' | 'none'; mode: CatalogMode; count: number; timestamp?: number };

// A cache younger than this is fresh enough to skip the startup refresh.
const STALE_MS = 30 * 60 * 1000;

function providerConfig(models: ModelConfig[]) {
  return {
    baseUrl: 'https://openrouter.ai/api/v1',
    apiKey: '$OPENROUTER_API_KEY',
    api: 'openai-completions' as const,
    authHeader: true,
    models,
  };
}

export default async function install(pi: ExtensionAPI): Promise<void> {
  const directory = process.env.PI_OPENROUTER_MODELS_CACHE_DIR ??
    join(homedir(), '.pi', 'openrouter-models');
  let active: ActiveCatalog | null = null;
  let inflight: Promise<void> | null = null;
  let controller: AbortController | null = null;

  const runSync = (key: string, mode: CatalogMode, signal: AbortSignal | undefined,
    register: (models: ModelConfig[]) => void): Promise<SyncResult> => syncModels({
    mode,
    fetchModels: () => fetchUserModels(key, signal),
    readCache: () => readCatalogCache(directory, key),
    writeCache: (cache) => writeCatalogCache(directory, key, cache),
    register,
  });

  const key = process.env.OPENROUTER_API_KEY?.trim();

  // Startup is offline and fast; never load another API key's cached catalog.
  if (key) {
    const cached = await readCatalogCache(directory, key);
    if (cached) {
      const { models } = mapCatalog(cached.models, cached.mode);
      if (cached.mode === 'free-only' || models.length > 1) {
        pi.registerProvider('openrouter', providerConfig(models));
        active = { source: 'cache', mode: cached.mode, count: models.length, timestamp: cached.timestamp };
      }
    }
  }

  // Refresh once per process start, in the background. The cached catalog stays
  // active until the fresh one is ready, so startup never waits on the network.
  pi.on('session_start', (event) => {
    if (event.reason !== 'startup') return;
    const currentKey = process.env.OPENROUTER_API_KEY?.trim();
    if (!currentKey || inflight) return;
    if (active?.timestamp && Date.now() - active.timestamp < STALE_MS) return;
    const mode = active?.mode ?? 'full';
    controller = new AbortController();
    const signal = controller.signal;
    const task = runSync(currentKey, mode, signal, (models) => {
      if (!signal.aborted) pi.registerProvider('openrouter', providerConfig(models));
    }).then((result) => {
      if (signal.aborted || result.source !== 'api') return;
      active = { source: 'api', mode: result.mode, count: result.count, timestamp: Date.now() };
    }).catch(() => {}).finally(() => {
      if (inflight === task) {
        inflight = null;
        controller = null;
      }
    });
    inflight = task;
  });

  pi.on('session_shutdown', () => {
    controller?.abort();
    controller = null;
    inflight = null;
  });

  pi.registerCommand('openrouter-models', {
    description: 'Refresh or inspect your OpenRouter user-scoped model catalog (sync [--free] | status)',
    handler: async (args, ctx) => {
      const parts = args.trim().split(/\s+/);
      const action = parts[0] || 'status';
      if (action === 'status' && parts.length === 1) {
        const age = active?.timestamp ? ` · cached ${Math.max(0, Math.floor((Date.now() - active.timestamp) / 60000))}m ago` : '';
        ctx.ui.notify(active
          ? `${active.count} models · ${active.mode} · ${active.source}${age}`
          : 'No synced catalog active. Run /openrouter-models sync.', 'info');
        return;
      }
      if (action !== 'sync' || (parts.length !== 1 && !(parts.length === 2 && parts[1] === '--free'))) {
        ctx.ui.notify('Usage: /openrouter-models sync [--free] | status', 'error');
        return;
      }
      const currentKey = process.env.OPENROUTER_API_KEY?.trim();
      if (!currentKey) {
        ctx.ui.notify('Set OPENROUTER_API_KEY to sync the user-scoped model catalog.', 'error');
        return;
      }
      const mode: CatalogMode = parts[1] === '--free' ? 'free-only' : 'full';
      // A manual sync supersedes any startup refresh still in flight.
      controller?.abort();
      controller = null;
      const pending = inflight;
      inflight = null;
      if (pending) await pending.catch(() => {});
      const result = await runSync(currentKey, mode, undefined, (models) =>
        ctx.modelRegistry.registerProvider('openrouter', providerConfig(models)));
      if (result.source !== 'none' || mode === 'free-only') {
        active = { source: result.source, mode: result.mode, count: result.count,
          timestamp: result.source === 'api' ? Date.now() : result.timestamp };
      }
      ctx.ui.notify(`${result.count} models · ${result.mode} · ${result.source}${result.error ? `\n${result.error}` : ''}`,
        result.error ? 'warning' : 'info');
    },
  });
}
