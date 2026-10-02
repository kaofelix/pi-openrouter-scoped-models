import { homedir } from 'node:os';
import { join } from 'node:path';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { fetchUserModels } from './api.ts';
import { readCatalogCache, writeCatalogCache } from './cache.ts';
import { mapCatalog, type CatalogMode, type ModelConfig } from './catalog.ts';
import { syncModels } from './sync.ts';

type ActiveCatalog = { source: 'api' | 'cache' | 'none'; mode: CatalogMode; count: number; timestamp?: number };

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
      const result = await syncModels({
        mode,
        fetchModels: () => fetchUserModels(currentKey),
        readCache: () => readCatalogCache(directory, currentKey),
        writeCache: (cache) => writeCatalogCache(directory, currentKey, cache),
        register: (models) => ctx.modelRegistry.registerProvider('openrouter', providerConfig(models)),
      });
      if (result.source !== 'none' || mode === 'free-only') {
        active = { source: result.source, mode: result.mode, count: result.count,
          ...(result.timestamp ? { timestamp: result.timestamp } : {}) };
      }
      ctx.ui.notify(`${result.count} models · ${result.mode} · ${result.source}${result.error ? `\n${result.error}` : ''}`,
        result.error ? 'warning' : 'info');
    },
  });
}
