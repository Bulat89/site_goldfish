import type { AccessState } from '../access.js';
import type { AssetUrls } from '../static.js';
import type { UserRecord } from '../store/types.js';

export type Notice = 'login_denied' | 'login_expired' | 'login_error';

export interface View {
  assets: AssetUrls;
  goldfishUrl: string;
  privacyUrl?: string | undefined;
  supportEmail?: string | undefined;
}

interface PageState extends View {
  user: UserRecord | null;
  access: AccessState | null;
  notice: Notice | null;
}

export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** «2026-11-20» → «20.11.2026». */
export const day = (ymd: string) => {
  const [y, m, d] = ymd.split('-');
  return y && m && d ? `${d}.${m}.${y}` : ymd;
};

/** «Как это сделать?» next to a place on the site: the guide's answer about it (/help#id). */
export const helpLink = (id: string, text = 'Как это сделать?') =>
  `<a class="help-link" href="/help#${esc(id)}">${esc(text)}</a>`;

/** The sections of the personal cabinet: each one is a page of its own, one tab of the bar. */
export const CABINET_TABS = ['today', 'agents', 'property', 'prices', 'settings'] as const;
export type CabinetTab = (typeof CABINET_TABS)[number];

export const TAB_PATH: Record<CabinetTab, string> = {
  today: '/cabinet',
  agents: '/cabinet/agents',
  property: '/cabinet/property',
  prices: '/cabinet/prices',
  settings: '/cabinet/settings',
};

/** The section of the cabinet each of its anchors is on. */
const ANCHOR_TAB = {
  'first-title': 'today',
  'study-title': 'today',
  'approvals-title': 'today',
  'kpi-title': 'today',
  'feed-title': 'today',
  'launch-title': 'agents',
  'autonomy-title': 'agents',
  'team-title': 'agents',
  'platforms-title': 'agents',
  'profile-title': 'property',
  'listings-title': 'property',
  'competitors-title': 'property',
  'extension-title': 'settings',
  connect: 'settings',
  'crm-title': 'settings',
  'telegram-title': 'settings',
  'owner-title': 'settings',
  'hooks-title': 'settings',
  'account-title': 'settings',
} as const satisfies Record<string, CabinetTab>;
export type CabinetAnchor = keyof typeof ANCHOR_TAB;

/** A place in the cabinet: the page of its section, then the anchor. */
export const cabinetHref = (anchor: CabinetAnchor) => `${TAB_PATH[ANCHOR_TAB[anchor]]}#${anchor}`;

const NOTICE_TEXT: Record<Notice, string> = {
  login_denied: 'Вход отменён. Чтобы получить доступ, разрешите сайту доступ к профилю Яндекс ID.',
  login_expired: 'Ссылка для входа устарела. Нажмите «Войти» ещё раз.',
  login_error: 'Не удалось войти через Яндекс ID. Попробуйте ещё раз через минуту.',
};

const LOGO = `<svg class="logo" viewBox="0 0 32 32" aria-hidden="true"><path d="M21.8 14.7 30.4 3.9v24.2l-8.6-10.8z" fill="#f78c28"/><ellipse cx="14" cy="16" rx="10.9" ry="7.7" fill="#e8590c"/><circle cx="8.6" cy="14.4" r="2" fill="#fff"/></svg>`;

const YANDEX_MARK = `<svg class="ya" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="12" fill="#fc3f1d"/><text x="12" y="17" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="14" font-weight="700" fill="#fff">Я</text></svg>`;

