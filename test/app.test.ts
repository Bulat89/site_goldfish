import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PUBLIC_URL, sessionUser, signIn, startApp, testConfig, type TestApp } from './helpers.js';

const origin = { origin: PUBLIC_URL };
/** What a connection key carries for the extension. */
const keyOf = (key: string) =>
  JSON.parse(Buffer.from(key.replace(/^gfk_/, ''), 'base64url').toString()) as {
    server: string;
    token: string;
  };

let t: TestApp;
afterEach(async () => {
  await t?.app.close();
});

describe('landing page', () => {
  it('shows the product and the Yandex ID sign-in to guests, with strict headers', async () => {
    t = await startApp();
    const res = await t.app.inject('/');
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Войти с Яндекс ID');
    expect(res.body).toContain('href="/auth/yandex"');
    expect(res.body).toContain('Команда AI-агентов для вашего объекта размещения');
    for (const agent of [
      'Каналы продаж',
      'Цены и загрузка',
      'Гости',
      'Репутация',
      'Прямые продажи',
      'Управляющий',
    ])
      expect(res.body).toContain(`<h3>${agent}</h3>`);
    // The landing says what it is, how it works and who decides; the waves and a second list of
    // «how to start» are for the cabinet and the guide.
    expect(res.body).toContain('Как это работает');
    expect(res.body).toContain('Решения — за вами');
    expect(res.body).not.toContain('Запуск волнами');
    expect(res.body).not.toContain('Как начать');
    expect(res.body).not.toContain('Скачать расширение');
    expect(res.body).not.toContain('href="/cabinet"');
    expect(res.headers['content-security-policy']).toContain("script-src 'self'");
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['strict-transport-security']).toBeDefined();
  });

  it('serves versioned static assets with long caching', async () => {
    t = await startApp();
    const page = await t.app.inject('/');
    const css = /href="(\/style\.css\?v=[0-9a-f]+)"/.exec(page.body)![1]!;
    const res = await t.app.inject(css);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/css');
    expect(res.headers['cache-control']).toContain('immutable');
  });

  it('serves the favicon at the paths browsers ask for on their own', async () => {
    t = await startApp();
    const ico = await t.app.inject('/favicon.ico');
    expect(ico.statusCode).toBe(200);
    expect(ico.headers['content-type']).toBe('image/x-icon');
    const touch = await t.app.inject('/apple-touch-icon.png');
    expect(touch.statusCode).toBe(200);
    expect(touch.headers['content-type']).toBe('image/png');
  });

  it('explains a failed sign-in', async () => {
    t = await startApp();
    expect((await t.app.inject('/?login=denied')).body).toContain('Вход отменён');
    expect((await t.app.inject('/?login=<script>')).body).not.toContain('<script>alert');
  });

  it('answers unknown paths with a 404 page', async () => {
    t = await startApp();
    const res = await t.app.inject('/nope');
    expect(res.statusCode).toBe(404);
    expect(res.body).toContain('Страница не найдена');
  });
});

