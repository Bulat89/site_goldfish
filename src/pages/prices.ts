import { cabinetPage, type CabinetState } from './cabinet.js';
import { cabinetHref, esc, helpLink } from './page.js';

/**
 * «Цены»: the direct competitors the pricing agent chose, the average and the median of their
 * prices, the price it recommends, and every number with its proof — the words of the page it was
 * read on, the page and when. Charts are SVG drawn here: the page's CSP allows no inline styles,
 * so sizes are SVG attributes (percent across, pixels down) and colours come from style.css.
 */

/** One price as an agent read it (GET …/hotel/prices, `proofs`). */
export interface PriceProofView {
  competitor: string;
  url: string | null;
  day: string | null;
  price: number;
  quote: string | null;
  source: string | null;
  readAt: string;
  taskId: string | null;
  origin: 'search' | 'monitor';
}

export interface PriceStatsView {
  n: number;
  mean: number;
  median: number;
  min: number;
  max: number;
  p25: number;
  p75: number;
}

/** GET …/hotel/prices. */
export interface PriceBoardView {
  updatedAt: string | null;
  basis: 'monitor' | 'search' | null;
  own: {
    priceFrom: number | null;
    rooms: Array<{ id: string; name: string; basePrice: number | null }>;
  };
  competitors: Array<{
    name: string;
    url: string | null;
    platform: string | null;
    by: 'agent' | 'owner' | 'manual';
    reason: string | null;
    kind: string | null;
    rating: number | null;
    distanceKm: number | null;
    price: number | null;
    prices: number;
  }>;
  stats: PriceStatsView | null;
  recommendation: {
    price: number;
    mean: number;
    median: number;
    own: number | null;
    diffPercent: number | null;
    text: string;
    rooms: Array<{ id: string; name: string; current: number; recommended: number }>;
  } | null;
  note: string | null;
  byDay: Array<{ day: string; n: number; mean: number; median: number; min: number; max: number }>;
  history: Array<{ day: string; n: number; mean: number; median: number }>;
  proofs: PriceProofView[];
  search: { id: string; found: number; direct: number; createdAt: string } | null;
}

export interface PricesState extends CabinetState {
  board: PriceBoardView | null;
}

