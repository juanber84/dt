-- Cada llamada a un LLM (coach, macros de las comidas...): tokens y coste estimado. El proveedor
-- solo da el saldo, el desglose lo llevamos nosotros.
create table llm_usage (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  user_id uuid references users (id) on delete set null,
  -- Qué lo pidió: coach, nutrition.analyze, nutrition.refine...
  feature text not null,
  model text not null,
  input_tokens integer not null default 0,
  -- De input_tokens, los que salieron de la caché del proveedor (más baratos)
  cached_tokens integer not null default 0,
  output_tokens integer not null default 0,
  -- Con los precios configurados al hacer la llamada (LLM_PRICES)
  cost_usd numeric(12, 6) not null default 0,
  duration_ms integer,
  error text,
  conversation_id uuid references coach_conversations (id) on delete set null
);
create index llm_usage_at on llm_usage (at desc);
