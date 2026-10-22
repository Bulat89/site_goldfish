import cookie from '@fastify/cookie';
import Fastify, {
  type FastifyBaseLogger,
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from 'fastify';
import { accessOf, goldfishUserId } from './access.js';
import { isSecure } from './config.js';
import { connectionKey, openExtension } from './extension.js';
import { GoldfishError } from './goldfish/admin.js';
import { renderHelp } from './pages/help.js';
import {
  deskFromParts,
  renderProperty,
  renderTeam,
  renderToday,
  todayPanel,
  type ApprovalView,
  type CompetitorSearchView,
  type DeskView,
  type ExtensionState,
  type FeedItem,
  type HotelView,
  type KpiView,
  type ListingSearchView,
  type ProfileImportView,
  type StudyView,
  START_AUTONOMY,
} from './pages/agents.js';
import type { BotsState } from './pages/bots.js';
import { tabCount, type CabinetState } from './pages/cabinet.js';
import {
  TAB_PATH,
  renderNotFound,
  renderPage,
  type CabinetTab,
  type Notice,
} from './pages/page.js';
import { renderPrices, type PriceBoardView } from './pages/prices.js';
import { renderSettings } from './pages/settings.js';
import type { Services } from './services.js';
import { registerStatic } from './static.js';
import type { UserRecord } from './store/types.js';

const NOTICES: Record<string, Notice> = {
  denied: 'login_denied',
  expired: 'login_expired',
  error: 'login_error',
};

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' https://avatars.yandex.net data:",
  "connect-src 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "object-src 'none'",
].join('; ');

/**
 * A restart of the Goldfish server: its proxy answers 502–504 for some 20 s on a deploy, longer
 * than the retries of a read. The pages say so and ask again; it is not an error for the journal.
 */
const restarting = (err: unknown): err is GoldfishError =>
  err instanceof GoldfishError && !!err.status && err.status >= 502 && err.status <= 504;
/** A page that met the restart reloads itself after this many seconds (the Refresh header). */
const RELOAD_SECONDS = 15;
const RESTARTING_NOTICE = `Сервер агентов перезапускается — страница обновится сама через ${RELOAD_SECONDS} с.`;

