import { afterEach, describe, expect, it } from 'vitest';
import {
  BOTS_TOKEN,
  BOTS_URL,
  PUBLIC_URL,
  sessionUser,
  signIn,
  startApp,
  type TestApp,
} from './helpers.js';

const origin = { origin: PUBLIC_URL };
const SITE_USER = 'yandex:1000001';
const AVITO = 'https://www.avito.ru/sochi/doma/dom_u_morya_1';
const OSTROVOK = 'https://ostrovok.ru/hotel/russia/sochi/dom_u_morya/';

let t: TestApp;
afterEach(async () => {
  await t?.app.close();
});

const post = (cookies: Record<string, string>, url: string, payload: unknown) =>
  t.app.inject({ method: 'POST', url, cookies, headers: origin, payload: payload as object });
const hotelCalls = (method: string, sub: string) =>
  t.fakes.hotelCalls.filter((c) => c.method === method && c.path === `${SITE_USER} ${sub}`);

describe('setup wizard', () => {
  it('greets the owner after sign-in; the first open step is where the setup stands', async () => {
    t = await startApp();
    const cookies = await signIn(t);
    expect((await t.app.inject({ url: '/', cookies })).headers.location).toBe('/start');
    const page = await t.app.inject({ url: '/start', cookies });
    expect(page.statusCode).toBe(200);
    expect(page.headers['cache-control']).toContain('no-store');
    const html = page.body;
    expect(html).toContain('Настройка · шаг 1 из 4');
    expect(html).toContain('Установите расширение Goldfish');
    // Why, why it is safe, where.
    expect(html).toContain('<h3>Зачем</h3>');
    expect(html).toContain('<h3>Почему это безопасно</h3>');
    expect(html).toContain('<h3>Где установить</h3>');
    expect(html).toContain('href="/download"');
    expect(html).toContain('id="issue-key"');
    expect(html).toContain('data-ext-poll');
    // The four steps, each a link; the server's address is nowhere.
    for (const n of [1, 2, 3, 4]) expect(html).toContain(`href="/start?step=${n}"`);
    expect(html).toContain('aria-current="step"');
    expect(html).not.toContain('agent.test');

    // The extension connected: the wizard opens on the listings.
    t.fakes.extension = { online: true, lastBrowserSeenAt: '2026-10-22T08:00:00.000Z' };
    const next = (await t.app.inject({ url: '/start', cookies })).body;
    expect(next).toContain('Настройка · шаг 2 из 4');
    expect(next).toContain('Ваши объявления на площадках');
    expect(next).toMatch(
      /stepper__num" aria-hidden="true">✓<\/span><span class="stepper__text"><b>Расширение<\/b><span class="stepper__note">подключено/,
    );
  });

  it('step 1 tells whether the extension connected (a read: the session is enough)', async () => {
    t = await startApp();
    expect((await t.app.inject({ url: '/api/onboarding/extension' })).statusCode).toBe(401);
    const cookies = await signIn(t);
    const ask = async () =>
      (await t.app.inject({ url: '/api/onboarding/extension', cookies })).json();
    t.fakes.extension = null;
    expect(await ask()).toEqual({ connected: false, online: false, lastSeenAt: null });
    t.fakes.extension = { online: false, lastBrowserSeenAt: '2026-10-21T10:00:00.000Z' };
    expect(await ask()).toEqual({
      connected: true,
      online: false,
      lastSeenAt: '2026-10-21T10:00:00.000Z',
    });
    expect(t.fakes.calls).toContain('GET agent.test/admin/users/cl_1/yandex%3A1000001');
  });

  it('step 2: listings registered on their platforms, the reference read into a draft', async () => {
    t = await startApp();
    const cookies = await signIn(t);
    const page = (await t.app.inject({ url: '/start?step=2', cookies })).body;
    // Platforms for guests with the reference radio; the maps without it; no PMS here.
    expect(page).toContain('aria-label="Эталонное объявление: Островок"');
    expect(page).toContain('aria-label="Эталонное объявление: Авито"');
    expect(page).toContain('data-platform="yandex_maps"');
    expect(page).not.toContain('Эталонное объявление: Яндекс Карты');
    expect(page).not.toContain('data-platform="bnovo"');

    // A wrong address is refused with the platform's reason; what went through stays.
    const wrong = await post(cookies, '/api/onboarding/listings', {
      listings: [
        { platform: 'avito', url: AVITO },
        { platform: 'ostrovok', url: 'https://example.com/x' },
      ],
      reference: 'avito',
    });
    expect(wrong.statusCode).toBe(400);
    expect(wrong.json().message).toBe('Островок: это ссылка не на Островок');
    expect(hotelCalls('POST', '/listings/manual').map((c) => c.body)).toEqual([
      { platform: 'avito', url: AVITO },
      { platform: 'ostrovok', url: 'https://example.com/x' },
    ]);
    expect(hotelCalls('POST', '/profile/import').map((c) => c.body)).toEqual([{ url: AVITO }]);

    // Again: Avito is known and its draft is being read — only Ostrovok goes.
    t.fakes.hotelCalls.length = 0;
    const ok = await post(cookies, '/api/onboarding/listings', {
      listings: [
        { platform: 'avito', url: AVITO },
        { platform: 'ostrovok', url: OSTROVOK },
      ],
      reference: 'avito',
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ ok: true, importStarted: false });
    expect(hotelCalls('POST', '/listings/manual').map((c) => c.body)).toEqual([
      { platform: 'ostrovok', url: OSTROVOK },
    ]);
    expect(hotelCalls('POST', '/profile/import')).toEqual([]);

    // The step shows the reference being read; the stepper counts the listings.
    const after = (await t.app.inject({ url: '/start?step=2', cookies })).body;
    expect(after).toContain(`value="${AVITO}"`);
    expect(after).toMatch(/value="avito" checked/);
    expect(after).toContain('data-import-poll="imp_1"');
    expect(after).toContain('объявлений: 2, эталон — Авито');

    // A cleared field: the listing leaves the reference, the system with nothing else too.
    t.fakes.hotelCalls.length = 0;
    const cleared = await post(cookies, '/api/onboarding/listings', {
      listings: [
        { platform: 'avito', url: AVITO },
        { platform: 'ostrovok', url: '' },
      ],
      reference: 'avito',
    });
    expect(cleared.statusCode).toBe(200);
    const put = hotelCalls('PUT', '/profile');
    expect(put).toHaveLength(1);
    expect((put[0]!.body as { systems: unknown[] }).systems).toEqual([
      { id: 'avito', listingUrl: AVITO },
    ]);

    // Bad input is refused before anything is sent.
    expect((await post(cookies, '/api/onboarding/listings', { listings: 'x' })).statusCode).toBe(
      400,
    );
  });

  it('step 3: the CRM cabinet replaces another CRM; «Нет CRM» removes it; the bot QR codes', async () => {
    t = await startApp({ BOTS_URL, BOTS_API_TOKEN: BOTS_TOKEN });
    const cookies = await signIn(t);
    const page = (await t.app.inject({ url: '/start?step=3', cookies })).body;
    expect(page).toContain('Доступ к CRM');
    expect(page).toContain('<option value="bnovo"');
    expect(page).toContain('<option value="sheet"');
    expect(page).toContain('<option value="none">Нет CRM');
    expect(page.match(/<svg class="qr"/g)).toHaveLength(3);
    expect(page).toContain('CRM не указана, бот не привязан');

    const noUrl = await post(cookies, '/api/onboarding/crm', { system: 'bnovo', url: '' });
    expect(noUrl.statusCode).toBe(400);
    expect(noUrl.json().message).toContain('https://');
    const notCrm = await post(cookies, '/api/onboarding/crm', {
      system: 'avito',
      url: 'https://www.avito.ru/profile',
    });
    expect(notCrm.json().message).toBe('Такой CRM нет в списке');

    t.fakes.hotel.profile.systems = [
      { id: 'ostrovok' },
      { id: 'sheet', url: 'https://docs.google.com/x' },
    ];
    const ok = await post(cookies, '/api/onboarding/crm', {
      system: 'bnovo',
      url: 'https://online.bnovo.ru/dashboard',
    });
    expect(ok.statusCode).toBe(200);
    expect(t.fakes.hotel.profile.systems).toEqual([
      { id: 'ostrovok' },
      { id: 'bnovo', url: 'https://online.bnovo.ru/dashboard' },
    ]);
    const saved = (await t.app.inject({ url: '/start?step=3', cookies })).body;
    expect(saved).toContain(
      '<option value="bnovo" data-placeholder="https://online.bnovo.ru/…" selected>',
    );
    expect(saved).toContain('value="https://online.bnovo.ru/dashboard"');

    expect((await post(cookies, '/api/onboarding/crm', { system: 'none' })).statusCode).toBe(200);
    expect(t.fakes.hotel.profile.systems).toEqual([{ id: 'ostrovok' }]);
  });

  it('step 4: the team and the autonomy, then the study; the wizard is finished once', async () => {
    t = await startApp();
    const cookies = await signIn(t);
    t.fakes.hotel.settings.agents.forEach((a) => (a.enabled = false));
    t.fakes.hotel.profile.systems = [{ id: 'ostrovok', listingUrl: OSTROVOK }];
    const page = (await t.app.inject({ url: '/start?step=4', cookies })).body;
    // A new team: every agent offered; «Контролируемая автономность» to start with.
    expect(page.match(/name="agent" value="\w+" checked/g)).toHaveLength(2);
    expect(page).toMatch(/name="autonomy" value="3" checked/);
    expect(page).toContain('Сначала агенты только изучают');
    expect(page).toContain('Менять и исправлять что-либо в это время запрещено');
    expect(page).toContain('Расширение не подключено');
    expect(page).toMatch(
      /<button class="btn btn--accent" type="submit" disabled>Запустить изучение/,
    );

    expect((await post(cookies, '/api/onboarding/finish', { agents: [] })).statusCode).toBe(400);
    // Without the extension the server does not start the study: nothing is finished.
    const early = await post(cookies, '/api/onboarding/finish', {
      agents: ['channels'],
      autonomy: 3,
    });
    expect(early.statusCode).toBe(400);
    expect(early.json().message).toContain('расширение');
    expect((await sessionUser(t, cookies)).onboardedAt).toBeNull();
    // Refused before any agent was switched on: nothing works outside the study.
    expect(hotelCalls('POST', '/settings')).toEqual([]);

    t.fakes.extension = { online: true, lastBrowserSeenAt: '2026-10-22T08:00:00.000Z' };
    t.fakes.hotelCalls.length = 0;
    const done = await post(cookies, '/api/onboarding/finish', {
      agents: ['channels', 'manager'],
      autonomy: 3,
    });
    expect(done.statusCode).toBe(200);
    expect(done.json()).toEqual({ ok: true, redirect: '/agents' });
    expect(hotelCalls('POST', '/settings').map((c) => c.body)).toEqual([
      {
        changes: [
          { op: 'agent', agent: 'channels', enabled: true },
          { op: 'agent', agent: 'manager', enabled: true },
          { op: 'autonomy', level: 3 },
        ],
      },
    ]);
    expect(hotelCalls('POST', '/study').map((c) => c.body)).toEqual([{ on: true }]);
    expect((await sessionUser(t, cookies)).onboardedAt).not.toBeNull();

    // From now on the site opens the agents: the study is on top, every tab says so.
    expect((await t.app.inject({ url: '/', cookies })).headers.location).toBe('/agents');
    const agents = (await t.app.inject({ url: '/agents', cookies })).body;
    expect(agents).toContain('Агенты изучают ваши кабинеты');
    expect(agents).toContain('Ничего не меняют');
    expect(agents).toContain('data-study-poll=');
    expect(agents).toContain('<b>Островок</b><span class="hint">изучает</span>');
    expect(agents).toContain('data-act="study-end"');
    expect(agents).toContain('уровню автономности 4 «Полная автономность»');
    // The setup can be opened again; it no longer starts anything.
    const again = (await t.app.inject({ url: '/start?step=4', cookies })).body;
    expect(again).toContain('Настройка пройдена');
    expect(again).not.toContain('Запустить изучение');
  });

  it('the study through the agents page: polled by the session, ended by the owner', async () => {
    t = await startApp();
    const cookies = await signIn(t);
    t.fakes.hotel.settings = {
      ...t.fakes.hotel.settings,
      study: { since: '2026-10-22T09:00:00.000Z' },
    } as never;
    t.fakes.study = {
      on: true,
      since: '2026-10-22T09:00:00.000Z',
      targets: [
        { system: 'bnovo', title: 'Bnovo' },
        { system: 'ostrovok', title: 'Островок' },
      ],
      items: [
        {
          system: 'bnovo',
          title: 'Bnovo',
          status: 'waiting_user',
          outcome: null,
          taskId: 't1',
          startedAt: '2026-10-22T09:00:00.000Z',
        },
        {
          system: 'ostrovok',
          title: 'Островок',
          status: 'done',
          outcome: 'выполнено',
          taskId: 't2',
          startedAt: '2026-10-22T09:00:00.000Z',
        },
      ],
    };
    const agents = (await t.app.inject({ url: '/agents?tab=team', cookies })).body;
    expect(agents).toContain('class="status status--study" href="#study-title"');
    expect(agents).toContain('Изучено 1 из 2');
    expect(agents).toContain('войдите в кабинет в окне агента');
    expect((await t.app.inject({ url: '/api/agents/study', cookies })).json()).toMatchObject({
      on: true,
    });
    const forged = await t.app.inject({
      method: 'POST',
      url: '/api/agents/study',
      cookies,
      headers: { origin: 'https://evil.test' },
      payload: { on: false },
    });
    expect(forged.statusCode).toBe(403);
    const end = await post(cookies, '/api/agents/study', { on: false });
    expect(end.statusCode).toBe(200);
    expect(end.json().on).toBe(false);
    // An older Goldfish without the study: the page goes without the card.
    t.fakes.study = null;
    expect((await t.app.inject({ url: '/agents', cookies })).body).not.toContain(
      'id="study-title"',
    );
  });

  it('changes come from the site’s pages of a signed-in owner only', async () => {
    t = await startApp();
    for (const url of ['/api/onboarding/listings', '/api/onboarding/crm', '/api/onboarding/finish'])
      expect((await t.app.inject({ method: 'POST', url, headers: origin })).statusCode).toBe(401);
    const cookies = await signIn(t);
    for (const url of ['/api/onboarding/listings', '/api/onboarding/crm', '/api/onboarding/finish'])
      expect(
        (
          await t.app.inject({
            method: 'POST',
            url,
            cookies,
            headers: { origin: 'https://evil.test' },
            payload: {},
          })
        ).statusCode,
      ).toBe(403);
    expect(t.fakes.hotelCalls.filter((c) => c.method !== 'GET')).toEqual([]);
    expect((await t.app.inject({ url: '/start' })).headers.location).toBe('/auth/yandex');
  });

  it('when Goldfish is down the first step still shows how to install', async () => {
    t = await startApp();
    const cookies = await signIn(t);
    t.fakes.goldfishDown = true;
    const one = await t.app.inject({ url: '/start?step=1', cookies });
    expect(one.statusCode).toBe(200);
    expect(one.body).toContain('Скачать расширение');
    const two = await t.app.inject({ url: '/start?step=2', cookies });
    expect(two.body).toContain('Сервер агентов сейчас недоступен');
    const save = await post(cookies, '/api/onboarding/crm', {
      system: 'bnovo',
      url: 'https://online.bnovo.ru/',
    });
    expect(save.statusCode).toBe(502);
  });
});
