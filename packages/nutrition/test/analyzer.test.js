import { describe, it, expect, vi } from 'vitest';
import { NutritionAnalyzer, sumDishes, sumDrinks, sumItems } from '../src/analyzer.js';
import { NutritionErrorCode } from '../src/errors.js';
import { mealEntrySchema } from '../src/schema.js';

const NOW = new Date('2026-10-13T12:32:00Z'); // 14:32 en Madrid

const OUTPUT = {
  dishes: [
    {
      name: 'Bol de frutos rojos',
      eaten_at: '2026-10-13T08:00',
      items: [
        {
          name: 'Frutos rojos',
          quantity: 150,
          unit: 'g',
          kcal: 64.6,
          protein_g: 1.23,
          carbs_g: '14.1',
          fat_g: 0.5,
          fiber_g: 5,
        },
      ],
    },
    {
      name: 'Café con leche',
      eaten_at: '2026-10-13T11:00',
      items: [
        {
          name: 'Café con leche',
          quantity: 1,
          unit: 'taza',
          kcal: 60,
          protein_g: 3.2,
          carbs_g: 4.8,
          fat_g: 3.1,
          fiber_g: 0,
        },
      ],
    },
  ],
  notes: 'Leche entera supuesta',
};

function reply(content, status = 200) {
  const body = status === 200 ? { choices: [{ message: { content } }] } : content;
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function build(...responses) {
  const fetch = vi.fn();
  for (const response of responses) fetch.mockResolvedValueOnce(response);
  return { fetch, analyzer: new NutritionAnalyzer({ apiKey: 'sk-test', fetch }) };
}

const sentBody = (fetch, call = 0) => JSON.parse(fetch.mock.calls[call][1].body);

describe('NutritionAnalyzer', () => {
  it('pide JSON a DeepSeek sin thinking y con la hora actual', async () => {
    const { fetch, analyzer } = build(reply(JSON.stringify(OUTPUT)));
    await analyzer.analyze({ text: 'frutos rojos a las 8 y un café a las 11', now: NOW });

    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('https://api.deepseek.com/chat/completions');
    expect(init.headers.Authorization).toBe('Bearer sk-test');

    const body = sentBody(fetch);
    expect(body).toMatchObject({
      model: 'deepseek-flash',
      response_format: { type: 'json_object' },
      thinking: { type: 'disabled' },
    });
    expect(body.messages[0].role).toBe('system');
    expect(body.messages[0].content).toMatch(/json/);
    expect(body.messages[1].content).toContain('martes 2026-10-13 14:32 (Europe/Madrid)');
    expect(body.messages[1].content).toContain('frutos rojos a las 8');
  });

  it('normaliza la respuesta: horas a UTC, números redondeados', async () => {
    const { analyzer } = build(reply(JSON.stringify(OUTPUT)));
    const result = await analyzer.analyze({ text: 'x', now: NOW });

    expect(result.notes).toBe('Leche entera supuesta');
    expect(result.dishes[0]).toEqual({
      name: 'Bol de frutos rojos',
      eatenAt: '2026-10-13T06:00:00.000Z',
      items: [
        {
          name: 'Frutos rojos',
          quantity: 150,
          unit: 'g',
          kcal: 65,
          proteinG: 1.2,
          carbsG: 14.1,
          fatG: 0.5,
          fiberG: 5,
        },
      ],
    });
    expect(sumItems(result.dishes[0].items)).toMatchObject({ kcal: 65, proteinG: 1.2 });
    expect(sumDishes(result.dishes)).toEqual({
      kcal: 125,
      proteinG: 4.4,
      carbsG: 18.9,
      fatG: 3.6,
      fiberG: 5,
    });
  });

  it('el resultado encaja en una entrada válida para la API', async () => {
    const { analyzer } = build(reply(JSON.stringify(OUTPUT)));
    const { dishes, notes } = await analyzer.analyze({ text: 'x', now: NOW });
    const entry = {
      id: crypto.randomUUID(),
      source: 'telegram',
      text: 'x',
      notes,
      dishes,
      createdAt: NOW.toISOString(),
    };
    expect(mealEntrySchema.safeParse(entry).success).toBe(true);
  });

  it('bebidas: los ml que hidratan y la cafeína solo en las que los tienen', async () => {
    const coffee = {
      name: 'Café con leche',
      eaten_at: '2026-10-13T09:00',
      items: [
        {
          name: 'Café con leche',
          quantity: 1,
          unit: 'taza',
          kcal: 60,
          protein_g: 3.2,
          carbs_g: 4.8,
          fat_g: 3.1,
          fiber_g: 0,
          fluid_ml: '200',
          caffeine_mg: 80.4,
        },
      ],
    };
    const output = { ...OUTPUT, dishes: [...OUTPUT.dishes, coffee] };
    const { analyzer } = build(reply(JSON.stringify(output)));
    const { dishes } = await analyzer.analyze({ text: 'x', now: NOW });
    expect(dishes.at(-1).items[0]).toMatchObject({ fluidMl: 200, caffeineMg: 80 });
    // La comida sólida no lleva esos campos
    expect(dishes[0].items[0]).not.toHaveProperty('fluidMl');
    expect(sumDrinks(dishes)).toEqual({ fluidMl: 200, caffeineMg: 80 });
  });

  it('tipo de comida: lo que diga el modelo si es válido; si no, ninguno', async () => {
    const output = {
      ...OUTPUT,
      dishes: [
        { ...OUTPUT.dishes[0], meal_type: 'breakfast' },
        { ...OUTPUT.dishes[1], meal_type: 'brunch' },
      ],
    };
    const { analyzer } = build(reply(JSON.stringify(output)));
    const result = await analyzer.analyze({ text: 'x', now: NOW });

    expect(result.dishes[0].mealType).toBe('breakfast');
    expect(result.dishes[1]).not.toHaveProperty('mealType');
    // Y sigue siendo una entrada válida para la API
    expect(
      mealEntrySchema.safeParse({
        id: '6f1c2a3e-1b2c-4d5e-8f90-123456789abc',
        source: 'telegram',
        text: 'x',
        dishes: result.dishes,
        createdAt: NOW.toISOString(),
      }).success,
    ).toBe(true);
  });

  it('le pasa lo ya apuntado hoy, en hora local y con su tipo', async () => {
    const { fetch, analyzer } = build(reply(JSON.stringify(OUTPUT)));
    await analyzer.analyze({
      text: 'un yogur',
      now: NOW,
      earlier: [
        { eatenAt: '2026-10-13T06:00:00Z', name: 'Tostadas', mealType: 'breakfast' },
        { eatenAt: '2026-10-13T10:00:00Z', name: 'Lentejas' },
      ],
    });
    const content = sentBody(fetch).messages[1].content;
    expect(content).toContain('Ya apuntado hoy');
    expect(content).toContain('- 08:00 Desayuno: Tostadas');
    expect(content).toContain('- 12:00 Lentejas');
  });

  it('manda la foto como data URL', async () => {
    const { fetch, analyzer } = build(reply(JSON.stringify(OUTPUT)));
    await analyzer.analyze({
      text: 'mi comida',
      image: { data: new Uint8Array([1, 2, 3]), mimeType: 'image/jpeg' },
      now: NOW,
    });

    const content = sentBody(fetch).messages[1].content;
    expect(content[0]).toMatchObject({ type: 'text' });
    expect(content[1]).toEqual({
      type: 'image_url',
      image_url: { url: 'data:image/jpeg;base64,AQID' },
    });
  });

  it('refine continúa la conversación con la corrección', async () => {
    const { fetch, analyzer } = build(
      reply(JSON.stringify(OUTPUT)),
      reply(JSON.stringify({ ...OUTPUT, notes: '' })),
    );
    const first = await analyzer.analyze({ text: 'desayuno', now: NOW });
    const second = await analyzer.refine(first, 'la leche era desnatada');

    const messages = sentBody(fetch, 1).messages;
    expect(messages.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'user']);
    expect(messages[3].content).toBe('Corrección: la leche era desnatada');
    expect(second.messages).toHaveLength(4);
  });

  it('reintenta una vez si la respuesta viene vacía o no es JSON', async () => {
    const { fetch, analyzer } = build(reply(''), reply(JSON.stringify(OUTPUT)));
    const result = await analyzer.analyze({ text: 'x', now: NOW });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(result.dishes).toHaveLength(2);

    const bad = build(reply('no es json'), reply('{"dishes":[{"name":"x","items":[]}]}'));
    await expect(bad.analyzer.analyze({ text: 'x', now: NOW })).rejects.toMatchObject({
      code: NutritionErrorCode.INVALID_RESPONSE,
    });
  });

  it('propaga los errores HTTP sin reintentar', async () => {
    const { fetch, analyzer } = build(reply({ error: { message: 'Insufficient Balance' } }, 402));
    await expect(analyzer.analyze({ text: 'x', now: NOW })).rejects.toMatchObject({
      code: NutritionErrorCode.API_ERROR,
      message: '402: Insufficient Balance',
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('permite otro proveedor compatible con OpenAI', async () => {
    const fetch = vi.fn().mockResolvedValue(reply(JSON.stringify(OUTPUT)));
    const analyzer = new NutritionAnalyzer({
      apiKey: 'sk',
      baseUrl: 'https://api.openai.com/v1/',
      model: 'otro-modelo',
      extraBody: {},
      fetch,
    });
    await analyzer.analyze({ text: 'x', now: NOW });
    expect(fetch.mock.calls[0][0]).toBe('https://api.openai.com/v1/chat/completions');
    expect(sentBody(fetch)).not.toHaveProperty('thinking');
  });

  it('avisa de lo gastado en cada llamada (también de las fallidas) con su función', async () => {
    const onUsage = vi.fn();
    const usage = { prompt_tokens: 900, completion_tokens: 120, prompt_cache_hit_tokens: 640 };
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            model: 'deepseek-flash',
            usage,
            choices: [{ message: { content: JSON.stringify(OUTPUT) } }],
          }),
        ),
      )
      .mockResolvedValueOnce(reply({ error: { message: 'Insufficient Balance' } }, 402));
    const analyzer = new NutritionAnalyzer({ apiKey: 'sk', fetch, onUsage });

    const first = await analyzer.analyze({ text: 'x', now: NOW });
    await expect(analyzer.refine(first, 'eran 2')).rejects.toThrow();

    expect(onUsage.mock.calls.map(([entry]) => entry)).toEqual([
      expect.objectContaining({ feature: 'nutrition.analyze', model: 'deepseek-flash', usage }),
      expect.objectContaining({
        feature: 'nutrition.refine',
        usage: null,
        error: '402: Insufficient Balance',
      }),
    ]);
  });
});