const rub = (n: number) => `${Math.round(n).toLocaleString('ru-RU')}\u00a0₽`;
const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n)}%`;
const safeUrl = (url: string | null) => (url && /^https?:\/\//i.test(url) ? url : null);
const host = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
};
const WEEKDAYS = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
/** «2026-10-17» → «17.10, сб». */
const night = (day: string) =>
  `${day.slice(8, 10)}.${day.slice(5, 7)}, ${WEEKDAYS[new Date(`${day}T12:00:00Z`).getUTCDay()]}`;
const short = (day: string) => `${day.slice(8, 10)}.${day.slice(5, 7)}`;
const moment = (iso: string) =>
  new Date(iso).toLocaleString('ru-RU', {
    timeZone: 'Europe/Moscow',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
/** Percent with two decimals: an SVG coordinate. */
const at = (x: number) => `${Math.round(x * 100) / 100}%`;
/** A tooltip: a title line and value rows; app.js renders it with textContent. */
const tip = (title: string, rows: Array<[string, string]>) => esc(JSON.stringify([title, rows]));

const BY_TITLES: Record<PriceBoardView['competitors'][number]['by'], string> = {
  agent: 'агент',
  owner: 'вы',
  manual: 'вручную в эталоне',
};

/** Clean ticks over the range: 4–6 of them at 1, 2, 2.5 or 5 × 10ⁿ. */
export function ticks(lo: number, hi: number, count = 4): number[] {
  if (!(hi > lo)) {
    const pad = Math.max(100, Math.abs(lo) * 0.1);
    return ticks(lo - pad, hi + pad, count);
  }
  const raw = (hi - lo) / count;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = ([1, 2, 2.5, 5, 10].find((m) => m * pow >= raw) ?? 10) * pow;
  const out: number[] = [];
  for (let v = Math.floor(lo / step) * step; v <= Math.ceil(hi / step) * step + step / 2; v += step)
    out.push(Math.round(v));
  return out;
}

/** Axis ticks are compact: «6 тыс.», «5,5 тыс.». */
const tickLabel = (v: number) =>
  v >= 1000
    ? `${(v / 1000).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} тыс.`
    : String(v);

/** A legend entry: a short line key of the series colour, then its name and value. */
const key = (cls: string, label: string, value?: string) =>
  `<span class="viz__key"><svg width="18" height="10" aria-hidden="true"><line class="${cls}" x1="1" y1="5" x2="17" y2="5"/></svg>${esc(label)}${value ? ` <b>${esc(value)}</b>` : ''}</span>`;

/**
 * Each direct competitor's price as a bar (grey: the competitors are the context), with the
 * median, the average and the owner's price as lines across — the point of the chart.
 */
function competitorBars(b: PriceBoardView): string {
  const rows = b.competitors
    .filter((c) => c.price !== null)
    .sort((x, y) => x.price! - y.price!) as Array<
    PriceBoardView['competitors'][number] & { price: number }
  >;
  if (!rows.length || !b.stats) return '';
  const own = b.own.priceFrom;
  const top = Math.max(...rows.map((r) => r.price), b.stats.mean, own ?? 0) * 1.28;
  const x = (v: number) => (v / top) * 100;
  const ROW = 40;
  const h = rows.length * ROW;
  const bars = rows
    .map((r, i) => {
      const y = i * ROW;
      const w = x(r.price);
      const label = `${r.name}: ${rub(r.price)}`;
      return `<g class="viz__mark" tabindex="0" role="listitem" aria-label="${esc(label)}" data-tip="${tip(
        r.name,
        [
          [rub(r.price), 'типичная цена'],
          ...(own
            ? ([[signed(Math.round(((r.price - own) / own) * 100)), 'к вашей цене']] as Array<
                [string, string]
              >)
            : []),
          ...(r.platform ? ([[r.platform, 'площадка']] as Array<[string, string]>) : []),
        ],
      )}">
      <rect class="viz__hit" x="0" y="${y}" width="100%" height="${ROW}"/>
      <rect class="viz__bar" x="0" y="${y + 12}" width="${at(w)}" height="16" rx="4"/>
      <rect class="viz__bar" x="0" y="${y + 12}" width="${at(Math.min(w / 2, 3))}" height="16"/>
    </g>`;
    })
    .join('\n');
  // Values go over the lines, each with a halo of the surface: a line never crosses a number.
  const values = rows
    .map(
      (r, i) =>
        `<text class="viz__value" x="${at(x(r.price))}" dx="6" y="${i * ROW + 24}">${esc(rub(r.price))}</text>`,
    )
    .join('');
  const ref = (cls: string, v: number) =>
    `<line class="${cls}" x1="${at(x(v))}" x2="${at(x(v))}" y1="2" y2="${h - 2}"/>`;
  return `<figure class="viz" aria-labelledby="bars-title">
  <figcaption class="viz__head">
    <h3 id="bars-title">Цена каждого прямого конкурента</h3>
    <div class="viz__legend">
      ${key('viz__line--median', 'Медиана', rub(b.stats.median))}
      ${key('viz__line--mean', 'Средняя', rub(b.stats.mean))}
      ${own ? key('viz__line--own', 'Ваша цена от', rub(own)) : ''}
    </div>
  </figcaption>
  <div class="hbars">
    <ul class="hbars__labels">
${rows.map((r) => `      <li><span>${esc(r.name)}</span>${r.platform ? `<small>${esc(r.platform)}</small>` : ''}</li>`).join('\n')}
    </ul>
    <svg class="hbars__plot" width="100%" height="${h}" role="list" aria-label="Цены прямых конкурентов">
      ${bars}
      ${ref('viz__line--mean', b.stats.mean)}
      ${ref('viz__line--median', b.stats.median)}
      ${own ? ref('viz__line--own', own) : ''}
      <g aria-hidden="true">${values}</g>
    </svg>
  </div>
  <details class="viz__table"><summary>Таблица</summary>
    <div class="table-scroll"><table class="duties">
      <thead><tr><th>Конкурент</th><th class="money">Цена</th><th class="money">К вашей</th></tr></thead>
      <tbody>
