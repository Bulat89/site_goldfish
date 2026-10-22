import type { UserRecord } from '../store/types.js';
import { botsBlock, type BotsState } from './bots.js';
import {
  icon,
  importBlock,
  messengerLinked,
  permissionDialog,
  telegramBlock,
  toasts,
  type HotelView,
  type ProfileImportView,
  type StudyView,
} from './agents.js';
import { esc, header, helpLink, layout, type View } from './page.js';

/**
 * «Настройка» — the wizard that greets the owner after the first sign-in: the extension, the
 * listings with the reference one, the CRM cabinet and the bot, the team. Its last step starts the
 * study: the agents go through what the owner gave and change nothing until the owner allows it.
 */
export const SETUP_STEPS = [1, 2, 3, 4] as const;
export type SetupStep = (typeof SETUP_STEPS)[number];

export interface SetupState extends View {
  user: UserRecord;
  step: SetupStep;
  hotel: HotelView | null;
  /** The latest draft of the reference: the reference listing as the agent read it. */
  profileImport: ProfileImportView | null;
  /** The owner's extension on the Goldfish server; null — not known (no token yet). */
  extension: { online: boolean; lastSeenAt: string | null } | null;
  /** The bots in the messengers: undefined when the site has no bots server (BOTS_URL). */
  bots?: BotsState | undefined;
  study: StudyView | null;
  /** The zip could not be handed out (/download sends the owner back with it). */
  downloadFailed?: boolean;
  error: string | null;
}

type System = { id: string; url?: string; listingUrl?: string };

const STEP_TITLES: Record<SetupStep, string> = {
  1: 'Расширение',
  2: 'Площадки и эталон',
  3: 'CRM и бот',
  4: 'Команда',
};

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

/** The cabinet addresses owners use, for the empty field of the CRM. */
const CRM_PLACEHOLDERS: Record<string, string> = {
  bnovo: 'https://online.bnovo.ru/…',
  travelline: 'https://www.travelline.ru/secure/…',
  kontur_hotel: 'https://hotel.kontur.ru/…',
  shelter: 'https://shelter.ru/…',
  realty_calendar: 'https://realtycalendar.ru/…',
  sheet: 'https://docs.google.com/spreadsheets/…',
};

/** Where listings are entered: platforms for guests (one of them the reference) and the maps. */
const LISTING_CATEGORIES = new Set(['guest', 'maps']);
const CRM_CATEGORIES = new Set(['pms', 'sheet']);

const date = (iso: string) =>
  new Date(iso).toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow' });

/** What the owner gave so far, as the steps and the launch read it. */
export function setupFacts(s: Pick<SetupState, 'hotel' | 'profileImport' | 'bots' | 'extension'>) {
  const h = s.hotel;
  const systems = ((h?.profile.systems ?? []) as System[]).filter((x) => x && x.id);
  const category = new Map((h?.settings.platforms ?? []).map((p) => [p.id, p.category]));
  const title = new Map((h?.settings.platforms ?? []).map((p) => [p.id, p.title]));
  const listings = systems.filter((x) => !!x.listingUrl);
  const crm = systems.find((x) => CRM_CATEGORIES.has(category.get(x.id) ?? '') && !!x.url) ?? null;
  const imp = s.profileImport;
  const reference =
    imp?.url && imp.status !== 'discarded'
      ? (listings.find((x) => x.listingUrl === imp.url)?.id ?? null)
      : null;
  return {
    systems,
    category,
    title: (id: string) => title.get(id) ?? id,
    listings,
    crm,
    reference,
    extension: !!s.extension?.lastSeenAt,
    messenger: h ? messengerLinked(h, s.bots) : false,
  };
}

/** The step the wizard opens on without `?step=`: the first one with something left to do. */
export function firstOpenStep(
  s: Pick<SetupState, 'hotel' | 'profileImport' | 'bots' | 'extension'>,
): SetupStep {
  const f = setupFacts(s);
  if (!f.extension) return 1;
  if (!f.listings.length || !f.reference) return 2;
  if (!f.crm || !f.messenger) return 3;
  return 4;
}

