import { ClinicalError, ClinicalErrorCode } from './errors.js';
import { modelOutputSchema } from './schema.js';
import { SYSTEM_PROMPT } from './prompt.js';

export const DEEPSEEK_BASE_URL = 'https://api.deepseek.com';
export const DEEPSEEK_MODEL = 'deepseek-flash';

const MAX_ATTEMPTS = 2;
// Lo que se le manda como mucho (un holter de 5 páginas son ~25.000 caracteres)
const MAX_TEXT = 60_000;

/**
 * Saca los datos de un informe (ya en texto y sin datos personales) con un modelo compatible con
 * la API de OpenAI: DeepSeek por defecto, en modo JSON y sin thinking, como las macros.
 */
export class ClinicalExtractor {
  /**
   * @param {object} options
   * @param {string} options.apiKey
   * @param {string} [options.baseUrl] Por defecto DeepSeek.
   * @param {string} [options.model] Por defecto deepseek-flash.
   * @param {object} [options.extraBody] Campos extra de la petición. Por defecto desactiva el
   *   modo thinking de DeepSeek; con OpenAI pasa `{}`.
   * @param {number} [options.maxTokens]
   * @param {number} [options.timeoutMs]
   * @param {typeof fetch} [options.fetch]
   * @param {(entry: { feature: string, model: string, usage: object | null, durationMs: number, error?: string }) => void} [options.onUsage]
   *   Cada llamada al modelo (tokens gastados o el error), para llevar la cuenta del gasto.
   */
  constructor({
    apiKey,
    baseUrl = DEEPSEEK_BASE_URL,
    model = DEEPSEEK_MODEL,
    extraBody = { thinking: { type: 'disabled' } },
    maxTokens = 8000,
    timeoutMs = 120_000,
    fetch = globalThis.fetch,
    onUsage,
  }) {
    if (!apiKey) throw new Error('ClinicalExtractor: falta apiKey');
    this.apiKey = apiKey;
    this.url = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
    this.model = model;
    this.extraBody = extraBody;
    this.maxTokens = maxTokens;
    this.timeoutMs = timeoutMs;
    this.fetch = fetch;
    this.onUsage = onUsage;
  }

  /**
   * @param {string} text  Texto del informe, ya sin datos personales.
   * @param {{ userId?: string }} [context]  Va a onUsage (para la cuenta del gasto por usuario).
   * @returns {Promise<import('zod').infer<typeof modelOutputSchema>>}
   */
  async extract(text, context = {}) {
    const content = `Informe:\n\n${text.slice(0, MAX_TEXT)}`;
    let lastError;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        return parseOutput(await this.#complete(content, context));
      } catch (error) {
        const retryable =
          error.code === ClinicalErrorCode.EMPTY_RESPONSE ||
          error.code === ClinicalErrorCode.INVALID_RESPONSE;
        if (!retryable) throw error;
        lastError = error;
      }
    }
    throw lastError;
  }

  async #complete(content, context) {
    const started = Date.now();
    const feature = 'clinical.extract';
    const report = (usage, error, model = this.model) => {
      try {
        this.onUsage?.({
          feature,
          model,
          usage,
          durationMs: Date.now() - started,
          error,
          ...context,
        });
      } catch {
        // Llevar la cuenta nunca debe romper la extracción
      }
    };
    let response;
    try {
      response = await this.fetch(this.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content },
          ],
          response_format: { type: 'json_object' },
          max_tokens: this.maxTokens,
          temperature: 0,
          ...this.extraBody,
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      report(null, error.message);
      if (error.name === 'TimeoutError') {
        throw new ClinicalError(ClinicalErrorCode.TIMEOUT, 'El modelo ha tardado demasiado');
      }
      throw new ClinicalError(ClinicalErrorCode.API_ERROR, `Error de red: ${error.message}`);
    }

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const message = payload?.error?.message ?? response.statusText;
      report(null, `${response.status}: ${message}`);
      throw new ClinicalError(ClinicalErrorCode.API_ERROR, `${response.status}: ${message}`, {
        status: response.status,
      });
    }

    report(payload?.usage ?? null, undefined, payload?.model ?? this.model);
    const output = payload?.choices?.[0]?.message?.content;
    if (!output?.trim()) {
      throw new ClinicalError(ClinicalErrorCode.EMPTY_RESPONSE, 'El modelo no ha devuelto nada');
    }
    return output;
  }
}

function parseOutput(raw) {
  let json;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new ClinicalError(ClinicalErrorCode.INVALID_RESPONSE, 'El modelo no ha devuelto JSON', {
      raw,
    });
  }
  const result = modelOutputSchema.safeParse(json);
  if (!result.success) {
    throw new ClinicalError(
      ClinicalErrorCode.INVALID_RESPONSE,
      'El JSON del modelo no tiene el formato esperado',
      { raw, issues: result.error.issues },
    );
  }
  return result.data;
}
