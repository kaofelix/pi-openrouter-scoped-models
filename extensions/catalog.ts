// OpenRouter's /api/v1/models/user response uses snake_case; no SDK or management key needed.
export interface ModelConfig {
  id: string;
  name: string;
  input: ('text' | 'image')[];
  reasoning: boolean;
  contextWindow: number;
  maxTokens: number;
  cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
}

export type CatalogMode = 'full' | 'free-only';

const FREE_ROUTER: ModelConfig = {
  id: 'openrouter/free', name: 'Free Models Router', input: ['text', 'image'],
  reasoning: true, contextWindow: 200000, maxTokens: 4096,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
};
function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function positiveInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null;
}

function price(value: unknown): number | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  if (String(value).trim() === '') return null;
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0 ? amount * 1_000_000 : null;
}

function safeText(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  // Model metadata is displayed in the TUI; never let it supply terminal controls.
  const text = value.replace(/[\x00-\x1f\x7f-\x9f]/g, '').slice(0, 200);
  return text || fallback;
}

export function mapCatalog(raw: unknown[], mode: CatalogMode): { models: ModelConfig[]; skipped: number } {
  const models: ModelConfig[] = [];
  const seen = new Set(['openrouter/free', 'openrouter/auto']);
  let skipped = 0;
  for (const value of raw) {
    const model = record(value);
    const id = model?.id;
    if (typeof id !== 'string') { skipped++; continue; }
    if (mode === 'free-only' && !id.endsWith(':free')) continue;
    if (seen.has(id)) continue;
    const architecture = record(model?.architecture);
    const pricing = record(model?.pricing);
    const topProvider = record(model?.top_provider);
    const limits = record(model?.per_request_limits);
    const contextWindow = positiveInteger(topProvider?.context_length) ?? positiveInteger(model?.context_length);
    const input = price(pricing?.prompt);
    const output = price(pricing?.completion);
    const cacheRead = pricing?.input_cache_read == null ? 0 : price(pricing.input_cache_read);
    const cacheWrite = pricing?.input_cache_write == null ? 0 : price(pricing.input_cache_write);
    const outputModalities = architecture?.output_modalities;
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._:/+~-]{0,199}$/.test(id) || !contextWindow ||
        input === null || output === null || cacheRead === null || cacheWrite === null ||
        (Array.isArray(outputModalities) && !outputModalities.includes('text')) ||
        (mode === 'free-only' && (input !== 0 || output !== 0))) {
      skipped++;
      continue;
    }
    const completion = positiveInteger(topProvider?.max_completion_tokens) ??
      positiveInteger(limits?.completion_tokens) ?? 4096;
    const parameters = model?.supported_parameters;
    models.push({
      id, name: safeText(model?.name, id),
      input: Array.isArray(architecture?.input_modalities) && architecture.input_modalities.includes('image')
        ? ['text', 'image'] : ['text'],
      reasoning: Array.isArray(parameters) &&
        (parameters.includes('reasoning') || parameters.includes('include_reasoning')) || !!record(model?.reasoning),
      contextWindow, maxTokens: Math.min(completion, contextWindow),
      cost: { input, output, cacheRead, cacheWrite },
    });
    seen.add(id);
  }
  models.push(FREE_ROUTER);
  return { models, skipped };
}
