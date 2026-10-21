-- Passkeys (WebAuthn): entrar con Face ID / Touch ID sin contraseña. Se dan de alta con la sesión
-- ya abierta; el dispositivo guarda la clave privada y aquí solo queda la pública.
create table passkeys (
  -- id de la credencial (base64url), el que manda el navegador al entrar
  id text primary key,
  user_id uuid not null references users (id) on delete cascade,
  public_key bytea not null,
  -- contador de firmas del autenticador (las passkeys de iCloud siempre mandan 0)
  counter bigint not null default 0,
  transports text[] not null default '{}',
  -- 'singleDevice' | 'multiDevice' (sincronizada, p. ej. con el llavero de iCloud)
  device_type text not null,
  backed_up boolean not null default false,
  name text not null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);
create index passkeys_user on passkeys (user_id);
