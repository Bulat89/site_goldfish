import { afterEach, describe, expect, it } from 'vitest';
import { esc } from '../src/pages/page.js';
import { PUBLIC_URL, signIn, startApp, type TestApp } from './helpers.js';

const origin = { origin: PUBLIC_URL };

const APPROVAL = {
  agent: 'channels',
  title: 'Срочно: овербукинг',
  reason: 'Люкс продан дважды',
  cost: null,
  action: { kind: 'none' },
  createdAt: '2026-10-08T07:00:00.000Z',
};

let t: TestApp;
afterEach(async () => {
  await t?.app.close();
});

describe('«Сегодня»: what waits for the owner', () => {
  it('shows approvals, numbers and the manager’s messages from Goldfish, in one desk', async () => {
    t = await startApp();
    const cookies = await signIn(t);
    const res = await t.app.inject({ url: '/cabinet', cookies });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toContain('no-store');
    const html = res.body;
    expect(html).toContain('<h1>Дом у моря</h1>');
    // Approvals, text escaped.
    expect(html).toContain('Исправить расхождения на площадках: 2');
    expect(html).toContain('&#60;b&#62;расхождения&#60;/b&#62;');
    expect(html).not.toContain('<b>расхождения</b>');
    // Numbers computed by Goldfish.
    expect(html).toMatch(/5\s200 ₽/u);
    expect(html).toContain('4,7');
    expect(html).toContain('Доброе утро! Сегодня заездов — 1.');
    // One desk for the site, the extension and the bots.
    const user = t.fakes.hotelCalls.map((c) => c.path);
    expect(user).toEqual(expect.arrayContaining(['yandex:1000001 ', 'yandex:1000001 /manager']));
    expect(user).not.toContain('yandex:1000001 /kpi');
    expect(html).toContain('data-today data-rev="rev_1"');
    // The team and the rights are in «Агенты», not here.
    expect(html).not.toContain('data-duty="channels.fix"');
  });

  it('an older Goldfish without the desk: the page makes it of the separate answers', async () => {
    t = await startApp();
    t.fakes.deskSupported = false;
    const cookies = await signIn(t);
    const html = (await t.app.inject({ url: '/cabinet', cookies })).body;
    expect(html).toContain('Исправить расхождения на площадках: 2');
    expect(html).toContain('Каналы продаж · ');
    expect(html).toMatch(/5\s200 ₽/u);
    expect(html).toContain('☀️ Сводка');
    expect(t.fakes.hotelCalls.map((c) => c.path)).toEqual(
      expect.arrayContaining([
        'yandex:1000001 /manager',
        'yandex:1000001 /approvals?status=pending',
        'yandex:1000001 /kpi',
        'yandex:1000001 /feed?limit=20',
      ]),
    );
  });

  it('shows what was decided and where; asks for itself again while open', async () => {
    t = await startApp();
    const cookies = await signIn(t);
    t.fakes.decided = [
      {
        id: 'apr_0',
        agent: 'reputation',
        agentTitle: 'Репутация',
        title: 'Ответ на отзыв 5★',
        status: 'approved',
        outcome: 'Согласовано в Telegram',
        mark: '✅',
        place: 'telegram',
        comment: 'опубликовано',
        decidedAt: '2026-10-08T08:00:00.000Z',
      },
    ];
    let html = (await t.app.inject({ url: '/cabinet', cookies })).body;
    expect(html).toContain('<summary>Решено недавно</summary>');
    expect(html).toContain('Репутация · Согласовано в Telegram · ');
    // The card: who, why, the draft, three buttons, and when it expires.
    expect(html).toContain('data-approval="apr_1"');
    expect(html).toContain('<span class="approval__label">Почему:</span>');
    expect(html).toMatch(/data-act="reject"[^>]*>Отклонить<\/button>/);
    expect(html).toContain('class="approval__left"');

    // The approval was decided in a messenger: the live «Сегодня» has it no more.
    t.fakes.approvals = [];
    t.fakes.deskRev = 'rev_2';
    const live = await t.app.inject({ url: '/api/agents/today', cookies });
    expect(live.statusCode).toBe(200);
    expect(live.headers['cache-control']).toContain('no-store');
    const data = live.json();
    expect(data).toMatchObject({ rev: 'rev_2', pending: 0, count: '' });
    expect(data.today).toContain('Ничего не ждёт вашего решения');
    expect(data.today).not.toContain('data-approval="apr_1"');
    expect(Object.keys(data).sort()).toEqual(['count', 'pending', 'rev', 'today', 'urgent']);
    expect((await t.app.inject({ url: '/api/agents/today' })).statusCode).toBe(401);

    // An urgent one makes the count and the state red.
    t.fakes.approvals = [
      { ...t.fakes.approvals[0], ...APPROVAL, id: 'apr_2', urgent: true } as never,
    ];
    html = (await t.app.inject({ url: '/api/agents/today', cookies })).json().count;
    expect(html).toContain('tabs__count--urgent');
  });

  it('the desk waits until the agents are launched: nothing to decide, nothing to count', async () => {
    t = await startApp();
    const cookies = await signIn(t);
    t.fakes.hotel.settings.agents.forEach((a) => (a.enabled = false));
    t.fakes.approvals = [];
    const html = (await t.app.inject({ url: '/cabinet', cookies })).body;
    expect(html).toContain('Первые шаги');
    for (const empty of ['Ждут решения', 'Показатели', 'Сообщения управляющего'])
      expect(html).not.toContain(empty);
    // The live part is empty too, so the page keeps no empty cards.
    expect((await t.app.inject({ url: '/api/agents/today', cookies })).json().today).toBe('');
    // A decision that waits is never hidden, launched or not.
    t.fakes.approvals = [
      { ...APPROVAL, id: 'apr_3', urgent: false, createdAt: '2026-10-08T07:00:00.000Z' } as never,
    ];
    expect((await t.app.inject({ url: '/cabinet', cookies })).body).toContain(
      'data-approval="apr_3"',
    );
  });

  it('a decision on the site is marked as taken on the site', async () => {
    t = await startApp();
    const cookies = await signIn(t);
    const r = await t.app.inject({
      method: 'POST',
      url: '/api/agents/approvals/apr_1',
      cookies,
      payload: { decision: 'reject', via: 'telegram' },
      headers: origin,
    });
    expect(r.statusCode).toBe(200);
    expect(t.fakes.hotelCalls.at(-1)).toEqual({
      method: 'POST',
      path: 'yandex:1000001 /approvals/apr_1',
      body: { decision: 'reject', via: 'site' },
    });
  });

  it('hands a non-standard situation over with what happened, the consequences and a recommendation', async () => {
    t = await startApp();
    const cookies = await signIn(t);
    (t.fakes.approvals[0] as Record<string, unknown>).escalation = {
      what: 'Овербукинг «Люкс» на 22.10–23.10',
      consequences: 'Гость останется без номера',
      recommendation: 'Связаться с гостем',
      held: 'сообщения гостям Анна, Пётр',
    };
    const html = (await t.app.inject({ url: '/cabinet', cookies })).body;
    expect(html).toContain('<span class="approval__label">Что произошло:</span> Овербукинг');
    expect(html).toContain(
      '<span class="approval__label">Чем грозит:</span> Гость останется без номера',
    );
    expect(html).toContain(
      '<span class="approval__label">До вашего решения приостановлено:</span> сообщения гостям Анна, Пётр',
    );
    expect(html).not.toContain('<span class="approval__label">Почему:</span>');
  });
});

