import { z } from 'zod';
import type { Config } from '../config.js';
import type { YandexProfileInput } from '../store/types.js';
import { pkceChallenge } from '../util/crypto.js';

export class YandexError extends Error {
  override readonly name = 'YandexError';
}

const TokenResponse = z.object({ access_token: z.string().min(1) });
const ErrorResponse = z.object({
  error: z.string(),
  error_description: z.string().optional(),
});

// https://yandex.ru/dev/id/doc/ru/user-information
const InfoResponse = z.object({
  id: z.string().min(1),
  login: z.string().optional(),
  display_name: z.string().optional(),
  real_name: z.string().optional(),
  default_email: z.string().optional(),
  default_avatar_id: z.string().optional(),
  is_avatar_empty: z.boolean().optional(),
});

const TIMEOUT_MS = 10_000;
/**
 * Yandex throttles now and then (2026-10-11: «429 proxy.api.error»): a refused exchange does not
 * spend the code, so it is asked once more after a pause instead of failing the sign-in.
 */
const RETRY_STATUSES = new Set([429, 500, 502, 503, 504]);

/**
 * Yandex ID sign-in: authorization code flow with PKCE. The access token is used once to read
 * the profile and is not stored.
 */
export class YandexAuth {
  constructor(
    private readonly config: Pick<
      Config,
      | 'PUBLIC_URL'
      | 'YANDEX_CLIENT_ID'
      | 'YANDEX_CLIENT_SECRET'
      | 'YANDEX_OAUTH_URL'
      | 'YANDEX_LOGIN_URL'
    >,
    private readonly fetchFn: typeof fetch = fetch,
    private readonly retryMs = 1_000,
  ) {}

  get redirectUri(): string {
    return `${this.config.PUBLIC_URL}/auth/yandex/callback`;
  }

  authorizeUrl(state: string, codeVerifier: string): string {
    const url = new URL('/authorize', this.config.YANDEX_OAUTH_URL);
    url.search = new URLSearchParams({
      response_type: 'code',
      client_id: this.config.YANDEX_CLIENT_ID,
      redirect_uri: this.redirectUri,
      state,
      code_challenge: pkceChallenge(codeVerifier),
      code_challenge_method: 'S256',
    }).toString();
    return url.toString();
  }

  /** Exchanges the authorization code for an access token. */
  async exchange(code: string, codeVerifier: string): Promise<string> {
    const ask = () =>
      this.fetchFn(new URL('/token', this.config.YANDEX_OAUTH_URL), {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          client_id: this.config.YANDEX_CLIENT_ID,
          client_secret: this.config.YANDEX_CLIENT_SECRET,
          code_verifier: codeVerifier,
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    let res = await ask();
    if (RETRY_STATUSES.has(res.status)) {
      await res.body?.cancel().catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, this.retryMs));
      res = await ask();
    }
    const body: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      const err = ErrorResponse.safeParse(body);
      throw new YandexError(
        `token exchange failed: ${res.status} ${err.success ? `${err.data.error} ${err.data.error_description ?? ''}` : ''}`.trim(),
      );
    }
    const parsed = TokenResponse.safeParse(body);
    if (!parsed.success) throw new YandexError('token exchange: unexpected response');
    return parsed.data.access_token;
  }

  async profile(accessToken: string): Promise<YandexProfileInput> {
    const url = new URL('/info', this.config.YANDEX_LOGIN_URL);
    url.searchParams.set('format', 'json');
    const res = await this.fetchFn(url, {
      headers: { authorization: `OAuth ${accessToken}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new YandexError(`profile request failed: ${res.status}`);
    const parsed = InfoResponse.safeParse(await res.json().catch(() => null));
    if (!parsed.success) throw new YandexError('profile: unexpected response');
    const p = parsed.data;
    return {
      yandexId: p.id,
      login: p.login ?? null,
      email: p.default_email ?? null,
      name: p.real_name || p.display_name || p.login || null,
      avatarId: p.is_avatar_empty || !p.default_avatar_id ? null : p.default_avatar_id,
    };
  }
}
