import { pino, type Logger } from 'pino';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadConfig, type Config } from '../src/config.js';
import { createServices, type Services } from '../src/services.js';
import { MemoryStore } from '../src/store/memory.js';
import type { Store, UserRecord } from '../src/store/types.js';
import { pkceChallenge, sha256 } from '../src/util/crypto.js';

export const PUBLIC_URL = 'https://site.test';
export const GOLDFISH_URL = 'https://agent.test';
export const ADMIN_TOKEN = 'admin-token-0123456789';
export const BOTS_URL = 'https://bots.test';
export const BOTS_TOKEN = 'bots-token-0123456789-0123456789-abcdef';

export function testConfig(env: Record<string, string> = {}): Config {
  return loadConfig({
    NODE_ENV: 'test',
    PUBLIC_URL,
    YANDEX_CLIENT_ID: 'ya-client',
    YANDEX_CLIENT_SECRET: 'ya-secret',
    YANDEX_OAUTH_URL: 'https://oauth.yandex.test',
    YANDEX_LOGIN_URL: 'https://login.yandex.test',
    GOLDFISH_URL,
    GOLDFISH_ADMIN_TOKEN: ADMIN_TOKEN,
    ...env,
  });
}

export interface YandexProfile {
  id: string;
  login?: string;
  real_name?: string;
  display_name?: string;
  default_email?: string;
  default_avatar_id?: string;
  is_avatar_empty?: boolean;
}

/** In-memory Yandex ID (token + info endpoints) and Goldfish admin API behind one fetch. */
/** A ready draft of the reference from a card on Avito. */
export const IMPORT_READY = {
  id: 'imp_1',
  status: 'ready',
  source: 'url',
  url: 'https://www.avito.ru/sochi/doma/dom_1',
  platform: 'Авито',
  error: null,
  createdAt: '2026-10-09T10:00:00.000Z',
  fields: [
    { key: 'name', label: 'Название', value: 'Дом у моря <b>', current: 'Дом у моря' },
    { key: 'rooms', label: 'Номера', value: 'Люкс, до 3 гостей, 9 500 ₽', current: '' },
  ],
};

export const LISTINGS_READY = {
  id: 'lst_1',
  status: 'ready',
  createdAt: '2026-10-09T10:00:00.000Z',
  platforms: [
    {
      platform: 'ostrovok',
      title: 'Островок',
      status: 'found',
      url: 'https://ostrovok.ru/hotel/dom',
      listingTitle: 'Дом у моря',
      address: 'Сочи, Морская, 5',
      rating: '4,8',
      match: 'likely',
      matchTitle: 'похоже на ваше',
      why: 'название совпадает, адрес совпадает',
      verdict: null,
      error: null,
      publishProposed: false,
    },
    {
      platform: 'yandex_travel',
      title: 'Яндекс Путешествия',
      status: 'found',
      url: 'https://travel.yandex.ru/hotels/x',
      listingTitle: 'Дом у моря',
      address: null,
      rating: null,
      match: 'unsure',
      matchTitle: 'проверьте',
      why: 'название совпадает, адреса для сравнения нет',
      verdict: 'mine',
      error: null,
      publishProposed: false,
    },
    {
      platform: 'avito',
      title: 'Авито',
      status: 'not_found',
      url: null,
      listingTitle: null,
      address: null,
      rating: null,
      match: null,
      matchTitle: null,
      why: null,
      verdict: null,
      error: null,
      publishProposed: false,
    },
    {
      platform: '101hotels',
      title: '101Hotels',
      status: 'failed',
      url: null,
      listingTitle: null,
      address: null,
      rating: null,
      match: null,
      matchTitle: null,
      why: null,
      verdict: null,
      error: 'капча',
      publishProposed: false,
    },
  ],
};