function stepper(s: SetupState): string {
  const f = setupFacts(s);
  const notes: Record<SetupStep, { done: boolean; note: string }> = {
    1: {
      done: f.extension,
      note: f.extension
        ? s.extension?.online
          ? 'подключено'
          : `подключалось ${date(s.extension!.lastSeenAt!)}`
        : s.user.tokenIssuedAt
          ? 'ждём подключения'
          : 'не установлено',
    },
    2: {
      done: f.listings.length > 0 && !!f.reference,
      note: f.listings.length
        ? `объявлений: ${f.listings.length}${f.reference ? `, эталон — ${f.title(f.reference)}` : ', эталон не выбран'}`
        : 'не заполнено',
    },
    3: {
      done: !!f.crm && f.messenger,
      note: [
        f.crm ? f.title(f.crm.id) : 'CRM не указана',
        f.messenger ? 'бот привязан' : 'бот не привязан',
      ].join(', '),
    },
    4: {
      done: !!s.user.onboardedAt,
      note: s.study?.on ? 'агенты изучают' : s.user.onboardedAt ? 'запущено' : 'не запущено',
    },
  };
  return `<nav class="stepper" aria-label="Шаги настройки">
  <ol class="stepper__list">
${SETUP_STEPS.map((n) => {
  const { done, note } = notes[n];
  const state = n === s.step ? 'current' : done ? 'done' : 'todo';
  return `    <li class="stepper__step stepper__step--${state}${done ? ' stepper__step--ok' : ''}"><a href="/start?step=${n}"${n === s.step ? ' aria-current="step"' : ''}><span class="stepper__num" aria-hidden="true">${done ? '✓' : n}</span><span class="stepper__text"><b>${STEP_TITLES[n]}</b><span class="stepper__note">${esc(note)}${done ? '<span class="visually-hidden"> — готово</span>' : ''}</span></span></a></li>`;
}).join('\n')}
  </ol>
</nav>`;
}

// ---------------------------------------------------------------- 1. the extension

function extensionStep(s: SetupState): string {
  const f = setupFacts(s);
  const issued = s.user.tokenIssuedAt
    ? `Ключ выдан ${esc(date(s.user.tokenIssuedAt))}. Потеряли — выпустите новый: старый сразу перестанет работать.`
    : 'Ключ показывается один раз — сразу вставьте его в расширение.';
  const state = f.extension
    ? `<div class="ext-state ext-state--on" data-ext-state role="status"><span class="ext-state__dot" aria-hidden="true"></span><span data-ext-text>Расширение подключено${s.extension?.online ? '' : ` — последний раз ${esc(date(s.extension!.lastSeenAt!))}`}. Можно переходить к площадкам.</span></div>`
    : `<div class="ext-state" data-ext-state data-ext-poll role="status"><span class="ext-state__dot" aria-hidden="true"></span><span data-ext-text>Ждём подключения расширения — проверяем каждые несколько секунд.</span></div>`;
  return `<section class="card setup-step" aria-labelledby="step-title">
  <h2 id="step-title"><span class="num">1</span>Установите расширение Goldfish</h2>
  <div class="why">
    <div class="why__item"><h3>Зачем</h3><p>Расширение — руки агентов. Через него они открывают ваши объявления, кабинет CRM и кабинеты площадок и читают их так же, как вы. Без него агенты ничего не видят.</p></div>
    <div class="why__item"><h3>Почему это безопасно</h3><p>Агенты работают в вашем браузере, где вы уже вошли в кабинеты. Логины и пароли не передаются ни нам, ни агентам, а важные действия агент сначала спрашивает у вас.</p></div>
    <div class="why__item"><h3>Где установить</h3><p>На компьютере, где вы обычно работаете с CRM и площадками: Chrome 116+, Яндекс Браузер или Edge. Пока агенты работают, браузер должен быть открыт.</p></div>
  </div>
  <h3 class="setup-step__sub">Установка — пара минут</h3>
  <ol class="list setup-step__list">
    <li><a class="btn btn--accent btn--sm" href="/download">Скачать расширение</a> и распакуйте zip в постоянную папку — не удаляйте её после установки.</li>
    <li>Откройте <code>chrome://extensions</code> <button class="link" type="button" data-copy="chrome://extensions">скопировать</button> и включите «Режим разработчика».</li>
    <li>Нажмите «Загрузить распакованное» и выберите эту папку.</li>
    <li>Закрепите значок Goldfish на панели браузера и нажмите на него — откроется боковая панель.</li>
  </ol>
  <h3 class="setup-step__sub" id="connect">Подключение</h3>
  <p>Получите ключ подключения, вставьте его в боковой панели расширения и нажмите «Сохранить». Больше ничего вводить не нужно.</p>
  <div class="field">
    <span class="field__label">Ключ подключения</span>
    <div class="field__row" id="key-row" hidden><input id="key" readonly aria-label="Ключ подключения" spellcheck="false"><button class="btn btn--ghost btn--sm" type="button" data-copy-from="key">Копировать</button></div>
    <button class="btn ${s.user.tokenIssuedAt ? 'btn--ghost' : 'btn--accent'}" type="button" id="issue-key" data-has-key="${s.user.tokenIssuedAt ? '1' : ''}">${s.user.tokenIssuedAt ? 'Выпустить новый ключ' : 'Получить ключ подключения'}</button>
    <p class="error" id="key-error" role="alert" hidden></p>
    <p class="hint" id="key-hint">${issued}</p>
  </div>
  ${state}
  <p class="hint">${helpLink('install', 'Подробная инструкция')} · ${helpLink('indicator', 'Что значат надписи в панели?')}</p>
</section>`;
}