export const ICONS = {
  channels: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h10"/><path d="m17 15 2 2 3-4"/></svg>`,
  prices: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19V9M10 19V5M16 19v-7M22 19H2"/></svg>`,
  guests: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v11H9l-5 4z"/><path d="M8 10h8"/></svg>`,
  reputation: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/></svg>`,
  direct: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 11v2a2 2 0 0 0 2 2h2l5 4V5L7 9H5a2 2 0 0 0-2 2z"/><path d="M16 9a4 4 0 0 1 0 6M19 6a8 8 0 0 1 0 12"/></svg>`,
  manager: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/></svg>`,
};

export function layout(v: View, title: string, body: string): string {
  const footerLinks = [
    v.privacyUrl ? `<a href="${esc(v.privacyUrl)}">Политика обработки данных</a>` : '',
    v.supportEmail ? `<a href="mailto:${esc(v.supportEmail)}">${esc(v.supportEmail)}</a>` : '',
  ].filter(Boolean);
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="Goldfish — команда AI-агентов для гостевого дома и отеля: сверка цен и броней на площадках, ответы гостям за минуты, отзывы, реклама и утренняя сводка владельцу в Telegram.">
<link rel="icon" href="${v.assets['favicon.ico']}" sizes="48x48">
<link rel="icon" href="${v.assets['favicon.svg']}" type="image/svg+xml">
<link rel="apple-touch-icon" href="${v.assets['apple-touch-icon.png']}">
<link rel="stylesheet" href="${v.assets['style.css']}">
<script src="${v.assets['app.js']}" defer></script>
</head>
<body>
${body}
<footer class="footer wrap">
  <span>© ${new Date().getFullYear()} Goldfish</span>
  ${footerLinks.join('\n  ')}
</footer>
</body>
</html>`;
}

/** The top of every page: the way to the cabinet for an owner, the guide for everyone. */
export function header(user: UserRecord | null, current?: 'cabinet' | 'help'): string {
  const here = (page: typeof current) => (page === current ? ' aria-current="page"' : '');
  const right = user
    ? `<div class="me">
        ${user.avatarId ? `<img class="avatar" src="https://avatars.yandex.net/get-yapic/${encodeURIComponent(user.avatarId)}/islands-68" alt="" width="32" height="32">` : `<span class="avatar avatar--empty" aria-hidden="true">${esc((user.name ?? user.login ?? '?').slice(0, 1).toUpperCase())}</span>`}
        <span class="me__name">${esc(user.name ?? user.login ?? 'Профиль')}</span>
        <form method="post" action="/logout"><button class="link" type="submit">Выйти</button></form>
      </div>`
    : `<a class="btn btn--ghost btn--sm" href="/auth/yandex">Войти</a>`;
  return `<header class="top wrap">
  <a class="brand" href="/">${LOGO}<span>Goldfish</span></a>
  <nav class="top__nav" aria-label="Разделы">
    ${user ? `<a href="/cabinet"${here('cabinet')}>Личный кабинет</a>` : ''}
    <a href="/help"${here('help')}>Инструкция</a>
  </nav>
  ${right}
</header>`;
}

function notice(n: Notice | null): string {
  return n ? `<div class="wrap"><p class="notice" role="status">${NOTICE_TEXT[n]}</p></div>` : '';
}

/** Illustration: the manager's morning summary and an approval in Telegram. */
const TELEGRAM = `<div class="panel" aria-hidden="true">
  <div class="panel__bar">${LOGO}<b>Управляющий</b><span class="panel__status">Telegram</span></div>
  <div class="panel__body">
    <div class="tg">
      <p class="tg__line"><b>Доброе утро! Дом у моря, 09.10.</b></p>
      <p class="tg__line">Сегодня заездов — 3, выездов — 2.</p>
      <p class="tg__line">Загрузка: 7 дней — 71%, 30 дней — 54%.</p>
      <p class="tg__line">За сутки 4 брони на 38 400 ₽, отмен — 1.</p>
      <p class="tg__line">Новых отзывов — 2, средняя оценка 4,5.</p>
      <p class="tg__line">Открытых расхождений на площадках — 1.</p>
    </div>
    <div class="confirm">
      <p class="confirm__title">Цены и загрузка: цены за коридором</p>
      <p class="confirm__text">Сб 14.11 «Люкс»: 11 500 ₽ (база 9 000 ₽) — праздник, загрузка 100%</p>
      <div class="confirm__actions"><span class="chip chip--accent">Согласовать</span><span class="chip">Изменить</span><span class="chip">Отклонить</span></div>
    </div>
  </div>
</div>`;

interface AgentCard {
  icon: keyof typeof ICONS;
  title: string;
  text: string;
  duties: string[];
  metrics: string;
}

