import qrcode from 'qrcode-generator';
import type { BotsView } from '../bots.js';
import { esc } from './page.js';

/** What the pages know about the bots: the view, or that the bots server did not answer. */
export type BotsState = BotsView | 'unavailable';

/** Light modules around the code: scanners need them (4 by the standard). */
const QUIET = 4;

/**
 * A QR code as inline SVG: one path of dark runs on a white square, sized by CSS. No styles in
 * the markup — the page's CSP allows only its own stylesheet.
 */
export function qrSvg(text: string, label: string): string {
  const qr = qrcode(0, 'M');
  qr.addData(text, 'Byte');
  qr.make();
  const n = qr.getModuleCount();
  const size = n + QUIET * 2;
  let d = '';
  for (let y = 0; y < n; y++) {
    let x = 0;
    while (x < n) {
      if (!qr.isDark(y, x)) {
        x += 1;
        continue;
      }
      let run = 1;
      while (x + run < n && qr.isDark(y, x + run)) run += 1;
      d += `M${x + QUIET} ${y + QUIET}h${run}v1h-${run}z`;
      x += run;
    }
  }
  return `<svg class="qr" viewBox="0 0 ${size} ${size}" role="img" aria-label="${esc(label)}" shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}

const ACTION: Record<string, string> = {
  telegram: 'нажмите «Старт»',
  max: 'нажмите «Начать»',
  whatsapp: 'отправьте сообщение с кодом',
};

const time = (iso: string) =>
  new Date(iso).toLocaleTimeString('ru-RU', {
    timeZone: 'Europe/Moscow',
    hour: '2-digit',
    minute: '2-digit',
  });

const date = (iso: string) =>
  new Date(iso).toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow' });

/**
 * «Боты в мессенджерах»: a QR code per messenger with the owner's one-time code, which chats are
 * linked and unlinking them. `refreshHref` is the page itself: new codes are made on each open.
 */
export function botsBlock(state: BotsState, refreshHref: string): string {
  if (state === 'unavailable')
    return `<p class="hint">Сервер ботов сейчас не отвечает — QR-коды появятся, когда он вернётся. <a href="${esc(refreshHref)}">Обновить</a></p>`;
  if (!state.channels.length)
    return `<p class="hint">Боты в мессенджерах ещё не настроены на сервере.</p>`;
  const linked = new Map<string, string[]>();
  for (const l of state.links)
    linked.set(l.channel, [...(linked.get(l.channel) ?? []), l.name ?? 'чат']);
  const cards = state.channels.map((c) => {
    const offer = state.offers.find((o) => o.channel === c.id);
    const who = linked.get(c.id);
    const status = who
      ? `<span class="bot-qr__state bot-qr__state--on">привязан: ${esc(who.join(', '))}</span>`
      : `<span class="bot-qr__state">не привязан</span>`;
    if (!offer)
      return `<figure class="bot-qr">
      <div class="bot-qr__code bot-qr__code--empty" aria-hidden="true">?</div>
      <figcaption class="bot-qr__caption"><b>${esc(c.title)}</b>${status}<span class="hint">бот не отвечает — обновите страницу позже</span></figcaption>
    </figure>`;
    return `<figure class="bot-qr" data-bot="${esc(c.id)}">
      <a class="bot-qr__code" href="${esc(offer.url)}" target="_blank" rel="noopener">${qrSvg(offer.url, `QR-код: бот Goldfish в ${c.title}`)}</a>
      <figcaption class="bot-qr__caption"><b>${esc(c.title)}</b>${status}<span class="hint">${esc(ACTION[c.id] ?? 'откройте бота')}</span></figcaption>
      <a class="btn btn--ghost btn--sm" href="${esc(offer.url)}" target="_blank" rel="noopener">Открыть в ${esc(c.title)}</a>
    </figure>`;
  });
  const links = state.links.length
    ? `<ul class="bot-links" aria-label="Привязанные чаты">
${state.links
  .map(
    (l) =>
      `      <li><span><b>${esc(l.title)}</b> · ${esc(l.name ?? 'чат')} · с ${esc(date(l.linkedAt))}</span><button class="link" type="button" data-act="bot-unlink" data-channel="${esc(l.channel)}" data-chat="${esc(l.chatId)}">Отвязать</button></li>`,
  )
  .join('\n')}
    </ul>`
    : '';
  return `<div class="bots">
  <div class="bots__grid">
    ${cards.join('\n    ')}
  </div>
  <p class="hint">Наведите камеру телефона на QR-код или нажмите «Открыть» на телефоне — откроется бот Goldfish; затем ${esc(state.channels.map((c) => `в ${c.title} ${ACTION[c.id] ?? 'откройте бота'}`).join(', '))}. ${state.expiresAt ? `Коды одноразовые и действуют до ${esc(time(state.expiresAt))} — <a href="${esc(refreshHref)}">обновить</a>.` : ''}</p>
  ${links}
</div>`;
}
