import type { UserRecord } from '../store/types.js';
import type { BotsState } from './bots.js';
import { cabinetPage, type CabinetState } from './cabinet.js';
import { ICONS, TAB_PATH, cabinetHref, day, esc, helpLink, type CabinetAnchor } from './page.js';

/** What the Goldfish server returns about the owner's property (GET …/hotel). */
export interface HotelView {
  id: string;
  timezone: string;
  profile: Record<string, unknown> & { name?: string; systems?: Array<{ id: string }> };
  profileVersion: number;
  telegramLinked: boolean;
  hookConfigured: boolean;
  telegramBot?: boolean;
  settings: {
    /** Autonomy of the manager, 1–4, and what each level means (older servers send neither). */
    autonomy?: number;
    autonomyLevels?: AutonomyLevel[];
    wave: number;
    /** «Изучение»: the agents only read and learn the way; older servers do not send it. */
    study?: { since: string } | null;
    pause: { until: string; reason: string } | null;
    owner: { quietFrom: string; quietTo: string; urgentPerDay: number; summaryTime: string };
    limits: { reviewAutoMinStars: number; sharpChangePercent: number };
    platforms: Array<{
      id: string;
      title: string;
      category: string;
      mode: 'full' | 'read' | 'off';
    }>;
    agents: Array<{
      id: string;
      title: string;
      mission: string;
      metrics: string[];
      enabled: boolean;
      duties: Array<{
        id: string;
        title: string;
        when: string;
        does: string;
        wave: number;
        run: 'browser' | 'code';
        /** Changes data on platforms or writes to people (older servers do not send it). */
        writes?: boolean;
        maxLevel: Level;
        alwaysOn: boolean;
        enabled: boolean;
        level: Level;
        reason?: string;
      }>;
    }>;
  };
}

type Level = 'self' | 'rule' | 'approval' | 'off';

/** A level of the manager's autonomy, in the server's words. */
export interface AutonomyLevel {
  level: number;
  title: string;
  short: string;
  rules: string[];
}
type Agent = HotelView['settings']['agents'][number];
type Duty = Agent['duties'][number];

export interface ApprovalView {
  id: string;
  agent: string;
  title: string;
  reason: string;
  cost: string | null;
  urgent: boolean;
  action: { kind: string; text?: string };
  createdAt: string;
}

export interface KpiView {
  units: number;
  past30: {
    occupancy: number | null;
    adr: number | null;
    revpar: number | null;
    directShare: number | null;
  };
  next30: { occupancy: number | null };
  rating: number | null;
  responseMinutes: number | null;
}

export interface FeedItem {
  kind: string;
  text: string;
  createdAt: string;
}

/**
 * «Пульт управляющего» (GET …/hotel/manager): the state line, the approvals waiting as cards, the
 * latest decisions with where they were taken, the manager's messages and the numbers — the same
 * the side panel of the extension and the messenger bots show, with the server's words.
 */
export interface DeskView {
  rev: string;
  status: {
    agentsOn: number;
    agentsTotal: number;
    wave: number;
    pending: number;
    urgent: number;
  };
  approvals: Array<{
    id: string;
    agent: string;
    agentTitle: string;
    title: string;
    reason: string;
    cost: string | null;
    urgent: boolean;
    text: string | null;
    editable: boolean;
    /** A non-standard situation the manager hands over (older servers do not send it). */
    escalation?: {
      what: string;
      consequences: string;
      recommendation: string;
      held: string | null;
    } | null;
    createdAt: string;
    expiresAt: string;
  }>;
  decided: Array<{
    id: string;
    agent: string;
    agentTitle: string;
    title: string;
    status: 'approved' | 'rejected' | 'expired';
    outcome: string;
    mark: string;
    comment: string | null;
    decidedAt: string;
  }>;
  feed: Array<{
    id: string;
    kind: string;
    kindTitle: string;
    mark: string;
    text: string;
    decided: string | null;
    createdAt: string;
  }>;
  /** null — no rooms in the reference: nothing to count. */
  kpi: Array<{ id: string; label: string; value: string; sub: string }> | null;
}

/** The owner's extension on the Goldfish server; null — not known (no token issued yet). */
export interface ExtensionState {
  online: boolean;
  lastSeenAt: string | null;
}

/** «Сегодня»: what waits for the owner, how the setup and the study go. */
export interface TodayState extends CabinetState {
  desk: DeskView;
  /** «Изучение» with how it goes by system; null — an older Goldfish without it. */
  study: StudyView | null;
  extension: ExtensionState | null;
  /** The bots in the messengers: undefined when the site has no bots server (BOTS_URL). */
  bots?: BotsState | undefined;
}

/** «Объект»: the reference, the listings and the competitors. */
export interface PropertyState extends CabinetState {
  /** The latest draft of the reference from a card, while it is read or waits for the owner. */
  profileImport: ProfileImportView | null;
  listings: ListingSearchView | null;
  competitorSearch: CompetitorSearchView | null;
}

/** «Изучение» (GET …/hotel/study): the agents go through the cabinets and change nothing. */
export interface StudyView {
  on: boolean;
  since: string | null;
  items: Array<{
    system: string;
    title: string;
    status: 'running' | 'waiting_user' | 'done' | 'failed';
    outcome: string | null;
    taskId: string | null;
    startedAt: string;
  }>;
  /** Systems with an address to study. */
  targets: Array<{ system: string; title: string }>;
}

/** «Поиск объявлений на площадках» (GET …/hotel/listings). */
export interface ListingSearchView {
  id: string;
  status: 'searching' | 'ready';
  createdAt: string;
  platforms: Array<{
    platform: string;
    title: string;
    /** not_searched — no search was run there (only an address entered by hand is known). */
    status: 'searching' | 'found' | 'not_found' | 'failed' | 'not_searched';
    url: string | null;
    listingTitle: string | null;
    address: string | null;
    rating: string | null;
    match: 'likely' | 'unsure' | 'unlikely' | null;
    matchTitle: string | null;
    why: string | null;
    verdict: 'mine' | 'not_mine' | null;
    error: string | null;
    publishProposed: boolean;
    /** Found by a search before: read again by its address, not searched for. */
    recheck?: boolean;
    /** Read by its known address (the owner's listing or one found before), not searched for. */
    byLink?: boolean;
    /** The owner entered the address by hand. */
    manual?: boolean;
  }>;
}

/** «Поиск конкурентов» (GET …/hotel/competitors). */
export interface CompetitorSearchView {
  id: string;
  status: 'searching' | 'ready';
  createdAt: string;
  platforms: Array<{
    platform: string;
    title: string;
    status: string;
    found: number;
    error: string | null;
  }>;
  found: number;
  candidates: Array<{
    id: string;
    name: string;
    url: string | null;
    platform: string;
    score: number;
    reasons: string[];
    /** The owner's answer, else the agent's decision. */
    verdict: 'direct' | 'not' | 'unsure' | null;
    verdictTitle: string | null;
    /** Older Goldfish servers do not send what follows: there the owner decides alone. */
    by?: 'owner' | 'agent' | null;
    agent?: {
      verdict: 'direct' | 'not';
      reason: string;
      method: 'model' | 'rule' | 'owner';
    } | null;
    ownerReason?: string | null;
    description?: string | null;
    priceFrom?: number | null;
  }>;
  /** Direct competitors in this search. */
  direct?: number;
  /** Their prices («от»): the average and the median. */
  prices?: { n: number; mean: number; median: number; min: number; max: number } | null;
  competitors: Array<{ name: string; url: string }>;
}

/** «Эталон из карточки» (GET …/hotel/profile/import). */
export interface ProfileImportView {
  id: string;
  status: 'reading' | 'ready' | 'failed' | 'applied' | 'discarded';
  source: 'url' | 'text';
  url: string | null;
  platform: string | null;
  error: string | null;
  /** Read only in part (the reading stopped at a limit): why. Older servers do not send it. */
  partial?: string | null;
  createdAt: string;
  fields: Array<{ key: string; label: string; value: string; current: string }>;
}

const LEVELS: Level[] = ['self', 'rule', 'approval', 'off'];
const LEVEL_TITLES: Record<Level, string> = {
  self: 'Сам',
  rule: 'Правило',
  approval: 'Согласование',
  off: 'Выкл',
};
/** What each right means, in the words of the guide (/help#levels). */
const LEVEL_HINTS: Record<Level, string> = {
  self: 'делает сам и сообщает в сводке',
  rule: 'сам в пределах ваших лимитов, за ними — спрашивает',
  approval: 'каждое действие ждёт вашего «да»',
  off: 'ничего не делает',
};
const RANK: Record<Level, number> = { off: 0, approval: 1, rule: 2, self: 3 };
const MODES = { full: 'Работа', read: 'Только чтение', off: 'Выкл' } as const;
const MODE_HINTS = {
  full: 'сверяют и меняют',
  read: 'только сверяют',
  off: 'пропускают',
} as const;
const CATEGORIES: Record<string, string> = {
  pms: 'PMS и менеджеры каналов',
  sheet: 'Шахматка',
  guest: 'Площадки для гостей',
  b2b: 'Для турагентств',
  maps: 'Карты',
  ads: 'Реклама',
  site: 'Сайт',
  messenger: 'Мессенджер',
};
/** The manager's words for an older Goldfish without the desk (`deskFromParts`). */
const FEED_KIND: Record<string, { title: string; mark: string }> = {
  urgent: { title: 'Срочно', mark: '🔴' },
  summary: { title: 'Сводка', mark: '☀️' },
  approval: { title: 'Согласование', mark: '✋' },
  reminder: { title: 'Напоминание', mark: '⏰' },
  notice: { title: 'В сводку', mark: 'ℹ️' },
  answer: { title: 'Ответ', mark: '💬' },
};
/** The launch waves: what agents do in each (/help#waves). */
const WAVES: Array<{ name: string; text: string }> = [
  { name: 'Наблюдают', text: 'видеть всё и не терять брони' },
  { name: 'Советуют', text: 'отвечать и советовать' },
  { name: 'Действуют', text: 'действовать по правилам' },
];
const AGENT_ICONS: Record<string, keyof typeof ICONS> = {
  channels: 'channels',
  pricing: 'prices',
  guests: 'guests',
  reputation: 'reputation',
  direct: 'direct',
  manager: 'manager',
};
const attr = (v: unknown) => esc(JSON.stringify(v));
const pct = (n: number | null | undefined) =>
  n === null || n === undefined ? '—' : `${n.toLocaleString('ru-RU')}%`;
