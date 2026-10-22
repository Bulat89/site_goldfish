import { afterEach, describe, expect, it } from 'vitest';
import { BOTS_TOKEN, BOTS_URL, signIn, startApp, type TestApp } from './helpers.js';

let t: TestApp;
afterEach(async () => {
  await t?.app.close();
});

const ids = (html: string) => new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]!));
const links = (html: string, prefix: string) =>
  [...html.matchAll(new RegExp(`href="${prefix}#([^"]+)"`, 'g'))].map((m) => m[1]!);

describe('user guide', () => {
  it('is public: quick start, search and every topic, without the server address', async () => {
    t = await startApp();
    const res = await t.app.inject({ url: '/help' });
    expect(res.statusCode).toBe(200);
    const html = res.body;
    expect(html).toContain('<h1>Как пользоваться Goldfish</h1>');
    expect(html).toContain('data-guide-search');
    for (const topic of [
      'Вход и расширение',
      'Эталон объекта',
      'Агенты и права',
      'Задания агентам',
      'Согласования',
      'Управляющий, Telegram, MAX и WhatsApp',
      'Сообщения гостей',
      'Показатели',
      'Если что-то не так',
    ])
      expect(html).toContain(`>${topic}</h2>`);
    expect(html).toContain('Агент просит разрешение — что выбрать?');
    expect(html).toContain('Ключ подключения');
    expect(html).toContain('Что значит «Изучение»');
    expect(html).not.toContain('agent.test');
    // The landing links to it too.
    expect((await t.app.inject({ url: '/' })).body).toContain('href="/help"');
  });

  it('every link into the guide and from it to the cabinet lands on an existing anchor', async () => {
    // With the bots server: the settings have the QR codes (#bots) the guide speaks of.
    t = await startApp({ BOTS_URL, BOTS_API_TOKEN: BOTS_TOKEN });
    const cookies = await signIn(t);
    const help = (await t.app.inject({ url: '/help', cookies })).body;
    const page = async (path: string) => (await t.app.inject({ url: path, cookies })).body;
    const cabinet = {
      '/cabinet': await page('/cabinet'),
      '/cabinet/agents': await page('/cabinet/agents'),
      '/cabinet/property': await page('/cabinet/property'),
      '/cabinet/prices': await page('/cabinet/prices'),
      '/cabinet/settings': await page('/cabinet/settings'),
    };
    const helpIds = ids(help);

    // The cabinet explains itself through the guide only where the guide says more than the page.
    const intoGuide = Object.values(cabinet).flatMap((x) => links(x, '/help'));
    expect(intoGuide.length).toBeGreaterThan(8);
    for (const id of intoGuide) expect(helpIds, `/help#${id}`).toContain(id);
    for (const id of links(help, '')) expect(helpIds, `#${id}`).toContain(id);

    // Every link from the guide to the cabinet opens the page its anchor is on.
    expect(help).not.toMatch(/href="\/(agents|start)/);
    const toCabinet = [...help.matchAll(/href="(\/cabinet[^"#]*)#([^"]+)"/g)];
    expect(toCabinet.length).toBeGreaterThan(10);
    for (const [, path, id] of toCabinet) {
      const html = cabinet[path as keyof typeof cabinet];
      expect(html, `${path}#${id}`).toBeDefined();
      expect(ids(html!), `${path}#${id}`).toContain(id!);
    }
    // The guide names the places of the cabinet as they are: no tabs that do not exist.
    for (const gone of [
      'вкладка «Команда»',
      'вкладке «Команда»',
      'шаге настройки',
      'странице агентов',
    ])
      expect(help, gone).not.toContain(gone);
  });

  it('the cabinet shows what is left to set up; the guide is one click from every section', async () => {
    t = await startApp();
    const cookies = await signIn(t);
    const html = (await t.app.inject({ url: '/cabinet', cookies })).body;
    expect(html).toMatch(/Первые шаги · осталось \d из 5/);
    expect(html).toContain('href="/cabinet/settings#telegram-title"');
    expect(html).toContain('href="/help"');
    // The guide knows who asks: an owner gets the way back to the cabinet.
    const help = (await t.app.inject({ url: '/help', cookies })).body;
    expect(help).toContain('<a href="/cabinet">Личный кабинет</a> · инструкция');
    expect(help).not.toContain('<a href="/cabinet" aria-current="page"');
    expect(help).toContain('<a href="/help" aria-current="page">Инструкция</a>');
  });
});