export const COMPETITORS_READY = {
  id: 'cms_1',
  status: 'ready',
  createdAt: '2026-10-09T10:00:00.000Z',
  platforms: [{ platform: 'ostrovok', title: 'Островок', status: 'done', found: 2, error: null }],
  found: 2,
  candidates: [
    {
      id: 'cmp_1',
      name: 'Вилла Роза',
      url: 'https://ostrovok.ru/hotel/villa',
      platform: 'Островок',
      score: 0.9,
      reasons: ['гостевой дом, как у вас', '400 м'],
      verdict: null,
      verdictTitle: null,
    },
    {
      id: 'cmp_2',
      name: 'Гранд <Отель>',
      url: 'javascript:alert(1)',
      platform: 'Островок',
      score: 0.2,
      reasons: ['другой тип (отель)'],
      verdict: 'not',
      verdictTitle: 'не конкурент',
    },
  ],
  competitors: [],
};

/** GET …/hotel/prices: three direct competitors, weekly prices for two nights. */
export const PRICE_BOARD = {
  updatedAt: '2026-10-14T09:00:00.000Z',
  basis: 'monitor',
  own: {
    priceFrom: 5000,
    rooms: [
      { id: 'std', name: 'Стандарт', basePrice: 5000 },
      { id: 'lux', name: 'Люкс', basePrice: 9000 },
    ],
  },
  competitors: [
    {
      name: 'Вилла Роза',
      url: 'https://ostrovok.ru/hotel/villa-roza/',
      platform: 'Островок',
      by: 'agent',
      reason: 'гостевой дом в 400 м, номера на 2–3 гостей',
      kind: 'Гостевой дом',
      rating: 4.8,
      distanceKm: 0.4,
      price: 5200,
      prices: 3,
    },
    {
      name: 'Дом <Чайки>',
      url: 'javascript:alert(1)',
      platform: 'Островок',
      by: 'owner',
      reason: null,
      kind: null,
      rating: null,
      distanceKm: 1.2,
      price: 5900,
      prices: 2,
    },
    {
      name: 'Сосны',
      url: 'https://ostrovok.ru/hotel/sosny/',
      platform: 'Островок',
      by: 'manual',
      reason: null,
      kind: 'Мини-отель',
      rating: null,
      distanceKm: null,
      price: 7400,
      prices: 1,
    },
  ],
  stats: { n: 3, mean: 6167, median: 5900, min: 5200, max: 7400, p25: 5550, p75: 6650 },
  recommendation: {
    price: 5900,
    mean: 6167,
    median: 5900,
    own: 5000,
    diffPercent: -15,
    text: 'Цены прямых конкурентов: средняя 6 167 ₽, медиана 5 900 ₽. Ваша цена от 5 000 ₽ — на 15% ниже медианы. Рекомендую от 5 900 ₽.',
    rooms: [
      { id: 'std', name: 'Стандарт', current: 5000, recommended: 5900 },
      { id: 'lux', name: 'Люкс', current: 9000, recommended: 10600 },
    ],
  },
  note: null,
  byDay: [
    { day: '2026-10-17', n: 3, mean: 6467, median: 6400, min: 5600, max: 7400 },
    { day: '2026-10-20', n: 2, mean: 5100, median: 5100, min: 4800, max: 5400 },
  ],
  history: [{ day: '2026-10-14', n: 5, mean: 5920, median: 5600 }],
  proofs: [
    {
      competitor: 'Вилла Роза',
      url: 'https://ostrovok.ru/hotel/villa-roza/',
      day: '2026-10-17',
      price: 5600,
      quote: 'Стандарт · 5 600 ₽ за ночь <script>alert(1)</script>',
      source: 'https://ostrovok.ru/hotel/villa-roza/?dates=17.10',
      readAt: '2026-10-14T09:00:00.000Z',
      taskId: 'task_1',
      origin: 'monitor',
    },
    {
      competitor: 'Дом <Чайки>',
      url: null,
      day: null,
      price: 5900,
      quote: null,
      source: 'javascript:alert(2)',
      readAt: '2026-10-13T09:00:00.000Z',
      taskId: null,
      origin: 'search',
    },
  ],
  search: { id: 'cms_1', found: 6, direct: 3, createdAt: '2026-10-13T09:00:00.000Z' },
};

