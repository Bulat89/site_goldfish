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
const APPROVAL = {
  agent: 'channels',
  title: 'Срочно: овербукинг',
  reason: 'Люкс продан дважды',
  cost: null,
  action: { kind: 'none' },
  createdAt: '2026-10-08T07:00:00.000Z',
};
const SECTIONS = [
  ['/cabinet', 'Сегодня'],
  ['/cabinet/agents', 'Агенты'],
  ['/cabinet/property', 'Объект'],
  ['/cabinet/prices', 'Цены'],
  ['/cabinet/settings', 'Настройки'],
] as const;

let t: TestApp;
afterEach(async () => {
  await t?.app.close();
});

const post = (cookies: Record<string, string>, url: string, payload: unknown) =>
  t.app.inject({ method: 'POST', url, cookies, headers: origin, payload: payload as object });
const hotelCalls = (method: string, sub: string) =>
  t.fakes.hotelCalls.filter((c) => c.method === method && c.path === `${SITE_USER} ${sub}`);
/** The extension has connected at least once. */
const connect = () =>
  (t.fakes.extension = { online: true, lastBrowserSeenAt: '2026-10-22T08:00:00.000Z' });

describe('the personal cabinet', () => {
  it('is the one place of the owner: every section is a page with the same top and the tabs', async () => {
    t = await startApp();
    expect((await t.app.inject('/')).body).toContain('Войти с Яндекс ID');
    const cookies = await signIn(t);
    // The way in: from the front door and from the header.
    const home = await t.app.inject({ url: '/', cookies });
    expect(home.statusCode).toBe(302);
    expect(home.headers.location).toBe('/cabinet');
    for (const [path, title] of SECTIONS) {
      const res = await t.app.inject({ url: path, cookies });
      expect(res.statusCode, path).toBe(200);
      expect(res.headers['cache-control']).toContain('no-store');
      const html = res.body;
      expect(html).toContain(`<title>${title} — личный кабинет — Goldfish</title>`);
      expect(html).toContain('<p class="eyebrow">Личный кабинет</p>');
      expect(html).toContain('<h1>Дом у моря</h1>');
      // The bar: five tabs, the current one marked, each a real page.
      const tabs = [...html.matchAll(/<a class="tabs__tab" href="([^"]+)"([^>]*)>/g)];
      expect(tabs.map((m) => m[1])).toEqual(SECTIONS.map(([p]) => p));
      expect(tabs.filter((m) => m[2]!.includes('aria-current="page"')).map((m) => m[1])).toEqual([
        path,
      ]);
      // The header: the cabinet and the guide; the earlier «Настройка» and «Агенты» are gone.
      expect(html).toContain('<a href="/cabinet"');
      expect(html).toContain('href="/help"');
      expect(html).not.toContain('href="/start');
      expect(html).not.toContain('href="/agents');
      // The server's address is only where webhooks are made: for the systems that call it.
      expect(html.replace('data-base="https://agent.test"', '')).not.toContain('agent.test');
      // The earlier site's tabs, status line and panels are not here.
      expect(html).not.toContain('class="statuses"');
      expect(html).not.toContain('data-panel=');
    }
    expect((await t.app.inject({ url: '/cabinet', cookies })).body).toContain(
      'avatars.yandex.net/get-yapic/131652443%2Fabc-123/islands-68',
    );
  });

  it('needs a session and access: a guest is sent to sign in', async () => {
    t = await startApp();
    for (const [path] of SECTIONS) {
      const res = await t.app.inject(path);
      expect(res.statusCode, path).toBe(302);
      expect(res.headers.location).toBe('/auth/yandex');
    }
  });

  it('the addresses of the earlier site lead into the cabinet', async () => {
    t = await startApp();
    const go = async (url: string) => (await t.app.inject(url)).headers.location;
    expect(await go('/start')).toBe('/cabinet');
    expect(await go('/start?step=1')).toBe('/cabinet/settings#extension-title');
    expect(await go('/start?step=2')).toBe('/cabinet/property#listings-title');
    expect(await go('/start?step=3')).toBe('/cabinet/settings#crm-title');
    expect(await go('/start?step=4')).toBe('/cabinet');
    expect(await go('/start?step=9')).toBe('/cabinet');
    expect(await go('/agents')).toBe('/cabinet');
    expect(await go('/agents?tab=today')).toBe('/cabinet');
    expect(await go('/agents?tab=team')).toBe('/cabinet/agents');
    expect(await go('/agents?tab=property')).toBe('/cabinet/property');
    expect(await go('/agents?tab=settings')).toBe('/cabinet/settings');
    expect(await go('/agents?tab=nope')).toBe('/cabinet');
    expect(await go('/agents/prices')).toBe('/cabinet/prices');
  });

  it('counts the decisions waiting on the first tab of every section, red when one is urgent', async () => {
    t = await startApp();
    const cookies = await signIn(t);
    const count = async (path: string) =>
      /data-tab="today"[^>]*>Сегодня( <span class="tabs__count[^"]*"[^>]*>(\d+)<\/span>)?/.exec(
        (await t.app.inject({ url: path, cookies })).body,
      )![2];
    for (const [path] of SECTIONS) expect(await count(path), path).toBe('1');
    t.fakes.approvals = [{ ...t.fakes.approvals[0]!, id: 'apr_2', urgent: true } as never];
    expect((await t.app.inject({ url: '/cabinet/agents', cookies })).body).toContain(
      'tabs__count tabs__count--urgent',
    );
    t.fakes.approvals = [];
    for (const [path] of SECTIONS) expect(await count(path), path).toBeUndefined();
    // An older Goldfish without the desk: counted from the list of approvals.
    t.fakes.deskSupported = false;
    expect(await count('/cabinet/property')).toBeUndefined();
    t.fakes.approvals = [{ ...APPROVAL, id: 'apr_5', urgent: false } as never];
    expect(await count('/cabinet/property')).toBe('1');
    expect(await count('/cabinet')).toBe('1');
  });

  it('says in every section when the agents only study, and when they are on pause', async () => {
    t = await startApp();
    const cookies = await signIn(t);
    t.fakes.hotel.settings = {
      ...t.fakes.hotel.settings,
      study: { since: '2026-10-22T09:00:00.000Z' },
      pause: { until: '2026-11-20', reason: 'ремонт' },
    } as never;
    const study = 'Идёт изучение: агенты только читают и ничего не меняют.';
    const pause = 'На паузе до 20.11.2026 · ремонт: агенты ничего не меняют';
    const settings = (await t.app.inject({ url: '/cabinet/settings', cookies })).body;
    expect(settings).toContain(study);
    expect(settings).toContain(pause);
    expect(settings).toContain('href="/cabinet#study-title"');
    expect(settings).toContain('href="/cabinet/agents#launch-title"');
    // Where the full card or block of it is, there is no line.
    expect((await t.app.inject({ url: '/cabinet', cookies })).body).not.toContain(study);
    expect((await t.app.inject({ url: '/cabinet/agents', cookies })).body).not.toContain(pause);
    // Neither is said when nothing is on.
    t.fakes.hotel.settings = { ...t.fakes.hotel.settings, study: null, pause: null } as never;
    const quiet = (await t.app.inject({ url: '/cabinet/prices', cookies })).body;
    expect(quiet).not.toContain('Идёт изучение');
    expect(quiet).not.toContain('На паузе');
  });

  it('when Goldfish is down every section says so; the settings still show how to install', async () => {
    t = await startApp();
    const cookies = await signIn(t);
    t.fakes.goldfishDown = true;
    for (const [path] of SECTIONS) {
      const res = await t.app.inject({ url: path, cookies });
      expect(res.statusCode, path).toBe(200);
      expect(res.body).toContain('Сервер агентов сейчас недоступен');
      expect(res.body).toContain('<h1>Ваш объект</h1>');
    }
    const settings = (await t.app.inject({ url: '/cabinet/settings', cookies })).body;
    expect(settings).toContain('Скачать расширение');
    expect(settings).toContain('id="issue-key"');
    expect(settings).toContain('Аккаунт');
    // What needs the property waits for it.
    expect(settings).not.toContain('Кабинет вашей CRM');
  });

  it('while Goldfish restarts the sections reload themselves, out of the error journal', async () => {
    t = await startApp();
    const cookies = await signIn(t);
    t.fakes.goldfishRestarting = true;
    for (const [path] of SECTIONS) {
      const res = await t.app.inject({ url: path, cookies });
      expect(res.statusCode, path).toBe(200);
      expect(res.headers.refresh, path).toBe('15');
      expect(res.body).toContain('Сервер агентов перезапускается — страница обновится сама');
    }
  });
});

