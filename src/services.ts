import { AccessService } from './access.js';
import { Sessions } from './auth/session.js';
import { createBots, type BotsClient } from './bots.js';
import { YandexAuth } from './auth/yandex.js';
import { isSecure, type Config } from './config.js';
import { GoldfishAdmin } from './goldfish/admin.js';
import { MemoryStore } from './store/memory.js';
import { PostgresStore } from './store/postgres.js';
import type { Store } from './store/types.js';
import type { Logger } from './util/logger.js';

export interface Services {
  config: Config;
  log: Logger;
  store: Store;
  sessions: Sessions;
  yandex: YandexAuth;
  goldfish: GoldfishAdmin;
  access: AccessService;
  /** The bots in Telegram, MAX and WhatsApp; null when BOTS_URL is not set. */
  bots: BotsClient | null;
}

export async function createServices(
  config: Config,
  log: Logger,
  overrides: { store?: Store; fetch?: typeof fetch; retryDelaysMs?: readonly number[] } = {},
): Promise<Services> {
  const store =
    overrides.store ??
    (config.DATABASE_URL
      ? await PostgresStore.connect(config.DATABASE_URL, log)
      : new MemoryStore());
  if (!overrides.store && !config.DATABASE_URL)
    log.warn('DATABASE_URL is not set: users and sessions are kept in memory');
  const goldfish = new GoldfishAdmin(config, overrides.fetch, overrides.retryDelaysMs);
  return {
    config,
    log,
    store,
    sessions: new Sessions(store, isSecure(config), config.SESSION_DAYS),
    yandex: new YandexAuth(config, overrides.fetch, overrides.retryDelaysMs?.[0]),
    goldfish,
    access: new AccessService(store, goldfish),
    bots: createBots(config, overrides.fetch),
  };
}
