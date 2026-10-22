// Copy buttons and device-token issuing on the account page. No framework, no dependencies.
'use strict';

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Clipboard API needs a secure context; fall back to a temporary selection.
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  }
}

function flashCopied(button) {
  button.setAttribute('data-copied', '');
  setTimeout(() => button.removeAttribute('data-copied'), 1500);
}

document.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-copy], [data-copy-from]');
  if (!button) return;
  const from = button.getAttribute('data-copy-from');
  const text = from ? document.getElementById(from)?.value : button.getAttribute('data-copy');
  if (text && (await copyText(text))) flashCopied(button);
});

// «Ключ подключения» on the first step of the setup: the server's address and the device token in
// one value for the side panel of the extension. Shown once; a new key revokes the old one.
const issueButton = document.getElementById('issue-key');
if (issueButton) {
  const row = document.getElementById('key-row');
  const input = document.getElementById('key');
  const error = document.getElementById('key-error');
  const hint = document.getElementById('key-hint');

  issueButton.addEventListener('click', async () => {
    const hasKey = issueButton.getAttribute('data-has-key') === '1';
    if (
      hasKey &&
      !confirm(
        'Выпустить новый ключ? Старый перестанет работать во всех браузерах, где он вставлен.',
      )
    )
      return;
    issueButton.disabled = true;
    error.hidden = true;
    try {
      const res = await fetch('/api/token', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
        credentials: 'same-origin',
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 401) {
        location.href = '/auth/yandex';
        return;
      }
      if (!res.ok || !body.key) throw new Error(body.message || 'Не удалось получить ключ');
      input.value = body.key;
      row.hidden = false;
      input.focus();
      input.select();
      issueButton.textContent = 'Выпустить новый ключ';
      issueButton.classList.replace('btn--accent', 'btn--ghost');
      issueButton.setAttribute('data-has-key', '1');
      hint.textContent =
        'Скопируйте ключ сейчас и вставьте в боковой панели расширения — после обновления страницы он не будет показан.';
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
    } finally {
      issueButton.disabled = false;
    }
  });
}

// While the first step waits for the extension, it asks the server every 5 s and says when the
// extension connected — in place: a reload would hide the key not yet pasted.
const extState = document.querySelector('[data-ext-poll]');
if (extState) {
  const started = Date.now();
  const tick = async () => {
    try {
      const res = await fetch('/api/onboarding/extension', { credentials: 'same-origin' });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.connected) {
        extState.classList.add('ext-state--on');
        extState.querySelector('[data-ext-text]').textContent =
          'Расширение подключено. Можно переходить к площадкам.';
        return;
      }
    } catch {
      // A network hiccup: try again on the next tick.
    }
    if (Date.now() - started < 60 * 60_000) setTimeout(tick, 5000);
  };
  setTimeout(tick, 5000);
}

// ---------------------------------------------------------------- agents page
// Every change goes to the site's /api/agents/* (same origin, session cookie), which forwards it
// to the Goldfish server on the owner's behalf. After a change the page is reloaded from the server
// on the same tab and at the same place, and says what changed at the bottom of the screen.

// ------------------------------------------------ tabs
// Every tab is in the page; a link to `?tab=…` (the tabs, the status line, «Первые шаги») shows
// its tab without a reload. Without this script the same links open the tab from the server.

const panels = [...document.querySelectorAll('[data-panel]')];
const tabLinks = [...document.querySelectorAll('.tabs [data-tab]')];
const tabsNav = document.querySelector('.tabs');
const baseTitle = document.title.replace(/^[^—]+— /, '');

function panelOf(el) {
  const box = el && el.closest('[data-panel]');
  return box ? box.getAttribute('data-panel') : null;
}

function showTab(tab, { anchor = '', push = false } = {}) {
  const target = panels.find((p) => p.getAttribute('data-panel') === tab);
  if (!target) return false;
  for (const p of panels) p.hidden = p !== target;
  for (const a of tabLinks) {
    if (a.getAttribute('data-tab') === tab) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  const link = tabLinks.find((a) => a.getAttribute('data-tab') === tab);
  if (link) document.title = `${link.firstChild.textContent.trim()} — ${baseTitle}`;
  const url = `${location.pathname}?tab=${tab}`;
  if (push) history.pushState({ tab }, '', url);
  else history.replaceState({ tab }, '', url);
  const el = anchor && document.getElementById(anchor);
  if (el) {
    const fold = el.closest('details');
    if (fold) fold.open = true;
    el.scrollIntoView({ block: 'start' });
  } else if (tabsNav && tabsNav.getBoundingClientRect().top < 0) {
    tabsNav.scrollIntoView({ block: 'start' });
  }
  return true;
}

if (panels.length) {
  document.addEventListener('click', (event) => {
    const a = event.target.closest('a[href]');
    if (!a || event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const url = new URL(a.href, location.href);
    const tab = url.searchParams.get('tab');
    if (url.origin !== location.origin || url.pathname !== location.pathname || !tab) return;
    if (showTab(tab, { anchor: decodeURIComponent(url.hash.slice(1)), push: true }))
      event.preventDefault();
  });
  addEventListener('popstate', () => {
    showTab(new URLSearchParams(location.search).get('tab') || 'today');
  });
  // An old link to an anchor (`/agents#profile-title`) opens the tab the anchor is on.
  const openHash = () => {
    const id = decodeURIComponent(location.hash.slice(1));
    const el = id && document.getElementById(id);
    if (el && panelOf(el)) showTab(panelOf(el), { anchor: id });
  };
  addEventListener('hashchange', openHash);
  if (location.hash) openHash();
}

// ------------------------------------------------ messages at the bottom of the screen

const pageError = document.querySelector('[data-page-error]');
const pageStatus = document.querySelector('[data-page-status]');
let statusTimer = 0;

function toast(box, message) {
  box.querySelector('[data-toast-text]').textContent = message;
  box.hidden = false;
}

function showError(message) {
  if (!pageError) return alert(message);
  toast(pageError, message);
}

function showStatus(message) {
  if (!pageStatus) return alert(message);
  toast(pageStatus, message);
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => (pageStatus.hidden = true), 12000);
}

document.querySelectorAll('[data-toast-close]').forEach((b) =>
  b.addEventListener('click', () => {
    b.closest('.toast').hidden = true;
  }),
);

async function agentsCall(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    location.href = '/auth/yandex';
    throw new Error('Войдите заново');
  }
  if (!res.ok) throw new Error(data.message || `Ошибка ${res.status}`);
  return data;
}