// ---------------------------------------------------------------- 2. listings and the reference

function referenceState(s: SetupState): string {
  const imp = s.profileImport;
  if (!imp || imp.status === 'discarded')
    return `<p class="hint">После сохранения агент прочитает эталонное объявление (1–3 минуты) и покажет, что перенести в эталон. Ничего не изменится, пока вы не нажмёте «Применить».</p>`;
  if (imp.status === 'applied')
    return `<div class="ext-state ext-state--on" role="status"><span class="ext-state__dot" aria-hidden="true"></span><span>Эталон заполнен по объявлению${imp.platform ? ` на ${esc(imp.platform)}` : ''}. Проверить и дополнить его можно на <a href="/agents?tab=property#profile-title">странице агентов</a>.</span></div>`;
  if (imp.status === 'failed')
    return `<p class="error" role="alert">Не получилось прочитать эталонное объявление: ${esc(imp.error ?? 'неизвестная ошибка')}. Проверьте, что расширение подключено, и сохраните ещё раз.</p>`;
  return importBlock(imp);
}

function listingsStep(s: SetupState): string {
  const h = s.hotel!;
  const f = setupFacts(s);
  const own = new Map(f.listings.map((x) => [x.id, x.listingUrl!]));
  const platforms = h.settings.platforms.filter((p) => LISTING_CATEGORIES.has(p.category));
  // Without a draft the first listing is offered as the reference.
  const reference =
    f.reference ?? platforms.find((p) => p.category === 'guest' && own.has(p.id))?.id;
  const rows = platforms.map((p) => {
    const guest = p.category === 'guest';
    return `      <div class="listing-row" data-platform="${esc(p.id)}">
        <span class="listing-row__ref">${guest ? `<input type="radio" name="reference" value="${esc(p.id)}"${p.id === reference ? ' checked' : ''} aria-label="Эталонное объявление: ${esc(p.title)}" title="Эталонное объявление">` : ''}</span>
        <label class="field listing-row__field"><span class="field__label">${esc(p.title)}</span><input type="url" name="listing" data-platform="${esc(p.id)}" value="${esc(own.get(p.id) ?? '')}" placeholder="${esc(LISTING_PLACEHOLDERS[p.id] ?? 'https://…')}" inputmode="url" spellcheck="false"></label>
      </div>`;
  });
  return `<section class="card setup-step" aria-labelledby="step-title">
  <h2 id="step-title"><span class="num">2</span>Ваши объявления на площадках</h2>
  <p>Вставьте ссылки на ваши объявления — как их видят гости. Где объявления нет, оставьте поле пустым.</p>
  <p>Одно объявление отметьте <b>эталонным</b> — кружком слева. Агент прочитает его и заполнит эталон объекта: описание, номера, цены, правила. По эталону агенты сверяют все остальные площадки, поэтому выберите то, где всё описано полнее и вернее.</p>
  <form class="setup-listings" data-form="setup-listings" novalidate>
    <div class="listing-rows" role="group" aria-label="Объявления на площадках">
      <div class="listing-row listing-row--head" aria-hidden="true"><span class="listing-row__ref">Эталон</span><span>Площадка и ссылка на объявление</span></div>
${rows.join('\n')}
    </div>
    <p class="error" data-form-error role="alert" hidden></p>
    <div class="row"><button class="btn btn--accent" type="submit">Сохранить и дальше</button><span class="hint">${helpLink('systems', 'Где взять ссылку?')}</span></div>
  </form>
  <h3 class="setup-step__sub">Эталон объекта</h3>
  ${referenceState(s)}
</section>`;
}

