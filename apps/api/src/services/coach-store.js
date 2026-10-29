import { randomUUID } from 'node:crypto';

/** Mensajes que se le mandan al modelo, como mucho: la conversación entera crece sin límite. */
const HISTORY_LIMIT = 40;

const conversationFromRow = (row) => ({
  id: row.id,
  title: row.title,
  createdAt: row.created_at.toISOString(),
  updatedAt: row.updated_at.toISOString(),
});

const messageFromRow = (row) => ({
  id: String(row.id),
  role: row.role,
  content: row.content,
  ...(row.tool_calls && { toolCalls: row.tool_calls }),
  ...(row.tool_call_id && { toolCallId: row.tool_call_id }),
  ...(row.meta && { meta: row.meta }),
  createdAt: row.created_at.toISOString(),
});

/**
 * Conversaciones del coach en la BD (coach_conversations, coach_messages). Todo va por usuario:
 * nadie lee ni escribe en una conversación ajena.
 * @param {{ db: import('postgres').Sql }} deps
 */
export function createDbCoachStore({ db }) {
  return {
    async list(userId) {
      const rows = await db`
        select * from coach_conversations where user_id = ${userId}
        order by updated_at desc limit 100
      `;
      return rows.map(conversationFromRow);
    },

    async create({ userId, title }) {
      const [row] = await db`
        insert into coach_conversations (user_id, title) values (${userId}, ${title}) returning *
      `;
      return { ...conversationFromRow(row), messages: [] };
    },

    /** La conversación con sus mensajes, o null si no existe o no es suya. */
    async get(userId, id) {
      const [row] = await db`
        select * from coach_conversations where id = ${id} and user_id = ${userId}
      `;
      if (!row) return null;
      const messages = await db`
        select * from coach_messages where conversation_id = ${id} order by id
      `;
      return { ...conversationFromRow(row), messages: messages.map(messageFromRow) };
    },

    /** @param {string} conversationId  Ya comprobado que es del usuario. */
    async addMessage(conversationId, { role, content, toolCalls, toolCallId, meta }) {
      const [row] = await db`
        insert into coach_messages (conversation_id, role, content, tool_calls, tool_call_id, meta)
        values (
          ${conversationId}, ${role}, ${content ?? ''},
          ${toolCalls ? db.json(toolCalls) : null}, ${toolCallId ?? null},
          ${meta ? db.json(meta) : null}
        )
        returning *
      `;
      await db`update coach_conversations set updated_at = now() where id = ${conversationId}`;
      return messageFromRow(row);
    },

    /** Un mensaje, solo si es de una conversación del usuario. */
    async getMessage(userId, messageId) {
      const [row] = await db`
        select m.* from coach_messages m
        join coach_conversations c on c.id = m.conversation_id
        where m.id = ${messageId} and c.user_id = ${userId}
      `;
      return row ? messageFromRow(row) : null;
    },

    /** @param {string} messageId  Ya comprobado que es del usuario (getMessage). */
    async updateMessage(messageId, { content, meta }) {
      await db`
        update coach_messages set content = ${content}, meta = ${db.json(meta)}
        where id = ${messageId}
      `;
    },

    async remove(userId, id) {
      const rows = await db`
        delete from coach_conversations where id = ${id} and user_id = ${userId} returning id
      `;
      return rows.length > 0;
    },
  };
}

/** Lo mismo en memoria (tests y arranque sin BD). */
export function createMemoryCoachStore() {
  const conversations = new Map();
  let nextId = 1;
  const view = ({ id, title, createdAt, updatedAt }) => ({ id, title, createdAt, updatedAt });
  const touch = (c) => {
    // Siempre hacia delante, aunque dos cambios caigan en el mismo milisegundo
    c.updatedAt = new Date(Math.max(Date.now(), Date.parse(c.updatedAt) + 1)).toISOString();
  };

  return {
    async list(userId) {
      return [...conversations.values()]
        .filter((c) => c.userId === userId)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .map(view);
    },

    async create({ userId, title }) {
      const now = new Date().toISOString();
      const c = { id: randomUUID(), userId, title, createdAt: now, updatedAt: now, messages: [] };
      conversations.set(c.id, c);
      return { ...view(c), messages: [] };
    },

    async get(userId, id) {
      const c = conversations.get(id);
      if (c?.userId !== userId) return null;
      return { ...view(c), messages: c.messages.map((m) => ({ ...m })) };
    },

    async addMessage(conversationId, { role, content, toolCalls, toolCallId, meta }) {
      const c = conversations.get(conversationId);
      const message = {
        id: String(nextId++),
        role,
        content: content ?? '',
        ...(toolCalls && { toolCalls }),
        ...(toolCallId && { toolCallId }),
        ...(meta && { meta }),
        createdAt: new Date().toISOString(),
      };
      c.messages.push(message);
      touch(c);
      return { ...message };
    },

    async getMessage(userId, messageId) {
      for (const c of conversations.values()) {
        const message = c.userId === userId && c.messages.find((m) => m.id === messageId);
        if (message) return { ...message };
      }
      return null;
    },

    async updateMessage(messageId, { content, meta }) {
      for (const c of conversations.values()) {
        const message = c.messages.find((m) => m.id === messageId);
        if (message) Object.assign(message, { content, meta });
      }
    },

    async remove(userId, id) {
      if (conversations.get(id)?.userId !== userId) return false;
      return conversations.delete(id);
    },
  };
}

/** Título de una conversación nueva: el principio de la primera pregunta. */
export function titleFrom(text) {
  const line = text.trim().split('\n')[0].replace(/\s+/g, ' ');
  return line.length > 60 ? `${line.slice(0, 57).trimEnd()}…` : line;
}

/**
 * Mensajes guardados → mensajes para el modelo: como mucho los últimos HISTORY_LIMIT, empezando
 * siempre por una pregunta (cortar entre una llamada a herramienta y su resultado lo rompería). El contexto
 * desde el que se preguntó va delante del texto.
 */
export function toModelHistory(messages, limit = HISTORY_LIMIT) {
  let start = Math.max(0, messages.length - limit);
  while (start < messages.length - 1 && messages[start].role !== 'user') start++;

  return messages.slice(start).map((m) => {
    if (m.role === 'tool') return { role: 'tool', tool_call_id: m.toolCallId, content: m.content };
    if (m.role === 'assistant') {
      return {
        role: 'assistant',
        content: m.content,
        ...(m.toolCalls && { tool_calls: m.toolCalls }),
      };
    }
    const date = m.meta?.context?.date;
    return {
      role: 'user',
      content: date ? `[Está mirando el día ${date} en la app]\n${m.content}` : m.content,
    };
  });
}
