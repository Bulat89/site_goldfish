import { pino } from 'pino';
import { afterEach, describe, expect, it } from 'vitest';
import {
  COMPETITORS_READY,
  IMPORT_READY,
  LISTINGS_READY,
  PUBLIC_URL,
  signIn,
  startApp,
  type TestApp,
} from './helpers.js';

const origin = { origin: PUBLIC_URL };

let t: TestApp;
afterEach(async () => {
  await t?.app.close();
});

describe('the reference from a card; the team folded', () => {
  it('duties of every agent are folded by default; the state of the agent stays visible', async () => {
    t = await startApp();
    const cookies = await signIn(t);
    const html = (await t.app.inject({ url: '/cabinet/agents', cookies })).body;
    expect(html).toContain('<details class="agent__more" data-fold="agent:channels">');
    expect(html).not.toMatch(/class="agent__more"[^>]*\sopen/);
    expect(html).toMatch(/работает · \d+ из \d+ обязанност/);
    expect(html).toContain('data-fold-all="agent:"');
    // The landing folds what each agent does as well.
    const landing = (await t.app.inject({ url: '/' })).body;
    expect(landing).toContain('<details class="feature__more">');
    expect(landing).not.toMatch(/class="feature__more"[^>]*\sopen/);
  });

  it('offers a link or the text of a card; a ready draft lists fields with checkboxes', async () => {
    t = await startApp();
    const cookies = await signIn(t);
    let html = (await t.app.inject({ url: '/cabinet/property', cookies })).body;
    expect(html).toContain('Заполнить из карточки');
    expect(html).toContain('data-form="import-url"');
    expect(html).toContain('data-form="import-text"');
    expect(html).toContain('<details class="profile__manual" open>');

    t.fakes.profileImport = { ...IMPORT_READY, status: 'reading', fields: [] };
    html = (await t.app.inject({ url: '/cabinet/property', cookies })).body;
    expect(html).toContain('data-import-poll="imp_1"');
    expect(html).toContain('Агент читает карточку на Авито');

    t.fakes.profileImport = IMPORT_READY;
    html = (await t.app.inject({ url: '/cabinet/property', cookies })).body;
    expect(html).toContain('Черновик из карточки на Авито: найдено 2');
    expect(html).toContain('<input type="checkbox" name="field" value="rooms" checked');
    expect(html).toContain('Дом у моря &#60;b&#62;');
    expect(html).not.toContain('Дом у моря <b>');
    expect(html).toContain('<details class="profile__manual">');
    expect(html).not.toContain('прочитана не полностью');

    // The reading stopped at a limit: the draft of what was read says so.
    t.fakes.profileImport = { ...IMPORT_READY, partial: 'достигнут лимит шагов (60)' };
    html = (await t.app.inject({ url: '/cabinet/property', cookies })).body;
    expect(html).toContain(
      'Карточка прочитана не полностью (достигнут лимит шагов (60)) — части полей может не быть.',
    );
  });

  it('forwards the import calls for the signed-in owner; the poll needs only the session', async () => {
    t = await startApp();
    const cookies = await signIn(t);
    const start = await t.app.inject({
      method: 'POST',
      url: '/api/agents/profile/import',
      cookies,
      payload: { url: 'https://www.avito.ru/sochi/doma/dom_1' },
      headers: origin,
    });
    expect(start.statusCode).toBe(201);
    expect(t.fakes.hotelCalls.at(-1)).toEqual({
      method: 'POST',
      path: 'yandex:1000001 /profile/import',
      body: { url: 'https://www.avito.ru/sochi/doma/dom_1' },
    });
    const empty = await t.app.inject({
      method: 'POST',
      url: '/api/agents/profile/import',
      cookies,
      payload: {},
      headers: origin,
    });
    expect(empty.statusCode).toBe(400);
    expect(empty.json().message).toBe('пришлите ссылку на карточку или её текст');

    const poll = await t.app.inject({ url: '/api/agents/profile/import/imp_1', cookies });
    expect(poll.json().status).toBe('ready');
    expect((await t.app.inject({ url: '/api/agents/profile/import/imp_1' })).statusCode).toBe(401);

    const apply = await t.app.inject({
      method: 'POST',
      url: '/api/agents/profile/import/imp_1/apply',
      cookies,
      payload: { fields: ['name'] },
      headers: origin,
    });
    expect(apply.json().applied).toEqual(['Название']);
    const foreign = await t.app.inject({
      method: 'POST',
      url: '/api/agents/profile/import/imp_1/discard',
      cookies,
      payload: {},
      headers: { origin: 'https://evil.test' },
    });
    expect(foreign.statusCode).toBe(403);
  });
});

