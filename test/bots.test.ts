import qrcode from 'qrcode-generator';
import { describe, expect, it } from 'vitest';
import { qrSvg } from '../src/pages/bots.js';
import { BOTS_TOKEN, BOTS_URL, PUBLIC_URL, signIn, startApp, testConfig } from './helpers.js';

const BOTS = { BOTS_URL, BOTS_API_TOKEN: BOTS_TOKEN };
const OWNER = 'cl_1/yandex:1000001';

describe('QR codes of the bots in the setup', () => {
  it('shows a QR code with a one-time code for each messenger', async () => {
    const t = await startApp(BOTS);
    const cookies = await signIn(t);
    const page = await t.app.inject({ url: '/start?step=3', cookies });
    expect(page.statusCode).toBe(200);
    const html = page.body;
    expect(html).toContain('id="bot-title"');
    expect(html).toContain('Бот для управления');
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
  });

  it('says which chats are linked, and the agents page lets the owner unlink one', async () => {
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
    const setup = (await t.app.inject({ url: '/start?step=3', cookies })).body;
    expect(setup).toContain('привязан: Иван');
    expect(setup).toContain('бот привязан');
    expect(setup).not.toContain('data-act="bot-unlink"');

    const agents = (await t.app.inject({ url: '/agents?tab=settings', cookies })).body;
    expect(agents).toContain('Привязан Telegram');
    expect(agents).toContain('Управляющий и мессенджеры');
    expect(agents).toContain('data-act="bot-unlink" data-channel="telegram" data-chat="501"');
    // The step «link a messenger» is done (it was the last one); the Telegram button of
    // Goldfish is not shown.
    expect(agents).not.toContain('Первые шаги');
    expect(agents).not.toContain('data-act="telegram"');

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
    const agents = (await t.app.inject({ url: '/agents', cookies })).body;
    expect(agents).toContain('Мессенджер не привязан');
    expect(agents).toContain('Первые шаги · осталось 1 из 4');
    expect(agents).toContain(
      'href="/agents?tab=settings#telegram-title">Привяжите Telegram, MAX или WhatsApp для сводки, согласований и задач',
    );
    expect(agents).toContain('/help#bots');
  });

  it('renders the pages without the codes while the bots server is down', async () => {
    const t = await startApp(BOTS);
    const cookies = await signIn(t);
    t.fakes.botsDown = true;
    const setup = await t.app.inject({ url: '/start?step=3', cookies });
    expect(setup.statusCode).toBe(200);
    expect(setup.body).toContain('Сервер ботов сейчас не отвечает');
    expect(setup.body).toContain('Доступ к CRM');
    const agents = await t.app.inject({ url: '/agents', cookies });
    expect(agents.statusCode).toBe(200);
    expect(agents.body).toContain('Сервер ботов сейчас не отвечает');
  });

  it('keeps the Telegram of Goldfish without a bots server', async () => {
    const t = await startApp();
    const cookies = await signIn(t);
    const setup = (await t.app.inject({ url: '/start?step=3', cookies })).body;
    expect(setup).toContain('data-act="telegram"');
    expect(setup).not.toContain('<svg class="qr"');
    const agents = (await t.app.inject({ url: '/agents?tab=settings', cookies })).body;
    expect(agents).toContain('data-act="telegram"');
    expect(t.fakes.botCalls).toEqual([]);
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
