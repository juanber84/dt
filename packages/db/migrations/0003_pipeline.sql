-- Pipeline de datos: buzón de entrada → raw_records → timeline (observations + episodes).
--
--   inbox          todo lo que nos llega de fuera (webhooks, bot), tal cual, para auditar
--   raw_records    lo que dijo cada fuente, intacto, por lote (un día de FC = un registro)
--   streams        de dónde viene cada dato dentro de un proveedor (app, reloj, báscula...)
--   metrics        catálogo de métricas (código propio, unidad UCUM, LOINC si lo hay)
--   observations   medidas numéricas: hypertable estrecha (sin texto ni jsonb por fila)
--   episodes       cosas con inicio y fin (comida, entreno, sueño, pesaje) + su extensión
--   backfills      progreso de la carga inicial de cada conexión
--   rate_limits    contadores por ventana para no pasarse con las APIs de fuera

-- Usuario de cada proveedor (healthUserId de Google, id de Telegram, owner_id de Strava...): los
-- webhooks traen el suyo y hay que saber de quién es.
alter table connections add column external_user_id text;
create unique index connections_external_user_key on connections (provider, external_user_id)
  where external_user_id is not null;

create table inbox (
  id bigint generated always as identity primary key,
  received_at timestamptz not null default now(),
  provider text not null,
  -- 'data' (trae el dato) | 'command' (aviso u orden: "ha cambiado X", "sincroniza")
  kind text not null check (kind in ('data', 'command')),
  type text not null,
  user_id uuid references users (id) on delete cascade,
  payload jsonb not null,
  status text not null default 'received' check (status in ('received', 'routed', 'ignored', 'error')),
  error text
);
create index inbox_received_at_idx on inbox (received_at);

create table raw_records (
  id bigint generated always as identity primary key,
  user_id uuid not null references users (id) on delete cascade,
  provider text not null,
  -- Qué es dentro del proveedor: 'scale', 'heart-rate', 'meal'...
  kind text not null,
  -- Estable para la fuente: re-importar lo mismo no duplica (Google: tipo + día)
  external_id text not null,
  -- Rango de tiempo que cubre (normalizar este registro reemplaza lo que haya en ese rango)
  period_start timestamptz not null,
  period_end timestamptz not null,
  payload jsonb not null,
  payload_hash text not null,
  version integer not null default 1,
  received_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  normalized_at timestamptz,
  -- Claves de observations que generó la última normalización (fuentes por evento: comidas,
  -- pesajes). Al re-normalizar se borran las que ya no salen.
  produced jsonb,
  -- Borrado en origen: no se borra, se marca y se ignora al normalizar
  deleted_at timestamptz,
  unique (user_id, provider, kind, external_id)
);
create index raw_records_period_idx on raw_records (user_id, provider, kind, period_start);
alter table raw_records alter column payload set compression lz4;

create table streams (
  id integer generated always as identity primary key,
  user_id uuid not null references users (id) on delete cascade,
  provider text not null,
  -- Clave del origen dentro del proveedor (Google: plataforma + app + dispositivo)
  origin text not null,
  details jsonb not null default '{}',
  created_at timestamptz not null default now(),
  unique (user_id, provider, origin)
);

create table metrics (
  id smallint generated always as identity primary key,
  code text not null unique,
  -- UCUM: kg, %, /min, kcal, g, m, ms...
  unit text,
  -- Cómo se agrega en el timeline: 'avg' (FC, peso), 'sum' (pasos, kcal), 'last' (VO2max diario)
  aggregation text not null check (aggregation in ('avg', 'sum', 'last')),
  loinc text,
  label text
);

-- Prioridad de cada proveedor por métrica (menor = manda). metric_id null = por defecto.
create table source_priorities (
  id integer generated always as identity primary key,
  metric_id smallint references metrics (id) on delete cascade,
  provider text not null,
  priority integer not null
);
create unique index source_priorities_key on source_priorities (coalesce(metric_id, 0), provider);

create table observations (
  time timestamptz not null,
  user_id uuid not null,
  metric_id smallint not null,
  stream_id integer not null,
  value double precision not null,
  -- Solo en intervalos (pasos de 10 min, kcal...): fin del intervalo
  end_time timestamptz
);
select create_hypertable('observations', by_range('time', interval '7 days'));
-- Único índice: sirve para consultar y para no duplicar (re-importar actualiza)
create unique index observations_key on observations (user_id, metric_id, time desc, stream_id);
alter table observations set (
  timescaledb.compress,
  timescaledb.compress_segmentby = 'user_id, metric_id',
  timescaledb.compress_orderby = 'time desc, stream_id'
);
-- Compresión pasado un mes: lo reciente se sigue escribiendo barato
select add_compression_policy('observations', interval '30 days');

create table episodes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  stream_id integer not null references streams (id) on delete cascade,
  raw_id bigint references raw_records (id) on delete set null,
  -- 'meal' | 'workout' | 'sleep' | 'weigh-in' | ...
  kind text not null,
  external_id text not null,
  start_time timestamptz not null,
  end_time timestamptz,
  title text,
  -- Resumen para pintar el timeline sin abrir el detalle (kcal, duración, proteína...)
  summary jsonb not null default '{}',
  -- Extensión: el detalle de cada tipo, con su esquema versionado (meal@1, workout@1...)
  schema text not null,
  details jsonb not null default '{}',
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, stream_id, kind, external_id)
);
create index episodes_user_time_idx on episodes (user_id, start_time desc);
create index episodes_raw_idx on episodes (raw_id);

create table backfills (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  provider text not null,
  status text not null default 'running' check (status in ('running', 'done', 'cancelled')),
  total integer not null default 0,
  done integer not null default 0,
  failed integer not null default 0,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);
create index backfills_user_idx on backfills (user_id, provider, started_at desc);

create table rate_limits (
  key text not null,
  window_start timestamptz not null,
  hits integer not null default 0,
  primary key (key, window_start)
);

-- Por defecto: lo nuestro manda, luego la fuente directa y Google (copia de otras) al final
insert into source_priorities (metric_id, provider, priority) values
  (null, 'digitaltwin', 10),
  (null, 'xiaomi', 20),
  (null, 'strava', 30),
  (null, 'intervals-icu', 30),
  (null, 'google-health', 50);
