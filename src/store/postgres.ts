import pg from 'pg';
import { newId } from '../util/crypto.js';
import type { Logger } from '../util/logger.js';
import { MIGRATIONS } from './migrations.js';
import type { Store, UserRecord, YandexProfileInput } from './types.js';

/** Arbitrary constant: serialises migrations across replicas starting at once. */
const MIGRATION_LOCK = 7_204_118_352;

const COLUMNS = [
  'id',
  'yandex_id',
  'login',
  'email',
  'name',
  'avatar_id',
  'created_at',
  'last_login_at',
  'token_id',
  'token_issued_at',
  'last_download_at',
  'onboarded_at',
];
const USER_COLUMNS = COLUMNS.join(', ');

interface UserRow {
  id: string;
  yandex_id: string;
  login: string | null;
  email: string | null;
  name: string | null;
  avatar_id: string | null;
  created_at: Date;
  last_login_at: Date;
  token_id: string | null;
  token_issued_at: Date | null;
  last_download_at: Date | null;
  onboarded_at: Date | null;
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);

function toUser(r: UserRow): UserRecord {
  return {
    id: r.id,
    yandexId: r.yandex_id,
    login: r.login,
    email: r.email,
    name: r.name,
    avatarId: r.avatar_id,
    createdAt: r.created_at.toISOString(),
    lastLoginAt: r.last_login_at.toISOString(),
    tokenId: r.token_id,
    tokenIssuedAt: iso(r.token_issued_at),
    lastDownloadAt: iso(r.last_download_at),
    onboardedAt: iso(r.onboarded_at),
  };
}

export class PostgresStore implements Store {
  private constructor(private readonly pool: pg.Pool) {}

  static async connect(
    connectionString: string,
    log?: Pick<Logger, 'warn'>,
  ): Promise<PostgresStore> {
    const pool = new pg.Pool({ connectionString, max: 5 });
    // An idle connection the database closes (a restart, its idle limit, a network blip) is an
    // «error» of the pool: with no listener it was an uncaught exception that stopped the site.
    // The pool has dropped that connection already; the next query opens a new one.
    pool.on('error', (err) => log?.warn({ err }, 'idle database connection lost'));
    const store = new PostgresStore(pool);
    await store.migrate();
    return store;
  }

  private async migrate(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('select pg_advisory_lock($1)', [MIGRATION_LOCK]);
      await client.query(
        'create table if not exists schema_migrations (version int primary key, applied_at timestamptz not null default now())',
      );
      const { rows } = await client.query<{ version: number }>(
        'select version from schema_migrations',
      );
      const applied = new Set(rows.map((r) => r.version));
      for (const m of MIGRATIONS) {
        if (applied.has(m.version)) continue;
        await client.query('begin');
        try {
          await client.query(m.sql);
          await client.query('insert into schema_migrations (version) values ($1)', [m.version]);
          await client.query('commit');
        } catch (err) {
          await client.query('rollback');
          throw err;
        }
      }
    } finally {
      await client.query('select pg_advisory_unlock($1)', [MIGRATION_LOCK]).catch(() => undefined);
      client.release();
    }
  }

  async upsertYandexUser(p: YandexProfileInput): Promise<UserRecord> {
    const { rows } = await this.pool.query<UserRow>(
      `insert into users (id, yandex_id, login, email, name, avatar_id)
       values ($1, $2, $3, $4, $5, $6)
       on conflict (yandex_id) do update set
         login = excluded.login, email = excluded.email, name = excluded.name,
         avatar_id = excluded.avatar_id, last_login_at = now()
       returning ${USER_COLUMNS}`,
      [newId('usr'), p.yandexId, p.login, p.email, p.name, p.avatarId],
    );
    return toUser(rows[0]!);
  }

  async getUser(id: string): Promise<UserRecord | null> {
    const { rows } = await this.pool.query<UserRow>(
      `select ${USER_COLUMNS} from users where id = $1`,
      [id],
    );
    return rows[0] ? toUser(rows[0]) : null;
  }

  async setToken(userId: string, tokenId: string): Promise<UserRecord> {
    const { rows } = await this.pool.query<UserRow>(
      `update users set token_id = $2, token_issued_at = now() where id = $1
       returning ${USER_COLUMNS}`,
      [userId, tokenId],
    );
    if (!rows[0]) throw new Error(`unknown user ${userId}`);
    return toUser(rows[0]);
  }

  async markDownload(userId: string): Promise<void> {
    await this.pool.query('update users set last_download_at = now() where id = $1', [userId]);
  }

  async markOnboarded(userId: string): Promise<UserRecord> {
    const { rows } = await this.pool.query<UserRow>(
      `update users set onboarded_at = coalesce(onboarded_at, now()) where id = $1
       returning ${USER_COLUMNS}`,
      [userId],
    );
    if (!rows[0]) throw new Error(`unknown user ${userId}`);
    return toUser(rows[0]);
  }

  async createSession(idHash: string, userId: string, expiresAt: Date): Promise<void> {
    await this.pool.query(
      'insert into sessions (id_hash, user_id, expires_at) values ($1, $2, $3)',
      [idHash, userId, expiresAt],
    );
  }

  async sessionUser(idHash: string): Promise<UserRecord | null> {
    const { rows } = await this.pool.query<UserRow>(
      `select ${COLUMNS.map((c) => `u.${c}`).join(', ')} from sessions s
       join users u on u.id = s.user_id
       where s.id_hash = $1 and s.expires_at > now()`,
      [idHash],
    );
    return rows[0] ? toUser(rows[0]) : null;
  }

  async deleteSession(idHash: string): Promise<void> {
    await this.pool.query('delete from sessions where id_hash = $1', [idHash]);
  }

  async deleteExpiredSessions(): Promise<number> {
    const res = await this.pool.query('delete from sessions where expires_at <= now()');
    return res.rowCount ?? 0;
  }

  async ping(): Promise<void> {
    await this.pool.query('select 1');
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
