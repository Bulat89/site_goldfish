import { afterEach, describe, expect, it } from 'vitest';
import { esc } from '../src/pages/page.js';
import { BOTS_TOKEN, BOTS_URL, PUBLIC_URL, signIn, startApp, type TestApp } from './helpers.js';

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

describe('agents page', () => {
  it('needs a session', async () => {
    t = await startApp();
    const res = await t.app.inject('/agents');
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/auth/yandex');
  });

  it("shows the owner's team, rights, approvals, numbers and the reference from Goldfish", async () => {
    t = await startApp();
    const cookies = await signIn(t);
    const setup = await t.app.inject({ url: '/start', cookies });
    expect(setup.body).toContain('href="/agents"');
    const res = await t.app.inject({ url: '/agents', cookies });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toContain('no-store');
    const html = res.body;
    expect(html).toContain('<h1>Дом у моря</h1>');
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
    // Approvals, text escaped.
    expect(html).toContain('Исправить расхождения на площадках: 2');
    expect(html).toContain('&#60;b&#62;расхождения&#60;/b&#62;');
    expect(html).not.toContain('<b>расхождения</b>');
    // Numbers computed by Goldfish.
    expect(html).toMatch(/5\s200 ₽/u);
    expect(html).toContain('4,7');
    // Platforms connected in the reference only.
    expect(html).toContain('data-platform="ostrovok"');
    expect(html).not.toContain('data-platform="avito"');
    expect(html).toContain('Доброе утро! Сегодня заездов — 1.');
    // One desk for the site, the extension and the bots.
    const user = t.fakes.hotelCalls.map((c) => c.path);
    expect(user).toEqual(expect.arrayContaining(['yandex:1000001 ', 'yandex:1000001 /manager']));
    expect(user).not.toContain('yandex:1000001 /kpi');
    expect(html).toContain('data-panel="today" data-rev="rev_1"');
  });

  it('an older Goldfish without the desk: the page makes it of the separate answers', async () => {
    t = await startApp();
    t.fakes.deskSupported = false;
    const cookies = await signIn(t);
    const html = (await t.app.inject({ url: '/agents', cookies })).body;
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

  it('«Сегодня» shows what was decided and where; it asks for itself again while open', async () => {
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
    let html = (await t.app.inject({ url: '/agents', cookies })).body;
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
    expect(data.strip).toContain('Решений не ждут');
    expect((await t.app.inject({ url: '/api/agents/today' })).statusCode).toBe(401);

    // An urgent one makes the count and the state red.
    t.fakes.approvals = [
      { ...t.fakes.approvals[0], ...APPROVAL, id: 'apr_2', urgent: true } as never,
    ];
    html = (await t.app.inject({ url: '/api/agents/today', cookies })).json().count;
    expect(html).toContain('tabs__count--urgent');
  });

  it('the live «Сегодня» reads the linked chats without making new link codes', async () => {
    t = await startApp({ BOTS_URL, BOTS_API_TOKEN: BOTS_TOKEN });
    const cookies = await signIn(t);
    t.fakes.botLinks.push({
      owner: 'cl_1/yandex:1000001',
      channel: 'telegram',
      title: 'Telegram',
      chatId: '501',
      name: 'Иван',
      linkedAt: '2026-10-16T10:00:00.000Z',
    });
    const live = (await t.app.inject({ url: '/api/agents/today', cookies })).json();
    expect(live.strip).toContain('Привязан Telegram');
    expect(live.today).not.toContain('Первые шаги');
    expect(t.fakes.botCalls).toEqual(['GET cl_1/yandex:1000001']);
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

  it('opens on «Сегодня»; `?tab=` opens another tab, every tab is in the page', async () => {
    t = await startApp();
    const cookies = await signIn(t);
    const open = (html: string) =>
      [...html.matchAll(/data-panel="(\w+)"[^>]*>/g)]
        .filter((m) => !m[0].includes(' hidden'))
        .map((m) => m[1]);
    let html = (await t.app.inject({ url: '/agents', cookies })).body;
    expect(open(html)).toEqual(['today']);
    expect(html).toContain('<title>Сегодня — агенты — Goldfish</title>');
    expect(html).toContain('href="?tab=today" data-tab="today" aria-current="page"');
    // The count of decisions waiting is on the tab.
    expect(html).toMatch(/data-tab="today"[^>]*>Сегодня <span class="tabs__count"[^>]*>1<\/span>/);
    for (const tab of ['team', 'property', 'settings']) {
      expect(html).toContain(`data-panel="${tab}"`);
      html = (await t.app.inject({ url: `/agents?tab=${tab}`, cookies })).body;
      expect(open(html)).toEqual([tab]);
      expect(html).toContain(`href="?tab=${tab}" data-tab="${tab}" aria-current="page"`);
    }
    html = (await t.app.inject({ url: '/agents?tab=nope', cookies })).body;
    expect(open(html)).toEqual(['today']);
  });

  it('says on every tab who works, the wave, a pause, decisions and Telegram', async () => {
    t = await startApp();
    const cookies = await signIn(t);
    let html = (await t.app.inject({ url: '/agents', cookies })).body;
    const strip = /<ul class="statuses"[^>]*>(.*?)<\/ul>/s.exec(html)![1]!;
    expect(strip).toContain('Работают 1 из 2 агентов');
    expect(strip).toContain('Волна 1 из 3 · наблюдают');
    expect(strip).toContain('href="/agents?tab=today#approvals-title">Ждут решения: 1');
    expect(strip).toContain('href="/agents?tab=settings#telegram-title">Telegram не привязан');
    expect(strip).not.toContain('Пауза');

    t.fakes.hotel.settings.pause = { until: '2026-11-20', reason: 'ремонт' } as never;
    t.fakes.hotel.telegramLinked = true;
    t.fakes.approvals = [];
    html = (await t.app.inject({ url: '/agents?tab=team', cookies })).body;
    expect(html).toContain('Пауза до 20.11.2026 · ремонт');
    expect(html).toContain('Telegram привязан');
    expect(html).toContain('Решений не ждут');
    expect(html).toContain('<b>На паузе до 20.11.2026</b> · ремонт');
    expect(html).toContain(
      `data-changes="${esc(JSON.stringify([{ op: 'pause', until: null }]))}" data-done="Пауза снята — агенты снова работают.">Снять паузу</button>`,
    );
    expect(html).toContain('Ничего не ждёт вашего решения');
  });

  it('an agent is switched by a switch; a wave asks with what switches on', async () => {
    t = await startApp();
    const cookies = await signIn(t);
    let html = (await t.app.inject({ url: '/agents?tab=team', cookies })).body;
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
    html = (await t.app.inject({ url: '/agents?tab=team', cookies })).body;
    expect(html).toContain('включится в волне 2');
    expect(/data-act="wave" data-wave="2" data-confirm="([^"]*)"/.exec(html)![1]).toContain(
      '• Управляющий: Недельный отчёт',
    );
  });

  it('the autonomy of the manager: the level in the strip, the four levels to choose, escalations', async () => {
    t = await startApp();
    const cookies = await signIn(t);
    const levels = t.fakes.hotel.settings.autonomyLevels;
    // An older Goldfish says nothing about autonomy: nothing is shown.
    Object.assign(t.fakes.hotel.settings, { autonomy: undefined, autonomyLevels: undefined });
    let html = (await t.app.inject({ url: '/agents?tab=team', cookies })).body;
    expect(html).not.toContain('autonomy-title');
    Object.assign(t.fakes.hotel.settings, { autonomy: 3, autonomyLevels: levels });
    (t.fakes.approvals[0] as Record<string, unknown>).escalation = {
      what: 'Овербукинг «Люкс» на 22.10–23.10',
      consequences: 'Гость останется без номера',
      recommendation: 'Связаться с гостем',
      held: 'сообщения гостям Анна, Пётр',
    };
    html = (await t.app.inject({ url: '/agents?tab=team', cookies })).body;
    const strip = /<ul class="statuses"[^>]*>(.*?)<\/ul>/s.exec(html)![1]!;
    expect(strip).toContain('Уровень 3 из 4 · контролируемая автономность');
    expect(html).toContain('<h3 id="autonomy-title">Уровень автономности управляющего</h3>');
    expect(html).toContain('<li>Правило уровня 3.</li>');
    expect(html).not.toContain('data-act="autonomy" data-level="3"');
    const choose =
      /data-act="autonomy" data-level="1" data-title="([^"]*)" data-confirm="([^"]*)"/.exec(html)!;
    expect(choose[1]).toBe('Ручное управление');
    expect(choose[2]).toContain('Уровень автономности 1 — «Ручное управление»?');
    expect(choose[2]).toContain('• Правило уровня 1.');
    html = (await t.app.inject({ url: '/agents?tab=today', cookies })).body;
    expect(html).toContain('<span class="approval__label">Что произошло:</span> Овербукинг');
    expect(html).toContain(
      '<span class="approval__label">Чем грозит:</span> Гость останется без номера',
    );
    expect(html).toContain(
      '<span class="approval__label">До вашего решения приостановлено:</span> сообщения гостям Анна, Пётр',
    );
    expect(html).not.toContain('<span class="approval__label">Почему:</span>');
  });

  it('the reference is edited in fields, not JSON; what is not shown is kept', async () => {
    t = await startApp();
    const cookies = await signIn(t);
    t.fakes.hotel.profile.systems = [
      { id: 'ostrovok', url: 'https://extranet.ostrovok.ru/', commissionPercent: 15 },
    ];
    const html = (await t.app.inject({ url: '/agents?tab=property', cookies })).body;
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

  it('when Goldfish is down the page says so', async () => {
    t = await startApp();
    const cookies = await signIn(t);
    t.fakes.goldfishDown = true;
    const res = await t.app.inject({ url: '/agents', cookies });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Сервер агентов сейчас недоступен');
  });

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
