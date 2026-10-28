import { accessOf } from '../access.js';
import { CRM_CATEGORIES, setupFacts, type ExtensionState, type HotelView } from './agents.js';
import { botsBlock, type BotsState } from './bots.js';
import { cabinetPage, type CabinetState } from './cabinet.js';
import { TAB_PATH, esc, helpLink } from './page.js';

/**
 * «Настройки»: everything the owner connects and tunes, in one place — the extension and its key,
 * the CRM, the messengers, when and about what the manager writes, the webhooks — and the account.
 */
export interface SettingsState extends CabinetState {
  /** The owner's extension on the Goldfish server; null — not known (no token issued yet). */
  extension: ExtensionState | null;
  /** The bots in the messengers: undefined when the site has no bots server (BOTS_URL). */
  bots?: BotsState | undefined;
  /** The zip could not be handed out (/download sends the owner back with it). */
  downloadFailed?: boolean;
}

/** The cabinet addresses owners use, for the empty field of the CRM. */
const CRM_PLACEHOLDERS: Record<string, string> = {
  bnovo: 'https://online.bnovo.ru/…',
  travelline: 'https://www.travelline.ru/secure/…',
  kontur_hotel: 'https://hotel.kontur.ru/…',
  shelter: 'https://shelter.ru/…',
  saby_hotel: 'https://online.saby.ru/…',
  realty_calendar: 'https://realtycalendar.ru/…',
  sheet: 'https://docs.google.com/spreadsheets/…',
};

const date = (iso: string) =>
  new Date(iso).toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow' });

// ---------------------------------------------------------------- the extension

/**
 * The extension: what it is for and why it is safe, the install, the key. The key is the address of
 * the server and the device token in one line — shown once, a new one revokes the old. Once the
 * extension has connected, the install and the key are folded: they are needed on another computer
 * or when the key is lost.
 */
function extensionCard(s: SettingsState): string {
  const connected = !!s.extension?.lastSeenAt;
  const issued = s.user.tokenIssuedAt
    ? `Ключ выдан ${esc(date(s.user.tokenIssuedAt))}. Потеряли — выпустите новый: старый сразу перестанет работать.`
    : 'Ключ показывается один раз — сразу вставьте его в расширение.';
  const state = connected
    ? `<div class="ext-state ext-state--on" data-ext-state role="status"><span class="ext-state__dot" aria-hidden="true"></span><span data-ext-text>Расширение подключено${s.extension?.online ? '' : ` — последний раз ${esc(date(s.extension!.lastSeenAt!))}`}.</span></div>`
    : `<div class="ext-state" data-ext-state data-ext-poll role="status"><span class="ext-state__dot" aria-hidden="true"></span><span data-ext-text>Расширение пока не подключалось — проверяем каждые несколько секунд.</span></div>`;
  return `<section class="card" aria-labelledby="extension-title">
  <div class="card__head"><h2 id="extension-title">Расширение для браузера</h2>${helpLink('install', 'Подробная инструкция')}</div>
  ${s.downloadFailed ? '<p class="notice" role="status">Пакет расширения сейчас недоступен. Попробуйте позже или напишите нам.</p>' : ''}
  ${state}
  <details class="ext-more"${connected ? '' : ' open'}>
    <summary>${connected ? 'Установить на другом компьютере или выпустить новый ключ' : 'Установка и подключение'}</summary>
    <p>Расширение — руки агентов: через него они открывают ваши кабинеты и объявления в вашем браузере, где вы уже вошли. Логины и пароли не передаются ни нам, ни агентам, а важные действия агент сначала спрашивает у вас. Ставьте его на компьютере, где вы обычно работаете с CRM и площадками: Chrome 116+, Яндекс Браузер или Edge. Пока агенты работают, браузер должен быть открыт.</p>
    <h3 class="card__sub">1. Установка — пара минут</h3>
    <ol class="list card__list">
      <li><a class="btn btn--accent btn--sm" href="/download">Скачать расширение</a> и распакуйте zip в постоянную папку — не удаляйте её после установки.</li>
      <li>Откройте <code>chrome://extensions</code> <button class="link" type="button" data-copy="chrome://extensions">скопировать</button> и включите «Режим разработчика».</li>
      <li>Нажмите «Загрузить распакованное» и выберите эту папку.</li>
      <li>Закрепите значок Goldfish на панели браузера и нажмите на него — откроется боковая панель.</li>
    </ol>
    <h3 class="card__sub" id="connect">2. Подключение</h3>
    <p>Получите ключ подключения, вставьте его в боковой панели расширения и нажмите «Сохранить». Больше ничего вводить не нужно.</p>
    <div class="field">
      <span class="field__label">Ключ подключения</span>
      <div class="field__row" id="key-row" hidden><input id="key" readonly aria-label="Ключ подключения" spellcheck="false"><button class="btn btn--ghost btn--sm" type="button" data-copy-from="key">Копировать</button></div>
      <button class="btn ${s.user.tokenIssuedAt ? 'btn--ghost' : 'btn--accent'}" type="button" id="issue-key" data-has-key="${s.user.tokenIssuedAt ? '1' : ''}">${s.user.tokenIssuedAt ? 'Выпустить новый ключ' : 'Получить ключ подключения'}</button>
      <p class="error" id="key-error" role="alert" hidden></p>
      <p class="hint" id="key-hint">${issued}</p>
    </div>
    <p class="hint">${helpLink('indicator', 'Что значат надписи в боковой панели?')}</p>
  </details>
</section>`;
}

