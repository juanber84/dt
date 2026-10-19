import { randomUUID } from 'node:crypto';

/**
 * Propuestas pendientes de confirmar, en memoria. Si el bot se reinicia se pierden
 * (los botones de esas propuestas avisan de que han caducado).
 *
 * Estados: pending → saving → saved | pending, y pending → replaced | discarded.
 */
export class DraftStore {
  constructor({ ttlMs = 24 * 60 * 60 * 1000, now = () => Date.now() } = {}) {
    this.ttlMs = ttlMs;
    this.now = now;
    /** @type {Map<string, object>} */
    this.drafts = new Map();
    /** chatId → id de la propuesta que espera una corrección */
    this.awaiting = new Map();
  }

  create({ chatId, text, analysis }) {
    this.prune();
    const draft = {
      id: randomUUID(),
      chatId,
      text,
      analysis,
      status: 'pending',
      messageId: undefined,
      html: '',
      createdAt: this.now(),
    };
    this.drafts.set(draft.id, draft);
    return draft;
  }

  get(id) {
    return this.drafts.get(id);
  }

  findByMessage(chatId, messageId) {
    for (const draft of this.drafts.values()) {
      if (draft.chatId === chatId && draft.messageId === messageId) return draft;
    }
    return undefined;
  }

  /** Marca que el próximo mensaje del chat es una corrección de esa propuesta. */
  awaitCorrection(chatId, id) {
    this.awaiting.set(chatId, id);
  }

  /** Devuelve (y olvida) la propuesta pendiente de corrección del chat, si sigue pendiente. */
  takeAwaiting(chatId) {
    const id = this.awaiting.get(chatId);
    this.awaiting.delete(chatId);
    const draft = id && this.drafts.get(id);
    return draft?.status === 'pending' ? draft : undefined;
  }

  prune() {
    const limit = this.now() - this.ttlMs;
    for (const [id, draft] of this.drafts) {
      if (draft.createdAt < limit) this.drafts.delete(id);
    }
  }
}