export class Fakes {
  /** GET …/hotel/profile/import: the latest draft, if any. */
  profileImport: unknown = null;
  listings: unknown = null;
  competitorSearch: unknown = null;
  prices: unknown = PRICE_BOARD;
  /** GET /admin/users/:c/:u — the owner's extension; null — the user is not on the server. */
  extension: { online: boolean; lastBrowserSeenAt: string | null } | null = {
    online: false,
    lastBrowserSeenAt: null,
  };
  /** GET …/hotel/study; null — an older Goldfish without it (404). */
  study: {
    on: boolean;
    since: string | null;
    items: Array<Record<string, unknown>>;
    targets: Array<{ system: string; title: string }>;
  } | null = { on: false, since: null, items: [], targets: [] };
  // Yandex
  profile: YandexProfile = {
    id: '1000001',
    login: 'ivan.petrov',
    real_name: 'Иван Петров',
    default_email: 'ivan.petrov@yandex.ru',
    default_avatar_id: '131652443/abc-123',
    is_avatar_empty: false,
  };
  /** code → PKCE challenge the authorize request carried. */
  readonly codes = new Map<string, string>();
  tokenExchangeFails = false;

  // Goldfish
  readonly clients: Array<{ id: string; name: string }> = [];
  readonly users = new Map<string, { displayName?: string }>();
  readonly tokens = new Map<string, { clientId: string; userId: string; revoked: boolean }>();
  goldfishDown = false;
  /** The server is being redeployed: its proxy answers 502. */
  goldfishRestarting = false;
  /** Hotel agents of site users on the Goldfish server: requests the site forwarded. */
  readonly hotelCalls: Array<{ method: string; path: string; body: unknown }> = [];
  hotel = {
    id: 'prop_1',
    timezone: 'Europe/Moscow',
    profile: {
      name: 'Дом у моря',
      checkIn: '14:00',
      checkOut: '12:00',
      rooms: [{ id: 'std', name: 'Стандарт', count: 2 }],
      systems: [{ id: 'ostrovok' }],
      policies: { pets: 'Можно' },
      amenities: ['Wi-Fi'],
      priceCorridor: { percent: 10, byRoom: {} },
    } as Record<string, unknown>,
    profileVersion: 3,
    telegramLinked: false,
    hookConfigured: false,
    telegramBot: true,
    settings: {
      autonomy: 4 as number | undefined,
      autonomyLevels: [
        [
          'Ручное управление',
          'управляющий ничего не запускает сам — всё начинаете и выполняете вы',
        ],
        [
          'Задачи с подтверждением',
          'каждую задачу сначала согласуете вы, дальше управляющий выполняет её сам',
        ],
        [
          'Контролируемая автономность',
          'анализ сам до 100 запросов к LLM, ответы гостям и изменения — после вашего согласования',
        ],
        [
          'Полная автономность',
          'стандартное делает сам, нестандартное передаёт вам с рекомендацией',
        ],
      ].map(([title, short], i) => ({
        level: i + 1,
        title: title!,
        short: short!,
        rules: [`Правило уровня ${i + 1}.`],
      })) as Array<{ level: number; title: string; short: string; rules: string[] }> | undefined,
      wave: 1,
      pause: null,
      owner: { quietFrom: '22:00', quietTo: '09:00', urgentPerDay: 5, summaryTime: '09:00' },
      limits: { reviewAutoMinStars: 4, sharpChangePercent: 40 },
      platforms: [
        { id: 'bnovo', title: 'Bnovo', category: 'pms', mode: 'full' },
        { id: 'sheet', title: 'Шахматка в таблице', category: 'sheet', mode: 'full' },
        { id: 'ostrovok', title: 'Островок', category: 'guest', mode: 'full' },
        { id: 'avito', title: 'Авито', category: 'guest', mode: 'full' },
        { id: 'yandex_maps', title: 'Яндекс Карты', category: 'maps', mode: 'full' },
      ],
      agents: [
        {
          id: 'channels',
          title: 'Каналы продаж',
          mission: 'Верные цены и наличие на площадках.',
          metrics: ['открытые расхождения'],
          enabled: true,
          duties: [
            {
              id: 'channels.sync',
              title: 'Сверка цен и наличия',
              when: 'Каждое утро',
              does: 'Сверяет',
              wave: 1,
              run: 'browser',
              maxLevel: 'self',
              alwaysOn: false,
              enabled: true,
              level: 'self',
            },
            {
              id: 'channels.fix',
              title: 'Исправление расхождений',
              when: 'После сверки',
              does: 'Исправляет',
              wave: 1,
              run: 'browser',
              maxLevel: 'rule',
              alwaysOn: false,
              enabled: true,
              level: 'approval',
            },
          ],
        },
        {
          id: 'manager',
          title: 'Управляющий',
          mission: 'Говорит с владельцем.',
          metrics: ['сводка вовремя'],
          enabled: false,
          duties: [
            {
              id: 'manager.approvals',
              title: 'Очередь согласований',
              when: 'Постоянно',
              does: 'Очередь',
              wave: 1,
              run: 'code',
              maxLevel: 'self',
              alwaysOn: true,
              enabled: true,
              level: 'self',
            },
            {
              id: 'manager.weekly',
              title: 'Недельный отчёт',
              when: 'По понедельникам',
              does: 'Отчёт',
              wave: 2,
              run: 'code',
              maxLevel: 'self',
              alwaysOn: false,
              enabled: false,
              level: 'off',
              reason: 'включится в волне 2',
            },
          ],
        },
      ],
    },
  };
  approvals = [
    {
      id: 'apr_1',
      agent: 'channels',
      title: 'Исправить расхождения на площадках: 2',
      reason: '2026-10-20 Люкс Островок цена 9000 / 8500',
      cost: null,
      urgent: false,
      action: { kind: 'task', text: 'Исправь на площадках <b>расхождения</b>' },
      createdAt: '2026-10-08T07:00:00.000Z',
    },
  ];
  /** GET …/hotel/manager: false — an older Goldfish without the desk (404). */
  deskSupported = true;
  /** Decisions taken, for «Решено недавно». */
  decided: Array<Record<string, unknown>> = [];
  deskRev = 'rev_1';
  // Bots server (tg_goldfish)
  /** Chats linked to bots: `owner` is `<clientId>/<userId>`. */
  readonly botLinks: Array<{
    owner: string;
    channel: string;
    title: string;
    chatId: string;
    name: string | null;
    linkedAt: string;
  }> = [];
  botsDown = false;
  readonly botCalls: string[] = [];
  extensionZip: Buffer | null = Buffer.from('PK\u0003\u0004fake-zip');
  readonly calls: string[] = [];
  private seq = 0;