const FLASH_KEY = 'agents:flash';
const SCROLL_KEY = 'agents:scroll';

// What survives the reload after a change (the page is re-rendered by the server): the message
// and the place on the page.
try {
  const flash = sessionStorage.getItem(FLASH_KEY);
  if (flash) {
    sessionStorage.removeItem(FLASH_KEY);
    showStatus(flash);
  }
  const at = JSON.parse(sessionStorage.getItem(SCROLL_KEY) || 'null');
  sessionStorage.removeItem(SCROLL_KEY);
  if (at && at.url === location.pathname + location.search) scrollTo(0, at.y);
} catch {
  // Storage blocked: the message is just not shown after the reload.
}

function reloadWith(message) {
  try {
    sessionStorage.setItem(FLASH_KEY, message);
    sessionStorage.setItem(
      SCROLL_KEY,
      JSON.stringify({ url: location.pathname + location.search, y: scrollY }),
    );
  } catch {
    alert(message);
  }
  location.reload();
}

/** Another page, with the message shown there at the bottom of the screen. */
function goWith(url, message) {
  try {
    sessionStorage.setItem(FLASH_KEY, message);
  } catch {
    // Storage blocked: the page opens without the message.
  }
  location.href = url;
}

/** A change of settings; `done` says what changed, the manager's warnings follow it. */
async function changeSettings(changes, done) {
  const data = await agentsCall('POST', '/api/agents/settings', { changes });
  const warnings =
    data.warnings && data.warnings.length
      ? ` Управляющий предупреждает: ${data.warnings.join(' ')}`
      : '';
  reloadWith(`${done || 'Сохранено.'}${warnings}`);
}

function guarded(fn) {
  return (event) => {
    const el = event.currentTarget || event.target;
    Promise.resolve()
      .then(() => fn(event))
      .catch((err) => {
        showError(err.message);
        if (el && 'disabled' in el) el.disabled = false;
      });
  };
}

// ------------------------------------------------ dialogs

const permission = document.querySelector('[data-permission]');
const confirmBox = document.querySelector('[data-confirm-dialog]');

function ask(dialog, text, attr, fallback) {
  if (!dialog || typeof dialog.showModal !== 'function') return Promise.resolve(fallback(text));
  dialog.querySelector('.permission__text').textContent = text;
  return new Promise((resolve) => {
    const buttons = dialog.querySelectorAll(`[${attr}]`);
    const done = (answer) => {
      buttons.forEach((b) => b.removeEventListener('click', onClick));
      dialog.removeEventListener('cancel', onCancel);
      if (dialog.open) dialog.close();
      resolve(answer);
    };
    const onClick = (event) => done(event.currentTarget.getAttribute(attr));
    const onCancel = () => done('no');
    buttons.forEach((b) => b.addEventListener('click', onClick));
    dialog.addEventListener('cancel', onCancel);
    dialog.showModal();
    buttons[0].focus();
  });
}

// «Выполнить»: a duty that is off is not run — the agent asks for permission first, and nothing
// happens until the owner answers: once (the switches stay), always (switch on and run) or no.
const askPermission = (text) =>
  ask(permission, text, 'data-grant', (t) =>
    confirm(`${t}\n\nРазрешить один раз?`) ? 'once' : 'no',
  );

/** Yes or no before a change with consequences (the wave, a new token). */
const askConfirm = async (text) =>
  (await ask(confirmBox, text, 'data-answer', (t) => (confirm(t) ? 'yes' : 'no'))) === 'yes';

// ------------------------------------------------ team: agents, rights, waves, pause

document.querySelectorAll('[data-act="settings"]').forEach((button) =>
  button.addEventListener(
    'click',
    guarded(async () => {
      button.disabled = true;
      await changeSettings(
        JSON.parse(button.getAttribute('data-changes')),
        button.getAttribute('data-done'),
      );
    }),
  ),
);

const LEVEL_TITLES = { self: 'Сам', rule: 'Правило', approval: 'Согласование', off: 'Выкл' };

document.querySelectorAll('[data-act="level"]').forEach((button) =>
  button.addEventListener(
    'click',
    guarded(async () => {
      if (button.getAttribute('aria-pressed') === 'true') return;
      const duty = button.getAttribute('data-duty');
      const level = button.getAttribute('data-level');
      const group = button.closest('.seg');
      const was = group.querySelector('[aria-pressed="true"]');
      group.querySelectorAll('button').forEach((b) => {
        b.setAttribute('aria-pressed', String(b === button));
      });
      group.setAttribute('aria-busy', 'true');
      // «Выкл» switches the duty off; any other level switches it on with these rights.
      const changes =
        level === 'off'
          ? [{ op: 'duty', duty, enabled: false }]
          : [
              { op: 'duty', duty, enabled: true },
              { op: 'level', duty, level },
            ];
      try {
        await changeSettings(
          changes,
          `«${button.getAttribute('data-title')}»: права — ${LEVEL_TITLES[level]}.`,
        );
      } catch (err) {
        // Refused (above the ceiling, the server is down): the rights shown are the old ones.
        group.querySelectorAll('button').forEach((b) => {
          b.setAttribute('aria-pressed', String(b === was));
        });
        group.removeAttribute('aria-busy');
        throw err;
      }
    }),
  ),
);

document.querySelectorAll('[data-act="platform"]').forEach((button) =>
  button.addEventListener(
    'click',
    guarded(async () => {
      if (button.getAttribute('aria-pressed') === 'true') return;
      const group = button.closest('.seg');
      const was = group.querySelector('[aria-pressed="true"]');
      const press = (on) =>
        group.querySelectorAll('button').forEach((b) => {
          b.setAttribute('aria-pressed', String(b === on));
        });
      press(button);
      group.setAttribute('aria-busy', 'true');
      try {
        await changeSettings(
          [
            {
              op: 'platform',
              platform: button.getAttribute('data-platform'),
              mode: button.getAttribute('data-mode'),
            },
          ],
          `${button.getAttribute('data-title')}: ${button.textContent.toLowerCase()}.`,
        );
      } catch (err) {
        press(was);
        group.removeAttribute('aria-busy');
        throw err;
      }
    }),
  ),
);

