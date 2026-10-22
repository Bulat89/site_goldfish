import type { UserRecord } from '../store/types.js';
import type { DeskView, HotelView } from './agents.js';
import {
  CABINET_TABS,
  TAB_PATH,
  cabinetHref,
  day,
  esc,
  header,
  layout,
  type CabinetTab,
  type View,
} from './page.js';

/**
 * The personal cabinet: one place for everything the signed-in owner does. Each section is a page
 * of its own with the same top — the name of the property and the bar of tabs — so the owner
 * always sees where they are and where the rest is.
 */
export interface CabinetState extends View {
  user: UserRecord;
  /** The property on the Goldfish server; null when it did not answer (`error` says why). */
  hotel: HotelView | null;
  /** Decisions waiting for the owner, for the count on «Сегодня»; null — not known. */
  waiting?: Pick<DeskView['status'], 'pending' | 'urgent'> | null;
  error: string | null;
}

export const TAB_TITLES: Record<CabinetTab, string> = {
  today: 'Сегодня',
  agents: 'Агенты',
  property: 'Объект',
  prices: 'Цены',
  settings: 'Настройки',
};

/** The count of decisions waiting, on the «Сегодня» tab; red when one of them is urgent. */
export function tabCount(status: Pick<DeskView['status'], 'pending' | 'urgent'>): string {
  return status.pending
    ? ` <span class="tabs__count${status.urgent ? ' tabs__count--urgent' : ''}" aria-label="ждут решения: ${status.pending}">${status.pending}</span>`
    : '';
}

function tabsNav(active: CabinetTab, waiting: CabinetState['waiting']): string {
  return `<nav class="tabs" aria-label="Личный кабинет">
${CABINET_TABS.map(
  (t) =>
    `  <a class="tabs__tab" href="${TAB_PATH[t]}"${t === 'today' ? ' data-tab="today"' : ''}${t === active ? ' aria-current="page"' : ''}>${TAB_TITLES[t]}${t === 'today' && waiting ? tabCount(waiting) : ''}</a>`,
).join('\n')}
</nav>`;
}

/**
 * What changes the work of every agent says so in every section, in a line: the study, a pause.
 * Where the section has the full card of it («Сегодня» for the study, «Агенты» for the pause)
 * there is no line.
 */
function banners(s: CabinetState, tab: CabinetTab): string {
  const set = s.hotel?.settings;
  if (!set) return '';
  return [
    set.study && tab !== 'today'
      ? `<p class="notice notice--soft" role="status">Идёт изучение: агенты только читают и ничего не меняют. <a href="${cabinetHref('study-title')}">Как идёт</a></p>`
      : '',
    set.pause && tab !== 'agents'
      ? `<p class="notice notice--warn" role="status">На паузе до ${esc(day(set.pause.until))}${set.pause.reason ? ` · ${esc(set.pause.reason)}` : ''}: агенты ничего не меняют на площадках и не пишут гостям. <a href="${cabinetHref('launch-title')}">Изменить</a></p>`
      : '',
  ]
    .filter(Boolean)
    .join('\n  ');
}

/** The agent asks the owner before running a duty that is off; without an answer nothing runs. */
export function permissionDialog(): string {
  return `<dialog class="permission" data-permission aria-labelledby="permission-title">
  <h2 id="permission-title">Нужно ваше разрешение</h2>
  <p class="permission__text" data-permission-text></p>
  <div class="row">
    <button class="btn btn--accent btn--sm" type="button" data-grant="once">Разрешить один раз</button>
    <button class="btn btn--ghost btn--sm" type="button" data-grant="always">Разрешить всегда</button>
    <button class="btn btn--ghost btn--sm" type="button" data-grant="no">Не выполнять</button>
  </div>
</dialog>
<dialog class="permission" data-confirm-dialog aria-labelledby="confirm-title">
  <h2 id="confirm-title">Подтвердите</h2>
  <p class="permission__text" data-confirm-text></p>
  <div class="row">
    <button class="btn btn--accent btn--sm" type="button" data-answer="yes">Да</button>
    <button class="btn btn--ghost btn--sm" type="button" data-answer="no">Отмена</button>
  </div>
</dialog>`;
}

/** Messages after a change: fixed at the bottom of the screen, so the page does not jump. */
export function toasts(): string {
  return `<div class="toasts">
  <div class="toast toast--error" data-page-error role="alert" hidden><span data-toast-text></span><button class="toast__close" type="button" data-toast-close aria-label="Скрыть">×</button></div>
  <div class="toast" data-page-status role="status" hidden><span data-toast-text></span><button class="toast__close" type="button" data-toast-close aria-label="Скрыть">×</button></div>
</div>`;
}

/** A section of the cabinet: the name of the property, the tabs, what concerns every section, the body. */
export function cabinetPage(s: CabinetState, tab: CabinetTab, body: string): string {
  const name = String(s.hotel?.profile.name ?? '');
  return layout(
    s,
    `${TAB_TITLES[tab]} — личный кабинет — Goldfish`,
    `${header(s.user, 'cabinet')}
<main class="wrap cabinet cabinet--${tab}">
  <section class="hero hero--user hero--cabinet">
    <div class="hero__text">
      <p class="eyebrow">Личный кабинет</p>
      <h1>${name ? esc(name) : 'Ваш объект'}</h1>
    </div>
  </section>
  ${tabsNav(tab, s.waiting)}
  ${s.error ? `<p class="notice" role="status">${esc(s.error)}</p>` : ''}
  ${banners(s, tab)}
${body}
  ${permissionDialog()}
  ${toasts()}
</main>`,
  );
}