// ---------------------------------------------------------------- 3. the CRM and the bot

function crmStep(s: SetupState): string {
  const h = s.hotel!;
  const f = setupFacts(s);
  const crms = h.settings.platforms.filter((p) => CRM_CATEGORIES.has(p.category));
  const current = f.crm?.id ?? '';
  const options = [
    `<option value=""${current ? '' : ' selected'} disabled>Выберите CRM</option>`,
    ...crms.map(
      (p) =>
        `<option value="${esc(p.id)}" data-placeholder="${esc(CRM_PLACEHOLDERS[p.id] ?? 'https://…')}"${p.id === current ? ' selected' : ''}>${esc(p.title)}</option>`,
    ),
    `<option value="none">Нет CRM — веду брони вручную</option>`,
  ];
  const bot = s.bots
    ? botsBlock(s.bots, { unlink: false, refreshHref: '/start?step=3#bot-title' })
    : telegramBlock(h);
  return `<section class="card setup-step" aria-labelledby="step-title">
  <h2 id="step-title"><span class="num">3</span>Доступ к CRM</h2>
  <p>Дайте ссылку на личный кабинет вашей CRM (PMS) — ту, по которой вы в него входите. Агенты будут читать там брони, цены и наличие и сверять их с площадками.</p>
  <p class="hint hint--top">Логин и пароль не нужны: агент откроет кабинет в вашем браузере, где вы уже вошли. Закончится сессия — агент попросит вас войти.</p>
  <form class="grid2 setup-crm" data-form="setup-crm">
    <label class="field"><span class="field__label">Ваша CRM</span><select name="system" required>${options.join('')}</select></label>
    <label class="field"><span class="field__label">Ссылка на личный кабинет</span><input name="url" type="url" value="${esc(f.crm?.url ?? '')}" placeholder="${esc(CRM_PLACEHOLDERS[current] ?? 'https://…')}" inputmode="url" spellcheck="false"></label>
    <p class="error" data-form-error role="alert" hidden></p>
    <div class="row"><button class="btn btn--accent btn--sm" type="submit">Сохранить</button>${f.crm ? `<span class="ok-text">✓ ${esc(f.title(f.crm.id))} подключена</span>` : ''}</div>
  </form>
</section>
<section class="card setup-step" aria-labelledby="bot-title">
  <div class="card__head"><h2 id="bot-title">Бот для управления</h2>${helpLink(s.bots ? 'bots' : 'tg-link', 'Что умеет бот?')}</div>
  <p>Наведите камеру телефона на QR-код — откроется бот Goldfish. Через него вы управляете агентами: согласуете их решения, получаете утреннюю сводку и срочное, даёте поручения.</p>
  ${bot}
</section>`;
}

