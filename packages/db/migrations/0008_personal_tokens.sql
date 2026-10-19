-- Tokens personales: dan acceso a los datos de un usuario a un cliente suyo (Claude Code, Claude
-- Desktop... por MCP). Solo se guarda el sha256 del token; el token se enseña una vez al crearlo.
create table personal_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  name text not null,
  token_hash bytea not null unique,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
create index personal_tokens_user on personal_tokens (user_id);
