-- Correos que manda la app (informe del día, pruebas...). Por usuario, como los avisos push: sirve
-- de historial y para no mandar dos veces lo mismo (dedupe_key: un informe por día).
create table email_log (
  id bigint generated always as identity primary key,
  user_id uuid not null references users (id) on delete cascade,
  kind text not null,
  dedupe_key text,
  to_address text not null,
  subject text not null,
  -- pending (encolado o enviando) | sent | failed
  status text not null default 'pending',
  -- El id que da Resend (para buscarlo en su panel)
  provider_id text,
  error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create unique index email_log_dedupe on email_log (user_id, kind, dedupe_key)
  where dedupe_key is not null;
create index email_log_user_created on email_log (user_id, created_at desc);