describe('Yandex ID sign-in', () => {
  it('redirects to Yandex with state and a PKCE challenge in a __Host- cookie', async () => {
    t = await startApp();
    const res = await t.app.inject('/auth/yandex');
    expect(res.statusCode).toBe(302);
    const url = new URL(String(res.headers.location));
    expect(url.origin + url.pathname).toBe('https://oauth.yandex.test/authorize');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('client_id')).toBe('ya-client');
    expect(url.searchParams.get('redirect_uri')).toBe(`${PUBLIC_URL}/auth/yandex/callback`);
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    // Yandex asks which account signs in, so a second account can sign in after «Выйти».
    expect(url.searchParams.get('force_confirm')).toBe('yes');
    expect(url.searchParams.get('state')).toMatch(/^[\w-]{20,}$/);
    const cookie = res.cookies.find((c) => c.name === '__Host-gf_oauth')!;
    expect(cookie).toMatchObject({ httpOnly: true, secure: true, path: '/', sameSite: 'Lax' });
  });

  it('signs the user in and opens their cabinet, without the server address', async () => {
    t = await startApp();
    const cookies = await signIn(t);
    expect(Object.keys(cookies)).toEqual(['__Host-gf_session']);
    const home = await t.app.inject({ url: '/', cookies });
    expect(home.statusCode).toBe(302);
    expect(home.headers.location).toBe('/cabinet');
    const page = await t.app.inject({ url: '/cabinet/settings', cookies });
    expect(page.body).toContain('Личный кабинет');
    expect(page.body).toContain('Иван Петров');
    expect(page.body).toContain('Скачать расширение');
    expect(page.body).toContain('Получить ключ подключения');
    // The address of the server goes inside the key; only the webhooks' base knows it.
    expect(page.body.replace('data-base="https://agent.test"', '')).not.toContain('agent.test');
    expect(page.body).toContain('avatars.yandex.net/get-yapic/131652443%2Fabc-123/islands-68');
    expect(page.headers['cache-control']).toContain('no-store');
    // The Yandex access token is used once and not kept.
    expect(await sessionUser(t, cookies)).toMatchObject({
      yandexId: '1000001',
      email: 'ivan.petrov@yandex.ru',
      name: 'Иван Петров',
    });
  });

  it('asks Yandex once more when it throttles the code exchange', async () => {
    t = await startApp();
    t.fakes.tokenThrottled = 1;
    const cookies = await signIn(t);
    expect(Object.keys(cookies)).toEqual(['__Host-gf_session']);
    expect(t.fakes.tokenThrottled).toBe(0);
  });

  it('keeps one account per Yandex ID and refreshes the profile on the next sign-in', async () => {
    t = await startApp();
    await signIn(t);
    t.fakes.profile = { ...t.fakes.profile, real_name: 'Иван Сидоров', is_avatar_empty: true };
    const cookies = await signIn(t);
    const page = await t.app.inject({ url: '/cabinet', cookies });
    expect(page.body).toContain('Иван Сидоров');
    expect(page.body).toContain('avatar--empty');
  });

  it('rejects a callback whose state does not match the browser', async () => {
    t = await startApp();
    const start = await t.app.inject('/auth/yandex');
    const oauth = start.cookies.find((c) => c.name === '__Host-gf_oauth')!;
    const challenge = new URL(String(start.headers.location)).searchParams.get('code_challenge')!;
    t.fakes.approve('auth-code', challenge);
    const res = await t.app.inject({
      url: '/auth/yandex/callback?code=auth-code&state=forged',
      cookies: { [oauth.name]: oauth.value },
    });
    expect(res.headers.location).toBe('/?login=expired');
    expect(res.cookies.find((c) => c.name === '__Host-gf_session')).toBeUndefined();
    expect(t.fakes.calls.filter((c) => c.includes('oauth.yandex.test'))).toEqual([]);
  });

  it('handles a declined consent and a failed code exchange', async () => {
    t = await startApp();
    const declined = await t.app.inject('/auth/yandex/callback?error=access_denied&state=x');
    expect(declined.headers.location).toBe('/?login=denied');

    t.fakes.tokenExchangeFails = true;
    await expect(signIn(t)).rejects.toThrow('/?login=error');
  });

  it('logs out only from its own pages', async () => {
    t = await startApp();
    const cookies = await signIn(t);
    const forged = await t.app.inject({
      method: 'POST',
      url: '/logout',
      cookies,
      headers: { origin: 'https://evil.test' },
    });
    expect(forged.statusCode).toBe(403);
    const res = await t.app.inject({
      method: 'POST',
      url: '/logout',
      cookies,
      headers: { ...origin, 'content-type': 'application/x-www-form-urlencoded' },
      payload: '',
    });
    expect(res.statusCode).toBe(303);
    const page = await t.app.inject({ url: '/', cookies });
    expect(page.body).toContain('Войти с Яндекс ID');
  });

  it('uses plain cookie names on http://localhost', async () => {
    t = await startApp({ PUBLIC_URL: 'http://localhost:3000' });
    const res = await t.app.inject('/auth/yandex');
    expect(res.cookies.map((c) => c.name)).toEqual(['gf_oauth']);
    expect(res.cookies[0]!.secure).toBeFalsy();
  });
});