document.querySelectorAll('[data-act="wave"]').forEach((button) =>
  button.addEventListener(
    'click',
    guarded(async () => {
      if (!(await askConfirm(button.getAttribute('data-confirm')))) return;
      button.disabled = true;
      const wave = Number(button.getAttribute('data-wave'));
      await changeSettings([{ op: 'wave', wave }], `Волна ${wave}: настройки агентов обновлены.`);
    }),
  ),
);

// The manager's autonomy: the owner confirms the level with what the manager does on it.
document.querySelectorAll('[data-act="autonomy"]').forEach((button) =>
  button.addEventListener(
    'click',
    guarded(async () => {
      if (!(await askConfirm(button.getAttribute('data-confirm')))) return;
      button.disabled = true;
      const level = Number(button.getAttribute('data-level'));
      await changeSettings(
        [{ op: 'autonomy', level }],
        `Уровень автономности ${level} «${button.getAttribute('data-title')}»: управляющий работает по новым правилам.`,
      );
    }),
  ),
);

// What runs after a run status, in plain words (the guide explains every status).
const STATUS_HINTS = [
  [/^на согласовании/, 'Подтвердите его на вкладке «Сегодня» → «Ждут решения» или в Telegram.'],
  [
    /^задача на согласовании/,
    'Уровень автономности 2: согласуйте задачу на вкладке «Сегодня» — дальше агент выполнит её сам.',
  ],
  [/^не запущено: уровень автономности/, 'Сменить уровень: «Команда» → «Режим работы».'],
  [/расширение ещё ни разу/, 'Установите и подключите расширение — шаг 1 настройки.'],
  [
    /нет подключённых систем/,
    'Отметьте нужные площадки в эталоне: «Объект» → «Системы и площадки».',
  ],
  [/^пауза/, 'Изменения выполнятся, когда закончится пауза («Команда» → «Режим работы»).'],
  [/^задание запущено/, 'Агент работает в вашем браузере — держите его открытым.'],
  [/^ошибка/, 'Попробуйте позже. Если повторяется — напишите нам с текстом ошибки.'],
];

function statusHint(status) {
  const hit = STATUS_HINTS.find(([re]) => re.test(status || ''));
  return hit ? ` ${hit[1]}` : '';
}

document.querySelectorAll('[data-act="run"]').forEach((button) =>
  button.addEventListener(
    'click',
    guarded(async () => {
      const duty = button.getAttribute('data-duty');
      const title = button.getAttribute('data-title');
      const path = `/api/agents/duties/${encodeURIComponent(duty)}/run`;
      button.disabled = true;
      let data = await agentsCall('POST', path);
      if (data.permission) {
        const grant = await askPermission(data.permission.text);
        if (grant === 'no') {
          showStatus(`«${title}» не выполнена: нет разрешения.`);
          button.disabled = false;
          return;
        }
        data = await agentsCall('POST', path, { grant });
        const warnings =
          data.warnings && data.warnings.length
            ? ` Управляющий предупреждает: ${data.warnings.join(' ')}`
            : '';
        if (grant === 'always')
          return reloadWith(`«${title}»: ${data.status}.${statusHint(data.status)}${warnings}`);
      }
      showStatus(`«${title}»: ${data.status}.${statusHint(data.status)}`);
      button.disabled = false;
    }),
  ),
);

const pauseForm = document.querySelector('form[data-form="pause"]');
if (pauseForm) {
  pauseForm.addEventListener(
    'submit',
    guarded(async (event) => {
      event.preventDefault();
      const until = pauseForm.elements.until.value;
      if (!until) throw new Error('Укажите дату, до которой пауза');
      await changeSettings(
        [{ op: 'pause', until, reason: pauseForm.elements.reason.value }],
        `Пауза до ${until.split('-').reverse().join('.')}: записи на площадках и сообщения ждут.`,
      );
    }),
  );
}

// ------------------------------------------------ settings: the manager, Telegram, webhooks

const ownerForm = document.querySelector('form[data-form="owner"]');
if (ownerForm) {
  ownerForm.addEventListener(
    'submit',
    guarded(async (event) => {
      event.preventDefault();
      const f = ownerForm.elements;
      await changeSettings(
        [
          {
            op: 'owner',
            summaryTime: f.summaryTime.value,
            quietFrom: f.quietFrom.value,
            quietTo: f.quietTo.value,
            urgentPerDay: Number(f.urgentPerDay.value),
          },
          { op: 'limits', reviewAutoMinStars: Number(f.reviewAutoMinStars.value) },
        ],
        'Настройки управляющего сохранены.',
      );
    }),
  );
}

// ------------------------------------------------ today: approvals, live

// «Сегодня» is the same desk the extension and the messenger bots show. While it is open it asks
// for itself again and puts the new one in place when something changed — a decision taken in
// Telegram shows here without a reload. Not while the owner is editing a text or deciding.

const todayPanel = document.querySelector('[data-panel="today"]');
const TODAY_EVERY_MS = 20_000;
let todayBusy = false;
let todayTimer = 0;

function editingToday() {
  return (
    !!todayPanel &&
    (!!todayPanel.querySelector('form[data-form="edit"]:not([hidden])') ||
      todayPanel.contains(document.activeElement && document.activeElement.closest('textarea')))
  );
}

async function refreshToday({ force = false } = {}) {
  if (!todayPanel || todayBusy || (!force && editingToday())) return;
  todayBusy = true;
  try {
    const res = await fetch('/api/agents/today', { credentials: 'same-origin' });
    if (res.status === 401) return;
    if (!res.ok) return;
    const data = await res.json();
    if (!force && data.rev && data.rev === todayPanel.getAttribute('data-rev')) return;
    todayPanel.innerHTML = data.today;
    if (data.rev) todayPanel.setAttribute('data-rev', data.rev);
    const strip = document.querySelector('[data-statuses]');
    if (strip && data.strip) strip.outerHTML = data.strip;
    const tab = document.querySelector('.tabs [data-tab="today"]');
    if (tab) {
      const old = tab.querySelector('.tabs__count');
      if (old) old.remove();
      if (data.count) tab.insertAdjacentHTML('beforeend', data.count);
    }
  } catch {
    // No connection right now: the next tick asks again.
  } finally {
    todayBusy = false;
  }
}

