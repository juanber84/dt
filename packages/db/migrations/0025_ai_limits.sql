-- Límite de gasto en IA por usuario y claves propias (Cuenta → IA).
--   ai_daily_limit_usd: lo que puede gastar al día con la clave de la app. null = el de por
--                       defecto (AI_DAILY_LIMIT_USD). Los administradores no tienen límite.
alter table users add column ai_daily_limit_usd numeric(8, 4) check (ai_daily_limit_usd >= 0);

-- Su propia cuenta de un proveedor compatible con la API de OpenAI (uno de la lista de la app):
-- con ella todo va por su clave y sin límite. La clave va cifrada (TOKEN_ENCRYPTION_KEY).
create table user_llm_providers (
  user_id uuid primary key references users (id) on delete cascade,
  provider text not null,
  model text not null,
  api_key bytea not null,
  -- Lo que se enseña de la clave: "…a1b2"
  key_hint text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Lo gastado con la clave del usuario no cuenta para su límite
alter table llm_usage add column own_key boolean not null default false;
create index llm_usage_user_at on llm_usage (user_id, at desc);