describe('device token', () => {
  it('requires a session and a same-origin request', async () => {
    t = await startApp();
    expect(
      (await t.app.inject({ method: 'POST', url: '/api/token', headers: origin })).statusCode,
    ).toBe(401);
    const cookies = await signIn(t);
    const crossSite = await t.app.inject({
      method: 'POST',
      url: '/api/token',
      cookies,
      headers: { origin: 'https://evil.test' },
    });
    expect(crossSite.statusCode).toBe(403);
    expect(t.fakes.tokens.size).toBe(0);
  });

  it('creates the Goldfish client and user, then issues a key shown once', async () => {
    t = await startApp();
    const cookies = await signIn(t);
    const res = await t.app.inject({ method: 'POST', url: '/api/token', cookies, headers: origin });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const body = res.json();
    // The key carries the server's address with the token: the page never shows the address.
    expect(Object.keys(body).sort()).toEqual(['issuedAt', 'key']);
    expect(keyOf(body.key)).toEqual({ server: 'https://agent.test', token: 'gf_secret_tok_2' });
    expect(t.fakes.clients).toEqual([{ id: 'cl_1', name: 'Сайт' }]);
    expect(t.fakes.users.get('cl_1/yandex:1000001')).toEqual({
      displayName: 'Иван Петров <ivan.petrov@yandex.ru>',
    });
    expect(t.fakes.tokens.get('tok_2')).toMatchObject({
      clientId: 'cl_1',
      userId: 'yandex:1000001',
    });

    const page = await t.app.inject({ url: '/cabinet/settings', cookies });
    expect(page.body).toContain('Выпустить новый ключ');
    expect(page.body).toContain('Ключ выдан');
    expect(page.body).not.toContain('gf_secret');
    expect(page.body).not.toContain('gfk_');
  });

  it('revokes the previous token when a new one is issued', async () => {
    t = await startApp();
    const cookies = await signIn(t);
    const first = (
      await t.app.inject({ method: 'POST', url: '/api/token', cookies, headers: origin })
    ).json();
    const second = (
      await t.app.inject({ method: 'POST', url: '/api/token', cookies, headers: origin })
    ).json();
    expect(first.key).not.toBe(second.key);
    expect(t.fakes.activeTokens()).toEqual([keyOf(second.key).token.replace('gf_secret_', '')]);
    // The user already exists in Goldfish: only the display name is refreshed.
    expect(t.fakes.calls.filter((c) => c.startsWith('PATCH'))).toHaveLength(1);
  });

  it('issues a token even when the previous one is already gone from Goldfish', async () => {
    t = await startApp();
    const cookies = await signIn(t);
    await t.store.setToken((await sessionUser(t, cookies)).id, 'tok_deleted_by_operator');
    const res = await t.app.inject({ method: 'POST', url: '/api/token', cookies, headers: origin });
    expect(res.statusCode).toBe(200);
    expect(t.fakes.calls).toContain('DELETE agent.test/admin/tokens/tok_deleted_by_operator');
  });

  it('never leaves two active tokens after concurrent clicks', async () => {
    t = await startApp();
    const cookies = await signIn(t);
    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        t.app.inject({ method: 'POST', url: '/api/token', cookies, headers: origin }),
      ),
    );
    expect(results.map((r) => r.statusCode)).toEqual([200, 200, 200, 200]);
    expect(t.fakes.activeTokens()).toHaveLength(1);
  });

  it('reuses an existing client by name or the configured client id', async () => {
    t = await startApp();
    t.fakes.clients.push({ id: 'cl_existing', name: 'Сайт' });
    const cookies = await signIn(t);
    await t.app.inject({ method: 'POST', url: '/api/token', cookies, headers: origin });
    expect(t.fakes.clients).toHaveLength(1);
    expect(t.fakes.users.has('cl_existing/yandex:1000001')).toBe(true);
    await t.app.close();

    t = await startApp({ GOLDFISH_CLIENT_ID: 'cl_fixed' });
    const c2 = await signIn(t);
    await t.app.inject({ method: 'POST', url: '/api/token', cookies: c2, headers: origin });
    expect(t.fakes.calls).not.toContain('GET agent.test/admin/clients');
    expect(t.fakes.users.has('cl_fixed/yandex:1000001')).toBe(true);
  });

  it('reports an unreachable Goldfish server without losing the session', async () => {
    t = await startApp();
    const cookies = await signIn(t);
    t.fakes.goldfishDown = true;
    const res = await t.app.inject({ method: 'POST', url: '/api/token', cookies, headers: origin });
    expect(res.statusCode).toBe(502);
    expect(res.json().message).toContain('недоступен');
    t.fakes.goldfishDown = false;
    const retry = await t.app.inject({
      method: 'POST',
      url: '/api/token',
      cookies,
      headers: origin,
    });
    expect(retry.statusCode).toBe(200);
  });
});

