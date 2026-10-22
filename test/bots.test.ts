import qrcode from 'qrcode-generator';
import { describe, expect, it } from 'vitest';
import { qrSvg } from '../src/pages/bots.js';
import { BOTS_TOKEN, BOTS_URL, PUBLIC_URL, signIn, startApp, testConfig } from './helpers.js';

const BOTS = { BOTS_URL, BOTS_API_TOKEN: BOTS_TOKEN };
const OWNER = 'cl_1/yandex:1000001';

describe('QR codes of the bots in the cabinet', () => {
  it('shows a QR code with a one-time code for each messenger, in the settings', async () => {
    const t = await startApp(BOTS);
    const cookies = await signIn(t);
    const page = await t.app.inject({ url: '/cabinet/settings', cookies });
    expect(page.statusCode).toBe(200);
    const html = page.body;
    expect(html).toContain('<h2 id="telegram-title">Мессенджеры</h2>');
    expect(html.match(/<svg class="qr"/g)).toHaveLength(3);
    expect(html).toContain('href="https://t.me/goldfish_bot?start=TGCODE23"');
    expect(html).toContain('href="https://max.ru/goldfish_bot?start=MAXCODE2"');
    expect(html).toContain('Открыть в WhatsApp');
    expect(html).toContain('aria-label="QR-код: бот Goldfish в Telegram"');
    expect(html).toContain('действуют до 21:40');
    expect(html).toContain('href="/help#bots"');
    expect(t.fakes.botCalls).toEqual([`GET ${OWNER}`, `POST ${OWNER}/codes`]);
    // The CSP allows no inline styles: the code is drawn with attributes only.
    expect(html.slice(html.indexOf('<svg class="qr"'))).not.toMatch(/^<svg[^>]*style=/);
    // New codes are asked for by opening the page again (a link to the page, not to a place on it).
    expect(html).toContain('<a href="/cabinet/settings">обновить</a>');
  });

  it('says which chats are linked and lets the owner unlink one; the codes are only made here', async () => {
    const t = await startApp(BOTS);
    const cookies = await signIn(t);
    t.fakes.botLinks.push({
      owner: OWNER,
      channel: 'telegram',
      title: 'Telegram',
      chatId: '501',
      name: 'Иван',
      linkedAt: '2026-10-16T10:00:00.000Z',
    });
    const settings = (await t.app.inject({ url: '/cabinet/settings', cookies })).body;
    expect(settings).toContain('привязан: Иван');
    expect(settings).toContain('data-act="bot-unlink" data-channel="telegram" data-chat="501"');
    // The step «link a messenger» is done; the Telegram button of Goldfish is not shown.
    t.fakes.botCalls.length = 0;
    const today = (await t.app.inject({ url: '/cabinet', cookies })).body;
    expect(today).toContain('Мессенджер привязан');
    expect(today).not.toContain('Привяжите мессенджер');
    expect(settings).not.toContain('data-act="telegram"');
    // «Сегодня», the other sections and the live part only ask which chats are linked.
    await t.app.inject({ url: '/api/agents/today', cookies });
    await t.app.inject({ url: '/cabinet/agents', cookies });
    expect(t.fakes.botCalls).toEqual([`GET ${OWNER}`]);

    const unlink = (headers: Record<string, string>, body: Record<string, string>) =>
      t.app.inject({ method: 'POST', url: '/api/bots/unlink', cookies, headers, payload: body });
    const origin = { origin: PUBLIC_URL };
    expect(
      (await unlink({ origin: 'https://evil.test' }, { channel: 'telegram', chatId: '501' }))
        .statusCode,
    ).toBe(403);
    expect((await unlink(origin, { channel: 'telegram' })).statusCode).toBe(400);
    expect((await unlink(origin, { channel: 'telegram', chatId: '999' })).statusCode).toBe(404);
    const ok = await unlink(origin, { channel: 'telegram', chatId: '501' });
    expect(ok.statusCode).toBe(200);
    expect(t.fakes.botLinks).toEqual([]);
  });

  it('asks to link a messenger in the first steps while no chat is linked', async () => {
    const t = await startApp(BOTS);
    const cookies = await signIn(t);
    const today = (await t.app.inject({ url: '/cabinet', cookies })).body;
    expect(today).toContain('Первые шаги · осталось 4 из 5');
    expect(today).toContain('Привяжите мессенджер');
    expect(today).toContain('Сводки, срочное и согласования придут в Telegram, MAX или WhatsApp');
    expect(today).toMatch(/href="\/cabinet\/settings#telegram-title"[^>]*>Привязать</);
  });

  it('renders the pages without the codes while the bots server is down', async () => {
    const t = await startApp(BOTS);
    const cookies = await signIn(t);
    t.fakes.botsDown = true;
    const settings = await t.app.inject({ url: '/cabinet/settings', cookies });
    expect(settings.statusCode).toBe(200);
    expect(settings.body).toContain('Сервер ботов сейчас не отвечает');
    expect(settings.body).toContain('Кабинет вашей CRM');
    const today = await t.app.inject({ url: '/cabinet', cookies });
    expect(today.statusCode).toBe(200);
    expect(today.body).toContain('Привяжите мессенджер');
  });

  it('keeps the Telegram of Goldfish without a bots server', async () => {
    const t = await startApp();
    const cookies = await signIn(t);
    const settings = (await t.app.inject({ url: '/cabinet/settings', cookies })).body;
    expect(settings).toContain('<h2 id="telegram-title">Telegram</h2>');
    expect(settings).toContain('data-act="telegram"');
    expect(settings).not.toContain('<svg class="qr"');
    expect((await t.app.inject({ url: '/cabinet', cookies })).body).toContain('Привяжите Telegram');
    expect(t.fakes.botCalls).toEqual([]);
    // A server without the Telegram bot either: nothing to link, nothing is asked.
    t.fakes.hotel.telegramBot = false;
    const none = (await t.app.inject({ url: '/cabinet', cookies })).body;
    expect(none).not.toContain('Привяжите Telegram');
    expect(none).toContain('Первые шаги · осталось 3 из 4');
    const unlink = await t.app.inject({
      method: 'POST',
      url: '/api/bots/unlink',
      cookies,
      headers: { origin: PUBLIC_URL },
      payload: { channel: 'telegram', chatId: '1' },
    });
    expect(unlink.statusCode).toBe(404);
  });

  it('needs the token with the address of the bots server', () => {
    expect(() => testConfig({ BOTS_URL })).toThrow(/BOTS_API_TOKEN/);
    expect(testConfig(BOTS).BOTS_URL).toBe(BOTS_URL);
  });
});

describe('a QR code as SVG', () => {
  it('draws exactly the dark modules of the code, with the quiet zone', () => {
    const text = 'https://t.me/goldfish_bot?start=ABCD2345';
    const svg = qrSvg(text, 'код <Telegram>');
    expect(svg).toContain('aria-label="код &#60;Telegram&#62;"');
    const qr = qrcode(0, 'M');
    qr.addData(text, 'Byte');
    qr.make();
    const n = qr.getModuleCount();
    expect(svg).toContain(`viewBox="0 0 ${n + 8} ${n + 8}"`);
    const drawn = new Set<string>();
    for (const [, x, y, run] of svg.matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/g))
      for (let i = 0; i < Number(run); i++) drawn.add(`${Number(x) + i - 4},${Number(y) - 4}`);
    const dark = new Set<string>();
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) if (qr.isDark(y, x)) dark.add(`${x},${y}`);
    expect(drawn).toEqual(dark);
  });
});