describe('the card is read while the Goldfish server restarts', () => {
  it('a poll that meets the restart is logged as info, out of the error journal', async () => {
    const lines: Array<{ level: number; msg: string }> = [];
    const log = pino({ level: 'info' }, { write: (line: string) => lines.push(JSON.parse(line)) });
    t = await startApp({}, undefined, log);
    const cookies = await signIn(t);
    t.fakes.goldfishRestarting = true;
    const poll = await t.app.inject({ url: '/api/agents/profile/import/imp_1', cookies });
    expect(poll.statusCode).toBe(502);
    const restart = lines.filter((l) => l.msg.startsWith('agents import:'));
    expect(restart.map((l) => [l.level, l.msg])).toEqual([
      [30, 'agents import: goldfish restarting, the page asks again'],
    ]);
    // The poll of a running search too.
    expect((await t.app.inject({ url: '/api/agents/listings', cookies })).statusCode).toBe(502);
    expect(lines.filter((l) => l.msg.startsWith('agents search:')).map((l) => l.level)).toEqual([
      30,
    ]);

    // A server that cannot be reached at all stays an error.
    t.fakes.goldfishRestarting = false;
    t.fakes.goldfishDown = true;
    await t.app.inject({ url: '/api/agents/profile/import/imp_1', cookies });
    expect(lines.filter((l) => l.level >= 50).map((l) => l.msg)).toEqual([
      'agents import: goldfish unavailable',
    ]);
  });

  it('every section says it restarts and reload themselves, out of the error journal', async () => {
    // 2026-10-14 16:38: a deploy of Goldfish gave the agents page «unavailable» and an error.
    const lines: Array<{ level: number; msg: string }> = [];
    const log = pino({ level: 'info' }, { write: (line: string) => lines.push(JSON.parse(line)) });
    t = await startApp({}, undefined, log);
    const cookies = await signIn(t);
    t.fakes.goldfishRestarting = true;
    for (const [url, msg] of [
      ['/cabinet', 'today page: goldfish restarting, the page reloads'],
      ['/cabinet/agents', 'agents page: goldfish restarting, the page reloads'],
      ['/cabinet/property', 'property page: goldfish restarting, the page reloads'],
      ['/cabinet/prices', 'prices page: goldfish restarting, the page reloads'],
      ['/cabinet/settings', 'settings page: goldfish restarting, the page reloads'],
    ] as const) {
      const res = await t.app.inject({ url, cookies });
      expect(res.statusCode).toBe(200);
      expect(res.headers.refresh).toBe('15');
      expect(res.body).toContain('Сервер агентов перезапускается — страница обновится сама');
      expect(lines.filter((l) => l.msg === msg).map((l) => l.level)).toEqual([30]);
    }
    expect(lines.filter((l) => l.level >= 50)).toEqual([]);

    // A server that cannot be reached at all stays an error, and the page does not reload.
    t.fakes.goldfishRestarting = false;
    t.fakes.goldfishDown = true;
    const down = await t.app.inject({ url: '/cabinet/agents', cookies });
    expect(down.headers.refresh).toBeUndefined();
    expect(down.body).toContain('Сервер агентов сейчас недоступен');
    expect(lines.filter((l) => l.level >= 50).map((l) => l.msg)).toEqual([
      'agents page: goldfish unavailable',
    ]);
  });
});