describe('extension download', () => {
  it('sends guests to sign in first', async () => {
    t = await startApp();
    const res = await t.app.inject('/download');
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/auth/yandex');
  });

  it('streams the package from the Goldfish server and records the download', async () => {
    t = await startApp();
    const cookies = await signIn(t);
    const res = await t.app.inject({ url: '/download', cookies });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/zip');
    expect(res.headers['content-disposition']).toBe(
      'attachment; filename="goldfish-extension-0.1.0.zip"',
    );
    expect(res.rawPayload.equals(t.fakes.extensionZip!)).toBe(true);
    expect((await sessionUser(t, cookies)).lastDownloadAt).not.toBeNull();
  });

  it('prefers a local EXTENSION_ZIP', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'gf-site-'));
    const zip = path.join(dir, 'goldfish-extension-9.9.9.zip');
    writeFileSync(zip, 'PK local');
    t = await startApp({ EXTENSION_ZIP: zip });
    const cookies = await signIn(t);
    const res = await t.app.inject({ url: '/download', cookies });
    expect(res.body).toBe('PK local');
    expect(res.headers['content-disposition']).toContain('goldfish-extension-9.9.9.zip');
    expect(t.fakes.calls.some((c) => c.includes('/extension/download'))).toBe(false);
  });

  it('explains when no package is available', async () => {
    t = await startApp();
    t.fakes.extensionZip = null;
    const cookies = await signIn(t);
    const res = await t.app.inject({ url: '/download', cookies });
    expect(res.headers.location).toBe('/cabinet/settings?download=unavailable#extension-title');
    const back = String(res.headers.location).split('#')[0]!;
    expect((await t.app.inject({ url: back, cookies })).body).toContain(
      'Пакет расширения сейчас недоступен',
    );
  });
});

describe('health', () => {
  it('reports liveness and readiness', async () => {
    t = await startApp();
    expect((await t.app.inject('/healthz')).json()).toEqual({ ok: true });
    expect((await t.app.inject('/readyz')).json()).toEqual({ ok: true });
  });
});

describe('configuration', () => {
  it('takes only http(s) addresses for links shown on the page', () => {
    expect(() => testConfig({ PRIVACY_URL: 'javascript:alert(1)' })).toThrow(/http\(s\)/);
    expect(() => testConfig({ GOLDFISH_URL: 'data:text/html,x' })).toThrow(/http\(s\)/);
    expect(testConfig({ PRIVACY_URL: 'https://site.test/privacy/' }).PRIVACY_URL).toBe(
      'https://site.test/privacy',
    );
  });
});
