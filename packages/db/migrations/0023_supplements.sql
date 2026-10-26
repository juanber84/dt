-- Los suplementos habituales de cada persona (creatina, magnesio...): la lista de Ajustes y los
-- chips de Hoy. Cada toma va aparte, como registro (episodio `supplement`); esto es solo qué toma
-- y desde cuándo. `type` lo usa la app (la creatina sube agua al empezar y la baja al dejarla).
create table supplements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  name text not null check (length(name) between 1 and 60),
  type text not null default 'other'
    check (type in ('creatine', 'magnesium', 'vitamin_d', 'omega_3', 'other')),
  dose text check (length(dose) <= 40),
  timing text check (timing in ('morning', 'midday', 'evening', 'night', 'training')),
  started_on date not null,
  stopped_on date check (stopped_on >= started_on),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index supplements_user_idx on supplements (user_id);