  readonly fetch: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    const method = init?.method ?? 'GET';
    const headers = new Headers(init?.headers);
    this.calls.push(`${method} ${url.host}${url.pathname}`);
    if (url.host === 'oauth.yandex.test') return this.yandexToken(init);
    if (url.host === 'login.yandex.test') {
      if (headers.get('authorization') !== 'OAuth ya-access-token')
        return json({ error: 'unauthorized' }, 401);
      return json(this.profile);
    }
    if (url.host === 'agent.test') return this.goldfish(method, url, headers, init?.body);
    if (url.host === 'bots.test') return this.bots(method, url, headers);
    throw new TypeError(`fetch failed: ${url}`);
  };

  /** The desk the Goldfish server would give for the fake's approvals. */
  desk() {
    const titles = new Map(this.hotel.settings.agents.map((a) => [a.id, a.title]));
    return {
      rev: this.deskRev,
      property: { name: this.hotel.profile.name, timezone: 'Europe/Moscow' },
      status: {
        agentsOn: this.hotel.settings.agents.filter((a) => a.enabled).length,
        agentsTotal: this.hotel.settings.agents.length,
        wave: this.hotel.settings.wave,
        waveTitle: 'Наблюдают',
        pause: null,
        pending: this.approvals.length,
        urgent: this.approvals.filter((a) => a.urgent).length,
        line: '',
      },
      approvals: this.approvals.map((a) => ({
        ...a,
        agentTitle: titles.get(a.agent) ?? a.agent,
        duty: 'channels.fix',
        text: a.action.text ?? null,
        editable: a.action.kind !== 'none',
        remindedAt: null,
        expiresAt: new Date(Date.parse(a.createdAt) + 72 * 3_600_000).toISOString(),
      })),
      decided: this.decided,
      feed: [
        {
          id: 'out_1',
          kind: 'summary',
          kindTitle: 'Сводка',
          mark: '☀️',
          text: 'Доброе утро! Сегодня заездов — 1.',
          approvalId: null,
          decided: null,
          sentAt: '2026-10-08T06:00:00.000Z',
          folded: false,
          createdAt: '2026-10-08T06:00:00.000Z',
        },
      ],
      kpi: [
        { id: 'next30', label: 'Загрузка вперёд', value: '48%', sub: 'на 30 дней' },
        { id: 'adr', label: 'ADR', value: '5 200 ₽', sub: 'средняя цена ночи' },
        { id: 'rating', label: 'Рейтинг', value: '4,7', sub: 'на площадках' },
      ],
    };
  }

  private bots(method: string, url: URL, headers: Headers): Response {
    if (this.botsDown) throw new TypeError('fetch failed: connect ECONNREFUSED');
    if (headers.get('authorization') !== `Bearer ${BOTS_TOKEN}`)
      return json({ error: 'unauthorized' }, 401);
    const m = /^\/api\/owners\/([^/]+)\/([^/]+)(\/codes|\/links\/([^/]+)\/([^/]+))?$/.exec(
      url.pathname,
    );
    if (!m) return json({ error: 'not_found' }, 404);
    const owner = `${decodeURIComponent(m[1]!)}/${decodeURIComponent(m[2]!)}`;
    this.botCalls.push(`${method} ${owner}${m[3] ? m[3].replace(/\/links.*/, '/links') : ''}`);
    const channels = [
      { id: 'telegram', title: 'Telegram' },
      { id: 'max', title: 'MAX' },
      { id: 'whatsapp', title: 'WhatsApp' },
    ];
    if (method === 'GET' && !m[3])
      return json({
        channels,
        links: this.botLinks.filter((l) => l.owner === owner).map(({ owner: _o, ...l }) => l),
      });
    if (method === 'POST' && m[3] === '/codes')
      return json(
        {
          expiresAt: '2026-10-16T18:40:00.000Z',
          offers: [
            {
              channel: 'telegram',
              title: 'Telegram',
              url: 'https://t.me/goldfish_bot?start=TGCODE23',
              code: 'TGCODE23',
            },
            {
              channel: 'max',
              title: 'MAX',
              url: 'https://max.ru/goldfish_bot?start=MAXCODE2',
              code: 'MAXCODE2',
            },
            {
              channel: 'whatsapp',
              title: 'WhatsApp',
              url: 'https://wa.me/79000000001?text=%D0%9A%D0%BE%D0%B4%20Goldfish%3A%20WACODE23',
              code: 'WACODE23',
            },
          ],
        },
        201,
      );
    if (method === 'DELETE' && m[4]) {
      const i = this.botLinks.findIndex(
        (l) => l.owner === owner && l.channel === m[4] && l.chatId === decodeURIComponent(m[5]!),
      );
      if (i < 0) return json({ error: 'not_found' }, 404);
      this.botLinks.splice(i, 1);
      return new Response(null, { status: 204 });
    }
    return json({ error: 'not_found' }, 404);
  }

  /** Registers a code as Yandex would after the user approves. */
  approve(code: string, challenge: string): void {
    this.codes.set(code, challenge);
  }

  private yandexToken(init?: RequestInit): Response {
    const form = new URLSearchParams(String(init?.body ?? ''));
    const challenge = this.codes.get(form.get('code') ?? '');
    if (
      this.tokenExchangeFails ||
      form.get('grant_type') !== 'authorization_code' ||
      form.get('client_id') !== 'ya-client' ||
      form.get('client_secret') !== 'ya-secret' ||
      !challenge ||
      pkceChallenge(form.get('code_verifier') ?? '') !== challenge
    )
      return json({ error: 'invalid_grant', error_description: 'Code has expired' }, 400);
    this.codes.delete(form.get('code')!);
    return json({ token_type: 'bearer', access_token: 'ya-access-token', expires_in: 3600 });
  }

  private goldfish(method: string, url: URL, headers: Headers, rawBody: unknown): Response {
    if (this.goldfishDown) throw new TypeError('fetch failed: connect ECONNREFUSED');
    if (this.goldfishRestarting) return json({ error: 'bad_gateway' }, 502);
    const path = url.pathname;
    if (path === '/extension/download') {
      if (!this.extensionZip) return json({ error: 'not_found' }, 404);
      return new Response(new Uint8Array(this.extensionZip), {
        headers: {
          'content-type': 'application/zip',
          'content-disposition': 'attachment; filename="goldfish-extension-0.1.0.zip"',
        },
      });
    }
    if (headers.get('authorization') !== `Bearer ${ADMIN_TOKEN}`)
      return json({ error: 'unauthorized' }, 401);
    const body = rawBody ? JSON.parse(String(rawBody)) : {};
    let m: RegExpExecArray | null;
    if (method === 'GET' && path === '/admin/clients') return json(this.clients);
    if (method === 'POST' && path === '/admin/clients') {
      const client = { id: `cl_${++this.seq}`, name: body.name };
      this.clients.push(client);
      return json(client, 201);
    }
    if (method === 'POST' && (m = /^\/admin\/clients\/([^/]+)\/users$/.exec(path))) {
      const key = `${m[1]}/${body.userId}`;
      if (this.users.has(key)) return json({ error: 'exists' }, 409);
      this.users.set(key, { displayName: body.displayName });
      return json({ userId: body.userId }, 201);
    }
    if (method === 'GET' && (m = /^\/admin\/users\/([^/]+)\/([^/]+)$/.exec(path))) {
      if (!this.extension) return json({ error: 'not_found' }, 404);
      return json({ userId: decodeURIComponent(m[2]!), ...this.extension });
    }
    if (method === 'PATCH' && (m = /^\/admin\/users\/([^/]+)\/([^/]+)$/.exec(path))) {
      const key = `${m[1]}/${decodeURIComponent(m[2]!)}`;
      const user = this.users.get(key);
      if (!user) return json({ error: 'not_found' }, 404);
      Object.assign(user, body);
      return json(user);
    }
    if (method === 'POST' && (m = /^\/admin\/clients\/([^/]+)\/tokens$/.exec(path))) {
      const id = `tok_${++this.seq}`;
      this.tokens.set(id, { clientId: m[1]!, userId: body.userId, revoked: false });
      return json(
        { token: `gf_secret_${id}`, tokenId: id, clientId: m[1], userId: body.userId },
        201,
      );
    }
    if ((m = /^\/admin\/users\/([^/]+)\/([^/]+)\/hotel(.*)$/.exec(path))) {
      const sub = m[3]!;
      this.hotelCalls.push({
        method,
        path: `${decodeURIComponent(m[2]!)} ${sub}${url.search}`,
        body,
      });
      if (method === 'GET' && sub === '') return json(this.hotel);
      if (method === 'GET' && sub === '/manager')
        return this.deskSupported ? json(this.desk()) : json({ error: 'not_found' }, 404);
      if (method === 'GET' && sub === '/approvals') return json(this.approvals);
      if (method === 'GET' && sub === '/kpi')
        return json({
          units: 2,
          past30: { occupancy: 61.5, adr: 5200, revpar: 3198, directShare: 22 },
          next30: { occupancy: 48 },
          rating: 4.7,
          responseMinutes: 3,
        });
      if (method === 'GET' && sub === '/feed')
        return json([
          {
            kind: 'summary',
            text: 'Доброе утро! Сегодня заездов — 1.',
            createdAt: '2026-10-08T06:00:00.000Z',
          },
        ]);
      if (method === 'POST' && sub === '/settings') {
        const disabling = (
          body.changes as Array<{ op: string; agent?: string; enabled?: boolean }>
        ).some((c) => c.op === 'agent' && c.agent === 'channels' && !c.enabled);
        return json({
          ...this.hotel,
          warnings: disabling
            ? ['«Применение цен»: никто не проверит, что новая цена дошла до площадок.']
            : [],
        });
      }
      if (method === 'POST' && sub.startsWith('/approvals/')) {
        if (sub !== '/approvals/apr_1')
          return json({ error: 'bad_request', message: 'согласование не найдено' }, 400);
        return json({
          ...this.approvals[0],
          status: body.decision === 'reject' ? 'rejected' : 'approved',
        });
      }
      if (method === 'GET' && sub === '/profile/import') return json(this.profileImport);
      if (method === 'GET' && sub === '/listings') return json(this.listings);
      if (method === 'GET' && sub === '/competitors') return json(this.competitorSearch);
      if (method === 'GET' && sub === '/prices')
        return this.prices === null ? json({ error: 'not_found' }, 404) : json(this.prices);
      if (method === 'POST' && sub === '/prices/accept') {
        if (!Array.isArray(body.rooms) || !body.rooms.length)
          return json({ error: 'bad_request', message: 'менять нечего' }, 400);
        return json({ changed: ['«Стандарт»: 5 000 ₽ → 5 900 ₽'], board: this.prices });
      }
      if (method === 'POST' && sub === '/listings')
        return json({ ...LISTINGS_READY, status: 'searching' }, 201);
      if (method === 'POST' && sub === '/listings/lst_1/ostrovok')
        return json({ ...LISTINGS_READY, mine: body.mine });
      if (method === 'POST' && sub === '/listings/manual') {
        const where: Record<string, [string, string]> = {
          avito: ['https://www.avito.ru/', 'Авито'],
          ostrovok: ['https://ostrovok.ru/', 'Островок'],
          yandex_maps: ['https://yandex.ru/maps/', 'Яндекс Карты'],
        };
        const [prefix, title] = where[body.platform] ?? ['', body.platform];
        if (typeof body.url !== 'string' || !prefix || !body.url.startsWith(prefix))
          return json({ error: 'bad_request', message: `это ссылка не на ${title}` }, 400);
        const systems = (this.hotel.profile.systems ?? []) as Array<{ id: string }>;
        this.hotel.profile.systems = systems.some((x) => x.id === body.platform)
          ? systems.map((x) => (x.id === body.platform ? { ...x, listingUrl: body.url } : x))
          : [...systems, { id: body.platform, listingUrl: body.url }];
        return json({
          ...LISTINGS_READY,
          platforms: LISTINGS_READY.platforms.map((x) =>
            x.platform === body.platform
              ? { ...x, status: 'found', url: body.url, verdict: 'mine', manual: true }
              : x,
          ),
        });
      }
      if (method === 'POST' && sub === '/competitors/candidates/cmp_1')
        return json({
          verdict: body.verdict,
          note: null,
          competitors: [{ name: 'Вилла Роза', url: 'https://ostrovok.ru/hotel/villa' }],
        });
      if (method === 'POST' && sub === '/profile/import') {
        if (!body.url && !body.text)
          return json(
            { error: 'bad_request', message: 'пришлите ссылку на карточку или её текст' },
            400,
          );
        this.profileImport = {
          ...IMPORT_READY,
          status: 'reading',
          fields: [],
          url: body.url ?? null,
        };
        return json(this.profileImport, 201);
      }
      if (method === 'GET' && sub === '/study')
        return this.study ? json(this.study) : json({ error: 'not_found' }, 404);
      if (method === 'POST' && sub === '/study') {
        if (!this.study) return json({ error: 'not_found' }, 404);
        if (body.on === false) {
          this.study = { ...this.study, on: false };
          return json(this.study);
        }
        if (!this.extension?.lastBrowserSeenAt)
          return json(
            {
              error: 'bad_request',
              message: 'расширение Goldfish ещё ни разу не подключалось',
            },
            400,
          );
        this.study = {
          on: true,
          since: '2026-10-22T09:00:00.000Z',
          targets: [{ system: 'ostrovok', title: 'Островок' }],
          items: [
            {
              system: 'ostrovok',
              title: 'Островок',
              status: 'running',
              outcome: null,
              taskId: 'task_9',
              startedAt: '2026-10-22T09:00:00.000Z',
            },
          ],
        };
        return json(this.study, 201);
      }
      if (method === 'GET' && sub === '/profile/import/imp_1') return json(IMPORT_READY);
      if (method === 'POST' && sub === '/profile/import/imp_1/apply')
        return json({ ...this.hotel, applied: ['Название'] });
      if (method === 'POST' && sub === '/profile/import/imp_1/discard') return json({ ok: true });
      if (method === 'POST' && sub === '/duties/channels.sync/run') {
        if (!body.grant)
          return json({
            status: 'нужно разрешение: агент выключен',
            permission: {
              duty: 'channels.sync',
              dutyTitle: 'Сверка цен и наличия',
              agent: 'channels',
              agentTitle: 'Каналы продаж',
              reason: 'агент выключен',
              level: 'self',
              changes: [{ op: 'agent', agent: 'channels', enabled: true }],
              text: 'Агент «Каналы продаж» не может выполнить «Сверка цен и наличия» без вашего разрешения: агент выключен.',
            },
          });
        return json({ status: 'задание запущено' });
      }
      if (method === 'POST' && sub === '/telegram/link')
        return json({
          code: 'ABCD2345',
          link: 'https://t.me/gf_bot?start=ABCD2345',
          expiresInSec: 1800,
        });
      if (method === 'POST' && sub === '/hook-token')
        return json({
          token: 'gfh_x',
          events: '/hotel/hooks/gfh_x/events',
          email: '/hotel/hooks/gfh_x/email',
        });
      if (method === 'PUT' && sub === '/profile') {
        if (!body.name) return json({ error: 'bad_request', message: 'name: обязательно' }, 400);
        this.hotel.profile = body;
        return json(this.hotel);
      }
      return json({ error: 'not_found' }, 404);
    }
    if (method === 'DELETE' && (m = /^\/admin\/tokens\/([^/]+)$/.exec(path))) {
      const token = this.tokens.get(m[1]!);
      if (!token) return new Response(null, { status: 404 });
      token.revoked = true;
      return new Response(null, { status: 204 });
    }
    return json({ error: 'not_found' }, 404);
  }

  activeTokens(): string[] {
    return [...this.tokens].filter(([, t]) => !t.revoked).map(([id]) => id);
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export interface TestApp {
  app: FastifyInstance;
  services: Services;
  fakes: Fakes;
  store: Store;
}

export async function startApp(
  env: Record<string, string> = {},
  store: Store = new MemoryStore(),
  log: Logger = pino({ level: 'silent' }),
): Promise<TestApp> {
  const fakes = new Fakes();
  const services = await createServices(testConfig(env), log, {
    store,
    fetch: fakes.fetch,
    retryDelaysMs: [0, 0],
  });
  const app = await buildApp(services);
  await app.ready();
  return { app, services, fakes, store };
}

/** Walks the whole Yandex sign-in and returns the session cookie. */
export async function signIn(t: TestApp): Promise<Record<string, string>> {
  const start = await t.app.inject('/auth/yandex');
  const location = new URL(String(start.headers.location));
  const oauth = start.cookies.find((c) => c.name === t.services.sessions.names.oauth)!;
  t.fakes.approve('auth-code', location.searchParams.get('code_challenge')!);
  const callback = await t.app.inject({
    url: `/auth/yandex/callback?code=auth-code&state=${location.searchParams.get('state')}`,
    cookies: { [oauth.name]: oauth.value },
  });
  const session = callback.cookies.find((c) => c.name === t.services.sessions.names.session);
  if (!session)
    throw new Error(`sign-in failed: ${callback.statusCode} ${callback.headers.location}`);
  return { [session.name]: session.value };
}

export async function sessionUser(
  t: TestApp,
  cookies: Record<string, string>,
): Promise<UserRecord> {
  const user = await t.store.sessionUser(sha256(Object.values(cookies)[0]!));
  if (!user) throw new Error('no session');
  return user;
}