describe('«Агенты»: the team, the mode of work, the platforms', () => {
  it('shows the agents with switches, rights up to the duty’s ceiling and the platforms', async () => {
    t = await startApp();
    const cookies = await signIn(t);
    const res = await t.app.inject({ url: '/cabinet/agents', cookies });
    expect(res.statusCode).toBe(200);
    const html = res.body;
    // Team: agent switch, rights as buttons up to the duty's ceiling, always-on duties have none.
    expect(html).toContain('<h3 id="agent-channels-title">Каналы продаж</h3>');
    const level = (duty: string, l: string) =>
      new RegExp(`<button [^>]*data-duty="${duty}"[^>]*data-level="${l}"[^>]*>`).exec(html)![0];
    expect(level('channels.fix', 'approval')).toContain('aria-pressed="true"');
    expect(level('channels.fix', 'rule')).toContain('aria-pressed="false"');
    expect(level('channels.fix', 'rule')).not.toContain('disabled');
    expect(level('channels.fix', 'self')).toContain(' disabled');
    expect(level('channels.fix', 'self')).toContain('не выше «Правило»');
    expect(html).toContain('права не выше «Правило»');
    expect(html).not.toContain('data-duty="manager.approvals"');
    expect(html).toContain('Всегда работает');
    // Every duty but the always-on ones can be given now; one that is off asks for permission.
    expect(html).toContain(
      'data-act="run" data-duty="channels.sync" data-title="Сверка цен и наличия">Выполнить</button>',
    );
    expect(html).toContain('<dialog class="permission" data-permission');
    expect(html).toContain('Разрешить один раз');
    // The manager is off: its duties wait for the switch, their rights cannot be set.
    expect(html).toContain('<span class="badge">волна 2</span>');
    expect(level('manager.weekly', 'approval')).toContain(' disabled');
    expect(html).toContain('Агент выключен — обязанности не работают');
    // Platforms connected in the reference only; what is decided is on «Сегодня».
    expect(html).toContain('data-platform="ostrovok"');
    expect(html).not.toContain('data-platform="avito"');
    expect(html).not.toContain('data-approval=');
  });

  it('an agent is switched by a switch; a wave asks with what switches on', async () => {
    t = await startApp();
    const cookies = await signIn(t);
    let html = (await t.app.inject({ url: '/cabinet/agents', cookies })).body;
    const sw = (agent: string) =>
      new RegExp(`<button class="switch"[^>]*aria-labelledby="agent-${agent}-title"[^>]*>`).exec(
        html,
      )![0];
    expect(sw('channels')).toContain('role="switch" aria-checked="true"');
    expect(sw('channels')).toContain(
      esc(JSON.stringify([{ op: 'agent', agent: 'channels', enabled: false }])),
    );
    expect(sw('manager')).toContain('aria-checked="false"');
    expect(html).toContain('работает · 2 из 2 обязанности');
    expect(html).toContain('выключен · 2 обязанности не работают');
    // Levels of the working duties at a glance.
    expect(html).toMatch(/Сам — 1<\/span>.*Согласование — 1<\/span>/s);

    expect(html).toContain('<span class="chip chip--ok">сейчас</span>');
    const wave2 = /data-act="wave" data-wave="2" data-confirm="([^"]*)"/.exec(html)![1]!;
    expect(wave2).toContain('Перейти к волне 2 «Советуют»');
    expect(wave2).toContain('У включённых агентов новых обязанностей нет');

    // With the manager on, its duty of the next wave is named.
    const manager = t.fakes.hotel.settings.agents[1]!;
    manager.enabled = true;
    html = (await t.app.inject({ url: '/cabinet/agents', cookies })).body;
    expect(html).toContain('включится в волне 2');
    expect(/data-act="wave" data-wave="2" data-confirm="([^"]*)"/.exec(html)![1]).toContain(
      '• Управляющий: Недельный отчёт',
    );
  });

  it('a pause is set and lifted here', async () => {
    t = await startApp();
    const cookies = await signIn(t);
    t.fakes.hotel.settings.pause = { until: '2026-11-20', reason: 'ремонт' } as never;
    const html = (await t.app.inject({ url: '/cabinet/agents', cookies })).body;
    expect(html).toContain('<b>На паузе до 20.11.2026</b> · ремонт');
    expect(html).toContain(
      `data-changes="${esc(JSON.stringify([{ op: 'pause', until: null }]))}" data-done="Пауза снята — агенты снова работают.">Снять паузу</button>`,
    );
    // Here is the full block of it; the line about it is for the other sections.
    expect(html).not.toContain('notice--warn');
  });

  it('the autonomy of the manager: the four levels to choose, the current one explained', async () => {
    t = await startApp();
    const cookies = await signIn(t);
    const levels = t.fakes.hotel.settings.autonomyLevels;
    // An older Goldfish says nothing about autonomy: nothing is shown.
    Object.assign(t.fakes.hotel.settings, { autonomy: undefined, autonomyLevels: undefined });
    let html = (await t.app.inject({ url: '/cabinet/agents', cookies })).body;
    expect(html).not.toContain('autonomy-title');
    Object.assign(t.fakes.hotel.settings, { autonomy: 3, autonomyLevels: levels });
    html = (await t.app.inject({ url: '/cabinet/agents', cookies })).body;
    expect(html).toContain('<h3 id="autonomy-title">Уровень автономности управляющего</h3>');
    expect(html).toContain('<li>Правило уровня 3.</li>');
    expect(html).not.toContain('data-act="autonomy" data-level="3"');
    const choose =
      /data-act="autonomy" data-level="1" data-title="([^"]*)" data-confirm="([^"]*)"/.exec(html)!;
    expect(choose[1]).toBe('Ручное управление');
    expect(choose[2]).toContain('Уровень автономности 1 — «Ручное управление»?');
    expect(choose[2]).toContain('• Правило уровня 1.');
  });

  it('every agent’s duties are folded by default; the state of the agent stays visible', async () => {
    t = await startApp();
    const cookies = await signIn(t);
    const html = (await t.app.inject({ url: '/cabinet/agents', cookies })).body;
    expect(html).toContain('<details class="agent__more" data-fold="agent:channels">');
    expect(html).toContain('работает · 2 из 2 обязанности');
    expect(html).toContain('data-fold-all="agent:"');
  });
});