const AGENTS: AgentCard[] = [
  {
    icon: 'channels',
    title: 'Каналы продаж',
    text: 'Чтобы на каждой площадке были верные цены, свободные номера и описание, а ни один номер не продавался дважды.',
    duties: [
      'каждое утро сверяет цены и наличие на 60 дней между PMS и площадками',
      'переносит новые брони в шахматку, исправляет расхождения',
      'при овербукинге сам закрывает продажу и сразу пишет вам',
    ],
    metrics: 'расхождения, время до исправления, овербукинги',
  },
  {
    icon: 'prices',
    title: 'Цены и загрузка',
    text: 'Работа ревенью-менеджера: сколько стоит ночь на каждую дату.',
    duties: [
      'цены 5–10 конкурентов рядом с цитатой на каждую цифру',
      'загрузка и темп броней, рекомендация цены с объяснением',
      'в вашем коридоре (например, ±10%) меняет цену сам',
    ],
    metrics: 'загрузка, ADR, RevPAR против прошлого года',
  },
  {
    icon: 'guests',
    title: 'Гости',
    text: 'Переписка с гостем от первого вопроса до письма после выезда — по правилам площадки.',
    duties: [
      'отвечает на парковку, заезд, животных за 1–2 минуты',
      'подтверждает брони, пишет до заезда и после выезда',
      'жалобу — черновиком администратору с пометкой «срочно»',
    ],
    metrics: 'время первого ответа, доля вопросов без человека',
  },
  {
    icon: 'reputation',
    title: 'Репутация',
    text: 'Рейтинг и отзывы на площадках бронирования, Яндекс Картах и 2ГИС.',
    duties: [
      'каждый день собирает рейтинги и новые отзывы',
      'отвечает на 4–5 ★ сам, на 1–3 ★ — после вашего «да»',
      'показывает, о чём пишут: чистота, тишина, завтрак, персонал',
    ],
    metrics: 'рейтинг, отзывы за 30 дней, ответ на негатив',
  },
  {
    icon: 'direct',
    title: 'Прямые продажи',
    text: 'Чтобы объект платил меньше комиссии площадкам.',
    duties: [
      'воронка «обращение → бронь» по каналам',
      'расход рекламы против бюджета, маркировка erid',
      'любая трата денег — только после согласования',
    ],
    metrics: 'доля прямых броней, комиссия, стоимость брони',
  },
  {
    icon: 'manager',
    title: 'Управляющий',
    text: 'Единственный, кто говорит с вами: собирает работу остальных агентов.',
    duties: [
      'утренняя сводка в Telegram в 5–7 строк',
      'срочное — с тихими часами и лимитом в день',
      'одна очередь согласований с кнопками',
    ],
    metrics: 'сводка вовремя, время решения по согласованию',
  },
];

const TEAM = `<section class="features wrap" id="team" aria-labelledby="team-title">
  <h2 id="team-title" class="section-title">Команда агентов</h2>
  <p class="section-lead">Пять агентов отвечают за свои участки, шестой — управляющий — собирает их работу для вас. Каждый агент — набор обязанностей по расписанию или событию.</p>
  <div class="grid3">
${AGENTS.map(
  (a) => `    <article class="feature">
      <span class="feature__icon">${ICONS[a.icon]}</span>
      <h3>${a.title}</h3>
      <p>${a.text}</p>
      <details class="feature__more">
        <summary>Что делает</summary>
        <ul class="ticks">${a.duties.map((d) => `<li>${d}</li>`).join('')}</ul>
        <p class="feature__metrics">Показатели: ${a.metrics}</p>
      </details>
    </article>`,
).join('\n')}
  </div>
</section>`;

const RULES = `<section class="features wrap" aria-labelledby="rules-title">
  <h2 id="rules-title" class="section-title">Решения — за вами</h2>
  <div class="grid3">
    <article class="feature">
      <h3>Три уровня прав</h3>
      <p><b>Сам</b> — чтение, расчёт и сообщения по утверждённому шаблону. <b>Правило</b> — действует сам в рамках вашего лимита, за лимитом спрашивает. <b>Согласование</b> — каждое действие подтверждаете вы. Поднять права может только владелец.</p>
    </article>
    <article class="feature">
      <h3>Правила площадок</h3>
      <p>Каждое сообщение гостю, ответ на отзыв и правка карточки проверяются по реестру правил площадок до отправки: контакты раньше времени, оплата мимо площадки, призыв бронировать напрямую. Изменения правил ловит отдельный агент.</p>
    </article>
    <article class="feature">
      <h3>Выключить можно всё</h3>
      <p>Агента, обязанность, площадку, права или поставить паузу — командой в Telegram («выключи рекламу», «пауза до 15.11 ремонт») или в личном кабинете. Выключенное не открывает кабинеты и не тратит токены.</p>
    </article>
  </div>
</section>`;