// ---------------------------------------------------------------- 4. the team and the launch

/** The level a new owner starts with: «Контролируемая автономность» over the server's default 4. */
const START_AUTONOMY = 3;

function teamStep(s: SetupState): string {
  const h = s.hotel!;
  const f = setupFacts(s);
  const anyOn = h.settings.agents.some((a) => a.enabled);
  const agents = h.settings.agents.map(
    (a) => `      <label class="pick">
        <input type="checkbox" name="agent" value="${esc(a.id)}"${!anyOn || a.enabled ? ' checked' : ''}>
        <span class="agent-icon agent-icon--sm" aria-hidden="true">${icon(a.id)}</span>
        <span class="pick__text"><b>${esc(a.title)}</b><span class="hint">${esc(a.mission)}</span></span>
      </label>`,
  );
  const levels = h.settings.autonomyLevels ?? [];
  const chosen =
    h.settings.autonomy && h.settings.autonomy !== 4 ? h.settings.autonomy : START_AUTONOMY;
  const autonomy = levels.length
    ? `<fieldset class="autonomy-pick">
      <legend>Сколько агенты делают без вас — после изучения</legend>
${levels
  .map(
    (l) =>
      `      <label class="pick pick--radio"><input type="radio" name="autonomy" value="${l.level}"${l.level === chosen ? ' checked' : ''}><span class="pick__num" aria-hidden="true">${l.level}</span><span class="pick__text"><b>${esc(l.title)}${l.level === START_AUTONOMY ? ' <span class="chip chip--ok">для начала</span>' : ''}</b><span class="hint">${esc(l.short)}</span></span></label>`,
  )
  .join('\n')}
      <p class="hint">Поменять можно в любой момент на странице агентов. ${helpLink('autonomy', 'Что значат уровни?')}</p>
    </fieldset>`
    : '';
  const ready: Array<{ ok: boolean; must: boolean; text: string; step: SetupStep }> = [
    {
      ok: f.extension,
      must: true,
      text: f.extension
        ? 'Расширение подключено'
        : 'Расширение не подключено — без него агентам нечего читать',
      step: 1,
    },
    {
      ok: f.listings.length > 0,
      must: false,
      text: f.listings.length
        ? `Объявлений: ${f.listings.length}${f.reference ? `, эталон — ${f.title(f.reference)}` : ', эталонное не выбрано'}`
        : 'Объявлений нет',
      step: 2,
    },
    {
      ok: !!f.crm,
      must: false,
      text: f.crm ? `Кабинет CRM: ${f.title(f.crm.id)}` : 'Кабинет CRM не указан',
      step: 3,
    },
    {
      ok: f.messenger,
      must: false,
      text: f.messenger ? 'Бот привязан' : 'Бот не привязан — согласования будут только на сайте',
      step: 3,
    },
  ];
  // Something to study: a listing or the CRM cabinet.
  const nothing = !f.listings.length && !f.crm;
  const blocked = !f.extension || nothing;
  const launch = s.user.onboardedAt
    ? `<p class="notice notice--soft">Настройка пройдена ${esc(date(s.user.onboardedAt))}${s.study?.on ? ' — агенты изучают ваши кабинеты' : ''}. Команду, права и уровень автономности меняйте на <a href="/agents?tab=team#team-title">странице агентов</a>.</p>
    <a class="btn btn--accent" href="/agents">На страницу агентов</a>`
    : `<ul class="readiness" aria-label="Что готово">
${ready
  .map(
    (r) =>
      `      <li class="readiness__item readiness__item--${r.ok ? 'ok' : r.must ? 'bad' : 'warn'}"><span class="readiness__mark" aria-hidden="true">${r.ok ? '✓' : '!'}</span><span>${esc(r.text)}${r.ok ? '' : ` — <a href="/start?step=${r.step}">шаг ${r.step}</a>`}</span></li>`,
  )
  .join('\n')}
    </ul>
    ${nothing ? '<p class="hint warn">Изучать пока нечего: внесите хотя бы одно объявление или кабинет CRM.</p>' : ''}
    <p class="error" data-form-error role="alert" hidden></p>
    <button class="btn btn--accent" type="submit"${blocked ? ' disabled' : ''}>Запустить изучение</button>`;
  return `<form class="setup-team" data-form="setup-team">
<section class="card setup-step" aria-labelledby="step-title">
  <h2 id="step-title"><span class="num">4</span>Команда агентов</h2>
  <p>Отметьте, кто будет работать на ваш объект. Каждый агент отвечает за свой участок, управляющий собирает их работу и пишет вам.</p>
  <div class="team-pick">
${agents.join('\n')}
  </div>
  ${autonomy}
</section>
<section class="card setup-step setup-launch" aria-labelledby="launch-title">
  <h2 id="launch-title">Сначала агенты только изучают</h2>
  <p>После запуска агенты открывают ваши объявления и кабинет CRM, проходят по разделам и запоминают дорогу к броням, ценам, сообщениям и отзывам — строят маршруты. <b>Менять и исправлять что-либо в это время запрещено</b>: агенты не правят карточки, не трогают цены и не пишут гостям — и даже не предлагают этого.</p>
  <p>Когда изучение закончится, вы разрешите работу на странице агентов — по уровню автономности, выбранному выше. ${helpLink('study', 'Подробнее')}</p>
  ${launch}
</section>
</form>`;
}

