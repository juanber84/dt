-- Conversaciones con el coach (la IA de la app). Los mensajes se guardan en el formato de la API
-- de OpenAI (user, assistant con tool_calls, tool con su resultado) para poder retomar la
-- conversación tal cual y ver de dónde sacó cada cifra.
create table coach_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  title text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index coach_conversations_user on coach_conversations (user_id, updated_at desc);

create table coach_messages (
  id bigint generated always as identity primary key,
  conversation_id uuid not null references coach_conversations (id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'tool')),
  content text not null default '',
  tool_calls jsonb,
  tool_call_id text,
  -- Contexto desde el que se preguntó (el día que estaba mirando...), lo que no es del modelo
  meta jsonb,
  created_at timestamptz not null default now()
);
create index coach_messages_conversation on coach_messages (conversation_id, id);