${rows.map((r) => `        <tr><td>${esc(r.name)}</td><td class="money">${esc(rub(r.price))}</td><td class="money">${own ? esc(signed(Math.round(((r.price - own) / own) * 100))) : '—'}</td></tr>`).join('\n')}
        <tr><th>Медиана</th><td class="money">${esc(rub(b.stats.median))}</td><td></td></tr>
        <tr><th>Средняя</th><td class="money">${esc(rub(b.stats.mean))}</td><td></td></tr>
      </tbody>
    </table></div>
  </details>
</figure>`;
}

interface LineSeries {
  cls: string;
  label: string;
  values: number[];
}

/**
 * Prices over dates: the median and the average as lines (the range of the night as a faint
 * bar behind them), the owner's price as a level line. The lines live in an inner SVG stretched
 * across the width (their stroke does not scale); dots, labels and hover columns are placed in
 * percent of the width, so text keeps its size on a phone.
 */
function lineChart(opts: {
  id: string;
  title: string;
  caption: string;
  days: string[];
  series: LineSeries[];
  range?: Array<[number, number]>;
  own: number | null;
  dayLabel: (day: string) => string;
}): string {
  const { days, series } = opts;
  const n = days.length;
  const all = [
    ...series.flatMap((s) => s.values),
    ...(opts.range?.flat() ?? []),
    ...(opts.own ? [opts.own] : []),
  ];
  const yt = ticks(Math.min(...all), Math.max(...all));
  const lo = yt[0]!;
  const hi = yt.at(-1)!;
  const PH = 200;
  const y = (v: number) => Math.round((PH - ((v - lo) / (hi - lo)) * PH) * 10) / 10;
  const xp = (i: number) => (n === 1 ? 50 : 3 + (i / (n - 1)) * 94);
  const vx = (i: number) => xp(i) * 10;
  // A label every few nights so they never run into each other.
  const every = Math.max(1, Math.ceil(n / 6));
  const grid = yt
    .map((v) => `<line class="viz__grid" x1="0" x2="100%" y1="${y(v)}" y2="${y(v)}"/>`)
    .join('');
  const yLabels = yt
    .map(
      (v) =>
        `<text class="viz__tick" x="52" y="${y(v) + 4}" text-anchor="end">${esc(tickLabel(v))}</text>`,
    )
    .join('');
  const range = (opts.range ?? [])
    .map(
      ([a, b], i) =>
        `<line class="viz__range" x1="${at(xp(i))}" x2="${at(xp(i))}" y1="${y(b)}" y2="${y(a)}"/>`,
    )
    .join('');
  const lines = series
    .map(
      (s) =>
        `<polyline class="${s.cls}" vector-effect="non-scaling-stroke" points="${s.values.map((v, i) => `${vx(i)},${y(v)}`).join(' ')}"/>`,
    )
    .join('');
  const dots = series
    .map((s) =>
      s.values
        .map((v, i) => `<circle class="viz__dot ${s.cls}" cx="${at(xp(i))}" cy="${y(v)}" r="4"/>`)
        .join(''),
    )
    .join('');
  const ownLine = opts.own
    ? `<line class="viz__line--own" x1="0" x2="100%" y1="${y(opts.own)}" y2="${y(opts.own)}"/>`
    : '';
  const cols = days
    .map((d, i) => {
      const left = n === 1 ? 0 : i === 0 ? 0 : (xp(i - 1) + xp(i)) / 2;
      const right = n === 1 ? 100 : i === n - 1 ? 100 : (xp(i) + xp(i + 1)) / 2;
      const rows: Array<[string, string]> = series.map((s) => [rub(s.values[i]!), s.label]);
      if (opts.range)
        rows.push([`${rub(opts.range[i]![0])} – ${rub(opts.range[i]![1])}`, 'от и до']);
      return `<g class="viz__col" tabindex="0" aria-label="${esc(`${opts.dayLabel(d)}: ${rows.map(([v, l]) => `${l} ${v}`).join(', ')}`)}" data-tip="${tip(opts.dayLabel(d), rows)}">
        <rect class="viz__hit" x="${at(left)}" y="0" width="${at(right - left)}" height="${PH}"/>
        <line class="viz__cross" x1="${at(xp(i))}" x2="${at(xp(i))}" y1="0" y2="${PH}"/>
      </g>`;
    })
    .join('\n');
  const xLabels = days
    .map((d, i) =>
      i % every === 0 || i === n - 1
        ? `<text class="viz__tick" x="${at(xp(i))}" y="${PH + 20}" text-anchor="${n > 1 && i === 0 ? 'start' : n > 1 && i === n - 1 ? 'end' : 'middle'}">${esc(short(d))}</text>`
        : '',
    )
    .join('');
  return `<figure class="viz" aria-labelledby="${opts.id}-title">
  <figcaption class="viz__head">
    <h3 id="${opts.id}-title">${esc(opts.title)}</h3>
    <p class="hint">${esc(opts.caption)}</p>
    <div class="viz__legend">
      ${series.map((s) => key(s.cls, s.label)).join('\n      ')}
      ${opts.range ? `<span class="viz__key"><svg width="18" height="10" aria-hidden="true"><line class="viz__range" x1="9" y1="0" x2="9" y2="10"/></svg>от самой низкой до самой высокой</span>` : ''}
      ${opts.own ? key('viz__line--own', 'Ваша цена от', rub(opts.own)) : ''}
    </div>
  </figcaption>
  <div class="lchart">
    <svg class="lchart__y" width="56" height="${PH + 28}" aria-hidden="true">${yLabels}</svg>
    <svg class="lchart__plot" width="100%" height="${PH + 28}" role="group" aria-label="${esc(opts.title)}">
      ${grid}
      ${range}
      <svg x="0" y="0" width="100%" height="${PH}" viewBox="0 0 1000 ${PH}" preserveAspectRatio="none" aria-hidden="true">${lines}</svg>
      ${ownLine}
      ${dots}
      ${xLabels}
      ${cols}
    </svg>
  </div>
  <details class="viz__table"><summary>Таблица</summary>
    <div class="table-scroll"><table class="duties">
      <thead><tr><th>Дата</th>${series.map((s) => `<th class="money">${esc(s.label)}</th>`).join('')}${opts.range ? '<th class="money">От и до</th>' : ''}</tr></thead>
      <tbody>