function scheduleToday() {
  clearTimeout(todayTimer);
  if (!todayPanel || document.visibilityState !== 'visible') return;
  todayTimer = setTimeout(async () => {
    await refreshToday();
    scheduleToday();
  }, TODAY_EVERY_MS);
}

if (todayPanel) {
  scheduleToday();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refreshToday().finally(scheduleToday);
    else clearTimeout(todayTimer);
  });
}

/** The card fades while the decision goes; then «Сегодня» is redrawn from the desk. */
async function decide(id, body, card, done) {
  if (card) card.classList.add('approval--busy');
  card?.querySelectorAll('button').forEach((b) => (b.disabled = true));
  try {
    const data = await agentsCall('POST', `/api/agents/approvals/${encodeURIComponent(id)}`, body);
    showStatus(
      `${done}: «${data.title || 'согласование'}».${data.comment ? ` ${data.comment}` : ''}`,
    );
  } catch (err) {
    if (card) card.classList.remove('approval--busy');
    card?.querySelectorAll('button').forEach((b) => (b.disabled = false));
    showError(err.message);
  }
  await refreshToday({ force: true });
}

document.addEventListener('click', (event) => {
  const button = event.target.closest(
    '[data-act="approve"], [data-act="reject"], [data-act="edit-open"]',
  );
  if (!button) return;
  const id = button.getAttribute('data-id');
  const act = button.getAttribute('data-act');
  const card = button.closest('[data-approval]');
  if (act === 'edit-open') {
    const form = card && card.querySelector('form[data-form="edit"]');
    if (form) {
      form.hidden = !form.hidden;
      if (!form.hidden) form.elements.text.focus();
    }
    return;
  }
  decide(id, { decision: act }, card, act === 'approve' ? 'Согласовано' : 'Отклонено');
});

document.addEventListener('submit', (event) => {
  const form = event.target.closest('form[data-form="edit"]');
  if (!form) return;
  event.preventDefault();
  const text = form.elements.text.value.trim();
  if (!text) return showError('Напишите новый текст.');
  decide(
    form.getAttribute('data-id'),
    { decision: 'edit', text },
    form.closest('[data-approval]'),
    'Изменено и согласовано',
  );
});

const telegramButton = document.querySelector('[data-act="telegram"]');
if (telegramButton) {
  telegramButton.addEventListener(
    'click',
    guarded(async () => {
      telegramButton.disabled = true;
      const data = await agentsCall('POST', '/api/agents/telegram');
      const hint = document.querySelector('[data-telegram]');
      hint.textContent = '';
      if (data.link) {
        const a = document.createElement('a');
        a.href = data.link;
        a.target = '_blank';
        a.rel = 'noopener';
        a.textContent = 'Открыть бота в Telegram';
        hint.append(a, ` — или отправьте боту: /start ${data.code}. Код действует 30 минут.`);
      } else hint.textContent = `Отправьте боту: /start ${data.code}. Код действует 30 минут.`;
      hint.hidden = false;
      telegramButton.disabled = false;
    }),
  );
}

// A chat linked to a bot in Telegram, MAX or WhatsApp: unlinked through the site.
document.querySelectorAll('[data-act="bot-unlink"]').forEach((button) =>
  button.addEventListener(
    'click',
    guarded(async () => {
      if (!(await askConfirm('Отвязать этот чат? Сообщения управляющего туда больше не придут.')))
        return;
      button.disabled = true;
      await agentsCall('POST', '/api/bots/unlink', {
        channel: button.getAttribute('data-channel'),
        chatId: button.getAttribute('data-chat'),
      });
      reloadWith('Чат отвязан.');
    }),
  ),
);

const hookButton = document.querySelector('[data-act="hook-token"]');
if (hookButton) {
  hookButton.addEventListener(
    'click',
    guarded(async () => {
      if (!(await askConfirm('Выпустить новый токен вебхуков? Старые адреса перестанут работать.')))
        return;
      hookButton.disabled = true;
      const data = await agentsCall('POST', '/api/agents/hook-token');
      const base = hookButton.getAttribute('data-base');
      document.querySelector('[data-hook-events]').value = base + data.events;
      document.querySelector('[data-hook-email]').value = base + data.email;
      document.querySelector('[data-hook]').hidden = false;
      hookButton.disabled = false;
    }),
  );
}

document.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-copy-from-attr]');
  if (!button) return;
  const input = document.querySelector(`[${button.getAttribute('data-copy-from-attr')}]`);
  if (input && input.value && (await copyText(input.value))) flashCopied(button);
});

// ------------------------------------------------ property: the reference
// Lists (rooms, answers, extras, competitors) are rows of fields; each row keeps the item it was
// made from, so fields the page does not show are kept. Systems are checkboxes with an address.

document.addEventListener('click', (event) => {
  const add = event.target.closest('[data-list-add]');
  if (add) {
    const box = add.closest('[data-list]');
    const row = box.querySelector('template[data-list-template]').content.firstElementChild;
    const copy = row.cloneNode(true);
    box.querySelector('.list-edit__rows').appendChild(copy);
    const first = copy.querySelector('input, textarea, select');
    if (first) first.focus();
    return;
  }
  const remove = event.target.closest('[data-list-remove]');
  if (remove) remove.closest('.list-edit__row').remove();
});

const fieldLabel = (el) =>
  (el.closest('label, .field')?.querySelector('.field__label')?.firstChild?.textContent || '')
    .trim()
    .replace(/\s+—.*$/, '');
const groupTitle = (el) =>
  el.closest('details.group')?.querySelector('summary span')?.textContent || 'Эталон';

function failAt(el, message) {
  const fold = el.closest('details');
  if (fold) fold.open = true;
  el.focus();
  return new Error(message);
}

