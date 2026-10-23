import { NutritionError, NutritionErrorCode } from './errors.js';
import { MEAL_TYPE_LABELS, modelOutputSchema } from './schema.js';
import { SYSTEM_PROMPT, contextLine } from './prompt.js';
import { fromLocalDateTime, toLocalDateTime } from './time.js';

export const DEEPSEEK_BASE_URL = 'https://api.deepseek.com';
export const DEEPSEEK_MODEL = 'deepseek-flash';

const MAX_ATTEMPTS = 2;

/**
 * @typedef {import('zod').infer<typeof import('./schema.js').dishSchema>} Dish
 * @typedef {{ ml: number|null, drunkAt: string }} Water  ml null: hay que preguntar cuánta
 * @typedef {{ name: string, dose: string, takenAt: string }} Medication
 * @typedef {{ dishes: Dish[], water: Water[], medications: Medication[], question: string, notes: string,
 *   messages: object[] }} Analysis
 *   `messages` es la conversación con el modelo; se pasa a `refine` para corregir.
 */

/**
 * Estima los alimentos y macros de un mensaje con un modelo compatible con la API de OpenAI
 * (DeepSeek por defecto; para OpenAI basta cambiar baseUrl, model y extraBody).
 */
export class NutritionAnalyzer {
  /**
   * @param {object} options
   * @param {string} options.apiKey
   * @param {string} [options.baseUrl] Por defecto DeepSeek.
   * @param {string} [options.model] Por defecto deepseek-flash (admite imágenes).
   * @param {string} [options.timeZone] Zona horaria del usuario.
   * @param {object} [options.extraBody] Campos extra de la petición. Por defecto desactiva el
   *   modo thinking de DeepSeek (más rápido y barato); con OpenAI pasa `{}`.
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
    timeZone = 'Europe/Madrid',
    extraBody = { thinking: { type: 'disabled' } },
    maxTokens = 4000,
    timeoutMs = 60_000,
    fetch = globalThis.fetch,
    onUsage,
  }) {
    if (!apiKey) throw new Error('NutritionAnalyzer: falta apiKey');
    this.apiKey = apiKey;
    this.url = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
    this.model = model;
    this.timeZone = timeZone;
    this.extraBody = extraBody;
    this.maxTokens = maxTokens;
    this.timeoutMs = timeoutMs;
    this.fetch = fetch;
    this.onUsage = onUsage;
  }

  /**
   * Analiza lo que ha comido el usuario.
   * @param {object} input
   * @param {string} [input.text]
   * @param {{ data: Uint8Array, mimeType: string }} [input.image]
   * @param {Date} [input.now] Momento del mensaje (hora por defecto de los alimentos).
   * @param {{ eatenAt: string, name: string, mealType?: string }[]} [input.earlier] Lo ya
   *   apuntado ese día: para saber qué comida es cada plato (después de cenar, picoteo).
   * @returns {Promise<Analysis>}
   */
  async analyze({ text = '', image, now = new Date(), earlier = [] }) {
    const weekday = new Intl.DateTimeFormat('es-ES', {
      weekday: 'long',
      timeZone: this.timeZone,
    }).format(now);
    const header = contextLine(toLocalDateTime(now, this.timeZone), this.timeZone, weekday);
    const logged = earlier.length
      ? `\nYa apuntado hoy (no lo vuelvas a apuntar):\n${earlier
          .map((m) => {
            const at = toLocalDateTime(new Date(m.eatenAt), this.timeZone).slice(11, 16);
            return `- ${at} ${m.mealType ? `${MEAL_TYPE_LABELS[m.mealType]}: ` : ''}${m.name}`;
          })
          .join('\n')}`
      : '';
    const body = `${header}${logged}\n\n${text.trim() || '(sin texto, mira la foto)'}`;

    const content = image
      ? [
          { type: 'text', text: body },
          {
            type: 'image_url',
            image_url: {
              url: `data:${image.mimeType};base64,${Buffer.from(image.data).toString('base64')}`,
            },
          },
        ]
      : body;

    return this.#run([{ role: 'user', content }], 'nutrition.analyze');
  }

