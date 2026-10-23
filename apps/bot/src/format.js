import {
  MEAL_TYPE_LABELS,
  sumDishes,
  sumDrinks,
  sumItems,
  toLocalDateTime,
} from '@digitaltwin/nutrition';

export function escapeHtml(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const num = (n) => String(Math.round(n * 10) / 10);

function when(eatenAt, timeZone, today) {
  const local = toLocalDateTime(new Date(eatenAt), timeZone);
  const [date, time] = local.split('T');
  if (date === today) return time;
  const [, month, day] = date.split('-');
  return `${day}/${month} ${time}`;
}

const pcg = (m) => `P ${num(m.proteinG)} · HC ${num(m.carbsG)} · G ${num(m.fatG)}`;
const macros = (m) => `${m.kcal} kcal · ${pcg(m)}`;

/** " · 💧 200 ml · 80 mg cafeína" de una bebida (nada si no lo es). */
function drinkText(items) {
  const { fluidMl, caffeineMg } = sumDrinks(items);
  return [fluidMl && ` · 💧 ${fluidMl} ml`, caffeineMg && ` · ${caffeineMg} mg cafeína`]
    .filter(Boolean)
    .join('');
}

const quantity = (item) =>
  item.quantity == null ? '' : escapeHtml(`${num(item.quantity)} ${item.unit}`.trim());

/**
 * Mensaje (HTML de Telegram) con lo que ha entendido el modelo: cada plato con su subtotal y
 * sus ingredientes, y el total. Un plato de un solo ingrediente (un café) va en una línea.
 * El agua va aparte, sin macros.
 * @param {{ dishes: object[], water?: { ml: number, drunkAt: string }[], notes: string }} analysis
 * @param {{ timeZone: string, now?: Date }} options
 */
export function formatAnalysis(
  { dishes, water = [], medications = [], notes },
  { timeZone, now = new Date() },
) {
  const today = toLocalDateTime(now, timeZone).split('T')[0];
  const sorted = [...dishes].sort((a, b) => a.eatenAt.localeCompare(b.eatenAt));

  const icon = dishes.length ? '🍽' : water.length ? '💧' : '💊';
  const lines = [`${icon} <b>Esto es lo que he entendido</b>`];
  for (const m of medications) {
    const dose = m.dose ? ` · ${escapeHtml(m.dose)}` : '';
    lines.push('', `💊 <b>${when(m.takenAt, timeZone, today)} · ${escapeHtml(m.name)}</b>${dose}`);
  }
  for (const w of water) {
    lines.push('', `💧 <b>${when(w.drunkAt, timeZone, today)} · Agua</b> · ${w.ml} ml`);
  }
  for (const dish of sorted) {
    // "Cena · 19:30 · Puré": el tipo se ve para poder corregirlo antes de confirmar
    const type = dish.mealType ? `${MEAL_TYPE_LABELS[dish.mealType]} · ` : '';
    const title = `<b>${type}${when(dish.eatenAt, timeZone, today)} · ${escapeHtml(dish.name)}</b>`;
    const subtotal = sumItems(dish.items);
    lines.push('');

    if (dish.items.length === 1) {
      const amount = quantity(dish.items[0]);
      lines.push(amount ? `${title} · ${amount}` : title, macros(subtotal) + drinkText(dish.items));
      continue;
    }

    lines.push(title, `<b>${subtotal.kcal} kcal</b> · ${pcg(subtotal)}`);
    for (const item of dish.items) {
      const amount = quantity(item);
      lines.push(
        `  • ${escapeHtml(item.name)}${amount ? ` ${amount}` : ''} — ${macros(item)}${drinkText([item])}`,
      );
    }
  }

  if (!dishes.length) {
    if (notes) lines.push('', `<i>${escapeHtml(notes)}</i>`);
    return lines.join('\n');
  }
  const total = sumDishes(dishes);
  lines.push(
    '',
    `<b>Total: ${total.kcal} kcal</b>`,
    `P ${num(total.proteinG)} g · HC ${num(total.carbsG)} g · G ${num(total.fatG)} g · Fibra ${num(total.fiberG)} g`,
  );
  // Lo que hidratan las bebidas (y el agua, si va en el mismo mensaje)
  const fluids = sumDrinks(dishes).fluidMl + water.reduce((sum, w) => sum + (w.ml ?? 0), 0);
  if (fluids) lines.push(`💧 Líquidos: ${fluids} ml`);
  if (notes) lines.push('', `<i>${escapeHtml(notes)}</i>`);

  return lines.join('\n');
}

export const HELP = [
  '🍽 <b>Cuéntame lo que comes</b> y te calculo las macros. El agua y las medicinas también: <i>medio litro de agua</i>, <i>me he tomado un enantyum</i>.',
  '',
  'Ejemplo: <i>a las 8 bol de frutos rojos 150 g con 40 g de avena y 200 ml de leche, a las 11 café con leche</i>',
  '',
  'Si no dices la hora, uso la del mensaje. También puedes mandar una foto del plato (con texto si quieres).',
  '',
  'Revisa la propuesta y pulsa ✅ Guardar, ✏️ Corregir (o contesta al mensaje con la corrección) o ❌ Descartar.',
].join('\n');
