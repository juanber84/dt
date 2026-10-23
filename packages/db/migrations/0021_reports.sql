-- Informes (el de cada mañana y, más adelante, los que pidas al coach). Se guardan ya resueltos:
-- los bloques con los números de ese momento, para que el informe no cambie al reabrirlo.
create table reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  -- daily (el de la mañana) | custom (a demanda)
  kind text not null,
  title text not null,
  -- Día o rango del que habla (días locales del usuario)
  period_from date not null,
  period_to date not null,
  blocks jsonb not null,
  created_at timestamptz not null default now()
);
-- Uno de la mañana por día y usuario (si se regenera, se reemplaza)
create unique index reports_daily on reports (user_id, period_from) where kind = 'daily';
create index reports_user_created on reports (user_id, created_at desc);

-- Preferencias (sin fila = las de por defecto: el de la mañana activado a las 07:30)
create table report_settings (
  user_id uuid primary key references users (id) on delete cascade,
  daily_enabled boolean not null default true,
  -- Hora local del usuario
  daily_time time not null default '07:30',
  updated_at timestamptz not null default now()
);