function collectList(box) {
  const out = [];
  for (const row of box.querySelectorAll('.list-edit__rows > .list-edit__row')) {
    const fields = [...row.querySelectorAll('[data-key]')];
    // A row left empty is not an item: an added row the owner did not fill.
    if (fields.every((f) => f.tagName === 'SELECT' || !f.value.trim())) continue;
    const item = JSON.parse(row.getAttribute('data-item') || '{}');
    for (const f of fields) {
      const key = f.getAttribute('data-key');
      const value = f.value.trim();
      if (!value && f.hasAttribute('data-required'))
        throw failAt(f, `${groupTitle(f)}: заполните «${fieldLabel(f)}»`);
      if (!value) delete item[key];
      else if (f.getAttribute('data-type') === 'number') item[key] = Number(value);
      else item[key] = value;
    }
    out.push(item);
  }
  return out;
}

const TRANSLIT = {
  а: 'a',
  б: 'b',
  в: 'v',
  г: 'g',
  д: 'd',
  е: 'e',
  ё: 'e',
  ж: 'zh',
  з: 'z',
  и: 'i',
  й: 'y',
  к: 'k',
  л: 'l',
  м: 'm',
  н: 'n',
  о: 'o',
  п: 'p',
  р: 'r',
  с: 's',
  т: 't',
  у: 'u',
  ф: 'f',
  х: 'h',
  ц: 'ts',
  ч: 'ch',
  ш: 'sh',
  щ: 'sch',
  ы: 'y',
  э: 'e',
  ю: 'yu',
  я: 'ya',
};

/** A new room gets a short Latin code from its name; the codes of rooms never change. */
function roomIds(rooms) {
  const used = new Set(rooms.map((r) => r.id).filter(Boolean));
  for (const room of rooms) {
    if (room.id) continue;
    const base =
      [...String(room.name).toLowerCase()]
        .map((c) => TRANSLIT[c] ?? c)
        .join('')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 30) || 'room';
    let id = base;
    for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
    used.add(id);
    room.id = id;
  }
  return rooms;
}

const profileForm = document.querySelector('form[data-form="profile"]');
if (profileForm) {
  profileForm.noValidate = true;
  const error = profileForm.querySelector('[data-error]');
  profileForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    error.hidden = true;
    const f = profileForm.elements;
    const button = profileForm.querySelector('button[type="submit"]');
    try {
      for (const input of profileForm.querySelectorAll('input')) {
        // A system that is not ticked is not sent: what is typed in it does not matter.
        const sys = input.closest('[data-sys]');
        if (sys && !sys.querySelector('[data-sys-on]').checked) continue;
        if (!input.checkValidity())
          throw failAt(
            input,
            `${groupTitle(input)}: проверьте «${fieldLabel(input) || input.getAttribute('aria-label') || 'поле'}» — ${input.validationMessage}`,
          );
      }
      const profile = JSON.parse(f.base.value);
      for (const key of ['name', 'address', 'phone', 'checkIn', 'checkOut', 'directions'])
        profile[key] = f[key].value.trim();
      if (!profile.name) throw failAt(f.name, 'Основное: укажите название объекта');
      if (f.website.value.trim()) profile.website = f.website.value.trim();
      else delete profile.website;
      profile.amenities = f.amenities.value
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean);
      profile.policies = { ...(profile.policies || {}) };
      for (const key of ['children', 'pets', 'prepayment', 'cancellation'])
        profile.policies[key] = f[`policies.${key}`].value.trim();
      profile.priceCorridor = {
        ...(profile.priceCorridor || {}),
        percent: Number(f.corridor.value || 10),
      };
      if (f.adsMonthlyBudget.value) profile.adsMonthlyBudget = Number(f.adsMonthlyBudget.value);
      else delete profile.adsMonthlyBudget;
      for (const box of profileForm.querySelectorAll('[data-list]'))
        profile[box.getAttribute('data-list')] = collectList(box);
      profile.rooms = roomIds(profile.rooms || []);
      profile.systems = [];
      for (const sys of profileForm.querySelectorAll('[data-sys]')) {
        if (!sys.querySelector('[data-sys-on]').checked) continue;
        const item = JSON.parse(sys.getAttribute('data-item'));
        for (const f of sys.querySelectorAll('[data-key]')) {
          const key = f.getAttribute('data-key');
          const value = f.value.trim();
          if (!value) delete item[key];
          else item[key] = f.getAttribute('data-type') === 'number' ? Number(value) : value;
        }
        profile.systems.push(item);
      }
      button.disabled = true;
      await agentsCall('PUT', '/api/agents/profile', profile);
      reloadWith('Эталон сохранён — агенты уже работают по нему.');
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
      button.disabled = false;
    }
  });
}

// ---------------------------------------------------------------- guide
// Search filters the questions as you type; a link to /help#<id> opens that answer.

const guideSearch = document.querySelector('[data-guide-search]');

function openFromHash() {
  const id = decodeURIComponent(location.hash.slice(1));
  if (!id) return;
  const target = document.getElementById(id);
  if (target && target.tagName === 'DETAILS') {
    target.open = true;
    target.scrollIntoView({ block: 'start' });
  }
}

if (guideSearch) {
  const items = [...document.querySelectorAll('.guide-item')];
  const topics = [...document.querySelectorAll('.guide-topic')];
  const empty = document.querySelector('[data-guide-empty]');
  const norm = (s) => s.toLowerCase().replace(/ё/g, 'е');
  const texts = new Map(items.map((d) => [d, norm(d.textContent)]));

  guideSearch.addEventListener('input', () => {
    const words = norm(guideSearch.value).split(/\s+/).filter(Boolean);
    let shown = 0;
    for (const d of items) {
      const hit = words.every((w) => texts.get(d).includes(w));
      d.hidden = !hit;
      // While searching, open the matches so the answer is visible at once.
      d.open = words.length > 0 && hit;
      if (hit) shown++;
    }
    for (const t of topics) t.hidden = !t.querySelector('.guide-item:not([hidden])');
    empty.hidden = shown > 0;
  });

  window.addEventListener('hashchange', openFromHash);
  openFromHash();
}

// ---------------------------------------------------------------- folded agent cards
// Duties of every agent are folded by default. The page remembers which cards the owner opened,
// so a change of rights (which reloads the page) does not fold the card being edited.

const FOLD_KEY = 'agents:open';
const folds = [...document.querySelectorAll('details[data-fold]')];

function readFolds() {
  try {
    return new Set(JSON.parse(sessionStorage.getItem(FOLD_KEY) || '[]'));
  } catch {
    return new Set();
  }
}