${days.map((d, i) => `        <tr><td>${esc(opts.dayLabel(d))}</td>${series.map((s) => `<td class="money">${esc(rub(s.values[i]!))}</td>`).join('')}${opts.range ? `<td class="money">${esc(`${rub(opts.range[i]![0])} – ${rub(opts.range[i]![1])}`)}</td>` : ''}</tr>`).join('\n')}
      </tbody>
    </table></div>
  </details>
</figure>`;
}

/** The headline: the recommended price, the market around it, and «принять». */
function recommendationBlock(b: PriceBoardView): string {
  const st = b.stats;
  const rec = b.recommendation;
  if (!rec || !st)
    return `<p class="notice" role="status">${esc(b.note ? b.note[0]!.toUpperCase() + b.note.slice(1) : 'Рекомендации пока нет')}.</p>
<p><a class="btn btn--ghost btn--sm" href="${cabinetHref('competitors-title')}">К поиску конкурентов</a></p>`;
  const tiles: Array<[string, string, string?]> = [
    ['Медиана', rub(st.median), 'половина конкурентов дешевле, половина дороже'],
    ['Средняя', rub(st.mean)],
    ['Середина рынка', `${rub(st.p25)} – ${rub(st.p75)}`, 'половина цен в этих пределах'],
    ['От и до', `${rub(st.min)} – ${rub(st.max)}`],
    [
      'Ваша цена от',
      rec.own === null ? '—' : rub(rec.own),
      rec.diffPercent === null ? undefined : `${signed(rec.diffPercent)} к медиане`,
    ],
  ];
  const changed = rec.rooms.filter((r) => r.recommended !== r.current);
  return `<div class="price-hero">
  <div>
    <span class="tile__label">Рекомендованная цена «от» — медиана ${st.n} прямых конкурентов</span>
    <p class="price-hero__value">${esc(rub(rec.price))}</p>
  </div>
  <p class="price-hero__text">${esc(rec.text)}</p>
</div>
<div class="tiles">${tiles
    .map(
      ([t, v, h]) =>
        `<div class="tile"><span class="tile__label">${esc(t)}</span><b class="tile__value">${esc(v)}</b>${h ? `<span class="hint">${esc(h)}</span>` : ''}</div>`,
    )
    .join('')}</div>
