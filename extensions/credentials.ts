import { readStoredCredential } from '@earendil-works/pi-coding-agent';

/**
 * Resolve the OpenRouter API key the way Pi does: a credential stored by
 * `/login` owns the provider, and `OPENROUTER_API_KEY` is only consulted when
 * nothing is stored.
 *
 * OpenRouter's OAuth flow exchanges the authorization code for a permanent,
 * user-controlled API key and stores it as the OAuth `access` token, so both
 * credential shapes can be used directly as a bearer token. No refresh is
 * required.
 *
 * `authPath` defaults to Pi's `auth.json`; tests redirect it with
 * `PI_OPENROUTER_MODELS_AUTH_PATH`.
 */
export function resolveOpenRouterKey(
  authPath: string | undefined = process.env.PI_OPENROUTER_MODELS_AUTH_PATH,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const credential = readStoredCredential('openrouter', authPath);
  if (credential?.type === 'api_key') {
    const key = credential.key?.trim();
    if (key) return key;
  } else if (credential?.type === 'oauth') {
    const key = credential.access?.trim();
    if (key) return key;
  }
  return env.OPENROUTER_API_KEY?.trim() || undefined;
}