function writeFolds(open) {
  try {
    sessionStorage.setItem(FOLD_KEY, JSON.stringify([...open]));
  } catch {
    // Storage blocked: cards just start folded after a reload.
  }
}

if (folds.length) {
  const open = readFolds();
  for (const d of folds) if (open.has(d.getAttribute('data-fold'))) d.open = true;
  const foldAll = document.querySelector('[data-fold-all]');
  const syncFoldAll = () => {
    if (foldAll)
      foldAll.textContent = folds.every((d) => d.open) ? 'Свернуть всё' : 'Развернуть всё';
  };
  for (const d of folds)
    d.addEventListener('toggle', () => {
      const now = readFolds();
      if (d.open) now.add(d.getAttribute('data-fold'));
      else now.delete(d.getAttribute('data-fold'));
      writeFolds(now);
      syncFoldAll();
    });
  if (foldAll)
    foldAll.addEventListener('click', () => {
      const target = !folds.every((d) => d.open);
      for (const d of folds) d.open = target;
    });
  syncFoldAll();
}

// ---------------------------------------------------------------- reference from a card
// A link or the text of a card goes to the agent; while it reads, the page polls and reloads
// with the draft. The draft is applied field by field — nothing changes before that.

const importError = document.querySelector('[data-import-error]');

function showImportError(message) {
  if (!importError) return showError(message);
  importError.textContent = message;
  importError.hidden = false;
}

async function startImport(body, form) {
  if (importError) importError.hidden = true;
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    const data = await agentsCall('POST', '/api/agents/profile/import', body);
    if (data.status === 'failed') throw new Error(`Не получилось: ${data.error}`);
    location.reload();
  } catch (err) {
    showImportError(err.message);
    button.disabled = false;
  }
}

const importUrl = document.querySelector('form[data-form="import-url"]');
if (importUrl)
  importUrl.addEventListener('submit', (event) => {
    event.preventDefault();
    startImport({ url: importUrl.elements.url.value.trim() }, importUrl);
  });

const importText = document.querySelector('form[data-form="import-text"]');
if (importText)
  importText.addEventListener('submit', (event) => {
    event.preventDefault();
    startImport({ text: importText.elements.text.value }, importText);
  });

