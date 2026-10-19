-- Informes médicos que sube el usuario en PDF (analíticas, holter, prueba de esfuerzo). El PDF se
-- guarda tal cual; el worker saca el texto, le quita los datos personales y el LLM extrae los
-- valores (extraction). El usuario los revisa y, al confirmar, van al timeline como un raw_record
-- del proveedor 'clinical' (episodio + observaciones).
create table clinical_documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  -- processing: en la cola | review: extraído, falta revisarlo | confirmed: en el timeline | error
  status text not null default 'processing'
    check (status in ('processing', 'review', 'confirmed', 'error')),
  type text check (type in ('lab', 'holter', 'stress_test', 'other')),
  file_name text not null,
  size_bytes integer not null,
  -- Subir el mismo PDF dos veces no lo duplica
  sha256 text not null,
  content bytea not null,
  -- El texto que vio el LLM (ya sin datos personales): con él se comprueba cada valor al revisar
  text text,
  redactions integer,
  extraction jsonb,
  error text,
  -- Día de la prueba (sale de la extracción): para ordenar sin abrir el jsonb
  document_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  confirmed_at timestamptz,
  unique (user_id, sha256)
);
create index clinical_documents_user_idx
  on clinical_documents (user_id, document_date desc nulls first, created_at desc);
-- Un PDF ya va comprimido: que Postgres no lo intente otra vez
alter table clinical_documents alter column content set storage external;

-- Nombres de parámetros que el usuario ha confirmado (como lo escribe su laboratorio → métrica):
-- la próxima analítica con ese nombre ya sale bien.
create table clinical_aliases (
  user_id uuid not null references users (id) on delete cascade,
  alias text not null,
  metric_code text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, alias)
);

-- Lo medido en una prueba clínica manda sobre lo estimado: el VO2max de la prueba de esfuerzo
-- frente al del reloj, el pulso del holter frente al del reloj
insert into source_priorities (metric_id, provider, priority) values (null, 'clinical', 5);
