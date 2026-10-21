-- Copias de seguridad de la BD (job db-backup del worker): cuándo, cuánto ocupó, dónde fue y si
-- falló. La página de Sistema enseña la última.
create table backup_runs (
  id bigint generated always as identity primary key,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running' check (status in ('running', 'ok', 'error')),
  -- Nombre del fichero en el destino (cifrado con age)
  file text,
  size_bytes bigint,
  -- Copias viejas borradas del destino en esta pasada
  pruned integer,
  error text
);
create index backup_runs_started on backup_runs (started_at desc);