const importPoll = document.querySelector('[data-import-poll]');
if (importPoll) {
  const id = importPoll.getAttribute('data-import-poll');
  const started = Date.now();
  const tick = async () => {
    try {
      const res = await fetch(`/api/agents/profile/import/${encodeURIComponent(id)}`, {
        credentials: 'same-origin',
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.status === 'failed') {
        importPoll.classList.remove('import--wait');
        importPoll.textContent = `Не получилось прочитать карточку: ${data.error}. Попробуйте ещё раз или вставьте текст карточки.`;
        importPoll.classList.add('error');
        setTimeout(() => location.reload(), 8000);
        return;
      }
      if (res.ok && data.status !== 'reading') return location.reload();
    } catch {
      // A network hiccup: try again on the next tick.
    }
    if (Date.now() - started < 15 * 60_000) setTimeout(tick, 5000);
  };
  setTimeout(tick, 5000);
}

const importApply = document.querySelector('form[data-form="import-apply"]');
if (importApply) {
  importApply.addEventListener(
    'submit',
    guarded(async (event) => {
      event.preventDefault();
      const fields = [...importApply.querySelectorAll('input[name="field"]:checked')].map(
        (x) => x.value,
      );
      if (!fields.length) throw new Error('Отметьте хотя бы одно поле');
      const id = importApply.getAttribute('data-id');
      const data = await agentsCall(
        'POST',
        `/api/agents/profile/import/${encodeURIComponent(id)}/apply`,
        { fields },
      );
      reloadWith(`Эталон обновлён: ${(data.applied || []).join(', ')}.`);
    }),
  );
}

document.querySelectorAll('[data-act="import-discard"]').forEach((button) =>
  button.addEventListener(
    'click',
    guarded(async () => {
      button.disabled = true;
      const id = button.getAttribute('data-id');
      await agentsCall('POST', `/api/agents/profile/import/${encodeURIComponent(id)}/discard`);
      location.reload();
    }),
  ),
);

// ---------------------------------------------------------------- after the reference

// A search runs: the page asks for its state every 5 s and reloads when a platform is done (what
// it found shows at once) and when the whole search is. The state is computed as on the server.
const pollState = (data) =>
  JSON.stringify((data.platforms ?? []).map((x) => [x.status, x.found ?? null]));
document.querySelectorAll('[data-poll-url]').forEach((box) => {
  const url = box.getAttribute('data-poll-url');
  const shown = box.getAttribute('data-poll-state');
  const started = Date.now();
  const tick = async () => {
    try {
      const res = await fetch(url, { credentials: 'same-origin' });
      const data = await res.json().catch(() => null);
      if (res.ok && data && (data.status !== 'searching' || (shown && pollState(data) !== shown)))
        return location.reload();
    } catch {
      // A network hiccup: try again on the next tick.
    }
    if (Date.now() - started < 30 * 60_000) setTimeout(tick, 5000);
  };
  setTimeout(tick, 5000);
});

const startSearch = (path, message) =>
  guarded(async (event) => {
    event.currentTarget.disabled = true;
    await agentsCall('POST', path);
    reloadWith(message);
  });

document
  .querySelectorAll('[data-act="listings-start"]')
  .forEach((b) =>
    b.addEventListener(
      'click',
      startSearch('/api/agents/listings', 'Агент ищет объявление на площадках.'),
    ),
  );

document
  .querySelectorAll('[data-act="competitors-start"]')
  .forEach((b) =>
    b.addEventListener(
      'click',
      startSearch('/api/agents/competitors', 'Агент ищет конкурентов рядом.'),
    ),
  );

document.querySelectorAll('[data-act="listing-verdict"]').forEach((button) =>
  button.addEventListener(
    'click',
    guarded(async () => {
      button.disabled = true;
      const id = encodeURIComponent(button.getAttribute('data-id'));
      const platform = encodeURIComponent(button.getAttribute('data-platform'));
      const mine = button.getAttribute('data-mine') === '1';
      await agentsCall('POST', `/api/agents/listings/${id}/${platform}`, { mine });
      reloadWith(mine ? 'Площадка подключена в «Системы и площадки».' : 'Отмечено: не ваше.');
    }),
  ),
);

// «Внести вручную»: the owner's own address of the listing; the platform is registered at once.
const listingManual = document.querySelector('form[data-form="listing-manual"]');
if (listingManual)
  listingManual.addEventListener(
    'submit',
    guarded(async (event) => {
      event.preventDefault();
      const button = listingManual.querySelector('button[type="submit"]');
      button.disabled = true;
      const select = listingManual.elements.platform;
      const title = select.options[select.selectedIndex]?.text ?? select.value;
      try {
        await agentsCall('POST', '/api/agents/listings/manual', {
          platform: select.value,
          url: listingManual.elements.url.value.trim(),
        });
      } finally {
        button.disabled = false;
      }
      reloadWith(
        `${title}: объявление подключено в «Системы и площадки» — агент будет читать его по ссылке, без поиска.`,
      );
    }),
  );

// «Внести ссылку» in a row: opens the form with that platform chosen.
document.querySelectorAll('[data-act="listing-manual-pick"]').forEach((button) =>
  button.addEventListener('click', () => {
    const box = document.querySelector('[data-listing-manual]');
    if (!box || !listingManual) return;
    box.open = true;
    listingManual.elements.platform.value = button.getAttribute('data-platform');
    listingManual.elements.url.focus();
    box.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }),
);

document.querySelectorAll('[data-act="listing-publish"]').forEach((button) =>
  button.addEventListener(
    'click',
    guarded(async () => {
      button.disabled = true;
      const id = encodeURIComponent(button.getAttribute('data-id'));
      const platform = encodeURIComponent(button.getAttribute('data-platform'));
      await agentsCall('POST', `/api/agents/listings/${id}/${platform}/publish`);
      reloadWith(
        `Размещение на площадке ${button.getAttribute('data-title')} — на согласовании: согласуйте его на вкладке «Сегодня» или в Telegram.`,
      );
    }),
  ),
);

document.querySelectorAll('[data-act="listings-sync"]').forEach((button) =>
  button.addEventListener(
    'click',
    guarded(async () => {
      const title = button.getAttribute('data-title');
      button.disabled = true;
      let data = await agentsCall('POST', '/api/agents/listings/sync');
      if (data.permission) {
        const grant = await askPermission(data.permission.text);
        if (grant === 'no') {
          showStatus(`«${title}» не выполнено: нет разрешения.`);
          button.disabled = false;
          return;
        }
        data = await agentsCall('POST', '/api/agents/listings/sync', { grant });
      }
      reloadWith(`«${title}»: ${data.status}.${statusHint(data.status)}`);
    }),
  ),
);

// An answer about a candidate changes only its own row: the owner goes through the list.
document.querySelectorAll('[data-act="competitor-verdict"]').forEach((button) =>
  button.addEventListener(
    'click',
    guarded(async () => {
      const row = button.closest('[data-candidate]');
      const buttons = row.querySelectorAll('[data-act="competitor-verdict"]');
      buttons.forEach((b) => (b.disabled = true));
      const id = encodeURIComponent(button.getAttribute('data-id'));
      const data = await agentsCall('POST', `/api/agents/competitors/candidates/${id}`, {
        verdict: button.getAttribute('data-verdict'),
      });
      buttons.forEach((b) => {
        b.disabled = false;
        b.setAttribute('aria-pressed', String(b === button));
      });
      const count = document.querySelector('[data-competitors-count]');
      if (count && data.competitors)
        count.textContent = `В «Конкурентах» сейчас: ${data.competitors.length}.`;
      if (data.note) showStatus(data.note);
    }),
  ),
);

// «Цены»: the marks of the charts show their values on hover and focus. The values are in
// data-tip as [title, [[value, label]…]] and go in as text, never as markup.
const marks = document.querySelectorAll('[data-tip]');
if (marks.length) {
  const tipBox = document.createElement('div');
  tipBox.className = 'viz-tip';
  tipBox.setAttribute('aria-hidden', 'true');
  tipBox.hidden = true;
  document.body.appendChild(tipBox);
  const place = (x, y) => {
    const w = tipBox.offsetWidth;
    const h = tipBox.offsetHeight;
    tipBox.style.left = `${Math.max(8, Math.min(x + 14, innerWidth - w - 8))}px`;
    tipBox.style.top = `${y + 14 + h > innerHeight - 8 ? Math.max(8, y - h - 14) : y + 14}px`;
  };
  const show = (el, x, y) => {
    let data;
    try {
      data = JSON.parse(el.getAttribute('data-tip'));
    } catch {
      return;
    }
    const [title, rows] = data;
    tipBox.replaceChildren();
    const head = document.createElement('div');
    head.className = 'viz-tip__title';
    head.textContent = title;
    tipBox.appendChild(head);
    for (const [value, label] of rows) {
      const row = document.createElement('div');
      row.className = 'viz-tip__row';
      const b = document.createElement('b');
      b.textContent = value;
      const span = document.createElement('span');
      span.textContent = label;
      row.append(b, span);
      tipBox.appendChild(row);
    }
    tipBox.hidden = false;
    place(x, y);
  };
  const hide = () => (tipBox.hidden = true);
  marks.forEach((el) => {
    el.addEventListener('pointerenter', (e) => show(el, e.clientX, e.clientY));
    // A scroll hides the tip; the next move over the same mark brings it back.
    el.addEventListener('pointermove', (e) =>
      tipBox.hidden ? show(el, e.clientX, e.clientY) : place(e.clientX, e.clientY),
    );
    el.addEventListener('pointerleave', hide);
    el.addEventListener('focus', () => {
      const r = el.getBoundingClientRect();
      show(el, r.left + r.width / 2, r.top + r.height / 2);
    });
    el.addEventListener('blur', hide);
  });
  addEventListener('scroll', hide, { passive: true });
}

// The proofs of one competitor at a time.
const proofsFilter = document.querySelector('[data-proofs-filter]');
if (proofsFilter)
  proofsFilter.addEventListener('change', () => {
    const name = proofsFilter.value;
    document.querySelectorAll('[data-proof]').forEach((row) => {
      row.hidden = !!name && row.getAttribute('data-proof') !== name;
    });
  });

// «Принять»: the base prices of the chosen categories move to the recommendation.
const acceptForm = document.querySelector('form[data-form="prices-accept"]');
if (acceptForm)
  acceptForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const button = acceptForm.querySelector('button[type="submit"]');
    const rooms = [...acceptForm.querySelectorAll('input[name="room"]:checked')].map(
      (i) => i.value,
    );
    if (!rooms.length) return showError('Отметьте категории, для которых принять цену.');
    button.disabled = true;
    agentsCall('POST', '/api/agents/prices/accept', { rooms })
      .then((data) =>
        reloadWith(
          `Базовые цены в эталоне изменены: ${data.changed.join('; ')}. Правки для площадок придут одним согласованием.`,
        ),
      )
      .catch((err) => {
        showError(err.message);
        button.disabled = false;
      });
  });