describe('«Объект»: the reference', () => {
  it('is edited in fields, not JSON; what is not shown is kept', async () => {
    t = await startApp();
    const cookies = await signIn(t);
    t.fakes.hotel.profile.systems = [
      { id: 'ostrovok', url: 'https://extranet.ostrovok.ru/', commissionPercent: 15 },
    ];
    const html = (await t.app.inject({ url: '/cabinet/property', cookies })).body;
    expect(html).not.toContain('class="code"');
    expect(html).not.toContain('(JSON)');
    // Rooms: a row per category keeps the whole item; an empty row to add.
    expect(html).toContain(
      `<div class="list-edit__row" data-item="${esc(JSON.stringify({ id: 'std', name: 'Стандарт', count: 2 }))}">`,
    );
    expect(html).toContain(
      '<input data-key="name" data-type="text" data-required type="text" value="Стандарт"',
    );
    expect(html).toContain('data-list="faq"');
    expect(html).toContain('data-list="upsells"');
    expect(html).toContain('data-list="competitors"');
    expect(html).toContain('+ Добавить категорию');
    // Systems: a checkbox each, connected ones ticked with their address and commission.
    expect(html).toMatch(
      /data-sys="ostrovok"[^>]*>\s*<label class="sys__check"><input type="checkbox" data-sys-on checked>/,
    );
    expect(html).toMatch(
      /data-sys="avito"[^>]*>\s*<label class="sys__check"><input type="checkbox" data-sys-on>/,
    );
    expect(html).toContain('value="https://extranet.ostrovok.ru/"');
    expect(html).toMatch(/data-key="commissionPercent"[^>]*value="15"/);
    // Folded parts say what is in them.
    expect(html).toContain('<span class="group__note">1 категория, номеров — 2</span>');
    expect(html).toContain('<span class="group__note">подключено 1</span>');
  });

  it('keeps one place for each thing: the CRM is in the settings, the listing in its table', async () => {
    t = await startApp();
    const cookies = await signIn(t);
    t.fakes.hotel.profile.systems = [
      { id: 'bnovo', url: 'https://online.bnovo.ru/dashboard' },
      { id: 'ostrovok', listingUrl: 'https://ostrovok.ru/hotel/dom/', reviewsUrl: 'https://r/' },
    ];
    const html = (await t.app.inject({ url: '/cabinet/property', cookies })).body;
    // The systems editor does not offer the CRM again, nor the address of a listing …
    expect(html).not.toContain('data-sys="bnovo"');
    expect(html).not.toContain('data-sys="sheet"');
    expect(html).not.toContain('Ваше объявление, как его видят гости');
    expect(html).not.toMatch(/data-sys="ostrovok"[\s\S]*?data-key="listingUrl"/);
    // … but keeps the rest of a platform: its reviews page, in the system's item.
    expect(html).toMatch(/data-key="reviewsUrl"[^>]*value="https:\/\/r\/"/);
    // The competitors are edited once: in their own card, not as a group of the reference.
    expect(html).not.toContain('id="profile-competitors"');
    expect(html).toContain('data-form="competitors-save"');
    // The listing is typed once: in the table of listings.
    expect(html).toContain(
      '<input type="url" name="listing" data-platform="ostrovok" value="https://ostrovok.ru/hotel/dom/"',
    );
  });
});

