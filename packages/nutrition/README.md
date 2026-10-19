# @digitaltwin/nutrition

Estima alimentos, cantidades, hora y macros de un texto (o foto) con un LLM compatible con la API
de OpenAI. Por defecto DeepSeek `deepseek-flash` sin modo thinking y con salida JSON.

```js
import { NutritionAnalyzer, sumDishes, sumItems } from '@digitaltwin/nutrition';

const analyzer = new NutritionAnalyzer({ apiKey: process.env.LLM_API_KEY });
const result = await analyzer.analyze({ text: 'a las 8 avena 40 g con 200 ml de leche' });
// result.dishes: [{ name, eatenAt (ISO UTC), items: [{ name, quantity, unit, kcal, proteinG, carbsG, fatG, fiberG }] }]
const fixed = await analyzer.refine(result, 'la leche era desnatada');
sumItems(fixed.dishes[0].items); // subtotal de un plato: { kcal, proteinG, carbsG, fatG, fiberG }
sumDishes(fixed.dishes); // total
```

Con OpenAI: `new NutritionAnalyzer({ apiKey, baseUrl: 'https://api.openai.com/v1', model, extraBody: {} })`.

`mealEntrySchema` (zod) es el formato que acepta la API al guardar.
