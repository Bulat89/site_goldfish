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

  it('every link into the guide and from it to the agents page lands on an existing anchor', async () => {
    // With the bots server: the cabinet has its QR codes (#bots) the guide links to.
    t = await startApp({ BOTS_URL, BOTS_API_TOKEN: BOTS_TOKEN });
    const cookies = await signIn(t);
    const help = (await t.app.inject({ url: '/help', cookies })).body;
    const agents = (await t.app.inject({ url: '/agents', cookies })).body;
    const steps = await Promise.all(
      [1, 2, 3, 4].map(
        async (n) => (await t.app.inject({ url: `/start?step=${n}`, cookies })).body,
      ),
    );
    const helpIds = ids(help);

    const intoGuide = [...links(agents, '/help'), ...steps.flatMap((x) => links(x, '/help'))];
    expect(intoGuide.length).toBeGreaterThan(8);
    for (const id of intoGuide) expect(helpIds, `/help#${id}`).toContain(id);
    for (const id of links(help, '')) expect(helpIds, `#${id}`).toContain(id);

    // Every link to the agents page opens the tab its anchor is on, also without a script.
    expect(links(help, '/agents')).toEqual([]);
    const toAgents = [...help.matchAll(/href="\/agents\?tab=(\w+)#([^"]+)"/g)];
    expect(toAgents.length).toBeGreaterThan(10);
    for (const [, tab, id] of toAgents) {
      const panel = new RegExp(`data-panel="${tab}"[^>]*>((?:(?!data-panel=)[\\s\\S])*)`).exec(
        agents,
      )?.[1];
      expect(panel, `/agents?tab=${tab}`).toBeDefined();
      expect(ids(panel!), `/agents?tab=${tab}#${id}`).toContain(id!);
    }
    // Links to a step of the setup land on an anchor of that step.
    expect(links(help, '/')).toEqual([]);
    const toSteps = [...help.matchAll(/href="\/start\?step=(\d)#([^"]+)"/g)];
    expect(toSteps.length).toBeGreaterThan(2);
    for (const [, n, id] of toSteps)
      expect(ids(steps[Number(n) - 1]!), `step ${n}#${id}`).toContain(id);
  });

  it('the agents page shows what is left to set up, with links to the guide', async () => {
    t = await startApp();
    const cookies = await signIn(t);
    const html = (await t.app.inject({ url: '/agents', cookies })).body;
    expect(html).toMatch(/Первые шаги · осталось \d из 4/);
    expect(html).toContain('href="/agents?tab=settings#telegram-title">Привяжите Telegram');
  });
});