describe('first steps', () => {
  /** A new owner: nothing is given yet. */
  const fresh = () => {
    t.fakes.hotel.profile = { name: '', rooms: [], systems: [] } as never;
    t.fakes.hotel.settings.agents.forEach((a) => (a.enabled = false));
    t.fakes.approvals = [];
  };

  it('is the one list of the setup: the extension, the reference, the CRM, a messenger, the launch', async () => {
    t = await startApp();
    const cookies = await signIn(t);
    fresh();
    const html = (await t.app.inject({ url: '/cabinet', cookies })).body;
    expect(html).toContain('Первые шаги · осталось 5 из 5');
    const steps = [...html.matchAll(/<li class="checklist__todo[^"]*"[\s\S]*?<\/li>/g)].map(
      (m) => m[0],
    );
    expect(steps).toHaveLength(5);
    // Each step leads to the place where it is done; the first one left is the main button.
    expect(steps[0]).toContain('Установите расширение Goldfish');
    expect(steps[0]).toContain(
      'class="btn btn--accent btn--sm" href="/cabinet/settings#extension-title"',
    );
    expect(steps[1]).toContain('href="/cabinet/property#profile-title"');
    expect(steps[1]).toContain('btn--ghost');
    expect(steps[2]).toContain('href="/cabinet/settings#crm-title"');
    expect(steps[3]).toContain('Привяжите Telegram');
    expect(steps[3]).toContain('href="/cabinet/settings#telegram-title"');
    // The launch waits for the extension, and says why; it says what will be set for a start.
    expect(steps[4]).toContain('data-act="launch" disabled');
    expect(steps[4]).toContain('Сначала подключите расширение.');
    expect(steps[4]).toContain('Для начала поставим уровень автономности 3');
    // Nothing else yet: no decisions, numbers or messages to show.
    expect(html).not.toContain('Ждут решения');
    // No wizard, no guide links on every step.
    expect(html).not.toContain('/help#');
    expect(html).not.toContain('/start');
  });

  it('steps are ticked as the owner goes; the launch opens when there is something to read', async () => {
    t = await startApp({ BOTS_URL, BOTS_API_TOKEN: BOTS_TOKEN });
    const cookies = await signIn(t);
    fresh();
    connect();
    let html = (await t.app.inject({ url: '/cabinet', cookies })).body;
    expect(html).toContain('Первые шаги · осталось 4 из 5');
    expect(html).toContain('Расширение подключено');
    expect(html).toContain('Привяжите мессенджер');
    // The extension is there, but there is nothing to study yet.
    expect(html).toContain('Изучать пока нечего: внесите ссылку на объявление или кабинет CRM.');
    expect(html).toMatch(/data-act="launch" disabled/);

    t.fakes.hotel.profile = {
      name: 'Дом у моря',
      rooms: [{ id: 'std', name: 'Стандарт', count: 2 }],
      systems: [{ id: 'bnovo', url: 'https://online.bnovo.ru/dashboard' }],
    } as never;
    t.fakes.botLinks.push({
      owner: 'cl_1/yandex:1000001',
      channel: 'telegram',
      title: 'Telegram',
      chatId: '501',
      name: 'Иван',
      linkedAt: '2026-10-16T10:00:00.000Z',
    });
    t.fakes.botCalls.length = 0;
    html = (await t.app.inject({ url: '/cabinet', cookies })).body;
    expect(html).toContain('Первые шаги · осталось 1 из 5');
    for (const done of [
      'Расширение подключено',
      'Эталон заполнен',
      'Кабинет CRM: Bnovo',
      'Мессенджер привязан',
    ])
      expect(html).toContain(done);
    expect(html).toMatch(/data-act="launch"(?! disabled)/);
    expect(html).toContain('class="btn btn--accent btn--sm" type="button" data-act="launch"');
    // The page only asks which chats are linked: the codes are made where the QR codes are shown.
    expect(t.fakes.botCalls).toEqual([`GET ${'cl_1/yandex:1000001'}`]);
  });

  it('launch: the study first, then the team and the level to start with; the setup is over', async () => {
    t = await startApp();
    const cookies = await signIn(t);
    fresh();
    t.fakes.hotel.profile.systems = [{ id: 'ostrovok', listingUrl: OSTROVOK }];
    expect((await post(cookies, '/api/agents/launch', {})).statusCode).toBe(400);
    // Without the extension the server does not start the study: nothing is switched on.
    const early = await post(cookies, '/api/agents/launch', {});
    expect(early.statusCode).toBe(400);
    expect(early.json().message).toContain('расширение');
    expect((await sessionUser(t, cookies)).onboardedAt).toBeNull();
    expect(hotelCalls('POST', '/settings')).toEqual([]);

    connect();
    t.fakes.hotelCalls.length = 0;
    const done = await post(cookies, '/api/agents/launch', {});
    expect(done.statusCode).toBe(200);
    expect(done.json()).toEqual({ ok: true, redirect: '/cabinet' });
    expect(hotelCalls('POST', '/study').map((c) => c.body)).toEqual([{ on: true }]);
    // A team that was never on starts whole; the default level 4 gives way to the one to start with.
    expect(hotelCalls('POST', '/settings').map((c) => c.body)).toEqual([
      {
        changes: [
          { op: 'agent', agent: 'channels', enabled: true },
          { op: 'agent', agent: 'manager', enabled: true },
          { op: 'autonomy', level: 3 },
        ],
      },
    ]);
    expect((await sessionUser(t, cookies)).onboardedAt).not.toBeNull();

    // The study is on top of «Сегодня»; the list of steps is gone with nothing left in it.
    const today = (await t.app.inject({ url: '/cabinet', cookies })).body;
    expect(today).toContain('Агенты изучают ваши кабинеты');
    expect(today).toContain('<b>Островок</b><span class="hint">изучает</span>');
    expect(today).toContain('data-act="study-end"');
    expect(today).toContain('Будут работать: Каналы продаж, Управляющий.');
    expect(today).toContain('уровню автономности 3 «Контролируемая автономность»');
    // Launched: the CRM nobody gave is not asked any more, the extension is taken as done.
    expect(today).not.toContain('Дайте ссылку на кабинет вашей CRM');
    expect(today).not.toContain('Установите расширение Goldfish');
  });

  it('launch keeps what the owner chose: agents already on, another level', async () => {
    t = await startApp();
    const cookies = await signIn(t);
    connect();
    t.fakes.hotel.profile.systems = [{ id: 'ostrovok', listingUrl: OSTROVOK }];
    t.fakes.hotel.settings.autonomy = 2;
    const done = await post(cookies, '/api/agents/launch', {});
    expect(done.statusCode).toBe(200);
    // Channels was already on, the level was chosen: nothing to change, only the study.
    expect(hotelCalls('POST', '/settings')).toEqual([]);
    expect(hotelCalls('POST', '/study')).toHaveLength(1);
    // An older Goldfish without «Изучение»: said, nothing is changed.
    t.fakes.study = null;
    t.fakes.hotelCalls.length = 0;
    const old = await post(cookies, '/api/agents/launch', {});
    expect(old.statusCode).toBe(400);
    expect(old.json().message).toContain('нужно обновить');
    expect(hotelCalls('POST', '/settings')).toEqual([]);
  });

  it('the study is polled by the session and ended or begun again by the owner', async () => {
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
    const today = (await t.app.inject({ url: '/cabinet', cookies })).body;
    expect(today).toContain('id="study-title"');
    expect(today).toContain('Изучено 1 из 2');
    expect(today).toContain('войдите в кабинет в окне агента');
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
    expect((await t.app.inject({ url: '/cabinet', cookies })).body).not.toContain(
      'id="study-title"',
    );
  });

  it('the setup is saved from the site’s pages of a signed-in owner only', async () => {
    t = await startApp();
    const urls = ['/api/agents/listings/links', '/api/agents/crm', '/api/agents/launch'];
    for (const url of urls)
      expect((await t.app.inject({ method: 'POST', url, headers: origin })).statusCode).toBe(401);
    const cookies = await signIn(t);
    for (const url of urls)
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
    // The routes of the wizard that was are gone.
    for (const url of ['/api/onboarding/listings', '/api/onboarding/crm', '/api/onboarding/finish'])
      expect((await post(await signIn(t), url, {})).statusCode).toBe(404);
  });
});