describe('listings on the platforms and competitors', () => {
  it('offers both searches, then shows the listings with «моё» and the candidates with answers', async () => {
    t = await startApp();
    const cookies = await signIn(t);
    let html = (await t.app.inject({ url: '/cabinet/property', cookies })).body;
    expect(html).toContain('data-act="listings-start"');
    expect(html).toContain('data-act="competitors-start"');
    expect(html).toContain('Поиск начнётся только по кнопке');

    // While the search runs, what each platform found is shown at once and can be marked.
    const [ostrovok, yandex, avito, hotels101] = LISTINGS_READY.platforms;
    t.fakes.listings = {
      ...LISTINGS_READY,
      status: 'searching',
      platforms: [
        ostrovok,
        { ...yandex, status: 'searching', recheck: true },
        { ...avito, status: 'searching' },
        hotels101,
      ],
    };
    t.fakes.competitorSearch = {
      ...COMPETITORS_READY,
      status: 'searching',
      platforms: [
        ...COMPETITORS_READY.platforms,
        {
          platform: 'yandex_travel',
          title: 'Яндекс Путешествия',
          status: 'searching',
          found: 0,
          error: null,
        },
      ],
    };
    html = (await t.app.inject({ url: '/cabinet/property', cookies })).body;
    expect(html).toContain('data-poll-url="/api/agents/listings"');
    expect(html).toContain('data-poll-url="/api/agents/competitors"');
    // The page reloads when this changes (app.js computes the same from the poll).
    expect(html).toContain(
      `data-poll-state="${JSON.stringify([
        ['found', null],
        ['searching', null],
        ['searching', null],
        ['failed', null],
      ]).replaceAll('"', '&#34;')}"`,
    );
    expect(html).toContain('готово 2 из 4 площадок');
    expect(html).toContain(
      'data-act="listing-verdict" data-id="lst_1" data-platform="ostrovok" data-mine="1"',
    );
    expect(html).toContain('не прочитано: капча');
    // A search again: what was found is read again by its link.
    expect(html).toContain('читает по ссылке…');
    expect(html).toContain('ищет…');
    expect(html).not.toContain('data-act="listings-start"');
    // Candidates found so far are shown; the owner answers once every platform is read.
    expect(html).toContain('Островок — найдено 2; Яндекс Путешествия — ищет…');
    expect(html).toContain('Пока найдено 2, самые похожие:');
    expect(html).toContain('Вилла Роза');
    expect(html).not.toContain('data-act="competitor-verdict"');

    t.fakes.listings = LISTINGS_READY;
    t.fakes.competitorSearch = COMPETITORS_READY;
    html = (await t.app.inject({ url: '/cabinet/property', cookies })).body;
    expect(html).toContain(
      'data-act="listing-verdict" data-id="lst_1" data-platform="ostrovok" data-mine="1"',
    );
    expect(html).toContain('Нашёл — похоже на ваше:');
    expect(html).toContain('название совпадает, адрес совпадает');
    expect(html).toContain('✓ подключена');
    expect(html).toContain('data-act="listing-publish" data-id="lst_1" data-platform="avito"');
    expect(html).toContain('не прочитано: капча');
    expect(html).toContain('data-act="listings-sync"');
    expect(html).toContain(
      '<a href="https://ostrovok.ru/hotel/villa" target="_blank" rel="noopener">Вилла Роза</a>',
    );
    // A link that is not http(s) is shown as text; names are escaped.
    expect(html).not.toContain('javascript:alert');
    expect(html).toContain('Гранд &#60;Отель&#62;');
    expect(html).toContain('data-verdict="not" aria-pressed="true"');
  });

  it('the owner types a listing’s address in its row, with or without a search before', async () => {
    t = await startApp();
    const cookies = await signIn(t);
    // No search yet: every platform for guests has its field, next to «Найти объявления».
    let html = (await t.app.inject({ url: '/cabinet/property', cookies })).body;
    for (const platform of ['ostrovok', 'yandex_travel', 'avito', '101hotels', 'yandex_maps'])
      expect(html).toContain(`name="listing" data-platform="${platform}"`);
    expect(html).toContain('data-act="listings-start">Найти объявления</button>');
    // One way to enter an address: no form of its own, no «внести ссылку» buttons.
    expect(html).not.toContain('data-form="listing-manual"');
    expect(html).not.toContain('listing-manual-pick');

    // A record made by an address typed by hand: the table says what is known about each row.
    const [ostrovok, yandex, avito, hotels101] = LISTINGS_READY.platforms;
    t.fakes.hotel.profile.systems = [
      { id: 'yandex_travel', listingUrl: 'https://travel.yandex.ru/hotels/x' },
      { id: '101hotels', listingUrl: 'https://101hotels.com/x' },
    ];
    t.fakes.listings = {
      ...LISTINGS_READY,
      platforms: [
        { ...ostrovok, status: 'not_searched', url: null, listingTitle: null, verdict: null },
        { ...yandex, status: 'found', verdict: 'mine', manual: true, why: 'внесено вручную' },
        { ...avito, status: 'not_found' },
        { ...hotels101, status: 'found', verdict: 'mine', error: 'не удалось перечитать: капча' },
      ],
    };
    html = (await t.app.inject({ url: '/cabinet/property', cookies })).body;
    expect(html).toContain('value="https://travel.yandex.ru/hotels/x"');
    expect(html).toContain('внесено вручную');
    expect(html).toContain('не удалось перечитать: капча');
    expect(html).toContain('объявления нет');
    expect(html).toContain('data-act="listing-publish" data-id="lst_1" data-platform="avito"');
    expect(html).toContain('data-act="listings-start">Обновить поиск</button>');
    expect(html).toContain('data-act="listings-sync"');

    // The address of one listing is no longer sent on its own: the table is saved as a whole.
    const alone = await t.app.inject({
      method: 'POST',
      url: '/api/agents/listings/manual',
      cookies,
      headers: origin,
      payload: { platform: 'avito', url: 'https://www.avito.ru/sochi/doma/dom_123' },
    });
    expect(alone.statusCode).toBe(404);
  });

  it('forwards the owner’s answers and polls only with the session', async () => {
    t = await startApp();
    const cookies = await signIn(t);
    const mine = await t.app.inject({
      method: 'POST',
      url: '/api/agents/listings/lst_1/ostrovok',
      cookies,
      headers: origin,
      payload: { mine: true },
    });
    expect(mine.json()).toMatchObject({ id: 'lst_1', mine: true });
    const verdict = await t.app.inject({
      method: 'POST',
      url: '/api/agents/competitors/candidates/cmp_1',
      cookies,
      headers: origin,
      payload: { verdict: 'direct' },
    });
    expect(verdict.json()).toMatchObject({
      verdict: 'direct',
      competitors: [{ name: 'Вилла Роза' }],
    });
    // Changes need this site's origin; a poll needs only the session.
    expect(
      (await t.app.inject({ method: 'POST', url: '/api/agents/listings', cookies })).statusCode,
    ).toBe(403);
    t.fakes.listings = LISTINGS_READY;
    expect((await t.app.inject({ url: '/api/agents/listings', cookies })).json()).toMatchObject({
      status: 'ready',
    });
    expect((await t.app.inject({ url: '/api/agents/listings' })).statusCode).toBe(401);
  });
});