// ---------------------------------------------------------------- the page

export function renderSetup(s: SetupState): string {
  const first = (s.user.name ?? s.user.login ?? '').split(/\s+/)[0] ?? '';
  const intro = s.user.onboardedAt
    ? 'Здесь можно вернуться к любому шагу: выпустить новый ключ, добавить объявление, сменить CRM или привязать бота.'
    : 'Четыре шага — и агенты начнут изучать ваш объект. Сначала они только смотрят и запоминают дорогу по вашим кабинетам, ничего не меняя.';
  let body: string;
  if (!s.hotel && s.step !== 1)
    body = `<p class="notice" role="status">${esc(s.error ?? 'Сервер агентов сейчас недоступен — попробуйте через минуту.')}</p>`;
  else
    body = {
      1: () => extensionStep(s),
      2: () => listingsStep(s),
      3: () => crmStep(s),
      4: () => teamStep(s),
    }[s.step]();
  const prev =
    s.step > 1
      ? `<a class="btn btn--ghost" href="/start?step=${s.step - 1}">← Назад</a>`
      : '<span></span>';
  // Step 2 is the one an owner may skip (a property without listings): until it is filled, «Пропустить».
  const facts = s.hotel ? setupFacts(s) : null;
  const skip = s.step === 2 && !(facts?.listings.length && facts.reference);
  const next =
    s.step < 4
      ? `<a class="btn ${skip ? 'btn--ghost' : 'btn--accent'}" href="/start?step=${s.step + 1}" data-next>${skip ? 'Пропустить' : 'Дальше'} →</a>`
      : '';
  return layout(
    s,
    `Настройка: ${STEP_TITLES[s.step]} — Goldfish`,
    `${header(s.user)}
<main class="wrap agents setup" data-setup>
  <section class="hero hero--user">
    <div class="hero__text">
      <p class="eyebrow">Настройка · шаг ${s.step} из 4</p>
      <h1>${first ? `Здравствуйте, ${esc(first)}!` : 'Здравствуйте!'}</h1>
      <p class="lead">${intro}</p>
    </div>
  </section>
  ${s.downloadFailed ? '<p class="notice" role="status">Пакет расширения сейчас недоступен. Попробуйте позже или напишите нам.</p>' : ''}
  ${stepper(s)}
  ${s.error && s.hotel ? `<p class="notice" role="status">${esc(s.error)}</p>` : ''}
  ${body}
  <nav class="setup__nav" aria-label="Шаги">${prev}${next}</nav>
  ${permissionDialog()}
  ${toasts()}
</main>`,
  );
}