${
  rec.rooms.length
    ? `<form class="price-accept" data-form="prices-accept">
  <h3>Цены по категориям</h3>
  <p class="hint">Каждая категория меняется на ту же долю, что и самая дешёвая, — разница между ними остаётся вашей. Принятая цена становится базовой в эталоне: коридор агента считается от неё, а правки площадок придут одним согласованием.</p>
  <div class="table-scroll"><table class="duties">
    <thead><tr><th><span class="visually-hidden">Принять</span></th><th>Категория</th><th class="money">Сейчас</th><th class="money">Рекомендация</th><th class="money">Изменение</th></tr></thead>
    <tbody>
${rec.rooms
  .map((r) => {
    const diff = Math.round(((r.recommended - r.current) / r.current) * 100);
    const same = r.recommended === r.current;
    return `      <tr><td>${same ? '' : `<input type="checkbox" name="room" value="${esc(r.id)}" checked aria-label="Принять для «${esc(r.name)}»">`}</td><td>${esc(r.name)}</td><td class="money">${esc(rub(r.current))}</td><td class="money"><b>${esc(rub(r.recommended))}</b></td><td class="money">${same ? 'без изменений' : esc(signed(diff))}</td></tr>`;
  })
  .join('\n')}
    </tbody>
  </table></div>
  ${changed.length ? '<button class="btn btn--accent btn--sm" type="submit">Принять для выбранных</button>' : '<p class="hint">Ваши цены уже как в рекомендации.</p>'}
</form>`
    : ''
}`;
}

function competitorsTable(b: PriceBoardView): string {
  if (!b.competitors.length) return '<p class="hint">Прямых конкурентов пока нет.</p>';
  return `<div class="table-scroll"><table class="duties">
  <thead><tr><th>Объект</th><th>Кто отобрал и почему</th><th class="money">Цена</th><th class="money">Цен прочитано</th></tr></thead>
  <tbody>
${b.competitors
  .map((c) => {
    const url = safeUrl(c.url);
    const facts = [
      c.kind,
      c.distanceKm === null
        ? null
        : c.distanceKm < 1
          ? `${Math.round(c.distanceKm * 1000)} м`
          : `${c.distanceKm.toFixed(1).replace('.', ',')} км`,
      c.rating === null ? null : `рейтинг ${String(c.rating).replace('.', ',')}`,
    ].filter(Boolean);
    return `    <tr><td>${url ? `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(c.name)}</a>` : esc(c.name)}${c.platform ? ` <span class="muted">${esc(c.platform)}</span>` : ''}${facts.length ? `<br><span class="hint">${esc(facts.join(', '))}</span>` : ''}</td><td><span class="by by--${c.by}">${esc(BY_TITLES[c.by])}</span>${c.reason ? ` ${esc(c.reason)}` : ''}</td><td class="money">${c.price === null ? '<span class="muted">ещё нет</span>' : esc(rub(c.price))}</td><td class="money">${c.prices}</td></tr>`;
  })
  .join('\n')}
  </tbody>
</table></div>
<p class="hint">Не согласны с агентом — ответьте «Нет» или «Прямой конкурент» в блоке «Конкуренты» в разделе «<a href="${cabinetHref('competitors-title')}">Объект</a>»: он учтёт ваш ответ в следующих поисках.</p>`;
}

/** Every price with the words of its page: the proof of each number on this page. */
function proofsBlock(b: PriceBoardView): string {
  if (!b.proofs.length) return '<p class="hint">Цен пока нет.</p>';
  const names = [...new Set(b.proofs.map((p) => p.competitor))];
  return `<div class="row proofs__filter">
  <label class="field"><span class="field__label">Конкурент</span><select data-proofs-filter aria-label="Показать цены конкурента">
    <option value="">Все (${b.proofs.length})</option>
${names.map((n) => `    <option value="${esc(n)}">${esc(n)}</option>`).join('\n')}
  </select></label>
</div>
<div class="table-scroll"><table class="duties proofs">
  <thead><tr><th>Конкурент</th><th>Ночь</th><th class="money">Цена</th><th>Цитата со страницы</th><th>Где и когда прочитано</th></tr></thead>
  <tbody>