// ---------------------------------------------------------------- the CRM

/**
 * The cabinet of the owner's CRM (a PMS or a chessboard table) — one: another chosen before leaves
 * the reference. «Нет CRM» — the bookings are kept by hand, there is nothing to read.
 */
function crmCard(h: HotelView, s: SettingsState): string {
  const crms = h.settings.platforms.filter((p) => CRM_CATEGORIES.has(p.category));
  if (!crms.length) return '';
  const f = setupFacts(h, s);
  const current = f.crm?.id ?? '';
  const options = [
    `<option value=""${current ? '' : ' selected'} disabled>Выберите CRM</option>`,
    ...crms.map(
      (p) =>
        `<option value="${esc(p.id)}" data-placeholder="${esc(CRM_PLACEHOLDERS[p.id] ?? 'https://…')}"${p.id === current ? ' selected' : ''}>${esc(p.title)}</option>`,
    ),
    `<option value="none">Нет CRM — веду брони вручную</option>`,
  ];
  return `<section class="card" aria-labelledby="crm-title">
  <div class="card__head"><h2 id="crm-title">Кабинет вашей CRM</h2></div>
  <p class="hint hint--top">Ссылка, по которой вы входите в личный кабинет CRM (PMS): агенты будут читать там брони, цены и наличие и сверять их с площадками. Логин и пароль не нужны — агент откроет кабинет в вашем браузере, где вы уже вошли.</p>
  <form class="grid2 crm" data-form="crm">
    <label class="field"><span class="field__label">Ваша CRM</span><select name="system" required>${options.join('')}</select></label>
    <label class="field"><span class="field__label">Ссылка на личный кабинет</span><input name="url" type="url" value="${esc(f.crm?.url ?? '')}" placeholder="${esc(CRM_PLACEHOLDERS[current] ?? 'https://…')}" inputmode="url" spellcheck="false"></label>
    <p class="error" data-form-error role="alert" hidden></p>
    <div class="row"><button class="btn btn--accent btn--sm" type="submit">Сохранить</button>${f.crm ? `<span class="ok-text">✓ ${esc(f.title(f.crm.id))} подключена</span>` : ''}</div>
  </form>
</section>`;
}

// ---------------------------------------------------------------- the messengers

/** Telegram of Goldfish itself: used when the site has no bots server. */
function telegramBlock(h: HotelView): string {
  if (h.telegramBot === false)
    return `<p class="hint">Telegram-бот ещё не настроен на сервере. Пока сообщения управляющего — на вкладке «Сегодня» и в расширении.</p>`;
  return `<div class="tg-link${h.telegramLinked ? ' tg-link--on' : ''}">
  <p>${h.telegramLinked ? '<b>Telegram привязан</b> — сводки, срочное и согласования приходят туда.' : '<b>Telegram не привязан.</b> Привяжите — управляющий будет присылать сводку, срочное и кнопки согласований.'}</p>
  <button class="btn ${h.telegramLinked ? 'btn--ghost' : 'btn--accent'} btn--sm" type="button" data-act="telegram">${h.telegramLinked ? 'Привязать другой чат' : 'Привязать Telegram'}</button>
  <p class="hint" data-telegram hidden></p>
</div>`;
}