// ---------------------------------------------------------------- «Изучение»
// After the setup the agents only read the cabinets. While a study runs the agents page asks for
// it every 15 s and reloads when a cabinet is done; the owner ends it (the agents then work by
// their rights) or studies the cabinets again.

const studyPoll = document.querySelector('[data-study-poll]');
if (studyPoll) {
  const shown = studyPoll.getAttribute('data-study-poll');
  const started = Date.now();
  const tick = async () => {
    try {
      const res = await fetch('/api/agents/study', { credentials: 'same-origin' });
      const data = await res.json().catch(() => null);
      const state = data && JSON.stringify((data.items ?? []).map((x) => [x.system, x.status]));
      if (res.ok && data && (!data.on || state !== shown)) return location.reload();
    } catch {
      // A network hiccup: try again on the next tick.
    }
    if (Date.now() - started < 60 * 60_000) setTimeout(tick, 15_000);
  };
  setTimeout(tick, 15_000);
}

document.querySelectorAll('[data-act="study-end"]').forEach((button) =>
  button.addEventListener(
    'click',
    guarded(async () => {
      if (!(await askConfirm(button.getAttribute('data-confirm')))) return;
      button.disabled = true;
      await agentsCall('POST', '/api/agents/study', { on: false });
      reloadWith('Изучение закончено — агенты работают по своим правам.');
    }),
  ),
);

document.querySelectorAll('[data-act="study-start"]').forEach((button) =>
  button.addEventListener(
    'click',
    guarded(async () => {
      button.disabled = true;
      await agentsCall('POST', '/api/agents/study', { on: true });
      reloadWith('Агенты снова изучают ваши кабинеты — ничего не меняя.');
    }),
  ),
);

// ---------------------------------------------------------------- setup wizard
// Every step saves through /api/onboarding/* (same origin, session cookie); the site forwards it to
// the Goldfish server on the owner's behalf and says what did not go through.

/** The form's own error line, under its fields. */
function formError(form, message) {
  const box = form.querySelector('[data-form-error]');
  if (!box) return showError(message);
  box.textContent = message;
  box.hidden = !message;
}

function setupForm(name, submit) {
  const form = document.querySelector(`form[data-form="${name}"]`);
  if (!form) return;
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = form.querySelector('button[type="submit"]');
    formError(form, '');
    button.disabled = true;
    try {
      await submit(form);
    } catch (err) {
      formError(form, err.message);
      button.disabled = false;
    }
  });
}

// Step 2: a field per platform; the radio marks the reference listing the agent reads.
setupForm('setup-listings', async (form) => {
  const listings = [...form.querySelectorAll('input[name="listing"]')].map((input) => ({
    platform: input.getAttribute('data-platform'),
    url: input.value.trim(),
  }));
  for (const l of listings)
    if (l.url && !/^https?:\/\//i.test(l.url)) {
      form.querySelector(`input[data-platform="${l.platform}"]`).focus();
      throw new Error('Вставьте ссылку на объявление целиком, с https://');
    }
  const filled = listings.filter((l) => l.url);
  const checked = form.querySelector('input[name="reference"]:checked');
  let reference = checked ? checked.value : null;
  if (reference && !filled.some((l) => l.platform === reference)) reference = null;
  // One guest listing and no choice: it is the reference.
  const guest = [...form.querySelectorAll('input[name="reference"]')].map((r) => r.value);
  if (!reference) {
    const only = filled.filter((l) => guest.includes(l.platform));
    if (only.length === 1) reference = only[0].platform;
  }
  if (filled.length && !reference)
    throw new Error('Отметьте эталонное объявление — кружком слева от площадки');
  const data = await agentsCall('POST', '/api/onboarding/listings', { listings, reference });
  goWith(
    '/start?step=3',
    data.importStarted
      ? 'Объявления сохранены. Агент читает эталонное объявление — черновик эталона появится на шаге 2.'
      : 'Объявления сохранены.',
  );
});

// Step 3: the CRM; the address field follows the CRM chosen, «Нет CRM» needs none.
const crmForm = document.querySelector('form[data-form="setup-crm"]');
if (crmForm) {
  const select = crmForm.elements.system;
  const url = crmForm.elements.url;
  const follow = () => {
    const option = select.selectedOptions[0];
    url.disabled = select.value === 'none';
    if (option && option.getAttribute('data-placeholder'))
      url.placeholder = option.getAttribute('data-placeholder');
  };
  select.addEventListener('change', follow);
  follow();
}
setupForm('setup-crm', async (form) => {
  const system = form.elements.system.value;
  if (!system) throw new Error('Выберите вашу CRM');
  await agentsCall('POST', '/api/onboarding/crm', { system, url: form.elements.url.value.trim() });
  reloadWith(system === 'none' ? 'Сохранено: CRM нет.' : 'Кабинет CRM сохранён.');
});

// Step 4: the team, the autonomy after the study, and the launch of the study.
setupForm('setup-team', async (form) => {
  const agents = [...form.querySelectorAll('input[name="agent"]:checked')].map((x) => x.value);
  if (!agents.length) throw new Error('Отметьте хотя бы одного агента');
  const level = form.querySelector('input[name="autonomy"]:checked');
  const data = await agentsCall('POST', '/api/onboarding/finish', {
    agents,
    ...(level ? { autonomy: Number(level.value) } : {}),
  });
  goWith(
    data.redirect || '/agents',
    'Готово: агенты изучают ваши кабинеты и ничего не меняют. Как идёт изучение — вверху страницы.',
  );
});
