import { afterEach, describe, expect, it } from 'vitest';
import { ticks } from '../src/pages/prices.js';
import {
  COMPETITORS_READY,
  PRICE_BOARD,
  PUBLIC_URL,
  signIn,
  startApp,
  type TestApp,
} from './helpers.js';

let t: TestApp;
afterEach(async () => {
  await t?.app.close();
});

const origin = { origin: PUBLIC_URL };
const rub = (n: number) => `${n.toLocaleString('ru-RU')}\u00a0₽`;
/** The reference writes prices with a plain space. */
const plain = (n: number) => `${n.toLocaleString('ru-RU')} ₽`;

describe('«Цены»: the dashboard of the direct competitors’ prices', () => {
  it('shows the recommendation, the market, charts with their tables, the competitors and the proofs', async () => {
    t = await startApp();
    const cookies = await signIn(t);
    const res = await t.app.inject({ url: '/cabinet/prices', cookies });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('private, no-store');
    const html = res.body;
    // «Цены» is a section of the cabinet: the property, the tabs, the section marked.
    expect(html).toContain('<h1>Дом у моря</h1>');
    expect(html).toContain('<title>Цены — личный кабинет — Goldfish</title>');
    expect(html).toContain(
      '<a class="tabs__tab" href="/cabinet/prices" aria-current="page">Цены</a>',
    );
    // The headline: the median as the recommended price, the average next to it.
    expect(html).toContain(`<p class="price-hero__value">${rub(5900)}</p>`);
    expect(html).toContain('Рекомендованная цена «от» — медиана 3 прямых конкурентов');
    expect(html).toContain(
      `<span class="tile__label">Средняя</span><b class="tile__value">${rub(6167)}</b>`,
    );
    expect(html).toContain(`${rub(5550)} – ${rub(6650)}`);
    expect(html).toContain('−15% к медиане');
    // Accept per category.
    expect(html).toContain('data-form="prices-accept"');
    expect(html).toContain('name="room" value="lux" checked');
    expect(html).toContain(`<b>${rub(10600)}</b>`);
    // Charts: a bar per competitor with the median, the average and the owner's price across;
    // the market by night; every chart has its table.
    expect(html).toContain('Цена каждого прямого конкурента');
    expect(html.match(/class="viz__mark"/g)).toHaveLength(3);
    expect(html).toContain('class="viz__line--median" x1=');
    expect(html).toContain('Рынок по ночам');
    expect(html.match(/class="viz__col"/g)).toHaveLength(2);
    expect(html).toContain('17.10, сб');
    expect(html.match(/<summary>Таблица<\/summary>/g)).toHaveLength(2);
    // One read date: no history chart yet.
    expect(html).not.toContain('Как меняется рынок');
    // No inline styles: the CSP would drop them.
    expect(html).not.toMatch(/\sstyle="/);
    // Who chose each competitor and why.
    expect(html).toContain('<span class="by by--agent">агент</span> гостевой дом в 400 м');
    expect(html).toContain('<span class="by by--owner">вы</span>');
    expect(html).toContain('<span class="by by--manual">вручную в эталоне</span>');
    // Proofs: the quote word for word, escaped; links only http(s).
    expect(html).toContain(
      '<q>Стандарт · 5 600 ₽ за ночь &#60;script&#62;alert(1)&#60;/script&#62;</q>',
    );
    expect(html).toContain('href="https://ostrovok.ru/hotel/villa-roza/?dates=17.10"');
    expect(html).not.toContain('javascript:alert');
    expect(html).toContain('Дом &#60;Чайки&#62;');
    expect(html).toContain('цитаты нет');
    expect(html).toContain('data-proofs-filter');
    // Tooltips carry data, rendered as text by app.js.
    expect(html).toContain('data-tip="[&#34;Вилла Роза&#34;');
  });

  it('without competitors it says why and leads to the search', async () => {
    t = await startApp();
    const cookies = await signIn(t);
    t.fakes.prices = {
      ...PRICE_BOARD,
      basis: null,
      competitors: [],
      stats: null,
      recommendation: null,
      note: 'прямых конкурентов пока нет — запустите поиск конкурентов',
      byDay: [],
      history: [],
      proofs: [],
      search: null,
    };
    const html = (await t.app.inject({ url: '/cabinet/prices', cookies })).body;
    expect(html).toContain('Прямых конкурентов пока нет — запустите поиск конкурентов.');
    expect(html).toContain('href="/cabinet/property#competitors-title"');
    expect(html).not.toContain('class="viz"');
  });

  it('says when the server is unavailable, and needs a session', async () => {
    t = await startApp();
    expect((await t.app.inject({ url: '/cabinet/prices' })).headers.location).toBe('/auth/yandex');
    expect((await t.app.inject({ url: '/agents/prices' })).headers.location).toBe(
      '/cabinet/prices',
    );
    const cookies = await signIn(t);
    // An older Goldfish without «Цены».
    t.fakes.prices = null;
    expect((await t.app.inject({ url: '/cabinet/prices', cookies })).body).toContain(
      'Сервер агентов ещё не умеет считать цены конкурентов',
    );
    t.fakes.goldfishDown = true;
    const html = (await t.app.inject({ url: '/cabinet/prices', cookies })).body;
    expect(html).toContain('Сервер агентов сейчас недоступен');
  });

  it('forwards «принять» from this site’s pages only', async () => {
    t = await startApp();
    const cookies = await signIn(t);
    const ok = await t.app.inject({
      method: 'POST',
      url: '/api/agents/prices/accept',
      cookies,
      headers: origin,
      payload: { rooms: ['std'] },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().changed).toEqual(['«Стандарт»: 5 000 ₽ → 5 900 ₽']);
    expect(t.fakes.hotelCalls.at(-1)).toMatchObject({
      method: 'POST',
      path: expect.stringContaining('/prices/accept'),
      body: { rooms: ['std'] },
    });
    const refused = await t.app.inject({
      method: 'POST',
      url: '/api/agents/prices/accept',
      cookies,
      headers: origin,
      payload: { rooms: [] },
    });
    expect(refused.statusCode).toBe(400);
    expect(refused.json().message).toBe('менять нечего');
    expect(
      (
        await t.app.inject({
          method: 'POST',
          url: '/api/agents/prices/accept',
          cookies,
          payload: { rooms: ['std'] },
        })
      ).statusCode,
    ).toBe(403);
  });

  it('axis ticks are round numbers covering the range', () => {
    expect(ticks(4800, 7400)).toEqual([4000, 5000, 6000, 7000, 8000]);
    expect(ticks(4800, 6500)).toEqual([4500, 5000, 5500, 6000, 6500]);
    // One price only: a band around it.
    expect(ticks(5000, 5000)).toEqual([4500, 4750, 5000, 5250, 5500]);
  });
});

describe('competitors in «Объект»: decided by the agent', () => {
  it('shows each decision with its reason, the prices of the direct ones and the way to «Цены»', async () => {
    t = await startApp();
    const cookies = await signIn(t);
    t.fakes.competitorSearch = {
      ...COMPETITORS_READY,
      direct: 1,
      prices: { n: 1, mean: 5200, median: 5200, min: 5200, max: 5200 },
      candidates: [
        {
          ...COMPETITORS_READY.candidates[0],
          verdict: 'direct',
          verdictTitle: 'прямой конкурент',
          by: 'agent',
          agent: {
            verdict: 'direct',
            reason: 'гостевой дом рядом, цена как у вас',
            method: 'model',
          },
          description: 'Гостевой дом у моря',
          priceFrom: 5200,
        },
        {
          ...COMPETITORS_READY.candidates[1],
          by: 'owner',
          agent: { verdict: 'direct', reason: 'похож', method: 'model' },
          ownerReason: 'у них только дома целиком',
        },
      ],
    };
    const html = (await t.app.inject({ url: '/cabinet/property', cookies })).body;
    expect(html).toContain('агент отобрал прямых конкурентов: 1');
    expect(html).toContain(
      '<span class="by by--agent">агент: прямой конкурент</span> гостевой дом рядом, цена как у вас',
    );
    expect(html).toContain(
      '<span class="by by--owner">вы: не конкурент</span> у них только дома целиком <span class="muted">(агент считал: прямой)</span>',
    );
    expect(html).toContain(
      `Их цены «от»: средняя <b>${plain(5200)}</b>, медиана <b>${plain(5200)}</b>`,
    );
    expect(html).toContain('class="competitor competitor--direct"');
    expect(html).toContain('href="/cabinet/prices"');
    // The owner can still correct every decision.
    expect(html).toContain('data-act="competitor-verdict" data-id="cmp_1" data-verdict="not"');
  });
});