describe('«Объект»: the list of competitors', () => {
  const COMPETITORS = [
    { name: 'Вилла Роза', url: 'https://ostrovok.ru/hotel/villa/' },
    { name: 'Дом <Чайки>', url: 'https://ostrovok.ru/hotel/chayki/' },
  ];

  it('is one list: the agent’s direct competitors and the owner’s, edited next to the search', async () => {
    t = await startApp();
    const cookies = await signIn(t);
    t.fakes.hotel.profile.competitors = COMPETITORS;
    const html = (await t.app.inject({ url: '/cabinet/property', cookies })).body;
    const card = /<form class="competitors-edit"[\s\S]*?<\/form>/.exec(html)![0];
    expect(card).toContain('В списке 2 из 10.');
    expect(card).toContain(`data-item="${esc(JSON.stringify(COMPETITORS[0]))}"`);
    expect(card).toContain('Дом &#60;Чайки&#62;');
    expect(card).not.toContain('Дом <Чайки>');
    expect(card).toContain('+ Добавить конкурента');
    expect(card).toContain('Сохранить список');
    // The search is below the list, in the same card; nothing of the list is in the reference.
    expect(html.indexOf('data-form="competitors-save"')).toBeLessThan(
      html.indexOf('data-act="competitors-start"'),
    );
    expect(html.match(/data-list="competitors"/g)).toHaveLength(1);
  });

  it('is saved on its own: the server changes only the list, on the profile it has now', async () => {
    t = await startApp();
    const cookies = await signIn(t);
    t.fakes.hotel.profile.phone = '+7 900 000-00-00';
    const ok = await t.app.inject({
      method: 'POST',
      url: '/api/agents/competitors/list',
      cookies,
      headers: origin,
      payload: {
        competitors: [{ name: ' Вилла Роза ', url: ' https://ostrovok.ru/hotel/villa/ ' }],
      },
    });
    expect(ok.statusCode).toBe(200);
    const put = t.fakes.hotelCalls.filter((c) => c.method === 'PUT');
    expect(put).toHaveLength(1);
    // Trimmed; the rest of the profile as the server had it.
    expect(put[0]!.body).toMatchObject({
      name: 'Дом у моря',
      phone: '+7 900 000-00-00',
      competitors: [{ name: 'Вилла Роза', url: 'https://ostrovok.ru/hotel/villa/' }],
    });
    // Cleared: the list is empty.
    expect(
      (
        await t.app.inject({
          method: 'POST',
          url: '/api/agents/competitors/list',
          cookies,
          headers: origin,
          payload: { competitors: [] },
        })
      ).statusCode,
    ).toBe(200);
    expect((t.fakes.hotel.profile as { competitors: unknown[] }).competitors).toEqual([]);
  });

  it('refuses a bad list before anything is sent, and a change from a foreign page', async () => {
    t = await startApp();
    const cookies = await signIn(t);
    const send = (payload: unknown, headers: Record<string, string> = origin) =>
      t.app.inject({
        method: 'POST',
        url: '/api/agents/competitors/list',
        cookies,
        headers,
        payload: payload as object,
      });
    const eleven = Array.from({ length: 11 }, (_, i) => ({
      name: `Дом ${i}`,
      url: `https://ostrovok.ru/hotel/${i}/`,
    }));
    for (const bad of [
      { competitors: 'x' },
      { competitors: [{ name: '', url: 'https://ostrovok.ru/a/' }] },
      { competitors: [{ name: 'Дом', url: 'javascript:alert(1)' }] },
      { competitors: [{ name: 'Дом', url: 'ostrovok.ru/a/' }] },
      { competitors: eleven },
    ]) {
      const res = await send(bad);
      expect(res.statusCode, JSON.stringify(bad).slice(0, 60)).toBe(400);
      expect(res.json().message).toContain('название и ссылка');
    }
    expect(t.fakes.hotelCalls.filter((c) => c.method !== 'GET')).toEqual([]);
    expect((await send({ competitors: [] }, { origin: 'https://evil.test' })).statusCode).toBe(403);
    expect(
      (
        await t.app.inject({
          method: 'POST',
          url: '/api/agents/competitors/list',
          headers: origin,
          payload: { competitors: [] },
        })
      ).statusCode,
    ).toBe(401);
  });
});