const SYSTEMS = [
  'Bnovo',
  'TravelLine',
  'Контур.Отель',
  'Shelter',
  'Realty Calendar',
  'шахматка в таблице',
  'Островок',
  'Яндекс Путешествия',
  'Авито',
  '101Hotels',
  'OneTwoTrip',
  'Ozon Travel',
  'roomlink',
  'Академсервис',
  'Алеан',
  'Bronevik.com',
  'hotelbook',
  'Яндекс Карты',
  '2ГИС',
  'Яндекс Директ',
  'VK Реклама',
  'Telegram',
];

const HOW = `<section class="how wrap" aria-labelledby="how-title">
  <h2 id="how-title" class="section-title">Как это работает</h2>
  <ol class="steps">
    <li><b>Подключаетесь за несколько минут.</b> Войдите через Яндекс ID, поставьте расширение в браузер, где открыты ваши PMS и кабинеты площадок, и дайте ссылки на объявления и кабинет CRM — ключ подключения сайт выдаст сам.</li>
    <li><b>Агенты сначала только изучают.</b> Они открывают ваши кабинеты в вашем браузере, с вашими входами, и запоминают дорогу к броням, ценам и отзывам. Пароли агенты не вводят и ничего не меняют, пока вы не разрешите работу.</li>
    <li><b>Важное — после вашего «да».</b> Сводка, срочное и кнопки согласований приходят от управляющего в Telegram.</li>
  </ol>
  <p class="systems" aria-label="Системы">${SYSTEMS.map((x) => `<span class="chip">${x}</span>`).join(' ')}</p>
</section>`;

function guest(): string {
  return `<section class="hero wrap">
  <div class="hero__text">
    <p class="eyebrow">Для гостевых домов, мини-отелей и апартаментов</p>
    <h1>Команда AI-агентов для вашего объекта размещения</h1>
    <p class="lead">Шесть агентов-сотрудников сверяют цены и брони на площадках, отвечают гостям за минуты, следят за отзывами и рекламой. Управляющий присылает в Telegram короткую сводку и кнопки согласований — решения остаются за вами.</p>
    <div class="cta">
      <a class="btn btn--yandex" href="/auth/yandex">${YANDEX_MARK}Войти с Яндекс ID</a>
      <a class="btn btn--ghost" href="/help">Как это работает</a>
      <span class="cta__note">Ранний доступ для пилотных объектов</span>
    </div>
  </div>
  ${TELEGRAM}
</section>
${TEAM}
${HOW}
${RULES}`;
}

/** A signed-in user without access: why. The others go to their cabinet. */
function noAccess(user: UserRecord, access: Extract<AccessState, { allowed: false }>): string {
  const first = (user.name ?? user.login ?? '').split(/\s+/)[0] ?? '';
  return `<section class="hero hero--user wrap">
  <div class="hero__text">
    <p class="eyebrow eyebrow--warn">Доступа нет</p>
    <h1>Здравствуйте${first ? `, ${esc(first)}` : ''}!</h1>
    <p class="lead">${esc(access.reason)}</p>
  </div>
</section>`;
}

export function renderPage(s: PageState): string {
  const main =
    s.user && s.access && !s.access.allowed ? noAccess(s.user, s.access) + TEAM : guest();
  return layout(
    s,
    'Goldfish — агенты для гостевого дома и отеля',
    `${header(s.user)}
${notice(s.notice)}
<main>
${main}
</main>`,
  );
}

export function renderNotFound(v: View): string {
  return layout(
    v,
    'Страница не найдена — Goldfish',
    `${header(null)}
<main class="wrap empty">
  <h1>Страница не найдена</h1>
  <p class="lead"><a href="/">На главную</a></p>
</main>`,
  );
}
