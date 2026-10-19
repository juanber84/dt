-- Usuarios. Sin registro todavía: se crean a mano (make user).
create table users (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  name text,
  role text not null default 'user' check (role in ('admin', 'user')),
  -- scrypt$N$r$p$salt$hash (apps/api/src/services/users.js)
  password_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index users_email_key on users (lower(email));

-- Conectores de cada usuario (Xiaomi, Google, Strava...). `provider` es texto libre: añadir un
-- conector no necesita migración. Lo común va en columnas; lo de cada conector, en dos JSON:
--   credentials: secreto (tokens, API keys...), cifrado con AES-256-GCM (TOKEN_ENCRYPTION_KEY)
--   data:        no secreto (región, dispositivos, estado de la sincronización...)
create table connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  provider text not null,
  status text not null default 'connected' check (status in ('connected', 'expired', 'error')),
  account text,
  credentials bytea,
  data jsonb not null default '{}',
  last_error text,
  connected_at timestamptz not null default now(),
  last_sync_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, provider)
);
