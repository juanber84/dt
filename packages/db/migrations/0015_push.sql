-- Notificaciones push (Web Push). Todo por usuario: cada uno sus dispositivos, sus preferencias y
-- su historial (que también sirve para no repetir un aviso ni pasarse del máximo diario).

-- Un dispositivo (navegador / app instalada) que ha dado permiso. El endpoint lo da el servicio
-- de push del fabricante (Apple, Google, Mozilla) y es único por dispositivo.
create table push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  -- Para ponerle nombre en la lista (iPhone, Mac...)
  device text,
  created_at timestamptz not null default now(),
  last_sent_at timestamptz
);
create index push_subscriptions_user on push_subscriptions (user_id);

-- Preferencias (sin fila = las de por defecto)
create table notification_settings (
  user_id uuid primary key references users (id) on delete cascade,
  -- Tipos de aviso apagados (clinical-ready, connection-broken, meals-missing...)
  disabled text[] not null default '{}',
  -- Horas de silencio en la hora local del usuario: lo que caiga dentro se manda al acabar
  quiet_from time not null default '22:00',
  quiet_to time not null default '08:00',
  -- Como mucho tantos avisos al día (sin contar los de prueba)
  max_per_day smallint not null default 6,
  updated_at timestamptz not null default now()
);

-- Lo que se ha mandado. dedupe_key: el mismo aviso no sale dos veces (un informe, un día...)
create table notification_log (
  id bigint generated always as identity primary key,
  user_id uuid not null references users (id) on delete cascade,
  kind text not null,
  dedupe_key text,
  title text not null,
  body text,
  url text,
  sent_at timestamptz not null default now(),
  -- A cuántos dispositivos llegó
  delivered smallint not null default 0
);
create unique index notification_log_dedupe on notification_log (user_id, kind, dedupe_key)
  where dedupe_key is not null;
create index notification_log_user_sent on notification_log (user_id, sent_at desc);