export async function buildApp(s: Services): Promise<FastifyInstance> {
  const { config, sessions, store } = s;
  const app = Fastify({ loggerInstance: s.log as FastifyBaseLogger, trustProxy: true });
  await app.register(cookie);
  // The logout form posts urlencoded; nothing in its body is used.
  app.addContentTypeParser(
    'application/x-www-form-urlencoded',
    { parseAs: 'string' },
    (_req, _body, done) => done(null, {}),
  );

  const origin = new URL(config.PUBLIC_URL).origin;
  const secure = isSecure(config);
  /** State-changing requests must come from this site's own pages. */
  const sameOrigin = (req: FastifyRequest) => req.headers.origin === origin;

  app.addHook('onSend', async (_req, reply) => {
    reply.header('x-content-type-options', 'nosniff');
    reply.header('referrer-policy', 'same-origin');
    reply.header('x-frame-options', 'DENY');
    reply.header('content-security-policy', CSP);
    if (secure) reply.header('strict-transport-security', 'max-age=31536000');
  });

  const assets = registerStatic(app);
  const view = {
    assets,
    goldfishUrl: config.GOLDFISH_URL,
    privacyUrl: config.PRIVACY_URL,
    supportEmail: config.SUPPORT_EMAIL,
  };

  app.get('/healthz', async () => ({ ok: true }));
  app.get('/readyz', async (_req, reply) => {
    try {
      await store.ping();
      return { ok: true };
    } catch {
      return reply.code(503).send({ ok: false });
    }
  });

  /**
   * The owner's bots in the messengers for a page: fresh one-time codes for the QR codes and the
   * chats already linked. Undefined without a bots server; a silent one is «unavailable» and the
   * page renders without the codes.
   */
  const botsOf = async (
    user: UserRecord,
    req: FastifyRequest,
    codes = true,
  ): Promise<BotsState | undefined> => {
    if (!s.bots) return undefined;
    try {
      const owner = { clientId: await s.goldfish.clientId(), userId: goldfishUserId(user) };
      return await s.bots.view(owner, codes);
    } catch (err) {
      req.log.warn({ err }, 'bots server unavailable: the page goes without QR codes');
      return 'unavailable';
    }
  };

  // A guest gets the landing; the owner — the personal cabinet.
  app.get('/', async (req, reply) => {
    const user = await sessions.user(req);
    const q = req.query as { login?: string };
    const notice: Notice | null = (q.login && NOTICES[q.login]) || null;
    const access = user ? accessOf(user) : null;
    if (user && access?.allowed)
      return reply.header('cache-control', 'no-store').redirect(TAB_PATH.today);
    return reply
      .type('text/html; charset=utf-8')
      .header('cache-control', 'private, no-store')
      .send(renderPage({ ...view, user, access, notice }));
  });

  // The guide is public: it also answers «how does it work» before signing in.
  app.get('/help', async (req, reply) => {
    const user = await sessions.user(req);
    return reply
      .type('text/html; charset=utf-8')
      .header('cache-control', 'private, no-cache')
      .send(renderHelp({ ...view, user }));
  });

  // ---------------------------------------------------------------- Yandex ID

  app.get('/auth/yandex', async (req, reply) => {
    if (await sessions.user(req)) return reply.redirect('/');
    const { state, verifier } = sessions.beginOAuth(reply);
    return reply
      .header('cache-control', 'no-store')
      .redirect(s.yandex.authorizeUrl(state, verifier));
  });

  app.get('/auth/yandex/callback', async (req, reply) => {
    const q = req.query as { code?: string; state?: string; error?: string };
    const verifier = sessions.finishOAuth(req, reply, q.state);
    if (q.error) {
      req.log.info({ error: q.error }, 'yandex sign-in declined');
      return reply.redirect('/?login=denied');
    }
    if (!verifier || !q.code) return reply.redirect('/?login=expired');
    try {
      const accessToken = await s.yandex.exchange(q.code, verifier);
      const profile = await s.yandex.profile(accessToken);
      const user = await store.upsertYandexUser(profile);
      await sessions.start(reply, user.id);
      req.log.info({ userId: user.id }, 'signed in');
      return reply.redirect('/');
    } catch (err) {
      req.log.error({ err }, 'yandex sign-in failed');
      return reply.redirect('/?login=error');
    }
  });

  app.post('/logout', async (req, reply) => {
    if (!sameOrigin(req)) return reply.code(403).send({ error: 'forbidden' });
    await sessions.end(req, reply);
    return reply.redirect('/', 303);
  });

  // ---------------------------------------------------------------- access

  app.get('/download', async (req, reply) => {
    const user = await sessions.user(req);
    if (!user) return reply.redirect('/auth/yandex');
    if (!accessOf(user).allowed) return reply.redirect('/');
    try {
      const pkg = await openExtension(config, s.goldfish);
      if (pkg) {
        void store
          .markDownload(user.id)
          .catch((err: unknown) => req.log.warn({ err }, 'download not recorded'));
        if (pkg.length !== null) reply.header('content-length', pkg.length);
        return reply
          .type('application/zip')
          .header('content-disposition', `attachment; filename="${pkg.filename}"`)
          .send(pkg.body);
      }
      req.log.warn('extension package is not available');
    } catch (err) {
      req.log.error({ err }, 'extension download failed');
    }
    return reply.redirect(`${TAB_PATH.settings}?download=unavailable#extension-title`);
  });

  app.post('/api/token', async (req, reply) => {
    reply.header('cache-control', 'no-store');
    if (!sameOrigin(req)) return reply.code(403).send({ error: 'forbidden' });
    const user = await sessions.user(req);
    if (!user) return reply.code(401).send({ error: 'unauthorized', message: 'Войдите заново' });
    const access = accessOf(user);
    if (!access.allowed)
      return reply.code(403).send({ error: 'no_access', message: access.reason });
    try {
      const { token, user: updated } = await s.access.issueToken(user.id);
      req.log.info({ userId: user.id }, 'device token issued');
      // The server's address goes inside the key: the owner never types or sees it.
      return { key: connectionKey(config.GOLDFISH_URL, token), issuedAt: updated.tokenIssuedAt };
    } catch (err) {
      req.log.error({ err }, 'device token not issued');
      return reply.code(502).send({
        error: 'goldfish_unavailable',
        message: 'Сервер агента сейчас недоступен — попробуйте через минуту',
      });
    }
  });

  // ---------------------------------------------------------------- hotel agents

  /**
   * «Пульт управляющего» — the same state the extension and the bots show. An older Goldfish
   * without it (404) gives the parts separately, and the page makes the desk of them.
   */
  const loadDesk = async (
    gf: string,
    hotel: HotelView,
    desk: { status: number; body: DeskView },
  ): Promise<DeskView> => {
    if (desk.status === 200) return desk.body;
    const [approvals, kpi, feed] = await Promise.all([
      s.goldfish.hotel<ApprovalView[]>(gf, 'GET', '/approvals?status=pending'),
      s.goldfish.hotel<KpiView>(gf, 'GET', '/kpi'),
      s.goldfish.hotel<FeedItem[]>(gf, 'GET', '/feed?limit=20'),
    ]);
    return deskFromParts(
      hotel,
      approvals.status === 200 ? approvals.body : [],
      kpi.status === 200 ? kpi.body : null,
      feed.status === 200 ? feed.body : [],
    );
  };

  const EMPTY_DESK: DeskView = {
    rev: '',
    status: { agentsOn: 0, agentsTotal: 0, wave: 1, pending: 0, urgent: 0 },
    approvals: [],
    decided: [],
    feed: [],
    kpi: null,
  };

  // ---------------------------------------------------------------- the personal cabinet
  // One section — one page; each asks Goldfish only for what it shows. Everything an owner does
  // lives here: the first steps and the decisions, the agents, the property, the prices, the
  // settings.

  /** The signed-in owner of a cabinet page; for anyone else the redirect is sent and null returned. */
  const cabinetOwner = async (
    req: FastifyRequest,
    reply: FastifyReply,
  ): Promise<UserRecord | null> => {
    const user = await sessions.user(req);
    if (!user) {
      void reply.redirect('/auth/yandex');
      return null;
    }
    if (!accessOf(user).allowed) {
      void reply.redirect('/');
      return null;
    }
    return user;
  };

  /** What a page says when Goldfish did not answer; the restart also reloads the page by itself. */
  const unreachable = (
    req: FastifyRequest,
    reply: FastifyReply,
    err: unknown,
    page: string,
  ): string => {
    // 2026-10-14 16:38: the deploy of Goldfish gave the page «unavailable» and the journal an error.
    if (restarting(err)) {
      req.log.info({ status: err.status }, `${page} page: goldfish restarting, the page reloads`);
      reply.header('refresh', String(RELOAD_SECONDS));
      return RESTARTING_NOTICE;
    }
    req.log.error({ err }, `${page} page: goldfish unavailable`);
    return 'Сервер агентов сейчас недоступен — попробуйте через минуту.';
  };

  const hotelOf = async (gf: string): Promise<HotelView> => {
    const hotel = await s.goldfish.hotel<HotelView>(gf, 'GET', '');
    if (hotel.status !== 200) throw new Error(`hotel: ${hotel.status}`);
    return hotel.body;
  };

  /**
   * How many decisions wait, for the count on «Сегодня» in every section. Only a count: when the
   * desk is silent the tab goes without it.
   */
  const waitingOf = async (gf: string): Promise<CabinetState['waiting']> => {
    try {
      const desk = await s.goldfish.hotel<DeskView>(gf, 'GET', '/manager');
      if (desk.status === 200) return desk.body.status;
      const list = await s.goldfish.hotel<ApprovalView[]>(gf, 'GET', '/approvals?status=pending');
      return list.status === 200
        ? { pending: list.body.length, urgent: list.body.filter((a) => a.urgent).length }
        : null;
    } catch {
      return null;
    }
  };

  const send = (reply: FastifyReply, html: string) =>
    reply.type('text/html; charset=utf-8').header('cache-control', 'private, no-store').send(html);

  // «Сегодня»: the first steps, the study, then what waits for the owner.
  app.get(TAB_PATH.today, async (req, reply) => {
    const user = await cabinetOwner(req, reply);
    if (!user) return reply;
    const gf = goldfishUserId(user);
    let state: Parameters<typeof renderToday>[0] = {
      ...view,
      user,
      hotel: null,
      desk: EMPTY_DESK,
      study: null,
      extension: null,
      error: null,
    };
    // Without link codes: «Сегодня» only needs to know whether a chat is linked.
    const bots = botsOf(user, req, false);
    try {
      const [hotel, desk, study, extension] = await Promise.all([
        hotelOf(gf),
        s.goldfish.hotel<DeskView>(gf, 'GET', '/manager'),
        s.goldfish.hotel<StudyView>(gf, 'GET', '/study'),
        s.goldfish.extensionState(gf).catch((): ExtensionState | null => null),
      ]);
      const full = await loadDesk(gf, hotel, desk);
      state = {
        ...state,
        hotel,
        desk: full,
        waiting: full.status,
        // An older Goldfish without «Изучение» answers 404: the page goes without the card.
        study: study.status === 200 ? study.body : null,
        extension,
      };
    } catch (err) {
      state.error = unreachable(req, reply, err, 'today');
    }
    state.bots = await bots;
    return send(reply, renderToday(state));
  });

  // «Агенты»: the mode of work, the agents and their rights, the platforms.
  app.get(TAB_PATH.agents, async (req, reply) => {
    const user = await cabinetOwner(req, reply);
    if (!user) return reply;
    const gf = goldfishUserId(user);
    const state: CabinetState = { ...view, user, hotel: null, error: null };
    try {
      [state.hotel, state.waiting] = await Promise.all([hotelOf(gf), waitingOf(gf)]);
    } catch (err) {
      state.error = unreachable(req, reply, err, 'agents');
    }
    return send(reply, renderTeam(state));
  });

  // «Объект»: the reference, where the property is listed, the competitors.
  app.get(TAB_PATH.property, async (req, reply) => {
    const user = await cabinetOwner(req, reply);
    if (!user) return reply;
    const gf = goldfishUserId(user);
    let state: Parameters<typeof renderProperty>[0] = {
      ...view,
      user,
      hotel: null,
      profileImport: null,
      listings: null,
      competitorSearch: null,
      error: null,
    };
    try {
      const [hotel, profileImport, listings, competitorSearch, waiting] = await Promise.all([
        hotelOf(gf),
        s.goldfish.hotel<ProfileImportView | null>(gf, 'GET', '/profile/import'),
        s.goldfish.hotel<ListingSearchView | null>(gf, 'GET', '/listings'),
        s.goldfish.hotel<CompetitorSearchView | null>(gf, 'GET', '/competitors'),
        waitingOf(gf),
      ]);
      state = {
        ...state,
        hotel,
        waiting,
        profileImport: profileImport.status === 200 ? profileImport.body : null,
        // An older Goldfish without the searches answers 404: the blocks offer to start them.
        listings: listings.status === 200 ? listings.body : null,
        competitorSearch: competitorSearch.status === 200 ? competitorSearch.body : null,
      };
    } catch (err) {
      state.error = unreachable(req, reply, err, 'property');
    }
    return send(reply, renderProperty(state));
  });

  // «Цены»: the direct competitors' prices with proofs and the recommendation.
  app.get(TAB_PATH.prices, async (req, reply) => {
    const user = await cabinetOwner(req, reply);
    if (!user) return reply;
    const gf = goldfishUserId(user);
    const state: Parameters<typeof renderPrices>[0] = {
      ...view,
      user,
      hotel: null,
      board: null,
      error: null,
    };
    try {
      const [hotel, board, waiting] = await Promise.all([
        s.goldfish.hotel<HotelView>(gf, 'GET', ''),
        s.goldfish.hotel<PriceBoardView>(gf, 'GET', '/prices'),
        waitingOf(gf),
      ]);
      state.hotel = hotel.status === 200 ? hotel.body : null;
      state.waiting = waiting;
      // An older Goldfish has no «Цены» yet: say so rather than «unavailable».
      if (board.status === 404)
        state.error = 'Сервер агентов ещё не умеет считать цены конкурентов — его нужно обновить.';
      else if (board.status !== 200) throw new Error(`prices: ${board.status}`);
      else state.board = board.body;
    } catch (err) {
      state.error = unreachable(req, reply, err, 'prices');
    }
    return send(reply, renderPrices(state));
  });

  // «Настройки»: the extension and its key, the CRM, the messengers, the manager, the account.
  app.get(TAB_PATH.settings, async (req, reply) => {
    const user = await cabinetOwner(req, reply);
    if (!user) return reply;
    const gf = goldfishUserId(user);
    const q = req.query as { download?: string };
    const state: Parameters<typeof renderSettings>[0] = {
      ...view,
      user,
      hotel: null,
      extension: null,
      downloadFailed: q.download === 'unavailable',
      error: null,
    };
    // The one-time codes for the QR codes are made here and nowhere else.
    const bots = botsOf(user, req);
    // The extension and the account need no property: the page shows them while Goldfish is down.
    const [hotel, extension, waiting] = await Promise.all([
      hotelOf(gf).catch((err: unknown) => {
        state.error = unreachable(req, reply, err, 'settings');
        return null;
      }),
      s.goldfish.extensionState(gf).catch((): ExtensionState | null => null),
      waitingOf(gf),
    ]);
    state.hotel = hotel;
    state.extension = extension;
    state.waiting = waiting;
    state.bots = await bots;
    return send(reply, renderSettings(state));
  });

  // The addresses of the earlier site: its wizard and its agents page are the cabinet now.
  const AT_STEP: Record<string, string> = {
    '1': `${TAB_PATH.settings}#extension-title`,
    '2': `${TAB_PATH.property}#listings-title`,
    '3': `${TAB_PATH.settings}#crm-title`,
    '4': TAB_PATH.today,
  };
  const AT_TAB: Record<string, CabinetTab> = {
    today: 'today',
    team: 'agents',
    property: 'property',
    settings: 'settings',
  };
  app.get('/start', async (req, reply) =>
    reply.redirect(AT_STEP[(req.query as { step?: string }).step ?? ''] ?? TAB_PATH.today),
  );
  app.get('/agents', async (req, reply) =>
    reply.redirect(TAB_PATH[AT_TAB[(req.query as { tab?: string }).tab ?? ''] ?? 'today']),
  );
  app.get('/agents/prices', async (_req, reply) => reply.redirect(TAB_PATH.prices));

  /**
   * Changes from the cabinet, proxied to Goldfish on the owner's behalf. Only from this site's
   * pages, only for a signed-in user with access; the server's refusals come back as they are.
   */
  const proxy =
    (
      method: 'POST' | 'PUT',
      path: (req: FastifyRequest) => string,
      body: (b: Record<string, unknown>) => unknown = (b) => b,
    ) =>
    async (req: FastifyRequest, reply: import('fastify').FastifyReply) => {
      reply.header('cache-control', 'no-store');
      if (!sameOrigin(req)) return reply.code(403).send({ error: 'forbidden' });
      const user = await sessions.user(req);
      if (!user) return reply.code(401).send({ error: 'unauthorized', message: 'Войдите заново' });
      const access = accessOf(user);
      if (!access.allowed)
        return reply.code(403).send({ error: 'no_access', message: access.reason });
      try {
        const res = await s.goldfish.hotel(
          goldfishUserId(user),
          method,
          path(req),
          body((req.body ?? {}) as Record<string, unknown>),
        );
        return reply.code(res.status).send(res.body);
      } catch (err) {
        req.log.error({ err }, 'agents change: goldfish unavailable');
        return reply.code(502).send({
          error: 'goldfish_unavailable',
          message: 'Сервер агентов сейчас недоступен — попробуйте через минуту',
        });
      }
    };
  const id = (req: FastifyRequest) => encodeURIComponent((req.params as { id: string }).id);
  app.post(
    '/api/agents/settings',
    proxy('POST', () => '/settings'),
  );
  // The decision is marked as taken on the site: the extension and the bots say where.
  app.post(
    '/api/agents/approvals/:id',
    proxy(
      'POST',
      (req) => `/approvals/${id(req)}`,
      (b) => ({ ...b, via: 'site' }),
    ),
  );
  app.post(
    '/api/agents/telegram',
    proxy('POST', () => '/telegram/link'),
  );
  // «Изучение»: {on: true} — study the cabinets again, {on: false} — end it, the agents work.
  app.post(
    '/api/agents/study',
    proxy('POST', () => '/study'),
  );

  // «Сегодня» asks for itself again while it is open: a decision taken in a messenger or in the
  // extension, a new approval or message shows without a reload. A read: the session is enough.
  app.get('/api/agents/today', async (req, reply) => {
    reply.header('cache-control', 'no-store');
    const user = await sessions.user(req);
    if (!user) return reply.code(401).send({ error: 'unauthorized', message: 'Войдите заново' });
    if (!accessOf(user).allowed) return reply.code(403).send({ error: 'no_access' });
    const gf = goldfishUserId(user);
    try {
      const [hotel, desk] = await Promise.all([
        hotelOf(gf),
        s.goldfish.hotel<DeskView>(gf, 'GET', '/manager'),
      ]);
      const full = await loadDesk(gf, hotel, desk);
      return {
        rev: full.rev,
        pending: full.status.pending,
        urgent: full.status.urgent,
        today: todayPanel({ user, hotel, desk: full }),
        count: tabCount(full.status),
      };
    } catch (err) {
      // The page asks again in a while: a restart of Goldfish is a missed tick.
      if (restarting(err))
        req.log.info({ status: err.status }, 'agents today: goldfish restarting');
      else req.log.warn({ err }, 'agents today: goldfish unavailable');
      return reply.code(502).send({ error: 'goldfish_unavailable' });
    }
  });

  app.post(
    '/api/agents/hook-token',
    proxy('POST', () => '/hook-token'),
  );
  app.post(
    '/api/agents/duties/:id/run',
    proxy('POST', (req) => `/duties/${id(req)}/run`),
  );
  app.post(
    '/api/agents/profile/import',
    proxy('POST', () => '/profile/import'),
  );
  app.post(
    '/api/agents/profile/import/:id/apply',
    proxy('POST', (req) => `/profile/import/${id(req)}/apply`),
  );
  app.post(
    '/api/agents/profile/import/:id/discard',
    proxy('POST', (req) => `/profile/import/${id(req)}/discard`),
  );
  // Polled by the page while the agent reads a card. A read: same-origin fetch sends no Origin
  // for GET, so only the session is checked.
  app.get('/api/agents/profile/import/:id', async (req, reply) => {
    reply.header('cache-control', 'no-store');
    const user = await sessions.user(req);
    if (!user) return reply.code(401).send({ error: 'unauthorized', message: 'Войдите заново' });
    if (!accessOf(user).allowed) return reply.code(403).send({ error: 'no_access' });
    try {
      const res = await s.goldfish.hotel(goldfishUserId(user), 'GET', `/profile/import/${id(req)}`);
      return reply.code(res.status).send(res.body);
    } catch (err) {
      // The page asks again in 5 s: a restart of the Goldfish server that outlasts the retries
      // of a read (502 for some 20 s at 11:59) is a missed tick, not an error for the journal.
      if (restarting(err))
        req.log.info(
          { status: err.status },
          'agents import: goldfish restarting, the page asks again',
        );
      else req.log.error({ err }, 'agents import: goldfish unavailable');
      return reply.code(502).send({ error: 'goldfish_unavailable' });
    }
  });
  app.put(
    '/api/agents/profile',
    proxy('PUT', () => '/profile'),
  );
  // After the reference: listings on the platforms and competitors nearby.
  const platform = (req: FastifyRequest) =>
    encodeURIComponent((req.params as { platform: string }).platform);
  app.post(
    '/api/agents/listings',
    proxy('POST', () => '/listings'),
  );
  app.post(
    '/api/agents/listings/sync',
    proxy('POST', () => '/listings/sync'),
  );
  app.post(
    '/api/agents/listings/:id/:platform',
    proxy('POST', (req) => `/listings/${id(req)}/${platform(req)}`),
  );
  app.post(
    '/api/agents/listings/:id/:platform/publish',
    proxy('POST', (req) => `/listings/${id(req)}/${platform(req)}/publish`),
  );
  app.post(
    '/api/agents/competitors',
    proxy('POST', () => '/competitors'),
  );
  app.post(
    '/api/agents/competitors/candidates/:id',
    proxy('POST', (req) => `/competitors/candidates/${id(req)}`),
  );
  app.post(
    '/api/agents/prices/accept',
    proxy('POST', () => '/prices/accept'),
  );
  // Polled by the page while a search or the study runs (a read: the session is enough).
  for (const what of ['listings', 'competitors', 'study'] as const)
    app.get(`/api/agents/${what}`, async (req, reply) => {
      reply.header('cache-control', 'no-store');
      const user = await sessions.user(req);
      if (!user) return reply.code(401).send({ error: 'unauthorized', message: 'Войдите заново' });
      if (!accessOf(user).allowed) return reply.code(403).send({ error: 'no_access' });
      try {
        const res = await s.goldfish.hotel(goldfishUserId(user), 'GET', `/${what}`);
        return reply.code(res.status).send(res.body);
      } catch (err) {
        // Asked again in 5 s, like the card import: a Goldfish restart is a missed tick.
        if (restarting(err))
          req.log.info(
            { status: err.status },
            'agents search: goldfish restarting, the page asks again',
          );
        else req.log.error({ err }, 'agents search: goldfish unavailable');
        return reply.code(502).send({ error: 'goldfish_unavailable' });
      }
    });

  // ---------------------------------------------------------------- setting up
  // «Первые шаги» and «Настройки» save through these: same origin, session cookie; the site
  // forwards to Goldfish on the owner's behalf and says what did not go through.

  /** The site's own page, a signed-in user with access: the user, or null with the answer sent. */
  const owner = async (
    req: FastifyRequest,
    reply: FastifyReply,
    change = true,
  ): Promise<UserRecord | null> => {
    reply.header('cache-control', 'no-store');
    if (change && !sameOrigin(req)) {
      void reply.code(403).send({ error: 'forbidden' });
      return null;
    }
    const user = await sessions.user(req);
    if (!user) {
      void reply.code(401).send({ error: 'unauthorized', message: 'Войдите заново' });
      return null;
    }
    const access = accessOf(user);
    if (!access.allowed) {
      void reply.code(403).send({ error: 'no_access', message: access.reason });
      return null;
    }
    return user;
  };
  const refusal = (body: unknown, fallback: string) =>
    (body as { message?: unknown } | null)?.message
      ? String((body as { message: unknown }).message)
      : fallback;
  const unavailable = (reply: FastifyReply, req: FastifyRequest, err: unknown) => {
    req.log.error({ err }, 'setup: goldfish unavailable');
    return reply.code(502).send({
      error: 'goldfish_unavailable',
      message: 'Сервер агентов сейчас недоступен — попробуйте через минуту',
    });
  };

  // «Расширение» asks while it waits for the extension (a read: the session is enough).
  app.get('/api/extension', async (req, reply) => {
    const user = await owner(req, reply, false);
    if (!user) return reply;
    try {
      const st = await s.goldfish.extensionState(goldfishUserId(user));
      return {
        connected: !!st?.lastSeenAt,
        online: !!st?.online,
        lastSeenAt: st?.lastSeenAt ?? null,
      };
    } catch (err) {
      if (!restarting(err)) req.log.warn({ err }, 'setup: extension state unknown');
      return reply.code(502).send({ error: 'goldfish_unavailable' });
    }
  });

  /**
   * «Объявления на площадках»: a field per platform. Each new address is registered on its platform
   * (the server checks it is that platform's), a cleared one leaves the reference. What went
   * through stays; what did not is said.
   */
  app.post('/api/agents/listings/links', async (req, reply) => {
    const user = await owner(req, reply);
    if (!user) return reply;
    const body = (req.body ?? {}) as { listings?: unknown };
    const listings = Array.isArray(body.listings) ? body.listings : null;
    if (
      !listings ||
      listings.length > 30 ||
      !listings.every(
        (l): l is { platform: string; url: string } =>
          !!l &&
          typeof (l as { platform?: unknown }).platform === 'string' &&
          typeof (l as { url?: unknown }).url === 'string' &&
          (l as { platform: string }).platform.length <= 40 &&
          (l as { url: string }).url.length <= 1000,
      )
    )
      return reply.code(400).send({ error: 'bad_request', message: 'какие объявления сохранить?' });
    const gf = goldfishUserId(user);
    try {
      const hotel = await hotelOf(gf);
      const title = new Map(hotel.settings.platforms.map((p) => [p.id, p.title]));
      const systems = (hotel.profile.systems ?? []) as Array<
        Record<string, unknown> & { id: string }
      >;
      const known = new Map(systems.map((x) => [x.id, String(x.listingUrl ?? '')]));
      const errors: string[] = [];
      for (const l of listings) {
        const url = l.url.trim();
        if (!url || url === known.get(l.platform)) continue;
        const r = await s.goldfish.hotel(gf, 'POST', '/listings/manual', {
          platform: l.platform,
          url,
        });
        if (r.status !== 200)
          errors.push(
            `${title.get(l.platform) ?? l.platform}: ${refusal(r.body, 'не сохранилось')}`,
          );
      }
      // A cleared field: the listing leaves the reference (a system with nothing else goes too).
      const cleared = new Set(
        listings.filter((l) => !l.url.trim() && known.get(l.platform)).map((l) => l.platform),
      );
      if (cleared.size) {
        const profile = (await hotelOf(gf)).profile;
        const next = ((profile.systems ?? []) as Array<Record<string, unknown> & { id: string }>)
          .map((x) => {
            if (!cleared.has(x.id)) return x;
            const { listingUrl: _gone, ...rest } = x;
            return Object.keys(rest).length > 1 ? rest : null;
          })
          .filter((x) => x !== null);
        const r = await s.goldfish.hotel(gf, 'PUT', '/profile', { ...profile, systems: next });
        if (r.status !== 200) errors.push(refusal(r.body, 'не удалось убрать объявление'));
      }
      if (errors.length)
        return reply.code(400).send({ error: 'bad_request', message: errors.join('; ') });
      req.log.info({ userId: user.id }, 'setup: listings saved');
      return { ok: true };
    } catch (err) {
      return unavailable(reply, req, err);
    }
  });

  /**
   * «Кабинет вашей CRM» (a PMS or a chessboard table) — one: another chosen before leaves the
   * reference. «none» — no CRM, the bookings are kept by hand.
   */
  app.post('/api/agents/crm', async (req, reply) => {
    const user = await owner(req, reply);
    if (!user) return reply;
    const body = (req.body ?? {}) as { system?: unknown; url?: unknown };
    const system = typeof body.system === 'string' ? body.system : '';
    const url = typeof body.url === 'string' ? body.url.trim() : '';
    if (!system || system.length > 40)
      return reply.code(400).send({ error: 'bad_request', message: 'Выберите вашу CRM' });
    if (system !== 'none' && (!/^https?:\/\/\S+$/i.test(url) || url.length > 1000))
      return reply.code(400).send({
        error: 'bad_request',
        message: 'Вставьте ссылку на личный кабинет целиком, с https://',
      });
    const gf = goldfishUserId(user);
    try {
      const hotel = await hotelOf(gf);
      const category = new Map(hotel.settings.platforms.map((p) => [p.id, p.category]));
      const crm = (id: string) => ['pms', 'sheet'].includes(category.get(id) ?? '');
      if (system !== 'none' && !crm(system))
        return reply.code(400).send({ error: 'bad_request', message: 'Такой CRM нет в списке' });
      const profile = hotel.profile;
      const systems = (profile.systems ?? []) as Array<Record<string, unknown> & { id: string }>;
      const was = systems.find((x) => x.id === system);
      const next = [
        ...systems.filter((x) => !crm(x.id)),
        ...(system === 'none' ? [] : [{ ...was, id: system, url }]),
      ];
      const r = await s.goldfish.hotel(gf, 'PUT', '/profile', { ...profile, systems: next });
      if (r.status !== 200)
        return reply
          .code(400)
          .send({ error: 'bad_request', message: refusal(r.body, 'не сохранилось') });
      req.log.info({ userId: user.id, system }, 'setup: crm saved');
      return { ok: true };
    } catch (err) {
      return unavailable(reply, req, err);
    }
  });

  /**
   * The list of competitors, as the owner edited it by hand. Only the list is changed, on the
   * profile as the server has it now: what the agent found since the page was opened stays in the
   * rest of the reference.
   */
  app.post('/api/agents/competitors/list', async (req, reply) => {
    const user = await owner(req, reply);
    if (!user) return reply;
    const body = (req.body ?? {}) as { competitors?: unknown };
    const list = Array.isArray(body.competitors) ? body.competitors : null;
    if (
      !list ||
      list.length > 10 ||
      !list.every(
        (c): c is { name: string; url: string } =>
          !!c &&
          typeof (c as { name?: unknown }).name === 'string' &&
          typeof (c as { url?: unknown }).url === 'string' &&
          !!(c as { name: string }).name.trim() &&
          (c as { name: string }).name.length <= 200 &&
          /^https?:\/\/\S+$/i.test((c as { url: string }).url.trim()) &&
          (c as { url: string }).url.length <= 1000,
      )
    )
      return reply.code(400).send({
        error: 'bad_request',
        message:
          'У каждого конкурента — название и ссылка на его страницу, с https://; не больше 10',
      });
    const gf = goldfishUserId(user);
    try {
      const profile = (await hotelOf(gf)).profile;
      const competitors = list.map((c) => ({ ...c, name: c.name.trim(), url: c.url.trim() }));
      const r = await s.goldfish.hotel(gf, 'PUT', '/profile', { ...profile, competitors });
      if (r.status !== 200)
        return reply
          .code(400)
          .send({ error: 'bad_request', message: refusal(r.body, 'не сохранилось') });
      req.log.info({ userId: user.id, count: competitors.length }, 'setup: competitors saved');
      return { ok: true };
    } catch (err) {
      return unavailable(reply, req, err);
    }
  });

  /**
   * «Запустить изучение», the last of the first steps: the agents go through the cabinets and
   * change nothing. A team that was never switched on starts whole; the level of autonomy is the
   * one to start with unless the owner chose another. The owner is done with the first steps once
   * the study began.
   */
  app.post('/api/agents/launch', async (req, reply) => {
    const user = await owner(req, reply);
    if (!user) return reply;
    const gf = goldfishUserId(user);
    try {
      const hotel = await hotelOf(gf);
      // The study first: refused (no extension yet), nothing is switched; on, the agents switched
      // on next only read.
      const study = await s.goldfish.hotel(gf, 'POST', '/study', { on: true });
      if (study.status === 404)
        return reply.code(400).send({
          error: 'bad_request',
          message: 'Сервер агентов ещё не умеет изучать кабинеты — его нужно обновить',
        });
      if (study.status !== 201)
        return reply
          .code(400)
          .send({ error: 'bad_request', message: refusal(study.body, 'изучение не началось') });
      const set = hotel.settings;
      const changes: Array<Record<string, unknown>> = [];
      if (!set.agents.some((a) => a.enabled))
        for (const a of set.agents) changes.push({ op: 'agent', agent: a.id, enabled: true });
      if (set.autonomy === 4 && set.autonomyLevels?.some((l) => l.level === START_AUTONOMY))
        changes.push({ op: 'autonomy', level: START_AUTONOMY });
      if (changes.length) {
        const r = await s.goldfish.hotel(gf, 'POST', '/settings', { changes });
        if (r.status !== 200)
          return reply
            .code(400)
            .send({ error: 'bad_request', message: refusal(r.body, 'агенты не включились') });
      }
      await store.markOnboarded(user.id);
      req.log.info({ userId: user.id, agents: changes.length }, 'agents launched: the study began');
      return { ok: true, redirect: TAB_PATH.today };
    } catch (err) {
      return unavailable(reply, req, err);
    }
  });

  // A chat linked to a bot, unlinked from the cabinet (only the owner's own chats).
  app.post('/api/bots/unlink', async (req, reply) => {
    reply.header('cache-control', 'no-store');
    if (!sameOrigin(req)) return reply.code(403).send({ error: 'forbidden' });
    const user = await sessions.user(req);
    if (!user) return reply.code(401).send({ error: 'unauthorized', message: 'Войдите заново' });
    if (!s.bots) return reply.code(404).send({ error: 'not_found' });
    const body = (req.body ?? {}) as { channel?: unknown; chatId?: unknown };
    if (
      typeof body.channel !== 'string' ||
      typeof body.chatId !== 'string' ||
      !body.channel ||
      !body.chatId ||
      body.channel.length > 40 ||
      body.chatId.length > 100
    )
      return reply.code(400).send({ error: 'bad_request', message: 'какой чат отвязать?' });
    try {
      const owner = { clientId: await s.goldfish.clientId(), userId: goldfishUserId(user) };
      if (!(await s.bots.unlink(owner, body.channel, body.chatId)))
        return reply.code(404).send({ error: 'not_found', message: 'Этот чат уже отвязан' });
      req.log.info({ userId: user.id, channel: body.channel }, 'bot chat unlinked');
      return { ok: true };
    } catch (err) {
      req.log.error({ err }, 'bots unlink: bots server unavailable');
      return reply.code(502).send({
        error: 'bots_unavailable',
        message: 'Сервер ботов сейчас недоступен — попробуйте через минуту',
      });
    }
  });

  app.setNotFoundHandler(async (_req, reply) =>
    reply.code(404).type('text/html; charset=utf-8').send(renderNotFound(view)),
  );

  return app;
}