${b.proofs
  .map((p) => {
    const src = safeUrl(p.source) ?? safeUrl(p.url);
    return `    <tr data-proof="${esc(p.competitor)}"><td>${esc(p.competitor)}</td><td>${p.day ? esc(night(p.day)) : '—'}</td><td class="money"><b>${esc(rub(p.price))}</b></td><td>${p.quote ? `<q>${esc(p.quote)}</q>` : '<span class="muted">цитаты нет</span>'}</td><td>${src ? `<a href="${esc(src)}" target="_blank" rel="noopener">${esc(host(src))}</a>` : '—'}<br><span class="hint">${esc(moment(p.readAt))} · ${p.origin === 'monitor' ? '«Цены конкурентов»' : 'поиск конкурентов'}</span></td></tr>`;
  })
  .join('\n')}
  </tbody>
</table></div>`;
}

export function renderPrices(s: PricesState): string {
  const b = s.board;
  const basis =
    b?.basis === 'monitor'
      ? 'По еженедельному сбору «Цены конкурентов»: у каждого конкурента — медиана его цен на ночи впереди.'
      : b?.basis === 'search'
        ? `По поиску конкурентов: цена «от» за ночь${b.proofs[0]?.day ? ` на ${night(b.proofs[0].day)}` : ''}, 2 гостя. Цены по датам агент соберёт в «Ценах конкурентов».`
        : '';
  const charts = b
    ? [
        competitorBars(b),
        b.byDay.length >= 2
          ? lineChart({
              id: 'nights',
              title: 'Рынок по ночам',
              caption:
                'Цены прямых конкурентов на каждую ночь, что прочитал агент: выходные обычно дороже будней.',
              days: b.byDay.map((d) => d.day),
              series: [
                {
                  cls: 'viz__line--median',
                  label: 'Медиана',
                  values: b.byDay.map((d) => d.median),
                },
                { cls: 'viz__line--mean', label: 'Средняя', values: b.byDay.map((d) => d.mean) },
              ],
              range: b.byDay.map((d) => [d.min, d.max]),
              own: b.own.priceFrom,
              dayLabel: night,
            })
          : '',
        b.history.length >= 2
          ? lineChart({
              id: 'history',
              title: 'Как меняется рынок',
              caption: 'Медиана и средняя всех цен, прочитанных в этот день.',
              days: b.history.map((d) => d.day),
              series: [
                {
                  cls: 'viz__line--median',
                  label: 'Медиана',
                  values: b.history.map((d) => d.median),
                },
                { cls: 'viz__line--mean', label: 'Средняя', values: b.history.map((d) => d.mean) },
              ],
              own: b.own.priceFrom,
              dayLabel: (d) => `прочитано ${short(d)}`,
            })
          : '',
      ]
        .filter(Boolean)
        .join('\n')
    : '';
  return cabinetPage(
    s,
    'prices',
    `  <p class="tab-lead">Цены прямых конкурентов, которых отобрал агент: средняя, медиана и рекомендация для вашего объекта. Каждая цифра — с цитатой со страницы и ссылкой на неё.</p>
${
  b
    ? `  <section class="card" aria-labelledby="rec-title">
    <div class="card__head"><h2 id="rec-title">Рекомендация</h2>${helpLink('prices', 'Как считается?')}</div>
    ${recommendationBlock(b)}
  </section>
${
  charts
    ? `  <section class="card" aria-labelledby="charts-title">
    <div class="card__head"><h2 id="charts-title">Рынок</h2>${b.updatedAt ? `<span class="hint">обновлено ${esc(moment(b.updatedAt))}</span>` : ''}</div>
    <p class="hint">${esc(basis)}</p>
    ${charts}
  </section>
`
    : ''
}  <section class="card" aria-labelledby="rivals-title">
    <div class="card__head"><h2 id="rivals-title">Прямые конкуренты · ${b.competitors.length}</h2>${b.search ? `<span class="hint">в последнем поиске найдено ${b.search.found}, прямых ${b.search.direct}</span>` : ''}</div>
    ${competitorsTable(b)}
  </section>
  <section class="card" aria-labelledby="proofs-title">
    <div class="card__head"><h2 id="proofs-title">Доказательства</h2></div>
    <p class="hint">Каждая цена — как агент прочитал её на странице: дословная цитата, ссылка и время. Откройте ссылку, чтобы проверить.</p>
    ${proofsBlock(b)}
  </section>`
    : ''
}`,
  );
}