describe('settings', () => {
  it('the extension: how to install and the key while it has not connected; folded once it has', async () => {
    t = await startApp();
    const cookies = await signIn(t);
    let html = (await t.app.inject({ url: '/cabinet/settings', cookies })).body;
    expect(html).toContain('<h2 id="extension-title">Расширение для браузера</h2>');
    expect(html).toContain('href="/download"');
    expect(html).toContain('id="issue-key"');
    expect(html).toContain('Получить ключ подключения');
    expect(html).toContain('data-ext-poll');
    expect(html).toContain('<details class="ext-more" open>');
    expect(html).toContain('id="connect"');
    // The address goes inside the key, which is never in the page; only the webhooks know it.
    expect(html.replace('data-base="https://agent.test"', '')).not.toContain('agent.test');
    expect(html).not.toContain('gfk_');

    connect();
    html = (await t.app.inject({ url: '/cabinet/settings', cookies })).body;
    expect(html).toContain('Расширение подключено');
    expect(html).not.toContain('data-ext-poll');
    expect(html).toContain('<details class="ext-more">');
    expect(html).toContain('Установить на другом компьютере или выпустить новый ключ');
  });

  it('tells whether the extension connected (a read: the session is enough)', async () => {
    t = await startApp();
    expect((await t.app.inject({ url: '/api/extension' })).statusCode).toBe(401);
    const cookies = await signIn(t);
    const ask = async () => (await t.app.inject({ url: '/api/extension', cookies })).json();
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

  it('the CRM cabinet replaces another CRM; «Нет CRM» removes it', async () => {
    t = await startApp();
    const cookies = await signIn(t);
    const page = (await t.app.inject({ url: '/cabinet/settings', cookies })).body;
    expect(page).toContain('<h2 id="crm-title">Кабинет вашей CRM</h2>');
    expect(page).toContain('<option value="bnovo"');
    expect(page).toContain('<option value="sheet"');
    expect(page).toContain('<option value="none">Нет CRM');
    expect(page).toContain('data-form="crm"');

    const noUrl = await post(cookies, '/api/agents/crm', { system: 'bnovo', url: '' });
    expect(noUrl.statusCode).toBe(400);
    expect(noUrl.json().message).toContain('https://');
    const notCrm = await post(cookies, '/api/agents/crm', {
      system: 'avito',
      url: 'https://www.avito.ru/profile',
    });
    expect(notCrm.json().message).toBe('Такой CRM нет в списке');

    t.fakes.hotel.profile.systems = [
      { id: 'ostrovok' },
      { id: 'sheet', url: 'https://docs.google.com/x' },
    ];
    const ok = await post(cookies, '/api/agents/crm', {
      system: 'bnovo',
      url: 'https://online.bnovo.ru/dashboard',
    });
    expect(ok.statusCode).toBe(200);
    expect(t.fakes.hotel.profile.systems).toEqual([
      { id: 'ostrovok' },
      { id: 'bnovo', url: 'https://online.bnovo.ru/dashboard' },
    ]);
    const saved = (await t.app.inject({ url: '/cabinet/settings', cookies })).body;
    expect(saved).toContain(
      '<option value="bnovo" data-placeholder="https://online.bnovo.ru/…" selected>',
    );
    expect(saved).toContain('value="https://online.bnovo.ru/dashboard"');
    expect(saved).toContain('✓ Bnovo подключена');

    expect((await post(cookies, '/api/agents/crm', { system: 'none' })).statusCode).toBe(200);
    expect(t.fakes.hotel.profile.systems).toEqual([{ id: 'ostrovok' }]);
  });

  it('who is signed in and on what terms', async () => {
    t = await startApp();
    const cookies = await signIn(t);
    const html = (await t.app.inject({ url: '/cabinet/settings', cookies })).body;
    const facts = /<dl class="facts">([\s\S]*?)<\/dl>/.exec(html)![1]!;
    for (const [k, v] of [
      ['Имя', 'Иван Петров'],
      ['Яндекс ID', 'ivan.petrov'],
      ['Почта', 'ivan.petrov@yandex.ru'],
      ['Доступ', 'Ранний доступ'],
    ])
      expect(facts).toContain(`<dt>${k}</dt><dd>${v}</dd>`);
  });

  it('the manager’s summary, the quiet hours and the webhooks are here, in one place each', async () => {
    t = await startApp();
    const cookies = await signIn(t);
    const html = (await t.app.inject({ url: '/cabinet/settings', cookies })).body;
    expect(html).toContain('<h2 id="owner-title">Сводка и уведомления</h2>');
    expect(html).toContain('name="summaryTime"');
    expect(html).toContain('name="quietFrom"');
    expect(html).toContain('name="reviewAutoMinStars"');
    expect(html).toContain('<h2 id="hooks-title">Вебхуки объекта</h2>');
    expect(html).toContain('data-act="hook-token"');
    // What the agents may do on a platform is with the agents.
    expect(html).not.toContain('data-act="platform"');
  });
});

describe('listings: one table', () => {
  it('has a field for every platform for guests and every map; the CRM is not among them', async () => {
    t = await startApp();
    const cookies = await signIn(t);
    t.fakes.hotel.profile.systems = [{ id: 'avito', listingUrl: AVITO }];
    const page = (await t.app.inject({ url: '/cabinet/property', cookies })).body;
    expect(page).toContain('data-form="listings-save"');
    for (const platform of ['ostrovok', 'avito', 'yandex_maps'])
      expect(page).toContain(`name="listing" data-platform="${platform}"`);
    expect(page).not.toContain('name="listing" data-platform="bnovo"');
    expect(page).toContain(`value="${AVITO}"`);
    expect(page).toContain('✓ подключена');
    // The reference is empty: the known address offers to fill it; no radio, no manual form.
    t.fakes.hotel.profile.name = '';
    const empty = (await t.app.inject({ url: '/cabinet/property', cookies })).body;
    expect(empty).toContain(`data-act="import-from" data-url="${AVITO}"`);
    expect(empty).not.toContain('name="reference"');
    expect(empty).not.toContain('data-form="listing-manual"');
    const full = (await t.app.inject({ url: '/cabinet/property', cookies })).body;
    expect(full).toContain(`data-act="import-from" data-url="${AVITO}"`);
    t.fakes.hotel.profile.name = 'Дом у моря';
    expect((await t.app.inject({ url: '/cabinet/property', cookies })).body).not.toContain(
      'data-act="import-from"',
    );
  });

  it('registers each new address on its platform, takes a cleared one out, says what failed', async () => {
    t = await startApp();
    const cookies = await signIn(t);
    // A wrong address is refused with the platform's reason; what went through stays.
    const wrong = await post(cookies, '/api/agents/listings/links', {
      listings: [
        { platform: 'avito', url: AVITO },
        { platform: 'ostrovok', url: 'https://example.com/x' },
      ],
    });
    expect(wrong.statusCode).toBe(400);
    expect(wrong.json().message).toBe('Островок: это ссылка не на Островок');
    expect(hotelCalls('POST', '/listings/manual').map((c) => c.body)).toEqual([
      { platform: 'avito', url: AVITO },
      { platform: 'ostrovok', url: 'https://example.com/x' },
    ]);
    // The reference is the owner's to fill: saving links reads no listing.
    expect(hotelCalls('POST', '/profile/import')).toEqual([]);

    // Again: Avito is known — only Ostrovok goes.
    t.fakes.hotelCalls.length = 0;
    const ok = await post(cookies, '/api/agents/listings/links', {
      listings: [
        { platform: 'avito', url: AVITO },
        { platform: 'ostrovok', url: OSTROVOK },
      ],
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ ok: true });
    expect(hotelCalls('POST', '/listings/manual').map((c) => c.body)).toEqual([
      { platform: 'ostrovok', url: OSTROVOK },
    ]);

    // A cleared field: the listing leaves the reference, the system with nothing else too.
    t.fakes.hotelCalls.length = 0;
    const cleared = await post(cookies, '/api/agents/listings/links', {
      listings: [
        { platform: 'avito', url: AVITO },
        { platform: 'ostrovok', url: '' },
      ],
    });
    expect(cleared.statusCode).toBe(200);
    const put = hotelCalls('PUT', '/profile');
    expect(put).toHaveLength(1);
    expect((put[0]!.body as { systems: unknown[] }).systems).toEqual([
      { id: 'avito', listingUrl: AVITO },
    ]);

    // Bad input is refused before anything is sent.
    t.fakes.hotelCalls.length = 0;
    expect((await post(cookies, '/api/agents/listings/links', { listings: 'x' })).statusCode).toBe(
      400,
    );
    expect(t.fakes.hotelCalls).toEqual([]);
    // Goldfish is down: said, the session is kept.
    t.fakes.goldfishDown = true;
    const down = await post(cookies, '/api/agents/crm', {
      system: 'bnovo',
      url: 'https://online.bnovo.ru/',
    });
    expect(down.statusCode).toBe(502);
  });
});