  /**
   * Rehace un análisis con una corrección del usuario ("eran 250 ml", "quita el azúcar"...).
   * @param {Analysis} previous
   * @param {string} correction
   * @returns {Promise<Analysis>}
   */
  async refine(previous, correction) {
    return this.#run(
      [...previous.messages, { role: 'user', content: `Corrección: ${correction}` }],
      'nutrition.refine',
    );
  }

  async #run(messages, feature) {
    let lastError;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const raw = await this.#complete(messages, feature);
        const output = parseOutput(raw);
        return {
          dishes: output.dishes.map((dish) => this.#toDish(dish)),
          water: output.water.map((w) => ({
            ml: w.ml == null ? null : Math.round(w.ml),
            drunkAt: fromLocalDateTime(w.drunk_at, this.timeZone).toISOString(),
          })),
          medications: output.medications.map((m) => ({
            name: m.name,
            dose: m.dose,
            takenAt: fromLocalDateTime(m.taken_at, this.timeZone).toISOString(),
          })),
          question: output.question.trim(),
          notes: output.notes.trim(),
          messages: [...messages, { role: 'assistant', content: raw }],
        };
      } catch (error) {
        const retryable =
          error.code === NutritionErrorCode.EMPTY_RESPONSE ||
          error.code === NutritionErrorCode.INVALID_RESPONSE;
        if (!retryable) throw error;
        lastError = error;
      }
    }
    throw lastError;
  }

  async #complete(messages, feature) {
    const started = Date.now();
    const report = (usage, error, model = this.model) => {
      try {
        this.onUsage?.({ feature, model, usage, durationMs: Date.now() - started, error });
      } catch {
        // Llevar la cuenta nunca debe romper el análisis
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
          messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...messages],
          response_format: { type: 'json_object' },
          max_tokens: this.maxTokens,
          temperature: 0.2,
          ...this.extraBody,
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      report(null, error.message);
      if (error.name === 'TimeoutError') {
        throw new NutritionError(NutritionErrorCode.TIMEOUT, 'El modelo ha tardado demasiado');
      }
      throw new NutritionError(NutritionErrorCode.API_ERROR, `Error de red: ${error.message}`);
    }

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const message = payload?.error?.message ?? response.statusText;
      report(null, `${response.status}: ${message}`);
      throw new NutritionError(NutritionErrorCode.API_ERROR, `${response.status}: ${message}`, {
        status: response.status,
      });
    }

    report(payload?.usage ?? null, undefined, payload?.model ?? this.model);
    const content = payload?.choices?.[0]?.message?.content;
    if (!content?.trim()) {
      throw new NutritionError(NutritionErrorCode.EMPTY_RESPONSE, 'El modelo no ha devuelto nada');
    }
    return content;
  }

  #toDish(dish) {
    return {
      name: dish.name,
      eatenAt: fromLocalDateTime(dish.eaten_at, this.timeZone).toISOString(),
      ...(dish.meal_type && { mealType: dish.meal_type }),
      items: dish.items.map(toIngredient),
    };
  }
}

function toIngredient(item) {
  return {
    name: item.name,
    quantity: item.quantity,
    unit: item.unit,
    kcal: Math.round(item.kcal),
    proteinG: round1(item.protein_g),
    carbsG: round1(item.carbs_g),
    fatG: round1(item.fat_g),
    fiberG: round1(item.fiber_g),
    // Solo en bebidas: así un ingrediente sólido sigue igual que antes
    ...(item.fluid_ml > 0 && { fluidMl: Math.round(item.fluid_ml) }),
    ...(item.caffeine_mg > 0 && { caffeineMg: Math.round(item.caffeine_mg) }),
  };
}

function parseOutput(raw) {
  let json;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new NutritionError(NutritionErrorCode.INVALID_RESPONSE, 'El modelo no ha devuelto JSON', {
      raw,
    });
  }
  const result = modelOutputSchema.safeParse(json);
  if (!result.success) {
    throw new NutritionError(
      NutritionErrorCode.INVALID_RESPONSE,
      'El JSON del modelo no tiene el formato esperado',
      { raw, issues: result.error.issues },
    );
  }
  return result.data;
}

const round1 = (n) => Math.round(n * 10) / 10;

/** Suma las macros de todos los ingredientes de una lista de platos. */
export function sumDishes(dishes) {
  return sumItems(dishes.flatMap((dish) => dish.items));
}

/** Lo que hidratan y la cafeína de unos platos (o ingredientes): { fluidMl, caffeineMg }. */
export function sumDrinks(dishesOrItems) {
  const items = dishesOrItems.flatMap((x) => x.items ?? [x]);
  return {
    fluidMl: Math.round(items.reduce((sum, i) => sum + (i.fluidMl ?? 0), 0)),
    caffeineMg: Math.round(items.reduce((sum, i) => sum + (i.caffeineMg ?? 0), 0)),
  };
}

/** Suma las macros de una lista de ingredientes. */
export function sumItems(items) {
  const total = { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0, fiberG: 0 };
  for (const item of items) {
    for (const key of Object.keys(total)) total[key] += item[key];
  }
  for (const key of Object.keys(total))
    total[key] = key === 'kcal' ? Math.round(total[key]) : round1(total[key]);
  return total;
}
