-- Latido de cada worker (lo enseña la página de Sistema): si deja de latir, está caído.
create table worker_heartbeats (
  worker_id text primary key,
  hostname text,
  version text,
  started_at timestamptz not null,
  last_seen_at timestamptz not null default now(),
  interval_ms integer not null,
  -- Trabajos hechos, fallidos y aplazados por cola, y el último error
  stats jsonb not null default '{}'
);