/** When the manager writes and about what: the summary, the quiet hours, the limit of urgent ones. */
function ownerForm(h: HotelView): string {
  const o = h.settings.owner;
  const stars = h.settings.limits.reviewAutoMinStars;
  return `<form class="owner" data-form="owner">
  <div class="grid2">
    <label class="field"><span class="field__label">Утренняя сводка в</span><input name="summaryTime" type="time" value="${esc(o.summaryTime)}"></label>
    <label class="field"><span class="field__label">Срочных в день, не больше</span><input name="urgentPerDay" type="number" min="0" max="50" value="${o.urgentPerDay}"><span class="field__hint">сверх лимита — в следующую сводку</span></label>
    <div class="field"><span class="field__label" id="quiet-label">Тихие часы</span><span class="field__pair" role="group" aria-labelledby="quiet-label"><input name="quietFrom" type="time" value="${esc(o.quietFrom)}" aria-label="Тихие часы с"><span aria-hidden="true">—</span><input name="quietTo" type="time" value="${esc(o.quietTo)}" aria-label="Тихие часы до"></span><span class="field__hint">в это время срочное ждёт утра</span></div>
    <label class="field"><span class="field__label">Отвечать на отзывы без согласования</span><select name="reviewAutoMinStars">${[
      5, 4, 3, 2, 1, 6,
    ]
      .map(
        (n) =>
          `<option value="${n}"${n === stars ? ' selected' : ''}>${n === 6 ? 'никогда — все ответы на согласование' : n === 1 ? 'на все отзывы' : `на ${n}★${n < 5 ? ' и выше' : ''}`}</option>`,
      )
      .join(
        '',
      )}</select><span class="field__hint">на остальные — черновик вам на согласование</span></label>
  </div>
  <button class="btn btn--ghost btn--sm" type="submit">Сохранить</button>
</form>`;
}

// ---------------------------------------------------------------- the webhooks

function hookBlock(goldfishUrl: string): string {
  return `<p class="hint hint--top">Для писем-уведомлений площадок, вебхуков PMS и своего мессенджера: адреса с токеном объекта. Новый токен отзывает старый.</p>
<button class="btn btn--ghost btn--sm" type="button" data-act="hook-token" data-base="${esc(goldfishUrl)}">Выпустить токен вебхуков</button>
<div class="field" data-hook hidden>
  <span class="field__label">События (PMS, мессенджер)</span>
  <span class="field__row"><input readonly data-hook-events aria-label="Адрес событий"><button class="btn btn--ghost btn--sm" type="button" data-copy-from-attr="data-hook-events">Копировать</button></span>
  <span class="field__label">Пересылка писем</span>
  <span class="field__row"><input readonly data-hook-email aria-label="Адрес писем"><button class="btn btn--ghost btn--sm" type="button" data-copy-from-attr="data-hook-email">Копировать</button></span>
</div>`;
}

// ---------------------------------------------------------------- the account

/** Who is signed in and on what terms; the plan and the paid period will be here. */
function accountCard(s: SettingsState): string {
  const u = s.user;
  const access = accessOf(u);
  const rows: Array<[string, string]> = [
    ['Имя', u.name ?? u.login ?? '—'],
    ['Яндекс ID', u.login ?? '—'],
    ['Почта', u.email ?? '—'],
    ['Доступ', access.allowed ? access.label : access.reason],
  ];
  return `<section class="card" aria-labelledby="account-title">
  <div class="card__head"><h2 id="account-title">Аккаунт</h2></div>
  <dl class="facts">
${rows.map(([k, v]) => `    <div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('\n')}
  </dl>
</section>`;
}

// ---------------------------------------------------------------- the page

export function renderSettings(s: SettingsState): string {
  const h = s.hotel;
  const body = [
    extensionCard(s),
    // What needs the property on the server waits for it; the extension and the account do not.
    ...(h
      ? [
          crmCard(h, s),
          `<section class="card" aria-labelledby="telegram-title">
  <div class="card__head"><h2 id="telegram-title">${s.bots ? 'Мессенджеры' : 'Telegram'}</h2>${helpLink(s.bots ? 'bots' : 'tg-link', 'Как это работает?')}</div>
  ${s.bots ? `<p class="hint hint--top">Привяжите Telegram, MAX или WhatsApp: туда придут сводка, срочное и согласования, оттуда можно поручать агентам задачи.</p>${botsBlock(s.bots, TAB_PATH.settings)}` : telegramBlock(h)}
</section>`,
          `<section class="card" aria-labelledby="owner-title">
  <div class="card__head"><h2 id="owner-title">Сводка и уведомления</h2>${helpLink('tg-quiet', 'Подробнее')}</div>
  ${ownerForm(h)}
</section>`,
          `<section class="card" aria-labelledby="hooks-title">
  <div class="card__head"><h2 id="hooks-title">Вебхуки объекта</h2>${helpLink('mail', 'Зачем они?')}</div>
  ${hookBlock(s.goldfishUrl)}
</section>`,
        ]
      : []),
    accountCard(s),
  ];
  return cabinetPage(s, 'settings', body.filter(Boolean).join('\n  '));
}