describe('the cabinet changes', () => {
  it('forwards changes for the signed-in owner only, from the site only, with Goldfish answers', async () => {
    t = await startApp();
    const cookies = await signIn(t);
    const changes = [{ op: 'agent', agent: 'channels', enabled: false }];
    const foreign = await t.app.inject({
      method: 'POST',
      url: '/api/agents/settings',
      cookies,
      payload: { changes },
      headers: { origin: 'https://evil.test' },
    });
    expect(foreign.statusCode).toBe(403);
    const anonymous = await t.app.inject({
      method: 'POST',
      url: '/api/agents/settings',
      payload: { changes },
      headers: origin,
    });
    expect(anonymous.statusCode).toBe(401);
    const ok = await t.app.inject({
      method: 'POST',
      url: '/api/agents/settings',
      cookies,
      payload: { changes },
      headers: origin,
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().warnings).toEqual([
      '«Применение цен»: никто не проверит, что новая цена дошла до площадок.',
    ]);
    expect(t.fakes.hotelCalls.at(-1)).toEqual({
      method: 'POST',
      path: 'yandex:1000001 /settings',
      body: { changes },
    });

    const approve = await t.app.inject({
      method: 'POST',
      url: '/api/agents/approvals/apr_1',
      cookies,
      payload: { decision: 'approve' },
      headers: origin,
    });
    expect(approve.json().status).toBe('approved');
    const missing = await t.app.inject({
      method: 'POST',
      url: '/api/agents/approvals/apr_9',
      cookies,
      payload: { decision: 'approve' },
      headers: origin,
    });
    expect(missing.statusCode).toBe(400);
    expect(missing.json().message).toBe('согласование не найдено');

    const bad = await t.app.inject({
      method: 'PUT',
      url: '/api/agents/profile',
      cookies,
      payload: { name: '' },
      headers: origin,
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().message).toBe('name: обязательно');

    const tg = await t.app.inject({
      method: 'POST',
      url: '/api/agents/telegram',
      cookies,
      payload: {},
      headers: origin,
    });
    expect(tg.json()).toMatchObject({
      code: 'ABCD2345',
      link: 'https://t.me/gf_bot?start=ABCD2345',
    });
    const hook = await t.app.inject({
      method: 'POST',
      url: '/api/agents/hook-token',
      cookies,
      payload: {},
      headers: origin,
    });
    expect(hook.json().events).toBe('/hotel/hooks/gfh_x/events');

    // A duty that is off: Goldfish asks for permission; the run happens only with a grant.
    const ask = await t.app.inject({
      method: 'POST',
      url: '/api/agents/duties/channels.sync/run',
      cookies,
      payload: {},
      headers: origin,
    });
    expect(ask.json().permission.reason).toBe('агент выключен');
    const once = await t.app.inject({
      method: 'POST',
      url: '/api/agents/duties/channels.sync/run',
      cookies,
      payload: { grant: 'once' },
      headers: origin,
    });
    expect(once.json().status).toBe('задание запущено');
    expect(t.fakes.hotelCalls.at(-1)).toEqual({
      method: 'POST',
      path: 'yandex:1000001 /duties/channels.sync/run',
      body: { grant: 'once' },
    });

    t.fakes.goldfishDown = true;
    const down = await t.app.inject({
      method: 'POST',
      url: '/api/agents/settings',
      cookies,
      payload: { changes },
      headers: origin,
    });
    expect(down.statusCode).toBe(502);
  });
});
