/** Forward-only schema migrations. Never edit an applied migration: append a new one. */
export const MIGRATIONS: Array<{ version: number; sql: string }> = [
  {
    version: 1,
    sql: `
create table users (
  id text primary key,
  yandex_id text not null unique,
  login text,
  email text,
  name text,
  avatar_id text,
  created_at timestamptz not null default now(),
  last_login_at timestamptz not null default now(),
  token_id text,
  token_issued_at timestamptz,
  last_download_at timestamptz
);

create table sessions (
  id_hash text primary key,
  user_id text not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index sessions_expires_idx on sessions (expires_at);
`,
  },
  {
    version: 2,
    // Users who already got a token went through the old cabinet: the wizard does not greet them.
    sql: `
alter table users add column onboarded_at timestamptz;
update users set onboarded_at = token_issued_at where token_issued_at is not null;
`,
  },
];