const rub = (n: number | null | undefined) =>
  n === null || n === undefined ? '—' : `${n.toLocaleString('ru-RU')} ₽`;
const when = (iso: string) =>
  new Date(iso).toLocaleString('ru-RU', {
    timeZone: 'Europe/Moscow',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
export const icon = (agent: string) => ICONS[AGENT_ICONS[agent] ?? 'manager'];
const dot = (l: Level) => `<span class="lvl lvl--${l}" aria-hidden="true"></span>`;
/** «1 обязанность», «3 обязанности», «9 обязанностей». */
const duties = (n: number) => {
  const tens = n % 100;
  const ones = n % 10;
  const word =
    tens > 10 && tens < 20
      ? 'обязанностей'
      : ones === 1
        ? 'обязанность'
        : ones >= 2 && ones <= 4
          ? 'обязанности'
          : 'обязанностей';
  return `${n} ${word}`;
};

// ---------------------------------------------------------------- shared

/** Whether a chat gets the manager's messages: a bot of the bots server or the Telegram of Goldfish. */
export function messengerLinked(h: HotelView, bots: BotsState | undefined): boolean {
  return h.telegramLinked || (!!bots && bots !== 'unavailable' && bots.links.length > 0);
}

// ---------------------------------------------------------------- «Сегодня»

const EXPIRE_AFTER_MS = 72 * 3_600_000;

/**
 * The desk from the separate answers of an older Goldfish (before GET …/hotel/manager): the page
 * looks the same, only the decisions taken are not known.
 */
export function deskFromParts(
  h: HotelView,
  approvals: ApprovalView[],
  k: KpiView | null,
  feed: FeedItem[],
): DeskView {
  const titles = new Map(h.settings.agents.map((a) => [a.id, a.title]));
  return {
    rev: '',
    status: {
      agentsOn: h.settings.agents.filter((a) => a.enabled).length,
      agentsTotal: h.settings.agents.length,
      wave: h.settings.wave,
      pending: approvals.length,
      urgent: approvals.filter((a) => a.urgent).length,
    },
    approvals: approvals.map((a) => ({
      id: a.id,
      agent: a.agent,
      agentTitle: titles.get(a.agent) ?? a.agent,
      title: a.title,
      reason: a.reason,
      cost: a.cost,
      urgent: a.urgent,
      text: a.action.text ?? null,
      editable: a.action.kind !== 'none',
      createdAt: a.createdAt,
      expiresAt: new Date(Date.parse(a.createdAt) + EXPIRE_AFTER_MS).toISOString(),
    })),
    decided: [],
    feed: feed.map((f, i) => ({
      id: String(i),
      kind: f.kind,
      kindTitle: FEED_KIND[f.kind]?.title ?? f.kind,
      mark: FEED_KIND[f.kind]?.mark ?? '•',
      text: f.text,
      decided: null,
      createdAt: f.createdAt,
    })),
    kpi:
      !k || !k.units
        ? null
        : [
            {
              id: 'next30',
              label: 'Загрузка вперёд',
              value: pct(k.next30.occupancy),
              sub: 'на 30 дней',
            },
            {
              id: 'occupancy',
              label: 'Загрузка',
              value: pct(k.past30.occupancy),
              sub: 'за 30 дней',
            },
            { id: 'adr', label: 'ADR', value: rub(k.past30.adr), sub: 'средняя цена ночи' },
            { id: 'revpar', label: 'RevPAR', value: rub(k.past30.revpar), sub: 'выручка на номер' },
            {
              id: 'direct',
              label: 'Прямые брони',
              value: pct(k.past30.directShare),
              sub: 'доля за 30 дней',
            },
            {
              id: 'rating',
              label: 'Рейтинг',
              value: k.rating === null ? '—' : String(k.rating).replace('.', ','),
              sub: 'на площадках',
            },
            {
              id: 'response',
              label: 'Первый ответ',
              value: k.responseMinutes === null ? '—' : `${k.responseMinutes} мин`,
              sub: 'гостю, в среднем',
            },
          ],
  };
}

function kpiTiles(tiles: DeskView['kpi']): string {
  const body = !tiles
    ? `<p class="notice">Добавьте в эталон номера и их количество — тогда управляющий посчитает загрузку, ADR и RevPAR. <a href="${cabinetHref('profile-title')}">Открыть эталон</a></p>`
    : `<div class="tiles">${tiles
        .map(
          (t) =>
            `<div class="tile"><span class="tile__label">${esc(t.label)}</span><b>${esc(t.value)}</b><span class="tile__sub">${esc(t.sub)}</span></div>`,
        )
        .join('')}</div>`;
  return `<section aria-labelledby="kpi-title">
    <div class="card__head"><h2 id="kpi-title" class="section-title">Показатели</h2>${helpLink('kpi', 'Что они значат?')}</div>
    ${body}
  </section>`;
}

/** A system as the reference keeps it: the address of the owner's cabinet and of the listing. */
type System = { id: string; url?: string; listingUrl?: string };

/** Where listings are entered: platforms for guests and the maps. */
export const LISTING_CATEGORIES = new Set(['guest', 'maps']);
/** The owner's CRM: a PMS or a chessboard table. */
export const CRM_CATEGORIES = new Set(['pms', 'sheet']);

/** What the owner gave so far; the setup list, the listings and the CRM form read it. */
export function setupFacts(
  h: HotelView,
  s: { user: UserRecord; bots?: BotsState | undefined; extension?: ExtensionState | null },
) {
  const systems = ((h.profile.systems ?? []) as System[]).filter((x) => x && x.id);
  const category = new Map(h.settings.platforms.map((p) => [p.id, p.category]));
  const title = new Map(h.settings.platforms.map((p) => [p.id, p.title]));
  return {
    systems,
    category,
    title: (id: string) => title.get(id) ?? id,
    listings: systems.filter((x) => !!x.listingUrl),
    crm: systems.find((x) => CRM_CATEGORIES.has(category.get(x.id) ?? '') && !!x.url) ?? null,
    extension: !!s.extension?.lastSeenAt,
    messenger: messengerLinked(h, s.bots),
    /** The agents were launched (the study began): the setup is over. */
    launched: !!s.user.onboardedAt,
  };
}

/** The level a new owner starts with: «Контролируемая автономность» over the server's default 4. */
export const START_AUTONOMY = 3;

/**
 * «Первые шаги»: the one list of what is left before the agents work — the extension, the
 * reference, the CRM, a messenger, the launch. Each step leads to the place where it is done; the
 * first one left is the main button. The launch is the last: it starts the study, in which the
 * agents only read. Hidden once everything is done.
 */
function firstSteps(s: TodayState, h: HotelView): string {
  const f = setupFacts(h, s);
  const rooms = (h.profile.rooms as unknown[] | undefined) ?? [];
  const messengers = !!s.bots;
  const levels = h.settings.autonomyLevels;
  const toStart =
    h.settings.autonomy === 4 && levels?.some((l) => l.level === START_AUTONOMY)
      ? ` Для начала поставим уровень автономности ${START_AUTONOMY} — потом его можно поменять на вкладке «Агенты».`
      : '';
  // Something to study: a listing or the cabinet of the CRM.
  const nothing = !f.listings.length && !f.crm;
  const blocked = !f.extension
    ? 'Сначала подключите расширение.'
    : nothing
      ? 'Изучать пока нечего: внесите ссылку на объявление или кабинет CRM.'
      : '';
  const steps: Array<{
    done: boolean;
    /** Not asked: it makes no sense for this owner or this server. */
    skip?: boolean;
    title: string;
    doneTitle: string;
    hint: string;
    action: string;
    href?: CabinetAnchor;
  }> = [
    {
      done: f.extension || f.launched,
      title: 'Установите расширение Goldfish',
      doneTitle: 'Расширение подключено',
      hint: 'Через него агенты открывают ваши кабинеты в вашем браузере, где вы уже вошли.',
      action: 'Установить',
      href: 'extension-title',
    },
    {
      done: !!h.profile.name && rooms.length > 0,
      title: 'Заполните эталон объекта',
      doneTitle: 'Эталон заполнен',
      hint: 'Название, номера и правила — проще всего по ссылке на ваше объявление: агент прочитает его сам.',
      action: 'Заполнить',
      href: 'profile-title',
    },
    {
      // Without a CRM the owner launches anyway: it is not asked after that.
      done: !!f.crm,
      skip: f.launched && !f.crm,
      title: 'Дайте ссылку на кабинет вашей CRM',
      doneTitle: f.crm ? `Кабинет CRM: ${f.title(f.crm.id)}` : 'Кабинет CRM',
      hint: 'Агенты будут сверять в ней брони, цены и наличие с площадками. Логин и пароль не нужны.',
      action: 'Указать',
      href: 'crm-title',
    },
    {
      done: f.messenger,
      // Nothing to link: no bots server and no Telegram bot of Goldfish.
      skip: !messengers && h.telegramBot === false,
      title: messengers ? 'Привяжите мессенджер' : 'Привяжите Telegram',
      doneTitle: messengers ? 'Мессенджер привязан' : 'Telegram привязан',
      hint: messengers
        ? 'Сводки, срочное и согласования придут в Telegram, MAX или WhatsApp — оттуда же можно поручать агентам задачи.'
        : 'Сводки, срочное и согласования придут в Telegram.',
      action: 'Привязать',
      href: 'telegram-title',
    },
    {
      done: f.launched,
      title: 'Запустите агентов',
      doneTitle: 'Агенты запущены',
      hint: `Сначала они только изучают ваши кабинеты и ничего не меняют — работу разрешаете вы.${toStart}`,
      action: 'Запустить изучение',
    },
  ];
  const asked = steps.filter((x) => !x.skip);
  const left = asked.filter((x) => !x.done).length;
  if (!left) return '';
  const next = asked.find((x) => !x.done);
  return `<section class="card steps-card" aria-labelledby="first-title">
    <div class="card__head"><h2 id="first-title">Первые шаги · осталось ${left} из ${asked.length}</h2></div>
    <div class="progress" aria-hidden="true">${asked.map((x) => `<span class="progress__seg${x.done ? ' progress__seg--done' : ''}"></span>`).join('')}</div>
    <ol class="checklist">
${asked
  .map((x, i) => {
    if (x.done)
      return `      <li class="checklist__done"><span class="checklist__mark" aria-hidden="true">✓</span><span class="checklist__body">${esc(x.doneTitle)}<span class="visually-hidden"> — готово</span></span></li>`;
    const main = x === next;
    const act = x.href
      ? `<a class="btn ${main ? 'btn--accent' : 'btn--ghost'} btn--sm" href="${cabinetHref(x.href)}">${x.action}</a>`
      : `<button class="btn ${main && !blocked ? 'btn--accent' : 'btn--ghost'} btn--sm" type="button" data-act="launch"${blocked ? ' disabled' : ''}>${x.action}</button>`;
    return `      <li class="checklist__todo${main ? ' checklist__next' : ''}"><span class="checklist__mark" aria-hidden="true">${asked.indexOf(x) + 1}</span><span class="checklist__body"><b>${esc(x.title)}</b><span class="hint">${esc(x.hint)}${!x.href && blocked ? ` <span class="warn">${esc(blocked)}</span>` : ''}</span></span><span class="checklist__act">${act}</span></li>`;
  })
  .join('\n')}
    </ol>
  </section>`;
}

/** «ещё 2 дня» until an approval expires without an answer. */
function timeLeft(iso: string, now = Date.now()): string {
  const hours = Math.max(0, Math.round((Date.parse(iso) - now) / 3_600_000));
  if (hours < 1) return 'истекает сейчас';
  if (hours < 24) return `ещё ${hours} ч`;
  const days = Math.round(hours / 24);
  return `ещё ${days} ${days === 1 ? 'день' : days < 5 ? 'дня' : 'дней'}`;
}

function approvalsBlock(list: DeskView['approvals']): string {
  if (!list.length)
    return `<div class="empty-state"><span class="empty-state__mark" aria-hidden="true">✓</span><div><b>Ничего не ждёт вашего решения</b><p class="hint">Когда агенту понадобится ваше «да», карточка появится здесь, в расширении и в мессенджере — решите там, где удобнее.</p></div></div>`;
  return list
    .map(
      (
        a,
      ) => `<article class="approval${a.urgent ? ' approval--urgent' : ''}" data-approval="${esc(a.id)}">
  <div class="approval__head"><span class="agent-icon agent-icon--sm" aria-hidden="true">${icon(a.agent)}</span><p class="approval__agent">${esc(a.agentTitle)} · ${esc(when(a.createdAt))}</p>${a.urgent ? '<span class="chip chip--bad">срочно</span>' : ''}</div>
  <h3>${esc(a.title)}</h3>
  ${
    a.escalation
      ? `<p class="approval__reason"><span class="approval__label">Что произошло:</span> ${esc(a.escalation.what)}</p>
  <p class="approval__reason"><span class="approval__label">Чем грозит:</span> ${esc(a.escalation.consequences)}</p>
  <p class="approval__reason"><span class="approval__label">Что рекомендую:</span> ${esc(a.escalation.recommendation)}</p>
  ${a.escalation.held ? `<p class="approval__reason"><span class="approval__label">До вашего решения приостановлено:</span> ${esc(a.escalation.held)}</p>` : ''}`
      : `<p class="approval__reason"><span class="approval__label">Почему:</span> ${esc(a.reason)}</p>`
  }
  ${a.cost ? `<p class="approval__cost"><span class="approval__label">Сколько стоит:</span> <b>${esc(a.cost)}</b></p>` : ''}
  ${a.text ? `<pre class="approval__text">${esc(a.text)}</pre>` : ''}
  <div class="row approval__actions">
    <button class="btn btn--accent btn--sm" type="button" data-act="approve" data-id="${esc(a.id)}">Согласовать</button>
    ${a.editable ? `<button class="btn btn--ghost btn--sm" type="button" data-act="edit-open" data-id="${esc(a.id)}">Изменить</button>` : ''}
    <button class="btn btn--ghost btn--sm btn--danger" type="button" data-act="reject" data-id="${esc(a.id)}">Отклонить</button>
    <span class="approval__left" title="Без ответа согласование истечёт ${esc(when(a.expiresAt))}">${esc(timeLeft(a.expiresAt))}</span>
  </div>
  ${
    a.editable
      ? `<form class="edit" data-form="edit" data-id="${esc(a.id)}" hidden>
    <textarea name="text" rows="4" aria-label="Новый текст">${esc(a.text ?? '')}</textarea>
    <span class="row"><button class="btn btn--accent btn--sm" type="submit">Изменить и согласовать</button><button class="btn btn--ghost btn--sm" type="button" data-act="edit-open" data-id="${esc(a.id)}">Отмена</button></span>
  </form>`
      : ''
  }
</article>`,
    )
    .join('');
}

/** What was decided in the last week and where: on the site, in the extension, in a messenger. */
function decidedBlock(list: DeskView['decided']): string {
  if (!list.length) return '';
  return `<details class="decided" open>
  <summary>Решено недавно</summary>
  <ul class="decided__list">${list
    .map(
      (d) =>
        `<li class="decided__item decided__item--${d.status}"><span class="decided__mark" aria-hidden="true">${esc(d.mark)}</span><span><b>${esc(d.title)}</b><span class="hint">${esc(d.agentTitle)} · ${esc(d.outcome)} · ${esc(when(d.decidedAt))}${d.comment ? ` · ${esc(d.comment)}` : ''}</span></span></li>`,
    )
    .join('')}</ul>
</details>`;
}

function feedBlock(feed: DeskView['feed']): string {
  if (!feed.length)
    return `<p class="hint">Сообщений пока нет. Утренняя сводка появится здесь, в расширении и в мессенджере.</p>`;
  return `<ul class="feed">${feed
    .map(
      (f) =>
        `<li class="feed__item feed__item--${esc(f.kind)}"><span class="feed__meta"><span class="chip chip--kind chip--${esc(f.kind)}">${esc(f.mark)} ${esc(f.kindTitle)}</span> ${esc(when(f.createdAt))}${f.decided ? ` <span class="chip chip--ok">${esc(f.decided)}</span>` : ''}</span><pre>${esc(f.text)}</pre></li>`,
    )
    .join('')}</ul>`;
}

/** Whether the desk has anything to say: before the agents are launched it would be all empty. */
export function deskShown(user: UserRecord, h: HotelView, desk: DeskView): boolean {
  return (
    !!user.onboardedAt || h.settings.agents.some((a) => a.enabled) || desk.approvals.length > 0
  );
}

/**
 * The live part of «Сегодня»: what waits for the owner, what was decided, the numbers and the
 * manager's messages. app.js asks for it again (GET /api/agents/today) and puts it in place when
 * the desk changed — a decision in a messenger or the extension shows here.
 */
export function todayPanel(s: { user: UserRecord; hotel: HotelView; desk: DeskView }): string {
  const d = s.desk;
  if (!deskShown(s.user, s.hotel, d)) return '';
  return `  <section class="card" aria-labelledby="approvals-title">
    <div class="card__head"><h2 id="approvals-title">Ждут решения${d.approvals.length ? ` · ${d.approvals.length}` : ''}</h2></div>
    ${approvalsBlock(d.approvals)}
    ${decidedBlock(d.decided)}
  </section>
  ${kpiTiles(d.kpi)}
  <section class="card" aria-labelledby="feed-title">
    <div class="card__head"><h2 id="feed-title">Сообщения управляющего</h2></div>
    ${feedBlock(d.feed)}
  </section>`;
}

// ---------------------------------------------------------------- «Изучение»

const STUDY_STATE: Record<StudyView['items'][number]['status'], { mark: string; text: string }> = {
  running: { mark: '…', text: 'изучает' },
  waiting_user: {
    mark: '!',
    text: 'ждёт вас: войдите в кабинет в окне агента или ответьте ему в боковой панели',
  },
  done: { mark: '✓', text: 'изучено' },
  failed: { mark: '×', text: 'не получилось' },
};

/** What app.js compares while it polls the study: a change reloads the page. */
export function studyPollState(st: StudyView): string {
  return JSON.stringify(st.items.map((x) => [x.system, x.status]));
}

/**
 * «Агенты изучают ваши кабинеты»: after the setup the agents only read — each cabinet and listing
 * with how its study goes. Nothing changes until the owner ends it here; then the agents work by
 * their rights and the autonomy level, which the confirmation names.
 */
function studyCard(h: HotelView, st: StudyView | null | undefined): string {
  if (!st?.on) return '';
  const items = new Map(st.items.map((x) => [x.system, x]));
  const rows = [
    ...st.targets.map((t) => ({ title: t.title, item: items.get(t.system) })),
    ...st.items
      .filter((x) => !st.targets.some((t) => t.system === x.system))
      .map((x) => ({ title: x.title, item: x })),
  ];
  const done = rows.filter((r) => r.item?.status === 'done').length;
  const busy = st.items.some((x) => x.status === 'running' || x.status === 'waiting_user');
  const list = rows.length
    ? `<ul class="study__list">${rows
        .map(({ title, item }) => {
          const state = item ? STUDY_STATE[item.status] : { mark: '·', text: 'ещё не изучалось' };
          const why = item?.status === 'failed' && item.outcome ? `: ${item.outcome}` : '';
          return `<li class="study__item study__item--${item?.status ?? 'new'}"><span class="study__mark" aria-hidden="true">${state.mark}</span><span><b>${esc(title)}</b><span class="hint">${esc(state.text + why)}</span></span></li>`;
        })
        .join('')}</ul>`
    : `<p class="hint">Изучать пока нечего: внесите ссылку на <a href="${cabinetHref('listings-title')}">объявление</a> или кабинет <a href="${cabinetHref('crm-title')}">CRM</a>.</p>`;
  const level = autonomyOf(h);
  const working = h.settings.agents.filter((a) => a.enabled).map((a) => a.title);
  const confirm = [
    'Закончить изучение и разрешить агентам работать?',
    working.length
      ? `Будут работать: ${working.join(', ')}.`
      : 'Сейчас не включён ни один агент — работать будет некому.',
    level
      ? `Дальше — по правам обязанностей и уровню автономности ${level.level} «${level.title}»:\n${level.rules.map((r) => `• ${r}`).join('\n')}`
      : 'Дальше агенты работают по правам своих обязанностей.',
    'Агентов и уровень можно поменять на вкладке «Агенты».',
  ].join('\n\n');
  return `<section class="card study" aria-labelledby="study-title"${busy ? ` data-study-poll="${esc(studyPollState(st))}"` : ''}>
    <div class="card__head"><h2 id="study-title">Агенты изучают ваши кабинеты</h2>${helpLink('study', 'Что это?')}</div>
    <p>Агенты открывают ваши объявления и кабинет CRM, проходят по разделам и запоминают дорогу к броням, ценам, сообщениям и отзывам — строят маршруты. <b>Ничего не меняют</b>: правки карточек, цены и ответы гостям сейчас запрещены и даже не предлагаются.</p>
    ${list}
    <p class="hint">Изучено ${done} из ${rows.length}. Агенты работают в вашем браузере — держите его открытым${busy ? '; страница обновится сама' : ''}.</p>
    <div class="row">
      <button class="btn btn--accent btn--sm" type="button" data-act="study-end" data-confirm="${esc(confirm)}">Закончить изучение — разрешить работу</button>
      <button class="btn btn--ghost btn--sm" type="button" data-act="study-start">Изучить ещё раз</button>
    </div>
  </section>`;
}

// ---------------------------------------------------------------- «Команда»

/** What the owner is asked before a change of the wave: which duties switch on or off. */
function waveConfirm(h: HotelView, target: number): string {
  const cur = h.settings.wave;
  const head = `Перейти к волне ${target} «${WAVES[target - 1]!.name}» — ${WAVES[target - 1]!.text}?`;
  if (target > cur) {
    const on = h.settings.agents
      .filter((a) => a.enabled)
      .flatMap((a) =>
        a.duties
          .filter(
            (d) => !d.enabled && d.wave > cur && d.wave <= target && /волн/.test(d.reason ?? ''),
          )
          .map((d) => `• ${a.title}: ${d.title}`),
      );
    return `${head}\n\n${on.length ? `Включатся с правами по умолчанию:\n${on.join('\n')}` : 'У включённых агентов новых обязанностей нет — обязанности этой волны заработают, когда вы включите агентов.'}\n\nПрава любой обязанности можно поменять в её карточке.`;
  }
  const off = h.settings.agents.flatMap((a) =>
    a.duties.filter((d) => d.enabled && d.wave > target).map((d) => `• ${a.title}: ${d.title}`),
  );
  return `${head}\n\n${off.length ? `Выключатся обязанности поздних волн (кроме включённых вами вручную):\n${off.join('\n')}` : 'Обязанности поздних волн сейчас не работают — ничего не выключится.'}`;
}

/** The level of autonomy the property has now, when the server tells it. */
function autonomyOf(h: HotelView): AutonomyLevel | undefined {
  const levels = h.settings.autonomyLevels;
  return levels?.find((l) => l.level === h.settings.autonomy);
}

/**
 * The manager's autonomy, 1–4: the four levels with what the manager does on each; another level
 * is chosen with a confirmation that says what changes.
 */
function autonomyBlock(h: HotelView): string {
  const levels = h.settings.autonomyLevels;
  const current = h.settings.autonomy;
  if (!levels?.length || !current) return '';
  const items = levels.map((l) => {
    const state = l.level === current ? 'current' : 'next';
    const confirm = `Уровень автономности ${l.level} — «${l.title}»?\n\n${l.rules.map((r) => `• ${r}`).join('\n')}`;
    return `<li class="wave wave--${state}">
        <span class="wave__num" aria-hidden="true">${l.level}</span>
        <span class="wave__text"><b>${esc(l.title)}</b><span class="hint">${esc(l.short)}</span></span>
        ${l.level === current ? '<span class="chip chip--ok">сейчас</span>' : `<button class="btn btn--ghost btn--xs" type="button" data-act="autonomy" data-level="${l.level}" data-title="${esc(l.title)}" data-confirm="${esc(confirm)}">Выбрать</button>`}
      </li>`;
  });
  const now = levels.find((l) => l.level === current);
  return `<div class="autonomy">
    <h3 id="autonomy-title">Уровень автономности управляющего</h3>
    <p class="hint hint--top">Сколько управляющий делает без вас — от полностью ручного управления до полной автономности. Права обязанностей могут сделать агентов строже, но не дадут больше, чем позволяет уровень. ${helpLink('autonomy', 'Что значат уровни?')}</p>
    <ol class="waves waves--autonomy">
      ${items.join('\n      ')}
    </ol>
    ${now ? `<ul class="list autonomy__rules" aria-label="Что делает управляющий сейчас">${now.rules.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>` : ''}
  </div>`;
}

function launchBlock(h: HotelView): string {
  const set = h.settings;
  const steps = WAVES.map((w, i) => {
    const n = i + 1;
    const state = n === set.wave ? 'current' : n < set.wave ? 'done' : 'next';
    return `<li class="wave wave--${state}">
        <span class="wave__num" aria-hidden="true">${n < set.wave ? '✓' : n}</span>
        <span class="wave__text"><b>${n}. ${esc(w.name)}</b><span class="hint">${esc(w.text)}</span></span>
        ${n === set.wave ? '<span class="chip chip--ok">сейчас</span>' : `<button class="btn btn--ghost btn--xs" type="button" data-act="wave" data-wave="${n}" data-confirm="${esc(waveConfirm(h, n))}">${n > set.wave ? 'Перейти' : 'Вернуться'}</button>`}
      </li>`;
  }).join('\n      ');
  const pause = set.pause
    ? `<div class="pause pause--on" role="status">
      <div><b>На паузе до ${esc(day(set.pause.until))}</b>${set.pause.reason ? ` · ${esc(set.pause.reason)}` : ''}<p class="hint">Записи на площадках и сообщения ждут; чтение и сводка идут.</p></div>
      <button class="btn btn--accent btn--sm" type="button" data-act="settings" data-changes="${attr([{ op: 'pause', until: null }])}" data-done="Пауза снята — агенты снова работают.">Снять паузу</button>
    </div>`
    : '';
  return `<section class="card" aria-labelledby="launch-title">
    <div class="card__head"><h2 id="launch-title">Режим работы</h2>${helpLink('waves', 'Что такое волны?')}</div>
    <p class="hint hint--top">Агенты включаются волнами: сначала только смотрят, потом советуют, потом действуют сами. Переходите дальше, когда доверяете им.</p>
    <ol class="waves">
      ${steps}
    </ol>
    ${autonomyBlock(h)}
    ${pause}
    <details class="pause-form">
      <summary>${set.pause ? 'Изменить паузу' : 'Поставить на паузу — ремонт, закрытый сезон'}</summary>
      <form class="row" data-form="pause">
        <label class="field"><span class="field__label">Пауза до</span><input name="until" type="date" required value="${esc(set.pause?.until ?? '')}"></label>
        <label class="field field--grow"><span class="field__label">Причина</span><input name="reason" value="${esc(set.pause?.reason ?? '')}" placeholder="ремонт, сезон закрыт"></label>
        <div class="field"><button class="btn btn--ghost btn--sm" type="submit">${set.pause ? 'Сохранить' : 'Поставить паузу'}</button></div>
      </form>
      <p class="hint">На паузе агенты ничего не меняют на площадках и не пишут гостям; чтение и сводка продолжаются.</p>
    </details>
  </section>`;
}

function legend(): string {
  return `<ul class="legend" aria-label="Что значат права">
${LEVELS.map((l) => `      <li>${dot(l)}<span><b>${LEVEL_TITLES[l]}</b> — ${LEVEL_HINTS[l]}</span></li>`).join('\n')}
    </ul>`;
}

/**
 * Rights of a duty as a row of buttons: the current one is pressed, those above the duty's
 * ceiling are disabled. While the agent is off the rights cannot be set: the switch comes first.
 */
function levelButtons(a: Agent, d: Duty): string {
  if (d.alwaysOn)
    return `<span class="chip chip--ok" title="Без неё вы теряете контроль над остальными">Всегда работает</span>`;
  const current = d.enabled ? d.level : 'off';
  return `<div class="seg" role="group" aria-label="Права «${esc(d.title)}»">${LEVELS.map((l) => {
    const above = RANK[l] > RANK[d.maxLevel];
    const disabled = !a.enabled || above;
    const title = above
      ? ` title="Для этой обязанности — не выше «${LEVEL_TITLES[d.maxLevel]}»"`
      : ` title="${esc(LEVEL_HINTS[l])}"`;
    return `<button class="seg__btn" type="button" data-act="level" data-duty="${esc(d.id)}" data-title="${esc(d.title)}" data-level="${l}" aria-pressed="${l === current}"${disabled ? ' disabled' : ''}${title}>${dot(l)}${LEVEL_TITLES[l]}</button>`;
  }).join('')}</div>`;
}

/**
 * «Выполнить» gives the duty to its agent now. A duty that is off is not run: the server answers
 * with a request for permission, and the page shows it (see the permission dialog).
 */
function runButton(d: Duty): string {
  if (d.alwaysOn) return '';
  return `<button class="btn btn--ghost btn--xs duty__run" type="button" data-act="run" data-duty="${esc(d.id)}" data-title="${esc(d.title)}">Выполнить</button>`;
}

function dutyRow(a: Agent, d: Duty, wave: number): string {
  const meta = [
    `<span>${esc(d.when)}</span>`,
    d.writes === undefined
      ? ''
      : `<span>${d.writes ? 'меняет данные или пишет' : 'только читает и считает'}</span>`,
    d.maxLevel !== 'self' && !d.alwaysOn
      ? `<span>права не выше «${LEVEL_TITLES[d.maxLevel]}»</span>`
      : '',
  ].filter(Boolean);
  const reason =
    !d.enabled && d.reason && a.enabled ? `<p class="duty__reason">${esc(d.reason)}</p>` : '';
  return `      <li class="duty${d.enabled ? '' : ' duty--off'}">
        <div class="duty__info">
          <h4>${esc(d.title)}${d.wave > wave ? ` <span class="badge">волна ${d.wave}</span>` : ''}</h4>
          <p class="duty__does">${esc(d.does)}</p>
          <p class="duty__meta">${meta.join('')}</p>
          ${reason}
        </div>
        <div class="duty__controls">${levelButtons(a, d)}${runButton(d)}</div>
      </li>`;
}

/**
 * An agent: icon, title, mission, the switch and how its duties are set are always visible; the
 * duties are folded by default (the page remembers which cards the owner opened, see app.js).
 */
function agentCard(a: Agent, wave: number): string {
  const working = a.duties.filter((d) => d.enabled);
  const counts = LEVELS.filter((l) => l !== 'off')
    .map((l) => [l, working.filter((d) => d.level === l).length] as const)
    .filter(([, n]) => n > 0);
  const state = a.enabled
    ? `<span class="agent__state agent__state--on">работает · ${working.length} из ${duties(a.duties.length)}</span>${counts.length ? `<span class="agent__levels">${counts.map(([l, n]) => `<span class="agent__level">${dot(l)}${LEVEL_TITLES[l]} — ${n}</span>`).join('')}</span>` : ''}`
    : `<span class="agent__state">выключен · ${duties(a.duties.length)} не работают</span>`;
  const titleId = `agent-${esc(a.id)}-title`;
  return `<article class="agent${a.enabled ? ' agent--on' : ''}" id="agent-${esc(a.id)}">
  <header class="agent__head">
    <span class="agent-icon" aria-hidden="true">${icon(a.id)}</span>
    <div class="agent__title">
      <h3 id="${titleId}">${esc(a.title)}</h3>
      <p class="agent__mission">${esc(a.mission)}</p>
    </div>
    <button class="switch" type="button" role="switch" aria-checked="${a.enabled}" aria-labelledby="${titleId}" data-act="settings" data-changes="${attr([{ op: 'agent', agent: a.id, enabled: !a.enabled }])}" data-done="«${esc(a.title)}» ${a.enabled ? 'выключен' : 'включён'}."><span class="switch__track" aria-hidden="true"><span class="switch__thumb"></span></span><span class="switch__text" aria-hidden="true">${a.enabled ? 'Работает' : 'Выключен'}</span></button>
  </header>
  <p class="agent__summary">${state}</p>
  <details class="agent__more" data-fold="agent:${esc(a.id)}">
  <summary>Обязанности и права · ${a.duties.length}</summary>
  ${a.enabled ? '' : `<p class="notice notice--soft">Агент выключен — обязанности не работают и права не меняются. Включите его переключателем выше; «Выполнить» спросит разрешение на один раз.</p>`}
  <p class="agent__metrics">Показатели: ${esc(a.metrics.join(', '))}</p>
  <ul class="duties-list">
${a.duties.map((d) => dutyRow(a, d, wave)).join('\n')}
  </ul>
  </details>
</article>`;
}

function teamBlock(h: HotelView): string {
  const set = h.settings;
  return `<section aria-labelledby="team-title">
    <div class="card__head"><h2 id="team-title" class="section-title">Агенты</h2><span class="row row--tight"><button class="link" type="button" data-fold-all="agent:">Развернуть всё</button>${helpLink('levels', 'Что значат права?')}</span></div>
    <p class="hint hint--top">Включите агента переключателем, затем раскройте его обязанности и выберите права каждой. «Выполнить» — дать задание сейчас; если обязанность выключена, агент спросит разрешение.</p>
    ${legend()}
    <div class="agents__list">
${set.agents.map((a) => agentCard(a, set.wave)).join('\n')}
    </div>
  </section>`;
}

// ---------------------------------------------------------------- «Объект»

const safeUrl = (url: string | null) => (url && /^https?:\/\//i.test(url) ? url : null);

/**
 * Where a running search stands: app.js computes the same from the polled state and reloads the
 * page when it changes, so what one platform found shows up while the others are still read.
 */
function pollState(platforms: Array<{ status: string; found?: number }>): string {
  return JSON.stringify(platforms.map((x) => [x.status, x.found ?? null]));
}

/** How the address of a listing looks on each platform, for the empty fields. */
const LISTING_PLACEHOLDERS: Record<string, string> = {
  ostrovok: 'https://ostrovok.ru/hotel/…',
  yandex_travel: 'https://travel.yandex.ru/hotels/…',
  avito: 'https://www.avito.ru/…',
  '101hotels': 'https://101hotels.com/main/cities/…',
  onetwotrip: 'https://www.onetwotrip.com/ru/hotels/…',
  ozon_travel: 'https://www.ozon.ru/travel/hotels/…',
  roomlink: 'https://roomlink.ru/…',
  yandex_maps: 'https://yandex.ru/maps/org/…',
  '2gis': 'https://2gis.ru/…/firm/…',
};

type ListingRow = ListingSearchView['platforms'][number];

/** What the table says next to a platform: the search's finding, or that the listing is connected. */
function listingState(
  x: ListingRow | undefined,
  url: string,
  l: ListingSearchView | null | undefined,
  fill: boolean,
): string {
  const open = safeUrl(url)
    ? `<a href="${esc(url)}" target="_blank" rel="noopener">открыть</a>`
    : '';
  const connected = (note: string) =>
    `<span class="ok-text">✓ подключена</span>${open ? ` ${open}` : ''}${note ? `<span class="hint">${esc(note)}</span>` : ''}${
      fill && url
        ? `<button class="btn btn--ghost btn--sm" type="button" data-act="import-from" data-url="${esc(url)}">Заполнить эталон</button>`
        : ''
    }`;
  if (x?.status === 'searching')
    return `<span class="muted">${x.byLink || x.recheck ? 'читает по ссылке…' : 'ищет…'}</span>`;
  if (x?.status === 'found') {
    const where = [x.address, x.rating && x.verdict === 'mine' ? `рейтинг ${x.rating}` : null]
      .filter(Boolean)
      .join(' · ');
    if (x.verdict === 'mine')
      return connected(
        [x.listingTitle, where, x.manual ? 'внесено вручную' : '', x.error]
          .filter(Boolean)
          .join(' · '),
      );
    if (x.verdict === 'not_mine') return '<span class="muted">найденное — не ваше</span>';
    const found = safeUrl(x.url);
    return `<span><span class="hint">Нашёл${x.matchTitle ? ` — ${esc(x.matchTitle)}` : ''}: ${found ? `<a href="${esc(found)}" target="_blank" rel="noopener">${esc(x.listingTitle ?? found)}</a>` : esc(x.listingTitle ?? '')}${where ? `, ${esc(where)}` : ''}${x.why ? `. ${esc(x.why)}` : ''}</span></span><span class="row row--tight"><button class="btn btn--accent btn--sm" type="button" data-act="listing-verdict" data-id="${esc(l!.id)}" data-platform="${esc(x.platform)}" data-mine="1">Моё</button><button class="btn btn--ghost btn--sm" type="button" data-act="listing-verdict" data-id="${esc(l!.id)}" data-platform="${esc(x.platform)}" data-mine="0">Не моё</button></span>`;
  }
  if (x?.status === 'failed')
    return `<span class="muted">не прочитано: ${esc(x.error ?? '')}</span>${open ? ` ${open}` : ''}`;
  if (url) return connected('');
  if (x?.status === 'not_found')
    return x.publishProposed
      ? '<span class="muted">объявления нет · размещение на согласовании</span>'
      : `<span class="muted">объявления нет</span><button class="btn btn--ghost btn--sm" type="button" data-act="listing-publish" data-id="${esc(l!.id)}" data-platform="${esc(x.platform)}" data-title="${esc(x.title)}">Разместить</button>`;
  return '';
}

/**
 * «Объявления на площадках»: where the property is listed, in one place. Each platform for guests
 * and each map has a field for the address of the owner's listing — a pasted address registers the
 * platform, a cleared one takes the listing out of the reference. The agent can search where no
 * address is known (the owner marks which found listing is theirs), check the cards against the
 * reference («Сверить») and put a listing where there is none («Разместить», each by approval).
 * A listing whose address is known is read by it: only the rest is searched.
 */
function listingsBlock(
  l: ListingSearchView | null | undefined,
  h: HotelView,
  referenceEmpty: boolean,
): string {
  const own = new Map(
    ((h.profile.systems ?? []) as System[])
      .filter((x) => x.listingUrl)
      .map((x) => [x.id, x.listingUrl!]),
  );
  const found = new Map((l?.platforms ?? []).map((x) => [x.platform, x]));
  const platforms = h.settings.platforms.filter((p) => LISTING_CATEGORIES.has(p.category));
  if (!platforms.length) return '';
  const searching = l?.status === 'searching';
  const rows = platforms.map((p) => {
    const url = own.get(p.id) ?? '';
    return `      <div class="listing-row" data-platform="${esc(p.id)}">
        <label class="field listing-row__field"><span class="field__label">${esc(p.title)}</span><input type="url" name="listing" data-platform="${esc(p.id)}" value="${esc(url)}" placeholder="${esc(LISTING_PLACEHOLDERS[p.id] ?? 'https://…')}" inputmode="url" spellcheck="false"></label>
        <div class="listing-row__state">${listingState(found.get(p.id), url, l, referenceEmpty && p.category === 'guest')}</div>
      </div>`;
  });
  const wait =
    searching && l
      ? `<div class="import import--wait" data-poll-url="/api/agents/listings" data-poll-state="${esc(pollState(l.platforms))}" role="status">
  <span class="spinner" aria-hidden="true"></span>
  <div><b>Агент ищет объявление: готово ${l.platforms.filter((x) => x.status !== 'searching').length} из ${l.platforms.length} площадок…</b><p class="hint">Площадки читаются параллельно; что уже найдено — в таблице, отмечать можно сразу. Страница обновится сама.</p></div>
</div>`
      : '';
  const mine = !!l && l.platforms.some((x) => x.verdict === 'mine');
  const searched = !!l && l.platforms.some((x) => x.status !== 'not_searched');
  return `<p class="hint hint--top">Вставьте ссылки на ваши объявления — как их видят гости. Где объявления нет, оставьте поле пустым.</p>
  ${wait}
  <form class="listings" data-form="listings-save" novalidate>
    <div class="listing-rows" role="group" aria-label="Объявления на площадках">
${rows.join('\n')}
    </div>
    <p class="error" data-form-error role="alert" hidden></p>
    <div class="row">
      <button class="btn btn--accent btn--sm" type="submit">Сохранить ссылки</button>
      ${searching ? '' : `<button class="btn btn--ghost btn--sm" type="button" data-act="listings-start">${searched ? 'Обновить поиск' : 'Найти объявления'}</button>`}
      ${mine && !searching ? '<button class="btn btn--ghost btn--sm" type="button" data-act="listings-sync" data-title="Сверить карточки с эталоном">Сверить карточки с эталоном</button>' : ''}
    </div>
  </form>
  <p class="hint">Нет ссылок? «Найти объявления» — агент поищет их там, где адрес не известен. «Сверить» — сравнит описание, удобства и правила в карточках с эталоном и предложит правки. «Разместить» — заполнит анкету объекта по эталону; вход, документы и отправку делаете вы.</p>`;
}

const VERDICTS: Array<['direct' | 'not' | 'unsure', string]> = [
  ['direct', 'Прямой конкурент'],
  ['not', 'Нет'],
  ['unsure', 'Не уверен'],
];

/** Who decided about a candidate and why: the owner's answer, or the agent by itself. */
function decision(x: CompetitorSearchView['candidates'][number]): string {
  if (x.by === 'owner')
    return `<span class="by by--owner">вы: ${esc(x.verdictTitle ?? '')}</span>${x.ownerReason ? ` ${esc(x.ownerReason)}` : ''}${x.agent && x.agent.verdict !== x.verdict ? ` <span class="muted">(агент считал: ${x.agent.verdict === 'direct' ? 'прямой' : 'не конкурент'})</span>` : ''}`;
  if (x.by === 'agent' && x.agent)
    return `<span class="by by--${x.agent.verdict === 'direct' ? 'agent' : 'not'}">${x.agent.method === 'owner' ? 'как вы ответили раньше' : 'агент'}: ${x.agent.verdict === 'direct' ? 'прямой конкурент' : 'не конкурент'}</span> ${esc(x.agent.reason)}`;
  return '';
}

/**
 * The competitors the agents compare prices with (up to 10): those the agent chose and those the
 * owner added by hand. The list is saved on its own, and the server changes only it — what the
 * agent found since the page was opened in the rest of the reference stays.
 */
function competitorsList(h: HotelView): string {
  const list = Array.isArray(h.profile.competitors)
    ? (h.profile.competitors as Array<Record<string, unknown>>)
    : [];
  return `<form class="competitors-edit" data-form="competitors-save" novalidate>
    <p class="hint hint--top" data-competitors-count>В списке ${list.length} из 10. Их цены агент сравнивает с вашими; добавьте своих или уберите лишних.</p>
    ${listEditor(
      'competitors',
      [
        { key: 'name', label: 'Название', type: 'text', required: true, wide: true },
        {
          key: 'url',
          label: 'Ссылка',
          type: 'url',
          required: true,
          placeholder: 'https://ostrovok.ru/hotel/…',
          wide: true,
        },
      ],
      list,
      'Добавить конкурента',
      '<button class="btn btn--accent btn--sm" type="submit">Сохранить список</button>',
    )}
    <p class="error" data-form-error role="alert" hidden></p>
  </form>`;
}

/**
 * The search for competitors: it starts by the owner's button (that is the consent). When every
 * platform is read, the agent decides about each candidate itself: direct ones join the list of
 * competitors and their prices go to «Цены». The owner corrects any decision; the answers train
 * the search.
 */
function competitorsBlock(c: CompetitorSearchView | null | undefined): string {
  const start = (label: string) =>
    `<button class="btn btn--${label === 'Найти конкурентов' ? 'accent' : 'ghost'} btn--sm" type="button" data-act="competitors-start">${label}</button>`;
  if (!c)
    return `<p class="hint">Агент найдёт объекты рядом и сам решит, кто ваш прямой конкурент: сравнит тип, описание, номера, удобства, место и цену. Прямых он добавит в список выше, посчитает их среднюю и медианную цену и порекомендует вашу. Любое его решение можно поправить — ответ он запомнит. Поиск начнётся только по кнопке.</p>
  ${start('Найти конкурентов')}`;
  // While the search runs, what is found so far is shown without decisions: the agent decides
  // about the best of all platforms once every platform is read.
  const searching = c.status === 'searching';
  const decided = c.candidates.some((x) => x.by !== undefined);
  const item = (x: CompetitorSearchView['candidates'][number]) => {
    const url = safeUrl(x.url);
    const why = searching ? '' : decision(x);
    return `    <li class="competitor${x.verdict === 'direct' ? ' competitor--direct' : ''}" data-candidate="${esc(x.id)}">
      <div><b>${url ? `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(x.name)}</a>` : esc(x.name)}</b> <span class="muted">${esc(x.platform)}${x.priceFrom ? ` · от ${esc(rub(x.priceFrom))}` : ''}</span></div>
${
  why
    ? `      <div class="competitor__why">${why}</div>
`
    : ''
}      <div class="hint">${esc(x.reasons.join(', '))}${x.description ? ` — ${esc(x.description)}` : ''}</div>
${searching ? '' : `      <div class="row row--tight verdicts">${VERDICTS.map(([v, label]) => `<button class="btn btn--ghost btn--sm" type="button" data-act="competitor-verdict" data-id="${esc(x.id)}" data-verdict="${v}" aria-pressed="${x.verdict === v}">${label}</button>`).join('')}</div>\n`}    </li>`;
  };
  if (searching) {
    const where = c.platforms
      .map(
        (x) =>
          `${esc(x.title)} — ${x.status === 'searching' ? 'ищет…' : x.status === 'failed' ? `не прочитано${x.error ? `: ${esc(x.error)}` : ''}` : `найдено ${x.found}`}`,
      )
      .join('; ');
    return `<div class="import import--wait" data-poll-url="/api/agents/competitors" data-poll-state="${esc(pollState(c.platforms))}" role="status">
  <span class="spinner" aria-hidden="true"></span>
  <div><b>Агент ищет конкурентов: ${where}</b><p class="hint">Обычно около 5 минут. Кто из найденных прямой конкурент, агент решит, когда поиск закончится. Страница обновится сама.</p></div>
</div>
${c.candidates.length ? `<p class="hint">Пока найдено ${c.found}, самые похожие:</p><ol class="competitors">\n${c.candidates.map(item).join('\n')}\n  </ol>` : ''}`;
  }
  if (!c.candidates.length)
    return `<p class="hint">Похожих объектов рядом не нашлось.</p>
  ${start('Искать заново')}`;
  const summary = decided
    ? `<p class="hint">Нашёл ${c.found}, агент отобрал прямых конкурентов: ${c.direct ?? c.candidates.filter((x) => x.verdict === 'direct').length}. Не согласны — нажмите свой ответ, агент его запомнит.</p>
  ${c.prices ? `<p class="competitors__prices">Их цены «от»: средняя <b>${esc(rub(c.prices.mean))}</b>, медиана <b>${esc(rub(c.prices.median))}</b> <span class="muted">(${c.prices.n}, от ${esc(rub(c.prices.min))} до ${esc(rub(c.prices.max))})</span></p>` : ''}`
    : `<p class="hint">Нашёл ${c.found}, вот самые похожие. Отметьте прямых конкурентов.</p>`;
  return `${summary}
  <ol class="competitors">
${c.candidates.map(item).join('\n')}
  </ol>
  <div class="row">
    <a class="btn btn--accent btn--sm" href="${TAB_PATH.prices}">Цены и рекомендация</a>
    ${start('Искать заново')}
  </div>`;
}

/**
 * «Заполнить из карточки»: a link to the property's card on any aggregator, or its text. While
 * the agent reads it, the page waits (app.js polls); a ready draft shows the found fields next
 * to the current ones, each with a checkbox. Nothing changes until the owner applies.
 */
export function importBlock(imp: ProfileImportView | null | undefined): string {
  const where = imp?.platform ? ` на ${esc(imp.platform)}` : '';
  if (imp?.status === 'reading')
    return `<div class="import import--wait" data-import-poll="${esc(imp.id)}" role="status">
  <span class="spinner" aria-hidden="true"></span>
  <div>
    <b>Агент читает карточку${where}…</b>
    <p class="hint">Обычно 1–3 минуты. Браузер с расширением Goldfish должен быть открыт. Страница обновится сама.</p>
  </div>
</div>`;
  if (imp?.status === 'ready')
    return `<form class="import import--ready" data-form="import-apply" data-id="${esc(imp.id)}">
  <h3>Черновик из карточки${where}: найдено ${imp.fields.length}</h3>
${imp.partial ? `  <p class="hint warn">Карточка прочитана не полностью (${esc(imp.partial)}) — части полей может не быть. Примените найденное и пришлите карточку ещё раз или вставьте её текст.</p>\n` : ''}  <p class="hint">Отметьте, что перенести в эталон. Списки дополняются, а не заменяются; у новых номеров количество — 1, проверьте его потом в разделе «Номера».</p>
  <div class="table-scroll"><table class="duties import__table">
    <thead><tr><th><span class="visually-hidden">Перенести</span></th><th>Поле</th><th>Из карточки</th><th>Сейчас в эталоне</th></tr></thead>
    <tbody>
${imp.fields
  .map(
    (f) =>
      `      <tr><td><input type="checkbox" name="field" value="${esc(f.key)}" checked aria-label="Перенести «${esc(f.label)}»"></td><td>${esc(f.label)}</td><td>${esc(f.value)}</td><td class="muted">${f.current ? esc(f.current) : '—'}</td></tr>`,
  )
  .join('\n')}
    </tbody>
  </table></div>
  <div class="row">
    <button class="btn btn--accent btn--sm" type="submit">Применить выбранное</button>
    <button class="btn btn--ghost btn--sm" type="button" data-act="import-discard" data-id="${esc(imp.id)}">Не применять</button>
  </div>
</form>`;
  return `<div class="import">
  <h3>Заполнить из карточки</h3>
  <p class="hint">Пришлите ссылку на карточку вашего объекта на Авито, Яндекс Путешествиях, Островке или другом агрегаторе — агент прочитает её и предложит, что перенести в эталон. Без вашего «применить» ничего не изменится.</p>
  <form class="field__row" data-form="import-url">
    <input name="url" type="url" required placeholder="https://www.avito.ru/…" aria-label="Ссылка на карточку объекта">
    <button class="btn btn--accent btn--sm" type="submit">Заполнить</button>
  </form>
  <details class="import__text">
    <summary>Нет ссылки или карточка не открывается? Вставьте её текст</summary>
    <form data-form="import-text">
      <textarea name="text" rows="5" required aria-label="Текст карточки" placeholder="Скопируйте со страницы карточки описание, номера с ценами, удобства и правила"></textarea>
      <button class="btn btn--ghost btn--sm" type="submit">Разобрать текст</button>
    </form>
  </details>
  <p class="error" data-import-error role="alert" hidden></p>
</div>`;
}

/** Topics of guest questions Goldfish recognises (the reference's `faq[].topic`). */
const FAQ_TOPICS: Array<[string, string]> = [
  ['parking', 'Парковка'],
  ['checkin', 'Заезд'],
  ['pets', 'Животные'],
  ['price', 'Цена'],
  ['transfer', 'Трансфер'],
  ['breakfast', 'Завтрак'],
  ['other', 'Другое'],
];

interface ListColumn {
  key: string;
  label: string;
  type: 'text' | 'number' | 'url' | 'topic' | 'textarea';
  required?: boolean;
  placeholder?: string;
  /** Takes the rest of the row. */
  wide?: boolean;
}

/**
 * A list of the reference (rooms, answers, extras, competitors) as rows of fields instead of
 * JSON. Each row keeps the item it was made from (`data-item`): app.js changes only the fields
 * shown, so what the page does not show (a room's photos, a question's wording) is kept.
 */
function listEditor(
  key: string,
  cols: ListColumn[],
  items: Array<Record<string, unknown>>,
  add: string,
  /** More buttons of the list, next to the one that adds a row. */
  extra = '',
): string {
  const cell = (c: ListColumn, value: unknown) => {
    const v = value === undefined || value === null ? '' : String(value);
    const label = `<span class="field__label">${esc(c.label)}</span>`;
    const common = `data-key="${c.key}" data-type="${c.type === 'number' ? 'number' : 'text'}"${c.required ? ' data-required' : ''}`;
    if (c.type === 'topic')
      return `<label class="field"><span class="field__label">${esc(c.label)}</span><select ${common}>${FAQ_TOPICS.map(([t, title]) => `<option value="${t}"${t === v ? ' selected' : ''}>${title}</option>`).join('')}</select></label>`;
    if (c.type === 'textarea')
      return `<label class="field field--wide">${label}<textarea ${common} rows="2" placeholder="${esc(c.placeholder ?? '')}">${esc(v)}</textarea></label>`;
    return `<label class="field${c.wide ? ' field--wide' : ''}">${label}<input ${common} type="${c.type === 'number' ? 'number' : c.type}"${c.type === 'number' ? ' min="0" inputmode="numeric"' : ''} value="${esc(v)}" placeholder="${esc(c.placeholder ?? '')}"></label>`;
  };
  const row = (item: Record<string, unknown>) =>
    `<div class="list-edit__row" data-item="${attr(item)}">${cols.map((c) => cell(c, item[c.key])).join('')}<button class="list-edit__remove" type="button" data-list-remove aria-label="Удалить строку" title="Удалить">×</button></div>`;
  return `<div class="list-edit list-edit--${esc(key)}" data-list="${esc(key)}">
    <div class="list-edit__rows">${items.map(row).join('')}</div>
    <template data-list-template>${row({})}</template>
    <button class="btn btn--ghost btn--sm" type="button" data-list-add>+ ${esc(add)}</button>${extra}
  </div>`;
}

/**
 * «Системы и площадки»: every system Goldfish knows, by kind, with a checkbox and the address of
 * the owner's cabinet. A connected system keeps its other fields (messages, commission…).
 */
function systemsEditor(h: HotelView): string {
  const connected = new Map(
    ((h.profile.systems ?? []) as Array<Record<string, unknown> & { id: string }>).map((s) => [
      s.id,
      s,
    ]),
  );
  const known = new Set(h.settings.platforms.map((p) => p.id));
  const groups = new Map<string, HotelView['settings']['platforms']>();
  // The CRM has a form of its own (the cabinet's «Настройки»); a form does not drop what it does not show.
  for (const p of h.settings.platforms.filter((x) => !CRM_CATEGORIES.has(x.category))) {
    const list = groups.get(p.category) ?? [];
    list.push(p);
    groups.set(p.category, list);
  }
  const field = (
    item: Record<string, unknown> | undefined,
    key: string,
    label: string,
    type: 'url' | 'number',
    title: string,
  ) =>
    `<label class="field"><span class="field__label">${label}</span><input type="${type}" data-key="${key}" data-type="${type === 'number' ? 'number' : 'text'}"${type === 'number' ? ' min="0" max="100" step="0.1"' : ' placeholder="https://…"'} value="${esc(String(item?.[key] ?? ''))}" aria-label="${label}: ${esc(title)}"></label>`;
  const sys = (id: string, title: string, category: string) => {
    const item = connected.get(id);
    // Platforms for guests and agencies also have chats, reviews and a commission; the listing of
    // a platform for guests is in «Объявления на площадках», only the agencies' is here.
    const b2b = category === 'b2b';
    const more =
      category === 'guest' || b2b
        ? `<details class="sys__more"${item && (item.messagesUrl || item.reviewsUrl || (b2b && item.listingUrl) || item.commissionPercent !== undefined) ? ' open' : ''}>
          <summary>Сообщения, отзывы, комиссия</summary>
          ${field(item, 'messagesUrl', 'Страница сообщений гостей', 'url', title)}
          ${field(item, 'reviewsUrl', 'Страница отзывов', 'url', title)}
          ${b2b ? field(item, 'listingUrl', 'Ваше объявление, как его видят гости', 'url', title) : ''}
          ${field(item, 'commissionPercent', 'Комиссия площадки, %', 'number', title)}
        </details>`
        : '';
    return `<div class="sys" data-sys="${esc(id)}" data-item="${attr(item ?? { id })}">
        <label class="sys__check"><input type="checkbox" data-sys-on${item ? ' checked' : ''}> ${esc(title)}</label>
        <input class="sys__url" type="url" data-key="url" data-type="text" value="${esc(String(item?.url ?? ''))}" placeholder="адрес вашего кабинета, https://…" aria-label="Адрес кабинета: ${esc(title)}">
        ${more}
      </div>`;
  };
  const other = [...connected.keys()].filter((id) => !known.has(id));
  return `<div class="systems-edit" data-systems>
${[...groups]
  .map(
    ([cat, list]) => `    <fieldset class="sys-group">
      <legend>${esc(CATEGORIES[cat] ?? cat)}</legend>
      ${list.map((p) => sys(p.id, p.title, p.category)).join('\n      ')}
    </fieldset>`,
  )
  .join('\n')}
${other.length ? `    <fieldset class="sys-group"><legend>Другие</legend>${other.map((id) => sys(id, id, 'other')).join('')}</fieldset>` : ''}
  </div>`;
}

/** A part of the reference: folded, with what is filled in it next to the title. */
function group(id: string, title: string, note: string, open: boolean, body: string): string {
  return `<details class="group" id="${id}"${open ? ' open' : ''}>
    <summary><span>${esc(title)}</span>${note ? `<span class="group__note">${esc(note)}</span>` : ''}</summary>
    <div class="group__body">${body}</div>
  </details>`;
}

function profileForm(h: HotelView): string {
  const p = h.profile as Record<string, unknown>;
  const policies = (p.policies ?? {}) as Record<string, string>;
  const corridor = (p.priceCorridor ?? { percent: 10 }) as { percent: number };
  const list = (k: string) => (Array.isArray(p[k]) ? (p[k] as Array<Record<string, unknown>>) : []);
  const rooms = list('rooms');
  const systems = list('systems');
  const faq = list('faq');
  const upsells = list('upsells');
  const units = rooms.reduce((n, r) => n + (Number(r.count) || 0), 0);
  const text = (name: string, label: string, value: unknown, type = 'text', placeholder = '') =>
    `<label class="field"><span class="field__label">${esc(label)}</span><input name="${esc(name)}" type="${type}" value="${esc(String(value ?? ''))}"${placeholder ? ` placeholder="${esc(placeholder)}"` : ''}></label>`;
  return `<form class="profile" data-form="profile">
  ${group(
    'profile-main',
    'Основное',
    p.name ? String(p.name) : 'не заполнено',
    !p.name,
    `<div class="grid2">
    ${text('name', 'Название', p.name, 'text', 'как на площадках')}
    ${text('address', 'Адрес', p.address)}
    ${text('phone', 'Телефон', p.phone)}
    ${text('website', 'Сайт', p.website ?? '', 'url', 'https://…')}
  </div>`,
  )}
  ${group(
    'profile-rooms',
    'Номера',
    rooms.length
      ? `${rooms.length} категор${rooms.length === 1 ? 'ия' : rooms.length < 5 ? 'ии' : 'ий'}, номеров — ${units}`
      : 'не заполнено',
    !rooms.length,
    `<p class="hint hint--top">Категории номеров, как на площадках. Без них управляющий не посчитает загрузку, ADR и RevPAR.</p>
  ${listEditor(
    'rooms',
    [
      {
        key: 'name',
        label: 'Категория',
        type: 'text',
        required: true,
        placeholder: 'Стандарт',
        wide: true,
      },
      { key: 'count', label: 'Сколько номеров', type: 'number', required: true, placeholder: '1' },
      { key: 'capacity', label: 'Гостей', type: 'number', placeholder: '2' },
      { key: 'basePrice', label: 'Базовая цена ночи, ₽', type: 'number', placeholder: '5000' },
    ],
    rooms,
    'Добавить категорию',
  )}`,
  )}
  ${group(
    'profile-systems',
    'Системы и площадки',
    systems.length ? `подключено ${systems.length}` : 'ничего не отмечено',
    !systems.length,
    `<p class="hint hint--top">Отметьте площадки, карты, рекламу и другие кабинеты, где ведёте объект. Адрес кабинета — ссылка, по которой вы входите; агенты работают в вашем браузере с вашими входами. CRM указывается в «Настройках», ссылки на объявления — в блоке «Объявления на площадках» ниже.</p>
  ${systemsEditor(h)}`,
  )}
  ${group(
    'profile-rules',
    'Заезд и правила',
    `заезд с ${p.checkIn ?? '—'}, выезд до ${p.checkOut ?? '—'}`,
    false,
    `<div class="grid2">
    ${text('checkIn', 'Заезд с', p.checkIn, 'time')}
    ${text('checkOut', 'Выезд до', p.checkOut, 'time')}
    ${text('policies.children', 'Дети', policies.children, 'text', 'с любого возраста')}
    ${text('policies.pets', 'Животные', policies.pets, 'text', 'можно, 500 ₽ в сутки')}
    ${text('policies.prepayment', 'Предоплата', policies.prepayment, 'text', '30% при бронировании')}
    ${text('policies.cancellation', 'Отмена', policies.cancellation, 'text', 'бесплатно за 3 дня')}
  </div>
  <label class="field"><span class="field__label">Как добраться</span><textarea name="directions" rows="2">${esc(String(p.directions ?? ''))}</textarea></label>
  <label class="field"><span class="field__label">Удобства (через запятую)</span><input name="amenities" value="${esc(((p.amenities as string[]) ?? []).join(', '))}" placeholder="Wi-Fi, парковка, мангал"></label>`,
  )}
  ${group(
    'profile-faq',
    'Ответы гостям',
    faq.length ? `готовых ответов — ${faq.length}` : 'нет',
    false,
    `<p class="hint hint--top">Готовые ответы на частые вопросы: агент «Гости» отправит их как есть. На жалобы агент сам не отвечает — пришлёт вам черновик.</p>
  ${listEditor(
    'faq',
    [
      { key: 'topic', label: 'Тема', type: 'topic' },
      {
        key: 'answer',
        label: 'Ответ',
        type: 'textarea',
        required: true,
        placeholder: 'Парковка во дворе, бесплатно.',
      },
    ],
    faq,
    'Добавить ответ',
  )}`,
  )}
  ${group(
    'profile-prices',
    'Цены, допродажи, реклама',
    `коридор ±${corridor.percent}%`,
    false,
    `<div class="grid2">
    ${text('corridor', 'Коридор цены, ± % от базовой', corridor.percent, 'number')}
    ${text('adsMonthlyBudget', 'Бюджет рекламы в месяц, ₽', p.adsMonthlyBudget ?? '', 'number', 'не задан')}
  </div>
  <p class="hint hint--top">В коридоре «Цены и загрузка» меняют цену по правилу, за коридором — только с вашего согласия.</p>
  <h4 class="group__sub">Допродажи</h4>
  ${listEditor(
    'upsells',
    [
      {
        key: 'name',
        label: 'Что',
        type: 'text',
        required: true,
        placeholder: 'Ранний заезд',
        wide: true,
      },
      { key: 'price', label: 'Цена, ₽', type: 'number', placeholder: '1000' },
    ],
    upsells,
    'Добавить допродажу',
  )}`,
  )}
  <input type="hidden" name="base" value="${attr(p)}">
  <div class="savebar">
    <button class="btn btn--accent" type="submit">Сохранить эталон</button>
    <span class="hint">Версия ${h.profileVersion}. Изменения сразу уходят агентам: «Каналы продаж» подготовят одно согласование правок для всех площадок.</span>
  </div>
  <p class="error" data-error role="alert" hidden></p>
</form>`;
}

// ---------------------------------------------------------------- «Агенты»: the platforms

/** What the agents may do on each platform the owner is on: work, only read, or skip it. */
function platformsBlock(h: HotelView): string {
  const connected = new Set((h.profile.systems ?? []).map((s) => s.id));
  const list = h.settings.platforms.filter((p) => connected.has(p.id));
  if (!list.length)
    return `<p class="hint">Площадки и системы появятся здесь, когда вы подключите их: ссылки на объявления — в разделе «<a href="${cabinetHref('listings-title')}">Объект</a>», CRM — в «<a href="${cabinetHref('crm-title')}">Настройках</a>».</p>`;
  return `<ul class="platforms">
${list
  .map(
    (p) =>
      `    <li class="platform"><span class="platform__title"><b>${esc(p.title)}</b><span class="muted">${esc(CATEGORIES[p.category] ?? p.category)} · агенты ${MODE_HINTS[p.mode]}</span></span><span class="seg seg--modes" role="group" aria-label="Режим: ${esc(p.title)}">${(
        Object.keys(MODES) as Array<keyof typeof MODES>
      )
        .map(
          (m) =>
            `<button class="seg__btn" type="button" data-act="platform" data-platform="${esc(p.id)}" data-title="${esc(p.title)}" data-mode="${m}" aria-pressed="${m === p.mode}" title="Агенты ${MODE_HINTS[m]}">${MODES[m]}</button>`,
        )
        .join('')}</span></li>`,
  )
  .join('\n')}
  </ul>`;
}

// ---------------------------------------------------------------- the pages

/**
 * «Сегодня»: the first steps while something is left, the study while the agents read, then what
 * waits for the owner — decisions, numbers, the manager's messages (the part that refreshes itself).
 */
export function renderToday(s: TodayState): string {
  const h = s.hotel;
  return cabinetPage(
    s,
    'today',
    h
      ? `  ${studyCard(h, s.study)}
  ${firstSteps(s, h)}
  <div class="stack" data-today data-rev="${esc(s.desk.rev)}">
${todayPanel({ user: s.user, hotel: h, desk: s.desk })}
  </div>`
      : '',
  );
}

/** «Агенты»: the mode of work (waves, autonomy, pause), the agents with their rights, the platforms. */
export function renderTeam(s: CabinetState): string {
  const h = s.hotel;
  return cabinetPage(
    s,
    'agents',
    h
      ? `  ${launchBlock(h)}
  ${teamBlock(h)}
  <section class="card" aria-labelledby="platforms-title">
    <div class="card__head"><h2 id="platforms-title">Площадки</h2>${helpLink('platforms', 'Что значат режимы?')}</div>
    <p class="hint hint--top">Что агентам можно на каждой подключённой площадке: работать, только сверять или пропускать её.</p>
    ${platformsBlock(h)}
  </section>`
      : '',
  );
}

/** «Объект»: the reference (from a card or by hand), where the property is listed, the competitors. */
export function renderProperty(s: PropertyState): string {
  const h = s.hotel;
  const rooms = (h?.profile.rooms as unknown[] | undefined) ?? [];
  return cabinetPage(
    s,
    'property',
    h
      ? `  <section class="card" aria-labelledby="profile-title">
    <div class="card__head"><h2 id="profile-title">Эталон объекта</h2>${helpLink('profile-card', 'Как заполнить?')}</div>
    <p class="hint hint--top">Единый источник правды для всех агентов: по нему сверяются карточки и сайт, из него собираются ответы гостям.</p>
    ${importBlock(s.profileImport)}
    <details class="profile__manual"${s.profileImport?.status === 'ready' ? '' : ' open'}>
      <summary>Заполнить вручную</summary>
      ${profileForm(h)}
    </details>
  </section>
  <section class="card" aria-labelledby="listings-title">
    <div class="card__head"><h2 id="listings-title">Объявления на площадках</h2></div>
    ${listingsBlock(s.listings, h, !h.profile.name || !rooms.length)}
  </section>
  <section class="card" aria-labelledby="competitors-title">
    <div class="card__head"><h2 id="competitors-title">Конкуренты</h2>${helpLink('competitors-auto', 'Как агент решает?')}</div>
    ${competitorsList(h)}
    <h3 class="card__sub">Найти конкурентов</h3>
    ${competitorsBlock(s.competitorSearch)}
  </section>`
      : '',
  );
}
